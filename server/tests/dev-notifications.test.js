import test from 'node:test';
import assert from 'node:assert/strict';
import { notifyDevRequest, devApprovalUrl } from '../src/services/dev-notifications.js';

test('Novo cadastro permanece pendente mesmo quando notificacao nao foi configurada',async()=>{
  const env=Object.fromEntries(['DEV_NOTIFICATION_EMAIL','RESEND_API_KEY','RESEND_FROM_EMAIL','DEV_PANEL_URL'].map(k=>[k,process.env[k]]));
  try{
    for(const k of Object.keys(env))delete process.env[k];
    assert.equal(await notifyDevRequest({email:'demo@example.com',fullName:'Usuário Teste',createdAt:'2026-11-04'}),false);
  }finally{for(const [k,v] of Object.entries(env))if(v===undefined)delete process.env[k];else process.env[k]=v;}
});

test('Notificacao envia dados do solicitante sem senha a API segura do provedor',async()=>{
  const oldFetch=globalThis.fetch;
  const env=Object.fromEntries(['DEV_NOTIFICATION_EMAIL','RESEND_API_KEY','RESEND_FROM_EMAIL','DEV_PANEL_URL'].map(k=>[k,process.env[k]]));
  let payload;
  try{
    process.env.DEV_NOTIFICATION_EMAIL='dev@example.com';
    process.env.RESEND_FROM_EMAIL='noreply@example.com';
    process.env.RESEND_API_KEY='mock-secret';
    globalThis.fetch=async(url,options)=>{
      assert.equal(url,'https://api.resend.com/emails');
      assert.equal(options.method,'POST');
      assert.equal(options.headers.Authorization,'Bearer mock-secret');
      payload=JSON.parse(options.body);
      return {ok:true};
    };
    assert.equal(await notifyDevRequest({email:'novo@example.com',fullName:'Novo Cadastro',createdAt:'2026-11-04'}),true);
    assert.deepEqual(payload.to,['dev@example.com']);
    assert.equal(payload.text.includes('novo@example.com'),true);
    assert.equal(payload.text.includes('https://falacomigo.importsbr.cloud/?page=devConsole&tab=pending'),true);
    assert.equal(payload.html.includes('Abrir aprovações no FalaComigo'),true);
    assert.equal(payload.html.includes('href=\"https://falacomigo.importsbr.cloud/?page=devConsole&amp;tab=pending\"'),true);
    assert.equal(Object.hasOwn(payload,'password'),false);
  }finally{
    globalThis.fetch=oldFetch;
    for(const [k,v] of Object.entries(env))if(v===undefined)delete process.env[k];else process.env[k]=v;
  }
});

test('Link de aprovacao aceita endereco configurado e adiciona o destino DEV',()=>{
 const previous=process.env.DEV_PANEL_URL;
 try{
   process.env.DEV_PANEL_URL='http://localhost:5173/app?lang=pt';
   assert.equal(devApprovalUrl(),'http://localhost:5173/app?lang=pt&page=devConsole&tab=pending');
   process.env.DEV_PANEL_URL='javascript:alert(1)';
   assert.equal(devApprovalUrl(),'https://falacomigo.importsbr.cloud/?page=devConsole&tab=pending');
 }finally{if(previous===undefined)delete process.env.DEV_PANEL_URL;else process.env.DEV_PANEL_URL=previous;}
});

test('HTML do aviso nao executa codigo vindo do nome do solicitante',async()=>{
 const original=globalThis.fetch;
 const previous=Object.fromEntries(['DEV_NOTIFICATION_EMAIL','RESEND_FROM_EMAIL','RESEND_API_KEY'].map(k=>[k,process.env[k]]));
 try{
   process.env.DEV_NOTIFICATION_EMAIL='dev@example.com';
   process.env.RESEND_FROM_EMAIL='noreply@example.com';
   process.env.RESEND_API_KEY='fake-key';
   let body;
   globalThis.fetch=async(_url,opts)=>{body=JSON.parse(opts.body);return {ok:true};};
   await notifyDevRequest({fullName:'<script>alert(1)</script>',email:'novo@example.com',createdAt:'2026-11-05'});
   assert.equal(body.html.includes('<script>'),false);
   assert.equal(body.html.includes('&lt;script&gt;'),true);
 }finally{globalThis.fetch=original;for(const [k,v] of Object.entries(previous))if(v===undefined)delete process.env[k];else process.env[k]=v;}
});
