import { createHash, createDecipheriv, randomUUID } from 'node:crypto';
import { prisma } from '../db.js';
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
 if(!response.ok)throw new HttpError(502,`Evolution retornou HTTP ${response.status}: ${String(data?.response?.message||data?.message||'erro').slice(0,120)}`);
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
