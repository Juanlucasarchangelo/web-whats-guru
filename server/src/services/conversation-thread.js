import { randomUUID } from 'node:crypto';

// Keep the SAME WhatsApp history for the same organization, contact and instance.
// Lock by normalized phone when available to also serialize simultaneous first
// webhook events before their Contact record exists. No database migration needed.
const locks = new Map();
const digits = value => String(value ?? '').replace(/\D/g, '');

export function conversationIdentity({ orgId, integrationId = null, phone = null, contactId = null, channel = 'whatsapp' }) {
  const person = digits(phone) || String(contactId || '');
  if (!orgId || !person) throw new Error('Identidade de conversa incompleta.');
  return JSON.stringify([orgId, channel, integrationId, person]);
}

export async function withConversationIdentityLock(identity, action) {
  const key = conversationIdentity(identity);
  const previous = locks.get(key) || Promise.resolve();
  const running = previous.catch(() => {}).then(action);
  locks.set(key, running);
  try { return await running; }
  finally { if (locks.get(key) === running) locks.delete(key); }
}

// Intentionally includes CLOSED conversations. Never join different WhatsApp
// integrations. Prefer the most recently used thread so active bot sessions and
// assignments are not silently moved to an old, abandoned duplicate.
export async function getOrCreateConversation(db, { orgId, contactId, integrationId = null, channel = 'whatsapp', subject = null }) {
  const existing = await db.conversation.findFirst({
    where: { org_id: orgId, contact_id: contactId, channel, integration_id: integrationId },
    orderBy: [{ last_message_at: 'desc' }, { created_at: 'asc' }, { id: 'asc' }],
  });
  if (existing) return { conversation: existing, created: false };
  const conversation = await db.conversation.create({
    data: { id: randomUUID(), org_id: orgId, contact_id: contactId, channel,
      integration_id: integrationId, status: 'open', ...(subject == null ? {} : { subject }) },
  });
  return { conversation, created: true };
}
