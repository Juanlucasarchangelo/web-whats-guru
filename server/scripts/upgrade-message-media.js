/** Upgrade seguro e aditivo. Execute com backup, somente no banco LOCAL. */
import 'dotenv/config';
import { prisma } from '../src/db.js';
const fields = {
  media_type: 'VARCHAR(32) NULL',
  media_mime: 'VARCHAR(191) NULL',
  media_name: 'VARCHAR(255) NULL',
  media_size: 'INT NULL',
  media_message: 'JSON NULL',
};
try {
  const columns = await prisma.$queryRaw`SELECT COLUMN_NAME AS name FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'messages'`;
  const existing = new Set(columns.map(c => c.name));
  for (const [field, type] of Object.entries(fields)) {
    if (existing.has(field)) { console.log(`OK ${field}`); continue; }
    // SQL identifiers and types are static, hardcoded above (never user input).
    await prisma.$executeRawUnsafe(`ALTER TABLE messages ADD COLUMN ${field} ${type}`);
    console.log(`CRIADO ${field}`);
  }
  console.log('Campos de midia preparados. Execute npm run db:generate no backend.');
} finally { await prisma.$disconnect(); }
