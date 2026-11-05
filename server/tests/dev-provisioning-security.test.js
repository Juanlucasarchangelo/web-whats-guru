import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { prisma } from '../src/db.js';
import { devRouter } from '../src/routes/dev.js';
import { channelsRouter } from '../src/routes/channels.js';
import { restoredIntegrationsRouter } from '../src/routes/integrations-restore.js';
import { errorHandler } from '../src/http.js';

const org='11111111-1111-4111-8111-111111111111';
const owner='22222222-2222-4222-8222-222222222222';
const dev='33333333-3333-4333-8333-333333333333';
const channel='44444444-4444-4444-8444-444444444444';
async function requestWithRole(role,method,path,body){
  const app=express();app.use(express.json());
  app.use((req,_res,next)=>{req.user={id:dev,global_role:role};req.orgId=org;req.role=role;req.permissions=['page.inbox','page.team','page.settings'];next();});
  app.use('/dev',devRouter());app.use('/channels',channelsRouter());app.use('/integrations',restoredIntegrationsRouter());app.use(errorHandler);
  const server=await new Promise(resolve=>{const s=app.listen(0,()=>resolve(s));});
  try{
    const response=await fetch(`http://127.0.0.1:${server.address().port}${path}`,{
      method,headers:{'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),
    });
    await response.clone().text();
    return response;
  } finally {await new Promise(resolve=>server.close(resolve));}
}

test('Non-DEV cannot call the DEV provisioning endpoints',async()=>{
  const response=await requestWithRole('master','GET',`/dev/integrations?org_id=${org}`);
  assert.equal(response.status,403);
});
test('DEV list shows channel ownership but never stored provider credentials',async()=>{
  const original=prisma.integration.findMany;
  prisma.integration.findMany=async()=>[{id:channel,org_id:org,type:'whatsapp',name:'Marketing',status:'disconnected',config:{provider:'evolution_api',instance_name:'marketing',owner_user_id:owner,provider_url:'https://evo.example.com',api_key:'NEVER_SHOW'}}];
  try{
    const response=await requestWithRole('dev','GET',`/dev/integrations?org_id=${org}`);
    assert.equal(response.status,200);
    const body=await response.json();
    assert.equal(body.data[0].owner_user_id,owner);
    assert.equal(body.data[0].instance_name,'marketing');
    assert.equal(JSON.stringify(body).includes('NEVER_SHOW'),false);
    assert.equal(JSON.stringify(body).includes('provider_url'),false);
  } finally {prisma.integration.findMany=original;}
});
test('DEV cannot use the ordinary Evolution QR or attach endpoints',async()=>{
  for(const [method,path,body] of [
    ['POST','/channels/attach',{provider_url:'https://evo.example.com',instance_name:'marketing',api_key:'abc'}],
    ['POST',`/channels/${channel}/qr`,{}],
    ['POST',`/channels/${channel}/logout`,{confirm_instance:'marketing'}],
    ['POST','/integrations/whatsapp',{action:'connect_unofficial'}],
  ]){
    const response=await requestWithRole('dev',method,path,body);
    assert.equal(response.status,403,`${method} ${path}`);
  }
});
test('DEV cannot provision for user not belonging to the selected company',async()=>{
  const previousOrg=prisma.organization.findFirst;
  const previousMember=prisma.orgMember.findFirst;
  prisma.organization.findFirst=async()=>({id:org});
  prisma.orgMember.findFirst=async()=>null;
  try{
    const response=await requestWithRole('dev','POST','/dev/integrations/evolution',{
      org_id:org,owner_user_id:owner,provider_url:'https://evo.example.com',instance_name:'marketing',api_key:'valid-api-key',
    });
    assert.equal(response.status,400);
  } finally {prisma.organization.findFirst=previousOrg;prisma.orgMember.findFirst=previousMember;}
});
test('DEV rejects re-registering the same Evolution instance',async()=>{
  const previousOrg=prisma.organization.findFirst;
  const previousMember=prisma.orgMember.findFirst;
  const previousList=prisma.integration.findMany;
  prisma.organization.findFirst=async()=>({id:org});
  prisma.orgMember.findFirst=async()=>({id:owner});
  prisma.integration.findMany=async()=>[{id:channel,org_id:org,config:{provider:'evolution_api',instance_name:'marketing'}}];
  try{
    const response=await requestWithRole('dev','POST','/dev/integrations/evolution',{
      org_id:org,owner_user_id:owner,provider_url:'https://evo.example.com',instance_name:'marketing',api_key:'valid-api-key',
    });
    assert.equal(response.status,409);
  } finally {prisma.organization.findFirst=previousOrg;prisma.orgMember.findFirst=previousMember;prisma.integration.findMany=previousList;}
});
