import test from 'node:test';
import assert from 'node:assert/strict';
import {ALL_KEYS,PERMISSIONS,RESERVED,NORMAL_KEYS,SYSTEM_ROLES,can,normalizeRole,requirePermission,isMaster} from '../src/services/permissions.js';
const role=slug=>SYSTEM_ROLES.find(r=>r.slug===slug);

test('Cinco perfis de empresa existentes permanecem e DEV e global',()=>{
  assert.deepEqual(SYSTEM_ROLES.map(r=>r.slug),['master','administrador','comercial','supervisor','tecnico']);
  assert.equal(new Set(PERMISSIONS.map(p=>p.key)).size,PERMISSIONS.length);
  assert.equal(new Set(ALL_KEYS).size,ALL_KEYS.length);
  assert.equal(PERMISSIONS.length,ALL_KEYS.length+1);
  for(const item of SYSTEM_ROLES)assert.equal(new Set(item.permissions).size,item.permissions.length);
  for(const item of SYSTEM_ROLES)assert.ok(!item.permissions.includes('page.devConsole'));
  assert.equal(RESERVED.has('page.devConsole'),true);
});
test('Master mantem privilegios de empresa sem privilegio global DEV',()=>{
  for(const r of SYSTEM_ROLES){
    for(const key of ['roles.manage','members.assign_master'])assert.equal(r.permissions.includes(key),r.slug==='master');
  }
  assert.deepEqual(role('master').permissions,ALL_KEYS);
  assert.deepEqual(role('administrador').permissions,NORMAL_KEYS.filter(p=>!['page.monitoring','page.instagramCrm'].includes(p)));
  assert.equal(role('master').permissions.includes('page.monitoring'),true);
  for(const item of SYSTEM_ROLES.filter(r=>r.slug!=='master'))assert.equal(item.permissions.includes('page.monitoring'),false);
});
test('Supervisor e tecnico preservam permissoes',()=>{
  assert.deepEqual(role('supervisor').permissions,['page.reports','page.technicalOdd','page.technicalReport']);
  assert.deepEqual(role('tecnico').permissions,['page.technicalReport']);
  assert.ok(!role('comercial').permissions.includes('team.members.manage'));
  assert.ok(role('comercial').permissions.includes('page.inbox'));
});
test('Cargos legados seguem normalizados',()=>{
  assert.equal(normalizeRole('owner'),'master');assert.equal(normalizeRole('admin'),'administrador');assert.equal(normalizeRole('agent'),'comercial');assert.equal(normalizeRole('tecnico'),'tecnico');
  assert.equal(isMaster({role:'dev'}),true);
  assert.equal(isMaster({role:'master'}),true);
  assert.equal(isMaster({role:'administrador'}),false);
});
test('Guardas verificam permissoes reais do contexto',()=>{
  const req={role:'tecnico',permissions:role('tecnico').permissions};
  assert.equal(can(req,'page.dashboard'),false);
  assert.equal(can(req,'page.technicalReport'),true);
  let status=null;const res={status(code){status=code;return this},json(){return this}};
  requirePermission('page.dashboard')(req,res,()=>{throw new Error('Nao deveria executar');});
  assert.equal(status,403);
});
