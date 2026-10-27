import express from 'express';
import { rateLimit } from 'express-rate-limit';
import { randomUUID } from 'node:crypto';
import { saveTechnicalReport } from '../services/technical-report-storage.js';

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 12,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Muitas tentativas. Aguarde alguns minutos.' },
});

export function publicTechnicalReportRouter() {
  const router = express.Router();
  router.use(limiter);
  router.post('/', express.json({ limit: '16mb' }), async (req, res) => {
    try {
      const body = req.body;
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return res.status(400).json({ error: 'Relatório inválido.' });
      }
      if (typeof body.cliente !== 'string' || !body.cliente.trim() || body.cliente.length > 120) {
        return res.status(400).json({ error: 'Informe o nome do cliente (até 120 caracteres).' });
      }
      const date = new Date(body.data);
      if (!body.data || Number.isNaN(date.getTime())) {
        return res.status(400).json({ error: 'Informe uma data válida.' });
      }
      const fotos = body.fotos;
      if (!Array.isArray(fotos) || fotos.length > 10) {
        return res.status(400).json({ error: 'São permitidas até 10 fotografias por envio.' });
      }
      if (fotos.some(f => !f || typeof f !== 'object' || typeof f.dataUrl !== 'string' || f.dataUrl.length > 4_000_000 || !/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(f.dataUrl))) {
        return res.status(400).json({ error: 'Fotografia inválida. Use JPEG, PNG ou WebP.' });
      }
      const str = (v, max = 10000) => typeof v === 'string' ? v.slice(0, max) : '';
      const arr = v => Array.isArray(v) ? v.slice(0, 30).map(x => str(x, 500)) : [];
      const report = {
        id: randomUUID(),
        cliente: body.cliente.trim(),
        data: date.toISOString(),
        operacao: str(body.operacao, 120),
        endereco: str(body.endereco, 500),
        tecnicos: arr(body.tecnicos),
        status: ['concluido', 'parcial', 'pendente'].includes(body.status) ? body.status : null,
        servico: str(body.servico),
        pendencias: arr(body.pendencias),
        observacoes: str(body.observacoes),
        criadoEm: new Date().toISOString(),
      };
      const saved = await saveTechnicalReport(report, fotos);
      return res.status(201).json({ sucesso: true, protocolo: report.id, fotos: saved.photoCount });
    } catch (error) {
      console.error('[Relatório Técnico] Falha ao salvar:', error);
      return res.status(500).json({ error: 'Não foi possível salvar no NAS. Tente novamente.' });
    }
  });
  return router;
}
