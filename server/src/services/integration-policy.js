/** Prevent a Meta configuration from overwriting an Evolution channel (or vice versa). */
export function findMatchingIntegration(existing, type, config) {
  if (type !== 'whatsapp') return existing[0] || null;
  if (config?.provider === 'evolution_api') {
    return existing.find(item => item.config?.provider === 'evolution_api'
      && item.config?.instance_name === config.instance_name
      && item.config?.provider_url === config.provider_url) || null;
  }
  if (config?.connection_mode === 'official') {
    return existing.find(item => item.config?.connection_mode === 'official'
      && item.config?.phone_number_id === config.phone_number_id) || null;
  }
  return null;
}
