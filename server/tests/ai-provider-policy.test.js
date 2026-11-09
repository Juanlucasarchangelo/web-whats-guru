import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_AI_MODEL, parseAIModel, parseAIResponse, providerError } from '../src/services/ai-provider-policy.js';

test('modelo padrao é reutilizavel por resumo, sugestao e outras funcoes', () => {
  assert.equal(parseAIModel(''), DEFAULT_AI_MODEL);
  assert.equal(parseAIModel('gpt-4.1-mini'), 'gpt-4.1-mini');
  assert.equal(parseAIModel('  gpt-4.1-mini  '), 'gpt-4.1-mini');
});
test('identificador de modelo nao permite inserir comandos ou caracteres extras', () => {
  for (const model of ['a/b', 'abc\nsecret', ' a | b ', '', '\u0000x']) {
    if (!model) continue;
    assert.throws(() => parseAIModel(model));
  }
});
test('extrai apenas texto da API Responses, nao argumentos de ferramentas', () => {
  const body={output:[
    {type:'function_call',arguments:'SECRETO'},
    {type:'message',content:[{type:'output_text',text:'Resumo 1'}, {type:'tool_result',text:'SECRETO'}]},
    {type:'message',content:[{type:'output_text',text:'Resumo 2'}]},
  ]};
  assert.equal(parseAIResponse(body),'Resumo 1\nResumo 2');
  assert.equal(parseAIResponse({output:[]}),'');
});
test('erros de provider sao acionaveis e nao divulgam a credencial', () => {
  assert.match(providerError(401),/chave/i);
  assert.match(providerError(429),/cota/i);
  assert.match(providerError(404),/modelo/i);
});

test('Gemini usa modelo proprio e interpreta apenas texto dos candidates', async () => {
  const {defaultAIModel, parseGeminiResponse, geminiProviderError} = await import('../src/services/ai-provider-policy.js');
  assert.equal(defaultAIModel('gemini'), 'gemini-2.5-flash');
  assert.equal(parseAIModel('', 'gemini'), 'gemini-2.5-flash');
  assert.equal(parseGeminiResponse({candidates:[{content:{parts:[{text:'Resumo do grupo'},{thought:true,text:'interno'}]}}]}), 'Resumo do grupo');
  assert.match(geminiProviderError(429), /limite|cota/i);
});
