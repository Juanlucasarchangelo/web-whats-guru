/** Classificacao de anexos e localizacoes Evolution/Baileys. */
const supported = [
  ['image', 'imageMessage'], ['video', 'videoMessage'],
  ['audio', 'audioMessage'], ['document', 'documentMessage'],
  ['sticker', 'stickerMessage'], ['location', 'locationMessage'],
  ['location', 'liveLocationMessage'],
];
export function unwrapMessage(item) {
  let m = item?.message ?? item?.data?.message ?? {};
  for (let i = 0; i < 8; i++) {
    const nested = m?.ephemeralMessage?.message ?? m?.viewOnceMessage?.message ??
      m?.viewOnceMessageV2?.message ?? m?.viewOnceMessageV2Extension?.message ??
      m?.documentWithCaptionMessage?.message ?? m?.editedMessage?.message ??
      m?.associatedChildMessage?.message;
    if (!nested || nested === m) break;
    m = nested;
  }
  return m;
}
const finiteCoordinate = (value, min, max) => {
  const n = Number(value);
  return value !== null && value !== undefined && value !== '' && Number.isFinite(n) && n >= min && n <= max ? n : null;
};
export function identifyEvolutionMedia(item) {
  const message = unwrapMessage(item);
  const found = supported.find(([, key]) => message?.[key] && typeof message[key] === 'object');
  if (!found) return null;
  const [type, key] = found;
  const media = message[key];
  if (type === 'location') {
    const latitude = finiteCoordinate(media.degreesLatitude, -90, 90);
    const longitude = finiteCoordinate(media.degreesLongitude, -180, 180);
    if (latitude === null || longitude === null) return null;
    const name = typeof media.name === 'string' ? media.name.slice(0, 255) : '';
    const address = typeof media.address === 'string' ? media.address.slice(0, 500) : '';
    // Apenas dados publicos da localizacao; nao armazenar thumbnails nem links externos do provedor.
    return {
      type, mime: null, name: name || null, size: null,
      message: { location: { latitude, longitude, name, address, live: key === 'liveLocationMessage' } },
      caption: ''
    };
  }
  let mime = typeof media.mimetype === 'string' ? media.mimetype.split(';')[0].trim().toLowerCase().slice(0, 191) : null;
  const name = typeof media.fileName === 'string' ? media.fileName.slice(0, 255) : null;
  if (type === 'document' && /\.pdf$/i.test(name || '') && (!mime || mime === 'application/octet-stream')) mime = 'application/pdf';
  const rawSize = media.fileLength;
  const size = Number(rawSize?.low ?? rawSize);
  // Mantem os metadados originais necessarios para descriptografar o arquivo na Evolution.
  const safe = Object.fromEntries(Object.entries(media).filter(([k]) => !['base64', 'jpegThumbnail'].includes(k)));
  const providerKey = item?.key ?? item?.data?.key ?? {};
  const serialized = JSON.stringify({ key: { id: String(providerKey.id ?? ''), remoteJid: String(providerKey.remoteJid ?? ''), fromMe: Boolean(providerKey.fromMe) }, message: { [key]: safe } });
  return {
    type, mime, name,
    size: Number.isSafeInteger(size) && size >= 0 && size <= 2147483647 ? size : null,
    message: serialized.length <= 16000 ? JSON.parse(serialized) : null,
    caption: typeof media.caption === 'string' ? media.caption.slice(0, 10000) : '',
  };
}
export function mediaLabel(type) {
  return ({ image: 'Imagem', video: 'Vídeo', audio: 'Áudio', document: 'Documento', sticker: 'Figurinha', location: 'Localização' })[type] ?? 'Arquivo';
}
export function publicLocation(mediaMessage) {
  const location = mediaMessage?.location;
  if (!location) return null;
  const latitude = finiteCoordinate(location.latitude, -90, 90);
  const longitude = finiteCoordinate(location.longitude, -180, 180);
  if (latitude === null || longitude === null) return null;
  return {
    latitude, longitude, name: String(location.name || '').slice(0, 255),
    address: String(location.address || '').slice(0, 500), live: Boolean(location.live)
  };
}
