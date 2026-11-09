import { isMaster, normalizeRole } from './permissions.js';

// "Gestor de contatos" nao significa "pode ler mensagens de todos os WhatsApps".
// DEV e Master sao os unicos com escopo global de conversas na empresa selecionada.
export const admin = req => isMaster(req) || normalizeRole(req.role) === 'administrador';
export const ownedChannel = (row, userId) => row.config?.owner_user_id === userId;
// Gestores continuam podendo listar todas as instancias em Contatos e Integracoes.
export const allowedChannelIds = (req, channels) => channels
  .filter(row => admin(req) || ownedChannel(row, req.user.id)).map(row => row.id);
// Caixa de Entrada e sincronizacao manual: Administrador ve somente o proprio numero.
export const inboxAccessibleChannelIds = (req, channels) => channels
  .filter(row => isMaster(req) || ownedChannel(row, req.user.id)).map(row => row.id);

// Nunca mostre conversas de instancias apagadas no painel: os IDs sao
// extraidos exclusivamente das integracoes que AINDA existem no banco.
// As conversas historicas permanecem no MySQL, mas nao na Caixa de Entrada.
export const conversationVisibility = (req, channelIds) => {
  const whatsapp = { channel: 'whatsapp', integration_id: { in: channelIds } };
  if (isMaster(req)) return { org_id: req.orgId, OR: [
    whatsapp, { channel: { not: 'whatsapp' } },
  ] };
  if (normalizeRole(req.role) === 'administrador') return { org_id: req.orgId, OR: [
    whatsapp, { channel: { not: 'whatsapp' }, assigned_to: req.user.id },
  ] };
  return { org_id: req.orgId, ...whatsapp };
};
