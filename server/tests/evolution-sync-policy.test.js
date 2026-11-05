import test from 'node:test';
import assert from 'node:assert/strict';
import {
  historyCutoff, messageDate, recordsFrom, contactIdentity, isPlaceholderContactName,
  HISTORY_PAGE_SIZE, CONTACT_PAGE_SIZE, shouldContinueHistory,
} from '../src/services/evolution-sync-policy.js';

test('o corte do historico limita a importacao a tres meses', () => {
  assert.equal(historyCutoff(new Date('2026-11-05T16:00:00Z')).toISOString(), '2026-08-05T16:00:00.000Z');
  assert.equal(historyCutoff(new Date('2026-05-31T16:00:00Z')).toISOString(), '2026-02-28T16:00:00.000Z');
});
test('a data das mensagens Evolution aceita segundos, milissegundos e Long', () => {
  const seconds = 1793894400;
  assert.equal(messageDate({ messageTimestamp: seconds })?.getTime(), seconds * 1000);
  assert.equal(messageDate({ messageTimestamp: seconds * 1000 })?.getTime(), seconds * 1000);
  assert.equal(messageDate({ messageTimestamp: { toNumber: () => seconds } })?.getTime(), seconds * 1000);
  assert.equal(messageDate({ messageTimestamp: 'invalid' }), null);
});
test('a pagina Evolution 2.3.7 aceita records, array direto e data', () => {
  assert.deepEqual(recordsFrom({ messages: { pages: 2, records: [{ key: { id: 'a' } }] } }, 'messages'), {
    records: [{ key: { id: 'a' } }], pages: 2,
  });
  assert.deepEqual(recordsFrom([{ remoteJid: '5511999999999@s.whatsapp.net' }], 'contacts').records.length, 1);
  assert.deepEqual(recordsFrom({ data: { records: [] } }, 'contacts').records, []);
});
test('a importacao identifica telefone privado sem misturar grupos e LID', () => {
  assert.deepEqual(contactIdentity({ remoteJid: '5511999999999@s.whatsapp.net', pushName: 'Cliente' }), {
    phone: '5511999999999', name: 'Cliente',
  });
  assert.equal(contactIdentity({ remoteJid: '5511999999999@g.us' }), null);
  assert.equal(contactIdentity({ remoteJid: '123456789@lid' }), null);
  assert.equal(contactIdentity({ remoteJid: 'invalid' }), null);
  assert.equal(contactIdentity({ remoteJid: '5511999999999@s.whatsapp.net', name: '5511999999999' })?.name, null);
});
test('preserva nomes do CRM e identifica nomes provisórios', () => {
  assert.equal(isPlaceholderContactName('WhatsApp 5511999999999', '5511999999999'), true);
  assert.equal(isPlaceholderContactName('Cliente VIP', '5511999999999'), false);
  assert.equal(HISTORY_PAGE_SIZE, 100);
  assert.equal(CONTACT_PAGE_SIZE, 500);
});

test('continua importacao quando a Evolution entrega paginas menores que o offset solicitado', () => {
  const cutoff = new Date('2026-08-05T00:00:00Z');
  const recent = { messageTimestamp: Date.parse('2026-10-15T00:00:00Z') / 1000 };
  const older = { messageTimestamp: Date.parse('2026-07-01T00:00:00Z') / 1000 };
  assert.deepEqual(shouldContinueHistory({ records: [recent], page: 1, totalPages: null, cutoff }), { continue: true });
  assert.deepEqual(shouldContinueHistory({ records: [older], page: 2, totalPages: null, cutoff }), { continue: false });
  assert.deepEqual(shouldContinueHistory({ records: [], page: 3, totalPages: null, cutoff }), { continue: false });
  assert.deepEqual(shouldContinueHistory({ records: [recent], page: 3, totalPages: 3, cutoff }), { continue: false });
});

test('resolve nomes sem substituir o contato pelo nome do proprietario do WhatsApp', () => {
  assert.equal(contactIdentity({ remoteJid: '5511999999999@s.whatsapp.net',
    lastMessage: { key: { fromMe: false }, pushName: 'Cliente do histórico' } })?.name, 'Cliente do histórico');
  assert.equal(contactIdentity({ remoteJid: '5511999999999@s.whatsapp.net',
    lastMessage: { key: { fromMe: true }, pushName: 'Dono do WhatsApp' } })?.name, null);
});
