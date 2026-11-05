import { Router } from 'express';
import { can, isMaster } from '../services/permissions.js';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { prisma } from '../db.js';
import { HttpError, wrap } from '../http.js';
import { encrypt, providerUrl, providerFetch } from './integrations-restore.js';
import { configureEvolutionWebhook, getEvolutionWebhookInfo, syncEvolutionStatus } from '../services/evolution.js';
import { getEvolutionConnectionQr, logoutEvolutionChannel } from '../services/evolution-channel.js';
import { visibleChannelIds } from '../services/channel-access.js';
import { queueEvolutionBootstrap, getEvolutionBootstrapStatus } from '../services/evolution-sync.js';
const id=z.string().uuid();
const checkAdmin=req=>{if(!isMaster(req))throw new HttpError(403,'Somente Master ou DEV pode alterar acessos a numeros.');};
const checkOwnAccess=req=>{if(req.user?.global_role==='dev')throw new HttpError(403,'DEV nao conecta WhatsApp. Use Administracao DEV para cadastrar instancias para usuarios.');if(!can(req,'page.inbox'))throw new HttpError(403,'Sem permissao para conectar um WhatsApp.');};
const checkChannel=async(req,channelId)=>{const row=await prisma.integration.findFirst({where:{id:channelId,org_id:req.orgId,type:'whatsapp'}});if(!row||(!isMaster(req)&&row.config?.owner_user_id!==req.user.id))throw new HttpError(404,'Numero nao encontrado ou sem acesso.');return row;};
function safe(row){return {owner_user_id:row.config?.owner_user_id??null,id:row.id,name:row.name,status:row.status,type:row.type,instance_name:row.config?.instance_name??null,provider:row.config?.provider??'meta',provider_url:row.config?.provider_url??null,team_ids:Array.isArray(row.config?.team_ids)?row.config.team_ids:[],display_phone_number:row.config?.display_phone_number??null};}
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
  // Show the real Evolution state, not a cached status changed only in MySQL.
  const data=await Promise.all(rows.map(async row=>{
    if(row.config?.provider!=='evolution_api')return safe(row);
    try{
      const state=await syncEvolutionStatus(req.orgId,row.id);
      if (state?.status === 'connected') queueEvolutionBootstrap({ orgId: req.orgId, integrationId: row.id });
      return {...safe(row),status:state?.status??row.status,status_error:null,
        contact_sync: getEvolutionBootstrapStatus(req.orgId, row.id)};
    }catch(error){
      console.warn('[Channels] Falha ao consultar estado:',{id:row.id,error:error.message});
      return {...safe(row),status_error:'Nao foi possivel consultar a Evolution agora.'};
    }
  }));
  res.json({data});
 }));
 router.post('/attach',wrap(async(req,res)=>{
  checkOwnAccess(req);
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
     config:{connection_mode:'unofficial',provider:'evolution_api',provider_url:url,instance_name:data.instance_name,owner_user_id:req.user.id,team_ids:[]},
     status:state==='open'?'connected':state==='connecting'?'connecting':'disconnected',last_connected_at:state==='open'?new Date():null}});
   await tx.integrationCredential.create({data:{integration_id:row.id,org_id:req.orgId,access_token:encrypt(data.api_key.trim()),verify_token:encrypt(randomUUID())}});
   return row;
  });
  let webhook={ok:false,error:null};
  try {webhook=await configureEvolutionWebhook(req.orgId,webhookEndpoint(),integration.id);}
  catch(error){webhook={ok:false,error:String(error.message).slice(0,200)};console.warn('[Channels] Webhook nao configurado:',{instance:data.instance_name,error:error.message});}
  res.status(201).json({channel:safe(integration),webhook});
 }));
 router.get('/:id/contact-sync',wrap(async(req,res)=>{
  const integrationId=id.parse(req.params.id);
  await checkChannel(req,integrationId);
  res.json({sync:getEvolutionBootstrapStatus(req.orgId,integrationId)});
 }));
 router.post('/:id/contact-sync',wrap(async(req,res)=>{
  const integrationId=id.parse(req.params.id);
  const row=await checkChannel(req,integrationId);
  if(row.config?.provider!=='evolution_api')throw new HttpError(400,'Sincronizacao disponivel somente para Evolution.');
  const state=await syncEvolutionStatus(req.orgId,integrationId);
  if(state?.status!=='connected')throw new HttpError(409,'Conecte o WhatsApp primeiro.');
  res.status(202).json({sync:queueEvolutionBootstrap({orgId:req.orgId,integrationId,force:true})});
 }));
 router.post('/:id/qr',wrap(async(req,res)=>{
  checkOwnAccess(req);const integrationId=id.parse(req.params.id);
  const row=await checkChannel(req,integrationId);
  if(!row || row.config?.provider!=='evolution_api')throw new HttpError(404,'Instancia Evolution nao encontrada.');
  res.set('Cache-Control','no-store');
  res.json(await getEvolutionConnectionQr(req.orgId,integrationId));
 }));
 router.post('/:id/logout',wrap(async(req,res)=>{
  checkOwnAccess(req);const integrationId=id.parse(req.params.id);
  const row=await checkChannel(req,integrationId);
  if(!row || row.config?.provider!=='evolution_api')throw new HttpError(404,'Instancia Evolution nao encontrada.');
  const confirmation=z.object({confirm_instance:z.string()}).strict().parse(req.body);
  if(confirmation.confirm_instance!==row.config.instance_name)throw new HttpError(400,'Confirmacao de instancia incorreta.');
  res.json(await logoutEvolutionChannel(req.orgId,integrationId));
 }));
 router.patch('/:id/name',wrap(async(req,res)=>{
  checkOwnAccess(req);const integrationId=id.parse(req.params.id);
  const data=z.object({name:z.string().trim().min(2).max(100)}).strict().parse(req.body);
  const row=await checkChannel(req,integrationId);
  if(!row || row.config?.provider!=='evolution_api')throw new HttpError(404,'Instancia Evolution nao encontrada.');
  const result=await prisma.integration.update({where:{id:row.id},data:{name:data.name}});
  res.json({channel:safe(result)});
 }));
 router.get('/:id/webhook',wrap(async(req,res)=>{
  const integrationId=id.parse(req.params.id);
  if(!(await visibleChannelIds(req)).includes(integrationId))throw new HttpError(404,'Instancia sem acesso.');
  const row=await prisma.integration.findFirst({where:{id:integrationId,org_id:req.orgId,type:'whatsapp'}});
  if(!row || row.config?.provider!=='evolution_api')throw new HttpError(404,'Instancia Evolution nao encontrada.');
  res.json({webhook:await getEvolutionWebhookInfo(req.orgId,integrationId)});
 }));
 router.post('/:id/webhook',wrap(async(req,res)=>{
  checkOwnAccess(req);const integrationId=id.parse(req.params.id);
  const item=await checkChannel(req,integrationId);
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
