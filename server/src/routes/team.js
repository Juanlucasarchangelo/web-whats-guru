import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { prisma } from '../db.js';
import { HttpError, wrap } from '../http.js';
const schema = z.object({ email: z.string().email().max(254), role: z.enum(['agent', 'admin']).default('agent') }).strict();
export function teamRouter() {
  const router = Router();
  router.post('/members', wrap(async (req, res) => {
    if (req.role !== 'owner') throw new HttpError(403, 'Somente o proprietario pode adicionar pessoas.');
    const { email, role } = schema.parse(req.body);
    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() }, select: { id: true, is_active: true } });
    if (!user?.is_active) throw new HttpError(404, 'Este e-mail ainda nao possui uma conta local. Primeiro cadastre o usuario.');
    const existing = await prisma.orgMember.findFirst({ where: { org_id: req.orgId, user_id: user.id } });
    if (existing) throw new HttpError(409, 'Usuario ja pertence a esta empresa.');
    const member = await prisma.orgMember.create({ data: { id: randomUUID(), org_id: req.orgId, user_id: user.id, role, status: 'active' } });
    res.status(201).json(member);
  }));
  return router;
}
