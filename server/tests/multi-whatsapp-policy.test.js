import test from 'node:test';
import assert from 'node:assert/strict';
import { mayAccessChannel } from '../src/services/channel-policy.js';
import { stableMessageId } from '../src/services/evolution-payload.js';
test('administradores visualizam canais restritos',()=>{
 assert.equal(mayAccessChannel('owner',['vendas'],[]),true);
 assert.equal(mayAccessChannel('admin',['vendas'],[]),true);
});
test('atendentes podem acessar canais liberados ou do proprio time',()=>{
 assert.equal(mayAccessChannel('agent',[],[]),true);
 assert.equal(mayAccessChannel('agent',['vendas'],new Set(['vendas'])),true);
 assert.equal(mayAccessChannel('agent',['suporte'],new Set(['vendas'])),false);
 assert.equal(mayAccessChannel('agent',['financeiro'],new Set()),false);
});
test('IDs de mensagens de duas instancias nao se misturam',()=>{
 const legacy=stableMessageId('IDTESTE');
 const other=stableMessageId('canaId2:IDTESTE');
 assert.notEqual(legacy,other);
 assert.equal(stableMessageId('canaId2:IDTESTE'),other);
});
