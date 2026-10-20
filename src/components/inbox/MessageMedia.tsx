import { useCallback, useEffect, useRef, useState } from 'react';
import { FileText, Image as ImageIcon, Video, Mic, Download, LoaderCircle, AlertCircle, MapPin, ExternalLink } from 'lucide-react';
import { apiBlob } from '@/lib/api';
import type { Message } from '@/types';

/** Preview autenticado. A URL blob: vive apenas nesta aba e e revogada no unmount. */
export function MessageMedia({ message }: { message: Message }) {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const anchor = useRef<HTMLDivElement>(null);
  const urlRef = useRef<string | null>(null);
  const busy = useRef(false);
  const kind = message.media_type;
  const isImage = kind === 'image' || kind === 'sticker';
  const location = kind === 'location' ? message.media_location : null;
  const load = useCallback(async () => {
    if (busy.current || urlRef.current) return;
    busy.current = true;
    setLoading(true);
    setError(false);
    try {
      const blob = await apiBlob(`/conversations/${message.conversation_id}/messages/${message.id}/media`);
      const objectUrl = URL.createObjectURL(blob);
      urlRef.current = objectUrl;
      setUrl(objectUrl);
    } catch {
      setError(true);
    } finally {
      busy.current = false;
      setLoading(false);
    }
  }, [message.conversation_id, message.id]);
  useEffect(() => {
    const node = anchor.current;
    if (!node || !isImage || !('IntersectionObserver' in window)) return;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(e => e.isIntersecting)) { void load(); observer.disconnect(); }
    }, { rootMargin: '200px' });
    observer.observe(node);
    return () => observer.disconnect();
  }, [isImage, load]);
  useEffect(() => () => { if (urlRef.current) URL.revokeObjectURL(urlRef.current); }, []);
  if (!kind) return null;
  if (kind === 'location') {
    if (!location) return <p className="text-sm">Localização recebida (coordenadas indisponíveis).</p>;
    const mapsUrl = `https://www.google.com/maps?q=${encodeURIComponent(`${location.latitude},${location.longitude}`)}`;
    return (
      <div className="my-2 min-w-[180px] max-w-[320px] rounded-lg border border-current/20 p-3" data-media-kind="location">
        <div className="flex items-center gap-2 font-medium text-sm"><MapPin size={18} /> {location.live ? 'Localização em tempo real (registro recebido)' : 'Localização'}</div>
        {location.name && <p className="text-sm mt-2 font-medium break-words">{location.name}</p>}
        {location.address && <p className="text-xs mt-1 break-words opacity-80">{location.address}</p>}
        <a href={mapsUrl} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex items-center gap-1 underline text-sm">
          <ExternalLink size={14} /> Abrir no Google Maps
        </a>
      </div>
    );
  }
  const label = ({image:'Imagem',sticker:'Figurinha',video:'Vídeo',audio:'Áudio',document:'Documento'})[kind];
  const Icon = kind === 'image' || kind === 'sticker' ? ImageIcon : kind === 'video' ? Video : kind === 'audio' ? Mic : FileText;
  return (
    <div ref={anchor} className="my-2 min-w-[180px] max-w-[320px]" data-media-kind={kind}>
      {url && isImage && <img src={url} alt={message.media_name || label} className="rounded-lg max-h-72 max-w-full object-contain" loading="lazy" />}
      {url && kind === 'audio' && <audio src={url} controls preload="metadata" className="max-w-full" />}
      {url && kind === 'video' && <video src={url} controls preload="metadata" className="rounded-lg max-h-72 max-w-full" />}
      {url && kind === 'document' && (
        <div className="flex flex-col gap-2">
          {message.media_mime === 'application/pdf' && (
            <a href={url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 underline break-all">
              <FileText size={17} /> Visualizar PDF
            </a>
          )}
          <a href={url} download={message.media_name || (message.media_mime === 'application/pdf' ? 'documento.pdf' : 'arquivo')} className="flex items-center gap-2 underline break-all">
            <Download size={17} /> Baixar {message.media_name || 'documento'}
          </a>
        </div>
      )}
      {!url && (
        <button type="button" onClick={() => void load()} disabled={loading}
          className="flex items-center gap-2 rounded-lg border border-current/20 p-2 text-left text-sm hover:opacity-80 disabled:opacity-60">
          {loading ? <LoaderCircle size={18} className="animate-spin" /> : <Icon size={18} />}
          <span>{loading ? 'Carregando mídia…' : error ? `Tentar novamente: ${label}` : `Abrir ${label.toLowerCase()}`}</span>
        </button>
      )}
      {error && <p className="flex items-center gap-1 mt-1 text-xs text-amber-700"><AlertCircle size={13} /> Mídia indisponível na Evolution. O armazenamento QNAP será configurado na próxima etapa.</p>}
      {message.media_name && kind !== 'document' && <p className="text-xs opacity-70 break-all mt-1">{message.media_name}</p>}
    </div>
  );
}
