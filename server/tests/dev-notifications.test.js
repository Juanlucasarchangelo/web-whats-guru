import test from 'node:test';
import assert from 'node:assert/strict';
import { notifyDevRequest } from '../src/services/dev-notifications.js';

test('Novo cadastro permanece pendente mesmo quando notificacao nao foi configurada',async()=>{
  const env=Object.fromEntries(['DEV_NOTIFICATION_EMAIL','RESEND_API_KEY','RESEND_FROM_EMAIL'].map(k=>[k,process.env[k]]));
  try{
    for(const k of Object.keys(env))delete process.env[k];
    assert.equal(await notifyDevRequest({email:'demo@example.com',fullName:'Usuário Teste',createdAt:'2026-11-04'}),false);
  }finally{for(const [k,v] of Object.entries(env))if(v===undefined)delete process.env[k];else process.env[k]=v;}
});

test('Notificacao envia dados do solicitante sem senha a API segura do provedor',async()=>{
  const oldFetch=globalThis.fetch;
  const env=Object.fromEntries(['DEV_NOTIFICATION_EMAIL','RESEND_API_KEY','RESEND_FROM_EMAIL'].map(k=>[k,process.env[k]]));
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
    assert.equal(Object.hasOwn(payload,'password'),false);
  }finally{
    globalThis.fetch=oldFetch;
    for(const [k,v] of Object.entries(env))if(v===undefined)delete process.env[k];else process.env[k]=v;
  }
});
