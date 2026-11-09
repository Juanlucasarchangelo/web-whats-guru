import { prisma } from '../db.js';
import { stableMessageId } from './evolution-payload.js';
import { extractReceipt, newerDeliveryStatus } from './evolution-message-status.js';
import { groupJid } from './evolution-groups-policy.js';

/** Only change outgoing messages from the same company and Evolution instance.
 * No contact payloads or third-party message contents are stored in the log.
 */
export async function saveEvolutionReceipt({ orgId, integrationId, item }) {
  const receipt = extractReceipt(item);
  if (!receipt) return 'ignored_receipt';
  const { providerId, status } = receipt;
  const remoteGroup = groupJid(item?.key?.remoteJid ?? item?.remoteJid);
  const hashes = remoteGroup
    ? [stableMessageId(`group:${integrationId}:${remoteGroup}:${providerId}`)]
    : [stableMessageId(`${integrationId}:${providerId}`), stableMessageId(providerId)];
  const conversationScope = { org_id: orgId, integration_id: integrationId,
    ...(remoteGroup ? { whatsapp_groups: { some: { jid: remoteGroup } } } : {}) };
  let message = await prisma.message.findFirst({
    where: { id: { in: hashes }, org_id: orgId, sender_type: { in: ['agent', 'bot'] },
      conversations: { is: conversationScope } },
    select: { id: true, status: true },
  });
  if (!message) {
    // Messages sent through the FalaComigo panel have random UUIDs; the provider
    // message ID is stored only in the outbound event payload.
    const accepted = await prisma.webhookEvent.findMany({
      where: { org_id: orgId, source: 'evolution_outbound', event_type: 'message_accepted',
        payload: { path: '$.provider_message_id', equals: providerId } },
      select: { payload: true }, take: 15,
      orderBy: { received_at: 'desc' },
    });
    for (const event of accepted) {
      const localId = event.payload?.local_message_id;
      if (!localId) continue;
      message = await prisma.message.findFirst({ where: {
        id: String(localId), org_id: orgId, sender_type: { in: ['agent', 'bot'] },
        conversations: { is: conversationScope },
      }, select: { id: true, status: true } });
      if (message) break;
    }
  }
  if (!message) return 'receipt_not_found';
  const next = newerDeliveryStatus(message.status, status);
  if (!next) return 'receipt_unchanged';
  // Re-check status in the update filter to avoid regressing concurrent receipts.
  const statusesAtOrBelow = ['pending', 'accepted', 'sent', 'delivered', 'read', 'played', 'failed']
    .filter(previous => newerDeliveryStatus(previous, next));
  const updated = await prisma.message.updateMany({ where: { id: message.id, org_id: orgId,
    status: { in: statusesAtOrBelow } }, data: { status: next } });
  return updated.count ? 'receipt_updated' : 'receipt_unchanged';
}
