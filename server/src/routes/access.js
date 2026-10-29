import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { prisma } from '../db.js';
import { HttpError, wrap } from '../http.js';
import { NORMAL_KEYS, PERMISSIONS, RESERVED, isMaster, can, SYSTEM_ROLES } from '../services/permissions.js';

const name = z.string().trim().min(2).max(80);
const slugSchema = z.string().trim().toLowerCase().regex(/^[a-z][a-z0-9_]{1,31}$/, 'Use 2 a 32 letras, numeros ou underscore.');
const allowed = z.array(z.enum(NORMAL_KEYS)).max(NORMAL_KEYS.length).transform(a=>[...new Set(a)]);
const createSchema=z.object({name,slug:slugSchema,description:z.string().trim().max(300).optional(),permissions:allowed}).strict();
const editSchema=z.object({name:name.optional(),description:z.string().trim().max(300).nullable().optional(),permissions:allowed.optional()}).strict();
const serialize=r=>({...r,permissions:Array.isArray(r.permissions)?r.permissions:[]});
function requireMaster(req){if(!isMaster(req)||!can(req,'roles.manage'))throw new HttpError(403,'Somente Master pode gerenciar cargos e permissoes.');}
export function accessRouter(){
 const router=Router();
 router.get('/me',wrap(async(req,res)=>res.json({role:req.role,role_name:req.roleName,permissions:req.permissions})));
 router.get('/catalog',wrap(async(req,res)=>{if(!can(req,'page.team'))throw new HttpError(403,'Sem permissao.');res.json({data:PERMISSIONS,restricted:[...RESERVED]});}));
 router.get('/roles',wrap(async(req,res)=>{
  if(!can(req,'page.team')&&!can(req,'team.members.manage'))throw new HttpError(403,'Sem permissao.');
  res.json({data:(await prisma.accessRole.findMany({where:{org_id:req.orgId},orderBy:[{is_system:'desc'},{created_at:'asc'}]})).map(serialize)});
 }));
 router.post('/roles',wrap(async(req,res)=>{
  requireMaster(req);const input=createSchema.parse(req.body);
  const reservedSlugs=SYSTEM_ROLES.map(r=>r.slug);
  if(reservedSlugs.includes(input.slug)||['owner','admin','agent'].includes(input.slug))throw new HttpError(409,'Identificador reservado para cargo do sistema.');
  const existing=await prisma.accessRole.findUnique({where:{org_id_slug:{org_id:req.orgId,slug:input.slug}}});
  if(existing)throw new HttpError(409,'Ja existe um cargo com esse identificador.');
  const role=await prisma.accessRole.create({data:{id:randomUUID(),org_id:req.orgId,...input,is_system:false}});
  res.status(201).json(serialize(role));
 }));
 router.patch('/roles/:id',wrap(async(req,res)=>{
  requireMaster(req);const input=editSchema.parse(req.body);
  if(!Object.keys(input).length)throw new HttpError(400,'Nada para atualizar.');
  const role=await prisma.accessRole.findFirst({where:{id:z.string().uuid().parse(req.params.id),org_id:req.orgId}});
  if(!role)throw new HttpError(404,'Cargo nao encontrado.');
  // O Master deve manter acesso total permanentemente, inclusive para criar novos Masters.
  if(role.slug==='master')throw new HttpError(403,'O cargo Master e suas permissoes sao protegidos.');
  if(role.is_system && role.slug==='administrador' && input.permissions) {
   // Um Administrador nunca pode receber os privilegios reservados ao Master.
   input.permissions=input.permissions.filter(p=>!RESERVED.has(p));
  }
  res.json(serialize(await prisma.accessRole.update({where:{id:role.id},data:input})));
 }));
 router.delete('/roles/:id',wrap(async(req,res)=>{
  requireMaster(req);
  const role=await prisma.accessRole.findFirst({where:{id:z.string().uuid().parse(req.params.id),org_id:req.orgId}});
  if(!role)throw new HttpError(404,'Cargo nao encontrado.');
  if(role.is_system)throw new HttpError(403,'Cargos padrao nao podem ser excluidos.');
  const inUse=await prisma.orgMember.count({where:{org_id:req.orgId,role:role.slug}});
  if(inUse)throw new HttpError(409,`O cargo possui ${inUse} membro(s). Reatribua-os antes de excluir.`);
  await prisma.accessRole.delete({where:{id:role.id}});
  res.json({deleted:true});
 }));
 return router;
}
