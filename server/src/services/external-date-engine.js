/** Pull from one centrally configured n8n endpoint; delivery is fail-closed and at-most-once. */
import { randomUUID } from 'node:crypto';
import { prisma } from '../db.js';
import { sendEvolutionText } from './evolution.js';
import { getOrCreateConversation,withConversationIdentityLock } from './conversation-thread.js';
import { normalizeCustomers,dueEvents,localDate,renderExternalMessage,deterministicId,EVENT_TYPES } from './external-date-policy.js';
const SOURCE='external_dates';
let busy=false;
export function n8nEndpoint(){
  const raw=String(process.env.N8N_DATA_WEBHOOK_URL||'').trim();
  if(!raw)throw Error('Configure N8N_DATA_WEBHOOK_URL no backend para ativar consultas.');
  const u=new URL(raw); const local=['localhost','127.0.0.1','::1','[::1]'].includes(u.hostname);
  if((u.protocol!=='https:'&&!(local&&u.protocol==='http:'))||u.username||u.password||u.hash)throw Error('URL n8n deve ser HTTPS; HTTP permitido apenas em localhost.');
  return u.toString();
}
export async function requestCustomers(orgId,ruleId){
  const endpoint=n8nEndpoint();
  const token=String(process.env.N8N_DATA_WEBHOOK_TOKEN||'').trim();
  const response=await fetch(endpoint,{method:'POST',redirect:'error',signal:AbortSignal.timeout(20000),
    headers:{'Content-Type':'application/json',...(token?{'X-FalaComigo-Key':token}:{})},
    body:JSON.stringify({source:'falacomigo',org_id:orgId,automation_id:ruleId,request:'clientes_v1'})});
  if(!response.ok)throw Error(`Consulta n8n falhou: HTTP ${response.status}`);
  const max=2_000_000; const len=Number(response.headers.get('content-length')||0);
  if(len>max)throw Error('Resposta n8n excede 2 MB.');
  const raw=await response.text();if(Buffer.byteLength(raw)>max)throw Error('Resposta n8n excede 2 MB.');
  return normalizeCustomers(JSON.parse(raw));
}
const log=async (orgId,eventType,details,error=null)=>prisma.webhookEvent.create({data:{id:randomUUID(),org_id:orgId,source:SOURCE,event_type:eventType,
  payload:details,processed:!error,...(error?{error:String(error.message||error).slice(0,1000)}:{processed_at:new Date()})}});
async function isClaimed(id){return Boolean(await prisma.webhookEvent.findUnique({where:{id},select:{id:true}}));}
async function delivery(rule,event){
  const claimId=deterministicId(['external_dates_v1',rule.org_id,rule.id,event.unique]);
  if(await isClaimed(claimId))return 'skipped';
  // This insert is a DB-atomic claim across processes/restarts. A failure is never retried automatically.
  try{await prisma.webhookEvent.create({data:{id:claimId,org_id:rule.org_id,source:SOURCE,event_type:'delivery_claim',
    payload:{automation_id:rule.id,customer_id:event.customer.id,occurrence:event.occurrence},processed:false}});}
  catch(e){if(e.code==='P2002')return 'skipped';throw e;}
  try{
    const row=event.customer;
    const template=String(rule.trigger.message||'');
    const text=renderExternalMessage(template,event.variables);
    if(!text||text.length>3000)throw Error('Mensagem vazia ou longa demais.');
    const integrationId=String(rule.trigger.integration_id||'');
    const integration=await prisma.integration.findFirst({where:{id:integrationId,org_id:rule.org_id,type:'whatsapp'}});
    if(!integration||integration.config?.provider!=='evolution_api')throw Error('Instância WhatsApp inválida.');
    const message=await withConversationIdentityLock({orgId:rule.org_id,integrationId,phone:row.telefone},async()=>{
      let contact=await prisma.contact.findFirst({where:{org_id:rule.org_id,is_group:false,phone:{in:[row.telefone,`+${row.telefone}`]}}});
      if(!contact)contact=await prisma.contact.create({data:{id:randomUUID(),org_id:rule.org_id,name:row.nome,phone:`+${row.telefone}`,custom_fields:{}}});
      const {conversation}=await getOrCreateConversation(prisma,{orgId:rule.org_id,contactId:contact.id,integrationId});
      return sendEvolutionText({orgId:rule.org_id,conversation,text,userId:null});
    });
    await prisma.webhookEvent.update({where:{id:claimId},data:{processed:true,processed_at:new Date(),payload:{automation_id:rule.id,customer_id:row.id,message_id:message.id,occurrence:event.occurrence}}});
    return 'sent';
  }catch(error){await prisma.webhookEvent.update({where:{id:claimId},data:{error:String(error.message||error).slice(0,1000)}});return 'failed';}
}
export async function externalAutomationTick(now=new Date()){
  if(busy)return;busy=true;
  try{
    const today=localDate(now);
    const rules=await prisma.automation.findMany({where:{status:'active'},select:{id:true,org_id:true,trigger:true,created_at:true},take:1000});
    for(const rule of rules){
      const trigger=rule.trigger||{};
      if(trigger.type!=='external_json'||!EVENT_TYPES.includes(trigger.event_key))continue;
      if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(trigger.send_time||'')))continue;
      const [hour,minute]=trigger.send_time.split(':').map(Number);
      if(today.hour*60+today.minute<hour*60+minute)continue;
      // Only execute rules created before today, or new rules after their first scheduled time.
      const dateKey=`${today.year}-${String(today.month).padStart(2,'0')}-${String(today.day).padStart(2,'0')}`;
      const runId=deterministicId(['external_dates_run',rule.org_id,rule.id,dateKey]);
      if(await isClaimed(runId))continue;
      try{
        const customers=await requestCustomers(rule.org_id,rule.id);
        const due=dueEvents(customers,trigger,today);
        if(due.length>30)throw Error('Mais de 30 mensagens elegíveis; envio bloqueado para revisão.');
        let sent=0,failed=0,skipped=0;
        for(const event of due){const result=await delivery(rule,event);if(result==='sent')sent++;else if(result==='failed')failed++;else skipped++;}
        // Completion claim is unique; sender is protected by per-event atomic claims.
        try {await prisma.webhookEvent.create({data:{id:runId,org_id:rule.org_id,source:SOURCE,event_type:'daily_check',processed:true,
          processed_at:new Date(),payload:{automation_id:rule.id,date:dateKey,records:customers.length,due:due.length,sent,failed,skipped}}});}
        catch(e){if(e.code!=='P2002')throw e;}
      }catch(error){console.error('[Automação datas]',rule.id,error.message);
        await log(rule.org_id,'fetch_failed',{automation_id:rule.id,date:dateKey},error);
      }
    }
  }finally{busy=false;}
}
export async function previewExternalRule(rule,payload){
  const customers=normalizeCustomers(payload);
  const today=localDate();const due=dueEvents(customers,rule.trigger,today);
  return {valid:true,count:customers.length,eligible:due.length,sample:due.slice(0,12).map(e=>({cliente:e.customer.nome,telefone_fim:e.customer.telefone.slice(-4),evento:e.unique,preview:renderExternalMessage(rule.trigger.message,e.variables)}))};
}
