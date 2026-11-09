import { Router } from 'express';
import { can } from '../services/permissions.js';
import { admin, visibleChannelIds } from '../services/channel-access.js';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { prisma } from '../db.js';
import { HttpError, wrap } from '../http.js';

const idParam = z.string().uuid();
const contactSchema = z.object({
  name: z.string().trim().min(1).max(200),
  email: z.string().trim().email().max(254).nullable().optional(),
  phone: z.string().trim().max(60).nullable().optional(),
  crm_stage: z.string().trim().min(1).max(64).optional(),
  crm_value: z.number().finite().min(0).max(9999999999.99).optional(),
  custom_fields: z.record(z.unknown()).optional(),
}).strict();
const editSchema = contactSchema.partial().refine((obj) => Object.keys(obj).length > 0, 'Informe um campo para atualizar.');

async function authorizedContactWhere(req, contactId) {
  const base = { id:contactId, org_id:req.orgId };
  if (admin(req)) return base;
  const ids=await visibleChannelIds(req);
  return { ...base, OR: [
    {created_by_user_id:req.user.id},
    {contact_integrations:{some:{org_id:req.orgId,integration_id:{in:ids}}}},
    {conversations:{some:{org_id:req.orgId,integration_id:{in:ids}}}},
  ]};
}

export function contactsRouter() {
  const router = Router();
  router.get('/', wrap(async (req, res) => {
    const page = Math.min(Math.max(Number.parseInt(String(req.query.page || 1), 10) || 1, 1), 100000);
    const limit = Math.min(Math.max(Number.parseInt(String(req.query.limit || 100), 10) || 100, 1), 250);
    const q = String(req.query.q ?? '').trim().slice(0, 120);
    const tag = String(req.query.tag ?? 'all');
    const integrationId = req.query.integration_id ? idParam.parse(String(req.query.integration_id)) : null;
    const ownerUserId = req.query.owner_user_id ? idParam.parse(String(req.query.owner_user_id)) : null;
    if(ownerUserId && !admin(req))throw new HttpError(403,'Filtro por usuário reservado a gestores.');
    const channelIds = await visibleChannelIds(req);
    if (integrationId && !channelIds.includes(integrationId)) throw new HttpError(403, 'Instância sem acesso.');
    let scopedIds=channelIds;
    if(ownerUserId) {
      const owned=await prisma.integration.findMany({where:{org_id:req.orgId,type:'whatsapp',id:{in:channelIds}},select:{id:true,config:true}});
      scopedIds=owned.filter(ch=>ch.config?.owner_user_id===ownerUserId).map(ch=>ch.id);
    }
    const base = { org_id: req.orgId };
    // Isolamento efetivo no backend, não apenas no seletor do frontend.
    const linked = integrationId ? { integration_id: integrationId } : { integration_id: { in: scopedIds } };
    const linkedToChannel = { OR: [
      { contact_integrations: { some: { ...linked, org_id: req.orgId } } },
      { conversations: { some: { ...linked, org_id: req.orgId } } },
      ...(!integrationId ? [{ created_by_user_id: ownerUserId||req.user.id }] : []),
    ] };
    const where = {
      ...base,
      AND: [
        ...(!admin(req) || integrationId || ownerUserId ? [linkedToChannel] : []),
        ...(q ? [{ OR: [{ name: { contains: q } }, { phone: { contains: q } }, { email: { contains: q } }] }] : []),
      ],
      ...(tag === 'none' ? { contact_tags: { none: { tags: { org_id: req.orgId } } } } : tag !== 'all' ? {
        contact_tags: { some: { tag_id: idParam.parse(tag), tags: { org_id: req.orgId } } },
      } : {}),
    };
    const [data, total] = await Promise.all([
      prisma.contact.findMany({ where, orderBy: [{ name: 'asc' }, { id: 'asc' }], skip: (page - 1) * limit, take: limit,
        include: {
          contact_integrations: { where: { org_id: req.orgId, integration_id: { in: scopedIds } }, select: { integration_id: true } },
          contact_tags: { where: { tags: { org_id: req.orgId } }, select: { tag_id: true } },
          conversations: { where: { org_id: req.orgId, integration_id: { in: scopedIds } }, select: { integration_id: true } },
        },
      }),
      prisma.contact.count({ where }),
    ]);
    const results = data.map(({ conversations, contact_integrations, contact_tags, ...contact }) => ({ ...contact,
      tag_ids: contact_tags.map(tag=>tag.tag_id),
      integration_ids: [...new Set([...contact_integrations.map(c => c.integration_id), ...conversations.map(c => c.integration_id)].filter(Boolean))],
    }));
    res.json({ data: results, total, page, limit });
  }));
  router.post('/', wrap(async (req, res) => {
    const input = contactSchema.parse(req.body);
    const contact = await prisma.contact.create({ data: {
      id: randomUUID(), org_id: req.orgId, created_by_user_id: req.user.id, name: input.name,
      email: input.email ?? null, phone: input.phone ?? null,
      crm_stage: input.crm_stage ?? 'lead', crm_value: input.crm_value ?? 0,
      custom_fields: input.custom_fields ?? {},
    } });
    res.status(201).json(contact);
  }));
  router.get('/:id', wrap(async (req, res) => {
    const id = idParam.parse(req.params.id);
    const contact = await prisma.contact.findFirst({ where: await authorizedContactWhere(req,id) });
    if (!contact) throw new HttpError(404, 'Contato nao encontrado.');
    res.json(contact);
  }));
  router.patch('/:id', wrap(async (req, res) => {
    const id = idParam.parse(req.params.id);
    const input = editSchema.parse(req.body);
    const result = await prisma.contact.updateMany({ where: await authorizedContactWhere(req,id), data: input });
    if (!result.count) throw new HttpError(404, 'Contato nao encontrado.');
    res.json(await prisma.contact.findFirst({ where: { id, org_id: req.orgId } }));
  }));
  router.delete('/:id', wrap(async (req, res) => {
    if (!can(req,'contacts.delete')) throw new HttpError(403, 'Somente administradores podem excluir contatos.');
    const id = idParam.parse(req.params.id);
    const result = await prisma.contact.deleteMany({ where: await authorizedContactWhere(req,id) });
    if (!result.count) throw new HttpError(404, 'Contato nao encontrado.');
    res.status(204).end();
  }));
  return router;
}
