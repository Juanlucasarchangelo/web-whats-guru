import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeCustomers,dueEvents,parseDay,renderExternalMessage,deterministicId,localDate} from '../src/services/external-date-policy.js';
const today={year:2026,month:11,day:13};
const source={clientes:[{id_externo:'cli1',nome:'Ana',telefone:'+55 11 99999-8888',consentimento_whatsapp:true,
  data_nascimento:'1990-11-13',filhos:[{id_externo:'f1',nome:'Leo',data_nascimento:'2015-11-13'},{id_externo:'f2',nome:'Lia',data_nascimento:'2012-11-13'}],
  faturas:[{id_externo:'inv1',data_renovacao:'2026-11-18'},{id_externo:'inv2',data_renovacao:'2026-11-20'}]}]};
const clients=normalizeCustomers(source);
test('birthday once per year',()=>{assert.equal(dueEvents(clients,{event_key:'customer_birthday'},today).length,1);});
test('separate events for children with stable ids',()=>{const matches=dueEvents(clients,{event_key:'child_birthday'},today);assert.equal(matches.length,2);assert.notEqual(matches[0].unique,matches[1].unique);});
test('invoice only for target exact date',()=>{const result=dueEvents(clients,{event_key:'invoice_renewal',days_before:5},today);assert.equal(result.length,1);assert.match(result[0].unique,/inv1/);});
test('no consent means no eligible events',()=>{assert.equal(dueEvents(normalizeCustomers({clientes:[{...source.clientes[0],consentimento_whatsapp:false}]}),{event_key:'customer_birthday'},today).length,0);});
test('reject invalid dates and identity collisions',()=>{assert.equal(parseDay('2025-02-29'),null);assert.equal(parseDay('2000-02-29')?.day,29);assert.throws(()=>normalizeCustomers({clientes:[source.clientes[0],source.clientes[0]]}),/duplicado/);});
test('safe template variables',()=>{assert.equal(renderExternalMessage('Oi {nome}, {nome_filho}!',{nome:'Ana',nome_filho:'Leo'}),'Oi Ana, Leo!');});
test('stable deterministic UUID with different occurrences',()=>{const a=deterministicId(['org','rule','2026']);assert.equal(a,deterministicId(['org','rule','2026']));assert.notEqual(a,deterministicId(['org','rule','2027']));});
test('timezone respects Sao Paulo calendar',()=>{const x=localDate(new Date('2026-11-14T01:00:00Z'));assert.equal(x.day,13);});
