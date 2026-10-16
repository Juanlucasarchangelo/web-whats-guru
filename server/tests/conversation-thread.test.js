import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  conversationIdentity,
  getOrCreateConversation,
  withConversationIdentityLock,
} from '../src/services/conversation-thread.js';

function fakeDatabase() {
  const rows = [];
  let creates = 0;
  return {
    rows,
    get creates() { return creates; },
    conversation: {
      async findFirst({ where }) {
        return rows.filter(row => Object.entries(where).every(([k, v]) => row[k] === v))
          .sort((a, b) => (b.last_message_at ?? b.created_at) - (a.last_message_at ?? a.created_at) || a.created_at - b.created_at || a.id.localeCompare(b.id))[0] || null;
      },
      async create({ data }) {
        creates++;
        const row = { ...data, created_at: new Date(), last_message_at: new Date() };
        rows.push(row);
        return row;
      },
    },
  };
}
const input = { orgId: 'org', contactId: 'contact', integrationId: 'instance-1' };

test('reuses a CLOSED conversation without creating a new row', async () => {
  const db = fakeDatabase();
  db.rows.push({ id: 'old', org_id: 'org', contact_id: 'contact', channel: 'whatsapp',
    integration_id: 'instance-1', status: 'closed', created_at: new Date('2024-01-01'), last_message_at: new Date('2024-01-02'), last_message_at: new Date('2024-01-02') });
  const found = await getOrCreateConversation(db, input);
  assert.equal(found.conversation.id, 'old');
  assert.equal(found.created, false);
  assert.equal(db.creates, 0);
});

test('uses the most recently active conversation when historical duplicate rows already exist', async () => {
  const db = fakeDatabase();
  db.rows.push({ id: 'later', org_id: 'org', contact_id: 'contact', channel: 'whatsapp',
    integration_id: 'instance-1', status: 'open', created_at: new Date('2024-03-01'), last_message_at: new Date('2024-03-02') });
  db.rows.push({ id: 'first', org_id: 'org', contact_id: 'contact', channel: 'whatsapp',
    integration_id: 'instance-1', status: 'closed', created_at: new Date('2024-01-01') });
  assert.equal((await getOrCreateConversation(db, input)).conversation.id, 'later');
});

test('different WhatsApp instances keep their independent histories', async () => {
  const db = fakeDatabase();
  const a = await getOrCreateConversation(db, input);
  const b = await getOrCreateConversation(db, { ...input, integrationId: 'instance-2' });
  assert.notEqual(a.conversation.id, b.conversation.id);
  assert.equal(db.creates, 2);
});

test('same normalized phone locks the same identity', () => {
  assert.equal(conversationIdentity({ ...input, phone: '+55 (41) 98888-7777' }),
    conversationIdentity({ ...input, phone: '5541988887777' }));
});

test('parallel inbound and campaign starts do not create two conversations', async () => {
  const db = fakeDatabase();
  const identity = { ...input, phone: '+55 (41) 98888-7777' };
  const attempts = await Promise.all(Array.from({ length: 20 }, () =>
    withConversationIdentityLock(identity, () => getOrCreateConversation(db, input))));
  assert.equal(db.creates, 1);
  assert.equal(new Set(attempts.map(x => x.conversation.id)).size, 1);
});

test('lock is released after an error so future messages can continue', async () => {
  await assert.rejects(withConversationIdentityLock(input, async () => { throw Error('network failure'); }));
  assert.equal(await withConversationIdentityLock(input, async () => 'ok'), 'ok');
});
