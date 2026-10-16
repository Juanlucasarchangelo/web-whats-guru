const BOT_KEY = '_whats_guru_chatbot_v1';

function databaseName() {
  try { return decodeURIComponent(new URL(process.env.DATABASE_URL).pathname.replace(/^\//, '')); }
  catch { throw new Error('DATABASE_URL ausente/invalido no server/.env.'); }
}

export function groupByIdentity(items) {
  const groups = new Map();
  for (const c of items) {
    const key = JSON.stringify([c.org_id, c.channel, c.contact_id, c.integration_id]);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(c);
  }
  return [...groups.values()].filter(group => group.length > 1);
}

// Exactly the same winner selection used in getOrCreateConversation.
export function newestFirst(a, b) {
  const newer = new Date(b.last_message_at).getTime() - new Date(a.last_message_at).getTime();
  if (newer) return newer;
  const older = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
  return older || a.id.localeCompare(b.id);
}

export function botStateUpdate(customFields, keeperId, sourceIds) {
  const fields = customFields && typeof customFields === 'object' && !Array.isArray(customFields) ? { ...customFields } : {};
  const winnerKey = `${BOT_KEY}_${keeperId}`;
  const owned = [keeperId, ...sourceIds].map(id => ({ id, key: `${BOT_KEY}_${id}`, state: fields[`${BOT_KEY}_${id}`] }))
    .filter(item => item.state && typeof item.state === 'object');
  if (owned.length > 1) return { conflict: true, fields: null, moved: false };
  let moved = false;
  if (owned.length === 1 && owned[0].id !== keeperId) {
    const entry = owned[0];
    fields[winnerKey] = { ...entry.state, conversation_id: keeperId };
    delete fields[entry.key];
    moved = true;
  }
  const legacy = fields[BOT_KEY];
  if (legacy && typeof legacy === 'object' && sourceIds.includes(legacy.conversation_id)) {
    if (fields[winnerKey] && fields[winnerKey].bot_id !== legacy.bot_id) {
      return { conflict: true, fields: null, moved: false };
    }
    fields[winnerKey] = { ...legacy, conversation_id: keeperId };
    delete fields[BOT_KEY];
    moved = true;
  }
  return { conflict: false, fields, moved };
}

