import test from 'node:test';
import assert from 'node:assert/strict';
import { groupByIdentity, newestFirst, botStateUpdate } from '../scripts/merge-conversation-policy.js';
const c = (id, org, contact, integration, last) => ({id,org_id:org,channel:'whatsapp',contact_id:contact,integration_id:integration,last_message_at:new Date(last),created_at:new Date(last)});

test('agrupa somente mesma empresa contato e numero', () => {
 const groups=groupByIdentity([
  c('a','org1','contact1','wa1','2026-01-01'), c('b','org1','contact1','wa1','2026-01-02'),
  c('c','org1','contact1','wa2','2026-01-03'), c('d','org1','contact2','wa1','2026-01-04'),
  c('e','org2','contact1','wa1','2026-01-05'),
 ]);
 assert.equal(groups.length,1); assert.deepEqual(groups[0].map(x=>x.id),['a','b']);
});
test('mantem a conversa que o backend ja utiliza', () => {
 const group=[c('old','o','c','i','2026-01-01'),c('new','o','c','i','2026-01-03')];
 group.sort(newestFirst);assert.equal(group[0].id,'new');
});
test('migra sessao unica de bot para conversa sobrevivente',()=>{
 const key='_whats_guru_chatbot_v1_old';
 const result=botStateUpdate({[key]:{conversation_id:'old',bot_id:'bot-1'}},'new',['old']);
 assert.equal(result.conflict,false);assert.equal(result.moved,true);
 assert.equal(result.fields._whats_guru_chatbot_v1_new.conversation_id,'new');
 assert.equal(result.fields[key],undefined);
});
test('sinaliza conflito quando existem sessoes em duas conversas',()=>{
 const result=botStateUpdate({
  _whats_guru_chatbot_v1_new:{conversation_id:'new',bot_id:'a'},
  _whats_guru_chatbot_v1_old:{conversation_id:'old',bot_id:'b'},
 },'new',['old']);
 assert.equal(result.conflict,true);
});
