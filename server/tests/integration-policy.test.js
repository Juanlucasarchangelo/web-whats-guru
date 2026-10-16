import test from 'node:test';
import assert from 'node:assert/strict';
import { findMatchingIntegration } from '../src/services/integration-policy.js';
const evo = { id: 'evolution', config: { provider: 'evolution_api', provider_url: 'http://127.0.0.1:8080', instance_name: 'whats-guru' } };
const meta = { id: 'meta', config: { connection_mode: 'official', phone_number_id: '1234' } };
test('configuracao Meta nunca sobrescreve instancias Evolution', () => {
  assert.equal(findMatchingIntegration([evo], 'whatsapp', { connection_mode: 'official', phone_number_id: '5678' }), null);
  assert.equal(findMatchingIntegration([evo,meta], 'whatsapp', { connection_mode: 'official', phone_number_id: '1234' })?.id, 'meta');
});
test('uma Evolution e identificada por URL mais nome da instancia', () => {
  assert.equal(findMatchingIntegration([evo,meta], 'whatsapp', {...evo.config})?.id, 'evolution');
  assert.equal(findMatchingIntegration([evo,meta], 'whatsapp', {...evo.config, instance_name: 'Vendas'}), null);
});
