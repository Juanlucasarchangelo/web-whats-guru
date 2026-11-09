/** Single organization-scoped AI integration shared by all features.
 * Credentials are encrypted at rest (AES-256-GCM) and never sent to the frontend.
 */
import { randomBytes, createCipheriv, createDecipheriv, createHash } from 'node:crypto';
import { prisma } from '../db.js';
import { HttpError } from '../http.js';
import { DEFAULT_AI_MODEL, parseAIModel, parseAIResponse, parseGeminiResponse, providerError, geminiProviderError, defaultAIModel } from './ai-provider-policy.js';

function cipherKey() {
  const secret = process.env.INTEGRATION_ENCRYPTION_KEY;
  if (!secret || secret.length < 32) {
    throw new HttpError(503, 'Configure INTEGRATION_ENCRYPTION_KEY (mínimo 32 caracteres) no server/.env.');
  }
  return createHash('sha256').update(secret).digest();
}

export function encryptAISecret(value) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', cipherKey(), iv);
  const data = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  return `enc:${Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64')}`;
}

export function decryptAISecret(value) {
  if (typeof value !== 'string' || !value.startsWith('enc:')) {
    throw new HttpError(503, 'Credencial de IA armazenada em formato inválido. Reconfigure a integração.');
  }
  const buffer = Buffer.from(value.slice(4), 'base64');
  if (buffer.length < 29) throw new HttpError(503, 'Credencial de IA corrompida. Reconfigure a integração.');
  try {
    const decipher = createDecipheriv('aes-256-gcm', cipherKey(), buffer.subarray(0, 12));
    decipher.setAuthTag(buffer.subarray(12, 28));
    return Buffer.concat([decipher.update(buffer.subarray(28)), decipher.final()]).toString('utf8');
  } catch {
    throw new HttpError(503, 'Não foi possível abrir a credencial de IA. Confira INTEGRATION_ENCRYPTION_KEY.');
  }
}

async function providerFetch(url, options, provider = 'openai') {
  let response;
  try {
    response = await fetch(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(30000) });
  } catch {
    throw new HttpError(502, `Não foi possível acessar ${provider === 'gemini' ? 'o Gemini' : 'a OpenAI'}. Confira a conexão e tente novamente.`);
  }
  if (!response.ok) throw new HttpError(502, provider === 'gemini' ? geminiProviderError(response.status) : providerError(response.status));
  return response.json().catch(() => ({}));
}

export async function validateOpenAIKey(apiKey) {
  if (typeof apiKey !== 'string' || !apiKey.trim().startsWith('sk-')) {
    throw new HttpError(400, 'Informe uma chave válida da API OpenAI.');
  }
  await providerFetch('https://api.openai.com/v1/models', {
    headers: { Authorization: `Bearer ${apiKey.trim()}` },
  });
}

export async function validateGeminiKey(apiKey) {
  if (typeof apiKey !== 'string' || !apiKey.trim() || apiKey.length > 512) {
    throw new HttpError(400, 'Informe uma chave válida da API Gemini.');
  }
  // Validate credentials without sending customer data or generating content.
  await providerFetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1', {
    headers: { 'x-goog-api-key': apiKey.trim() },
  }, 'gemini');
}

export async function connectedAIProvider(orgId) {
  // An explicit disconnected integration never falls back to an environment-wide key.
  const integration = await prisma.integration.findFirst({
    where: { org_id: orgId, type: 'ai_provider' },
    orderBy: { created_at: 'asc' },
    select: { id: true, status: true, config: true },
  });
  if (integration) {
    if (integration.status !== 'connected') {
      throw new HttpError(503, 'Provedor de IA desativado. Acesse Integrações → Provedor de IA e conecte novamente.');
    }
    const provider = integration.config?.provider;
    if (provider !== 'openai' && provider !== 'gemini') {
      throw new HttpError(503, 'Provedor de IA não suportado. Reconfigure-o em Integrações.');
    }
    const credential = await prisma.integrationCredential.findFirst({
      where: { org_id: orgId, integration_id: integration.id }, select: { access_token: true },
    });
    if (!credential?.access_token) throw new HttpError(503, 'A integração de IA está sem credencial. Reconfigure-a.');
    return {
      provider, key: decryptAISecret(credential.access_token),
      model: parseAIModel(integration.config.model || defaultAIModel(provider), provider), source: 'integration'
    };
  }
  // Backwards compatibility only for organizations with no central AI integration.
  const key = process.env.OPENAI_API_KEY?.trim();
  if (key) return { provider: 'openai', key, model: parseAIModel(process.env.OPENAI_MODEL || DEFAULT_AI_MODEL), source: 'legacy_env' };
  throw new HttpError(503, 'Configure um provedor em Integrações → Provedor de IA. Nenhuma mensagem foi enviada.');
}

export async function generateAIText({ orgId, instructions, input, maxOutputTokens = 400 }) {
  const ai = await connectedAIProvider(orgId);
  if (ai.provider === 'gemini') {
    const data = await providerFetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(ai.model)}:generateContent`, {
      method: 'POST',
      headers: { 'x-goog-api-key': ai.key, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: String(instructions).slice(0, 4000) }] },
        contents: [{ role: 'user', parts: [{ text: String(input).slice(0, 24000) }] }],
        generationConfig: { maxOutputTokens: Math.max(16, Math.min(2000, Math.floor(maxOutputTokens))), temperature: 0.2 },
      }),
    }, 'gemini');
    const result = parseGeminiResponse(data);
    if (!result) throw new HttpError(502, 'Gemini não retornou texto. Verifique o modelo e os limites do projeto.');
    return result;
  }
  const data = await providerFetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { Authorization: `Bearer ${ai.key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: ai.model,
      store: false,
      max_output_tokens: Math.max(16, Math.min(2000, Math.floor(maxOutputTokens))),
      instructions: String(instructions).slice(0, 4000),
      input: String(input).slice(0, 24000),
    }),
  });
  const result = parseAIResponse(data);
  if (!result) throw new HttpError(502, 'A IA não retornou texto. Nenhuma mensagem foi enviada.');
  return result;
}
