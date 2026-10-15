import { createHash } from 'node:crypto';
export const digits = value => String(value ?? '').replace(/\D/g, '');

// Deterministic key: a replayed webhook or manual sync cannot duplicate a message.
export function stableMessageId(providerId) {
  const hash = createHash('sha256').update(`evolution:${providerId}`).digest('hex');
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

export function getEvolutionText(item) {
  let message = item?.message ?? item?.data?.message ?? {};
  if (message?.ephemeralMessage?.message) message = message.ephemeralMessage.message;
  if (message?.viewOnceMessage?.message) message = message.viewOnceMessage.message;
  if (message?.viewOnceMessageV2?.message) message = message.viewOnceMessageV2.message;
  return message?.conversation ?? message?.extendedTextMessage?.text ?? message?.imageMessage?.caption ?? message?.videoMessage?.caption ?? item?.text ?? null;
}

function getPhoneJid(jid) {
  if (typeof jid !== 'string') return null;
  const [number, domain] = jid.split('@');
  if (!['s.whatsapp.net', 'c.us'].includes(domain)) return null;
  const phone = digits(number?.split(':')[0]);
  return phone.length >= 10 && phone.length <= 15 ? phone : null;
}

export function inboundPhone(item, envelope = {}) {
  const key = item?.key ?? item?.data?.key ?? {};
  // @lid identifiers are NOT phone numbers. Prefer their PN alternative or sender.
  const candidates = [key.remoteJid, key.remoteJidAlt, item?.senderPn, item?.sender, envelope?.sender];
  for (const candidate of candidates) {
    const phone = getPhoneJid(candidate);
    if (phone) return phone;
  }
  // Some Evolution versions provide an explicit phone number field.
  for (const candidate of [item?.phone, envelope?.phone]) {
    const number = digits(candidate);
    if (number.length >= 10 && number.length <= 15) return number;
  }
  return null;
}

export function validTime(raw) {
  const value = raw && typeof raw === 'object' && typeof raw.toNumber === 'function' ? raw.toNumber() : Number(raw);
  if (!Number.isFinite(value)) return new Date();
  const millis = value < 100000000000 ? value * 1000 : value;
  if (millis < 1000000000000 || millis > Date.now() + 86_400_000) return new Date();
  return new Date(millis);
}


export function evolutionEventItems(payload) {
  const body = payload?.data;
  if (Array.isArray(body)) return body;
  if (Array.isArray(body?.messages)) return body.messages;
  if (Array.isArray(body?.data)) return body.data;
  if (Array.isArray(body?.messages?.records)) return body.messages.records;
  return body ? [body] : [];
}

export function summarizeEvolutionResults(results) {
  return results.reduce((counts, item) => {
    const key = item.outcome;
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {});
}
