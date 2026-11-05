import test from 'node:test';
import assert from 'node:assert/strict';
import { deliveryStatus, newerDeliveryStatus, extractReceipt, initialDeliveryStatus } from '../src/services/evolution-message-status.js';

test('converte acknowledgements Evolution 2.3.7 em estados da Caixa de Entrada', () => {
  assert.equal(deliveryStatus('SERVER_ACK'), 'sent');
  assert.equal(deliveryStatus('DELIVERY_ACK'), 'delivered');
  assert.equal(deliveryStatus('READ'), 'read');
  assert.equal(deliveryStatus(4), 'read');
  assert.equal(deliveryStatus('PLAYED'), 'played');
  assert.equal(deliveryStatus('ERROR'), 'failed');
});
test('eventos antigos nao retrocedem entrega ou leitura', () => {
  assert.equal(newerDeliveryStatus('sent', 'delivered'), 'delivered');
  assert.equal(newerDeliveryStatus('delivered', 'read'), 'read');
  assert.equal(newerDeliveryStatus('read', 'DELIVERY_ACK'), null);
  assert.equal(newerDeliveryStatus('accepted', 'ERROR'), 'failed');
  assert.equal(newerDeliveryStatus('read', 'ERROR'), null);
});
test('extrai keyId do evento messages.update sem confundir com id interno', () => {
  assert.deepEqual(extractReceipt({ keyId: 'WAPP_1', messageId: 'internal', status: 'READ', fromMe: true }), {
    providerId: 'WAPP_1', status: 'read',
  });
  assert.deepEqual(extractReceipt({ key: { id: 'WAPP_2', fromMe: true }, status: 'DELIVERY_ACK' }), {
    providerId: 'WAPP_2', status: 'delivered',
  });
  assert.equal(extractReceipt({ keyId: 'WAPP_1', status: 'READ', fromMe: false }), null);
  assert.equal(extractReceipt({ keyId: 'WAPP_1', status: 'READ' })?.status, 'read');
});
test('usa status de entrega informado pelo historico da Evolution', () => {
  assert.equal(initialDeliveryStatus({ status: 'SERVER_ACK', MessageUpdate: [{ status: 'READ' }] }), 'read');
  assert.equal(initialDeliveryStatus({ status: 'DELIVERY_ACK' }), 'delivered');
  assert.equal(initialDeliveryStatus({}), 'sent');
});
