import { Router } from 'express';
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

export function contactsRouter() {
  const router = Router();
  router.get('/', wrap(async (req, res) => {
    const page = Math.min(Math.max(Number.parseInt(String(req.query.page || 1), 10) || 1, 1), 100000);
    const limit = Math.min(Math.max(Number.parseInt(String(req.query.limit || 25), 10) || 25, 1), 100);
    const where = { org_id: req.orgId };
    const [data, total] = await Promise.all([
      prisma.contact.findMany({ where, orderBy: { created_at: 'desc' }, skip: (page - 1) * limit, take: limit }),
      prisma.contact.count({ where }),
    ]);
    res.json({ data, total, page, limit });
  }));
  router.post('/', wrap(async (req, res) => {
    const input = contactSchema.parse(req.body);
    const contact = await prisma.contact.create({ data: {
      id: randomUUID(), org_id: req.orgId, name: input.name,
      email: input.email ?? null, phone: input.phone ?? null,
      crm_stage: input.crm_stage ?? 'lead', crm_value: input.crm_value ?? 0,
      custom_fields: input.custom_fields ?? {},
    } });
    res.status(201).json(contact);
  }));
  router.get('/:id', wrap(async (req, res) => {
    const id = idParam.parse(req.params.id);
    const contact = await prisma.contact.findFirst({ where: { id, org_id: req.orgId } });
    if (!contact) throw new HttpError(404, 'Contato nao encontrado.');
    res.json(contact);
  }));
  router.patch('/:id', wrap(async (req, res) => {
    const id = idParam.parse(req.params.id);
    const input = editSchema.parse(req.body);
    const result = await prisma.contact.updateMany({ where: { id, org_id: req.orgId }, data: input });
    if (!result.count) throw new HttpError(404, 'Contato nao encontrado.');
    res.json(await prisma.contact.findFirst({ where: { id, org_id: req.orgId } }));
  }));
  router.delete('/:id', wrap(async (req, res) => {
    if (!['owner', 'admin'].includes(req.role)) throw new HttpError(403, 'Somente administradores podem excluir contatos.');
    const id = idParam.parse(req.params.id);
    const result = await prisma.contact.deleteMany({ where: { id, org_id: req.orgId } });
    if (!result.count) throw new HttpError(404, 'Contato nao encontrado.');
    res.status(204).end();
  }));
  return router;
}
