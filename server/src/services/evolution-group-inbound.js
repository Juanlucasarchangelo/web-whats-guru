import { prisma } from '../db.js';
import { initialDeliveryStatus } from './evolution-message-status.js';
import { getEvolutionText, stableMessageId, validTime } from './evolution-payload.js';
import { identifyEvolutionMedia, mediaLabel } from './evolution-media.js';
import { groupJid, groupSender, upsertEvolutionGroup } from './evolution-groups.js';
import { queueGroupMediaArchive } from './evolution-media-archive.js';

export async function importEvolutionGroupMessage({ orgId, integrationId, item, expectedGroupJid = null,
  historical = false }) {
  const key = item?.key ?? item?.data?.key ?? {};
  const jid = groupJid(key.remoteJid);
  if (!key.id || !jid) return { outcome: 'ignored_missing_group_id' };
  if (expectedGroupJid && jid !== expectedGroupJid) return { outcome: 'ignored_other_group' };
  if (!integrationId) return { outcome: 'ignored_missing_instance' };
  const fromMe = [true, 'true', 1, '1'].includes(key.fromMe);
  const media = identifyEvolutionMedia(item);
  const text = getEvolutionText(item) ?? media?.caption ?? '';
  if (!String(text).trim() && !media) return { outcome: 'ignored_unsupported_type' };
  const messageId = stableMessageId(`group:${integrationId}:${jid}:${key.id}`);
  if (fromMe) {
    const accepted = await prisma.webhookEvent.findFirst({ where: { org_id: orgId,
      source: 'evolution_outbound', event_type: 'message_accepted',
      payload: { path: '$.provider_message_id', equals: String(key.id) } }, select: { id: true } });
    if (accepted) return { outcome: 'already_sent_from_panel' };
  }
  const group = await upsertEvolutionGroup({ orgId, integrationId,
    record: { id: jid, subject: item?.groupSubject || item?.groupName || undefined } });
  const exists = await prisma.message.findUnique({ where: { id: messageId },
    select: { id: true, media_message: true, media_type: true } });
  if (exists) {
    if (media && !exists.media_message) {
      // Older webhook payloads can omit recoverable media metadata. Rehydrate it
      // from a later history response without creating another message.
      await prisma.message.updateMany({ where: { id: messageId, org_id: orgId },
        data: { media_type: media.type, media_name: media.name, media_mime: media.mime,
          media_size: media.size, media_message: media.message } });
    }
    // A previous download/NAS failure must not leave an attachment permanently missing.
    // Retrying the same history is idempotent: requeue only media not yet archived.
    if (media && media.type !== 'location') queueGroupMediaArchive({ orgId, integrationId, messageId });
    return { outcome: 'duplicate' };
  }
  const sender = groupSender(item);
  const timestamp = validTime(item?.messageTimestamp ?? item?.data?.messageTimestamp);
  try {
    await prisma.$transaction(async tx => {
      await tx.message.create({ data: { id: messageId, org_id: orgId, conversation_id: group.conversation_id,
        channel: 'whatsapp', body: String(text).trim().slice(0, 10000) || `[${mediaLabel(media.type)}]`,
        sender_type: fromMe ? 'agent' : 'contact', status: fromMe ? initialDeliveryStatus(item) : 'received',
        is_internal: false, created_at: timestamp, media_type: media?.type ?? null,
        media_name: media?.name ?? null, media_mime: media?.mime ?? null, media_size: media?.size ?? null,
        media_message: media?.message ?? null,
        group_sender_jid: sender.jid, group_sender_name: fromMe ? null : sender.name } });
      if (!historical && !fromMe) await tx.conversation.update({ where: { id: group.conversation_id }, data: {
        unread_count: { increment: 1 }, status: 'open' } });
      await tx.conversation.updateMany({ where: { id: group.conversation_id,
        last_message_at: { lt: timestamp } }, data: { last_message_at: timestamp } });
    });
  } catch (error) {
    if (error?.code === 'P2002') return { outcome: 'duplicate' };
    throw error;
  }
  if (media && media.type !== 'location') queueGroupMediaArchive({ orgId, integrationId, messageId });
  // Group automations are intentionally not fired until a separate group policy is defined.
  return { outcome: fromMe ? 'sent_from_phone' : 'received', conversationId: group.conversation_id };
}
