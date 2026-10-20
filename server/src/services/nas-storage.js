
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export function getStorageRoot() {
  const root = process.env.FALACOMIGO_STORAGE_PATH;

  if (!root) {
    throw new Error('FALACOMIGO_STORAGE_PATH não configurado.');
  }

  return path.resolve(root);
}

function safeFolderName(value) {
  return String(value ?? '')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '-')
    .replace(/\.\./g, '-')
    .replace(/[. ]+$/g, '')
    .slice(0, 120) || 'desconhecido';
}

function resolveStoredPath(relativePath) {
  if (typeof relativePath !== 'string' || !relativePath) {
    throw new Error('Caminho de mídia inválido.');
  }

  const root = getStorageRoot();
  const fullPath = path.resolve(root, relativePath);
  const relative = path.relative(root, fullPath);

  if (
    relative === '..' ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new Error('Arquivo fora da pasta de armazenamento.');
  }

  return fullPath;
}

export async function saveMedia({
  instance,
  contact,
  filename,
  buffer
}) {
  if (!Buffer.isBuffer(buffer)) {
    throw new Error('O arquivo deve ser um Buffer.');
  }

  const root = getStorageRoot();

  const folder = path.join(
    root,
    safeFolderName(instance),
    safeFolderName(contact)
  );

  await fs.mkdir(folder, { recursive: true });

  const extension = path.extname(filename || '').slice(0, 15);
  const uniqueName = `${Date.now()}-${randomUUID()}${extension}`;

  const fullPath = path.join(folder, uniqueName);

  await fs.writeFile(fullPath, buffer, { flag: 'wx' });

  return {
    fullPath,
    relativePath: path.relative(root, fullPath),
    filename: uniqueName,
    size: buffer.length
  };
}

export async function readMedia(relativePath) {
  return fs.readFile(resolveStoredPath(relativePath));
}
