import { prisma } from '../db.js';
import { inboxChannelIds } from './channel-access.js';
import { HttpError } from '../http.js';
import { groupTriggerError, groupRuleType } from './group-automation-policy.js';

export async function validateGroupAutomation(req, trigger, actions, tx=prisma) {
  if (!groupRuleType(trigger)) return;
  const failure=groupTriggerError(trigger,actions);
  if (failure) throw new HttpError(400,failure);
  const authorized=await inboxChannelIds(req,tx);
  const group=await tx.whatsAppGroup.findFirst({where:{id:trigger.group_id,org_id:req.orgId,integration_id:{in:authorized}},select:{id:true,integration_id:true}});
  if (!group) throw new HttpError(403,'Grupo de origem indisponível para este usuário.');
  if (trigger.type!=='group_daily_summary') return;
  const recipient=trigger.recipient;
  if (recipient.kind==='group') {
    const dest=await tx.whatsAppGroup.findFirst({where:{id:recipient.group_id,org_id:req.orgId,integration_id:{in:authorized}},select:{id:true}});
    if (!dest) throw new HttpError(403,'Grupo destinatário indisponível para este usuário.');
  } else {
    if (!authorized.includes(recipient.integration_id)) throw new HttpError(403,'WhatsApp de envio não autorizado.');
    const contact=await tx.contact.findFirst({where:{id:recipient.contact_id,org_id:req.orgId,is_group:false,
      OR:[{contact_integrations:{some:{org_id:req.orgId,integration_id:recipient.integration_id}}},
        {conversations:{some:{org_id:req.orgId,integration_id:recipient.integration_id,is_group:false}}}]},select:{id:true}});
    if (!contact) throw new HttpError(403,'Contato não está vinculado à instância selecionada.');
  }
}
