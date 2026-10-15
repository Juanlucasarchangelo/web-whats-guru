import { Router } from 'express';
import { randomBytes, createCipheriv, createHash } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { prisma } from '../db.js';
import { HttpError, wrap } from '../http.js';
import { syncEvolutionStatus } from '../services/evolution.js';

const key = () => {
  const secret = process.env.INTEGRATION_ENCRYPTION_KEY;
  if (!secret || secret.length < 32) throw new HttpError(503,'Defina INTEGRATION_ENCRYPTION_KEY (32 caracteres ou mais) em server/.env');
  return createHash('sha256').update(secret).digest();
};
function encrypt(value) {
  const iv=randomBytes(12), cipher=createCipheriv('aes-256-gcm',key(),iv);
  const ciphertext=Buffer.concat([cipher.update(String(value),'utf8'),cipher.final()]);
  return `enc:${Buffer.concat([iv,cipher.getAuthTag(),ciphertext]).toString('base64')}`;
}
function checkAdmin(req) {if(!['owner','admin'].includes(req.role))throw new HttpError(403,'Somente administrador.');}
async function providerUrl(input){
  let url;
  try { url = new URL(input); } catch { throw new HttpError(400, 'URL Evolution inválida'); }
  if (url.username || url.password || url.search || url.hash) {
    throw new HttpError(400, 'URL Evolution não pode conter usuário, senha, parâmetros ou fragmentos.');
  }
  const hostname = url.hostname.toLowerCase();
  const isLoopback = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
  if (isLoopback) {
    if (process.env.EVOLUTION_ALLOW_LOCAL_HTTP !== 'true') {
      throw new HttpError(400, 'Para usar Evolution local, configure EVOLUTION_ALLOW_LOCAL_HTTP=true no server/.env.');
    }
    if (!['http:', 'https:'].includes(url.protocol)) throw new HttpError(400, 'Protocolo Evolution inválido.');
    return url.origin + url.pathname.replace(/\/$/, '');
  }
  if (url.protocol !== 'https:') {
    throw new HttpError(400, 'Para Evolution remoto, informe uma URL HTTPS pública.');
  }
  if (hostname.endsWith('.local') || hostname.endsWith('.internal') || isIP(hostname)) {
    throw new HttpError(400, 'Endereço remoto deve usar DNS público HTTPS.');
  }
  const addresses = await lookup(hostname, { all: true });
  for (const { address, family } of addresses) {
    const privateV4 = family === 4 && (/^(127|10|0|169\.254|192\.168)\./.test(address) || /^172\.(1[6-9]|2\d|3[01])\./.test(address));
    const privateV6 = family === 6 && (/^(::1|fc|fd|fe80)/i.test(address));
    if (privateV4 || privateV6) throw new HttpError(400, 'O DNS do Evolution aponta para rede privada.');
  }
  return url.origin + url.pathname.replace(/\/$/, '');
}

async function providerFetch(url, options){
  const response=await fetch(url,{...options,signal:AbortSignal.timeout(15000),redirect:'error'});
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw new HttpError(502,`Evolution respondeu HTTP ${response.status}: ${String(data?.response?.message||data?.message||'Falha no provedor').slice(0,160)}`);
  return data;
}
async function saveIntegration(req,{type,name,config,status,token='',verify='',appSecret=''}){
  const integration=await prisma.integration.upsert({where:{org_id_type:{org_id:req.orgId,type}},create:{org_id:req.orgId,type,name,config,status,last_connected_at: status==='connected'?new Date():null},update:{name,config,status,last_connected_at: status==='connected'?new Date():null}});
  if(token){await prisma.integrationCredential.upsert({where:{integration_id:integration.id},create:{integration_id:integration.id,org_id:req.orgId,access_token:encrypt(token),verify_token:encrypt(verify||randomBytes(24).toString('hex')),app_secret:appSecret?encrypt(appSecret):null},update:{access_token:encrypt(token),verify_token:encrypt(verify||randomBytes(24).toString('hex')),app_secret:appSecret?encrypt(appSecret):null}});}
  return integration;
}
export function restoredIntegrationsRouter(){
 const router=Router();
 router.get('/',wrap(async(req,res)=>{try{await syncEvolutionStatus(req.orgId);}catch(error){console.warn('Evolution status:',error.message);}const data=await prisma.integration.findMany({where:{org_id:req.orgId}});res.json({data:data.map(i=>({...i,config:i.config??{}}))});}));
 router.get('/whatsapp/status',wrap(async(req,res)=>{const state=await syncEvolutionStatus(req.orgId);if(!state)throw new HttpError(404,'Nenhuma Evolution configurada nesta organizacao.');res.json(state);}));
 router.get('/activity',wrap(async(req,res)=>{const [audit,events]=await Promise.all([prisma.auditLog.findMany({where:{org_id:req.orgId},orderBy:{created_at:'desc'},take:50}),prisma.webhookEvent.findMany({where:{org_id:req.orgId},orderBy:{received_at:'desc'},take:50})]);res.json({audit,events});}));
 router.post('/whatsapp',wrap(async(req,res)=>{
  checkAdmin(req);const {action}=req.body||{};
  if(action==='disconnect'){
   await prisma.integration.updateMany({where:{org_id:req.orgId,type:'whatsapp'},data:{status:'disconnected'}});
   return res.json({disconnected:true});
  }
  if(action==='connect_unofficial'){
   const {provider_url,instance_name,api_key}=req.body||{};
   const url=await providerUrl(provider_url);
   if(!/^[\w-]{2,60}$/.test(instance_name||'') || typeof api_key!=='string'||!api_key.trim())throw new HttpError(400,'Informe instância e API key do Evolution.');
   const headers={'Content-Type':'application/json',apikey:api_key.trim()};
   let info;
   try {info=await providerFetch(`${url}/instance/create`,{method:'POST',headers,body:JSON.stringify({instanceName:instance_name,integration:'WHATSAPP-BAILEYS',qrcode:true})});}
   catch(e){if(!(e instanceof HttpError)||!String(e.message).includes('HTTP 403')&&!String(e.message).includes('HTTP 409'))throw e;}
   if(!info?.base64&&!info?.qrcode?.base64)info=await providerFetch(`${url}/instance/connect/${encodeURIComponent(instance_name)}`,{method:'GET',headers});
   const rawQr=info?.base64??info?.qrcode?.base64??null;
   const qr=rawQr ? (rawQr.startsWith('data:image/')?rawQr:`data:image/png;base64,${rawQr}`) : null;
   await saveIntegration(req,{type:'whatsapp',name:'WhatsApp Business Platform',config:{connection_mode:'unofficial',provider:'evolution_api',provider_url:url,instance_name},status:'connecting',token:api_key});
   return res.json({connected:true,provider:'evolution_api',qr_code:qr});
  }
  if(action==='connect'){
   const {phone_number_id,business_account_id,access_token,app_secret}=req.body||{};
   if(!/^\d+$/.test(phone_number_id||'')||!/^\d+$/.test(business_account_id||'')||!access_token)throw new HttpError(400,'Dados oficiais da Meta inválidos.');
   const meta=await providerFetch(`https://graph.facebook.com/v23.0/${encodeURIComponent(phone_number_id)}?fields=display_phone_number,verified_name`,{headers:{Authorization:`Bearer ${access_token}`}});
   const verify=randomBytes(24).toString('hex');
   await saveIntegration(req,{type:'whatsapp',name:'WhatsApp Business Platform',config:{connection_mode:'official',phone_number_id,business_account_id,display_phone_number:meta.display_phone_number??'',verified_name:meta.verified_name??''},status:'connected',token:access_token,verify,appSecret:app_secret||''});
   return res.json({connected:true,display_phone_number:meta.display_phone_number,verified_name:meta.verified_name,webhook_verify_token:verify});
  }
  throw new HttpError(400,'Ação inválida.');
 }));
 router.post('/other',wrap(async(req,res)=>{
  checkAdmin(req); const {type,provider,model,api_key,url}=req.body||{};
  if(type==='ai_provider'){
   if(provider!=='openai'||typeof api_key!=='string'||!api_key.startsWith('sk-'))throw new HttpError(400,'Informe chave OpenAI válida.');
   await providerFetch('https://api.openai.com/v1/models',{headers:{Authorization:`Bearer ${api_key}`}});
   await saveIntegration(req,{type,name:'Provedor de IA',config:{provider,model:model||'gpt-4'},status:'connecting',token:api_key});
   return res.json({connected:true,provider,model});
  }
  if(type==='webhook'){
   const sanitized=await providerUrl(url);await saveIntegration(req,{type,name:'Webhook',config:{url:sanitized},status:'connected'});
   return res.json({connected:true});
  }
  throw new HttpError(400,'Tipo inválido.');
 }));
 router.post('/disconnect',wrap(async(req,res)=>{checkAdmin(req); const {id}=req.body||{};await prisma.integration.updateMany({where:{id,org_id:req.orgId},data:{status:'disconnected'}});res.json({disconnected:true});}));
 return router;
}
