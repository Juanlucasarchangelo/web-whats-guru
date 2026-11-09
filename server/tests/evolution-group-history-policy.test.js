import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizedProviderMessage, messageGroupJid, evolutionGroupSettings, groupHistoryHints }
  from '../src/services/evolution-group-history-policy.js';
import { identifyEvolutionMedia } from '../src/services/evolution-media.js';

const GROUP = '120363295648424210@g.us';

test('histórico aninhado da Evolution mantém grupo, remetente e mídia recuperável', () => {
  const source = { data: { key: { id: 'ABC', remoteJid: GROUP,
    participant: '5511999999999@s.whatsapp.net' }, messageTimestamp: 1794230000,
    message: { documentMessage: { fileName: 'Memorial de Obra.pdf', mimetype: 'application/pdf', fileLength: 1200 } } } };
  const item = normalizedProviderMessage(source);
  assert.equal(messageGroupJid(source), GROUP);
  assert.equal(item.key.participant, '5511999999999@s.whatsapp.net');
  const media = identifyEvolutionMedia(item);
  assert.equal(media.name, 'Memorial de Obra.pdf');
  assert.equal(media.message.key.remoteJid, GROUP);
});

test('não transforma participante de grupo em conversa, nem importa outro grupo', () => {
  assert.equal(messageGroupJid({ key: { remoteJid: '5511999999999@s.whatsapp.net', participant: GROUP } }), null);
  assert.equal(messageGroupJid({ key: { remoteJid: 'outro@broadcast' } }), null);
  assert.equal(messageGroupJid({ key: { remoteJid: GROUP } }), GROUP);
});

test('diagnostica syncFullHistory e groupsIgnore em ambos os formatos da Evolution', () => {
  assert.deepEqual(evolutionGroupSettings({ settings: { settings: {
    sync_full_history: false, groups_ignore: true,
  } } }), { sync_full_history: false, groups_ignore: true });
  assert.deepEqual(evolutionGroupSettings({ data: {
    syncFullHistory: true, groupsIgnore: false,
  } }), { sync_full_history: true, groups_ignore: false });
  assert.equal(groupHistoryHints({ sync_full_history: false, groups_ignore: true }).length, 2);
  assert.deepEqual(groupHistoryHints({ sync_full_history: true, groups_ignore: false }), []);
});

test('falha da consulta alternativa e varredura parcial aparecem no diagnóstico', () => {
  const hints = groupHistoryHints(null, { unfilteredError: new Error('HTTP 502'), partial: true });
  assert.equal(hints.length, 2);
});
