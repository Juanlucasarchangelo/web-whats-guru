import { Router } from 'express';
import { randomUUID, randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../db.js';
import { HttpError, wrap } from '../http.js';
const id=z.string().uuid();
const isAdmin=req=>['owner','admin'].includes(req.role);
const checkAdmin=req=>{if(!isAdmin(req))throw new HttpError(403,'Somente administradores podem gerenciar a equipe.');};
const checkOwner=req=>{if(req.role!=='owner')throw new HttpError(403,'Somente o proprietario pode gerenciar permissoes de usuarios.');};
export function teamRouter() {
 const router=Router();
 router.get('/overview',wrap(async(req,res)=>{
  const [members,teams,teamMembers,profiles]=await Promise.all([
   prisma.orgMember.findMany({where:{org_id:req.orgId},orderBy:{created_at:'asc'}}),
   prisma.team.findMany({where:{org_id:req.orgId},orderBy:{created_at:'asc'}}),
   prisma.teamMember.findMany({where:{team_id:{in:(await prisma.team.findMany({where:{org_id:req.orgId},select:{id:true}})).map(t=>t.id)}}}),
   prisma.userProfile.findMany({where:{user_id:{in:(await prisma.orgMember.findMany({where:{org_id:req.orgId},select:{user_id:true}})).map(m=>m.user_id)}}}),
  ]);
  const userIds=members.map(m=>m.user_id);
  const users=userIds.length?await prisma.user.findMany({where:{id:{in:userIds}},select:{id:true,email:true,is_active:true}}):[];
  const up=new Map(users.map(u=>[u.id,u]));const pp=new Map(profiles.map(u=>[u.user_id,u]));
  res.json({members:members.map(m=>({...m,email:up.get(m.user_id)?.email??'',full_name:pp.get(m.user_id)?.full_name??'Usuario',is_active:up.get(m.user_id)?.is_active??false})),teams,team_members:teamMembers});
 }));
 router.post('/users',wrap(async(req,res)=>{
  checkOwner(req);
  const data=z.object({full_name:z.string().trim().min(2).max(150),email:z.string().trim().email().max(254).transform(x=>x.toLowerCase()),role:z.enum(['admin','agent']).default('agent')}).strict().parse(req.body);
  if(await prisma.user.findUnique({where:{email:data.email},select:{id:true}}))throw new HttpError(409,'E-mail ja cadastrado. Use Adicionar usuario existente.');
  const initialPassword=randomBytes(24).toString('base64url');
  const hash=await bcrypt.hash(initialPassword,12);const userId=randomUUID();
  await prisma.$transaction(async tx=>{
   await tx.user.create({data:{id:userId,email:data.email,password_hash:hash,is_active:true}});
   await tx.userProfile.create({data:{id:randomUUID(),user_id:userId,full_name:data.full_name}});
   await tx.orgMember.create({data:{id:randomUUID(),org_id:req.orgId,user_id:userId,role:data.role,status:'active'}});
  });
  res.status(201).json({email:data.email,initial_password:initialPassword});
 }));
 router.post('/members',wrap(async(req,res)=>{
  checkOwner(req);
  const {email,role}=z.object({email:z.string().email().max(254),role:z.enum(['agent','admin']).default('agent')}).strict().parse(req.body);
  const user=await prisma.user.findUnique({where:{email:email.trim().toLowerCase()},select:{id:true,is_active:true}});
  if(!user?.is_active)throw new HttpError(404,'Usuario nao cadastrado ou inativo. Crie uma conta na tela de cadastro antes de adicionar.');
  const existing=await prisma.orgMember.findFirst({where:{org_id:req.orgId,user_id:user.id}});
  if(existing){
   if(existing.status==='active')throw new HttpError(409,'Usuario ja pertence a esta empresa.');
   const updated=await prisma.orgMember.update({where:{id:existing.id},data:{status:'active',role}});
   return res.json(updated);
  }
  res.status(201).json(await prisma.orgMember.create({data:{id:randomUUID(),org_id:req.orgId,user_id:user.id,role,status:'active'}}));
 }));
 router.patch('/members/:id',wrap(async(req,res)=>{
  checkOwner(req);const memberId=id.parse(req.params.id);
  const {role,status}=z.object({role:z.enum(['agent','admin']).optional(),status:z.enum(['active','inactive']).optional()}).strict().parse(req.body);
  if(!role&&!status)throw new HttpError(400,'Nenhuma alteracao enviada.');
  const member=await prisma.orgMember.findFirst({where:{id:memberId,org_id:req.orgId}});
  if(!member)throw new HttpError(404,'Membro nao encontrado.');
  if(member.role==='owner'||member.user_id===req.user.id)throw new HttpError(403,'Nao pode modificar proprietario ou seu proprio acesso.');
  res.json(await prisma.orgMember.update({where:{id:memberId},data:{...(role?{role}:{}),...(status?{status}:{})}}));
 }));
 router.delete('/members/:id',wrap(async(req,res)=>{
  checkOwner(req);const memberId=id.parse(req.params.id);
  const member=await prisma.orgMember.findFirst({where:{id:memberId,org_id:req.orgId}});
  if(!member)throw new HttpError(404,'Membro nao encontrado.');
  if(member.role==='owner'||member.user_id===req.user.id)throw new HttpError(403,'Proprietario e usuario atual nao podem ser removidos.');
  // Soft-disable membership; historical assignment stays intact, access is revoked immediately.
  await prisma.$transaction(async tx=>{
   await tx.teamMember.deleteMany({where:{user_id:member.user_id,team_id:{in:(await tx.team.findMany({where:{org_id:req.orgId},select:{id:true}})).map(t=>t.id)}}});
   await tx.orgMember.update({where:{id:member.id},data:{status:'inactive'}});
  });
  res.json({disabled:true});
 }));
 router.post('/teams',wrap(async(req,res)=>{
  checkAdmin(req);const value=z.object({name:z.string().trim().min(2).max(150),description:z.string().trim().max(500).nullable().optional()}).strict().parse(req.body);
  res.status(201).json(await prisma.team.create({data:{id:randomUUID(),org_id:req.orgId,name:value.name,description:value.description||null}}));
 }));
 router.patch('/teams/:id',wrap(async(req,res)=>{
  checkAdmin(req);const teamId=id.parse(req.params.id);const value=z.object({name:z.string().trim().min(2).max(150),description:z.string().trim().max(500).nullable().optional()}).strict().parse(req.body);
  const team=await prisma.team.findFirst({where:{id:teamId,org_id:req.orgId}});if(!team)throw new HttpError(404,'Time nao encontrado.');
  res.json(await prisma.team.update({where:{id:teamId},data:{name:value.name,description:value.description??null}}));
 }));
 router.delete('/teams/:id',wrap(async(req,res)=>{
  checkAdmin(req);const teamId=id.parse(req.params.id);
  const team=await prisma.team.findFirst({where:{id:teamId,org_id:req.orgId}});if(!team)throw new HttpError(404,'Time nao encontrado.');
  // No team should be silently removed from channel restrictions.
  const channels=await prisma.integration.findMany({where:{org_id:req.orgId,type:'whatsapp'},select:{config:true}});
  if(channels.some(c=>Array.isArray(c.config?.team_ids)&&c.config.team_ids.includes(teamId)))throw new HttpError(409,'Remova o time das permissoes dos numeros de WhatsApp antes de excluir.');
  await prisma.$transaction(async tx=>{await tx.teamMember.deleteMany({where:{team_id:teamId}});await tx.team.delete({where:{id:teamId}});});
  res.json({deleted:true});
 }));
 router.put('/teams/:id/members',wrap(async(req,res)=>{
  checkAdmin(req);const teamId=id.parse(req.params.id);
  const {user_ids}=z.object({user_ids:z.array(z.string().uuid()).max(200)}).strict().parse(req.body);
  const team=await prisma.team.findFirst({where:{id:teamId,org_id:req.orgId}});if(!team)throw new HttpError(404,'Time nao encontrado.');
  const valid=await prisma.orgMember.findMany({where:{org_id:req.orgId,user_id:{in:user_ids},status:'active'},select:{user_id:true}});
  if(new Set(valid.map(m=>m.user_id)).size!==new Set(user_ids).size)throw new HttpError(400,'Algum usuario nao e membro ativo desta empresa.');
  await prisma.$transaction(async tx=>{
   await tx.teamMember.deleteMany({where:{team_id:teamId}});
   if(user_ids.length)await tx.teamMember.createMany({data:[...new Set(user_ids)].map(user_id=>({id:randomUUID(),team_id:teamId,user_id}))});
  });
  res.json({updated:true});
 }));
 return router;
}
