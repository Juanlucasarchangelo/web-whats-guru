import { Router } from 'express';
import { prisma } from '../db.js';
import { wrap, HttpError } from '../http.js';
import { inboxChannelIds } from '../services/channel-access.js';
import { diagnoseGroupAutomations, groupSchedulerStatus } from '../services/group-automation-engine.js';

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
