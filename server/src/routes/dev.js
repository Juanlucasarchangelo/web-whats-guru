import { Router } from 'express';
import { randomBytes, randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../db.js';
import { HttpError, wrap } from '../http.js';
import { roleRows, normalizeRole } from '../services/permissions.js';
import { REGIONS, REGION_CODES, matchesLegacyRegion } from '../services/regions.js';
import { devIntegrationsRouter } from './dev-integrations.js';

const uuid=z.string().uuid();
const emailSchema=z.string().trim().email().max(254).transform(v=>v.toLowerCase());
const statusSchema=z.enum(['active','inactive']);
const roleSchema=z.string().trim().regex(/^[a-z][a-z0-9_]{1,31}$/);
function requireDev(req,res,next) {
  if(req.user?.global_role!=='dev') return res.status(403).json({error:'Somente o DEV pode acessar esta operacao.'});
  next();
}
const audit=(tx,actor_id,action,target_user_id,details={})=>tx.devActivity.create({data:{
  id:randomUUID(),actor_id,action,target_user_id:target_user_id||null,details,
}});
const publicUser=(u)=>({
  id:u.id,email:u.email,is_active:u.is_active,global_role:u.global_role,
  approval_status:u.approval_status,requested_org_region:u.requested_org_region,requested_org_id:u.requested_org_id,created_at:u.created_at,last_login_at:u.last_login_at,
  name:u.user_profiles?.full_name||'',memberships:(u.org_members||[]).map(m=>({
    id:m.id,org_id:m.org_id,org_name:m.organizations.name,role:normalizeRole(m.role),status:m.status,
  })),
});
const userInclude={user_profiles:{select:{full_name:true}},org_members:{include:{organizations:{select:{name:true}}}}};
async function targetUser(id,actorId) {
  const user=await prisma.user.findUnique({where:{id},include:userInclude});
  if(!user)throw new HttpError(404,'Usuario nao encontrado.');
  if(user.id===actorId)throw new HttpError(403,'Nao e permitido modificar a propria conta DEV.');
  if(user.global_role==='dev')throw new HttpError(403,'Uma conta DEV nao pode ser alterada por esta interface.');
  return user;
}

export function devRouter() {
  const router=Router();
  router.use(requireDev);
  router.use('/integrations',devIntegrationsRouter());
  router.get('/summary',wrap(async(_req,res)=>{
    const [pending,total,active,organizations,teams]=await Promise.all([
      prisma.user.count({where:{approval_status:'pending'}}),
      prisma.user.count({where:{approval_status:{not:'deleted'}}}),prisma.user.count({where:{is_active:true,approval_status:'approved'}}),
      prisma.organization.count({where:{status:{not:'deleted'}}}),prisma.team.count({where:{organizations:{status:{not:'deleted'}}}}),
    ]);
    res.json({pending,total,active,organizations,teams,notifications_configured:Boolean(process.env.DEV_NOTIFICATION_EMAIL&&process.env.RESEND_API_KEY&&process.env.RESEND_FROM_EMAIL)});
  }));
  router.get('/users',wrap(async(req,res)=>{
    const q=String(req.query.q||'').trim().slice(0,120);
    const page=Math.max(1,Math.min(100000,Number(req.query.page)||1));
    const limit=50;
    const status=String(req.query.status||'all');
    const where={
      ...(status==='pending'?{approval_status:'pending'}:status==='deleted'?{approval_status:'deleted'}:status==='blocked'?{is_active:false,approval_status:'approved'}:{approval_status:{not:'deleted'}}),
      ...(q?{OR:[{email:{contains:q}},{user_profiles:{is:{full_name:{contains:q}}}}]}:{}),
    };
    const [users,total]=await Promise.all([
      prisma.user.findMany({where,include:userInclude,orderBy:{created_at:'desc'},skip:(page-1)*limit,take:limit}),
      prisma.user.count({where}),
    ]);
    res.json({data:users.map(publicUser),total,page,per_page:limit});
  }));
  router.get('/users/:id/activity',wrap(async(req,res)=>{
    const id=uuid.parse(req.params.id);
    const user=await prisma.user.findUnique({where:{id},select:{id:true}});
    if(!user)throw new HttpError(404,'Usuario nao encontrado.');
    const [globalEvents,orgEvents]=await Promise.all([
      prisma.devActivity.findMany({where:{OR:[{actor_id:id},{target_user_id:id}]},orderBy:{created_at:'desc'},take:100}),
      prisma.auditLog.findMany({where:{user_id:id},orderBy:{created_at:'desc'},take:100,
        select:{id:true,action:true,created_at:true,org_id:true}}),
    ]);
    res.json({data:[...globalEvents,...orgEvents].sort((a,b)=>b.created_at.getTime()-a.created_at.getTime()).slice(0,150)});
  }));
  router.get('/organizations',wrap(async(req,res)=>{
    const organizations=await prisma.organization.findMany({
      where:req.query.deleted==='true'?{status:'deleted'}:{status:{not:'deleted'}},
      select:{id:true,name:true,slug:true,status:true,plan:true,region:true,created_at:true,
        _count:{select:{org_members:true,teams:true}}},orderBy:{created_at:'desc'},take:500,
    });
    res.json({data:organizations});
  }));
  router.post('/organizations',wrap(async(req,res)=>{
    const data=z.object({name:z.string().trim().min(2).max(150),region:z.enum(REGION_CODES).nullable().optional()}).strict().parse(req.body||{});
    const id=randomUUID();
    const slug=`empresa-${id.slice(0,8)}-${randomBytes(3).toString('hex')}`;
    const company=await prisma.$transaction(async tx=>{
      const created=await tx.organization.create({data:{id,name:data.name,slug,region:data.region||null,settings:{},status:'active'}});
      await tx.accessRole.createMany({data:roleRows(id).map(r=>({...r,id:randomUUID()}))});
      await audit(tx,req.user.id,'organization_created',null,{org_id:id,name:data.name});
      return created;
    });
    res.status(201).json({organization:{id:company.id,name:company.name}});
  }));
  router.get('/organizations/:id/owners',wrap(async(req,res)=>{
    const id=uuid.parse(req.params.id);
    const candidates=await prisma.orgMember.findMany({where:{org_id:id,status:'active',role:{in:['master','owner']}},include:{users:{select:{id:true,email:true,is_active:true,approval_status:true,user_profiles:{select:{full_name:true}}}}}});
    res.json({data:candidates.filter(m=>m.users.is_active&&m.users.approval_status==='approved').map(m=>({id:m.users.id,email:m.users.email,name:m.users.user_profiles?.full_name||m.users.email,role:m.role}))});
  }));
  router.get('/roles',wrap(async(req,res)=>{
    const org_id=uuid.parse(req.query.org_id);
    res.json({data:await prisma.accessRole.findMany({where:{org_id},select:{slug:true,name:true},orderBy:{created_at:'asc'}})});
  }));
  router.get('/teams',wrap(async(_req,res)=>{
    const teams=await prisma.team.findMany({where:{organizations:{status:{not:'deleted'}}},include:{organizations:{select:{name:true}},_count:{select:{team_members:true}}},orderBy:{created_at:'desc'},take:500});
    res.json({data:teams.map(t=>({id:t.id,name:t.name,description:t.description,org_id:t.org_id,org_name:t.organizations.name,members:t._count.team_members}))});
  }));
  router.get('/activity',wrap(async(_req,res)=>{
    const [events,auditLogs]=await Promise.all([
      prisma.devActivity.findMany({orderBy:{created_at:'desc'},take:100}),
      prisma.auditLog.findMany({orderBy:{created_at:'desc'},take:100,select:{id:true,org_id:true,user_id:true,action:true,entity_type:true,entity_id:true,created_at:true}}),
    ]);
    res.json({dev_events:events,organization_events:auditLogs});
  }));
  router.post('/users/:id/approve',wrap(async(req,res)=>{
    const id=uuid.parse(req.params.id);
    const input=z.object({role:z.enum(['administrador','master']).default('administrador'),org_id:uuid.optional(),region:z.enum(REGION_CODES).optional()}).strict().parse(req.body||{});
    const user=await targetUser(id,req.user.id);
    if(!['pending','rejected'].includes(user.approval_status))throw new HttpError(409,'O cadastro nao esta pendente.');
    await prisma.$transaction(async tx=>{
      const pending=await tx.user.findUnique({where:{id}});
      if(!['pending','rejected'].includes(pending?.approval_status))throw new HttpError(409,'O pedido ja foi processado.');
      const region=input.region || pending.requested_org_region;
      const invitations=await tx.orgMember.findMany({where:{user_id:id,status:'inactive'},select:{id:true,org_id:true,role:true}});
      // Team invitation: preserve the preselected role and workspace instead of inventing a new company.
      if(!pending.requested_org_region && invitations.length===1){
        const org=await tx.organization.findUnique({where:{id:invitations[0].org_id},select:{status:true}});
        if(org?.status!=='active')throw new HttpError(409,'Empresa do convite indisponivel.');
        const claimed=await tx.user.updateMany({where:{id,approval_status:{in:['pending','rejected']}},data:{approval_status:'approving'}});
        if(claimed.count!==1)throw new HttpError(409,'O pedido ja foi processado.');
        await tx.orgMember.update({where:{id:invitations[0].id},data:{status:'active'}});
        await tx.user.update({where:{id},data:{approval_status:'approved',is_active:true,approved_at:new Date(),token_version:{increment:1}}});
        await audit(tx,req.user.id,'invited_user_approved',id,{org_id:invitations[0].org_id,role:invitations[0].role});
        return;
      }
      let orgId=input.org_id || pending.requested_org_id;
      if(!orgId && region && Object.hasOwn(REGIONS,region)){
        // Compatibilidade com solicitacoes pendentes anteriores a esta migracao.
        const companies=await tx.organization.findMany({where:{status:'active'},select:{id:true,name:true,region:true}});
        const matches=companies.filter(o=>o.region===region||(!o.region&&matchesLegacyRegion(o.name,region)));
        if(matches.length!==1)throw new HttpError(409,'Selecione uma empresa ativa para esta solicitacao antiga.');
        orgId=matches[0].id;
      }
      if(!orgId)throw new HttpError(400,'Selecione a empresa para aprovar este cadastro.');
      const company=await tx.organization.findFirst({where:{id:orgId,status:'active'},select:{id:true,region:true}});
      if(!company)throw new HttpError(409,'Empresa selecionada esta indisponivel.');
      if(pending.requested_org_id&&pending.requested_org_id!==orgId)throw new HttpError(409,'A solicitacao pertence a outra empresa.');
      const claimed=await tx.user.updateMany({where:{id,approval_status:{in:['pending','rejected']}},data:{approval_status:'approving'}});
      if(claimed.count!==1)throw new HttpError(409,'O pedido ja foi processado por outra operacao.');
      const existing=await tx.orgMember.findUnique({where:{org_id_user_id:{org_id:orgId,user_id:id}}});
      if(existing)await tx.orgMember.update({where:{id:existing.id},data:{role:input.role,status:'active'}});
      else await tx.orgMember.create({data:{id:randomUUID(),org_id:orgId,user_id:id,role:input.role,status:'active'}});
      await tx.user.update({where:{id},data:{approval_status:'approved',is_active:true,requested_org_id:orgId,approved_at:new Date(),token_version:{increment:1}}});
      await audit(tx,req.user.id,'user_approved',id,{org_id:orgId,role:input.role});
    });
    res.json({approved:true});
  }));
  router.post('/users/:id/reject',wrap(async(req,res)=>{
    const id=uuid.parse(req.params.id);
    const user=await targetUser(id,req.user.id);
    if(user.approval_status!=='pending')throw new HttpError(409,'Apenas solicitacoes pendentes podem ser rejeitadas.');
    await prisma.$transaction(async tx=>{
      const updated=await tx.user.updateMany({where:{id,approval_status:'pending'},data:{approval_status:'rejected',is_active:false,token_version:{increment:1}}});
      if(updated.count!==1)throw new HttpError(409,'Pedido ja processado.');
      await audit(tx,req.user.id,'user_rejected',id);
    });
    res.json({rejected:true});
  }));
  router.patch('/users/:id',wrap(async(req,res)=>{
    const id=uuid.parse(req.params.id);
    await targetUser(id,req.user.id);
    const data=z.object({email:emailSchema.optional(),full_name:z.string().trim().min(2).max(150).optional()}).strict().parse(req.body);
    if(!Object.keys(data).length)throw new HttpError(400,'Nenhuma alteracao enviada.');
    await prisma.$transaction(async tx=>{
      if(data.email)await tx.user.update({where:{id},data:{email:data.email,token_version:{increment:1}}});
      if(data.full_name)await tx.userProfile.upsert({where:{user_id:id},create:{id:randomUUID(),user_id:id,full_name:data.full_name},update:{full_name:data.full_name}});
      await audit(tx,req.user.id,'user_edited',id,{fields:Object.keys(data)});
    });
    res.json({updated:true});
  }));
  router.post('/users/:id/revoke-sessions',wrap(async(req,res)=>{
    const id=uuid.parse(req.params.id);
    await targetUser(id,req.user.id);
    await prisma.$transaction(async tx=>{
      await tx.user.update({where:{id},data:{token_version:{increment:1}}});
      await audit(tx,req.user.id,'sessions_revoked',id);
    });
    res.json({revoked:true});
  }));
  router.post('/users/:id/reset-password',wrap(async(req,res)=>{
    const id=uuid.parse(req.params.id);
    const user=await targetUser(id,req.user.id);
    if(user.approval_status!=='approved')throw new HttpError(409,'Aguarde a aprovacao antes de redefinir a senha.');
    const tempPassword=randomBytes(24).toString('base64url');
    const hash=await bcrypt.hash(tempPassword,12);
    await prisma.$transaction(async tx=>{
      await tx.user.update({where:{id},data:{password_hash:hash,must_change_password:true,token_version:{increment:1}}});
      await audit(tx,req.user.id,'password_reset',id);
    });
    res.json({reset:true,temporary_password:tempPassword});
  }));
  router.post('/users/:id/restore',wrap(async(req,res)=>{
    const id=uuid.parse(req.params.id);
    const user=await targetUser(id,req.user.id);
    if(user.approval_status!=='deleted')throw new HttpError(409,'Apenas contas arquivadas podem ser restauradas.');
    await prisma.$transaction(async tx=>{
      await tx.user.update({where:{id},data:{approval_status:'approved',is_active:true,token_version:{increment:1}}});
      await audit(tx,req.user.id,'user_restored',id);
    });
    res.json({restored:true});
  }));
  router.post('/users/:id/set-active',wrap(async(req,res)=>{
    const id=uuid.parse(req.params.id);
    const user=await targetUser(id,req.user.id);
    const {active}=z.object({active:z.boolean()}).strict().parse(req.body);
    if(user.approval_status!=='approved')throw new HttpError(409,'Apenas usuarios aprovados podem ser reativados.');
    await prisma.$transaction(async tx=>{
      await tx.user.update({where:{id},data:{is_active:active,token_version:{increment:1}}});
      await audit(tx,req.user.id,active?'user_activated':'user_deactivated',id);
    });
    res.json({active});
  }));
  router.delete('/users/:id/permanent',wrap(async(req,res)=>{
    const id=uuid.parse(req.params.id);
    const {confirm_email}=z.object({confirm_email:emailSchema}).strict().parse(req.body||{});
    const user=await targetUser(id,req.user.id);
    if(user.email!==confirm_email)throw new HttpError(400,'Confirme o e-mail exato para exclusao definitiva.');
    await prisma.$transaction(async tx=>{
      // Nunca eliminar empresas ou historicos associados ao usuario.
      await tx.conversation.updateMany({where:{assigned_to:id},data:{assigned_to:null}});
      await tx.auditLog.updateMany({where:{user_id:id},data:{user_id:null}});
      await tx.technicalDocument.updateMany({where:{creator_user_id:id},data:{creator_user_id:null}});
      await tx.message.updateMany({where:{sender_id:id},data:{sender_id:null}});
      await tx.teamMember.deleteMany({where:{user_id:id}});
      await tx.orgMember.deleteMany({where:{user_id:id}});
      await tx.user.delete({where:{id}});
      await audit(tx,req.user.id,'user_permanently_deleted',null,{deleted_email:user.email,deleted_user_id:id});
    });
    res.json({deleted:true,permanent:true});
  }));
  router.get('/users/:id/delete-preview',wrap(async(req,res)=>{
    const id=uuid.parse(req.params.id);await targetUser(id,req.user.id);
    const memberships=await prisma.orgMember.findMany({where:{user_id:id},select:{org_id:true,organizations:{select:{name:true}}}});
    res.json({organizations:[],memberships:memberships.map(m=>m.organizations.name),warning:'As empresas, equipes e historicos serao preservados. Somente o usuario perde acesso.'});
  }));
  router.delete('/users/:id',wrap(async(req,res)=>{
    const id=uuid.parse(req.params.id);
    const user=await targetUser(id,req.user.id);
    const {confirm_email}=z.object({confirm_email:emailSchema}).strict().parse(req.body||{});
    if(confirm_email!==user.email)throw new HttpError(400,'Confirme o e-mail exato para excluir.');
    await prisma.$transaction(async tx=>{
      await tx.orgMember.updateMany({where:{user_id:id},data:{status:'inactive'}});
      await tx.user.update({where:{id},data:{approval_status:'deleted',is_active:false,token_version:{increment:1}}});
      await audit(tx,req.user.id,'user_archived',id,{companies_preserved:true});
    });
    res.json({deleted:true,archived:true});
  }));
  // DEV: vincular usuario aprovado a outra empresa ou transferir seus acessos.
  // A operacao usa org_members, nao altera a empresa nem seu historico.
  router.post('/users/:id/memberships',wrap(async(req,res)=>{
    const userId=uuid.parse(req.params.id);
    const input=z.object({org_id:uuid,role:roleSchema,move:z.boolean().default(false)}).strict().parse(req.body||{});
    const user=await targetUser(userId,req.user.id);
    if(!user.is_active||user.approval_status!=='approved')throw new HttpError(409,'Aprove ou reative o usuario antes de vincular a uma empresa.');
    const org=await prisma.organization.findFirst({where:{id:input.org_id,status:'active'},select:{id:true}});
    if(!org)throw new HttpError(404,'Empresa ativa nao encontrada.');
    const role=await prisma.accessRole.findUnique({where:{org_id_slug:{org_id:input.org_id,slug:input.role}}});
    if(!role)throw new HttpError(400,'Cargo inexistente na empresa escolhida.');
    const current=await prisma.orgMember.findUnique({where:{org_id_user_id:{org_id:input.org_id,user_id:userId}}});
    await prisma.$transaction(async tx=>{
      if(input.move){
        const old=await tx.orgMember.findMany({where:{user_id:userId,org_id:{not:input.org_id},status:'active'},select:{org_id:true}});
        const oldOrgIds=old.map(m=>m.org_id);
        if(oldOrgIds.length){
          await tx.orgMember.updateMany({where:{user_id:userId,org_id:{in:oldOrgIds}},data:{status:'inactive'}});
          const oldTeams=await tx.team.findMany({where:{org_id:{in:oldOrgIds}},select:{id:true}});
          if(oldTeams.length)await tx.teamMember.deleteMany({where:{user_id:userId,team_id:{in:oldTeams.map(t=>t.id)}}});
        }
      }
      if(current)await tx.orgMember.update({where:{id:current.id},data:{role:input.role,status:'active'}});
      else await tx.orgMember.create({data:{id:randomUUID(),org_id:input.org_id,user_id:userId,role:input.role,status:'active'}});
      await tx.user.update({where:{id:userId},data:{token_version:{increment:1}}});
      await audit(tx,req.user.id,input.move?'membership_transferred':'membership_added',userId,{org_id:input.org_id,role:input.role,move:input.move});
    });
    res.status(201).json({updated:true});
  }));
  router.patch('/memberships/:id',wrap(async(req,res)=>{
    const id=uuid.parse(req.params.id);
    const {role,status}=z.object({role:roleSchema.optional(),status:statusSchema.optional()}).strict().parse(req.body);
    if(!role&&!status)throw new HttpError(400,'Informe cargo ou status.');
    const member=await prisma.orgMember.findUnique({where:{id}});
    if(!member)throw new HttpError(404,'Vinculo nao encontrado.');
    await targetUser(member.user_id,req.user.id);
    if(role){
      const row=await prisma.accessRole.findUnique({where:{org_id_slug:{org_id:member.org_id,slug:role}}});
      if(!row)throw new HttpError(400,'Cargo nao cadastrado nesta empresa.');
    }
    await prisma.$transaction(async tx=>{
      await tx.orgMember.update({where:{id},data:{...(role?{role}:{}),...(status?{status}:{})}});
      await tx.user.update({where:{id:member.user_id},data:{token_version:{increment:1}}});
      await audit(tx,req.user.id,'membership_changed',member.user_id,{org_id:member.org_id,role:role||null,status:status||null});
    });
    res.json({updated:true});
  }));
  router.post('/organizations/:id/restore',wrap(async(req,res)=>{
    const id=uuid.parse(req.params.id);
    const org=await prisma.organization.findUnique({where:{id},select:{status:true}});
    if(!org)throw new HttpError(404,'Empresa nao encontrada.');
    if(org.status!=='deleted')throw new HttpError(409,'Somente empresas arquivadas podem ser restauradas.');
    await prisma.$transaction(async tx=>{
      await tx.organization.update({where:{id},data:{status:'active'}});
      await audit(tx,req.user.id,'organization_restored',null,{org_id:id});
    });
    res.json({restored:true});
  }));
  router.patch('/organizations/:id',wrap(async(req,res)=>{
    const id=uuid.parse(req.params.id);
    const data=z.object({name:z.string().trim().min(2).max(150).optional(),status:z.enum(['active','suspended']).optional(),region:z.enum(REGION_CODES).nullable().optional()}).strict().parse(req.body);
    if(!Object.keys(data).length)throw new HttpError(400,'Nenhum campo informado.');
    await prisma.$transaction(async tx=>{
      await tx.organization.update({where:{id},data});
      await audit(tx,req.user.id,'organization_updated',null,{org_id:id,fields:Object.keys(data)});
    });
    res.json({updated:true});
  }));
  router.patch('/teams/:id',wrap(async(req,res)=>{
    const id=uuid.parse(req.params.id);
    const data=z.object({name:z.string().trim().min(2).max(150),description:z.string().trim().max(500).nullable().optional()}).strict().parse(req.body);
    const team=await prisma.team.findUnique({where:{id}});
    if(!team)throw new HttpError(404,'Equipe nao encontrada.');
    await prisma.$transaction(async tx=>{
      await tx.team.update({where:{id},data});
      await audit(tx,req.user.id,'team_updated',null,{org_id:team.org_id,team_id:id});
    });
    res.json({updated:true});
  }));
  router.delete('/teams/:id',wrap(async(req,res)=>{
    const id=uuid.parse(req.params.id);
    const {confirm_name}=z.object({confirm_name:z.string()}).strict().parse(req.body);
    const team=await prisma.team.findUnique({where:{id}});
    if(!team)throw new HttpError(404,'Equipe nao encontrada.');
    if(confirm_name!==team.name)throw new HttpError(400,'Digite o nome exato da equipe para confirmar.');
    const channels=await prisma.integration.findMany({where:{org_id:team.org_id,type:'whatsapp'},select:{config:true}});
    if(channels.some(c=>Array.isArray(c.config?.team_ids)&&c.config.team_ids.includes(id)))throw new HttpError(409,'Equipe usada nas restricoes de canais. Remova a referencia antes de excluir.');
    await prisma.$transaction(async tx=>{
      await tx.teamMember.deleteMany({where:{team_id:id}});
      await tx.team.delete({where:{id}});
      await audit(tx,req.user.id,'team_deleted',null,{org_id:team.org_id,team_id:id,team_name:team.name});
    });
    res.json({deleted:true});
  }));
  return router;
}
