import { getConfig } from './config.js';
import { prisma } from './db.js';
import { createApp } from './app.js';
import { configureEvolutionWebhook } from './services/evolution.js';
import { workflowTick } from './services/workflow-engine.js';
import { operationsTick } from './services/operations-engine.js';

const config = getConfig();
const app = createApp(config);
try {
  await prisma.$connect();
  const server = app.listen(config.port, config.host, () => {
    console.log(`Converso API: http://${config.host}:${config.port}/api/health`);
    console.log('Backend local iniciado. Frontend utiliza API MySQL.');
    if (process.env.EVOLUTION_AUTO_WEBHOOK === 'true') {
      const publicUrl=process.env.EVOLUTION_WEBHOOK_PUBLIC_URL?.trim();
      const secret=process.env.EVOLUTION_WEBHOOK_SECRET?.trim();
      if (!publicUrl || !secret || secret.length < 32 || !/^https?:\/\//.test(publicUrl)) {
        console.error('[Evolution Webhook] Configuracao incompleta: verifique EVOLUTION_WEBHOOK_PUBLIC_URL e EVOLUTION_WEBHOOK_SECRET (>=32 caracteres).');
      } else {
        (async()=>{
          const integrations=await prisma.integration.findMany({where:{type:'whatsapp'},select:{id:true,org_id:true,config:true}});
          for (const integration of integrations) {
            if(integration.config?.provider!=='evolution_api')continue;
            try {
              const endpoint=`${publicUrl.replace(/\/$/,'')}/api/webhooks/evolution/${encodeURIComponent(secret)}`;
              const result=await configureEvolutionWebhook(integration.org_id,endpoint,integration.id);
              console.info('[Evolution Webhook] Registro automatico:',{instance:result.instance,ok:result.ok});
            }catch(err){console.error('[Evolution Webhook] Falha de registro:',{code:err?.code||'ERROR',message:err?.message});}
          }
        })().catch(e=>console.error('[Evolution Webhook] Falha de inicializacao:',e?.message));
      }
    }
  });
  // Runs while the backend is online. Does not need a separate cron service.
  const workflowTimer = setInterval(() => {
    workflowTick().catch(error => console.error('[Workflow] Erro no agendador:', error.message));
  }, 30000);
  workflowTimer.unref?.();
  const operationTimer=setInterval(()=>{
    operationsTick().catch(e=>console.error('[Campanhas/Agendamentos] Erro na fila:',e.message));
  },30000);
  operationTimer.unref?.();
  async function shutdown() {
    clearInterval(workflowTimer);
    clearInterval(operationTimer);
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
