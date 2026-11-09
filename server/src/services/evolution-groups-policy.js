/** Group remoteJID parsing without database side effects. */
export function groupJid(value) {
  const jid = String(value ?? '').trim();
  return /^[0-9A-Za-z._-]{5,100}@g\.us$/.test(jid) ? jid : null;
}

export function isFallbackGroupTitle(subject, jid) {
  const id = groupJid(jid);
  if (!id) return false;
  const label = String(subject ?? '').trim();
  return !label || label === `Grupo ${id.split('@')[0]}` || label === `Grupo ${id}`;
}

export function groupMetadata(record) {
  const data = record?.group ?? record?.data ?? record;
  const jid = [data?.id, data?.remoteJid, data?.jid, data?.key?.remoteJid,
    data?.lastMessage?.key?.remoteJid].map(groupJid).find(Boolean) || null;
  if (!jid) return null;
  const title = [data?.subject, data?.name, data?.groupName, data?.pushName]
    .find(value => typeof value === 'string' && value.trim());
  const subject = String(title || `Grupo ${jid.split('@')[0]}`).trim().slice(0, 255);
  const count = Number(data?.size ?? data?.participants?.length);
  return { jid, subject, description: typeof data?.desc === 'string' ? data.desc.slice(0, 2000) : null,
    participant_count: Number.isSafeInteger(count) && count >= 0 ? count : null };
}

export function groupSender(item) {
  const key = item?.key ?? item?.data?.key ?? {};
  const participant = String(key.participant ?? key.participantAlt ?? item?.participant ??
    item?.participantAlt ?? item?.sender ?? '').trim();
  const jid = /^(?:[0-9A-Za-z._-]{3,100})@(?:s\.whatsapp\.net|lid|c\.us)$/.test(participant) ? participant : null;
  const name = [item?.pushName, item?.data?.pushName].find(value => typeof value === 'string' && value.trim());
  return { jid, name: name ? name.trim().slice(0, 150) : (jid ? jid.split('@')[0] : null) };
}
