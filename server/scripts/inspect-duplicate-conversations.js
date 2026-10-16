/**
 * READ-ONLY report. Does NOT change, hide, merge or delete conversations.
 * Run from server/: node scripts/inspect-duplicate-conversations.js
 */
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
const normPhone = value => String(value || '').replace(/\D/g, '');
try {
  const conversations = await prisma.conversation.findMany({
    where: { channel: 'whatsapp' },
    select: { id: true, org_id: true, contact_id: true, integration_id: true,
      status: true, created_at: true, last_message_at: true },
    orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
  });
  const grouped = new Map();
  for (const c of conversations) {
    const key = JSON.stringify([c.org_id, c.contact_id, c.integration_id]);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(c);
  }
  const repeated = [...grouped.values()].filter(rows => rows.length > 1);
  console.log(`Conversas WhatsApp verificadas: ${conversations.length}`);
  console.log(`Grupos duplicados (mesmo contato + mesmo numero): ${repeated.length}`);
  for (const rows of repeated) {
    console.log(`\nOrganizacao: ${rows[0].org_id} | Contato: ${rows[0].contact_id} | Instancia: ${rows[0].integration_id ?? '(antiga/sem vinculo)'}`);
    for (const r of rows) console.log(`  ${r.id} | ${r.status} | criado ${r.created_at.toISOString()} | ultimo ${r.last_message_at.toISOString()}`);
  }
  // Different contact IDs can still share the same normalized telephone number.
  const contactIds = [...new Set(conversations.map(c => c.contact_id))];
  const contacts = await prisma.contact.findMany({
    where: { id: { in: contactIds } }, select: { id: true, org_id: true, phone: true },
  });
  const contactMap = new Map(contacts.map(c => [c.id, c]));
  const byPhone = new Map();
  for (const c of conversations) {
    const phone = normPhone(contactMap.get(c.contact_id)?.phone);
    if (!phone) continue;
    const key = JSON.stringify([c.org_id, phone, c.integration_id]);
    if (!byPhone.has(key)) byPhone.set(key, new Set());
    byPhone.get(key).add(c.contact_id);
  }
  const duplicateContactGroups = [...byPhone.values()].filter(ids => ids.size > 1);
  console.log(`\nGrupos com IDs de contato diferentes mas mesmo telefone/instancia: ${duplicateContactGroups.length}`);
  console.log('Relatorio somente leitura. Nenhuma alteracao foi feita.');
} catch (error) {
  console.error('Nao foi possivel verificar duplicatas:', error.message);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
