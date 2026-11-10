import { Router } from 'express';
import { prisma } from '../db.js';
import { wrap, HttpError } from '../http.js';
import { inboxChannelIds } from '../services/channel-access.js';
import { diagnoseGroupAutomations, groupSchedulerStatus, runManualSummaries } from '../services/group-automation-engine.js';
import { validUuid } from '../services/group-automation-policy.js';

// Explicit, instance-scoped lists. No endpoint ever enumerates group participants.
export function groupAutomationsRouter() {
  const router=Router();
  router.get('/groups',wrap(async(req,res)=>{
    const allowed=await inboxChannelIds(req);
    const groups=allowed.length ? await prisma.whatsAppGroup.findMany({
      where:{org_id:req.orgId,integration_id:{in:allowed}},orderBy:{subject:'asc'},take:1000,
      select:{id:true,subject:true,jid:true,integration_id:true,conversation_id:true}}) : [];
    const integrations=allowed.length ? await prisma.integration.findMany({
      where:{org_id:req.orgId,id:{in:allowed},type:'whatsapp'},select:{id:true,name:true,config:true}}):[];
    res.json({groups,integrations:integrations.map(i=>({id:i.id,name:i.config?.instance_name || i.name}))});
  }));
  // Search/paginate groups server-side. Even 500+ groups in one instance render 30 at a time.
  router.get('/groups/picker',wrap(async(req,res)=>{
    const allowed=await inboxChannelIds(req);
    const channel=String(req.query.integration_id || '');
    if(channel && !allowed.includes(channel)) throw new HttpError(403,'Instância não autorizada.');
    const page=Math.min(10000,Math.max(0,Number.parseInt(String(req.query.page || '0'),10)||0));
    const limit=Math.min(50,Math.max(1,Number.parseInt(String(req.query.limit || '30'),10)||30));
    const query=String(req.query.q || '').trim().slice(0,120);
    if(!allowed.length) return res.json({groups:[],total:0,page,limit});
    const where={org_id:req.orgId,integration_id:{in:channel?[channel]:allowed},...(query?{subject:{contains:query}}:{})};
    const [total,groups]=await Promise.all([
      prisma.whatsAppGroup.count({where}),
      prisma.whatsAppGroup.findMany({where,orderBy:[{subject:'asc'},{id:'asc'}],skip:page*limit,take:limit,
        select:{id:true,subject:true,integration_id:true}}),
    ]);
    res.json({groups,total,page,limit});
  }));
  // Resolve selected IDs from older saved rules even if they are outside page 1.
  router.post('/groups/lookup',wrap(async(req,res)=>{
    const ids=req.body?.ids;
    if(!Array.isArray(ids) || ids.length>1000 || ids.some(id=>!validUuid(id)))
      throw new HttpError(400,'Lista de grupos inválida.');
    const allowed=await inboxChannelIds(req);
    const groups=ids.length && allowed.length ? await prisma.whatsAppGroup.findMany({
      where:{org_id:req.orgId,id:{in:ids},integration_id:{in:allowed}},
      select:{id:true,subject:true,integration_id:true}}) : [];
    res.json({groups});
  }));
  router.post('/:automationId/run-now',wrap(async(req,res)=>{
    if(!validUuid(req.params.automationId)) throw new HttpError(400,'ID da automação inválido.');
    try {
      const result=await runManualSummaries(req.orgId,req.params.automationId,req);
      res.status(202).json({status:'accepted',...result});
    } catch(error) { throw new HttpError(400,String(error?.message || error)); }
  }));
  router.post('/diagnose',wrap(async(req,res)=>{
    const diagnostics=await diagnoseGroupAutomations(req.orgId);
    res.json({diagnostics,scheduler:groupSchedulerStatus()});
  }));
  router.get('/runs',wrap(async(req,res)=>{
    const runs=await prisma.groupAutomationExecution.findMany({where:{org_id:req.orgId},
      orderBy:{created_at:'desc'},take:150,select:{id:true,execution_key:true,status:true,details:true,created_at:true,finished_at:true,
        automation:{select:{name:true}}}});
    const sorted=runs.map(({automation,...run})=>({...run,name:automation?.name || 'Automação removida'})).sort((a,b)=>new Date(b.finished_at || b.created_at).getTime()-new Date(a.finished_at || a.created_at).getTime()).slice(0,50);
    res.json({runs:sorted,scheduler:groupSchedulerStatus()});
  }));
  router.get('/recipients',wrap(async(req,res)=>{
    const integrationId=String(req.query.integration_id || '');
    const q=String(req.query.q || '').trim().slice(0,100);
    const allowed=await inboxChannelIds(req);
    if(!allowed.includes(integrationId)) throw new HttpError(403,'WhatsApp não autorizado.');
    // No arbitrary group members: only saved CRM contacts linked to the selected instance.
    const filter={org_id:req.orgId,is_group:false,
      OR:[{contact_integrations:{some:{org_id:req.orgId,integration_id:integrationId}}},
          {conversations:{some:{org_id:req.orgId,integration_id:integrationId,is_group:false}}}]};
    const where=q?{AND:[filter,{OR:[{name:{contains:q}},{phone:{contains:q}}]}]}:filter;
    const contacts=await prisma.contact.findMany({where,orderBy:[{name:'asc'},{id:'asc'}],take:60,
      select:{id:true,name:true,phone:true}});
    res.json({contacts});
  }));
  return router;
}
