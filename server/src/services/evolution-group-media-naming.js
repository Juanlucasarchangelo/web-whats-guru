import path from 'node:path';
import { safeMediaFilename } from './nas-storage.js';
import { originalMediaFilename } from './evolution-media-file-policy.js';

function messageDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error('Data da mensagem inválida para o NAS.');
  return new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo',
    day: '2-digit', month: '2-digit', year: 'numeric' }).format(date).replaceAll('/', '-');
}

/** Somente anexos de grupos: data + autor (áudio), data + nome original (demais). */
export function groupArchiveFilename(message) {
  const date = messageDate(message?.created_at);
  const original = originalMediaFilename(message);
  if (message?.media_type !== 'audio') return safeMediaFilename(`${date} - ${original}`);
  const author = String(message?.group_sender_name ||
    (message?.sender_type === 'agent' ? 'Nossa equipe' : '') ||
    message?.group_sender_jid?.split('@')[0] || 'Remetente não identificado').trim();
  const extension = path.extname(original) || '.ogg';
  return safeMediaFilename(`${date} - ${author}${extension}`);
}
