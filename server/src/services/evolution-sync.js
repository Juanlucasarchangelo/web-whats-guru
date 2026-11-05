import { randomUUID } from 'node:crypto';
import { prisma } from '../db.js';
import { loadEvolution, evolutionGet, syncEvolutionConversation } from './evolution.js';
import { getOrCreateConversation, withConversationIdentityLock } from './conversation-thread.js';
import { CONTACT_PAGE_SIZE, MAX_CONTACT_PAGES, contactIdentity, isPlaceholderContactName,
  messageDate, recordsFrom } from './evolution-sync-policy.js';

const bootstrapJobs = new Map();
const historyJobs = new Map();
const connectionTimers = new Map();
const bootstrapPending = [];
const historyPending = [];
let bootstrapActive = 0;
let historyActive = 0;
const BOOTSTRAP_CONCURRENCY = 1;
const HISTORY_CONCURRENCY = 2;
const BOOTSTRAP_THROTTLE_MS = 5 * 60 * 1000;
const HISTORY_THROTTLE_MS = 5 * 60 * 1000;
const retentionMs = 24 * 60 * 60 * 1000;

function publicJob(state) {
  if (!state) return { status: 'not_started' };
  const { status, contacts, chats, scanned, pages, counts, cutoff, truncated, partial, error, updated_at } = state;
  return { status, contacts, chats, scanned, pages, counts, cutoff, truncated, partial, error, updated_at };
}
function pruneJobs(map) {
  const now = Date.now();
  for (const [key, job] of map) {
    if (job.status !== 'running' && now - job.finished_at > retentionMs) map.delete(key);
  }
}
function mark(job, values) {
  Object.assign(job, values, { updated_at: new Date().toISOString() });
}
function getJob(map, key) { pruneJobs(map); return publicJob(map.get(key)); }

/** Repeat once after the QR handshake, as Evolution may still be importing
 * its WhatsApp contacts/chats when CONNECTION_UPDATE=open first arrives. */
export function bootstrapOnEvolutionConnection({ orgId, integrationId }) {
  const key = `${orgId}:${integrationId}`;
  queueEvolutionBootstrap({ orgId, integrationId, force: true });
  if (connectionTimers.has(key)) return;
  const timer = setTimeout(() => {
    connectionTimers.delete(key);
    queueEvolutionBootstrap({ orgId, integrationId, force: true });
  }, 60000);
  timer.unref?.();
  connectionTimers.set(key, timer);
}

export function getEvolutionBootstrapStatus(orgId, integrationId) {
  return getJob(bootstrapJobs, `${orgId}:${integrationId}`);
}

async function storeContact({ orgId, phone, name, cache }) {
  return withConversationIdentityLock({ orgId, phone, integrationId: null }, async () => {
    let contact = cache.get(phone);
    if (!contact) contact = await prisma.contact.findFirst({
      where: { org_id: orgId, phone: { in: [`+${phone}`, phone] } },
      select: { id: true, name: true, phone: true },
    });
    if (!contact) contact = await prisma.contact.create({ data: { id: randomUUID(), org_id: orgId,
      name: name || `WhatsApp ${phone}`, phone: `+${phone}`, custom_fields: {} } });
    if (name && isPlaceholderContactName(contact.name, phone)) {
      contact = await prisma.contact.update({ where: { id: contact.id }, data: { name } });
    }
    cache.set(phone, contact);
    return contact;
  });
}

async function readAll(api, endpoint, kind, onRecord) {
  let count = 0;
  let skipped = 0;
  let complete = false;
  let previousFingerprint = null;
  for (let page = 1; page <= MAX_CONTACT_PAGES; page++) {
    const response = await evolutionGet(api, `/chat/${endpoint}/${encodeURIComponent(api.instance)}`,
      'POST', { where: {}, page, offset: CONTACT_PAGE_SIZE });
    const { records, pages } = recordsFrom(response, kind);
    const idFor = record => record?.remoteJid ?? record?.key?.remoteJid ??
      record?.lastMessage?.key?.remoteJid ?? record?.id;
    const fingerprint = records.length ? JSON.stringify([
      idFor(records[0]), idFor(records[records.length - 1]), records.length]) : null;
    if (page > 1 && fingerprint && fingerprint === previousFingerprint) break;
    previousFingerprint = fingerprint;
    for (const record of records) {
      if (await onRecord(record)) count++;
      else skipped++;
    }
    if (!records.length || (pages && page >= pages)) {
      complete = true; break;
    }
  }
  return { count, skipped, complete };
}

async function importContactsAndChats(orgId, integrationId, job) {
  const api = await loadEvolution(orgId, integrationId);
  if (!api) throw new Error('Instancia Evolution nao configurada.');
  const existing = await prisma.contact.findMany({ where: { org_id: orgId },
    select: { id: true, name: true, phone: true } });
  const cache = new Map(existing.filter(c => c.phone).map(c => [String(c.phone).replace(/\D/g, ''), c]));
  const contacts = await readAll(api, 'findContacts', 'contacts', async record => {
    const identity = contactIdentity(record);
    if (!identity) return false;
    await storeContact({ orgId, ...identity, cache });
    mark(job, { contacts: job.contacts + 1 });
    return true;
  });
  // The inbox contains only actual chats, not every address-book entry.
  const chats = await readAll(api, 'findChats', 'chats', async record => {
    const identity = contactIdentity(record);
    if (!identity) return false;
    const contact = await storeContact({ orgId, ...identity, cache });
    await withConversationIdentityLock({ orgId, integrationId, phone: identity.phone }, async () => {
      const { conversation, created } = await getOrCreateConversation(prisma, {
        orgId, contactId: contact.id, integrationId, channel: 'whatsapp',
      });
      if (created) {
        const lastMessageTime = messageDate(record?.lastMessage ?? record) ??
          (record?.conversationTimestamp ? messageDate({ messageTimestamp: record.conversationTimestamp }) : null);
        if (lastMessageTime) await prisma.conversation.update({ where: { id: conversation.id },
          data: { last_message_at: lastMessageTime } });
      }
    });
    mark(job, { chats: job.chats + 1 });
    return true;
  });
  return { contacts, chats };
}

function pumpBootstrap() {
  if (bootstrapActive >= BOOTSTRAP_CONCURRENCY) return;
  const task = bootstrapPending.shift();
  if (!task) return;
  bootstrapActive++;
  const { orgId, integrationId, job } = task;
  mark(job, { status: 'running' });
  void importContactsAndChats(orgId, integrationId, job)
    .then(result => {
      mark(job, { status: 'done', partial: !(result.contacts.complete && result.chats.complete) });
      console.info('[Evolution Bootstrap]', { integrationId, contacts: job.contacts, chats: job.chats,
        contacts_complete: result.contacts.complete, chats_complete: result.chats.complete });
    })
    .catch(error => {
      mark(job, { status: 'error', error: String(error.message || 'Falha Evolution').slice(0, 150) });
      console.warn('[Evolution Bootstrap] Falha:', { integrationId, error: error.message });
    })
    .finally(() => {
      job.finished_at = Date.now();
      bootstrapActive--;
      if (job.rerun) queueEvolutionBootstrap({ orgId, integrationId, force: true });
      pumpBootstrap();
    });
}

/** Background bootstrap, serialized across instances so MySQL is not overwhelmed. */
export function queueEvolutionBootstrap({ orgId, integrationId, force = false }) {
  pruneJobs(bootstrapJobs);
  const key = `${orgId}:${integrationId}`;
  const previous = bootstrapJobs.get(key);
  if (previous && ['running', 'queued'].includes(previous.status)) {
    if (force) previous.rerun = true;
    return publicJob(previous);
  }
  if (!force && previous?.status === 'done' && Date.now() - previous.finished_at < BOOTSTRAP_THROTTLE_MS)
    return publicJob(previous);
  const job = { status: 'queued', contacts: 0, chats: 0,
    updated_at: new Date().toISOString(), finished_at: 0, rerun: false };
  bootstrapJobs.set(key, job);
  bootstrapPending.push({ orgId, integrationId, job });
  pumpBootstrap();
  return publicJob(job);
}

export function getEvolutionHistoryStatus(orgId, conversationId) {
  return getJob(historyJobs, `${orgId}:${conversationId}`);
}

function pumpHistory() {
  if (historyActive >= HISTORY_CONCURRENCY) return;
  const next = historyPending.shift();
  if (!next) return;
  historyActive++;
  const { orgId, conversation, job } = next;
  mark(job, { status: 'running' });
  void syncEvolutionConversation({ orgId, conversation, onProgress: progress => mark(job, progress) })
    .then(result => mark(job, { ...result, status: 'done' }))
    .catch(error => {
      mark(job, { status: 'error', error: String(error.message || 'Falha Evolution').slice(0, 150) });
      console.warn('[Evolution History] Falha:', { conversationId: conversation.id, error: error.message });
    })
    .finally(() => { job.finished_at = Date.now(); historyActive--; pumpHistory(); });
}

export function queueEvolutionHistory({ orgId, conversation, force = false }) {
  pruneJobs(historyJobs);
  const key = `${orgId}:${conversation.id}`;
  const previous = historyJobs.get(key);
  if (previous && ['running', 'queued'].includes(previous.status)) return publicJob(previous);
  if (!force && previous?.status === 'done' && Date.now() - previous.finished_at < HISTORY_THROTTLE_MS)
    return publicJob(previous);
  const job = { status: 'queued', scanned: 0, pages: 0, counts: {},
    updated_at: new Date().toISOString(), finished_at: 0 };
  historyJobs.set(key, job);
  historyPending.push({ orgId, conversation, job });
  pumpHistory();
  return publicJob(job);
}
