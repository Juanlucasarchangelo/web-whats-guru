import { Router } from 'express';
import { prisma } from '../db.js';
import { HttpError, wrap } from '../http.js';
import { conversationScope, visibleChannelIds } from '../services/channel-access.js';

const dateKey=d=>new Date(d).toISOString().slice(0,10);
const avg=arr=>arr.length?Math.round(arr.reduce((sum,n)=>sum+n,0)/arr.length):null;
export function reportsRouter(){
 const router=Router();
 router.get('/',wrap(async(req,res)=>{
  const days=Number(req.query.days||30);
  if(![7,30,90].includes(days))throw new HttpError(400,'Periodo deve ser 7, 30 ou 90 dias.');
  const integrationId=typeof req.query.integration_id==='string'?req.query.integration_id:null;
  if(integrationId && !(await visibleChannelIds(req)).includes(integrationId))throw new HttpError(403,'Numero nao autorizado.');
  const start=new Date();start.setHours(0,0,0,0);start.setDate(start.getDate()-(days-1));
  const scope=await conversationScope(req);
  const where=integrationId?{AND:[scope,{integration_id:integrationId}]}:scope;
  const conversations=await prisma.conversation.findMany({where,select:{id:true,channel:true,status:true,integration_id:true,created_at:true,assigned_to:true},take:10000,orderBy:{created_at:'desc'}});
  const convIds=conversations.map(c=>c.id);
  const msgWhere={org_id:req.orgId,conversation_id:{in:convIds},created_at:{gte:start},is_internal:false};
  const [messages,totalContacts,stages,integrations,campaigns,schedules]=await Promise.all([
    convIds.length?prisma.message.findMany({where:msgWhere,select:{conversation_id:true,created_at:true,sender_type:true,is_bot:true},orderBy:[{conversation_id:'asc'},{created_at:'asc'}],take:20000}):[],
    prisma.contact.count({where:{org_id:req.orgId}}),
    prisma.contact.groupBy({by:['crm_stage'],where:{org_id:req.orgId},_count:{_all:true}}),
    prisma.integration.findMany({where:{id:{in:await visibleChannelIds(req)}},select:{id:true,name:true}}),
    prisma.campaign.findMany({where:{org_id:req.orgId,created_at:{gte:start}},select:{id:true,sent_count:true,failed_count:true,status:true}}),
    prisma.schedule.groupBy({by:['status'],where:{org_id:req.orgId,created_at:{gte:start}},_count:{_all:true}}),
  ]);
  const byDate={};for(let i=0;i<days;i++){const d=new Date(start);d.setDate(start.getDate()+i);byDate[dateKey(d)]={date:dateKey(d),incoming:0,outgoing:0};}
  const group={};const responseMs=[];
  for(const m of messages){
   const item=byDate[dateKey(m.created_at)];if(item){if(m.sender_type==='contact')item.incoming++;else item.outgoing++;}
   const g=group[m.conversation_id]||{lastIncoming:null};
   if(m.sender_type==='contact'&&g.lastIncoming===null)g.lastIncoming=new Date(m.created_at).getTime();
   if(m.sender_type==='agent'&&g.lastIncoming!==null){const ms=new Date(m.created_at).getTime()-g.lastIncoming;if(ms>=0)responseMs.push(ms);g.lastIncoming=null;}
   group[m.conversation_id]=g;
  }
  const channelLookup=new Map(integrations.map(r=>[r.id,r.name]));
  const byChannel={};for(const c of conversations){const label=c.integration_id?(channelLookup.get(c.integration_id)||'Outro WhatsApp'):c.channel;byChannel[label]=(byChannel[label]||0)+1;}
  const open=conversations.filter(c=>['open','pending'].includes(c.status)).length;
  const closed=conversations.filter(c=>['closed','resolved'].includes(c.status)).length;
  const byStage=Object.fromEntries(stages.map(s=>[s.crm_stage,s._count._all]));
  res.json({days,totalContacts,totalConversations:conversations.length,openConversations:open,closedConversations:closed,totalMessages:messages.length,incoming:messages.filter(m=>m.sender_type==='contact').length,outgoing:messages.filter(m=>m.sender_type!=='contact').length,botMessages:messages.filter(m=>m.is_bot||m.sender_type==='bot').length,avgResponseMinutes:responseMs.length?Math.round(avg(responseMs)/60000):null,measuredResponses:responseMs.length,resolutionRate:conversations.length?Math.round(closed/conversations.length*100):0,byChannel,byStage,byDate:Object.values(byDate),campaigns:{count:campaigns.length,accepted:campaigns.reduce((a,c)=>a+c.sent_count,0),failed:campaigns.reduce((a,c)=>a+c.failed_count,0)},schedules:Object.fromEntries(schedules.map(s=>[s.status,s._count._all])),partial:conversations.length>=10000||messages.length>=20000,generatedAt:new Date().toISOString()});
 }));
 return router;
}
