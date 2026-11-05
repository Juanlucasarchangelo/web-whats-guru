import { randomUUID } from 'node:crypto';
import { prisma } from '../db.js';

// Auditoria leve de mutacoes autenticadas. Nao grava corpos, senhas, tokens ou parametros de URL.
// Logs existentes de negocio continuam independentes. Falhas de auditoria nao devem derrubar atendimento.
export function auditMutation(req,res,next){
  if(!['POST','PUT','PATCH','DELETE'].includes(req.method))return next();
  const section=String(req.path||'/').split('/').filter(Boolean)[0]||'root';
  res.once('finish',()=>{
    if(res.statusCode<200 || res.statusCode>=400)return;
    void prisma.devActivity.create({data:{
      id:randomUUID(),actor_id:req.user?.id||null,
      action:'api_mutation',target_user_id:req.user?.id||null,
      details:{method:req.method,area:section,org_id:req.orgId||null,http_status:res.statusCode},
    }}).catch(error=>console.error('[Audit DEV] Falha de registro:',error?.code||'ERROR'));
  });
  next();
}
