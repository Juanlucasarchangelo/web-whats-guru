import { Router } from 'express';
import { randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { prisma } from '../db.js';
import { HttpError, wrap } from '../http.js';
import { encrypt, providerFetch, providerUrl } from './integrations-restore.js';
import { configureEvolutionWebhook } from '../services/evolution.js';

const uuid=z.string().uuid();
const ownerSelection=z.object({org_id:uuid,owner_user_id:uuid});
const evolutionSchema=ownerSelection.extend({
  provider_url:z.string().trim().min(1).max(300),
  instance_name:z.string().regex(/^[\w-]{2,60}$/),
  name:z.string().trim().min(2).max(100).optional(),
  api_key:z.string().trim().min(8).max(4096),
}).strict();
const metaSchema=ownerSelection.extend({
  name:z.string().trim().min(2).max(100).optional(),
  phone_number_id:z.string().regex(/^\d{5,30}$/),
  business_account_id:z.string().regex(/^\d{5,30}$/),
  access_token:z.string().trim().min(10).max(8192),
  app_secret:z.string().trim().min(1).max(4096).optional(),
}).strict();

async function assertActiveOwner(orgId,userId){
  const [org,member]=await Promise.all([
    prisma.organization.findFirst({where:{id:orgId,status:'active'},select:{id:true}}),
    prisma.orgMember.findFirst({where:{org_id:orgId,user_id:userId,status:'active',users:{is_active:true,approval_status:'approved',global_role:{not:'dev'}}},select:{id:true}}),
  ]);
  if(!org)throw new HttpError(404,'Empresa de destino nao encontrada ou inativa.');
  if(!member)throw new HttpError(400,'Selecione um usuario aprovado e ativo, com vinculo na empresa escolhida.');
}
async function assertFreeIdentifier(provider,field,value){
  const rows=await prisma.integration.findMany({where:{type:'whatsapp'},select:{id:true,config:true}});
  if(rows.some(i=>(i.config?.provider===provider||(provider==='meta'&&i.config?.connection_mode==='official'))&&i.config?.[field]===value)){
    throw new HttpError(409,'Esta identificacao de WhatsApp ja esta cadastrada. Use a opcao de atribuir responsavel para uma integracao existente.');
  }
}
const withoutSecrets=row=>({
  id:row.id,org_id:row.org_id,name:row.name,status:row.status,
  provider:row.config?.provider??(row.config?.connection_mode==='official'?'meta':'desconhecido'),
  owner_user_id:row.config?.owner_user_id??null,
  instance_name:row.config?.instance_name??null,
  phone_number_id:row.config?.phone_number_id??null,
  display_phone_number:row.config?.display_phone_number??null,
});
function webhookEndpoint(){
  const root=process.env.EVOLUTION_WEBHOOK_PUBLIC_URL?.trim().replace(/\/$/,'');
  const secret=process.env.EVOLUTION_WEBHOOK_SECRET?.trim();
  if(!root||!/^https?:\/\//.test(root)||!secret||secret.length<32)
    throw new HttpError(503,'Webhook Evolution indisponivel. Configure EVOLUTION_WEBHOOK_PUBLIC_URL e EVOLUTION_WEBHOOK_SECRET no backend.');
  return `${root}/api/webhooks/evolution/${encodeURIComponent(secret)}`;
}
const activity=(tx,actor,action,orgId,channelId,userId)=>tx.devActivity.create({data:{
  id:randomUUID(),actor_id:actor,action,target_user_id:userId,
  details:{org_id:orgId,integration_id:channelId},
}});

// Must only be mounted behind devRouter.requireDev. Never exposes integration credentials or QR tokens.
export function devIntegrationsRouter(){
  const router=Router();
  router.get('/members',wrap(async(req,res)=>{
    const orgId=uuid.parse(req.query.org_id);
    const list=await prisma.orgMember.findMany({where:{org_id:orgId,status:'active',users:{is_active:true,approval_status:'approved',global_role:{not:'dev'}}},
      select:{user_id:true,role:true,users:{select:{email:true,user_profiles:{select:{full_name:true}}}}},orderBy:{created_at:'asc'},take:500});
    res.json({data:list.map(m=>({id:m.user_id,email:m.users.email,name:m.users.user_profiles?.full_name||m.users.email,role:m.role}))});
  }));
  router.get('/',wrap(async(req,res)=>{
    const orgId=uuid.parse(req.query.org_id);
    const list=await prisma.integration.findMany({where:{org_id:orgId,type:'whatsapp'},orderBy:{created_at:'asc'},take:200});
    res.set('Cache-Control','no-store');
    res.json({data:list.map(withoutSecrets)});
  }));
  router.post('/evolution',wrap(async(req,res)=>{
    const data=evolutionSchema.parse(req.body||{});
    await assertActiveOwner(data.org_id,data.owner_user_id);
    await assertFreeIdentifier('evolution_api','instance_name',data.instance_name);
    const url=await providerUrl(data.provider_url);
    // Administrative provisioning: verify an EXISTING instance. Never ask Evolution to
    // connect WhatsApp or generate QR; only the assigned end user may do that.
    const info=await providerFetch(`${url}/instance/connectionState/${encodeURIComponent(data.instance_name)}`,{
      method:'GET',headers:{apikey:data.api_key},
    });
    const state=String(info?.instance?.state??'');
    if(!['open','connecting','close'].includes(state))throw new HttpError(409,'Instancia nao encontrada ou resposta invalida da Evolution. Crie a instancia no Evolution Manager antes.');
    const created=await prisma.$transaction(async tx=>{
      const row=await tx.integration.create({data:{id:randomUUID(),org_id:data.org_id,type:'whatsapp',
        name:data.name||data.instance_name,
        config:{connection_mode:'unofficial',provider:'evolution_api',provider_url:url,
          instance_name:data.instance_name,owner_user_id:data.owner_user_id,team_ids:[]},
        status:state==='open'?'connected':state==='connecting'?'connecting':'disconnected',
        last_connected_at:state==='open'?new Date():null,
      }});
      await tx.integrationCredential.create({data:{integration_id:row.id,org_id:data.org_id,
        access_token:encrypt(data.api_key),verify_token:encrypt(randomUUID())}});
      await activity(tx,req.user.id,'integration_provisioned_evolution',data.org_id,row.id,data.owner_user_id);
      return row;
    });
    let webhook={ok:false,error:null};
    try{webhook=await configureEvolutionWebhook(data.org_id,webhookEndpoint(),created.id);}
    catch(error){webhook={ok:false,error:'Nao foi possivel configurar o webhook. Confira configuracao do backend e Evolution.'};
      console.warn('[DEV] Webhook Evolution pendente:',{integration_id:created.id,error:error.message});}
    res.status(201).json({channel:withoutSecrets(created),webhook,
      next_step:created.status==='connected'?'Instancia ja esta conectada.':'O usuario deve acessar sua Caixa de Entrada e escanear o QR Code.'});
  }));
  router.post('/meta',wrap(async(req,res)=>{
    const data=metaSchema.parse(req.body||{});
    await assertActiveOwner(data.org_id,data.owner_user_id);
    await assertFreeIdentifier('meta','phone_number_id',data.phone_number_id);
    // Meta Cloud API uses credentials and a Meta webhook, NOT a QR-code pairing flow.
    const graphVersion=process.env.WHATSAPP_API_VERSION?.trim()||'v26.0';
    if(!/^v\d+\.\d+$/.test(graphVersion))throw new HttpError(503,'WHATSAPP_API_VERSION invalida no backend.');
    let response;
    try{response=await fetch(`https://graph.facebook.com/${graphVersion}/${encodeURIComponent(data.phone_number_id)}?fields=display_phone_number,verified_name`,{
      headers:{Authorization:`Bearer ${data.access_token}`},signal:AbortSignal.timeout(15000),redirect:'error'});}
    catch{throw new HttpError(502,'Nao foi possivel validar o token na Meta.');}
    if(!response.ok)throw new HttpError(502,`Meta recusou o cadastro do numero (HTTP ${response.status}).`);
    const meta=await response.json().catch(()=>({}));
    if(!meta.id&&!meta.display_phone_number)throw new HttpError(502,'A Meta nao confirmou os dados do telefone.');
    const verify=randomBytes(24).toString('hex');
    const created=await prisma.$transaction(async tx=>{
      const row=await tx.integration.create({data:{id:randomUUID(),org_id:data.org_id,type:'whatsapp',
        name:data.name||'WhatsApp Business Platform',status:'connecting',last_connected_at:null,
        config:{connection_mode:'official',provider:'meta',owner_user_id:data.owner_user_id,
          phone_number_id:data.phone_number_id,business_account_id:data.business_account_id,
          display_phone_number:meta.display_phone_number??'',verified_name:meta.verified_name??''},
      }});
      await tx.integrationCredential.create({data:{integration_id:row.id,org_id:data.org_id,
        access_token:encrypt(data.access_token),verify_token:encrypt(verify),
        app_secret:data.app_secret?encrypt(data.app_secret):null}});
      await activity(tx,req.user.id,'integration_provisioned_meta',data.org_id,row.id,data.owner_user_id);
      return row;
    });
    res.set('Cache-Control','no-store');
    res.status(201).json({channel:withoutSecrets(created),webhook_verify_token:verify,
      next_step:'Credenciais Meta registradas e validadas, mas o numero ainda nao esta operacional. Configure o webhook e o suporte multiempresa da Meta no backend. A Meta nao utiliza QR Code.'});
  }));
  router.patch('/:id/owner',wrap(async(req,res)=>{
    const integrationId=uuid.parse(req.params.id);
    const {owner_user_id}=z.object({owner_user_id:uuid}).strict().parse(req.body||{});
    const integration=await prisma.integration.findFirst({where:{id:integrationId,type:'whatsapp'},select:{id:true,org_id:true,config:true}});
    if(!integration)throw new HttpError(404,'Integracao nao encontrada.');
    await assertActiveOwner(integration.org_id,owner_user_id);
    const result=await prisma.$transaction(async tx=>{
      const updated=await tx.integration.update({where:{id:integrationId},data:{config:{...integration.config,owner_user_id}}});
      await activity(tx,req.user.id,'integration_owner_updated',integration.org_id,integrationId,owner_user_id);
      return updated;
    });
    res.json({channel:withoutSecrets(result)});
  }));
  return router;
}
