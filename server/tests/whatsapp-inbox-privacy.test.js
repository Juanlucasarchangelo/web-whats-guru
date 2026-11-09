import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { allowedChannelIds, inboxAccessibleChannelIds, conversationVisibility } from '../src/services/channel-scope-policy.js';

const channels = [
  { id: 'w-a', config: { owner_user_id: 'a' } },
  { id: 'w-b', config: { owner_user_id: 'b' } },
];
const req = (role, id) => ({ orgId: 'org-1', role, user: { id } });

test('Administrador so recebe a propria instancia (nao as de outros usuarios)', () => {
  const who = req('administrador', 'a');
  assert.deepEqual(allowedChannelIds(who, channels), ['w-a','w-b']); // Contatos e Integrações continuam com visão gerencial.
  const ids = inboxAccessibleChannelIds(who, channels);
  assert.deepEqual(ids, ['w-a']);
  assert.deepEqual(conversationVisibility(who, ids), {
    org_id: 'org-1', OR: [
      { channel: 'whatsapp', integration_id: { in: ['w-a'] } },
      { channel: { not: 'whatsapp' }, assigned_to: 'a' },
    ],
  });
});

test('Master e DEV veem todas as instancias existentes da empresa', () => {
  for (const role of ['master', 'dev']) {
    const who = req(role, 'gestor');
    assert.deepEqual(allowedChannelIds(who, channels), ['w-a','w-b']);
    assert.deepEqual(conversationVisibility(who, ['w-a','w-b']), {
      org_id:'org-1', OR:[
        {channel:'whatsapp',integration_id:{in:['w-a','w-b']}},
        {channel:{not:'whatsapp'}},
      ],
    });
  }
});

test('Instancia excluida nao aparece para nenhum perfil, mas banco permanece intocado', () => {
  const now = channels.filter(c => c.id !== 'w-b');
  for (const who of [req('master','gestor'),req('dev','dev'),req('administrador','b'),req('comercial','b')]) {
    const allowed = inboxAccessibleChannelIds(who, now);
    assert.equal(JSON.stringify(conversationVisibility(who, allowed)).includes('w-b'),false);
  }
});

test('Sincronizacao usa caminho real da API e informa progresso', () => {
  const screen = readFileSync(new URL('../../src/pages/InboxPage.tsx',import.meta.url),'utf8');
  const routes = readFileSync(new URL('../src/routes/channels.js',import.meta.url),'utf8');
  assert.match(screen, /syncableChannel\.id}\/sync-contacts/);
  assert.doesNotMatch(screen, /syncableChannel\.id}\/contact-sync/);
  assert.match(routes, /post\('\/:id\/sync-contacts'/);
  assert.ok(routes.includes("req.query.inbox==='1'?await inboxChannelIds(req)"));
  assert.ok(routes.includes("contact_sync:row.config?.provider==='evolution_api'?getEvolutionBootstrapStatus"));
});

test('API segura mensagens, tags e lista com o escopo correto, carregando o contato', () => {
  const local = readFileSync(new URL('../src/routes/local-data.js',import.meta.url),'utf8');
  const direct = readFileSync(new URL('../src/routes/conversations.js',import.meta.url),'utf8');
  assert.match(local,/table==='conversations'\) return .*conversationScope/);
  assert.match(local,/table==='messages'\|\|table==='internal_notes'/);
  assert.match(direct,/const where = await conversationScope\(req\)/);
  assert.match(direct,/org_id:req.orgId,id:\{in:rows.map/);
  assert.match(direct,/contact:names.get\(row.contact_id\)/);
  assert.match(direct,/has_more: page \* limit < total/);
});
