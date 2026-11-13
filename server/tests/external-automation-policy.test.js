import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { eventDate, normalizeExternalBatch, tokenHash, validExternalToken } from '../src/services/external-automation-policy.js';
const annual={event_key:'birthday',recurrence:'annual'};
const once={event_key:'post_event',recurrence:'once'};
const good={event:'birthday',records:[{id_externo:'monday_123',nome:'Maria Silva',telefone:'+55 (11) 99999-8888',aniversario:'15/11',empresa:'ABC'}]};
test('normalizes birthday and core data',()=>{
 const [a]=normalizeExternalBatch(good,annual);
 assert.equal(a.external_id,'monday_123');assert.equal(a.event_date,'11-15');assert.equal(a.phone,'5511999998888');assert.equal(a.payload.empresa,'ABC');
});
test('accepts full ISO anniversary and leap day',()=>{
 assert.equal(eventDate('2000-02-29','annual'),'02-29');
 assert.equal(eventDate('15/11/2026','annual'),'11-15');
});
test('rejects impossible dates',()=>{
 assert.throws(()=>eventDate('31/02','annual'),/inválida/);
 assert.throws(()=>eventDate('2025-02-29','once'),/inválida/);
});
test('once requires full date',()=>{
 assert.throws(()=>normalizeExternalBatch({event:'post_event',records:[{...good.records[0],data_evento:'15/11'}]},once),/completa/);
 assert.equal(eventDate('2026-11-15','once'),'2026-11-15');
});
test('rejects wrong event even with valid records',()=>assert.throws(()=>normalizeExternalBatch(good,once),/corresponde/));
test('rejects duplicate external IDs in the same batch',()=>assert.throws(()=>normalizeExternalBatch({event:'birthday',records:[good.records[0],good.records[0]]},annual),/repetido/));
test('rejects more than 100 rows',()=>assert.throws(()=>normalizeExternalBatch({event:'birthday',records:Array(101).fill(good.records[0])},annual),/100/));
test('rejects reserved keys and nested objects',()=>{
 assert.throws(()=>normalizeExternalBatch({event:'birthday',records:[{...good.records[0],api_key:'abc'}]},annual),/inválido/);
 assert.throws(()=>normalizeExternalBatch({event:'birthday',records:[{...good.records[0],dados:{x:1}}]},annual),/não é texto/);
});
test('no date required for immediate event',()=>assert.equal(normalizeExternalBatch({event:'birthday',records:[{id_externo:'1',nome:'João',telefone:'11999998888'}]},{event_key:'birthday',recurrence:'immediate'})[0].event_date,null));
test('constant time auth checks a full random secret',()=>{
 const secret=randomBytes(32).toString('hex'),hashed=tokenHash(secret);
 assert.equal(validExternalToken('Bearer '+secret,hashed),true);
 assert.equal(validExternalToken('Bearer '+randomBytes(32).toString('hex'),hashed),false);
 assert.equal(validExternalToken('Bearer '+secret.slice(0,10),hashed),false);
 assert.equal(validExternalToken('',hashed),false);
});
