/** Catálogo único: use a chave em menus, APIs e no editor de cargos. */
export const PERMISSIONS = [
  ['page.dashboard','Painel','Páginas'],
  ['page.inbox','Caixa de entrada','Páginas'],
  ['page.contacts','Contatos','Páginas'],
  ['page.crm','CRM Kanban','Páginas'],
  ['page.chatbots','Chatbots','Páginas'],
  ['page.automations','Automações','Páginas'],
  ['page.campaigns','Campanhas','Páginas'],
  ['page.schedules','Agendamentos','Páginas'],
  ['page.reports','Relatórios','Páginas'],
  ['page.monitoring','Monitoramento · ODD e relatórios técnicos','Páginas'],
  ['page.technicalOdd','Área técnica · ODD','Páginas'],
  ['page.technicalReport','Área técnica · Relatório técnico','Páginas'],
  ['page.team','Equipe & Permissões','Páginas'],
  ['page.settings','Integrações','Páginas'],
  ['page.profile','Meu perfil','Páginas'],
  ['team.members.manage','Criar, alterar e desativar usuários','Gestão'],
  ['team.teams.manage','Administrar times e setores','Gestão'],
  ['settings.manage','Configurar canais e integrações','Gestão'],
  ['campaigns.manage','Gerenciar campanhas e consentimentos','Gestão'],
  ['contacts.delete','Excluir contatos','Gestão'],
  ['roles.manage','Criar cargos e configurar permissões','Reservado ao Master'],
  ['members.assign_master','Criar ou atribuir Master','Reservado ao Master'],
].map(([key,label,group])=>({key,label,group}));
export const ALL_KEYS = PERMISSIONS.map(p=>p.key);
export const RESERVED = new Set(['roles.manage','members.assign_master']);
export const NORMAL_KEYS = ALL_KEYS.filter(key=>!RESERVED.has(key));
const pageKeys = ALL_KEYS.filter(k=>k.startsWith('page.'));
export const SYSTEM_ROLES = [
 {slug:'master',name:'Master',description:'Acesso total e administração de cargos.',permissions:ALL_KEYS},
 {slug:'administrador',name:'Administrador',description:'Acesso geral e gestão da equipe, sem administrar cargos ou Masters.',permissions:NORMAL_KEYS.filter(p=>p!=='page.monitoring')},
 {slug:'comercial',name:'Comercial',description:'Atendimento comercial, equivalente ao antigo Atendente.',permissions:pageKeys.filter(p=>!['page.team','page.settings','page.monitoring'].includes(p))},
 {slug:'supervisor',name:'Supervisor',description:'Somente área técnica e relatórios.',permissions:['page.reports','page.technicalOdd','page.technicalReport']},
 {slug:'tecnico',name:'Técnico',description:'Somente relatórios técnicos.',permissions:['page.technicalReport']},
];
export const LEGACY_ROLE = {owner:'master',admin:'administrador',agent:'comercial'};
export const normalizeRole = r=>LEGACY_ROLE[r]||r;
export const isMaster = req=>req.role==='master';
export const can = (req, permission)=>Array.isArray(req.permissions)&&req.permissions.includes(permission);
export const hasAny = (req,...permissions)=>permissions.some(p=>can(req,p));
export function requirePermission(permission) {
 return (req,res,next)=>can(req,permission)?next():res.status(403).json({error:'Você não tem permissão para esta funcionalidade.'});
}
export function requireAny(...permissions) {
 return (req,res,next)=>hasAny(req,...permissions)?next():res.status(403).json({error:'Você não tem permissão para esta funcionalidade.'});
}
export function roleRows(orgId){return SYSTEM_ROLES.map(r=>({org_id:orgId,slug:r.slug,name:r.name,description:r.description,permissions:r.permissions,is_system:true}));}
