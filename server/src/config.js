import 'dotenv/config';

export function getConfig() {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  const jwtSecret = process.env.JWT_SECRET?.trim();
  if (!databaseUrl || databaseUrl.includes('SENHA_DO_MYSQL')) {
    throw new Error('Configure DATABASE_URL no arquivo server/.env.');
  }
  if (!jwtSecret || jwtSecret.length < 32) {
    throw new Error('JWT_SECRET deve ter pelo menos 32 caracteres aleatorios.');
  }
  if (!databaseUrl.startsWith('mysql://')) {
    throw new Error('DATABASE_URL deve usar mysql://.');
  }
  return {
    port: Number(process.env.PORT || 4000),
    host: process.env.HOST || '127.0.0.1',
    jwtSecret,
    jwtExpiresIn: process.env.JWT_EXPIRES_IN || '12h',
    allowRegistration: process.env.ALLOW_REGISTRATION === 'true',
    publicTechnicalOrgId: process.env.PUBLIC_TECHNICAL_ORG_ID?.trim() || null,
    origins: (process.env.CORS_ORIGINS || 'http://localhost:5173,http://127.0.0.1:5173')
      .split(',').map((o) => o.trim()).filter(Boolean),
  };
}
