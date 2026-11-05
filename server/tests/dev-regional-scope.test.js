import test from 'node:test';
import assert from 'node:assert/strict';
import { REGIONS, REGION_CODES, matchesLegacyRegion } from '../src/services/regions.js';
import { admin, allowedChannelIds, conversationVisibility } from '../src/services/channel-scope-policy.js';

test('cadastro regional permite somente as seis empresas conhecidas', () => {
  assert.deepEqual(REGION_CODES, ['sao_paulo','rio_de_janeiro','brasilia','curitiba','estados_unidos','dubai']);
  assert.equal(REGIONS.brasilia, 'Brasília');
  assert.equal(matchesLegacyRegion('Imports BR - São Paulo', 'sao_paulo'), true);
  assert.equal(matchesLegacyRegion('Imports BR - Rio de Janeiro', 'sao_paulo'), false);
  assert.equal(matchesLegacyRegion('Curitiba', 'curitiba'), true);
});

test('Master e DEV enxergam os números da empresa; membro somente seu próprio número', async () => {
  const channels = [
    {id:'whatsapp-a',config:{owner_user_id:'alice'}},
    {id:'whatsapp-b',config:{owner_user_id:'bob'}},
    {id:'whatsapp-legacy',config:{}}
  ];
  const alice={orgId:'empresa-1',role:'comercial',user:{id:'alice'}};
  const master={orgId:'empresa-1',role:'master',user:{id:'master'}};
  const administrador={orgId:'empresa-1',role:'administrador',user:{id:'admin'}};
  const dev={orgId:'empresa-1',role:'dev',user:{id:'dev'}};
  assert.equal(admin(alice),false);
  assert.equal(admin(administrador),true);
  assert.deepEqual(allowedChannelIds(alice,channels),['whatsapp-a']);
  assert.deepEqual(allowedChannelIds(master,channels),['whatsapp-a','whatsapp-b','whatsapp-legacy']);
  assert.deepEqual(allowedChannelIds(dev,channels),['whatsapp-a','whatsapp-b','whatsapp-legacy']);
  assert.deepEqual(allowedChannelIds(administrador,channels),['whatsapp-a','whatsapp-b','whatsapp-legacy']);
  assert.deepEqual(conversationVisibility(alice,allowedChannelIds(alice,channels)),{
    org_id:'empresa-1',channel:'whatsapp',integration_id:{in:['whatsapp-a']}
  });
  assert.deepEqual(conversationVisibility(master,[]),{org_id:'empresa-1'});
  assert.deepEqual(conversationVisibility(administrador,[]),{org_id:'empresa-1'});
  assert.deepEqual(conversationVisibility(alice,[]),{org_id:'empresa-1',channel:'whatsapp',integration_id:{in:[]}});
});
