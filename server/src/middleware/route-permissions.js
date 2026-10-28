import { can, hasAny } from '../services/permissions.js';

/** Defensiva: cada familia de endpoints exige permissao do servidor, nao apenas menu. */
export const guardOperations=(req,res,next)=>{
 const path=req.path;
 if(path.startsWith('/campaigns')||path.startsWith('/consent')){
  if(!can(req,'page.campaigns'))return res.status(403).json({error:'Sem acesso a campanhas.'});
 }else if(path.startsWith('/schedules')){
  if(!can(req,'page.schedules'))return res.status(403).json({error:'Sem acesso a agendamentos.'});
 }else if(path.startsWith('/channels') && !hasAny(req,'page.inbox','page.campaigns','page.schedules','page.reports'))return res.status(403).json({error:'Sem acesso a canais.'});
 next();
};
const TABLE_ACCESS={
 contacts:['page.contacts','page.crm','page.inbox','page.dashboard'],
 tags:['page.contacts','page.crm','page.inbox','page.dashboard'],
 contact_tags:['page.contacts','page.crm','page.inbox'],
 conversations:['page.inbox','page.dashboard'],
 conversation_tags:['page.inbox'],
 messages:['page.inbox','page.dashboard'],
 internal_notes:['page.inbox'],
 quick_replies:['page.inbox'],
 chatbots:['page.chatbots','page.dashboard'],
 automations:['page.automations','page.dashboard'],
 campaigns:['page.campaigns','page.dashboard'],
 campaign_recipients:['page.campaigns'],
 schedules:['page.schedules'],
 teams:['page.team'],
 org_members:['page.team','page.inbox'],
 user_profiles:['page.team','page.inbox','page.profile'],
 integrations:['page.settings','page.inbox','page.campaigns','page.schedules','page.reports'],
};
export function guardLocal(req,res,next){
 const table=req.body?.table;
 const keys=TABLE_ACCESS[table];
 if(!keys||!keys.some(k=>can(req,k)))return res.status(403).json({error:'Cargo sem acesso a esses dados.'});
 // Permissao de painel nao permite gravar dados nas tabelas de outros modulos.
 if(req.path==='/mutate'){
  const WRITE_ACCESS={
   contacts:['page.contacts','page.crm','page.inbox'],tags:['page.crm','page.contacts','page.inbox'],
   contact_tags:['page.crm','page.contacts'],conversations:['page.inbox'],
   conversation_tags:['page.inbox'],messages:['page.inbox'],internal_notes:['page.inbox'],
   quick_replies:['page.inbox'],chatbots:['page.chatbots'],automations:['page.automations'],
   user_profiles:['page.profile'],
  };
  if(!(WRITE_ACCESS[table]||[]).some(k=>can(req,k)))return res.status(403).json({error:'Sem permissao de alterar esses dados.'});
  if(table==='user_profiles'){
   const target=req.body?.filters?.find(f=>f.field==='user_id'&&f.op==='eq')?.value;
   if(target!==req.user.id)return res.status(403).json({error:'Somente seu proprio perfil pode ser alterado.'});
  }
 }
 next();
}
