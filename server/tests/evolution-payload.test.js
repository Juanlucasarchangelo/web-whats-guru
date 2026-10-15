import test from 'node:test';
import assert from 'node:assert/strict';
import {
  inboundPhone, getEvolutionText, evolutionEventItems,
  summarizeEvolutionResults, stableMessageId, validTime,
} from '../src/services/evolution-payload.js';

test('Evolution v2 event body as data object', () => {
  const payload={event:'messages.upsert',instance:'whats-guru',data:{key:{id:'abc',remoteJid:'5541999999999@s.whatsapp.net',fromMe:false},message:{conversation:'Ola'}}};
  const rows=evolutionEventItems(payload);
  assert.equal(rows.length,1);
  assert.equal(inboundPhone(rows[0],payload),'5541999999999');
  assert.equal(getEvolutionText(rows[0]),'Ola');
});
test('No @lid ID is ever incorrectly considered a phone number',()=>{
  const row={key:{id:'m',remoteJid:'11927141003400@lid'}};
  assert.equal(inboundPhone(row),null);
  assert.equal(inboundPhone(row,{sender:'5541999999999@s.whatsapp.net'}),'5541999999999');
  assert.equal(inboundPhone({key:{remoteJid:'001@lid',remoteJidAlt:'5511999999999@s.whatsapp.net'}}),'5511999999999');
});
test('Evolution may send batch records, message wraps and captions',()=>{
  assert.equal(evolutionEventItems({data:{messages:[1,2]}}).length,2);
  assert.equal(evolutionEventItems({data:{messages:{records:[1,2,3]}}}).length,3);
  assert.equal(getEvolutionText({message:{ephemeralMessage:{message:{extendedTextMessage:{text:'Teste'}}}}}),'Teste');
  assert.equal(getEvolutionText({message:{imageMessage:{caption:'Legenda'}}}),'Legenda');
});
test('Stable message IDs prevent duplicated webhook/history messages',()=>{
  const id=stableMessageId('ABCD');
  assert.equal(id,stableMessageId('ABCD'));
  assert.notEqual(id,stableMessageId('EFGH'));
  assert.match(id,/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/);
});
test('Counts and Evolution timestamps',()=>{
  assert.deepEqual(summarizeEvolutionResults([{outcome:'received'},{outcome:'duplicate'},{outcome:'received'}]),{received:2,duplicate:1});
  assert.equal(validTime(1760000000).getTime(),1760000000000);
});
