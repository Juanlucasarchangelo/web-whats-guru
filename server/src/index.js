import { getConfig } from './config.js';
import { prisma } from './db.js';
import { createApp } from './app.js';

const config = getConfig();
const app = createApp(config);
try {
  await prisma.$connect();
  const server = app.listen(config.port, config.host, () => {
    console.log(`Converso API: http://${config.host}:${config.port}/api/health`);
    console.log('Backend local iniciado. Frontend utiliza API MySQL; recursos externos dependem de integracao propria.');
  });
  async function shutdown() {
    server.close(async () => { await prisma.$disconnect(); process.exit(0); });
  }
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
} catch (err) {
  console.error('Nao foi possivel conectar ao banco MySQL. Confira DATABASE_URL e o servico MySQL.');
  if (process.env.NODE_ENV !== 'production') console.error(err?.code || err?.message || 'Erro desconhecido');
  await prisma.$disconnect();
  process.exitCode = 1;
}
