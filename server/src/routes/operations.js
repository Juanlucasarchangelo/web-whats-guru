import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { prisma } from '../db.js';
import { HttpError, wrap } from '../http.js';
import { ensureChannel, hasMarketingConsent, validPhone } from '../services/operations-engine.js';
import { visibleChannelIds } from '../services/channel-access.js';

const uuid=z.string().uuid();
const campaignCreate=z.object({name:z.string().trim().min(2).max(150),message:z.string().trim().min(1).max(2000),integration_id:uuid,segment_stage:z.enum(['lead','qualified','negotiation','won','lost']).nullable().optional(),segment_tags:z.array(uuid).max(20).default([]),daily_limit:z.number().int().min(1).max(30).default(15),scheduled_at:z.string().datetime().nullable().optional()}).strict();
const scheduleCreate=z.object({title:z.string().trim().min(2).max(150),contact_id:uuid.nullable().optional(),integration_id:uuid.nullable().optional(),message:z.string().trim().max(3000).nullable().optional(),scheduled_at:z.string().datetime(),send_whatsapp:z.boolean().default(false)}).strict();
function mustAdmin(req){if(!['owner','admin'].includes(req.role))throw new HttpError(403,'Somente administradores podem gerenciar campanhas.');}
async function authorizedChannel(req,id) {
  if(!(await visibleChannelIds(req)).includes(id))throw new HttpError(403,'Numero sem permissao.');
  try{return await ensureChannel(req.orgId,id);}catch(err){throw new HttpError(400,err.message);}
}

export function operationsRouter(){
 const router=Router();
 router.get('/channels',wrap(async(req,res)=>{
  const ids=await visibleChannelIds(req);
  const integrations=ids.length?await prisma.integration.findMany({where:{org_id:req.orgId,id:{in:ids},type:'whatsapp'},select:{id:true,name:true,config:true,status:true}}):[];
  res.json({data:integrations.map(r=>({id:r.id,name:r.name,provider:r.config?.provider,status:r.status}))});
 }));
 router.get('/campaigns',wrap(async(req,res)=>{
  mustAdmin(req);
  res.json({data:await prisma.campaign.findMany({where:{org_id:req.orgId},orderBy:{created_at:'desc'},take:200})});
 }));
 router.post('/campaigns',wrap(async(req,res)=>{
  mustAdmin(req);
  const v=campaignCreate.parse(req.body);
  await authorizedChannel(req,v.integration_id);
  const tags=await prisma.tag.count({where:{org_id:req.orgId,id:{in:v.segment_tags}}});
  if(tags!==v.segment_tags.length)throw new HttpError(400,'Uma etiqueta nao pertence a empresa.');
  const campaign=await prisma.campaign.create({data:{id:randomUUID(),org_id:req.orgId,name:v.name,message:v.message,channel:'whatsapp',integration_id:v.integration_id,segment_tags:v.segment_tags,segment_stage:v.segment_stage||null,scheduled_at:v.scheduled_at?new Date(v.scheduled_at):null,status:'draft',consent_required:true,daily_limit:v.daily_limit,created_by:req.user.id}});
  res.status(201).json(campaign);
 }));
 router.get('/campaigns/:id/recipients',wrap(async(req,res)=>{
  mustAdmin(req);const id=uuid.parse(req.params.id);
  const campaign=await prisma.campaign.findFirst({where:{id,org_id:req.orgId}});
  if(!campaign)throw new HttpError(404,'Campanha nao encontrada.');
  const recipients=await prisma.campaignRecipient.findMany({where:{campaign_id:id},orderBy:{created_at:'desc'},take:1000});
  const contacts=await prisma.contact.findMany({where:{org_id:req.orgId,id:{in:recipients.map(r=>r.contact_id)}},select:{id:true,name:true,phone:true}});
  const by=new Map(contacts.map(c=>[c.id,c]));
  res.json({data:recipients.map(r=>({...r,contact:by.get(r.contact_id)||null}))});
 }));
 router.get('/campaigns/:id/preview',wrap(async(req,res)=>{
  mustAdmin(req);const id=uuid.parse(req.params.id);
  const campaign=await prisma.campaign.findFirst({where:{id,org_id:req.orgId}});
  if(!campaign)throw new HttpError(404,'Campanha nao encontrada.');
  const contacts=await recipientsFor(req.orgId,campaign);
  res.json({eligible:contacts.length,contacts:contacts.slice(0,30).map(c=>({id:c.id,name:c.name,phone:c.phone}))});
 }));
 router.post('/campaigns/:id/activate',wrap(async(req,res)=>{
  mustAdmin(req);const id=uuid.parse(req.params.id);
  const campaign=await prisma.campaign.findFirst({where:{id,org_id:req.orgId}});
  if(!campaign)throw new HttpError(404,'Campanha nao encontrada.');
  if(campaign.status!=='draft')throw new HttpError(409,'Somente campanhas em rascunho podem ser ativadas.');
  await authorizedChannel(req,campaign.integration_id);
  const contacts=await recipientsFor(req.orgId,campaign);
  if(!contacts.length)throw new HttpError(409,'Nenhum contato elegivel COM consentimento registrado e telefone valido.');
  if(contacts.length>200)throw new HttpError(409,'Campanha excede 200 destinatarios. Refine o segmento.');
  await prisma.$transaction(async tx=>{
   const claim=await tx.campaign.updateMany({where:{id,status:'draft',org_id:req.orgId},data:{status:'scheduled',scheduled_at:campaign.scheduled_at&&campaign.scheduled_at>new Date()?campaign.scheduled_at:new Date()}});
   if(claim.count!==1)throw new HttpError(409,'Campanha ja iniciada.');
   for(const contact of contacts){await tx.campaignRecipient.create({data:{id:randomUUID(),campaign_id:id,contact_id:contact.id,status:'pending'}});}
  },{timeout:15000});
  res.json({activated:true,recipients:contacts.length,note:'Envio gradual. Aceita pela Evolution nao equivale a entregue ou lida.'});
 }));
 router.post('/campaigns/:id/pause',wrap(async(req,res)=>{
  mustAdmin(req);const id=uuid.parse(req.params.id);
  const result=await prisma.campaign.updateMany({where:{id,org_id:req.orgId,status:{in:['scheduled','sending']}},data:{status:'paused'}});
  if(!result.count)throw new HttpError(409,'Campanha nao esta em execucao.');
  res.json({paused:true});
 }));
 router.post('/campaigns/:id/resume',wrap(async(req,res)=>{
  mustAdmin(req);const id=uuid.parse(req.params.id);
  const result=await prisma.campaign.updateMany({where:{id,org_id:req.orgId,status:'paused'},data:{status:'sending',scheduled_at:new Date()}});
  if(!result.count)throw new HttpError(409,'Campanha nao esta pausada.');
  res.json({resumed:true});
 }));
 router.delete('/campaigns/:id',wrap(async(req,res)=>{
  mustAdmin(req);const id=uuid.parse(req.params.id);
  const c=await prisma.campaign.findFirst({where:{id,org_id:req.orgId}});
  if(!c)throw new HttpError(404,'Campanha nao encontrada.');
  if(!['draft','completed','paused','failed'].includes(c.status))throw new HttpError(409,'Pause a campanha antes de excluir.');
  await prisma.$transaction(async tx=>{await tx.campaignRecipient.deleteMany({where:{campaign_id:id}});await tx.campaign.delete({where:{id}});});
  res.json({deleted:true});
 }));
 router.get('/consent',wrap(async(req,res)=>{
  mustAdmin(req);
  const contacts=await prisma.contact.findMany({where:{org_id:req.orgId},orderBy:{name:'asc'},take:500,select:{id:true,name:true,phone:true,custom_fields:true}});
  res.json({data:contacts.map(c=>({id:c.id,name:c.name,phone:c.phone,opt_in:hasMarketingConsent(c)}))});
 }));
 router.put('/consent/:contactId',wrap(async(req,res)=>{
  mustAdmin(req);const id=uuid.parse(req.params.contactId);
  const {consent,source}=z.object({consent:z.boolean(),source:z.string().trim().min(5).max(150)}).strict().parse(req.body);
  const c=await prisma.contact.findFirst({where:{id,org_id:req.orgId}});
  if(!c)throw new HttpError(404,'Contato nao encontrado.');
  await prisma.$transaction(async tx=>{
   await tx.contact.update({where:{id},data:{custom_fields:{...(c.custom_fields||{}),whatsapp_marketing_opt_in:consent,whatsapp_marketing_source:source,whatsapp_marketing_at:new Date().toISOString()}}});
   await tx.auditLog.create({data:{id:randomUUID(),org_id:req.orgId,user_id:req.user.id,action:consent?'marketing.consent_granted':'marketing.consent_revoked',entity_type:'contact',entity_id:id,details:{source}}});
  });
  res.json({saved:true});
 }));
 router.get('/schedules',wrap(async(req,res)=>{
  const list=await prisma.schedule.findMany({where:{org_id:req.orgId,...(['owner','admin'].includes(req.role)?{}:{created_by:req.user.id})},orderBy:{scheduled_at:'asc'},take:250});
  const contacts=await prisma.contact.findMany({where:{org_id:req.orgId,id:{in:list.map(x=>x.contact_id).filter(Boolean)}},select:{id:true,name:true}});
  const by=new Map(contacts.map(c=>[c.id,c]));
  res.json({data:list.map(r=>({...r,contact:by.get(r.contact_id)||null}))});
 }));
 router.post('/schedules',wrap(async(req,res)=>{
  const v=scheduleCreate.parse(req.body);const date=new Date(v.scheduled_at);
  if(date<=new Date())throw new HttpError(400,'Selecione data futura.');
  if(date.getTime()-Date.now()>366*86400000)throw new HttpError(400,'Agende no maximo 1 ano a frente.');
  let contact=null;
  if(v.contact_id){contact=await prisma.contact.findFirst({where:{id:v.contact_id,org_id:req.orgId}});if(!contact)throw new HttpError(404,'Contato nao encontrado.');}
  if(v.send_whatsapp){
    if(!v.contact_id||!v.integration_id||!v.message)throw new HttpError(400,'Envio automatico exige contato, mensagem e WhatsApp.');
    if(!validPhone(contact.phone))throw new HttpError(400,'Telefone invalido ou sem DDI.');
    await authorizedChannel(req,v.integration_id);
  }
  const row=await prisma.schedule.create({data:{id:randomUUID(),org_id:req.orgId,title:v.title,contact_id:v.contact_id||null,message:v.message||null,scheduled_at:date,channel:'whatsapp',integration_id:v.send_whatsapp?v.integration_id:null,delivery_enabled:v.send_whatsapp,status:'pending',created_by:req.user.id}});
  res.status(201).json(row);
 }));
 router.patch('/schedules/:id',wrap(async(req,res)=>{
  const id=uuid.parse(req.params.id);const v=scheduleCreate.parse(req.body);
  const row=await prisma.schedule.findFirst({where:{id,org_id:req.orgId,...(['owner','admin'].includes(req.role)?{}:{created_by:req.user.id})}});
  if(!row)throw new HttpError(404,'Agendamento nao encontrado.');
  if(row.status!=='pending')throw new HttpError(409,'Somente pendentes podem ser editados.');
  const date=new Date(v.scheduled_at);
  if(date<=new Date())throw new HttpError(400,'Selecione uma data futura.');
  if(v.contact_id){const contact=await prisma.contact.findFirst({where:{id:v.contact_id,org_id:req.orgId}});if(!contact)throw new HttpError(404,'Contato nao encontrado.');if(v.send_whatsapp&&!validPhone(contact.phone))throw new HttpError(400,'Telefone com DDI invalido.');}
  if(v.send_whatsapp){if(!v.contact_id||!v.integration_id||!v.message)throw new HttpError(400,'Informe contato, WhatsApp e mensagem.');await authorizedChannel(req,v.integration_id);}
  const result=await prisma.schedule.updateMany({where:{id,status:'pending'},data:{title:v.title,contact_id:v.contact_id||null,scheduled_at:date,message:v.message||null,integration_id:v.send_whatsapp?v.integration_id:null,delivery_enabled:v.send_whatsapp}});
  if(!result.count)throw new HttpError(409,'Ja esta em processamento.');res.json({saved:true});
 }));
 router.post('/schedules/:id/send-now',wrap(async(req,res)=>{
  const id=uuid.parse(req.params.id);
  const where={id,org_id:req.orgId,...(['owner','admin'].includes(req.role)?{}:{created_by:req.user.id}),status:'pending',delivery_enabled:true};
  const result=await prisma.schedule.updateMany({where,data:{scheduled_at:new Date()}});
  if(!result.count)throw new HttpError(409,'Somente agendamentos de envio WhatsApp pendentes podem ser executados agora.');
  res.json({queued:true,note:'Execucao na proxima rodada, em ate 30 segundos.'});
 }));
 router.post('/schedules/:id/complete',wrap(async(req,res)=>{
  const id=uuid.parse(req.params.id);
  const where={id,org_id:req.orgId,...(['owner','admin'].includes(req.role)?{}:{created_by:req.user.id}),status:'pending',delivery_enabled:false};
  const result=await prisma.schedule.updateMany({where,data:{status:'done'}});
  if(!result.count)throw new HttpError(409,'Apenas lembretes internos pendentes podem ser concluidos.');
  res.json({done:true});
 }));
 router.post('/schedules/:id/cancel',wrap(async(req,res)=>{
  const id=uuid.parse(req.params.id);
  const where={id,org_id:req.orgId,...(['owner','admin'].includes(req.role)?{}:{created_by:req.user.id}),status:'pending'};
  const claim=await prisma.schedule.updateMany({where,data:{status:'cancelled'}});
  if(!claim.count)throw new HttpError(409,'Agendamento nao pode mais ser cancelado (ja executado ou em processamento).');
  res.json({cancelled:true});
 }));
 router.delete('/schedules/:id',wrap(async(req,res)=>{
  const id=uuid.parse(req.params.id);const row=await prisma.schedule.findFirst({where:{id,org_id:req.orgId,...(['owner','admin'].includes(req.role)?{}:{created_by:req.user.id})}});
  if(!row)throw new HttpError(404,'Agendamento nao encontrado.');
  if(!['cancelled','sent','failed','done'].includes(row.status))throw new HttpError(409,'Cancele antes de excluir.');
  await prisma.schedule.delete({where:{id}});res.json({deleted:true});
 }));
 router.get('/schedules/:id/log',wrap(async(req,res)=>{
  const id=uuid.parse(req.params.id);const row=await prisma.schedule.findFirst({where:{id,org_id:req.orgId,...(['owner','admin'].includes(req.role)?{}:{created_by:req.user.id})}});
  if(!row)throw new HttpError(404,'Agendamento nao encontrado.');
  res.json({data:await prisma.auditLog.findMany({where:{org_id:req.orgId,entity_type:'schedule',entity_id:id},orderBy:{created_at:'desc'},take:10})});
 }));
 return router;
}

async function recipientsFor(orgId,campaign) {
 const where={org_id:orgId,...(campaign.segment_stage?{crm_stage:campaign.segment_stage}:{})};
 const contacts=await prisma.contact.findMany({where,select:{id:true,name:true,phone:true,custom_fields:true},take:1000});
 const ids=Array.isArray(campaign.segment_tags)?campaign.segment_tags:[];
 const eligible=contacts.filter(c=>hasMarketingConsent(c)&&validPhone(c.phone));
 if(!ids.length)return eligible;
 const links=await prisma.contactTag.findMany({where:{contact_id:{in:eligible.map(c=>c.id)},tag_id:{in:ids}},select:{contact_id:true,tag_id:true}});
 const by=new Map();for(const r of links){if(!by.has(r.contact_id))by.set(r.contact_id,new Set());by.get(r.contact_id).add(r.tag_id);}
 return eligible.filter(c=>ids.every(id=>by.get(c.id)?.has(id)));
}
