import test from 'node:test';
import assert from 'node:assert/strict';
import { parseEvolutionConnectionResponse } from '../src/services/evolution-channel-policy.js';

test('Evolution retorna imagem QR embutida', () => {
  const image = `data:image/png;base64,${'a'.repeat(150)}`;
  assert.deepEqual(parseEvolutionConnectionResponse({ qrcode: { base64: image } }), {
    image, qrText: null, pairingCode: null,
  });
});
test('Evolution retorna codigo QR textual, geramos a imagem localmente', () => {
  const value = '2@abcdEFGH+/qrcontent123456';
  assert.equal(parseEvolutionConnectionResponse({ code: value }).qrText, value);
});
test('Evolution retorna payload com data aninhado e pairingCode', () => {
  const result = parseEvolutionConnectionResponse({ data: { pairingCode: 'ABCD1234', code: '2@abcdefghijkLMNOP' } });
  assert.equal(result.pairingCode, 'ABCD1234');
  assert.equal(result.qrText, '2@abcdefghijkLMNOP');
});
test('Evita exibir URLs remotas como imagem QR no navegador', () => {
  const result = parseEvolutionConnectionResponse({ base64: 'https://malicious.example/qr.png' });
  assert.equal(result.image, null);
});
