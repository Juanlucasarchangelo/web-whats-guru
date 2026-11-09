/** Group identity is instance-scoped and never inferred from a phone number. */
import { randomUUID } from 'node:crypto';
import { prisma } from '../db.js';
import { withConversationIdentityLock } from './conversation-thread.js';

import { groupMetadata, isFallbackGroupTitle } from './evolution-groups-policy.js';
export { groupJid, groupMetadata, groupSender } from './evolution-groups-policy.js';

export async function upsertEvolutionGroup({ orgId, integrationId, record }) {
  if (!integrationId) throw new Error('Grupo sem instancia WhatsApp.');
  const metadata = groupMetadata(record);
  if (!metadata) return null;
  return withConversationIdentityLock({ orgId, integrationId, contactId: metadata.jid, channel: 'whatsapp_group' }, async () => {
    const existing = await prisma.whatsAppGroup.findUnique({
      where: { org_id_integration_id_jid: { org_id: orgId, integration_id: integrationId, jid: metadata.jid } },
    });
    if (existing) {
      // Um webhook sem assunto usa 'Grupo <jid>' como placeholder. Nunca substituir
      // um nome verdadeiro (inclusive 'Grupo de teste') por esse placeholder.
      const title = isFallbackGroupTitle(metadata.subject, metadata.jid) &&
        !isFallbackGroupTitle(existing.subject, metadata.jid)
        ? existing.subject : metadata.subject;
      if (existing.subject !== title || (metadata.description && existing.description !== metadata.description) ||
          (metadata.participant_count != null && existing.participant_count !== metadata.participant_count)) {
        await prisma.$transaction(async tx => {
          await tx.whatsAppGroup.update({ where: { id: existing.id }, data: {
            subject: title, ...(metadata.description ? { description: metadata.description } : {}),
            ...(metadata.participant_count != null ? { participant_count: metadata.participant_count } : {}),
          } });
          await tx.contact.updateMany({ where: { id: existing.contact_id, org_id: orgId }, data: { name: title } });
          await tx.conversation.updateMany({ where: { id: existing.conversation_id, org_id: orgId }, data: { subject: title } });
        });
      }
      return { ...existing, subject: title };
    }
    return prisma.$transaction(async tx => {
      const contactId = randomUUID();
      const conversationId = randomUUID();
      await tx.contact.create({ data: { id: contactId, org_id: orgId, name: metadata.subject, is_group: true,
        phone: null, custom_fields: { whatsapp_group: true } } });
      await tx.conversation.create({ data: { id: conversationId, org_id: orgId, contact_id: contactId,
        integration_id: integrationId, channel: 'whatsapp', is_group: true, subject: metadata.subject,
        status: 'open', last_message_at: new Date(0) } });
      return tx.whatsAppGroup.create({ data: { id: randomUUID(), org_id: orgId,
        integration_id: integrationId, jid: metadata.jid, subject: metadata.subject,
        description: metadata.description, participant_count: metadata.participant_count,
        conversation_id: conversationId, contact_id: contactId } });
    });
  });
}

