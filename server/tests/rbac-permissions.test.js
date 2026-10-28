import test from 'node:test';
import assert from 'node:assert/strict';
import {ALL_KEYS,PERMISSIONS,RESERVED,NORMAL_KEYS,SYSTEM_ROLES,can,normalizeRole,requirePermission} from '../src/services/permissions.js';
const role = slug => SYSTEM_ROLES.find(r=>r.slug===slug);
test('Cinco perfis predefinidos e permissões sem duplicidades',()=>{
 assert.deepEqual(SYSTEM_ROLES.map(r=>r.slug),['master','administrador','comercial','supervisor','tecnico']);
 assert.equal(new Set(ALL_KEYS).size,PERMISSIONS.length);
 for(const item of SYSTEM_ROLES) assert.equal(new Set(item.permissions).size,item.permissions.length);
});
test('Master e o unico com privilegios de criar outros Masters e editar cargos',()=>{
 for(const roleDef of SYSTEM_ROLES){
  for(const key of RESERVED) assert.equal(roleDef.permissions.includes(key),roleDef.slug==='master');
 }
 assert.deepEqual(role('master').permissions,ALL_KEYS);
 assert.deepEqual(role('administrador').permissions,NORMAL_KEYS);
});
test('Supervisor so ve relatorios e area tecnica; Tecnico so relatorio tecnico',()=>{
 assert.deepEqual(role('supervisor').permissions,['page.reports','page.technicalOdd','page.technicalReport']);
 assert.deepEqual(role('tecnico').permissions,['page.technicalReport']);
 assert.ok(!role('comercial').permissions.includes('team.members.manage'));
 assert.ok(role('comercial').permissions.includes('page.inbox'));
});
test('Mapeamento seguro dos cargos antigos, somente para compatibilidade',()=>{
 assert.equal(normalizeRole('owner'),'master');assert.equal(normalizeRole('admin'),'administrador');assert.equal(normalizeRole('agent'),'comercial');assert.equal(normalizeRole('tecnico'),'tecnico');
});
test('Proteção de rota usa permissao do contexto, nao nome de cargo',()=>{
 const req={role:'tecnico',permissions:role('tecnico').permissions};
 assert.equal(can(req,'page.dashboard'),false);
 assert.equal(can(req,'page.technicalReport'),true);
 let status=null;const res={status(code){status=code;return this},json(){return this}};
 requirePermission('page.dashboard')(req,res,()=>{throw new Error('Nao deveria executar');});
 assert.equal(status,403);
});
