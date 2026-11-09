import { createHash, createDecipheriv, randomUUID } from 'node:crypto';
import { prisma } from '../db.js';
import { importEvolutionMessage } from './evolution-inbound.js';
import { saveEvolutionReceipt } from './evolution-receipts.js';
import { initialDeliveryStatus } from './evolution-message-status.js';
import { summarizeEvolutionResults } from './evolution-payload.js';
import { HttpError } from '../http.js';
import { HISTORY_PAGE_SIZE, MAX_HISTORY_PAGES, historyCutoff, messageDate, recordsFrom, shouldContinueHistory } from './evolution-sync-policy.js';
import { linkedHistoryJids, normalizeHistoricalItem } from './evolution-history-policy.js';

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
export async function evolutionGet(api, path, method = 'GET', body) {
  let response;
  try { response = await fetch(`${api.url}${path}`, { method, headers: { apikey: api.apiKey, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(15000), redirect: 'error' }); }
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
  const contact = await prisma.contact.findFirst({ where: { id: conversation.contact_id, org_id: orgId }, select: { phone: true } });
  const phone = String(contact?.phone || '').replace(/\D/g, '');
  if (phone.length < 10 || phone.length > 15) throw new HttpError(400, 'Contato precisa de telefone completo com DDI (ex. 5541999999999).');
  const result = await evolutionGet(api, `/message/sendText/${encodeURIComponent(api.instance)}`, 'POST', { number: phone, text });
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
    events: ['MESSAGES_UPSERT', 'CONNECTION_UPDATE', 'MESSAGES_UPDATE'],
  };
  let contract = 'flat';
  try {
    // Recent Evolution endpoints may accept this shape.
    await evolutionGet(api, `/webhook/set/${encodeURIComponent(api.instance)}`, 'POST', body);
  } catch (error) {
    // Some Evolution v2 releases explicitly require { webhook: {...} }.
    if (![400, 404, 422].includes(error?.providerStatus)) throw error;
    contract = 'nested';
    await evolutionGet(api, `/webhook/set/${encodeURIComponent(api.instance)}`, 'POST', { webhook: body });
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
      });
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
