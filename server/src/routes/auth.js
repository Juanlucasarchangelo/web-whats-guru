import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from '../db.js';
import { HttpError, wrap } from '../http.js';
import { authenticate } from '../middleware/auth.js';
import { normalizeRole } from '../services/permissions.js';
import { notifyDevRequest } from '../services/dev-notifications.js';


const signupSchema=z.object({
  fullName:z.string().trim().min(2).max(150),
  email:z.string().trim().email().max(254).transform(v=>v.toLowerCase()),
  password:z.string().min(10).max(128),
  org_id:z.string().uuid(),
}).strict();
const loginSchema=z.object({
  email:z.string().trim().email().max(254).transform(v=>v.toLowerCase()),
  password:z.string().min(1),
}).strict();
function tokenFor(user,config) {
  return jwt.sign({tv:user.token_version},config.jwtSecret,{
    subject:user.id,issuer:'converso-api',audience:'converso-web',
    algorithm:'HS256',expiresIn:config.jwtExpiresIn,
  });
}
export function authRouter(config,authLimiter) {
  const router=Router();
  router.get('/public-organizations',wrap(async(_req,res)=>{
    const organizations=await prisma.organization.findMany({where:{status:'active'},select:{id:true,name:true},orderBy:{name:'asc'}});
    res.json({data:organizations});
  }));
  router.post('/register',authLimiter,wrap(async(req,res)=>{
    if (!config.allowRegistration) throw new HttpError(403,'Cadastro publico desabilitado.');
    const {fullName,email,password,org_id}=signupSchema.parse(req.body);
    const org=await prisma.organization.findFirst({where:{id:org_id,status:'active'},select:{id:true}});
    if(!org)throw new HttpError(400,'Empresa selecionada indisponivel.');
    if(await prisma.user.findUnique({where:{email},select:{id:true}}))throw new HttpError(409,'Este e-mail ja esta cadastrado.');
    const password_hash=await bcrypt.hash(password,12);
    const userId=randomUUID();

    await prisma.$transaction(async tx=>{
      await tx.user.create({data:{id:userId,email,password_hash,is_active:false,approval_status:'pending',requested_org_id:org_id}});
      await tx.userProfile.create({data:{id:randomUUID(),user_id:userId,full_name:fullName}});
      await tx.devActivity.create({data:{id:randomUUID(),action:'registration_requested',target_user_id:userId,details:{source:'public_signup'}}});
    });
    // Registro e notificacao sao independentes: falha de e-mail nao libera nem remove o pedido.
    await notifyDevRequest({email,fullName,createdAt:new Date().toISOString()});
    res.status(202).json({pending:true,message:'Cadastro recebido. Aguarde aprovacao do administrador DEV antes de entrar.'});
  }));
  router.post('/login',authLimiter,wrap(async(req,res)=>{
    const {email,password}=loginSchema.parse(req.body);
    const user=await prisma.user.findUnique({where:{email}});
    if(!user || !(await bcrypt.compare(password,user.password_hash)))throw new HttpError(401,'E-mail ou senha incorretos.');
    if(user.approval_status==='pending')throw new HttpError(403,'Cadastro pendente de aprovacao do DEV.');
    if(user.approval_status==='rejected')throw new HttpError(403,'Cadastro nao aprovado. Contate o administrador.');
    if(!user.is_active)throw new HttpError(403,'Conta desativada. Contate o administrador.');
    await prisma.user.update({where:{id:user.id},data:{last_login_at:new Date()}});
    await prisma.devActivity.create({data:{id:randomUUID(),action:'login_success',actor_id:user.id,target_user_id:user.id,details:{}}});
    res.json({token:tokenFor(user,config),user:{id:user.id,email:user.email}});
  }));
  router.get('/me',authenticate(config),wrap(async(req,res)=>{
    const profile=await prisma.userProfile.findUnique({where:{user_id:req.user.id}});
    const isDev=req.user.global_role==='dev';
    const memberships=isDev?[]:await prisma.orgMember.findMany({where:{user_id:req.user.id,status:'active'},select:{org_id:true,role:true,status:true}});
    const organizations=await prisma.organization.findMany({
      where:isDev?{status:'active'}:{id:{in:memberships.map(m=>m.org_id)},status:'active'},
      select:{id:true,name:true,slug:true,status:true,plan:true},orderBy:{created_at:'asc'},
    });
    res.json({user:{id:req.user.id,email:req.user.email,is_active:req.user.is_active,
      global_role:req.user.global_role,must_change_password:req.user.must_change_password},
      profile,organizations:organizations.map(o=>({...o,role:isDev?'dev':normalizeRole(memberships.find(m=>m.org_id===o.id)?.role)}))});
  }));
  router.post('/change-password',authenticate(config),wrap(async(req,res)=>{
    const input=z.object({current_password:z.string().min(1),new_password:z.string().min(10).max(128)}).strict().parse(req.body);
    const user=await prisma.user.findUnique({where:{id:req.user.id},select:{password_hash:true}});
    if(!user || !(await bcrypt.compare(input.current_password,user.password_hash)))throw new HttpError(403,'Senha atual incorreta.');
    const password_hash=await bcrypt.hash(input.new_password,12);
    await prisma.user.update({where:{id:req.user.id},data:{password_hash,must_change_password:false,token_version:{increment:1}}});
    res.json({changed:true,login_required:true});
  }));
  router.post('/logout',authenticate(config),wrap(async(req,res)=>{
    // Revoga imediatamente todos os JWTs emitidos anteriormente para este usuario.
    await prisma.user.update({where:{id:req.user.id},data:{token_version:{increment:1}}});
    res.status(204).end();
  }));
  return router;
}
