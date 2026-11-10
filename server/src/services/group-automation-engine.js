/** Explicitly scoped WhatsApp group automations. No blanket group scanning. */
import { randomUUID } from 'node:crypto';
import { prisma } from '../db.js';
import { generateAIText } from './ai-provider.js';
import { buildSummarySystemInstructions } from './ai-summary-instructions.js';
import { sendEvolutionText } from './evolution.js';
import { getOrCreateConversation, withConversationIdentityLock } from './conversation-thread.js';
import { executeGroupAutomationAction } from './workflow-engine.js';
import { inboxChannelIds } from './channel-access.js';
import { normalizeRole } from './permissions.js';
import { eligibleGroupSilence, awaitingSide, groupRuleType, groupTriggerError, summaryGroupIds, summaryTimes, summaryExecutionKey, summaryAlreadyDelivered, zonedDay } from './group-automation-policy.js';

let running=false;
let lastTickAt=null;
let lastTickError=null;
let lastAutoDiagnosticAt=0;
const manualActive=new Set(); // only one manual job per rule in this process
export function groupSchedulerStatus() { return {last_tick_at:lastTickAt, last_error:lastTickError, running}; }
const TIME_ZONE='America/Sao_Paulo';
const logError=e=>String(e?.message || e).slice(0,600);

async function claim(rule, key) {
  try {
    return await prisma.groupAutomationExecution.create({data:{id:randomUUID(),org_id:rule.org_id,
      automation_id:rule.id,execution_key:key,status:'processing'}});
  } catch(error) { if(error?.code==='P2002') return null; throw error; }
}
async function finish(run, status, details) {
  await prisma.groupAutomationExecution.update({where:{id:run.id},data:{status,finished_at:new Date(),details}});
}
async function aiSummary(rule,group,day,rows) {
  if(!rows.length) return 'Nenhuma mensagem registrada hoje neste grupo.';
  const chronological=[...rows].reverse();
  const transcript=chronological.map(m=>{
    const author=m.sender_type==='contact' ? (m.group_sender_name || 'Participante') : 'Nossa equipe';
    return `${new Date(m.created_at).toISOString().slice(11,16)} ${author}: ${String(m.body || '').replace(/[\r\n]+/g,' ').slice(0,400)}`;
  }).join('\n').slice(-14500);
  const aiIntegration=await prisma.integration.findFirst({where:{org_id:rule.org_id,type:'ai_provider'},orderBy:{created_at:'asc'},select:{config:true}});
  const summary=await generateAIText({orgId:rule.org_id,maxOutputTokens:400,
    instructions:buildSummarySystemInstructions(aiIntegration?.config?.summary_instructions),
    input:`Data: ${day}\nGrupo: ${group.subject}\nMensagens do grupo:\n${transcript}`});
  return summary.slice(0,1200);
}
async function destinationConversation(orgId,recipient) {
  if(recipient.kind==='group') {
    const group=await prisma.whatsAppGroup.findFirst({where:{id:recipient.group_id,org_id:orgId}});
    if(!group) throw Error('Grupo de destino removido.');
    return prisma.conversation.findFirst({where:{id:group.conversation_id,org_id:orgId,is_group:true,integration_id:group.integration_id}});
  }
  const contact=await prisma.contact.findFirst({where:{id:recipient.contact_id,org_id:orgId,is_group:false,
    OR:[{contact_integrations:{some:{org_id:orgId,integration_id:recipient.integration_id}}},
      {conversations:{some:{org_id:orgId,integration_id:recipient.integration_id,is_group:false}}}]}});
  if(!contact?.phone) throw Error('Contato destinatário sem telefone.');
  return withConversationIdentityLock({orgId,contactId:contact.id,integrationId:recipient.integration_id},async()=>{
    const {conversation}=await getOrCreateConversation(prisma,{orgId,contactId:contact.id,integrationId:recipient.integration_id});
    return conversation;
  });
}
async function runtimeChannelIds(rule) {
  if(!rule.created_by) return []; // Never execute rules without a currently authorized creator.
  const user=await prisma.user.findUnique({where:{id:rule.created_by},select:{id:true,global_role:true,is_active:true,approval_status:true}});
  if(!user?.is_active || user.approval_status!=='approved') return [];
  let role='dev';
  if(user.global_role!=='dev') {
    const member=await prisma.orgMember.findFirst({where:{org_id:rule.org_id,user_id:user.id,status:'active'},select:{role:true}});
    if(!member) return [];
    role=normalizeRole(member.role);
    const permission=await prisma.accessRole.findFirst({where:{org_id:rule.org_id,slug:role},select:{permissions:true}});
    if(!Array.isArray(permission?.permissions) || !permission.permissions.includes('page.automations')) return [];
  }
  return inboxChannelIds({orgId:rule.org_id,role,user});
}
async function activeGroup(rule,authorized) {
  const trigger=rule.trigger;
  const group=await prisma.whatsAppGroup.findFirst({where:{id:trigger.group_id,org_id:rule.org_id}});
  if(!group || !authorized.includes(group.integration_id)) return null;
  const channel=await prisma.integration.findFirst({where:{id:group.integration_id,org_id:rule.org_id,type:'whatsapp'}});
  if(!channel || !['connected','connecting','active'].includes(channel.status)) return null;
  return group;
}
async function runSilence(rule,group,now) {
  const last=await prisma.message.findFirst({where:{org_id:rule.org_id,conversation_id:group.conversation_id,is_internal:false},orderBy:[{created_at:'desc'},{id:'desc'}]});
  if(!eligibleGroupSilence({last,trigger:rule.trigger,updatedAt:rule.updated_at,now})) return;
  const key=`silence:${rule.trigger.waiting_for}:${last.id}`;
  const run=await claim(rule,key); if(!run) return;
  try {
    for(const item of rule.actions) await executeGroupAutomationAction({orgId:rule.org_id,conversationId:group.conversation_id,item});
    await finish(run,'completed',{group_id:group.id,after_message_id:last.id,actions:rule.actions.length});
  } catch(error) {
    await finish(run,'failed',{error:logError(error),review_before_retry:true});
    console.error('[Group automation] Ações não concluídas (sem retentativa automática):',logError(error));
  }
}
async function runDaily(rule,group,now,authorized,scheduledTime,previous,manualId=null) {
  const {day,clock}=zonedDay(now,TIME_ZONE);
  if(!manualId && clock<scheduledTime) return;
  // An activation after a scheduled hour never sends that slot retroactively.
  const activated=zonedDay(rule.updated_at,TIME_ZONE);
  if(!manualId && activated.day===day && activated.clock>scheduledTime) return;
  // Each group and time has its own delivery record. Failures need a saved edit to retry.
  if(!manualId && summaryAlreadyDelivered(previous,group.id,`daily:${day}`,scheduledTime,summaryTimes(rule.trigger)[0])) return;
  const run=await claim(rule,manualId ? `manual:${manualId}:${group.id}` : summaryExecutionKey(rule,day,group.id,scheduledTime)); if(!run) return;
  try {
    const rows=await prisma.message.findMany({where:{org_id:rule.org_id,conversation_id:group.conversation_id,
      is_internal:false,created_at:{gte:new Date(now.getTime()-36*60*60*1000),lte:now}},
      orderBy:[{created_at:'desc'},{id:'desc'}],take:500,
      select:{created_at:true,body:true,sender_type:true,group_sender_name:true}});
    const today=rows.filter(m=>zonedDay(m.created_at,TIME_ZONE).day===day);
    const summary=await aiSummary(rule,group,day,today);
    const destination=rule.trigger.recipient;
    if(destination.kind==='contact' && !authorized.includes(destination.integration_id)) throw Error('Permissão de envio da instância revogada.');
    if(destination.kind==='group') {
      const groupDestination=await prisma.whatsAppGroup.findFirst({where:{id:destination.group_id,org_id:rule.org_id},select:{integration_id:true}});
      if(!groupDestination || !authorized.includes(groupDestination.integration_id)) throw Error('Permissão de envio ao grupo revogada.');
    }
    const target=await destinationConversation(rule.org_id,destination);
    if(!target) throw Error('Destino sem conversa WhatsApp válida.');
    const text=`📋 *${manualId?'RESUMO SOB DEMANDA':'RESUMO DO DIA'}* · ${group.subject}\n🗓️ ${day.split('-').reverse().join('/')} · ${scheduledTime} (São Paulo) · ${today.length} mensagem(ns)\n\n${summary}`;
    const message=await sendEvolutionText({orgId:rule.org_id,conversation:target,text:text.slice(0,6500),userId:null});
    await prisma.message.update({where:{id:message.id},data:{sender_type:'bot',is_bot:true}});
    await finish(run,'completed',{group_id:group.id,scheduled_time:manualId?null:scheduledTime,manual:!!manualId,destination:rule.trigger.recipient.kind,day,count:today.length,message_id:message.id});
  } catch(error) {
    await finish(run,'failed',{group_id:group.id,scheduled_time:manualId?null:scheduledTime,manual:!!manualId,error:logError(error),review_before_retry:true});
    console.error('[Group summary] Resumo não enviado / exige revisão:',logError(error));
  }
}
/** Explicit user-triggered summaries. A new batch ID means unlimited on-demand runs,
 * while scheduled slots remain idempotent. Runs are always audited by group. */
export async function runManualSummaries(orgId, automationId, requester) {
  const rule=await prisma.automation.findFirst({where:{id:automationId,org_id:orgId}});
  if(!rule || rule.trigger?.type!=='group_daily_summary') throw Error('Automação de resumo não encontrada.');
  if(rule.status!=='active') throw Error('Ative a automação antes de gerar os resumos.');
  const failure=groupTriggerError(rule.trigger,rule.actions);
  if(failure) throw Error(failure);
  if(manualActive.has(rule.id)) throw Error('Já existe um lote manual em andamento nesta automação.');
  const authorized=await runtimeChannelIds(rule);
  if(!authorized.length) throw Error('Criador sem autorização para executar esta automação.');
  // The caller's access can be narrower than the rule creator's.
  const requesterChannels=await inboxChannelIds(requester);
  const ids=summaryGroupIds(rule.trigger);
  const groups=await prisma.whatsAppGroup.findMany({where:{org_id:orgId,id:{in:ids}},select:{id:true,integration_id:true}});
  if(groups.length!==ids.length || groups.some(g=>!requesterChannels.includes(g.integration_id)))
    throw Error('Há grupos que não estão autorizados para o usuário atual.');
  const recipient=rule.trigger.recipient;
  if(recipient.kind==='contact' && !requesterChannels.includes(recipient.integration_id))
    throw Error('Instância de destino não autorizada para o usuário atual.');
  if(recipient.kind==='group') {
    const dest=await prisma.whatsAppGroup.findFirst({where:{org_id:orgId,id:recipient.group_id},select:{integration_id:true}});
    if(!dest || !requesterChannels.includes(dest.integration_id)) throw Error('Grupo de destino não autorizado.');
  }
  const batchId=randomUUID();
  manualActive.add(rule.id);
  // Respond immediately; processing continues sequentially and is recorded in the execution log.
  void (async()=>{
    try {
      for(const groupId of ids) {
        const group=await activeGroup({...rule,trigger:{...rule.trigger,group_id:groupId}},authorized);
        if(!group) {
          const run=await claim(rule,`manual:${batchId}:${groupId}`);
          if(run) await finish(run,'failed',{group_id:groupId,manual:true,error:'Grupo ou instância indisponível.'});
          continue;
        }
        await runDaily(rule,group,new Date(),authorized,zonedDay(new Date(),TIME_ZONE).clock,[],batchId);
      }
    } catch(error) {console.error('[Group summary] Lote manual interrompido:',logError(error));}
    finally {manualActive.delete(rule.id);}
  })();
  return {batch_id:batchId,group_count:ids.length};
}

// A diagnostic is deliberately read-only with respect to WhatsApp and automation actions.
// One mutable row per rule/day keeps the audit useful without a log entry every 30 seconds.
async function diagnoseRule(rule, now, groupId=rule.trigger.group_id) {
  if(rule.status!=='active') return {status:'paused',reason:'Automação pausada.'};
  const failure=groupTriggerError(rule.trigger,rule.actions);
  if(failure) return {status:'blocked',reason:`Regra inválida: ${failure}`};
  const authorized=await runtimeChannelIds(rule);
  if(!authorized.length) return {status:'blocked',reason:'Criador inativo, sem permissão de Automações ou sem WhatsApp autorizado.'};
  const group=await prisma.whatsAppGroup.findFirst({where:{id:groupId,org_id:rule.org_id},select:{id:true,integration_id:true,conversation_id:true,subject:true}});
  if(!group) return {status:'blocked',reason:'Grupo selecionado não existe mais nesta empresa.'};
  if(!authorized.includes(group.integration_id)) return {status:'blocked',reason:'A instância do grupo não está autorizada para o criador da regra.'};
  const channel=await prisma.integration.findFirst({where:{id:group.integration_id,org_id:rule.org_id,type:'whatsapp'},select:{status:true}});
  if(!channel || !['connected','connecting','active'].includes(channel.status)) return {status:'blocked',reason:`Instância não conectada (${channel?.status || 'ausente'}).`};
  if(rule.trigger.type==='group_no_reply') {
    const last=await prisma.message.findFirst({where:{org_id:rule.org_id,conversation_id:group.conversation_id,is_internal:false},orderBy:[{created_at:'desc'},{id:'desc'}],select:{id:true,created_at:true,sender_type:true,is_bot:true,is_internal:true}});
    if(!last) return {status:'waiting',reason:'Nenhuma mensagem registrada neste grupo.',group:group.subject};
    const side=awaitingSide(last);
    if(side!==rule.trigger.waiting_for) return {status:'waiting',reason:side===null?'Última mensagem não define quem deve responder.':`Última mensagem exige resposta de ${side==='group'?'participantes':'nossa equipe'}; gatilho configurado para ${rule.trigger.waiting_for==='group'?'participantes':'nossa equipe'}.`,group:group.subject,last_message_at:last.created_at,sender_type:last.sender_type,is_bot:last.is_bot};
    const elapsed=Math.floor((now.getTime()-Math.max(last.created_at.getTime(),rule.updated_at.getTime()))/60000);
    const key=`silence:${rule.trigger.waiting_for}:${last.id}`;
    const prior=await prisma.groupAutomationExecution.findUnique({where:{automation_id_execution_key:{automation_id:rule.id,execution_key:key}},select:{status:true,details:true}});
    if(prior) return {status:prior.status==='completed'?'completed':prior.status==='failed'?'failed':'processing',reason:prior.status==='completed'?'Esta mensagem já acionou a automação.':prior.status==='failed'?'A execução falhou. Consulte o erro no histórico.':'Disparo já registrado, aguardando conclusão.',group:group.subject,last_message_at:last.created_at,execution_error:prior.details?.error};
    if(elapsed<rule.trigger.timeout_minutes) return {status:'waiting',reason:`Aguardando ${rule.trigger.timeout_minutes-elapsed} minuto(s) para o prazo de ${rule.trigger.timeout_minutes} minuto(s).`,group:group.subject,last_message_at:last.created_at};
    return {status:'ready',reason:'Prazo atingido; o próximo ciclo do executor deve processar a ação.',group:group.subject,last_message_at:last.created_at};
  }
  const {day,clock}=zonedDay(now,TIME_ZONE);
  const times=[...summaryTimes(rule.trigger)].sort();
  const previous=await prisma.groupAutomationExecution.findMany({where:{automation_id:rule.id,execution_key:{startsWith:`daily:${day}`}},select:{execution_key:true,status:true,details:true}});
  const activated=zonedDay(rule.updated_at,TIME_ZONE);
  let completedCount=0;
  for(const time of times) {
    if(summaryAlreadyDelivered(previous,group.id,`daily:${day}`,time,times[0])) {completedCount++;continue;}
    const key=summaryExecutionKey(rule,day,group.id,time);
    const prior=previous.find(r=>r.execution_key===key);
    if(prior) return {status:prior.status==='failed'?'failed':'processing',reason:prior.status==='failed'?`Resumo das ${time} falhou; edite e salve para tentar novamente.`:`Resumo das ${time} em processamento.`,group:group.subject,execution_error:prior.details?.error};
    if(clock<time) return {status:'waiting',reason:`Aguardando próximo resumo às ${time} (São Paulo). ${completedCount} concluído(s) hoje.`,group:group.subject};
    if(activated.day===day && activated.clock>time) continue;
    return {status:'ready',reason:`Resumo das ${time} pronto para o próximo ciclo do executor.`,group:group.subject};
  }
  if(completedCount===times.length) return {status:'completed',reason:`Todos os ${times.length} horários concluídos neste grupo hoje.`,group:group.subject};
  return {status:'waiting',reason:'Horários anteriores à última edição não serão executados retroativamente; próximo resumo no horário futuro.',group:group.subject};
}

async function storeDiagnostic(rule, result, now, groupId) {
  const day=zonedDay(now,TIME_ZONE).day;
  const data={status:result.status,finished_at:now,details:{...result,checked_at:now.toISOString(),kind:'diagnostic'}};
  await prisma.groupAutomationExecution.upsert({where:{automation_id_execution_key:{automation_id:rule.id,execution_key:`diagnostic:${day}:${groupId || rule.trigger.group_id}`}},
    create:{id:randomUUID(),org_id:rule.org_id,automation_id:rule.id,execution_key:`diagnostic:${day}:${groupId || rule.trigger.group_id}`,...data},update:data});
}
export async function diagnoseGroupAutomations(orgId, now=new Date(), maxGroups=Infinity) {
  const rules=await prisma.automation.findMany({where:{org_id:orgId},orderBy:{created_at:'asc'},take:500});
  const results=[];
  for(const rule of rules) {
    if(!groupRuleType(rule.trigger)) continue;
    const ids=rule.trigger.type==='group_daily_summary'?summaryGroupIds(rule.trigger):[rule.trigger.group_id];
    for(const groupId of ids) {
      if(results.length>=maxGroups) return results;
      let result;
      try { result=await diagnoseRule(rule,now,groupId); }
      catch(error) { result={status:'failed',reason:`Erro ao verificar: ${logError(error)}`}; }
      await storeDiagnostic(rule,result,now,groupId);
      results.push({automation_id:rule.id,name:rule.name,group_id:groupId,...result,checked_at:now.toISOString()});
    }
  }
  return results;
}

export async function groupAutomationTick(now=new Date()) {
  if(running) return;
  running=true;
  lastTickAt=now.toISOString();
  lastTickError=null;
  try {
    // Only saved, active rules with explicitly selected group IDs. Never enumerate every group.
    const rules=await prisma.automation.findMany({where:{status:'active'},orderBy:{created_at:'asc'},take:500});
    for(const rule of rules) {
      if(!groupRuleType(rule.trigger)) continue;
      const failure=groupTriggerError(rule.trigger,rule.actions);
      if(failure) { console.warn('[Group automation] Regra inválida:',rule.id,failure); continue; }
      try {
        const authorized=await runtimeChannelIds(rule); if(!authorized.length) continue;
        const ids=rule.trigger.type==='group_daily_summary'?summaryGroupIds(rule.trigger):[rule.trigger.group_id];
        // Fetch the day's deliveries once per automation, not once per group/time.
        const daily=rule.trigger.type==='group_daily_summary';
        const day=zonedDay(now,TIME_ZONE).day;
        const previous=daily ? await prisma.groupAutomationExecution.findMany({
          where:{automation_id:rule.id,execution_key:{startsWith:`daily:${day}`}},
          select:{execution_key:true,status:true,details:true}
        }) : [];
        for(const groupId of ids) {
          try {
            const group=await activeGroup({...rule,trigger:{...rule.trigger,group_id:groupId}},authorized);
            if(!group) continue;
            if(rule.trigger.type==='group_no_reply') await runSilence(rule,group,now);
            else {
              for(const time of [...summaryTimes(rule.trigger)].sort())
                await runDaily(rule,group,now,authorized,time,previous);
            }
          } catch(groupError) {
            console.error('[Group automation] Falha no grupo:',rule.id,groupId,logError(groupError));
          }
        }
      } catch(error) {
        console.error('[Group automation] Erro inesperado:',rule.id,logError(error));
        try { await storeDiagnostic(rule,{status:'failed',reason:`Falha inesperada no executor: ${logError(error)}`},now); }
        catch(logFailure) { console.error('[Group automation] Falha ao registrar erro:',logError(logFailure)); }
      }
    }
    // Automatic diagnostics are sampled and throttled so 500+ groups do not
    // create thousands of DB writes each scheduler tick. Manual diagnostics stay complete.
    if(now.getTime()-lastAutoDiagnosticAt>=15*60*1000) {
      lastAutoDiagnosticAt=now.getTime();
      const orgIds=[...new Set(rules.filter(r=>groupRuleType(r.trigger)).map(r=>r.org_id))];
      for(const orgId of orgIds) {
        try { await diagnoseGroupAutomations(orgId,now,50); }
        catch(error) { console.error('[Group automation] Falha ao registrar diagnóstico:',logError(error)); }
      }
    }
  } catch(error) { lastTickError=logError(error); throw error; }
  finally { running=false; }
}
