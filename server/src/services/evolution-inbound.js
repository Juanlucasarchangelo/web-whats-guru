import { randomUUID } from 'node:crypto';
import { prisma } from '../db.js';
import { digits, stableMessageId, inboundPhone, getEvolutionText, validTime } from './evolution-payload.js';
const ignored = reason => ({ outcome: reason });

/** Import from webhook or Evolution history; only message text/caption is supported. */
export async function importEvolutionMessage({ orgId, item, envelope = {}, expectedPhone = null }) {
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
  const messageId = stableMessageId(String(key.id));
  if (await prisma.message.findUnique({ where: { id: messageId }, select: { id: true } })) return ignored('duplicate');

  let contact = await prisma.contact.findFirst({
    where: { org_id: orgId, OR: [{ phone }, { phone: `+${phone}` }] },
    select: { id: true, phone: true },
  });
  if (!contact) {
    // Legacy contacts may use punctuation/spaces; only scan if indexed exact lookup missed.
    const known = await prisma.contact.findMany({ where: { org_id: orgId }, select: { id: true, phone: true }, take: 10000 });
    contact = known.find(c => digits(c.phone) === phone);
  }
  if (!contact) {
    const name = String(item?.pushName || envelope?.pushName || `WhatsApp ${phone}`).slice(0, 150);
    contact = await prisma.contact.create({ data: { id: randomUUID(), org_id: orgId, phone: `+${phone}`, name, custom_fields: {} } });
  }
  let conversation = await prisma.conversation.findFirst({
    where: { org_id: orgId, contact_id: contact.id, channel: 'whatsapp', status: { not: 'closed' } },
    orderBy: { last_message_at: 'desc' },
  });
  if (!conversation) conversation = await prisma.conversation.create({
    data: { id: randomUUID(), org_id: orgId, contact_id: contact.id, channel: 'whatsapp', status: 'open' },
  });
  const timestamp = validTime(item?.messageTimestamp ?? item?.data?.messageTimestamp);
  try {
    await prisma.$transaction(async tx => {
      await tx.message.create({ data: {
        id: messageId, org_id: orgId, conversation_id: conversation.id,
        sender_type: 'contact', body: text.trim().slice(0, 10000), channel: 'whatsapp',
        status: 'received', is_internal: false, created_at: timestamp,
      } });
      await tx.conversation.update({ where: { id: conversation.id }, data: { unread_count: { increment: 1 } } });
      await tx.conversation.updateMany({
        where: { id: conversation.id, last_message_at: { lt: timestamp } },
        data: { last_message_at: timestamp },
      });
    });
  } catch (error) {
    if (error?.code === 'P2002') return ignored('duplicate');
    throw error;
  }
  return { outcome: 'received', conversationId: conversation.id };
}

