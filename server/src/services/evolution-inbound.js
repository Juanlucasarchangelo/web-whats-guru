import { randomUUID } from 'node:crypto';
import { prisma } from '../db.js';
import { digits, stableMessageId, inboundPhone, getEvolutionText, validTime } from './evolution-payload.js';
import { processIncomingWorkflows } from './workflow-engine.js';
import { getOrCreateConversation, withConversationIdentityLock } from './conversation-thread.js';
const ignored = reason => ({ outcome: reason });

/** Import from webhook or Evolution history; only message text/caption is supported. */
export async function importEvolutionMessage({ orgId, integrationId = null, item, envelope = {}, expectedPhone = null, triggerAutomations = false }) {
  const key = item?.key ?? item?.data?.key ?? {};
  if (!key.id) return ignored('ignored_missing_id');
  if ([true, 'true', 1, '1'].includes(key.fromMe)) return ignored('ignored_own_message');
  const jid = String(key.remoteJid ?? '');
  if (jid.endsWith('@g.us') || jid.endsWith('@broadcast') || jid.endsWith('@newsletter')) return ignored('ignored_non_private');
  const phone = inboundPhone(item, envelope);
  if (!phone) return ignored('ignored_phone_unresolved');
  if (expectedPhone && phone !== digits(expectedPhone)) return ignored('ignored_other_contact');
  const text = getEvolutionText(item);
  if (typeof text !== 'string' || !text.trim()) return ignored('ignored_unsupported_type');
  const primary = await prisma.integration.findFirst({where:{org_id:orgId,type:'whatsapp'},orderBy:[{created_at:'asc'},{id:'asc'}],select:{id:true}});
  const channelId = integrationId ?? primary?.id ?? null;
  const messageId = stableMessageId(channelId===primary?.id ? String(key.id) : `${channelId}:${key.id}`);
  const result = await withConversationIdentityLock({ orgId, integrationId: channelId, phone }, async () => {
    // Check again INSIDE the lock, avoiding two simultaneous webhook deliveries.
    if (await prisma.message.findUnique({ where: { id: messageId }, select: { id: true } })) return ignored('duplicate');

    let contact = await prisma.contact.findFirst({
      where: { org_id: orgId, OR: [{ phone }, { phone: `+${phone}` }] },
      select: { id: true, phone: true },
    });
    if (!contact) {
      // Legacy contacts may use punctuation/spaces; only scan if exact lookup missed.
      const known = await prisma.contact.findMany({ where: { org_id: orgId }, select: { id: true, phone: true }, take: 10000 });
      contact = known.find(c => digits(c.phone) === phone);
    }
    if (!contact) {
      const name = String(item?.pushName || envelope?.pushName || `WhatsApp ${phone}`).slice(0, 150);
      contact = await prisma.contact.create({ data: { id: randomUUID(), org_id: orgId, phone: `+${phone}`, name, custom_fields: {} } });
    }

    const { conversation, created } = await getOrCreateConversation(prisma, {
      orgId, contactId: contact.id, integrationId: channelId,
    });
    // New inbound on an existing, manually opened thread also counts as new.
    const isNew = created || await prisma.message.count({
      where: { org_id: orgId, conversation_id: conversation.id, sender_type: 'contact' },
    }) === 0;
    const timestamp = validTime(item?.messageTimestamp ?? item?.data?.messageTimestamp);
    try {
      await prisma.$transaction(async tx => {
        await tx.message.create({ data: {
          id: messageId, org_id: orgId, conversation_id: conversation.id,
          sender_type: 'contact', body: text.trim().slice(0, 10000), channel: 'whatsapp',
          status: 'received', is_internal: false, created_at: timestamp,
        } });
        await tx.conversation.update({ where: { id: conversation.id }, data: {
          unread_count: { increment: 1 },
          ...(['closed', 'resolved'].includes(conversation.status) ? { status: 'open' } : {}),
        } });
        await tx.conversation.updateMany({
          where: { id: conversation.id, last_message_at: { lt: timestamp } },
          data: { last_message_at: timestamp },
        });
      });
    } catch (error) {
      if (error?.code === 'P2002') return ignored('duplicate');
      throw error;
    }
    return { outcome: 'received', conversationId: conversation.id, isNew };
  });
  if (result.outcome === 'received' && triggerAutomations) {
    // Bot failure must never roll back an already persisted message.
    try {
      await processIncomingWorkflows({ orgId, conversationId: result.conversationId,
        text: text.trim(), isNew: result.isNew, messageId });
    } catch (error) { console.error('[Workflow] Falha apos mensagem recebida:', {
      conversationId: result.conversationId, messageId, error: error.message,
    }); }
  }
  if (result.outcome === 'received') return { outcome: 'received', conversationId: result.conversationId };
  return result;
}

