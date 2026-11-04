import { Router } from 'express';
import { requestStalker, StalkerError } from '../services/stalker-n8n.js';
const router = Router();
const validProfile = p => typeof p === 'string' && /^[a-z0-9._]{1,30}$/.test(p.replace(/^@/, '').toLowerCase());
const profileName = p => p.replace(/^@/, '').toLowerCase();
const validUser = validProfile;

function endpoint(key, method, validate) {
  return async (req, res, next) => {
    try {
      const data = method === 'POST' ? validate(req.body) : undefined;
      if (method === 'POST' && !data) return res.status(400).json({ error: 'Dados inválidos para esta operação.' });
      return res.json(await requestStalker(key, method, data));
    } catch (e) {
      if (e instanceof StalkerError) return res.status(e.status).json({ error: e.message });
      return next(e);
    }
  };
}
router.get('/leads', endpoint('leads', 'GET'));
router.get('/monitor', endpoint('monitor', 'GET'));
router.post('/lead', endpoint('lead', 'POST', b => {
  if (!b || !['selecionar','descartar','restaurar','bloquear','desbloquear','limpar_selecao'].includes(b.acao)) return null;
  if (b.acao === 'limpar_selecao') return { usuario: '', acao: b.acao };
  return validUser(b.usuario) ? { usuario: profileName(b.usuario), acao: b.acao } : null;
}));
router.post('/profile', endpoint('profile', 'POST', b => b && validProfile(b.perfil) && ['adicionar','remover'].includes(b.acao) ? { perfil: profileName(b.perfil), acao: b.acao } : null));
router.post('/profile/cleanup', endpoint('cleanup', 'POST', b => b && validProfile(b.perfil) && b.confirmacao === 'EXCLUIR_DADOS' ? { perfil: profileName(b.perfil), confirmacao:'EXCLUIR_DADOS' } : null));
router.post('/scrape', endpoint('scrape', 'POST', b => b?.acao === 'iniciar' ? { acao: 'iniciar' } : null));
router.post('/campaign', endpoint('campaign', 'POST', b => {
  if (!b || !['selecionados','comentarios'].includes(b.modo) || typeof b.mensagem !== 'string' || !b.mensagem.trim() || b.mensagem.length > 1000 || /[\r\n]/.test(b.mensagem)) return null;
  if (typeof b.campanha_id !== 'string' || !/^crm_[a-z0-9_]{5,60}$/i.test(b.campanha_id)) return null;
  if (!Array.isArray(b.usuarios) || !b.usuarios.length || b.usuarios.length > 2000 || b.usuarios.some(u => !validUser(u))) return null;
  return { campanha_id: b.campanha_id, mensagem: b.mensagem.trim(), usuarios: [...new Set(b.usuarios.map(profileName))], modo: b.modo };
}));
export const stalkerRouter = () => router;
