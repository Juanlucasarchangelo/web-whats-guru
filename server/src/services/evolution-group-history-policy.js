/** Helpers for Evolution v2.3.x. Independent of Prisma to allow regression tests. */
import { groupJid } from './evolution-groups-policy.js';

export function normalizedProviderMessage(original) {
  const nested = original?.data && typeof original.data === 'object' ? original.data : {};
  return {
    ...nested, ...original,
    key: original?.key ?? nested.key,
    message: original?.message ?? nested.message,
    messageTimestamp: original?.messageTimestamp ?? nested.messageTimestamp,
  };
}

/** Never use a group participant/alternative JID as the conversation identifier. */
export function messageGroupJid(original) {
  return groupJid(normalizedProviderMessage(original).key?.remoteJid);
}

export function evolutionGroupSettings(data) {
  const value = data?.settings?.settings ?? data?.settings ?? data?.data?.settings ?? data?.data ?? data;
  const bool = (...keys) => {
    for (const key of keys) {
      if (value?.[key] === true || value?.[key] === false) return value[key];
    }
    return null;
  };
  return {
    sync_full_history: bool('sync_full_history', 'syncFullHistory'),
    groups_ignore: bool('groups_ignore', 'groupsIgnore'),
  };
}

export function groupHistoryHints(settings, { unfilteredError = null, partial = false } = {}) {
  const warnings = [];
  if (settings?.groups_ignore === true)
    warnings.push('A Evolution está configurada para ignorar grupos (groupsIgnore=true).');
  if (settings?.sync_full_history === false)
    warnings.push('A Evolution está com syncFullHistory=false; mensagens antigas talvez não tenham sido armazenadas.');
  if (unfilteredError) warnings.push('Consulta alternativa ao histórico falhou na Evolution.');
  if (partial) warnings.push('A varredura alternativa atingiu o limite de segurança antes de concluir.');
  return warnings;
}
