import jwt from 'jsonwebtoken';
import { prisma } from '../db.js';
import { HttpError, wrap } from '../http.js';
import { normalizeRole, ALL_KEYS } from '../services/permissions.js';

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
  const user = await prisma.user.findUnique({ where: { id: payload.sub }, select: { id: true, email: true, is_active: true, global_role:true, approval_status:true, token_version:true, must_change_password:true } });
  if (!user?.is_active || user.approval_status !== 'approved') throw new HttpError(401, 'Acesso indisponivel.');
  // Tokens antigos (sem tv) continuam validos apenas enquanto token_version === 0.
  if (Number(payload.tv ?? 0) !== user.token_version) throw new HttpError(401, 'Sessao revogada. Faca login novamente.');
  if (user.must_change_password && !['/api/auth/me','/api/auth/change-password','/api/auth/logout'].includes(req.originalUrl?.split('?')[0])) {
    throw new HttpError(403, 'Altere sua senha temporaria antes de acessar o sistema.');
  }
  req.user = user;
  next();
});

export const withOrganization = wrap(async (req, res, next) => {
  const orgId = req.headers['x-org-id'];
  if (orgId !== undefined && (typeof orgId !== 'string' || !/^[0-9a-f-]{36}$/i.test(orgId))) {
    throw new HttpError(400, 'x-org-id invalido.');
  }
  // DEV global acessa qualquer organizacao existente, sem assumir membership ficticio.
  if (req.user.global_role === 'dev') {
    const org = await prisma.organization.findFirst({where: {status:'active',...(orgId?{id:orgId}:{})}, orderBy:{created_at:'asc'},select:{id:true}});
    if (!org) throw new HttpError(403,'Nenhuma empresa cadastrada. Abra a Administracao DEV.');
    req.orgId=org.id;
    req.role='dev';
    req.roleName='DEV';
    req.permissions=[...new Set([...ALL_KEYS,'page.devConsole'])];
    return next();
  }
  const member = await prisma.orgMember.findFirst({
    where: {user_id:req.user.id,status:'active',...(orgId?{org_id:orgId}:{})},
    orderBy:{created_at:'asc'},
  });
  if (!member) throw new HttpError(403, 'Voce nao pertence a uma organizacao ativa.');
  const org = await prisma.organization.findUnique({where:{id:member.org_id},select:{status:true}});
  if (org?.status!=='active') throw new HttpError(403,'Empresa sem acesso ativo.');
  req.orgId=member.org_id;
  req.role=normalizeRole(member.role);
  const accessRole=await prisma.accessRole.findFirst({where:{org_id:member.org_id,slug:req.role},select:{permissions:true,name:true}});
  if(!accessRole || !Array.isArray(accessRole.permissions)) throw new HttpError(403, 'Cargo sem permissoes configuradas. Execute as migrations do banco.');
  req.permissions=accessRole.permissions.filter(p=>typeof p==='string' && p!=='page.devConsole');
  req.roleName=accessRole.name;
  next();
});
