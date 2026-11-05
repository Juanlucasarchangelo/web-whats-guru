import { prisma } from '../db.js';
import { HttpError } from '../http.js';
import { admin, allowedChannelIds, conversationVisibility } from './channel-scope-policy.js';
export { admin, ownedChannel } from './channel-scope-policy.js';

// Master/DEV may inspect all channels in the selected organization; others only their own.
export async function visibleChannelIds(req,tx=prisma) {
  const channels=await tx.integration.findMany({where:{org_id:req.orgId,type:'whatsapp'},select:{id:true,config:true}});
  return allowedChannelIds(req,channels);
}
export async function conversationScope(req,tx=prisma) {
  const ids=admin(req)?[]:await visibleChannelIds(req,tx);
  return conversationVisibility(req,ids);
}
export async function requireConversation(req,id,tx=prisma){
  const row=await tx.conversation.findFirst({where:{id,...await conversationScope(req,tx)}});
  if(!row)throw new HttpError(404,'Conversa nao encontrada ou sem permissao para este usuario.');
  return row;
}
export async function requireAssigneeForChannel(orgId,userId,integrationId,tx=prisma){
  if(!userId)return;
  const member=await tx.orgMember.findFirst({where:{org_id:orgId,user_id:userId,status:'active',users:{is_active:true,approval_status:'approved'}}});
  if(!member)throw new HttpError(400,'Atendente nao pertence a esta empresa.');
  if(!integrationId)return;
  const channel=await tx.integration.findFirst({where:{id:integrationId,org_id:orgId,type:'whatsapp'}});
  if(!channel)throw new HttpError(404,'Numero de WhatsApp nao encontrado.');
  // Master may delegate a conversation to another teammate; assignee sees only explicitly assigned chats.
}
