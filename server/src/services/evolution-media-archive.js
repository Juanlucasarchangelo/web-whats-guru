import { randomUUID } from 'node:crypto';
import { prisma } from '../db.js';
import { loadEvolution, fetchEvolutionMedia } from './evolution.js';
import { saveMedia } from './nas-storage.js';

const recordedStorageFaults = new Map();
const NAS_ERRORS = new Set(['ENOENT','EACCES','EPERM','ENOSPC','EROFS','ETIMEDOUT','EHOSTUNREACH','ENOTCONN','ECONNRESET','EIO','EBUSY']);
async function auditStorageFailure({ orgId, integrationId, error }) {
  if (!NAS_ERRORS.has(error?.code)) return;
  const key = `${orgId}:${integrationId}`;
  const now = Date.now();
  if ((recordedStorageFaults.get(key) || 0) + 10 * 60_000 > now) return;
  recordedStorageFaults.set(key, now);
  try { await prisma.auditLog.create({ data: { id: randomUUID(), org_id: orgId, user_id: null,
    action: 'nas.media_archive_unavailable', entity_type: 'integration', entity_id: integrationId,
    details: { code: error.code, message: 'NAS indisponível para arquivamento; mensagem preservada no banco.' } } }); }
  catch (auditError) { console.warn('[NAS] Não foi possível registrar auditoria:', auditError?.message); }
}

export { originalMediaFilename } from './evolution-media-file-policy.js';
import { originalMediaFilename } from './evolution-media-file-policy.js';

function messageFolderDate(value) {
  const parts = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo',
    day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(value)).split('/');
  return parts.join('-');
}

export async function archiveEvolutionMedia({ orgId, conversation, message, bytes }) {
  if (!process.env.FALACOMIGO_STORAGE_PATH || message?.media_type === 'location') return null;
  if (message?.media_message?.nas_path) return message.media_message.nas_path;
  const api = await loadEvolution(orgId, conversation.integration_id);
  if (!api) throw new Error('Instância Evolution indisponível.');
  const group = await prisma.whatsAppGroup.findFirst({ where: { org_id: orgId,
    conversation_id: conversation.id, integration_id: conversation.integration_id } });
  let contactFolder;
  if (group) {
    contactFolder = `${messageFolderDate(message.created_at)} - ${group.subject}`;
  } else {
    const contact = await prisma.contact.findFirst({ where: { id: conversation.contact_id, org_id: orgId },
      select: { phone: true, name: true } });
    const phone = String(contact?.phone || '').replace(/\D/g, '') || conversation.contact_id;
    contactFolder = contact?.name ? `${phone} - ${contact.name}` : phone;
  }
  let saved;
  try {
    saved = await saveMedia({ instance: String(api.integration?.name || api.instance),
      contact: contactFolder, groupId: group?.jid || null, filename: originalMediaFilename(message), buffer: bytes });
  } catch (error) {
    await auditStorageFailure({ orgId, integrationId: conversation.integration_id, error });
    throw error;
  }
  const updated = await prisma.message.updateMany({ where: { id: message.id, org_id: orgId,
    conversation_id: conversation.id }, data: { media_message: { ...message.media_message, nas_path: saved.relativePath } } });
  if (!updated.count) throw new Error('Mensagem não localizada após salvar a mídia.');
  console.info('[NAS] Arquivo guardado:', { messageId: message.id, group: Boolean(group), filename: saved.filename });
  return saved.relativePath;
}

const pending = [];
const pendingKeys = new Set();
let active = 0;
const MAX_PENDING = 10000;
const CONCURRENCY = 2;
function pump() {
  while (active < CONCURRENCY && pending.length) {
    const job = pending.shift();
    active++;
    void (async () => {
      const msg = await prisma.message.findFirst({ where: { id: job.messageId, org_id: job.orgId } });
      if (!msg?.media_message || msg.media_message.nas_path || !msg.media_type || msg.media_type === 'location') return;
      const conversation = await prisma.conversation.findFirst({ where: { id: msg.conversation_id,
        org_id: job.orgId, integration_id: job.integrationId } });
      if (!conversation) return;
      const bytes = await fetchEvolutionMedia({ orgId: job.orgId, integrationId: job.integrationId,
        mediaMessage: msg.media_message });
      await archiveEvolutionMedia({ orgId: job.orgId, conversation, message: msg, bytes });
    })().catch(error => console.warn('[NAS] Mídia de grupo não arquivada:', {
      messageId: job.messageId, code: error?.code || 'MEDIA_UNAVAILABLE', reason: String(error?.message || '').slice(0, 120),
    })).finally(() => { pendingKeys.delete(job.messageId); active--; pump(); });
  }
}

/** Does not block the webhook/history import. No local-storage fallback if NAS fails. */
export function queueGroupMediaArchive({ orgId, integrationId, messageId }) {
  if (!process.env.FALACOMIGO_STORAGE_PATH || pendingKeys.has(messageId)) return false;
  if (pending.length >= MAX_PENDING) {
    console.warn('[NAS] Fila de mídias de grupos cheia; retente a sincronização do histórico.');
    return false;
  }
  pendingKeys.add(messageId);
  pending.push({ orgId, integrationId, messageId });
  pump();
  return true;
}

/** Retry missing group attachments even when all group messages are duplicates.
 * Fetches only messages in the authorized group conversation and current 3-month
 * window. It does not modify existing paths/files and never falls back to local
 * disk when the configured NAS is unavailable.
 */
export async function requeueGroupMediaArchive({ orgId, integrationId, conversationId, cutoff }) {
  if (!process.env.FALACOMIGO_STORAGE_PATH) return { queued: 0, incomplete: false };
  const pageSize = 250;
  const maxChecked = 30000;
  let checked = 0;
  let cursor;
  let queued = 0;
  let incomplete = false;
  const types = ['image', 'video', 'audio', 'document', 'sticker'];
  while (checked < maxChecked) {
    const rows = await prisma.message.findMany({
      where: { org_id: orgId, conversation_id: conversationId,
        media_type: { in: types }, created_at: { gte: cutoff } },
      orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
      take: Math.min(pageSize, maxChecked - checked),
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: { id: true, media_message: true },
    });
    if (!rows.length) break;
    checked += rows.length;
    cursor = rows.at(-1).id;
    for (const item of rows) {
      if (!item.media_message || item.media_message.nas_path) continue;
      if (queueGroupMediaArchive({ orgId, integrationId, messageId: item.id })) queued++;
      else if (!pendingKeys.has(item.id)) incomplete = true;
    }
    if (rows.length < pageSize) break;
  }
  if (checked >= maxChecked) incomplete = true;
  return { queued, incomplete };
}
