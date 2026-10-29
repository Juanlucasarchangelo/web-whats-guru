import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { prisma } from '../db.js';
import { HttpError, wrap } from '../http.js';
import { requirePermission, can } from '../services/permissions.js';
import { technicalDocumentSchemas } from '../services/technical-document-schemas.js';
const { requestSchema } = technicalDocumentSchemas;

const uuid = z.string().uuid();
const pad = num => String(num).padStart(3, '0');
function summary(row) {
  return { id: row.id, doc_type: row.doc_type, document_number: row.document_number,
    document_date: row.document_date.toISOString().slice(0,10),
    client_name: row.client_name, reference_number: row.reference_number,
    creator_name: row.creator_name, creator_kind: row.creator_kind, created_at: row.created_at.toISOString() };
}

async function save(orgId, body, creator) {
  const input = requestSchema.parse(body);
  const payload = JSON.stringify(input.payload);
  // Limite explícito evita pacotes gigantes e falhas silenciosas de armazenamento de fotos.
  if (payload.length > 50_000_000) throw new HttpError(413, 'Fotos muito grandes para armazenamento. Reduza a quantidade ou o tamanho das imagens.');
  const existing = await prisma.technicalDocument.findUnique({
    where: { org_id_client_request_id: { org_id: orgId, client_request_id: input.client_request_id } },
  });
  if (existing) {
    if (existing.doc_type !== input.doc_type || existing.payload !== payload) throw new HttpError(409, 'Identificador de envio já utilizado para outro formulário.');
    return summary(existing);
  }
  try {
    const saved = await prisma.$transaction(async tx => {
      // Inicializa o contador por empresa e tipo. O incremento é atômico e só é efetivado com o documento.
      await tx.$executeRaw`INSERT INTO technical_document_counters (org_id, doc_type, next_number)
        VALUES (${orgId}, ${input.doc_type}, 1)
        ON DUPLICATE KEY UPDATE next_number = next_number`;
      const count = await tx.technicalDocumentCounter.update({
        where: { org_id_doc_type: { org_id: orgId, doc_type: input.doc_type } },
        data: { next_number: { increment: 1 } },
      });
      return tx.technicalDocument.create({ data: {
        id: randomUUID(), org_id: orgId, doc_type: input.doc_type,
        document_number: count.next_number - 1, client_request_id: input.client_request_id,
        document_date: new Date(`${input.payload.data}T12:00:00Z`),
        client_name: input.payload.cliente,
        reference_number: (input.doc_type === 'odd' ? input.payload.numeroProposta : input.payload.numeroOdd) || null,
        creator_user_id: creator.userId, creator_name: creator.name,
        creator_kind: creator.userId ? 'authenticated' : 'public', payload,
      } });
    });
    return summary(saved);
  } catch (error) {
    if (error?.code === 'P2002') {
      const duplicate = await prisma.technicalDocument.findUnique({
        where: { org_id_client_request_id: { org_id: orgId, client_request_id: input.client_request_id } },
      });
      if (duplicate && duplicate.payload === payload && duplicate.doc_type === input.doc_type) return summary(duplicate);
    }
    throw error;
  }
}

async function publicOrg(config) {
  const configured = config.publicTechnicalOrgId;
  if (configured) {
    const org = await prisma.organization.findUnique({ where: { id: configured }, select: { id:true, status:true } });
    if (!org || org.status !== 'active') throw new HttpError(503, 'Empresa pública dos formulários não está disponível.');
    return org.id;
  }
  // Instalações com uma única empresa continuam funcionando sem configuração extra.
  // Em ambiente multiempresa, a variável fixa impede atribuir dados à empresa errada.
  const organizations = await prisma.organization.findMany({ where: { status:'active' }, select: { id:true }, take:2 });
  if (organizations.length !== 1) throw new HttpError(503, 'Configure PUBLIC_TECHNICAL_ORG_ID para receber formulários públicos.');
  return organizations[0].id;
}

async function resolvePublicCreator(req, config, orgId) {
  const anonymous = { userId: null, name: 'Usuário não logado' };
  const match = /^Bearer (.+)$/i.exec(req.headers.authorization || '');
  if (!match) return anonymous;
  let payload;
  try {
    payload = jwt.verify(match[1], config.jwtSecret, {
      algorithms: ['HS256'], issuer: 'converso-api', audience: 'converso-web',
    });
  } catch { return anonymous; } // Um token vencido não torna o formulário público privado.
  if (typeof payload.sub !== 'string') return anonymous;
  const [user, member] = await Promise.all([
    prisma.user.findUnique({ where: { id: payload.sub }, select: { id: true, email: true, is_active: true } }),
    prisma.orgMember.findFirst({ where: { user_id: payload.sub, org_id: orgId, status: 'active' }, select: { id: true } }),
  ]);
  if (!user?.is_active || !member) return anonymous;
  const profile = await prisma.userProfile.findUnique({ where: { user_id: user.id }, select: { full_name: true } });
  return { userId: user.id, name: profile?.full_name?.trim() || user.email };
}

export function publicTechnicalDocumentsRouter(config) {
  const router = Router();
  router.post('/', wrap(async (req, res) => {
    const orgId = await publicOrg(config);
    const creator = await resolvePublicCreator(req, config, orgId);
    const result = await save(orgId, req.body, creator);
    res.status(201).json({ id: result.id, doc_type: result.doc_type, document_number: result.document_number });
  }));
  return router;
}

export function technicalDocumentsRouter() {
  const router = Router();
  router.post('/', wrap(async (req, res) => {
    const type = req.body?.doc_type;
    const permission = type === 'odd' ? 'page.technicalOdd' : 'page.technicalReport';
    if (!can(req, permission)) throw new HttpError(403, 'Sem permissão para criar este formulário.');
    const profile = await prisma.userProfile.findUnique({ where: { user_id: req.user.id }, select: { full_name: true } });
    const result = await save(req.orgId, req.body, { userId: req.user.id,
      name: profile?.full_name?.trim() || req.user.email });
    res.status(201).json({ id: result.id, doc_type: result.doc_type, document_number: result.document_number });
  }));
  router.use(requirePermission('page.monitoring'));
  router.get('/', wrap(async (req, res) => {
    const query = z.object({ type: z.enum(['odd','technical_report']),
      page: z.coerce.number().int().min(1).max(100000).default(1),
      limit: z.coerce.number().int().min(1).max(100).default(25),
      q: z.string().trim().max(120).default(''),
    }).strict().parse(req.query);
    const where = { org_id: req.orgId, doc_type: query.type,
      ...(query.q ? { OR: [
        { client_name: { contains: query.q } },
        { creator_name: { contains: query.q } },
        { reference_number: { contains: query.q } },
      ] } : {}),
    };
    const [rows,total] = await Promise.all([
      prisma.technicalDocument.findMany({ where, orderBy: [{ created_at:'desc' }, { document_number:'desc' }],
        skip: (query.page - 1)*query.limit, take: query.limit,
        select: { id:true, doc_type:true, document_number:true, document_date:true,
          client_name:true, reference_number:true, creator_name:true, creator_kind:true, created_at:true } }),
      prisma.technicalDocument.count({ where }),
    ]);
    res.json({ data: rows.map(summary), total, page: query.page, limit: query.limit });
  }));
  router.get('/:id', wrap(async (req, res) => {
    const row = await prisma.technicalDocument.findFirst({ where: { id: uuid.parse(req.params.id), org_id: req.orgId } });
    if (!row) throw new HttpError(404, 'Documento não encontrado.');
    res.setHeader('Cache-Control', 'no-store');
    res.json({ ...summary(row), payload: JSON.parse(row.payload) });
  }));
  return router;
}

