import { ZodError } from 'zod';

export class HttpError extends Error {
  constructor(code, message) {
    super(message);
    this.status = code;
  }
}

export const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
export const parse = (schema, data) => schema.parse(data);

export function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);
  if (err instanceof ZodError) {
    return res.status(400).json({ error: 'Dados invalidos.', details: err.issues.map((i) => ({ field: i.path.join('.'), message: i.message })) });
  }
  if (err?.code === 'P2002') return res.status(409).json({ error: 'Registro duplicado.' });
  if (err?.code === 'P2003') return res.status(400).json({ error: 'Referencia invalida ou registro ainda vinculado.' });
  if (err?.status) return res.status(err.status).json({ error: err.message });
  console.error('Erro interno:', err?.message || err);
  return res.status(500).json({ error: 'Erro interno do servidor.' });
}
