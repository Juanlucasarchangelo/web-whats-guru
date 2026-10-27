import fs from 'node:fs/promises';
import path from 'node:path';
import { getStorageRoot } from './nas-storage.js';

function clean(value) {
  return String(value).normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9 _-]/g, '-').replace(/\s+/g, ' ').trim().slice(0, 90) || 'Cliente';
}

function technicalRoot() {
  // FALACOMIGO_STORAGE_PATH já aponta para o diretório Falacomigo no NAS.
  // Não duplica a pasta Public/Falacomigo dentro dela.
  const explicit = process.env.FALACOMIGO_TECNICO_PATH?.trim();
  if (explicit) {
    if (!path.isAbsolute(explicit)) throw new Error('FALACOMIGO_TECNICO_PATH deve ser absoluto.');
    return path.resolve(explicit);
  }
  return path.join(getStorageRoot(), 'Tecnico');
}

export async function saveTechnicalReport(report, photos) {
  const date = report.data.slice(0, 10);
  const folder = path.join(technicalRoot(), `${date} - ${clean(report.cliente)}`);
  await fs.mkdir(folder, { recursive: true });
  const names = [];
  try {
    for (let i = 0; i < photos.length; i++) {
      const photo = photos[i];
      const match = /^data:image\/(jpeg|png|webp);base64,(.*)$/.exec(photo.dataUrl);
      if (!match) throw new Error('Formato de imagem inválido.');
      const ext = { jpeg: 'jpg', png: 'png', webp: 'webp' }[match[1]];
      const buffer = Buffer.from(match[2], 'base64');
      if (!buffer.length || buffer.length > 3_000_000) throw new Error('Imagem acima do limite de 3MB.');
      const filename = `${report.id}-foto-${String(i + 1).padStart(2, '0')}.${ext}`;
      await fs.writeFile(path.join(folder, filename), buffer, { flag: 'wx' });
      names.push(filename);
    }
    const filename = `${report.id}-relatorio.json`;
    await fs.writeFile(path.join(folder, filename), JSON.stringify({ ...report, fotos: names }, null, 2), { flag: 'wx' });
    return { photoCount: names.length };
  } catch (error) {
    // Apenas arquivos desta tentativa são removidos; relatórios anteriores permanecem intactos.
    await Promise.allSettled(names.map(name => fs.unlink(path.join(folder, name))));
    throw error;
  }
}
