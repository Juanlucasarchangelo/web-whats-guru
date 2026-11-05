import { randomUUID } from 'node:crypto';
import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';

// Executar manualmente UMA VEZ em ambiente autorizado, apos prisma migrate deploy + generate.
// DEV_BOOTSTRAP_EMAIL escolhe conta existente; para uma conta NOVA, fornecer DEV_BOOTSTRAP_PASSWORD.
// Nunca armazenar DEV_BOOTSTRAP_PASSWORD no repositorio, frontend ou log.
const email=String(process.env.DEV_BOOTSTRAP_EMAIL||'').trim().toLowerCase();
if(!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){
  console.error('Configure DEV_BOOTSTRAP_EMAIL com o e-mail desejado para o unico DEV global.');
  process.exit(1);
}
const db=new PrismaClient();
try{
  const devs=await db.user.findMany({where:{global_role:'dev'},select:{id:true,email:true}});
  if(devs.length && !devs.some(d=>d.email===email))throw new Error('Ja existe outro DEV. Nao e permitido substituir automaticamente.');
  const existing=await db.user.findUnique({where:{email}});
  if(existing?.global_role==='dev'){
    console.info('A conta ja e DEV. Nenhuma alteracao necessaria.');
  }else if(existing){
    await db.$transaction(async tx=>{
      await tx.user.update({where:{id:existing.id},data:{global_role:'dev',approval_status:'approved',is_active:true,approved_at:new Date(),token_version:{increment:1}}});
      await tx.devActivity.create({data:{id:randomUUID(),actor_id:existing.id,target_user_id:existing.id,action:'bootstrap_dev',details:{method:'existing_account'}}});
    });
    console.info('Conta existente promovida a DEV. Faca login novamente para atualizar a sessao.');
  }else{
    const password=process.env.DEV_BOOTSTRAP_PASSWORD||'';
    if(password.length<16||password.length>128)throw new Error('Para criar DEV novo, defina DEV_BOOTSTRAP_PASSWORD com 16 a 128 caracteres fortes, somente nesta execucao.');
    const userId=randomUUID(),password_hash=await bcrypt.hash(password,12);
    const fullName=String(process.env.DEV_BOOTSTRAP_NAME||'Administrador DEV').trim().slice(0,150);
    await db.$transaction(async tx=>{
      await tx.user.create({data:{id:userId,email,password_hash,global_role:'dev',approval_status:'approved',is_active:true,approved_at:new Date()}});
      await tx.userProfile.create({data:{id:randomUUID(),user_id:userId,full_name:fullName}});
      await tx.devActivity.create({data:{id:randomUUID(),actor_id:userId,target_user_id:userId,action:'bootstrap_dev',details:{method:'new_account'}}});
    });
    console.info('Nova conta DEV criada. Use o e-mail e a senha escolhidos para entrar.');
  }
}catch(err){console.error('Falha no bootstrap DEV:',err?.message||err);process.exitCode=1;}
finally{await db.$disconnect();}
