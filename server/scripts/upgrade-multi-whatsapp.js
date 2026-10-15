/** Run ONCE after backing up MySQL: node scripts/upgrade-multi-whatsapp.js */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
try {
  const db = await prisma.$queryRawUnsafe('SELECT DATABASE() AS name');
  if (!db?.[0]?.name) throw Error('Sem DATABASE() selecionado. Confira DATABASE_URL.');
  console.log('Banco selecionado:', db[0].name);
  const cols = await prisma.$queryRawUnsafe("SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='conversations' AND COLUMN_NAME='integration_id'");
  if (!cols.length) {
    await prisma.$executeRawUnsafe('ALTER TABLE conversations ADD COLUMN integration_id CHAR(36) NULL AFTER channel');
    console.log('OK: conversations.integration_id criado.');
  }
  const indexes = await prisma.$queryRawUnsafe("SELECT INDEX_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='integrations'");
  const names = new Set(indexes.map(x=>x.INDEX_NAME));
  // Create a replacement index FIRST. MySQL may use the old unique index
  // to enforce a foreign key on integrations.org_id.
  if (!names.has('idx_integrations_org_type')) {
    await prisma.$executeRawUnsafe('ALTER TABLE integrations ADD INDEX idx_integrations_org_type (org_id,type)');
    console.log('OK: indice substituto de integracoes criado.');
  }
  if (names.has('uq_integrations_org_type')) {
    await prisma.$executeRawUnsafe('ALTER TABLE integrations DROP INDEX uq_integrations_org_type');
    console.log('OK: removida a restricao de uma integracao por tipo.');
  }
  const convIdx = await prisma.$queryRawUnsafe("SELECT INDEX_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='conversations' AND INDEX_NAME='idx_conversations_integration'");
  if (!convIdx.length) {
    await prisma.$executeRawUnsafe('ALTER TABLE conversations ADD INDEX idx_conversations_integration (org_id,integration_id)');
    console.log('OK: indice de conversas criado.');
  }
  // Preserve original conversations with the first created integration in each organization.
  // UUID lexical ordering does NOT imply insertion date: avoid MIN(id).
  const original = await prisma.$queryRawUnsafe(`SELECT id,org_id FROM integrations WHERE type='whatsapp' ORDER BY created_at ASC,id ASC`);
  const first = new Map();
  for (const row of original) if (!first.has(row.org_id)) first.set(row.org_id,row.id);
  let total = 0;
  for (const [orgId, integrationId] of first) {
    total += await prisma.$executeRaw`UPDATE conversations SET integration_id=${integrationId} WHERE org_id=${orgId} AND channel='whatsapp' AND integration_id IS NULL`;
  }
  const without = await prisma.$queryRawUnsafe("SELECT COUNT(*) AS total FROM conversations WHERE channel='whatsapp' AND integration_id IS NULL");
  console.log(`OK: ${total} conversa(s) antiga(s) vinculada(s) ao WhatsApp original.`);
  if (Number(without[0]?.total) > 0) console.warn(`ATENCAO: ${without[0].total} conversa(s) sem integracao original identificada. Revise antes de criar outros numeros.`);
  console.log('Atualizacao finalizada. Rode agora: npx prisma generate');
} catch(err) {
  console.error('FALHA NA ATUALIZACAO:', err.message);
  process.exitCode=1;
} finally { await prisma.$disconnect(); }
