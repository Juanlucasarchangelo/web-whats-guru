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

export function createApp(config) {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cors({ origin(origin, callback) {
    if (!origin || config.origins.includes(origin)) return callback(null, true);
    return callback(new Error('Origem CORS nao permitida.'));
  } }));
  app.use(express.json({ limit: '100kb' }));
  const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: 'draft-8', legacyHeaders: false,
    message: { error: 'Muitas tentativas. Aguarde 15 minutos.' },
  });

  // Verifica MySQL de verdade; informacoes sensiveis NAO sao expostas.
  app.get('/api/health', wrap(async (_req, res) => {
    try {
      await prisma.$queryRaw`SELECT 1 AS ok`;
      const [tables] = await prisma.$queryRaw`SELECT COUNT(*) AS total FROM information_schema.tables WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE'`;
      const count = Number(tables?.total ?? 0);
      return res.status(count === 24 ? 200 : 503).json({ api: 'online', mysql: 'connected', tables: count, expected_tables: 24 });
    } catch {
      return res.status(503).json({ api: 'online', mysql: 'disconnected' });
    }
  }));

  app.use('/api/webhooks/evolution', evolutionWebhookRouter());
  app.use('/api/auth', authRouter(config, authLimiter));
  app.use('/api', authenticate(config), withOrganization, (() => {
    const secure = express.Router();
    secure.get('/organizations/current', wrap(async (req, res) => {
      const organization = await prisma.organization.findFirst({ where: { id: req.orgId }, select: { id: true, name: true, plan: true, status: true } });
      res.json({ ...organization, role: req.role });
    }));
    secure.get('/dashboard/summary', wrap(async (req, res) => {
      const [contacts, conversations, open, messages] = await Promise.all([
        prisma.contact.count({ where: { org_id: req.orgId } }),
        prisma.conversation.count({ where: { org_id: req.orgId } }),
        prisma.conversation.count({ where: { org_id: req.orgId, status: 'open' } }),
        prisma.message.count({ where: { org_id: req.orgId } }),
      ]);
      res.json({ contacts, conversations, open_conversations: open, messages });
    }));
    secure.use('/local', localDataRouter());
    secure.use('/team', teamRouter());
    secure.use('/channels', channelsRouter());
    secure.use('/integrations', restoredIntegrationsRouter());
    secure.use('/contacts', contactsRouter());
    secure.use('/conversations', conversationsRouter());
    return secure;
  })());
  app.use((_req, res) => res.status(404).json({ error: 'Rota inexistente.' }));
  app.use(errorHandler);
  return app;
}
