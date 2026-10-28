import jwt from 'jsonwebtoken';
import { prisma } from '../db.js';
import { HttpError, wrap } from '../http.js';
import { normalizeRole } from '../services/permissions.js';

export const authenticate = (config) => wrap(async (req, res, next) => {
  const match = /^Bearer (.+)$/i.exec(req.headers.authorization || '');
  if (!match) throw new HttpError(401, 'Token de acesso ausente.');
  let payload;
  try {
    payload = jwt.verify(match[1], config.jwtSecret, { algorithms: ['HS256'], issuer: 'converso-api', audience: 'converso-web' });
  } catch {
    throw new HttpError(401, 'Token expirado ou invalido.');
  }
  if (typeof payload.sub !== 'string') throw new HttpError(401, 'Token invalido.');
  const user = await prisma.user.findUnique({ where: { id: payload.sub }, select: { id: true, email: true, is_active: true } });
  if (!user?.is_active) throw new HttpError(401, 'Usuario desativado ou inexistente.');
  req.user = user;
  next();
});

export const withOrganization = wrap(async (req, res, next) => {
  const orgId = req.headers['x-org-id'];
  if (orgId !== undefined && (typeof orgId !== 'string' || !/^[0-9a-f-]{36}$/i.test(orgId))) {
    throw new HttpError(400, 'x-org-id invalido.');
  }
  const member = await prisma.orgMember.findFirst({
    where: { user_id: req.user.id, status: 'active', ...(orgId ? { org_id: orgId } : {}) },
    orderBy: { created_at: 'asc' },
  });
  if (!member) throw new HttpError(403, 'Voce nao pertence a uma organizacao ativa.');
  req.orgId = member.org_id;
  req.role = normalizeRole(member.role);
  const accessRole = await prisma.accessRole.findFirst({where:{org_id:member.org_id,slug:req.role},select:{permissions:true,name:true}});
  if(!accessRole || !Array.isArray(accessRole.permissions)) throw new HttpError(403, 'Cargo sem permissões configuradas. Execute as migrations do banco.');
  req.permissions = accessRole.permissions.filter(p=>typeof p==='string');
  req.roleName = accessRole.name;
  next();
});
