import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const root=new URL('../',import.meta.url);
const get=path=>readFileSync(new URL(path,root),'utf8');

test('empresas nao dependem de um usuario proprietario',()=>{
  const schema=get('prisma/schema.prisma');
  assert.match(schema,/model Organization \{/);
  assert.doesNotMatch(schema,/owner_id\s+String/);
  assert.match(schema,/model OrgMember \{/);
  const migration=get('prisma/migrations/20261104_company_independence_permanent_user_delete/migration.sql');
  assert.match(migration,/DROP COLUMN `owner_id`/);
});

test('exclusao definitiva preserva registros historicos vinculados ao usuario',()=>{
  const migration=get('prisma/migrations/20261104_company_independence_permanent_user_delete/migration.sql');
  for(const column of ['author_id','created_by','uploaded_by']) assert.match(migration,new RegExp('MODIFY COLUMN `'+column+'` CHAR\\(36\\) NULL'));
  assert.match(migration,/ON DELETE SET NULL/);
  const source=get('src/routes/dev.js');
  assert.match(source,/router.delete\('\/users\/:id\/permanent'/);
  assert.match(source,/tx\.user\.delete/);
  assert.doesNotMatch(source,/tx\.organization\.delete/);
});

test('cadastro usa empresa existente e requer aprovacao DEV',()=>{
  const source=get('src/routes/auth.js');
  assert.match(source,/public-organizations/);
  assert.match(source,/org_id:z\.string\(\)\.uuid\(\)/);
  assert.match(source,/status:'active'/);
  assert.match(source,/approval_status:'pending'/);
  const dev=get('src/routes/dev.js');
  assert.match(dev,/router.post\('\/organizations'/);
  assert.match(dev,/role:z\.enum\(\['administrador','master'\]\)\.default\('administrador'\)/);
});
