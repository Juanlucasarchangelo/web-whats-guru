/** Dependency-free unit tests for workflow logic (without touching MySQL / Evolution). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import { randomUUID } from 'node:crypto';

const source = readFileSync(new URL('../src/services/workflow-engine.js', import.meta.url), 'utf8')
  .replace(/^import .*;\s*$/gm, '').replace(/^export /gm, '');
function harness(automations = [], bots = []) {
  const contact = { id: 'contact1', name: 'Maria', phone: '+5541999999999', custom_fields: {} };
  const conversation = { id: 'conversation1', contact_id: 'contact1', status: 'open', channel: 'whatsapp', last_message_at: new Date() };
  const logs = []; const sent = []; const updated = [];
  const prisma = {
    conversation: {
      findFirst: async () => conversation,
      update: async ({ data }) => Object.assign(conversation, data),
    },
    contact: {
      findFirst: async () => contact,
      update: async ({ data }) => { Object.assign(contact, data); return contact; },
    },
    automation: { findMany: async () => automations },
    chatbot: { findMany: async ({ where }) => where?.id ? bots.filter(b => b.id === where.id && b.status === where.status) : bots, findFirst: async ({ where }) => bots.find(b => b.id === where.id && b.status === where.status) },
    webhookEvent: {
      create: async ({ data }) => { logs.push(data); return data; },
      findFirst: async ({ where }) => logs.find(e => e.event_type === where.event_type && e.processed),
    },
    message: { update: async data => { updated.push(data); } },
  };
  const sandbox = { prisma, randomUUID, sendEvolutionText: async ({ text }) => { sent.push(text); return { id: String(sent.length) }; },
    console, Date, Intl, process: { env: {} }, fetch, AbortSignal, URL, Map, Promise, Number, String, Object, Math, Array, Error, Boolean, RegExp };
  createContext(sandbox);
  runInContext(source + '\nthis.workflows = { matchesKeyword, outsideHours, processIncomingWorkflows };', sandbox);
  return { ...sandbox.workflows, logs, sent, contact, conversation, updated };
}
test('case insensitive keyword matching and no empty wildcard', () => {
  const w = harness();
  assert.equal(w.matchesKeyword('Preciso de ORÇAMENTO', 'orçamento'), true);
  assert.equal(w.matchesKeyword('Ola', ''), false);
  assert.equal(w.matchesKeyword('Ola', 'ajuda'), false);
});
test('outside-business-hours supports windows crossing midnight', () => {
  const w = harness();
  assert.equal(w.outsideHours(new Date('2026-10-15T23:00:00-03:00'), '18:00-08:00'), true);
  assert.equal(w.outsideHours(new Date('2026-10-15T12:00:00-03:00'), '18:00-08:00'), false);
  assert.equal(w.outsideHours(new Date('2026-10-15T07:59:00-03:00'), '18:00-08:00'), true);
});
test('keyword automation sends through Evolution and records a successful run', async () => {
  const auto = [{id:'auto1',status:'active',trigger:{type:'keyword',keyword:'preço'},actions:[{type:'send_message',text:'Olá {{nome}}, vou verificar o preço.'}]}];
  const w = harness(auto);
  await w.processIncomingWorkflows({orgId:'org1',conversationId:'conversation1',text:'Tem PREÇO?',isNew:false,messageId:'msg1'});
  assert.deepEqual(w.sent,['Olá Maria, vou verificar o preço.']);
  assert.equal(w.updated[0].data.is_bot, true);
  assert.ok(w.logs.find(log => log.event_type === 'automation:auto1:msg1' && log.processed));
  await w.processIncomingWorkflows({orgId:'org1',conversationId:'conversation1',text:'Tem PREÇO?',isNew:false,messageId:'msg1'});
  assert.equal(w.sent.length, 1);
});
test('multi-step chatbot asks question and resumes after answer', async () => {
  const bot = {id:'bot1',status:'active',trigger_keyword:'iniciar',trigger_channel:'whatsapp',flow:{nodes:[
    {id:'start',type:'start',data:{}},
    {id:'n1',type:'message',data:{text:'Olá {{nome}}'}},
    {id:'n2',type:'question',data:{text:'Escolha:',options:['Vendas','Suporte']}},
    {id:'n3',type:'message',data:{text:'Sua escolha: {{resposta}}'}},
  ],edges:[{from:'start',to:'n1'},{from:'n1',to:'n2'},{from:'n2',to:'n3'}]}};
  const w=harness([], [bot]);
  await w.processIncomingWorkflows({orgId:'org1',conversationId:'conversation1',text:'iniciar',isNew:false,messageId:'msg1'});
  assert.deepEqual(w.sent,['Olá Maria','Escolha:\n1. Vendas\n2. Suporte']);
  assert.equal(w.contact.custom_fields._whats_guru_chatbot_v1.waiting_for,'n2');
  await w.processIncomingWorkflows({orgId:'org1',conversationId:'conversation1',text:'2',isNew:false,messageId:'msg2'});
  assert.equal(w.sent[2],'Sua escolha: Suporte');
  assert.equal(w.contact.custom_fields._whats_guru_chatbot_v1,undefined);
});
test('new conversation trigger does not fire on ordinary replies', async () => {
  const auto = [{id:'autoNew',status:'active',trigger:{type:'new_conversation'},actions:[{type:'send_message',text:'Bem-vindo!'}]}];
  const w = harness(auto);
  await w.processIncomingWorkflows({orgId:'org1',conversationId:'conversation1',text:'Olá',isNew:false,messageId:'m0'});
  assert.equal(w.sent.length, 0);
  await w.processIncomingWorkflows({orgId:'org1',conversationId:'conversation1',text:'Olá',isNew:true,messageId:'m1'});
  assert.deepEqual(w.sent,['Bem-vindo!']);
});
test('chatbot rejects invalid menu choice and never jumps to next node', async () => {
  const bot = {id:'bot2',status:'active',trigger_keyword:'menu',trigger_channel:'whatsapp',flow:{nodes:[
    {id:'start',type:'start',data:{}},
    {id:'q',type:'question',data:{text:'Menu',options:['Financeiro','Comercial']}},
    {id:'done',type:'message',data:{text:'Ok {{resposta}}'}},
  ],edges:[{from:'start',to:'q'},{from:'q',to:'done'}]}};
  const w = harness([], [bot]);
  await w.processIncomingWorkflows({orgId:'org1',conversationId:'conversation1',text:'menu',isNew:false,messageId:'m1'});
  await w.processIncomingWorkflows({orgId:'org1',conversationId:'conversation1',text:'45',isNew:false,messageId:'m2'});
  assert.equal(w.sent.length, 2);
  assert.ok(w.sent[1].includes('escolha uma opcao'));
  await w.processIncomingWorkflows({orgId:'org1',conversationId:'conversation1',text:'2',isNew:false,messageId:'m3'});
  assert.equal(w.sent[2], 'Ok Comercial');
});
test('unconfigured rule does not fake a successful send', async () => {
  const auto=[{id:'autoBad',status:'active',trigger:{type:'keyword',keyword:'ajuda'},actions:[{type:'send_message',text:''}]}];
  const w=harness(auto);
  await w.processIncomingWorkflows({orgId:'org1',conversationId:'conversation1',text:'ajuda',isNew:false,messageId:'m1'});
  assert.equal(w.sent.length,0);
  assert.ok(w.logs.find(log=>log.event_type==='automation:autoBad:m1' && !log.processed));
});
