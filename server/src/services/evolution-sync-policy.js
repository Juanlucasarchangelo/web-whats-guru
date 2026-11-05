// Evolution 2.3.x history and contact parsing. These functions are deliberately
// independent of Prisma/HTTP to keep the three-month cutoff testable.
export const HISTORY_PAGE_SIZE = 100;
export const CONTACT_PAGE_SIZE = 500;
export const MAX_HISTORY_PAGES = 3000; // Explicit warning if a very large chat hits this safety ceiling.
export const MAX_CONTACT_PAGES = 400;

export function historyCutoff(now = new Date()) {
  const date = new Date(now);
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() - 3);
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day, lastDay));
  return date;
}

export function messageDate(item) {
  const raw = item?.messageTimestamp ?? item?.data?.messageTimestamp ?? item?.timestamp;
  const parsed = raw && typeof raw === 'object' && typeof raw.toNumber === 'function'
    ? raw.toNumber() : (typeof raw === 'object' && raw?.low != null ? Number(raw.low) : Number(raw));
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  const millis = parsed < 1e11 ? parsed * 1000 : parsed;
  if (millis < 1e12 || millis > Date.now() + 86400000) return null;
  return new Date(millis);
}

export function recordsFrom(result, kind) {
  if (Array.isArray(result)) return { records: result, pages: null };
  const base = result?.[kind] ?? result?.data?.[kind] ?? result?.data ?? result;
  const records = Array.isArray(base) ? base : base?.records ?? base?.data ?? base?.items;
  if (!Array.isArray(records)) throw new Error(`Resposta inesperada da Evolution (${kind}).`);
  const pages = Number(base?.pages ?? base?.totalPages ?? base?.pagination?.totalPages);
  return { records, pages: Number.isInteger(pages) && pages > 0 ? pages : null };
}

/** Keep reading pages even when Evolution caps the returned page size below
 * the requested offset. Empty pages and provider totals are the only reliable
 * end-of-data signals; an entire older page is a safe 3-month cutoff.
 */
export function shouldContinueHistory({ records, page, totalPages, cutoff }) {
  if (!records.length || (totalPages && page >= totalPages)) return { continue: false };
  const dates = records.map(messageDate);
  if (dates.every(Boolean) && dates.every(date => date < cutoff)) return { continue: false };
  return { continue: true };
}

export function contactIdentity(contact) {
  const jid = String(contact?.remoteJid ?? contact?.jid ?? contact?.key?.remoteJid ??
    contact?.lastMessage?.key?.remoteJid ?? contact?.id ?? '');
  const [number, domain] = jid.split('@');
  if (!['s.whatsapp.net', 'c.us'].includes(domain)) return null; // groups, broadcasts and @lid are not numbers
  const phone = number.replace(/\D/g, '');
  if (phone.length < 10 || phone.length > 15) return null;
  // A sender pushName from an outgoing message is the LOCAL user's name,
  // not the other person's name. Never use it to overwrite CRM records.
  const lastMessage = contact?.lastMessage;
  const incomingLastName = lastMessage?.key?.fromMe === false ? lastMessage?.pushName : null;
  const nameCandidates = [contact?.name, contact?.fullName, contact?.contactName,
    contact?.savedName, contact?.firstName, contact?.shortName,
    contact?.contact?.name, contact?.contact?.pushName,
    contact?.pushName, contact?.notify, contact?.verifiedName, incomingLastName];
  const name = nameCandidates.map(v => String(v ?? '').trim()).find(v => v &&
    v !== phone && v !== `+${phone}` && v !== `WhatsApp ${phone}` &&
    !(v.replace(/\D/g, '') === phone && /^[+\d\s().-]+$/.test(v)));
  return { phone, name: name?.slice(0, 150) ?? null };
}

export function isPlaceholderContactName(name, phone) {
  const value = String(name ?? '').trim();
  return !value || value === phone || value === `+${phone}` || value === `WhatsApp ${phone}`;
}
