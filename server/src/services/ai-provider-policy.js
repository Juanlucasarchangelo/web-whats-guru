/** Stable, side-effect-free policy for AI models and provider responses. */
export const DEFAULT_AI_MODEL = 'gpt-4.1-mini';
export const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash';
export const AI_PROVIDERS = ['openai', 'gemini'];

export function defaultAIModel(provider) {
  return provider === 'gemini' ? DEFAULT_GEMINI_MODEL : DEFAULT_AI_MODEL;
}


export function parseAIModel(input, provider = 'openai') {
  const model = String(input || defaultAIModel(provider)).trim();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{1,79}$/.test(model)) {
    throw new Error('Modelo de IA inválido. Informe um identificador como gpt-4.1-mini ou gemini-2.5-flash.');
  }
  return model;
}

export function parseAIResponse(body) {
  // The Responses API stores text in output[].content[]; never concatenate tool calls.
  return (Array.isArray(body?.output) ? body.output : [])
    .flatMap(item => Array.isArray(item?.content) ? item.content : [])
    .filter(item => item?.type === 'output_text' && typeof item.text === 'string')
    .map(item => item.text)
    .join('\n').trim();
}

export function providerError(status) {
  if (status === 401 || status === 403) return 'A chave OpenAI foi rejeitada. Revise a conexão em Integrações → Provedor de IA.';
  if (status === 404) return 'Modelo OpenAI não encontrado ou indisponível para esta conta.';
  if (status === 429) return 'OpenAI limitou a requisição ou não há cota disponível. Verifique saldo e limites da conta.';
  if (status >= 500) return `OpenAI temporariamente indisponível (HTTP ${status}).`;
  return `OpenAI recusou a requisição (HTTP ${status}). Verifique a integração.`;
}

export function parseGeminiResponse(body) {
  return (Array.isArray(body?.candidates) ? body.candidates : [])
    .flatMap(candidate => Array.isArray(candidate?.content?.parts) ? candidate.content.parts : [])
    .filter(part => typeof part?.text === 'string' && !part.thought)
    .map(part => part.text).join('\n').trim();
}

export function geminiProviderError(status) {
  if (status === 400) return 'Gemini recusou a requisição. Confira o modelo configurado e a disponibilidade no seu projeto.';
  if (status === 401 || status === 403) return 'A chave Gemini foi rejeitada ou o projeto não tem acesso. Revise a conexão no Google AI Studio.';
  if (status === 404) return 'Modelo Gemini não encontrado ou indisponível para essa chave. Confira o modelo no Google AI Studio.';
  if (status === 429) return 'Limite gratuito ou cota do Gemini atingido. Consulte os limites do seu projeto no Google AI Studio.';
  if (status >= 500) return `Gemini temporariamente indisponível (HTTP ${status}).`;
  return `Gemini recusou a requisição (HTTP ${status}). Revise a integração.`;
}
