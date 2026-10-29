import test from 'node:test';
import assert from 'node:assert/strict';
import { technicalDocumentSchemas } from '../src/services/technical-document-schemas.js';
import { SYSTEM_ROLES, PERMISSIONS } from '../src/services/permissions.js';
const odd = {
  coordenador: 'Coordenador', data: '2026-10-29', cliente: 'Cliente A',
  endereco: 'Rua A, 10', numeroProposta: 'PROP-01',
  tecnicos: [{ nome: 'Técnico', funcao: 'Automação' }], objetivos: ['Configurar sistema'], observacoes: '',
};
const report = {
  cliente: 'Cliente A', data: '2026-10-29', operacao: 'São Paulo',
  endereco: 'Rua A, 10', numeroOdd: '001', tecnicos: ['Técnico'],
  status: 'parcial', servico: 'Testes realizados', pendencias: ['Conferir cabeamento'],
  observacoes: '', fotos: [],
};
const uuid = '123e4567-e89b-42d3-a456-426614174000';
test('Permissão de Monitoramento está no catálogo e apenas Master recebe por padrão', () => {
  assert.ok(PERMISSIONS.some(p => p.key === 'page.monitoring'));
  for (const role of SYSTEM_ROLES) {
    assert.equal(role.permissions.includes('page.monitoring'), role.slug === 'master');
  }
});
test('Formulário de ODD válido inclui proposta opcional e identifica requisição', () => {
  const data = technicalDocumentSchemas.requestSchema.parse({ doc_type: 'odd', payload: odd, client_request_id: uuid });
  assert.equal(data.payload.numeroProposta, 'PROP-01');
  assert.equal(technicalDocumentSchemas.oddSchema.parse({ ...odd, numeroProposta: undefined }).numeroProposta, '');
});
test('Relatório técnico suporta vínculo opcional com ODD e fotografias JPEG', () => {
  const data = technicalDocumentSchemas.requestSchema.parse({ doc_type: 'technical_report', payload: report, client_request_id: uuid });
  assert.equal(data.payload.numeroOdd, '001');
  assert.equal(technicalDocumentSchemas.reportSchema.parse({ ...report, numeroOdd: undefined }).numeroOdd, '');
});
test('Rejeita data inválida, payload de tipo incompatível, fotografia não JPEG ou campos extras', () => {
  assert.equal(technicalDocumentSchemas.oddSchema.safeParse({ ...odd, data: '2026-02-30' }).success, false);
  assert.equal(technicalDocumentSchemas.requestSchema.safeParse({ doc_type: 'odd', payload: report, client_request_id: uuid }).success, false);
  assert.equal(technicalDocumentSchemas.reportSchema.safeParse({ ...report, fotos: [{ dataUrl:'data:image/png;base64,AAA=', name:'Foto', width:10, height:10 }] }).success, false);
  assert.equal(technicalDocumentSchemas.oddSchema.safeParse({ ...odd, creator_user_id:'fake' }).success, false);
});
