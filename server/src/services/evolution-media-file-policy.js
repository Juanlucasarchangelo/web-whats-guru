import { safeMediaFilename } from './nas-storage.js';

const extensions = { image: '.jpg', video: '.mp4', audio: '.ogg', document: '.bin', sticker: '.webp' };
const mimeExtensions = { 'image/png':'.png', 'image/jpeg':'.jpg', 'image/webp':'.webp',
  'video/mp4':'.mp4', 'video/quicktime':'.mov', 'audio/mpeg':'.mp3', 'audio/mp4':'.m4a',
  'audio/ogg':'.ogg', 'application/pdf':'.pdf', 'application/zip':'.zip' };

export function originalMediaFilename(message) {
  const provider = message?.media_message?.message;
  const raw = message?.media_name ?? provider?.documentMessage?.fileName ??
    provider?.videoMessage?.fileName ?? provider?.imageMessage?.fileName ??
    provider?.audioMessage?.fileName;
  if (typeof raw === 'string' && raw.trim()) return safeMediaFilename(raw);
  // WhatsApp images/voice notes often do not transmit the original filename.
  // A descriptive deterministic fallback is preferable to timestamps+UUIDs.
  const date = new Date(message?.created_at || Date.now()).toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const type = String(message?.media_type || 'arquivo');
  return safeMediaFilename(`${type}_${date}${mimeExtensions[message?.media_mime] || extensions[type] || '.bin'}`);
}

