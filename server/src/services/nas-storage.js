import fs from 'node:fs/promises';
import path from 'node:path';

export function getStorageRoot() {
  const root = process.env.FALACOMIGO_STORAGE_PATH;
  if (!root) throw new Error('FALACOMIGO_STORAGE_PATH não configurado.');
  return path.resolve(root);
}

function safeFolderName(value) {
  return String(value ?? '')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '-')
    .replace(/\.\./g, '-')
    .replace(/[. ]+$/g, '')
    .slice(0, 120) || 'desconhecido';
}

/** Keep the original human filename where WhatsApp actually provides it.
 * Never accept a path from a remote message or overwrite a homonymous file.
 */
export function safeMediaFilename(value) {
  const leaf = String(value ?? '').replace(/\\/g, '/').split('/').pop() || 'arquivo';
  const cleaned = leaf.replace(/[<>:"/\\|?*\x00-\x1F]/g, '-')
    .replace(/\.\./g, '-').replace(/^[. ]+|[. ]+$/g, '') || 'arquivo';
  const ext = path.extname(cleaned).slice(0, 16);
  return cleaned.slice(0, Math.max(1, 180 - ext.length)) + (cleaned.length > 180 ? ext : '');
}

function resolveStoredPath(relativePath) {
  if (typeof relativePath !== 'string' || !relativePath) throw new Error('Caminho de mídia inválido.');
  const root = getStorageRoot();
  const fullPath = path.resolve(root, relativePath);
  const relative = path.relative(root, fullPath);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative))
    throw new Error('Arquivo fora da pasta de armazenamento.');
  return fullPath;
}

/** Private: <instancia>/<contato>/original.ext
 * Group: <instancia>/<data - nome do grupo - jid>/original.ext
 */
export async function saveMedia({ instance, contact, groupId = null, filename, buffer }) {
  if (!Buffer.isBuffer(buffer)) throw new Error('O arquivo deve ser um Buffer.');
  const root = getStorageRoot();
  const folder = groupId
    ? path.join(root, safeFolderName(instance), safeFolderName(`${contact} - ${groupId}`))
    : path.join(root, safeFolderName(instance), safeFolderName(contact));
  await fs.mkdir(folder, { recursive: true });
  const original = safeMediaFilename(filename);
  const extension = path.extname(original);
  const stem = original.slice(0, original.length - extension.length);
  // Atomically reserve the name: different WhatsApp files can have the same name.
  for (let suffix = 0; suffix < 10000; suffix++) {
    const selected = suffix === 0 ? original : `${stem} (${suffix + 1})${extension}`;
    const fullPath = path.join(folder, selected);
    try {
      await fs.writeFile(fullPath, buffer, { flag: 'wx' });
      return { fullPath, relativePath: path.relative(root, fullPath), filename: selected, size: buffer.length };
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
    }
  }
  throw new Error('Pasta contém arquivos demais com o mesmo nome.');
}

export async function readMedia(relativePath) {
  return fs.readFile(resolveStoredPath(relativePath));
}
