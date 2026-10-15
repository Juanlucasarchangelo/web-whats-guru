/** Idempotent MySQL patch: ONLY add two routing columns and an opt-in flag. */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
const prisma=new PrismaClient();
try {
 const [{name}]=await prisma.$queryRawUnsafe('SELECT DATABASE() AS name');
 console.log('Banco selecionado:',name);
 if(!name||process.env.OPERATIONS_MIGRATION_CONFIRM_DB!==name)throw new Error('Defina OPERATIONS_MIGRATION_CONFIRM_DB com o nome exato do banco ANTES de prosseguir.');
 const columns=await prisma.$queryRawUnsafe('SELECT TABLE_NAME,COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (\'campaigns\',\'schedules\')');
 const exists=(table,col)=>columns.some(x=>x.TABLE_NAME===table&&x.COLUMN_NAME===col);
 for(const [table,col,def] of [['campaigns','integration_id','CHAR(36) NULL'],['schedules','integration_id','CHAR(36) NULL'],['schedules','delivery_enabled','TINYINT(1) NOT NULL DEFAULT 0']]) {
  if(!exists(table,col)){await prisma.$executeRawUnsafe(`ALTER TABLE \`${table}\` ADD COLUMN \`${col}\` ${def}`);console.log('OK:',table+'.'+col);}else console.log('Ja existe:',table+'.'+col);
 }
 console.log('Concluido. Execute: npx prisma generate');
}catch(e){console.error('ERRO:',e.message);process.exitCode=1;}finally{await prisma.$disconnect();}
