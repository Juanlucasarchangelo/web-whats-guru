import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from '../db.js';
import { HttpError, wrap } from '../http.js';
import { authenticate } from '../middleware/auth.js';
import { roleRows, normalizeRole } from '../services/permissions.js';

const signupSchema = z.object({
  fullName: z.string().trim().min(2).max(150),
  email: z.string().trim().email().max(254).transform((v) => v.toLowerCase()),
  password: z.string().min(10).max(128),
  orgName: z.string().trim().min(2).max(150).optional(),
}).strict();
const loginSchema = z.object({
  email: z.string().trim().email().max(254).transform((v) => v.toLowerCase()),
  password: z.string().min(1),
}).strict();
function tokenFor(user, config) {
  return jwt.sign({}, config.jwtSecret, {
    subject: user.id, issuer: 'converso-api', audience: 'converso-web',
    algorithm: 'HS256', expiresIn: config.jwtExpiresIn,
  });
}
export function authRouter(config, authLimiter) {
  const router = Router();
  router.post('/register', authLimiter, wrap(async (req, res) => {
    if (!config.allowRegistration) throw new HttpError(403, 'Cadastro publico desabilitado.');
    const { fullName, email, password, orgName } = signupSchema.parse(req.body);
    if (await prisma.user.findUnique({ where: { email }, select: { id: true } })) {
      throw new HttpError(409, 'Este e-mail ja esta cadastrado.');
    }
    const password_hash = await bcrypt.hash(password, 12);
    const id = randomUUID();
    const orgId = randomUUID();
    const created = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({ data: { id, email, password_hash } });
      await tx.userProfile.create({ data: { id: randomUUID(), user_id: id, full_name: fullName } });
      const org = await tx.organization.create({
        data: { id: orgId, owner_id: id, name: orgName || `${fullName} - Empresa`, slug: `empresa-${orgId.slice(0, 8)}`, settings: {} },
      });
      await tx.accessRole.createMany({data:roleRows(orgId).map(role=>({...role,id:randomUUID()}))});
      await tx.orgMember.create({ data: { id: randomUUID(), user_id: id, org_id: orgId, role: 'master', status: 'active' } });
      return { user, org };
    });
    res.status(201).json({ token: tokenFor(created.user, config),
      user: { id: created.user.id, email: created.user.email, full_name: fullName },
      organization: { id: created.org.id, name: created.org.name, role: 'master' } });
  }));
  router.post('/login', authLimiter, wrap(async (req, res) => {
    const { email, password } = loginSchema.parse(req.body);
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !user.is_active || !(await bcrypt.compare(password, user.password_hash))) {
      throw new HttpError(401, 'E-mail ou senha incorretos.');
    }
    await prisma.user.update({ where: { id: user.id }, data: { last_login_at: new Date() } });
    res.json({ token: tokenFor(user, config), user: { id: user.id, email: user.email } });
  }));
  router.get('/me', authenticate(config), wrap(async (req, res) => {
    const profile = await prisma.userProfile.findUnique({ where: { user_id: req.user.id } });
    const memberships = await prisma.orgMember.findMany({
      where: { user_id: req.user.id, status: 'active' },
      select: { org_id: true, role: true, status: true },
    });
    const organizations = memberships.length ? await prisma.organization.findMany({
      where: { id: { in: memberships.map((m) => m.org_id) } },
      select: { id: true, name: true, slug: true, status: true, plan: true },
    }) : [];
    res.json({ user: req.user, profile, organizations: organizations.map((o) => ({ ...o, role: normalizeRole(memberships.find((m) => m.org_id === o.id)?.role) })) });
  }));
  router.post('/change-password',authenticate(config),wrap(async(req,res)=>{
    const input=z.object({current_password:z.string().min(1),new_password:z.string().min(10).max(128)}).strict().parse(req.body);
    const user=await prisma.user.findUnique({where:{id:req.user.id},select:{password_hash:true}});
    if(!user || !(await bcrypt.compare(input.current_password,user.password_hash)))throw new HttpError(403,'Senha atual incorreta.');
    const password_hash=await bcrypt.hash(input.new_password,12);
    await prisma.user.update({where:{id:req.user.id},data:{password_hash}});
    res.json({changed:true});
  }));
  // Logout no cliente descarta o token. Revogacao imediata sera adicionada antes da producao.
  router.post('/logout', authenticate(config), (_req, res) => res.status(204).end());
  return router;
}
