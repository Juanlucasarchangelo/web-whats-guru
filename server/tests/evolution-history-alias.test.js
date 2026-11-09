import test from 'node:test';
import assert from 'node:assert/strict';
import { linkedHistoryJids, normalizeHistoricalItem, phoneJid } from '../src/services/evolution-history-policy.js';
import { inboundPhone } from '../src/services/evolution-payload.js';

const phone = '5511940245277';
test('combina PN e LID quando Evolution comprova que pertencem ao mesmo contato', () => {
  const rows = [
    { remoteJid: '123456789123456@lid', remoteJidAlt: `${phone}@s.whatsapp.net` },
    { remoteJid: `${phone}@s.whatsapp.net`, lid: '987654321987654' },
    { remoteJid: '222222222222222@lid', remoteJidAlt: '5511988887777@s.whatsapp.net' },
  ];
  assert.deepEqual(linkedHistoryJids(rows, phone), [phoneJid(phone),
    '123456789123456@lid', '987654321987654@lid']);
});

test('nao associa LID apenas por nome nem aceita outro telefone', () => {
  assert.deepEqual(linkedHistoryJids([{remoteJid:'123456789123456@lid', name:'Julio Cesar'}], phone), [phoneJid(phone)]);
  assert.deepEqual(linkedHistoryJids([{remoteJid:'123456789123456@lid',remoteJidAlt:'5511911111111@s.whatsapp.net'}], phone), [phoneJid(phone)]);
});

test('historico @lid validado injeta alternativa telefonica sem alterar o ID da mensagem', () => {
  const original = { key: { id:'ABCD', remoteJid:'123456789123456@lid', fromMe:false }, messageTimestamp: 1794200000 };
  const normalized = normalizeHistoricalItem(original, '123456789123456@lid', phone);
  assert.equal(normalized.key.id, 'ABCD');
  assert.equal(normalized.key.remoteJid, original.key.remoteJid);
  assert.equal(normalized.key.remoteJidAlt, phoneJid(phone));
  assert.equal(inboundPhone(normalized), phone);
  assert.equal(original.key.remoteJidAlt, undefined);
});

test('nao injeta numero quando registro nao corresponde ao JID validado', () => {
  const unrelated = {key:{id:'ZZ',remoteJid:'222222222222222@lid',fromMe:false}};
  assert.equal(normalizeHistoricalItem(unrelated, '123456789123456@lid', phone), unrelated);
});

test('nao substitui telefone alternativo de outro contato', () => {
  const conflicting = {key:{id:'XYZ',remoteJid:'123456789123456@lid',remoteJidAlt:'5511988887777@s.whatsapp.net'}};
  assert.equal(normalizeHistoricalItem(conflicting, '123456789123456@lid', phone), conflicting);
  assert.equal(inboundPhone(conflicting), '5511988887777');
  const senderConflict = {key:{id:'A',remoteJid:'123456789123456@lid'},senderPn:'5511988887777@s.whatsapp.net'};
  assert.equal(normalizeHistoricalItem(senderConflict,'123456789123456@lid',phone), senderConflict);
});
