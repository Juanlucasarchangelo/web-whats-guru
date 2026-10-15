import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { prisma } from '../db.js';
import { HttpError, wrap } from '../http.js';
import { encrypt, providerUrl, providerFetch } from './integrations-restore.js';
import { configureEvolutionWebhook, getEvolutionWebhookInfo, syncEvolutionStatus } from '../services/evolution.js';
import { visibleChannelIds, admin } from '../services/channel-access.js';
const id=z.string().uuid();
const checkAdmin=req=>{if(!admin(req))throw new HttpError(403,'Somente administradores podem configurar numeros.');};
function safe(row){return {id:row.id,name:row.name,status:row.status,type:row.type,instance_name:row.config?.instance_name??null,provider:row.config?.provider??'meta',provider_url:row.config?.provider_url??null,team_ids:Array.isArray(row.config?.team_ids)?row.config.team_ids:[],display_phone_number:row.config?.display_phone_number??null};}
function webhookEndpoint(){
 const root=process.env.EVOLUTION_WEBHOOK_PUBLIC_URL?.trim().replace(/\/$/,'');
 const secret=process.env.EVOLUTION_WEBHOOK_SECRET?.trim();
 if(!root || !/^https?:\/\//.test(root) || !secret || secret.length<32)throw new HttpError(503,'Configure EVOLUTION_WEBHOOK_PUBLIC_URL e EVOLUTION_WEBHOOK_SECRET no server/.env e reinicie o backend.');
 return `${root}/api/webhooks/evolution/${encodeURIComponent(secret)}`;
}
export function channelsRouter(){
 const router=Router();
 router.get('/',wrap(async(req,res)=>{
  const ids=await visibleChannelIds(req);
  const rows=await prisma.integration.findMany({where:{org_id:req.orgId,type:'whatsapp',id:{in:ids}},orderBy:{created_at:'asc'}});
  res.json({data:rows.map(safe)});
 }));
 router.post('/attach',wrap(async(req,res)=>{
  checkAdmin(req);
  const data=z.object({provider_url:z.string().min(1),instance_name:z.string().regex(/^[\w-]{2,60}$/),api_key:z.string().min(1),name:z.string().trim().min(2).max(100).optional()}).strict().parse(req.body);
  const url=await providerUrl(data.provider_url);
  const existing=await prisma.integration.findMany({where:{type:'whatsapp'},select:{id:true,org_id:true,config:true}});
  const duplicate=existing.find(i=>i.config?.provider==='evolution_api'&&i.config?.instance_name===data.instance_name);
  if(duplicate){
   if(duplicate.org_id===req.orgId)throw new HttpError(409,'Esta instancia ja esta cadastrada na organizacao.');
   throw new HttpError(409,'Esta instancia ja pertence a outra organizacao.');
  }
  const headers={apikey:data.api_key.trim()};
  const response=await providerFetch(`${url}/instance/connectionState/${encodeURIComponent(data.instance_name)}`,{method:'GET',headers});
  const state=String(response?.instance?.state??'');
  if(!['open','connecting','close'].includes(state))throw new HttpError(409,'Instancia Evolution nao encontrada ou estado desconhecido. Verifique o nome no Evolution Manager.');
  const integration=await prisma.$transaction(async tx=>{
   const row=await tx.integration.create({data:{id:randomUUID(),org_id:req.orgId,type:'whatsapp',name:data.name??data.instance_name,
     config:{connection_mode:'unofficial',provider:'evolution_api',provider_url:url,instance_name:data.instance_name,team_ids:[]},
     status:state==='open'?'connected':state==='connecting'?'connecting':'disconnected',last_connected_at:state==='open'?new Date():null}});
   await tx.integrationCredential.create({data:{integration_id:row.id,org_id:req.orgId,access_token:encrypt(data.api_key.trim()),verify_token:encrypt(randomUUID())}});
   return row;
  });
  let webhook={ok:false,error:null};
  try {webhook=await configureEvolutionWebhook(req.orgId,webhookEndpoint(),integration.id);}
  catch(error){webhook={ok:false,error:String(error.message).slice(0,200)};console.warn('[Channels] Webhook nao configurado:',{instance:data.instance_name,error:error.message});}
  res.status(201).json({channel:safe(integration),webhook});
 }));
 router.post('/:id/webhook',wrap(async(req,res)=>{
  checkAdmin(req);const integrationId=id.parse(req.params.id);
  const item=await prisma.integration.findFirst({where:{id:integrationId,org_id:req.orgId,type:'whatsapp'}});
  if(!item || item.config?.provider!=='evolution_api')throw new HttpError(404,'Instancia Evolution nao encontrada.');
  const webhook=await configureEvolutionWebhook(req.orgId,webhookEndpoint(),integrationId);
  res.json({webhook,verification:await getEvolutionWebhookInfo(req.orgId,integrationId)});
 }));
 router.post('/:id/status',wrap(async(req,res)=>{
  const integrationId=id.parse(req.params.id);
  if(!(await visibleChannelIds(req)).includes(integrationId))throw new HttpError(404,'Numero nao encontrado ou sem acesso.');
  const result=await syncEvolutionStatus(req.orgId,integrationId);
  if(!result)throw new HttpError(404,'Instancia Evolution nao encontrada.');
  res.json(result);
 }));
 router.put('/:id/teams',wrap(async(req,res)=>{
  checkAdmin(req);const integrationId=id.parse(req.params.id);
  const {team_ids}=z.object({team_ids:z.array(z.string().uuid()).max(50)}).strict().parse(req.body);
  const row=await prisma.integration.findFirst({where:{id:integrationId,org_id:req.orgId,type:'whatsapp'}});
  if(!row)throw new HttpError(404,'Numero nao encontrado.');
  const selected=[...new Set(team_ids)];
  const valid=await prisma.team.count({where:{org_id:req.orgId,id:{in:selected}}});
  if(valid!==selected.length)throw new HttpError(400,'Um dos times informados nao pertence a empresa.');
  // Empty = unrestricted. Otherwise the chosen teams exclusively access this number.
  const result=await prisma.integration.update({where:{id:row.id},data:{config:{...row.config,team_ids:selected}}});
  res.json({channel:safe(result)});
 }));
 return router;
}
