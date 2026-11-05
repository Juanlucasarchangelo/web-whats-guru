// Diagnostico local, SOMENTE LEITURA: confere se conversas do WhatsApp
// apontam para uma instancia Evolution da mesma empresa.
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
const db = new PrismaClient();
try {
  const [companies, channels, conversations] = await Promise.all([
    db.organization.findMany({select:{id:true,name:true}}),
    db.integration.findMany({where:{type:'whatsapp'},select:{id:true,org_id:true,name:true,config:true}}),
    db.conversation.findMany({where:{channel:'whatsapp'},select:{id:true,org_id:true,contact_id:true,integration_id:true}}),
  ]);
  const companyById = new Map(companies.map(org=>[org.id,org.name]));
  const channelById = new Map(channels.map(channel=>[channel.id,channel]));
  let missing=0,wrongCompany=0,orphan=0;
  console.info('Auditoria de escopo Evolution (somente leitura)');
  for (const org of companies) {
    const rows=conversations.filter(c=>c.org_id===org.id);
    const missingLinks=rows.filter(c=>!c.integration_id);
    const wrongLinks=rows.filter(c=>c.integration_id && channelById.has(c.integration_id) && channelById.get(c.integration_id).org_id!==org.id);
    const orphanLinks=rows.filter(c=>c.integration_id && !channelById.has(c.integration_id));
    missing+=missingLinks.length;wrongCompany+=wrongLinks.length;orphan+=orphanLinks.length;
    console.info(`${org.name}: ${rows.length} conversas WhatsApp, ${channels.filter(c=>c.org_id===org.id).length} instancias, sem instancia: ${missingLinks.length}, outra empresa: ${wrongLinks.length}, instancia inexistente: ${orphanLinks.length}`);
  }
  const unknownOrgs=conversations.filter(c=>!companyById.has(c.org_id));
  if(unknownOrgs.length)console.warn(`Conversas de empresas inexistentes: ${unknownOrgs.length}`);
  console.info(`TOTAL - sem instancia: ${missing}; outra empresa: ${wrongCompany}; instancia inexistente: ${orphan}`);
  if(missing||wrongCompany||orphan||unknownOrgs.length)console.warn('Ha vinculos antigos/inconsistentes: nao altere os dados sem revisar os registros individualmente.');
  else console.info('Todos os vinculos empresa/instancia das conversas WhatsApp estao consistentes.');
} catch(error) {
  console.error('Falha na auditoria:',error.message);
  process.exitCode=1;
} finally {
  await db.$disconnect();
}
