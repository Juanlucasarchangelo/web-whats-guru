/** Authenticated, organization-scoped preview and delivery logs. No public push route. */
import { Router } from 'express';
import { prisma } from '../db.js';
import { wrap, HttpError } from '../http.js';
import { previewExternalRule,requestCustomers,n8nEndpoint } from '../services/external-date-engine.js';
const UUID=/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;
async function requiredRule(req){
  if(!UUID.test(String(req.params.id||'')))throw new HttpError(400,'Automação inválida.');
  const rule=await prisma.automation.findFirst({where:{id:req.params.id,org_id:req.orgId}});
  if(!rule||rule.trigger?.type!=='external_json')throw new HttpError(404,'Automação não encontrada.');
  return rule;
}
export function externalAutomationsAdminRouter(){
  const router=Router();
  router.post('/:id/preview',wrap(async(req,res)=>{
    const rule=await requiredRule(req);
    try{res.json(await previewExternalRule(rule,req.body));}
    catch(error){throw new HttpError(400,error.message);}
  }));
  router.post('/:id/test-connection',wrap(async(req,res)=>{
    const rule=await requiredRule(req);
    try{const customers=await requestCustomers(rule.org_id,rule.id);
      res.json(await previewExternalRule(rule,{clientes:customers.map(c=>({id_externo:c.id,nome:c.nome,telefone:c.telefone,
        data_nascimento:c.data_nascimento,filhos:c.filhos,faturas:c.faturas,consentimento_whatsapp:c.consentimento_whatsapp}))}));}
    catch(error){throw new HttpError(502,String(error.message||error).slice(0,250));}
  }));
  router.get('/:id/runs',wrap(async(req,res)=>{
    const rule=await requiredRule(req);
    const logs=await prisma.webhookEvent.findMany({where:{org_id:rule.org_id,source:'external_dates'},orderBy:{received_at:'desc'},take:100});
    res.json({configured:Boolean(process.env.N8N_DATA_WEBHOOK_URL),runs:logs.filter(log=>log.payload?.automation_id===rule.id).slice(0,30)
      .map(log=>({id:log.id,type:log.event_type,processed:log.processed,error:log.error,at:log.received_at,details:log.payload}))});
  }));
  return router;
}
