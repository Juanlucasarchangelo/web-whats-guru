import { createHash, createDecipheriv, randomUUID } from 'node:crypto';
import { prisma } from '../db.js';
import { importEvolutionMessage } from './evolution-inbound.js';
import { summarizeEvolutionResults } from './evolution-payload.js';
import { HttpError } from '../http.js';

function decodeKey() {
 const secret=process.env.INTEGRATION_ENCRYPTION_KEY;
 if(!secret || secret.length<32) throw new HttpError(503,'INTEGRATION_ENCRYPTION_KEY ausente no servidor.');
 return createHash('sha256').update(secret).digest();
}
function decrypt(ciphertext) {
 if(typeof ciphertext!=='string' || !ciphertext.startsWith('enc:')) throw new HttpError(503,'Credencial Evolution nao criptografada como esperado; reconfigure a integracao.');
 try {
  const buf=Buffer.from(ciphertext.slice(4),'base64');
  if(buf.length<29)throw Error('invalid');
  const decipher=createDecipheriv('aes-256-gcm',decodeKey(),buf.subarray(0,12));
  decipher.setAuthTag(buf.subarray(12,28));
  return Buffer.concat([decipher.update(buf.subarray(28)),decipher.final()]).toString('utf8');
 } catch {throw new HttpError(503,'Falha ao ler chave Evolution. Confira INTEGRATION_ENCRYPTION_KEY original.');}
}
export async function loadEvolution(orgId) {
 const integration=await prisma.integration.findFirst({where:{org_id:orgId,type:'whatsapp'}});
 if(!integration || integration.config?.provider!=='evolution_api') return null;
 const credentials=await prisma.integrationCredential.findFirst({where:{integration_id:integration.id,org_id:orgId}});
 if(!credentials?.access_token)throw new HttpError(503,'API Key Evolution nao foi salva. Configure em Integracoes.');
 const url=String(integration.config?.provider_url||'').replace(/\/$/,'');
 const instance=String(integration.config?.instance_name||'');
 // Only use URLs already saved by the integration's validated setup.
 if(!/^https?:\/\//.test(url) || !/^[\w-]{2,60}$/.test(instance))throw new HttpError(503,'URL ou instancia Evolution invalida.');
 return {integration,url,instance,apiKey:decrypt(credentials.access_token)};
}
async function evolutionGet(api,path,method='GET',body) {
 let response;
 try {response=await fetch(`${api.url}${path}`,{method,headers:{apikey:api.apiKey,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(15000),redirect:'error'});}
 catch {throw new HttpError(502,'Nao foi possivel comunicar com Evolution API. Confira Docker e porta.');}
 const data=await response.json().catch(()=>({}));
 if(!response.ok){
   const error=new HttpError(502,`Evolution retornou HTTP ${response.status}: ${String(data?.response?.message||data?.message||'erro').slice(0,120)}`);
   error.providerStatus=response.status;
   throw error;
 }
 return data;
}
export async function syncEvolutionStatus(orgId) {
 const api=await loadEvolution(orgId); if(!api)return null;
 const result=await evolutionGet(api,`/instance/connectionState/${encodeURIComponent(api.instance)}`);
 const state=result?.instance?.state;
 const status=state==='open'?'connected':state==='connecting'?'connecting':'disconnected';
 if(api.integration.status!==status)await prisma.integration.updateMany({where:{id:api.integration.id,org_id:orgId},data:{status,last_connected_at:status==='connected'?new Date():api.integration.last_connected_at}});
 return {status,instance_name:api.instance,provider:'evolution_api'};
}
export async function sendEvolutionText({orgId,conversation,text,userId}) {
 const api=await loadEvolution(orgId);
 if(!api)throw new HttpError(503,'Evolution nao configurada para esta organizacao.');
 const state=await syncEvolutionStatus(orgId);
 if(state.status!=='connected')throw new HttpError(409,`Instancia Evolution nao esta conectada (status: ${state.status}).`);
 const contact=await prisma.contact.findFirst({where:{id:conversation.contact_id,org_id:orgId},select:{phone:true}});
 const phone=String(contact?.phone||'').replace(/\D/g,'');
 if(phone.length<10||phone.length>15)throw new HttpError(400,'Contato precisa de telefone completo com DDI (ex. 5541999999999).');
 const result=await evolutionGet(api,`/message/sendText/${encodeURIComponent(api.instance)}`,'POST',{number:phone,text});
 const providerId=result?.key?.id || result?.id;
 if(!providerId)throw new HttpError(502,'Evolution nao confirmou o envio; verifique painel do provedor antes de reenviar.');
 const row=await prisma.$transaction(async tx=>{
  const msg=await tx.message.create({data:{id:randomUUID(),org_id:orgId,conversation_id:conversation.id,body:text,sender_type:'agent',sender_id:userId,channel:'whatsapp',status:'accepted',is_internal:false}});
  await tx.conversation.update({where:{id:conversation.id},data:{last_message_at:msg.created_at}});
  await tx.webhookEvent.create({data:{id:randomUUID(),org_id:orgId,source:'evolution_outbound',event_type:'message_accepted',payload:{provider_message_id:providerId,local_message_id:msg.id},processed:true,processed_at:new Date()}});
  return msg;
 });
 return row;
}

/** Evolution API v2 expects FLAT webhook settings, not {webhook:{...}}. */
export async function configureEvolutionWebhook(orgId, endpointUrl) {
 const api = await loadEvolution(orgId);
 if (!api) throw new HttpError(404, 'Evolution nao configurada nesta organizacao.');
 const parsed = new URL(endpointUrl);
 if (!['https:', 'http:'].includes(parsed.protocol)) throw new HttpError(400, 'Webhook deve usar HTTP(S).');
 const body = {
   enabled: true,
   url: endpointUrl,
   webhookByEvents: false,
   webhookBase64: false,
   events: ['MESSAGES_UPSERT', 'CONNECTION_UPDATE', 'MESSAGES_UPDATE'],
 };
 let contract = 'flat';
 try {
   // Recent Evolution endpoints may accept this shape.
   await evolutionGet(api, `/webhook/set/${encodeURIComponent(api.instance)}`, 'POST', body);
 } catch (error) {
   // Some Evolution v2 releases explicitly require { webhook: {...} }.
   if (![400, 404, 422].includes(error?.providerStatus)) throw error;
   contract = 'nested';
   await evolutionGet(api, `/webhook/set/${encodeURIComponent(api.instance)}`, 'POST', { webhook: body });
 }
 let verified = false;
 try {
   const status = await getEvolutionWebhookInfo(orgId);
   verified = Boolean(status?.enabled && status?.has_url && status?.messages_upsert);
 } catch (error) {
   console.warn('[Evolution Webhook] Registro aceito, mas falhou a verificacao de leitura:', error.message);
 }
 if (!verified) console.warn('[Evolution Webhook] Confirme no painel Evolution se o webhook esta habilitado.', {instance:api.instance,contract});
 else console.info('[Evolution Webhook] Registro confirmado:', { instance: api.instance, contract, events: body.events });
 return { ok: true, verified, instance: api.instance, contract, events: body.events };
}

export async function getEvolutionWebhookInfo(orgId) {
 const api = await loadEvolution(orgId);
 if (!api) return null;
 const result = await evolutionGet(api, `/webhook/find/${encodeURIComponent(api.instance)}`);
 const config = result?.webhook?.webhook ?? result?.webhook ?? result?.data?.webhook ?? result?.data ?? result;
 const events = Array.isArray(config?.events) ? config.events : [];
 // Do NOT expose webhook URL (it contains the secret), access token or API key.
 return {
   instance: api.instance,
   enabled: Boolean(config?.enabled),
   has_url: Boolean(config?.url),
   events,
   messages_upsert: events.some(e => String(e).toUpperCase() === 'MESSAGES_UPSERT'),
 };
}

function extractHistoryRecords(result) {
 if (Array.isArray(result)) return result;
 const candidates = [result?.messages?.records, result?.messages, result?.data?.messages?.records,
   result?.data?.messages, result?.data?.records, result?.records, result?.data];
 for (const value of candidates) if (Array.isArray(value)) return value;
 throw new HttpError(502, 'Formato inesperado no historico da Evolution. Confira a versao da API e seus logs.');
}

/** Recovery path when Docker cannot deliver webhooks: import the open conversation's recent messages. */
export async function syncEvolutionConversation({ orgId, conversation }) {
 const api = await loadEvolution(orgId);
 if (!api) throw new HttpError(404, 'Evolution nao configurada.');
 const contact = await prisma.contact.findFirst({
   where: { id: conversation.contact_id, org_id: orgId }, select: { phone: true },
 });
 const phone = String(contact?.phone ?? '').replace(/\D/g, '');
 if (phone.length < 10 || phone.length > 15) throw new HttpError(400, 'Contato sem numero WhatsApp valido para sincronizar.');
 const remoteJid = `${phone}@s.whatsapp.net`;
 const data = await evolutionGet(api, `/chat/findMessages/${encodeURIComponent(api.instance)}`, 'POST', {
   where: { key: { remoteJid } }, page: 1, offset: 50,
 });
 let items = extractHistoryRecords(data);
 let fallback_used = false;
 if (items.length === 0) {
   // Certain Evolution releases ignore /chat/findMessages remoteJid filters.
   const fallback = await evolutionGet(api, `/chat/findMessages/${encodeURIComponent(api.instance)}`, 'POST', {page: 1, offset: 50});
   items = extractHistoryRecords(fallback);
   fallback_used = true;
 }
 const results = [];
 for (const item of items) results.push(await importEvolutionMessage({ orgId, item, expectedPhone: phone }));
 const counts = summarizeEvolutionResults(results);
 console.info('[Evolution Sync]', { instance: api.instance, conversationId: conversation.id, total: items.length, fallback_used, counts });
 return { counts, scanned: items.length, fallback_used, synchronized_at: new Date().toISOString() };
}
