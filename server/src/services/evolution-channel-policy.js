// Parses the QR variants returned by different Evolution API v2 releases.
// No third-party requests, credentials, session tokens or secret URLs are exposed.
function imageData(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  if (/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/i.test(value)) return value;
  const clean = value.trim().replace(/\s/g, '');
  if (/^[A-Za-z0-9+/=]+$/.test(clean) && clean.length > 100) return `data:image/png;base64,${clean}`;
  return null;
}

export function parseEvolutionConnectionResponse(payload) {
  const data = payload?.data ?? payload;
  const qr = data?.qrcode ?? data?.qrCode ?? {};
  const embedded = [data?.base64, qr?.base64, data?.qr_code, qr?.image, data?.image].map(imageData).find(Boolean) || null;
  const raw = [data?.code, qr?.code, data?.qr, data?.qrcode].find(value => typeof value === 'string' && value.trim().length > 10) || null;
  const pairing = data?.pairingCode || data?.pairing_code || qr?.pairingCode || null;
  return { image: embedded, qrText: embedded ? null : raw, pairingCode: typeof pairing === 'string' ? pairing : null };
}
