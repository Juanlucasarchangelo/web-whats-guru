import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { prisma } from '../db.js';
import { HttpError, wrap } from '../http.js';

export function profileRouter(){
 const router=Router();
 router.get('/',wrap(async(req,res)=>{
  const [profile,user]=await Promise.all([
   prisma.userProfile.findUnique({where:{user_id:req.user.id}}),
   prisma.user.findUnique({where:{id:req.user.id},select:{email:true,last_login_at:true,created_at:true}}),
  ]);
  res.json({profile,user,role:req.role});
 }));
 router.patch('/',wrap(async(req,res)=>{
  const v=z.object({full_name:z.string().trim().min(2).max(150),phone:z.string().trim().max(30).nullable().optional(),avatar_url:z.string().trim().url().max(500).nullable().optional()}).strict().parse(req.body);
  if(v.avatar_url && !/^https:\/\//i.test(v.avatar_url))throw new HttpError(400,'A imagem precisa de link HTTPS.');
  const profile=await prisma.userProfile.upsert({where:{user_id:req.user.id},update:v,create:{id:randomUUID(),user_id:req.user.id,...v}});
  res.json({profile});
 }));
 return router;
}
