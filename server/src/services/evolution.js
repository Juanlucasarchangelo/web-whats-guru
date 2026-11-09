import { createHash, createDecipheriv, randomUUID } from 'node:crypto';
import { prisma } from '../db.js';
import { importEvolutionMessage } from './evolution-inbound.js';
import { saveEvolutionReceipt } from './evolution-receipts.js';
import { initialDeliveryStatus } from './evolution-message-status.js';
import { summarizeEvolutionResults } from './evolution-payload.js';
import { HttpError } from '../http.js';
import { HISTORY_PAGE_SIZE, MAX_HISTORY_PAGES, historyCutoff, messageDate, recordsFrom, shouldContinueHistory } from './evolution-sync-policy.js';
import { linkedHistoryJids, normalizeHistoricalItem } from './evolution-history-policy.js';
import { groupJid } from './evolution-groups.js';
import { messageGroupJid, normalizedProviderMessage, evolutionGroupSettings, groupHistoryHints } from './evolution-group-history-policy.js';
import { requeueGroupMediaArchive } from './evolution-media-archive.js';
import { importEvolutionGroupMessage } from './evolution-group-inbound.js';

function decodeKey() {
  const secret = process.env.INTEGRATION_ENCRYPTION_KEY;
  if (!secret || secret.length < 32) throw new HttpError(503, 'INTEGRATION_ENCRYPTION_KEY ausente no servidor.');
  return createHash('sha256').update(secret).digest();
}
function decrypt(ciphertext) {
  if (typeof ciphertext !== 'string' || !ciphertext.startsWith('enc:')) throw new HttpError(503, 'Credencial Evolution nao criptografada como esperado; reconfigure a integracao.');
  try {
    const buf = Buffer.from(ciphertext.slice(4), 'base64');
    if (buf.length < 29) throw Error('invalid');
    const decipher = createDecipheriv('aes-256-gcm', decodeKey(), buf.subarray(0, 12));
    decipher.setAuthTag(buf.subarray(12, 28));
    return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString('utf8');
  } catch { throw new HttpError(503, 'Falha ao ler chave Evolution. Confira INTEGRATION_ENCRYPTION_KEY original.'); }
}
export async function loadEvolution(orgId, integrationId = null) {
  const integration = integrationId
    ? await prisma.integration.findFirst({ where: { id: integrationId, org_id: orgId, type: 'whatsapp' } })
    : await prisma.integration.findFirst({ where: { org_id: orgId, type: 'whatsapp' }, orderBy: { created_at: 'asc' } });
  if (!integration || integration.config?.provider !== 'evolution_api') return null;
  const credentials = await prisma.integrationCredential.findFirst({ where: { integration_id: integration.id, org_id: orgId } });
  if (!credentials?.access_token) throw new HttpError(503, 'API Key Evolution nao foi salva. Configure em Integracoes.');
  const url = String(integration.config?.provider_url || '').replace(/\/$/, '');
  const instance = String(integration.config?.instance_name || '');
  // Only use URLs already saved by the integration's validated setup.
  if (!/^https?:\/\//.test(url) || !/^[\w-]{2,60}$/.test(instance)) throw new HttpError(503, 'URL ou instancia Evolution invalida.');
  return { integration, url, instance, apiKey: decrypt(credentials.access_token) };
}
export async function evolutionGet(api, path, method = 'GET', body, timeoutMs = 15000) {
  let response;
  try { response = await fetch(`${api.url}${path}`, { method, headers: { apikey: api.apiKey, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(timeoutMs), redirect: 'error' }); }
  catch { throw new HttpError(502, 'Nao foi possivel comunicar com Evolution API. Confira Docker e porta.'); }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new HttpError(502, `Evolution retornou HTTP ${response.status}: ${String(data?.response?.message || data?.message || 'erro').slice(0, 120)}`);
    error.providerStatus = response.status;
    throw error;
  }
  return data;
}
export async function syncEvolutionStatus(orgId, integrationId = null) {
  const api = await loadEvolution(orgId, integrationId); if (!api) return null;
  const result = await evolutionGet(api, `/instance/connectionState/${encodeURIComponent(api.instance)}`);
  const state = result?.instance?.state;
  const status = state === 'open' ? 'connected' : state === 'connecting' ? 'connecting' : 'disconnected';
  if (api.integration.status !== status) await prisma.integration.updateMany({ where: { id: api.integration.id, org_id: orgId }, data: { status, last_connected_at: status === 'connected' ? new Date() : api.integration.last_connected_at } });
  return { status, instance_name: api.instance, integration_id: api.integration.id, provider: 'evolution_api' };
}
export async function sendEvolutionText({ orgId, conversation, text, userId }) {
  if (!conversation.integration_id) throw new HttpError(409, 'Conversa sem numero de WhatsApp vinculado. Execute a atualizacao do banco antes de enviar.');
  const api = await loadEvolution(orgId, conversation.integration_id);
  if (!api) throw new HttpError(503, 'Evolution nao configurada para esta conversa.');
  const state = await syncEvolutionStatus(orgId, api.integration.id);
  if (state.status !== 'connected') throw new HttpError(409, `Instancia Evolution nao esta conectada (status: ${state.status}).`);
  const group = await prisma.whatsAppGroup.findFirst({ where: { org_id: orgId, integration_id: api.integration.id, conversation_id: conversation.id } });
  let destination = group?.jid;
  if (!destination) {
    const contact = await prisma.contact.findFirst({ where: { id: conversation.contact_id, org_id: orgId }, select: { phone: true } });
    const phone = String(contact?.phone || '').replace(/\D/g, '');
    if (phone.length < 10 || phone.length > 15) throw new HttpError(400, 'Contato precisa de telefone completo com DDI (ex. 5541999999999).');
    destination = phone;
  }
  const result = await evolutionGet(api, `/message/sendText/${encodeURIComponent(api.instance)}`, 'POST', { number: destination, text });
  const providerId = result?.key?.id || result?.id;
  if (!providerId) throw new HttpError(502, 'Evolution nao confirmou o envio; verifique painel do provedor antes de reenviar.');
  const row = await prisma.$transaction(async tx => {
    const msg = await tx.message.create({ data: { id: randomUUID(), org_id: orgId, conversation_id: conversation.id, body: text, sender_type: 'agent', sender_id: userId, channel: 'whatsapp', status: 'accepted', is_internal: false } });
    await tx.conversation.update({ where: { id: conversation.id }, data: { last_message_at: msg.created_at } });
    await tx.webhookEvent.create({ data: { id: randomUUID(), org_id: orgId, source: 'evolution_outbound', event_type: 'message_accepted', payload: { provider_message_id: providerId, local_message_id: msg.id, integration_id: api.integration.id }, processed: true, processed_at: new Date() } });
    return msg;
  });
  return row;
}

/** Evolution API v2 expects FLAT webhook settings, not {webhook:{...}}. */
export async function configureEvolutionWebhook(orgId, endpointUrl, integrationId = null) {
  const api = await loadEvolution(orgId, integrationId);
  if (!api) throw new HttpError(404, 'Evolution nao configurada nesta organizacao.');
  const parsed = new URL(endpointUrl);
  if (!['https:', 'http:'].includes(parsed.protocol)) throw new HttpError(400, 'Webhook deve usar HTTP(S).');
  const body = {
    enabled: true,
    url: endpointUrl,
    webhookByEvents: false,
    webhookBase64: false,
    events: ['MESSAGES_UPSERT', 'MESSAGES_SET', 'CONNECTION_UPDATE', 'MESSAGES_UPDATE',
      'GROUPS_UPSERT', 'GROUP_UPDATE', 'GROUP_PARTICIPANTS_UPDATE'],
  };
  let contract = 'flat';
  try {
    // Recent Evolution endpoints may accept this shape.
    await evolutionGet(api, `/webhook/set/${encodeURIComponent(api.instance)}`, 'POST', body);
  } catch (error) {
    if (![400, 404, 422].includes(error?.providerStatus)) throw error;
    contract = 'nested';
    try {
      await evolutionGet(api, `/webhook/set/${encodeURIComponent(api.instance)}`, 'POST', { webhook: body });
    } catch (nestedError) {
      // If this Evolution release rejects group event names, preserve core messaging webhook.
      if (![400, 422].includes(nestedError?.providerStatus)) throw nestedError;
      body.events = ['MESSAGES_UPSERT', 'MESSAGES_SET', 'CONNECTION_UPDATE', 'MESSAGES_UPDATE'];
      try { await evolutionGet(api, `/webhook/set/${encodeURIComponent(api.instance)}`, 'POST', body); }
      catch {
        try { await evolutionGet(api, `/webhook/set/${encodeURIComponent(api.instance)}`, 'POST', { webhook: body }); }
        catch {
          // Preserve live-message delivery even on a provider version without MESSAGES_SET.
          body.events = ['MESSAGES_UPSERT', 'CONNECTION_UPDATE', 'MESSAGES_UPDATE'];
          await evolutionGet(api, `/webhook/set/${encodeURIComponent(api.instance)}`, 'POST', body);
        }
      }
      contract = 'fallback-messages-only';
    }
  }
  let verified = false;
  try {
    const status = await getEvolutionWebhookInfo(orgId, api.integration.id);
    verified = Boolean(status?.enabled && status?.has_url && status?.messages_upsert);
  } catch (error) {
    console.warn('[Evolution Webhook] Registro aceito, mas falhou a verificacao de leitura:', error.message);
  }
  if (!verified) console.warn('[Evolution Webhook] Confirme no painel Evolution se o webhook esta habilitado.', { instance: api.instance, contract });
  else console.info('[Evolution Webhook] Registro confirmado:', { instance: api.instance, contract, events: body.events });
  return { ok: true, verified, instance: api.instance, contract, events: body.events };
}

export async function getEvolutionWebhookInfo(orgId, integrationId = null) {
  const api = await loadEvolution(orgId, integrationId);
  if (!api) return null;
  const result = await evolutionGet(api, `/webhook/find/${encodeURIComponent(api.instance)}`);
  const config = result?.webhook?.webhook ?? result?.webhook ?? result?.data?.webhook ?? result?.data ?? result;
  const events = Array.isArray(config?.events) ? config.events : [];
  // Do NOT expose webhook URL (it contains the secret), access token or API key.
  return {
    instance: api.instance,
    enabled: Boolean(config?.enabled),
    has_url: Boolean(config?.url),
    events,
    messages_upsert: events.some(e => String(e).toUpperCase() === 'MESSAGES_UPSERT'),
    messages_update: events.some(e => String(e).toUpperCase() === 'MESSAGES_UPDATE'),
  };
}

// A short-lived, per-instance alias index avoids re-reading thousands of contacts
// every time a conversation is opened. Never cache or share across organizations.
const historyAliases = new Map();
const ALIAS_CACHE_MS = 10 * 60 * 1000;
const ALIAS_PAGE_SIZE = 500;
const MAX_ALIAS_PAGES = 30;

async function evolutionHistoryAliases(api) {
  const cacheKey = `${api.integration.org_id}:${api.integration.id}`;
  const cached = historyAliases.get(cacheKey);
  if (cached && cached.expires > Date.now()) return cached.promise;
  const promise = (async () => {
    const records = [];
    const errors = [];
    for (const endpoint of ['findChats', 'findContacts']) {
      let previous = null;
      for (let page = 1; page <= MAX_ALIAS_PAGES; page++) {
        try {
          const result = await evolutionGet(api, `/chat/${endpoint}/${encodeURIComponent(api.instance)}`,
            'POST', { where: {}, page, offset: ALIAS_PAGE_SIZE });
          const parsed = recordsFrom(result, endpoint === 'findChats' ? 'chats' : 'contacts');
          const items = parsed.records;
          const fingerprint = items.length ? JSON.stringify([items.length,
            items[0]?.remoteJid ?? items[0]?.id, items[items.length - 1]?.remoteJid ?? items[items.length - 1]?.id]) : '';
          if (!items.length || (page > 1 && fingerprint === previous)) break;
          records.push(...items);
          previous = fingerprint;
          if ((parsed.pages && page >= parsed.pages) ||
              (!parsed.pages && items.length < ALIAS_PAGE_SIZE) ||
              (Array.isArray(result) && items.length > ALIAS_PAGE_SIZE)) break;
        } catch (error) {
          errors.push(`${endpoint}: ${String(error.message).slice(0, 110)}`);
          break; // a failing metadata endpoint cannot prevent PN history sync
        }
      }
    }
    return { records, errors };
  })();
  historyAliases.set(cacheKey, { promise, expires: Date.now() + ALIAS_CACHE_MS });
  if (historyAliases.size > 60) {
    for (const [key, entry] of historyAliases) if (entry.expires <= Date.now()) historyAliases.delete(key);
  }
  return promise;
}

/** Recover up to three months of history from every VERIFIED JID for this contact.
 * Evolution may store half a chat under phone@s.whatsapp.net and the other half
 * under an opaque @lid address. Never import a LID unless Evolution maps it to
 * the contact's telephone number in the same contact/chat record.
 */
export async function syncEvolutionConversation({ orgId, conversation, onProgress = () => {} }) {
  if (!conversation.integration_id) throw new HttpError(409, 'Conversa sem numero de WhatsApp vinculado.');
  const api = await loadEvolution(orgId, conversation.integration_id);
  if (!api) throw new HttpError(404, 'Evolution nao configurada para esta conversa.');
  // A group has its own remoteJid, not a telephone number.
  const group = await prisma.whatsAppGroup.findFirst({ where: { org_id: orgId,
    conversation_id: conversation.id, integration_id: api.integration.id } });
  if (group) return syncEvolutionGroupHistory({ orgId, api, group, onProgress });
  const contact = await prisma.contact.findFirst({
    where: { id: conversation.contact_id, org_id: orgId }, select: { phone: true },
  });
  const phone = String(contact?.phone ?? '').replace(/\D/g, '');
  if (phone.length < 10 || phone.length > 15) throw new HttpError(400, 'Contato sem telefone valido.');
  const cutoff = historyCutoff();
  const counts = {};
  let scanned = 0;
  let pages = 0;
  let truncated = false;
  // Start metadata discovery alongside the regular PN query. This lets the
  // user see initial progress immediately instead of waiting for 4,900+ contacts.
  const aliases = [`${phone}@s.whatsapp.net`];
  let aliasWarnings = [];
  const aliasesPromise = evolutionHistoryAliases(api).catch(error => ({
    records: [], errors: [String(error.message).slice(0, 140)],
  }));
  const seenMessageIds = new Set();
  for (let sourceIndex = 0; sourceIndex < aliases.length; sourceIndex++) {
    const remoteJid = aliases[sourceIndex];
    let previousPageFingerprint = null;
    let completed = false;
    for (let page = 1; page <= MAX_HISTORY_PAGES; page++) {
      let payload;
      try {
        payload = await evolutionGet(api, `/chat/findMessages/${encodeURIComponent(api.instance)}`, 'POST', {
          where: { key: { remoteJid } }, page, offset: HISTORY_PAGE_SIZE,
        });
      } catch (error) {
        if (sourceIndex === 0) throw error; // Primary lookup failed: a true sync error.
        aliasWarnings.push(`Consulta de identificador alternativo: ${String(error.message).slice(0, 110)}`);
        truncated = true;
        break;
      }
      const { records, pages: totalPages } = recordsFrom(payload, 'messages');
      pages++;
      const fingerprint = records.length ? `${records[0]?.key?.id ?? ''}:${records[records.length - 1]?.key?.id ?? ''}:${records.length}` : null;
      if (page > 1 && fingerprint && fingerprint === previousPageFingerprint) {
        truncated = true;
        break;
      }
      previousPageFingerprint = fingerprint;
      for (const original of records) {
        scanned++;
        const item = normalizeHistoricalItem(original, remoteJid, phone);
        const date = messageDate(item);
        if (!date || date < cutoff) { counts.ignored_out_of_period = (counts.ignored_out_of_period ?? 0) + 1; continue; }
        const providerId = String(item?.key?.id ?? item?.data?.key?.id ?? '');
        if (providerId && seenMessageIds.has(providerId)) {
          counts.duplicate = (counts.duplicate ?? 0) + 1;
          continue;
        }
        if (providerId) seenMessageIds.add(providerId);
        const result = await importEvolutionMessage({ orgId, integrationId: api.integration.id,
          item, expectedPhone: phone, historical: true });
        counts[result.outcome] = (counts[result.outcome] ?? 0) + 1;
        if ([true, 'true', 1, '1'].includes(item?.key?.fromMe)) {
          const providerStatus = initialDeliveryStatus(item);
          if (['delivered', 'read', 'played', 'failed'].includes(providerStatus)) {
            const outcome = await saveEvolutionReceipt({ orgId, integrationId: api.integration.id,
              item: { key: item.key, status: providerStatus } });
            if (outcome === 'receipt_updated') counts.receipts_updated = (counts.receipts_updated ?? 0) + 1;
          }
        }
      }
      onProgress({ scanned, pages, counts: { ...counts }, cutoff: cutoff.toISOString(), aliases: aliases.length });
      const decision = shouldContinueHistory({ records, page, totalPages, cutoff });
      if (!decision.continue) { completed = true; break; }
    }
    if (!completed) truncated = true;
    if (sourceIndex === 0) {
      const resolved = await aliasesPromise;
      aliasWarnings = resolved.errors;
      const verified = linkedHistoryJids(resolved.records, phone);
      aliases.push(...verified.filter(jid => jid !== remoteJid));
      onProgress({ scanned, pages, counts: { ...counts }, aliases: aliases.length });
    }
  }
  console.info('[Evolution Sync]', { integrationId: api.integration.id, conversationId: conversation.id,
    scanned, pages, aliases: aliases.length, truncated, counts, aliasWarnings });
  return { counts, scanned, pages, aliases: aliases.length, alias_warning: aliasWarnings.length > 0,
    truncated, cutoff: cutoff.toISOString(), synchronized_at: new Date().toISOString() };
}

/** Evolution 2.3.x sometimes returns an empty page for a valid group JID filter,
 * even while other messages are available. In that case do a single instance-scoped,
 * bounded/unfiltered pass, shared by concurrent group jobs. Every returned message
 * is still validated against its own @g.us JID BEFORE import.
 *
 * This does NOT fetch WhatsApp history missing from Evolution's own database.
 */
const alternativeGroupScans = new Map();
const ALTERNATIVE_SCAN_TTL_MS = 60_000;
async function scanAvailableGroupHistory({ orgId, api, cutoff, onProgress = () => {} }) {
  const scanKey = `${orgId}:${api.integration.id}`;
  const cached = alternativeGroupScans.get(scanKey);
  if (cached && (cached.running || cached.expires > Date.now())) return cached.promise;
  const state = { running: true, expires: 0, promise: null };
  state.promise = (async () => {
    const byJid = new Map();
    let examined = 0;
    let groupMessages = 0;
    let pages = 0;
    let truncated = false;
    let previous = null;
    let completed = false;
    for (let page = 1; page <= MAX_HISTORY_PAGES; page++) {
      const payload = await evolutionGet(api, `/chat/findMessages/${encodeURIComponent(api.instance)}`,
        'POST', { where: {}, page, offset: HISTORY_PAGE_SIZE });
      const { records, pages: totalPages } = recordsFrom(payload, 'messages');
      pages++;
      const fingerprint = records.length
        ? `${records[0]?.key?.id ?? records[0]?.data?.key?.id}:${records.at(-1)?.key?.id ?? records.at(-1)?.data?.key?.id}:${records.length}`
        : null;
      if (page > 1 && fingerprint && fingerprint === previous) { truncated = true; break; }
      previous = fingerprint;
      for (const original of records) {
        examined++;
        const item = normalizedProviderMessage(original);
        const jid = messageGroupJid(original);
        if (!jid) continue;
        const date = messageDate(item);
        if (!date || date < cutoff) continue;
        groupMessages++;
        const result = await importEvolutionGroupMessage({ orgId, integrationId: api.integration.id,
          item, expectedGroupJid: jid, historical: true });
        const counts = byJid.get(jid) || { scanned: 0, counts: {} };
        counts.scanned++;
        counts.counts[result.outcome] = (counts.counts[result.outcome] || 0) + 1;
        byJid.set(jid, counts);
      }
      onProgress({ alternative_pages: pages, alternative_examined: examined, alternative_group_messages: groupMessages });
      const decision = shouldContinueHistory({ records: records.map(normalizedProviderMessage), page,
        totalPages, cutoff });
      if (!decision.continue) { completed = true; break; }
    }
    if (!completed) truncated = true;
    return { byJid, examined, pages, groupMessages, truncated };
  })();
  alternativeGroupScans.set(scanKey, state);
  try {
    const result = await state.promise;
    state.running = false;
    state.expires = Date.now() + ALTERNATIVE_SCAN_TTL_MS;
    return result;
  } catch (error) {
    // Do not cache an unsuccessful request; subsequent explicit retry may work.
    alternativeGroupScans.delete(scanKey);
    throw error;
  }
}

async function readGroupHistorySettings(api) {
  try {
    const settings = await evolutionGet(api, `/settings/find/${encodeURIComponent(api.instance)}`);
    return evolutionGroupSettings(settings);
  } catch (error) {
    console.warn('[Evolution Grupos] Não foi possível verificar as configurações da instância:', {
      integrationId: api.integration.id, status: error?.providerStatus || 'unavailable',
    });
    return { sync_full_history: null, groups_ignore: null };
  }
}

/** Query one exact group JID; retry through an instance-scoped scan only when
 * Evolution fails to return messages for the filtered request. */
async function syncEvolutionGroupHistory({ orgId, api, group, onProgress }) {
  if (!groupJid(group.jid)) throw new HttpError(409, 'Identificador de grupo inválido.');
  const cutoff = historyCutoff();
  const counts = {};
  let scanned = 0;
  let pages = 0;
  let truncated = false;
  let completed = false;
  let previous = null;
  let filteredError = null;
  let source = 'filtered';
  for (let page = 1; page <= MAX_HISTORY_PAGES; page++) {
    let payload;
    try {
      payload = await evolutionGet(api, `/chat/findMessages/${encodeURIComponent(api.instance)}`,
        'POST', { where: { key: { remoteJid: group.jid } }, page, offset: HISTORY_PAGE_SIZE });
    } catch (error) {
      // Filter failures can be specific to Evolution releases. Try the safe
      // unfiltered fallback below, but never hide a failure if it also fails.
      filteredError = error;
      break;
    }
    const { records, pages: totalPages } = recordsFrom(payload, 'messages');
    pages++;
    const fingerprint = records.length
      ? `${records[0]?.key?.id ?? records[0]?.data?.key?.id}:${records.at(-1)?.key?.id ?? records.at(-1)?.data?.key?.id}:${records.length}`
      : null;
    if (page > 1 && fingerprint && fingerprint === previous) { truncated = true; break; }
    previous = fingerprint;
    for (const original of records) {
      // Some Evolution versions ignore JID filters. Never mix histories.
      const item = normalizedProviderMessage(original);
      if (messageGroupJid(original) !== group.jid) {
        counts.ignored_other_group = (counts.ignored_other_group || 0) + 1;
        continue;
      }
      scanned++;
      const date = messageDate(item);
      if (!date || date < cutoff) {
        counts.ignored_out_of_period = (counts.ignored_out_of_period || 0) + 1;
        continue;
      }
      const result = await importEvolutionGroupMessage({ orgId, integrationId: api.integration.id,
        item, expectedGroupJid: group.jid, historical: true });
      counts[result.outcome] = (counts[result.outcome] || 0) + 1;
    }
    onProgress({ scanned, pages, counts: { ...counts }, cutoff: cutoff.toISOString(), group: true });
    const decision = shouldContinueHistory({ records: records.map(normalizedProviderMessage), page, totalPages, cutoff });
    if (!decision.continue) { completed = true; break; }
  }
  if (!completed && !filteredError) truncated = true;

  let providerScanned = scanned;
  let alternativePages = 0;
  let alternativeError = null;
  if (scanned === 0) {
    source = 'alternative';
    try {
      const found = await scanAvailableGroupHistory({ orgId, api, cutoff, onProgress });
      const mine = found.byJid.get(group.jid);
      scanned = mine?.scanned || 0;
      // The fallback imported group messages directly, so do not replay them.
      Object.assign(counts, { ...counts, ...(mine?.counts || {}) });
      alternativePages = found.pages;
      providerScanned = found.examined;
      truncated = truncated || found.truncated;
      onProgress({ scanned, pages: pages + found.pages, counts: { ...counts },
        alternative_pages: found.pages, alternative_examined: found.examined, group: true });
    } catch (error) {
      alternativeError = error;
      if (filteredError) throw new HttpError(502,
        'A Evolution não disponibilizou o histórico do grupo: as duas consultas falharam. Confira os logs da API.');
    }
  }

  // Recover attachments saved in the database whose download/NAS upload failed
  // before. Historical duplicates must NOT permanently block a second attempt.
  const mediaRetry = await requeueGroupMediaArchive({ orgId, integrationId: api.integration.id,
    conversationId: group.conversation_id, cutoff });
  const settings = scanned === 0 ? await readGroupHistorySettings(api) : null;
  const providerWarning = groupHistoryHints(settings, {
    unfilteredError: alternativeError, partial: truncated,
  });
  if (filteredError && scanned === 0) providerWarning.push('A consulta filtrada também falhou na Evolution.');
  if (scanned === 0 && !providerWarning.length)
    providerWarning.push('Nenhuma mensagem deste grupo foi encontrada no histórico armazenado pela Evolution.');
  console.info('[Evolution Grupo Histórico]', { integrationId: api.integration.id,
    groupId: group.id, scanned, pages: pages + alternativePages, truncated, source,
    providerScanned, queuedMedia: mediaRetry.queued, counts, providerWarning });
  return { counts, scanned, pages: pages + alternativePages, truncated, group: true,
    source, provider_scanned: providerScanned,
    queued_media: mediaRetry.queued, media_retry_incomplete: mediaRetry.incomplete,
    provider_warning: providerWarning,
    provider_settings: settings,
    cutoff: cutoff.toISOString(), synchronized_at: new Date().toISOString() };
}

/** Download autenticado da mídia pela Evolution API. */
export async function fetchEvolutionMedia({ orgId, integrationId, mediaMessage }) {
  const api = await loadEvolution(orgId, integrationId);
  if (!api) throw new HttpError(503, 'Evolution indisponível para esta conversa.');
  if (!mediaMessage?.key?.id) throw new HttpError(409, 'Mensagem sem identificador para recuperar a mídia.');

  const endpoint = `/chat/getBase64FromMediaMessage/${encodeURIComponent(api.instance)}`;
  // Compatibilidade entre versões: algumas exigem o objeto completo recebido
  // no webhook; outras aceitam somente a chave da mensagem.
  const attempts = mediaMessage?.message
    ? [mediaMessage, { key: mediaMessage.key }]
    : [{ key: mediaMessage.key }];
  let lastError;
  for (const payload of attempts) {
    try {
      const result = await evolutionGet(api, endpoint, 'POST', {
        message: payload, convertToMp4: false,
      }, 60000);
      const raw = result?.base64 ?? result?.data?.base64 ??
        result?.response?.base64 ?? result?.data?.data?.base64;
      if (typeof raw !== 'string' || !raw.length) {
        throw new HttpError(502, 'Evolution não disponibilizou os dados deste arquivo.');
      }
      const base64 = raw.replace(/^data:[^,]+,/, '').replace(/\s/g, '');
      if (base64.length > 56_000_000 || !/^[a-zA-Z0-9+/]*={0,2}$/.test(base64)) {
        throw new HttpError(413, 'Arquivo excede o limite de transferência (40 MB) ou contém dados inválidos.');
      }
      const bytes = Buffer.from(base64, 'base64');
      if (bytes.length > 40 * 1024 * 1024) {
        throw new HttpError(413, 'Arquivo excede o limite de transferência de 40 MB.');
      }
      if (bytes.length === 0) throw new HttpError(502, 'Evolution devolveu um arquivo vazio.');
      return bytes;
    } catch (error) {
      lastError = error;
      // Tenta formato alternativo apenas para falhas na disponibilidade da mídia.
      if (payload === attempts[attempts.length - 1] || error?.status === 413 || error?.status === 503) break;
    }
  }
  throw lastError || new HttpError(502, 'Não foi possível recuperar a mídia pela Evolution.');
}
