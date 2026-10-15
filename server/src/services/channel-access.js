/** Channel access is granted to owners/admins or agents who belong to a linked team.
 * Unrestricted channels (team_ids empty) remain accessible to all active members.
 */
import { prisma } from '../db.js';
import { HttpError } from '../http.js';
import { mayAccessChannel } from './channel-policy.js';
export const admin = req => ['owner','admin'].includes(req.role);
export async function visibleChannelIds(req, tx=prisma) {
  const integrations = await tx.integration.findMany({where:{org_id:req.orgId,type:'whatsapp'},select:{id:true,config:true}});
  if(admin(req)) return integrations.map(i=>i.id);
  const memberships = await tx.teamMember.findMany({where:{user_id:req.user.id,team_id:{in: (await tx.team.findMany({where:{org_id:req.orgId},select:{id:true}})).map(t=>t.id)}},select:{team_id:true}});
  const myTeams = new Set(memberships.map(m=>m.team_id));
  return integrations.filter(i=>mayAccessChannel(req.role,i.config?.team_ids,myTeams)).map(i=>i.id);
}
export async function conversationScope(req, tx=prisma) {
  if (admin(req)) return {org_id:req.orgId};
  const ids=await visibleChannelIds(req,tx);
  return {org_id:req.orgId,OR:[{channel:{not:'whatsapp'}},{channel:'whatsapp',integration_id:{in:ids}}]};
}
export async function requireConversation(req, id, tx=prisma) {
  const conversation=await tx.conversation.findFirst({where:{id,...await conversationScope(req,tx)}});
  if(!conversation) throw new HttpError(404,'Conversa nao encontrada ou sem permissao neste numero.');
  return conversation;
}
/** Assignment never grants an agent access to a restricted number. */
export async function requireAssigneeForChannel(orgId, userId, integrationId, tx=prisma) {
  if(!userId || !integrationId)return;
  const member=await tx.orgMember.findFirst({where:{org_id:orgId,user_id:userId,status:'active'}});
  if(!member)throw new HttpError(400,'Atendente nao pertence a esta empresa.');
  if(['owner','admin'].includes(member.role))return;
  const channel=await tx.integration.findFirst({where:{id:integrationId,org_id:orgId,type:'whatsapp'}});
  if(!channel)throw new HttpError(404,'Numero WhatsApp nao encontrado.');
  const teams=Array.isArray(channel.config?.team_ids)?channel.config.team_ids:[];
  if(!teams.length)return;
  const linked=await tx.teamMember.findFirst({where:{user_id:userId,team_id:{in:teams}}});
  if(!linked)throw new HttpError(403,'Atendente nao faz parte de um time autorizado para este numero WhatsApp.');
}
