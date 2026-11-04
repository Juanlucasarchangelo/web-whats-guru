// Conexão exclusivamente no servidor. Nunca encaminhar credenciais do n8n ao navegador.
const paths = Object.freeze({
  leads: 'instagram-painel-dados-atualizados',
  lead: 'instagram-lead-atualizar',
  campaign: 'instagram-campanha-iniciar',
  monitor: 'instagram-monitoramento-dados',
  profile: 'instagram-monitoramento-perfis',
  scrape: 'instagram-monitoramento-iniciar',
  cleanup: 'instagram-monitoramento-limpar-dados',
});
export class StalkerError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export async function requestStalker(key, method, body) {
  const suffix = paths[key];
  if (!suffix) throw new StalkerError(400, 'Operação desconhecida.');
  const base = (process.env.STALKER_N8N_URL || 'https://webhook.importsbr.cloud/webhook').replace(/\/+$/, '');
  let target;
  try { target = new URL(`${base}/${suffix}`); }
  catch { throw new StalkerError(503, 'URL do n8n inválida.'); }
  if (target.protocol !== 'https:' && !(process.env.NODE_ENV !== 'production' && ['127.0.0.1','localhost'].includes(target.hostname))) {
    throw new StalkerError(503, 'A integração exige conexão HTTPS.');
  }
  const headers = { Accept: 'application/json' };
  const user = process.env.STALKER_N8N_USER;
  const pass = process.env.STALKER_N8N_PASSWORD;
  // O FalaComigo cuida do login do usuário; esta credencial, se exigida pelo webhook,
  // é uma credencial técnica do servidor e não um segundo login.
  if (user && pass) headers.Authorization = `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;
  if (method === 'POST') headers['Content-Type'] = 'application/json';
  let response;
  try {
    response = await fetch(target, {
      method, headers, ...(method === 'POST' ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(20000), redirect: 'error', cache: 'no-store',
    });
  } catch (e) { throw new StalkerError(502, e.name === 'TimeoutError' ? 'O n8n demorou a responder.' : 'Não foi possível comunicar com o n8n.'); }
  if (response.status === 401 || response.status === 403) throw new StalkerError(502, 'O n8n recusou a credencial técnica. Verifique a configuração do servidor.');
  if (!response.ok) throw new StalkerError(502, `O n8n retornou HTTP ${response.status}.`);
  const length = Number(response.headers.get('content-length') || 0);
  if (length > 8_000_000) throw new StalkerError(502, 'Resposta do n8n excede o limite.');
  let raw;
  try { raw = await response.text(); } catch { throw new StalkerError(502, 'Falha ao receber dados do n8n.'); }
  if (raw.length > 8_000_000) throw new StalkerError(502, 'Resposta do n8n excede o limite.');
  let result;
  try { result = JSON.parse(raw); } catch { throw new StalkerError(502, 'O n8n não retornou JSON válido.'); }
  if (result?.sucesso !== true) throw new StalkerError(502, typeof result?.erro === 'string' ? result.erro.slice(0, 300) : 'Operação não confirmada pelo n8n.');
  if (key === 'leads' && !Array.isArray(result.leads)) throw new StalkerError(502, 'Lista de leads inválida.');
  if (key === 'monitor' && !Array.isArray(result.perfis)) throw new StalkerError(502, 'Lista de perfis inválida.');
  return result;
}
