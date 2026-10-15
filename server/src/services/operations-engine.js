/**
 * Queue for consented, explicitly activated campaigns and user-created schedules.
 * Single backend process. Claims work in MySQL BEFORE calling Evolution; unknown
 * provider outcomes are never retried automatically (prevents duplicate delivery).
 */
import { randomUUID } from 'node:crypto';
import { prisma } from '../db.js';
import { sendEvolutionText } from './evolution.js';

import { validPhone, hasMarketingConsent } from './operations-policy.js';
export { validPhone, hasMarketingConsent } from './operations-policy.js';
const MAX_DAILY_ORG = 50;
let busy = false;

export async function ensureChannel(orgId, integrationId) {
  const row = await prisma.integration.findFirst({where:{id:integrationId,org_id:orgId,type:'whatsapp'}});
  if (!row || row.config?.provider !== 'evolution_api') throw new Error('Selecione uma instancia Evolution valida. API oficial ainda requer templates para campanhas.');
  return row;
}

async function getOrCreateConversation(tx, orgId, contactId, integrationId) {
  const existing=await tx.conversation.findFirst({where:{org_id:orgId,contact_id:contactId,channel:'whatsapp',integration_id:integrationId},orderBy:{last_message_at:'desc'}});
  if(existing)return existing;
  return tx.conversation.create({data:{id:randomUUID(),org_id:orgId,contact_id:contactId,channel:'whatsapp',integration_id:integrationId,status:'open'}});
}

async function deliver({orgId,contactId,integrationId,text,userId}) {
  const contact=await prisma.contact.findFirst({where:{id:contactId,org_id:orgId}});
  if(!contact||!validPhone(contact.phone))throw new Error('Contato sem telefone com DDI valido.');
  await ensureChannel(orgId,integrationId);
  const conversation=await prisma.$transaction(tx=>getOrCreateConversation(tx,orgId,contactId,integrationId));
  return sendEvolutionText({orgId,conversation,text,userId});
}

function friendlyError(error) {return String(error?.message||'Falha no envio').slice(0,400);}

async function processOneSchedule(now) {
  const job=await prisma.schedule.findFirst({where:{status:'pending',delivery_enabled:true,scheduled_at:{lte:now}},orderBy:{scheduled_at:'asc'}});
  if(!job)return false;
  const claim=await prisma.schedule.updateMany({where:{id:job.id,status:'pending',delivery_enabled:true},data:{status:'processing'}});
  if(claim.count!==1)return false;
  try {
    if(!job.message||!job.contact_id||!job.integration_id)throw new Error('Agendamento sem destinatario, mensagem ou numero.');
    const msg=await deliver({orgId:job.org_id,contactId:job.contact_id,integrationId:job.integration_id,text:job.message,userId:job.created_by});
    await prisma.schedule.update({where:{id:job.id},data:{status:'sent'}});
    await prisma.auditLog.create({data:{id:randomUUID(),org_id:job.org_id,user_id:job.created_by,action:'schedule.accepted',entity_type:'schedule',entity_id:job.id,details:{message_id:msg.id}}});
  }catch(error){
    console.error('[Agenda] Falha; envio nao sera repetido automaticamente:',job.id,friendlyError(error));
    await prisma.schedule.updateMany({where:{id:job.id,status:'processing'},data:{status:'failed'}});
    await prisma.auditLog.create({data:{id:randomUUID(),org_id:job.org_id,user_id:job.created_by,action:'schedule.failed',entity_type:'schedule',entity_id:job.id,details:{error:friendlyError(error),review_before_retry:true}}});
  }
  return true;
}

async function processOneRecipient(now) {
  const campaigns=await prisma.campaign.findMany({where:{status:{in:['sending','scheduled']},integration_id:{not:null},scheduled_at:{lte:now}},orderBy:{created_at:'asc'},take:30});
  for(const campaign of campaigns) {
    const dailyFrom=new Date(now);dailyFrom.setHours(0,0,0,0);
    const today=await prisma.campaignRecipient.count({where:{campaign_id:campaign.id,sent_at:{gte:dailyFrom}}});
    if(today>=Math.min(campaign.daily_limit,30))continue;
    const recipient=await prisma.campaignRecipient.findFirst({where:{campaign_id:campaign.id,status:'pending'},orderBy:{created_at:'asc'}});
    if(!recipient) {
      await prisma.campaign.updateMany({where:{id:campaign.id,status:{in:['sending','scheduled']}},data:{status:'completed'}});
      continue;
    }
    // Respect all-company cap across campaigns (use audit rows as authoritative sends).
    const globalCount=await prisma.auditLog.count({where:{org_id:campaign.org_id,action:'campaign.accepted',created_at:{gte:dailyFrom}}});
    if(globalCount>=MAX_DAILY_ORG)return false;
    const claim=await prisma.campaignRecipient.updateMany({where:{id:recipient.id,status:'pending'},data:{status:'processing'}});
    if(claim.count!==1)continue;
    const contact=await prisma.contact.findFirst({where:{id:recipient.contact_id,org_id:campaign.org_id}});
    try {
      // Recheck consent just before actual delivery so revocation is honored.
      if(!hasMarketingConsent(contact)) throw new Error('Contato sem consentimento de marketing vigente.');
      if(!validPhone(contact?.phone)) throw new Error('Telefone invalido ou sem DDI.');
      const message=campaign.message.replace(/\{nome\}/gi,String(contact.name||'').slice(0,100));
      const sent=await deliver({orgId:campaign.org_id,contactId:contact.id,integrationId:campaign.integration_id,text:message,userId:campaign.created_by});
      await prisma.$transaction(async tx=>{
        await tx.campaignRecipient.update({where:{id:recipient.id},data:{status:'sent',sent_at:new Date()}});
        await tx.campaign.update({where:{id:campaign.id},data:{sent_count:{increment:1},status:'sending'}});
        await tx.auditLog.create({data:{id:randomUUID(),org_id:campaign.org_id,user_id:campaign.created_by,action:'campaign.accepted',entity_type:'campaign',entity_id:campaign.id,details:{recipient_id:recipient.id,message_id:sent.id}}});
      });
    }catch(error){
      console.error('[Campanha] Envio nao repetido automaticamente:',campaign.id,recipient.id,friendlyError(error));
      await prisma.$transaction(async tx=>{
        await tx.campaignRecipient.update({where:{id:recipient.id},data:{status:'failed',error:friendlyError(error)}});
        await tx.campaign.update({where:{id:campaign.id},data:{failed_count:{increment:1}}});
        await tx.auditLog.create({data:{id:randomUUID(),org_id:campaign.org_id,user_id:campaign.created_by,action:'campaign.failed',entity_type:'campaign',entity_id:campaign.id,details:{recipient_id:recipient.id,error:friendlyError(error),review_before_retry:true}}});
      });
    }
    return true;
  }
  return false;
}

export async function operationsTick() {
  if(busy)return;
  busy=true;
  try {
    const now=new Date();
    // Only one external message per tick overall; deliberate throttling.
    const didSchedule=await processOneSchedule(now);
    if(!didSchedule)await processOneRecipient(now);
  } finally {busy=false;}
}
