/**
 * Safely consolidate old WhatsApp threads with the same org, contact and integration.
 * Default: READ-ONLY. Requires --apply AND MERGE_CONFIRM_DATABASE after a full DB backup.
 * Run from server/: node scripts/merge-duplicate-conversations.js [--apply]
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const apply = process.argv.includes('--apply');
import { groupByIdentity, newestFirst, botStateUpdate } from './merge-conversation-policy.js';

async function inspectGroup(group) {
  group.sort(newestFirst);
  const [keeper, ...duplicates] = group;
  const sourceIds = duplicates.map(c => c.id);
  const [messageCount, noteCount, tagCount, contact] = await Promise.all([
    prisma.message.count({ where: { org_id: keeper.org_id, conversation_id: { in: sourceIds } } }),
    prisma.internalNote.count({ where: { org_id: keeper.org_id, conversation_id: { in: sourceIds } } }),
    prisma.conversationTag.count({ where: { conversation_id: { in: sourceIds } } }),
    prisma.contact.findFirst({ where: { id: keeper.contact_id, org_id: keeper.org_id }, select: { custom_fields: true } }),
  ]);
  const bot = botStateUpdate(contact?.custom_fields, keeper.id, sourceIds);
  return { keeper, duplicates, sourceIds, bot, messageCount, noteCount, tagCount };
}

async function mergeGroup(plan) {
  const { keeper, duplicates, sourceIds, bot } = plan;
  const unread = Math.min(2147483647, [keeper, ...duplicates].reduce((sum, c) => sum + Math.max(0, c.unread_count || 0), 0));
  // If a single old thread has a bot session, preserve it under the surviving ID.
  await prisma.$transaction(async tx => {
    // Verify that the exact same rows still exist before moving historical data.
    const current = await tx.conversation.findMany({
      where: { org_id: keeper.org_id, channel: 'whatsapp', contact_id: keeper.contact_id, integration_id: keeper.integration_id, id: { in: [keeper.id, ...sourceIds] } },
      select: { id: true },
    });
    if (current.length !== 1 + sourceIds.length) throw new Error('Conversas mudaram desde o diagnostico. Rode novamente.');
    await tx.message.updateMany({
      where: { org_id: keeper.org_id, conversation_id: { in: sourceIds } },
      data: { conversation_id: keeper.id },
    });
    await tx.internalNote.updateMany({
      where: { org_id: keeper.org_id, conversation_id: { in: sourceIds } },
      data: { conversation_id: keeper.id },
    });
    const oldTags = await tx.conversationTag.findMany({ where: { conversation_id: { in: sourceIds } }, select: { tag_id: true } });
    if (oldTags.length) {
      await tx.conversationTag.createMany({
        data: [...new Set(oldTags.map(t => t.tag_id))].map(tag_id => ({ conversation_id: keeper.id, tag_id })),
        skipDuplicates: true,
      });
    }
    await tx.conversationTag.deleteMany({ where: { conversation_id: { in: sourceIds } } });
    if (bot.moved) {
      await tx.contact.update({ where: { id: keeper.contact_id }, data: { custom_fields: bot.fields } });
    }
    await tx.conversation.update({ where: { id: keeper.id }, data: { unread_count: unread } });
    const deleted = await tx.conversation.deleteMany({
      where: { org_id: keeper.org_id, channel: 'whatsapp', contact_id: keeper.contact_id, integration_id: keeper.integration_id, id: { in: sourceIds } },
    });
    if (deleted.count !== sourceIds.length) throw new Error('Nem todas as duplicatas foram consolidadas. Transacao revertida.');
  }, { timeout: 60000, maxWait: 15000 });
}

async function main() {
  const dbName = databaseName();
  console.log(`Banco: ${dbName}`);
  if (apply && process.env.MERGE_CONFIRM_DATABASE !== dbName) {
    throw new Error(`Para aplicar, faca BACKUP COMPLETO, pare o backend e configure MERGE_CONFIRM_DATABASE=${dbName}.`);
  }
  const rows = await prisma.conversation.findMany({
    where: { channel: 'whatsapp' },
    select: { id: true, org_id: true, contact_id: true, integration_id: true, channel: true,
      unread_count: true, status: true, created_at: true, last_message_at: true },
  });
  const groups = groupByIdentity(rows);
  // Cross-contact duplicates are not auto-merged; they require a separate
  // identity review (two different contact records can share a phone).
  const contacts = await prisma.contact.findMany({ where: { id: { in: [...new Set(rows.map(r => r.contact_id))] } }, select: { id: true, phone: true } });
  const phones = new Map(contacts.map(c => [c.id, String(c.phone || '').replace(/\D/g, '')]));
  const crossContacts = new Map();
  for (const c of rows) {
    const phone = phones.get(c.contact_id);
    if (!phone) continue;
    const key = JSON.stringify([c.org_id, c.integration_id, phone]);
    if (!crossContacts.has(key)) crossContacts.set(key, new Set());
    crossContacts.get(key).add(c.contact_id);
  }
  const sharedPhoneGroups = [...crossContacts.values()].filter(ids => ids.size > 1).length;
  console.log(`Numeros iguais em cadastros de contatos DIFERENTES: ${sharedPhoneGroups} grupo(s). Esses nao sao mesclados automaticamente.`);
  const integrations = await prisma.integration.findMany({ where: { type: 'whatsapp' }, select: { org_id: true, id: true } });
  const numberCount = new Map();
  for (const i of integrations) numberCount.set(i.org_id, (numberCount.get(i.org_id) || 0) + 1);

  console.log(`Conversas examinadas: ${rows.length} | Grupos com duplicatas: ${groups.length}`);
  let processed = 0; let skipped = 0;
  for (const group of groups) {
    if (group[0].integration_id == null && (numberCount.get(group[0].org_id) || 0) > 1) {
      console.log(`Grupo legado sem integracao — contato ${group[0].contact_id} IGNORADO por seguranca: ha multiplos WhatsApps cadastrados.`);
      skipped++;
      continue;
    }
    const plan = await inspectGroup(group);
    console.log(`Org ${plan.keeper.org_id} | contato ${plan.keeper.contact_id} | integracao ${plan.keeper.integration_id || '(legado)'}`);
    console.log(`  Manter: ${plan.keeper.id} | juntar ${plan.sourceIds.length} | mensagens ${plan.messageCount} | notas ${plan.noteCount} | etiquetas ${plan.tagCount}`);
    if (plan.bot.conflict) {
      console.log('  IGNORADO: multiplas sessoes de chatbot diferentes. Requer avaliacao manual.');
      skipped++;
      continue;
    }
    if (apply) {
      try { await mergeGroup(plan); processed++; console.log('  Consolidado com sucesso.'); }
      catch (error) { skipped++; console.error(`  FALHA (grupo revertido): ${error.message}`); }
    }
  }
  console.log(apply
    ? `Fim: ${processed} grupos consolidados, ${skipped} ignorados. Rode novamente sem --apply para conferir.`
    : `Modo leitura. Nenhuma alteracao realizada. ${skipped} grupo(s) exigem revisao manual.`);
  if (!apply && groups.length) console.log('Para aplicar: BACKUP COMPLETO, parar o backend, definir MERGE_CONFIRM_DATABASE e usar --apply.');
  if (apply && skipped) process.exitCode = 1;
}

try { await main(); }
catch (error) { console.error('Nao foi possivel executar consolidacao:', error.message); process.exitCode = 1; }
finally { await prisma.$disconnect(); }
