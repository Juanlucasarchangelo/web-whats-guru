import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { prisma } from './db.js';
import { authenticate, withOrganization } from './middleware/auth.js';
import { authRouter } from './routes/auth.js';
import { contactsRouter } from './routes/contacts.js';
import { conversationsRouter } from './routes/conversations.js';
import { localDataRouter } from './routes/local-data.js';
import { teamRouter } from './routes/team.js';
import { channelsRouter } from './routes/channels.js';
import { restoredIntegrationsRouter } from './routes/integrations-restore.js';
import { errorHandler, wrap } from './http.js';
import { evolutionWebhookRouter } from './routes/evolution-webhook.js';
import { operationsRouter } from './routes/operations.js';
import { profileRouter } from './routes/profile.js';
import { reportsRouter } from './routes/reports.js';
import { accessRouter } from './routes/access.js';
import { requirePermission, requireAny } from './services/permissions.js';
import { guardOperations, guardLocal } from './middleware/route-permissions.js';

export function createApp(config) {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cors({ origin(origin, callback) {
    if (!origin || config.origins.includes(origin)) return callback(null, true);
    return callback(new Error('Origem CORS nao permitida.'));
  } }));
  // Formulários com fotografias requerem carga maior; nas demais rotas permanece 100 KB.
  const regularJson = express.json({ limit: '100kb' });
  app.use((req, res, next) => req.method === 'POST' &&
    (req.path === '/api/technical-documents' || req.path === '/api/public/technical-documents')
      ? next() : regularJson(req, res, next));
  const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: 'draft-8', legacyHeaders: false,
    message: { error: 'Muitas tentativas. Aguarde 15 minutos.' },
  });

  // Verifica MySQL de verdade; informacoes sensiveis NAO sao expostas.
  app.get('/api/health', wrap(async (_req, res) => {
    try {
      await prisma.$queryRaw`SELECT 1 AS ok`;
      const [tables] = await prisma.$queryRaw`SELECT COUNT(*) AS total FROM information_schema.tables WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE' AND table_name <> '_prisma_migrations'`;
      const count = Number(tables?.total ?? 0);
      return res.status(count === 25 ? 200 : 503).json({ api: 'online', mysql: 'connected', tables: count, expected_tables: 25 });
    } catch {
      return res.status(503).json({ api: 'online', mysql: 'disconnected' });
    }
  }));

  app.use('/api/webhooks/evolution', evolutionWebhookRouter());
  app.use('/api/auth', authRouter(config, authLimiter));
  // Endpoint público é APENAS para criar; nenhum GET público consulta documentos.
  const publicSubmitLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 30,
    standardHeaders: 'draft-8', legacyHeaders: false,
    message: { error: 'Limite de envios atingido. Tente novamente mais tarde.' },
  });
  app.use('/api/public/technical-documents', publicSubmitLimiter,
    express.json({ limit: '80mb' }), publicTechnicalDocumentsRouter(config));
  // O salvamento autenticado pode incluir fotografias, sem ampliar outras APIs.
  app.use('/api/technical-documents', (req, res, next) => req.method === 'POST'
    ? express.json({ limit: '80mb' })(req, res, next) : next());
  app.use('/api', authenticate(config), withOrganization, (() => {
    const secure = express.Router();
    secure.use('/access',accessRouter());
    secure.get('/organizations/current', wrap(async (req, res) => {
      const organization = await prisma.organization.findFirst({ where: { id: req.orgId }, select: { id: true, name: true, plan: true, status: true } });
      res.json({ ...organization, role: req.role });
    }));
    secure.get('/dashboard/summary', requirePermission('page.dashboard'), wrap(async (req, res) => {
      const [contacts, conversations, open, messages] = await Promise.all([
        prisma.contact.count({ where: { org_id: req.orgId } }),
        prisma.conversation.count({ where: { org_id: req.orgId } }),
        prisma.conversation.count({ where: { org_id: req.orgId, status: 'open' } }),
        prisma.message.count({ where: { org_id: req.orgId } }),
      ]);
      res.json({ contacts, conversations, open_conversations: open, messages });
    }));
    secure.use('/operations', guardOperations, operationsRouter());
    secure.use('/profile', requirePermission('page.profile'), profileRouter());
    secure.use('/reports', requirePermission('page.reports'), reportsRouter());
    secure.use('/local', guardLocal, localDataRouter());
    secure.use('/team', requirePermission('page.team'), teamRouter());
    secure.use('/channels', requireAny('page.inbox','page.team','page.settings'), channelsRouter());
    secure.use('/integrations', requireAny('page.settings','page.inbox'), restoredIntegrationsRouter());
    secure.use('/contacts', requireAny('page.contacts','page.crm','page.inbox'), contactsRouter());
    secure.use('/conversations', requirePermission('page.inbox'), conversationsRouter());
    return secure;
  })());
  app.use((_req, res) => res.status(404).json({ error: 'Rota inexistente.' }));
  app.use(errorHandler);
  return app;
}
