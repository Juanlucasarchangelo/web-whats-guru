import test from 'node:test';
import assert from 'node:assert/strict';
import { awaitingSide, eligibleGroupSilence, groupTriggerError, isSavedPersonalContact, zonedDay, summaryGroupIds, summaryExecutionKey, summaryAlreadyDelivered } from '../src/services/group-automation-policy.js';

const gid='a748372e-2eea-4e44-9da9-403711a6786c';
const rid='b748372e-2eea-4e44-9da9-403711a6786c';
const iid='c748372e-2eea-4e44-9da9-403711a6786c';

test('grp: never allow implicit source group or absent action',()=>{
 assert.match(groupTriggerError({type:'group_no_reply',timeout_minutes:30,waiting_for:'group'},[{type:'send_message',text:'OK'}]),/Selecione/);
 assert.match(groupTriggerError({type:'group_no_reply',group_id:gid,timeout_minutes:30,waiting_for:'group'},[]),/ações/i);
 assert.equal(groupTriggerError({type:'group_no_reply',group_id:gid,timeout_minutes:30,waiting_for:'group'},[{type:'replace_tag',old_tag:'A',tag:'B'}]),null);
});
test('daily summary requires explicit group and recipient, valid time and action',()=>{
 const t={type:'group_daily_summary',group_id:gid,time:'20:15',recipient:{kind:'contact',contact_id:rid,integration_id:iid}};
 assert.equal(groupTriggerError(t,[{type:'ai_daily_summary'}]),null);
 assert.match(groupTriggerError({...t,recipient:null},[{type:'ai_daily_summary'}]),/Selecione/);
 assert.match(groupTriggerError({...t,time:'24:99'},[{type:'ai_daily_summary'}]),/horário/);
 assert.equal(groupTriggerError({...t,recipient:{kind:'group',group_id:rid}},[{type:'ai_daily_summary'}]),null);
});
test('silence detection requires correct side, duration and activation time',()=>{
 const now=new Date('2026-11-09T15:00:00.000Z');
 const last={sender_type:'agent',is_bot:false,is_internal:false,created_at:new Date('2026-11-09T13:00:00.000Z')};
 const trigger={type:'group_no_reply',group_id:gid,waiting_for:'group',timeout_minutes:60};
 assert.equal(awaitingSide(last),'group');
 assert.equal(eligibleGroupSilence({last,trigger,updatedAt:new Date('2026-11-09T12:00:00.000Z'),now}),true);
 assert.equal(eligibleGroupSilence({last,trigger:{...trigger,waiting_for:'us'},updatedAt:new Date('2026-11-09T12:00:00.000Z'),now}),false);
 assert.equal(eligibleGroupSilence({last:{...last,is_bot:true},trigger,updatedAt:new Date('2026-11-09T12:00:00.000Z'),now}),false);
 assert.equal(eligibleGroupSilence({last,trigger,updatedAt:new Date('2026-11-09T14:00:00.000Z'),now}),true);
 assert.equal(eligibleGroupSilence({last,trigger,updatedAt:new Date('2026-11-09T14:30:00.000Z'),now}),false);
 assert.equal(eligibleGroupSilence({last,trigger:{...trigger,timeout_minutes:200},updatedAt:new Date('2026-11-09T12:00:00.000Z'),now}),false);
});
test('zoned day uses Sao Paulo date and local clock',()=>{
 assert.deepEqual(zonedDay(new Date('2026-11-10T01:30:00.000Z')),{day:'2026-11-09',clock:'22:30'});
});
test('group-only participants are not imported into personal contacts',()=>{
 assert.equal(isSavedPersonalContact({remoteJid:'5511999990000@s.whatsapp.net',pushName:'Membro',isSaved:false}),false);
 assert.equal(isSavedPersonalContact({remoteJid:'5511999990000@s.whatsapp.net',pushName:'Membro'}),false);
 assert.equal(isSavedPersonalContact({remoteJid:'5511999990000@s.whatsapp.net',name:'Cliente',isSaved:true}),true);
 assert.equal(isSavedPersonalContact({remoteJid:'5511999990000@s.whatsapp.net',name:'Cliente'}),true);
 assert.equal(isSavedPersonalContact({remoteJid:'123456@g.us',name:'Grupo',isGroup:true}),false);
});

test('multi-group summaries preserve legacy and require unique authorized-looking IDs',()=>{
 const t={type:'group_daily_summary',group_ids:[gid,rid],time:'17:00',recipient:{kind:'contact',contact_id:rid,integration_id:iid}};
 assert.equal(groupTriggerError(t,[{type:'ai_daily_summary'}]),null);
 assert.deepEqual(summaryGroupIds(t),[gid,rid]);
 assert.deepEqual(summaryGroupIds({...t,group_ids:undefined,group_id:gid}),[gid]);
 assert.match(groupTriggerError({...t,group_ids:[gid,gid]},[{type:'ai_daily_summary'}]),/duplicatas/);
 assert.match(groupTriggerError({...t,group_ids:[]},[{type:'ai_daily_summary'}]),/Selecione/);
});
test('edits create retry key for failures; completed send suppresses duplicates',()=>{
 const rule={updated_at:new Date('2026-11-09T18:00:00Z')};
 const key=summaryExecutionKey(rule,'2026-11-09',gid);
 assert.notEqual(key,summaryExecutionKey({...rule,updated_at:new Date('2026-11-09T18:01:00Z')},'2026-11-09',gid));
 assert.notEqual(key,summaryExecutionKey(rule,'2026-11-09',rid));
 assert.equal(summaryAlreadyDelivered([{status:'failed',execution_key:key,details:{group_id:gid}}],gid,'daily:2026-11-09'),false);
 assert.equal(summaryAlreadyDelivered([{status:'completed',execution_key:key,details:{group_id:gid}}],gid,'daily:2026-11-09'),true);
 assert.equal(summaryAlreadyDelivered([{status:'completed',execution_key:key,details:{group_id:gid}}],rid,'daily:2026-11-09'),false);
});
