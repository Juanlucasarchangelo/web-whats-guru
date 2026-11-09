import test from 'node:test';
import assert from 'node:assert/strict';
import { groupMetadata, isFallbackGroupTitle } from '../src/services/evolution-groups-policy.js';
const jid = '120363414542622764@g.us';
test('nome real Grupo de teste nunca e placeholder', () => {
  assert.equal(isFallbackGroupTitle('Grupo de teste',jid),false);
  assert.equal(isFallbackGroupTitle(`Grupo ${jid.split('@')[0]}`,jid),true);
  assert.equal(isFallbackGroupTitle(`Grupo ${jid}`,jid),true);
  assert.equal(groupMetadata({id:jid,subject:'Grupo de teste'}).subject,'Grupo de teste');
  assert.equal(groupMetadata({id:jid}).subject,`Grupo ${jid.split('@')[0]}`);
});
