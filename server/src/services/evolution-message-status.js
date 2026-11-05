// Evolution 2.3.x webhook and persisted MessageUpdate delivery states.
// Pure helpers: never infer that an HTTP 200 means a message was delivered.
const ranks = { failed: -1, pending: 0, accepted: 1, sent: 2, delivered: 3, read: 4, played: 5 };

export function deliveryStatus(raw) {
  if (raw == null) return null;
  if (typeof raw === 'number') return ({ 0: 'failed', 1: 'pending', 2: 'sent', 3: 'delivered', 4: 'read', 5: 'played' })[raw] ?? null;
  const value = String(raw).trim().toUpperCase();
  return ({ ERROR: 'failed', FAILED: 'failed', PENDING: 'pending', ACCEPTED: 'accepted',
    SENT: 'sent', SERVER_ACK: 'sent', DELIVERY_ACK: 'delivered', DELIVERED: 'delivered',
    READ: 'read', READ_ACK: 'read', PLAYED: 'played', PLAYED_ACK: 'played' })[value] ?? null;
}

export function newerDeliveryStatus(current, incoming) {
  const next = deliveryStatus(incoming) ?? incoming;
  if (!(next in ranks)) return null;
  if (next === 'failed') return ['pending', 'accepted', 'failed'].includes(current) ? next : null;
  const previousRank = ranks[current] ?? 0;
  return ranks[next] > previousRank ? next : null;
}

export function extractReceipt(item) {
  if (!item || typeof item !== 'object') return null;
  const id = item?.keyId ?? item?.key?.id ?? item?.id;
  const status = deliveryStatus(item?.status ?? item?.update?.status ?? item?.message?.status);
  const fromMe = item?.fromMe ?? item?.key?.fromMe;
  // Some Evolution 2.3.x update events omit fromMe. Verify the stored
  // message is outgoing (agent/bot) in saveEvolutionReceipt before updating.
  if (!id || !status || [false, 'false', 0, '0'].includes(fromMe)) return null;
  return { providerId: String(id), status };
}

export function initialDeliveryStatus(item) {
  const statuses = [item?.status, ...(Array.isArray(item?.MessageUpdate) ? item.MessageUpdate.map(x => x?.status) : [])];
  let current = 'sent';
  for (const raw of statuses) current = newerDeliveryStatus(current, raw) ?? current;
  return current;
}
