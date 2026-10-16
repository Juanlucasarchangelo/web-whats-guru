import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { prisma } from '../db.js';
import { HttpError, wrap } from '../http.js';
import { sendTextToWhatsApp } from '../services/whatsapp.js';
import { loadEvolution, sendEvolutionText, syncEvolutionConversation } from '../services/evolution.js';
import { visibleChannelIds, conversationScope, requireConversation } from '../services/channel-access.js';
import { getOrCreateConversation, withConversationIdentityLock } from '../services/conversation-thread.js';

const idParam = z.string().uuid();
const newConversation = z.object({
  contact_id: z.string().uuid(),
  channel: z.enum(['whatsapp', 'instagram', 'email', 'webchat']).default('whatsapp'),
  subject: z.string().trim().max(300).nullable().optional(),
  integration_id: z.string().uuid().optional(),
}).strict();
const newMessage = z.object({ body: z.string().trim().min(1).max(10000), is_internal: z.boolean().optional() }).strict();
const editConversation = z.object({ status: z.enum(['open', 'pending', 'resolved', 'closed']) }).strict();

export function conversationsRouter() {
  const router = Router();
  router.get('/', wrap(async (req, res) => {
    const limit = Math.min(Math.max(Number.parseInt(String(req.query.limit || 30), 10) || 30, 1), 100);
    const where = await conversationScope(req);
    const data = await prisma.conversation.findMany({ where, take: limit, orderBy: { last_message_at: 'desc' } });
    const contacts = data.length ? await prisma.contact.findMany({
      where: { org_id: req.orgId, id: { in: data.map((c) => c.contact_id) } },
      select: { id: true, name: true, phone: true },
    }) : [];
    const lookup = new Map(contacts.map((contact) => [contact.id, contact]));
    res.json({ data: data.map((c) => ({ ...c, contact: lookup.get(c.contact_id) || null })) });
  }));
  router.post('/', wrap(async (req, res) => {
    const input = newConversation.parse(req.body);
    const contact = await prisma.contact.findFirst({ where: { id: input.contact_id, org_id: req.orgId }, select: { id: true, phone: true } });
    if (!contact) throw new HttpError(404, 'Contato nao encontrado nesta organizacao.');
    let integrationId = null;
    if(input.channel==='whatsapp') {
      const channels=await visibleChannelIds(req);
      integrationId=input.integration_id ?? (channels.length===1 ? channels[0] : null);
      if(!integrationId || !channels.includes(integrationId))throw new HttpError(400,'Selecione um numero de WhatsApp autorizado para iniciar a conversa.');
    }
    if (input.channel !== 'whatsapp') {
      // Leave other channels untouched; this fix concerns WhatsApp histories.
      const conversation = await prisma.conversation.create({ data: {
        id: randomUUID(), org_id: req.orgId, contact_id: contact.id,
        channel: input.channel, subject: input.subject ?? null, status: 'open',
      } });
      return res.status(201).json(conversation);
    }
    // Opening a WhatsApp thread manually must not create another history for
    // the same contact and WhatsApp number, even if it was closed.
    const { conversation, created } = await withConversationIdentityLock({
      orgId: req.orgId, integrationId, contactId: contact.id, phone: contact.phone,
      channel: input.channel,
    }, async () => {
      const result = await getOrCreateConversation(prisma, {
        orgId: req.orgId, contactId: contact.id, integrationId,
        channel: input.channel, subject: input.subject ?? null,
      });
      if (!result.created && ['closed', 'resolved'].includes(result.conversation.status)) {
        result.conversation = await prisma.conversation.update({
          where: { id: result.conversation.id }, data: { status: 'open' },
        });
      }
      return result;
    });
    res.status(created ? 201 : 200).json(conversation);
  }));
  router.patch('/:id', wrap(async (req, res) => {
    const id = idParam.parse(req.params.id);
    const input = editConversation.parse(req.body);
    await requireConversation(req,id);
    const result = await prisma.conversation.updateMany({ where: { id, org_id: req.orgId }, data: input });
    if (!result.count) throw new HttpError(404, 'Conversa nao encontrada.');
    res.json(await prisma.conversation.findFirst({ where: { id, org_id: req.orgId } }));
  }));
  router.get('/:id/messages', wrap(async (req, res) => {
    const id = idParam.parse(req.params.id);
    const conversation = await requireConversation(req,id);
    if (!conversation) throw new HttpError(404, 'Conversa nao encontrada.');
    const data = await prisma.message.findMany({ where: { conversation_id: id, org_id: req.orgId }, take: 100, orderBy: { created_at: 'desc' } });
    res.json({ data: data.reverse() });
  }));
  router.post('/:id/sync-evolution', wrap(async (req, res) => {
    const id = idParam.parse(req.params.id);
    const conversation = await requireConversation(req,id);
    if (!conversation) throw new HttpError(404, 'Conversa nao encontrada.');
    if (conversation.channel !== 'whatsapp') throw new HttpError(400, 'Sincronizacao Evolution disponivel apenas para WhatsApp.');
    const result = await syncEvolutionConversation({ orgId: req.orgId, conversation });
    res.json({ ok: true, ...result });
  }));
  router.post('/:id/messages', wrap(async (req, res) => {
    const id = idParam.parse(req.params.id);
    const input = newMessage.parse(req.body);
    const conversation = await requireConversation(req,id);
    if (!conversation) throw new HttpError(404, 'Conversa nao encontrada.');
    if (conversation.channel === 'whatsapp' && !input.is_internal) {
      const evolution = await loadEvolution(req.orgId, conversation.integration_id);
      if(evolution) {
        const message = await sendEvolutionText({orgId:req.orgId,conversation,text:input.body,userId:req.user.id});
        return res.status(201).json({...message,accepted_by_evolution:true,delivered_to_whatsapp:false});
      }
      const target=await prisma.integration.findFirst({where:{id:conversation.integration_id??'',org_id:req.orgId,type:'whatsapp'}});
      if(!target || target.config?.connection_mode!=='official')throw new HttpError(409,'Conversa sem instancia Evolution ou API oficial valida. Selecione o numero correto.');
      const message = await sendTextToWhatsApp({orgId:req.orgId,conversation,text:input.body,userId:req.user.id});
      return res.status(201).json({...message,accepted_by_meta:true,delivered_to_whatsapp:false});
    }
    const message = await prisma.$transaction(async (tx) => {
      const row = await tx.message.create({ data: {
        id: randomUUID(), org_id: req.orgId, conversation_id: id,
        body: input.body, sender_type: 'agent', sender_id: req.user.id,
        channel: conversation.channel, status: 'local_only', is_internal: input.is_internal ?? false,
      } });
      await tx.conversation.update({ where: { id }, data: { last_message_at: row.created_at } });
      return row;
    });
    res.status(201).json({ ...message, delivered_to_whatsapp: false });
  }));
  return router;
}
