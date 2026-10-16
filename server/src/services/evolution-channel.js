import { prisma } from '../db.js';
import { HttpError } from '../http.js';
import { loadEvolution, syncEvolutionStatus } from './evolution.js';
import { parseEvolutionConnectionResponse } from './evolution-channel-policy.js';

// These operations target one saved integration only; never change another number.
async function request(api, path, method = 'GET') {
  let response;
  try {
    response = await fetch(`${api.url}${path}`, {
      method, headers: { apikey: api.apiKey, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(15000), redirect: 'error',
    });
  } catch {
    throw new HttpError(502, 'Evolution indisponivel. Verifique o Docker e tente novamente.');
  }
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new HttpError(502, `Evolution retornou HTTP ${response.status}: ${String(result?.response?.message || result?.message || 'Falha na operacao').slice(0, 120)}`);
  }
  return result;
}

export async function getEvolutionConnectionQr(orgId, integrationId) {
  const api = await loadEvolution(orgId, integrationId);
  if (!api) throw new HttpError(404, 'Instancia Evolution nao encontrada.');
  const state = await syncEvolutionStatus(orgId, integrationId);
  if (state?.status === 'connected') return { status: 'connected', qr_code: null };
  const result = await request(api, `/instance/connect/${encodeURIComponent(api.instance)}`);
  const parsed = parseEvolutionConnectionResponse(result);
  let qr = parsed.image;
  if (!qr && parsed.qrText) {
    // Evolution 2.3.7 can return the QR *content* in `code`, not an image.
    // Render it locally; never send the token to a third-party QR service.
    const { default: QRCode } = await import('qrcode');
    qr = await QRCode.toDataURL(parsed.qrText, { width: 320, margin: 2, errorCorrectionLevel: 'M' });
  }
  return { status: 'connecting', qr_code: qr, pairing_code: parsed.pairingCode };
}

export async function logoutEvolutionChannel(orgId, integrationId) {
  const api = await loadEvolution(orgId, integrationId);
  if (!api) throw new HttpError(404, 'Instancia Evolution nao encontrada.');
  const status = await syncEvolutionStatus(orgId, integrationId);
  // If already disconnected do not perform a destructive operation again.
  if (status?.status !== 'disconnected') {
    await request(api, `/instance/logout/${encodeURIComponent(api.instance)}`, 'DELETE');
  }
  await prisma.integration.updateMany({
    where: { id: integrationId, org_id: orgId, type: 'whatsapp' },
    data: { status: 'disconnected' },
  });
  return { status: 'disconnected', instance_name: api.instance, integration_id: integrationId };
}
