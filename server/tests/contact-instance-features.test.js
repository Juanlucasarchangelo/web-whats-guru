import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ALL_KEYS, SYSTEM_ROLES } from '../src/services/permissions.js';
import { recordsFrom, contactIdentity } from '../src/services/evolution-sync-policy.js';
const read=(p)=>readFileSync(new URL(p, import.meta.url),'utf8');

test('Permissão de remoção está no RBAC e restrita por padrão aos gestores',()=>{
 assert.ok(ALL_KEYS.includes('channels.delete'));
 for(const r of SYSTEM_ROLES) assert.equal(r.permissions.includes('channels.delete'),['master','administrador'].includes(r.slug));
});
test('Contato da Evolution não depende do limite de 100',()=>{
 const records=Array.from({length:4900},(_,i)=>({remoteJid:`55119${String(i).padStart(8,'0')}@s.whatsapp.net`,pushName:`Pessoa ${i}`}));
 assert.equal(recordsFrom(records,'contacts').records.length,4900);
 assert.equal(contactIdentity(records[4899]).name,'Pessoa 4899');
});
test('Sincronização registra contato por instância e preserva origem',()=>{
 const sync=read('../src/services/evolution-sync.js');
 const schema=read('../prisma/schema.prisma');
 assert.match(sync,/contactIntegration\.upsert/);
 assert.match(schema,/model ContactIntegration/);
 assert.match(sync,/readAll\(api, 'findContacts'/);
});
test('Exclusão exige permissão, auditoria e não apaga mensagens',()=>{
 const route=read('../src/routes/channels.js');
 assert.match(route,/can\(req,'channels\.delete'\)/);
 assert.match(route,/whatsapp\.instance_removed/);
 assert.doesNotMatch(route,/tx\.message\.deleteMany/);
 assert.match(route,/tx\.integration\.delete/);
});
test('Busca de contatos é paginada no servidor e lista Kanban ordenada',()=>{
 const contacts=read('../src/routes/contacts.js');
 const crm=read('../../src/pages/CrmPage.tsx');
 assert.match(contacts,/skip: \(page - 1\) \* limit/);
 assert.match(contacts,/contact_integrations/);
 assert.match(crm,/a\.name\.localeCompare\(b\.name,'pt-BR'/);
 assert.match(crm,/Separar por instância/);
});
