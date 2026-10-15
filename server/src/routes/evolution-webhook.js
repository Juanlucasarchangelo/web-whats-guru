import { Router } from 'express';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { prisma } from '../db.js';
import { importEvolutionMessage } from '../services/evolution-inbound.js';
import { evolutionEventItems, summarizeEvolutionResults } from '../services/evolution-payload.js';

function constantTimeMatch(actual, expected) {
  const a = Buffer.from(String(actual ?? ''));
  const b = Buffer.from(String(expected ?? ''));
  return a.length > 0 && a.length === b.length && timingSafeEqual(a, b);
}
const getEvent = p => String(p?.event ?? p?.type ?? '').toLowerCase().replace(/[_-]/g, '.');

export function evolutionWebhookRouter() {
  const router = Router();
  router.post('/:secret', async (req, res) => {
    const secret = process.env.EVOLUTION_WEBHOOK_SECRET;
    if (!secret || secret.length < 32 || !constantTimeMatch(req.params.secret, secret)) {
      console.warn('[Evolution Webhook] Requisicao recusada: segredo ausente ou incorreto.');
      return res.status(401).json({ error: 'Webhook nao autorizado.' });
    }
    const payload = req.body;
    const instance = String(payload?.instance ?? payload?.instanceName ?? payload?.data?.instance ?? '');
    const event = getEvent(payload);
    if (!instance || !event) return res.status(400).json({ error: 'Evento Evolution sem instancia/evento.' });
    let integration;
    try {
      // Avoid relying on a JSON path equality implementation that can vary by MySQL version.
      const candidates = await prisma.integration.findMany({ where: { type: 'whatsapp' } });
      integration = candidates.find(row => row.config?.provider === 'evolution_api' && row.config?.instance_name === instance);
      if (!integration) {
        console.warn('[Evolution Webhook] Instancia nao encontrada no MySQL:', { instance, event });
        return res.status(404).json({ error: 'Instancia nao cadastrada.' });
      }
      let counts;
      if (event === 'messages.upsert') {
        const results = [];
        for (const item of evolutionEventItems(payload)) {
          results.push(await importEvolutionMessage({ orgId: integration.org_id, item, envelope: payload }));
        }
        counts = summarizeEvolutionResults(results);
        if (results.length === 0) counts.empty_payload = 1;
      } else if (event === 'connection.update') {
        const state = String(payload?.data?.state ?? payload?.data?.instance?.state ?? '');
        const status = state === 'open' ? 'connected' : state === 'connecting' ? 'connecting' : state === 'close' ? 'disconnected' : null;
        if (status) await prisma.integration.update({ where: { id: integration.id }, data: {
          status, ...(status === 'connected' ? { last_connected_at: new Date() } : {}),
        } });
        counts = { connection_update: 1 };
      } else {
        counts = { ignored_event: 1 };
      }
      await prisma.webhookEvent.create({ data: {
        id: randomUUID(), org_id: integration.org_id, source: 'evolution_inbound', event_type: event,
        payload: { instance, counts }, processed: true, processed_at: new Date(),
      } });
      console.info('[Evolution Webhook]', { instance, event, counts });
      return res.json({ ok: true, counts });
    } catch (error) {
      const code = String(error?.code || 'PROCESSING_FAILED');
      console.error('[Evolution Webhook] Falha no processamento:', { instance, event, code, message: error?.message });
      try {
        await prisma.webhookEvent.create({ data: {
          id: randomUUID(), org_id: integration?.org_id ?? null, source: 'evolution_inbound',
          event_type: event, payload: { instance }, error: code.slice(0, 120), processed: false,
        } });
      } catch { /* DB may be unavailable. Error is already in server logs. */ }
      return res.status(500).json({ error: 'Falha ao processar webhook Evolution.', code });
    }
  });
  return router;
}
