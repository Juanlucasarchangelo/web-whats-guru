// A WhatsApp contact can have a phone-number JID (PN) and an opaque @lid JID.
// Link an opaque identifier only when the SAME Evolution contact/chat record
// explicitly confirms the target PN. Matching names or bare LID digits is unsafe.
const normalizedJid = value => {
  if (typeof value !== 'string') return null;
  const jid = value.trim().toLowerCase();
  return /^\d{10,15}@(s\.whatsapp\.net|c\.us)$/.test(jid) || /^\d{10,25}@lid$/.test(jid)
    ? jid : null;
};

export function phoneJid(phone) {
  const normalized = String(phone ?? '').replace(/\D/g, '');
  return /^\d{10,15}$/.test(normalized) ? `${normalized}@s.whatsapp.net` : null;
}

function recordJids(record) {
  const fields = [record?.remoteJid, record?.remoteJidAlt, record?.jid, record?.jidAlt,
    record?.id, record?.lid, record?.lidJid, record?.lidId,
    record?.phoneNumber, record?.pnJid, record?.pn, record?.phone,
    record?.key?.remoteJid, record?.key?.remoteJidAlt,
    record?.lastMessage?.key?.remoteJid, record?.lastMessage?.key?.remoteJidAlt,
    record?.contact?.remoteJid, record?.contact?.remoteJidAlt, record?.contact?.lid,
    record?.contact?.phoneNumber, record?.contact?.pnJid];
  // A `lid` field may hold a numeric opaque ID rather than a complete JID.
  for (const value of [record?.lid, record?.lidId, record?.contact?.lid]) {
    if (typeof value === 'string' && /^\d{10,25}$/.test(value)) fields.push(`${value}@lid`);
  }
  return new Set(fields.map(normalizedJid).filter(Boolean));
}

export function linkedHistoryJids(records, phone) {
  const pn = phoneJid(phone);
  if (!pn) return [];
  const alternative = pn.replace('@s.whatsapp.net', '@c.us');
  const linked = new Set([pn]);
  for (const record of records) {
    const jids = recordJids(record);
    if (!jids.has(pn) && !jids.has(alternative)) continue;
    for (const jid of jids) if (jid.endsWith('@lid')) linked.add(jid);
  }
  return [...linked].slice(0, 6);
}

export function normalizeHistoricalItem(item, queryJid, phone) {
  const key = item?.key ?? item?.data?.key;
  if (!key || !key.remoteJid) return item;
  const realJid = normalizedJid(key.remoteJid);
  if (!realJid || realJid !== queryJid) return item;
  if (!realJid.endsWith('@lid')) return item;
  const targetPn = phoneJid(phone);
  if (!targetPn) return item;
  // A conflicting PN is never overwritten. Without this check a different
  // senderPn on an @lid item could accidentally be attributed to this chat.
  const explicit = [key.remoteJidAlt, item?.senderPn, item?.sender, item?.data?.senderPn];
  if (explicit.some(value => normalizedJid(value)?.match(/@(s\.whatsapp\.net|c\.us)$/) &&
    normalizedJid(value)?.split('@')[0] !== String(phone).replace(/\D/g, ''))) return item;
  if (key.remoteJidAlt) return item;
  if (item?.key) return { ...item, key: { ...key, remoteJidAlt: targetPn } };
  return { ...item, data: { ...item.data, key: { ...key, remoteJidAlt: targetPn } } };
}
