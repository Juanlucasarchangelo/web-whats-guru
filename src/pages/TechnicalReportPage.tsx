import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Camera, CheckCircle2, ClipboardList, Download, FileDown, Images, Loader2, Plus, Share2, Trash2, Wrench } from 'lucide-react';
import { generateTechnicalPdf, type ReportPhoto, type ReportStatus } from '@/lib/technicalReportPdf';
import { newDocumentRequestId, saveTechnicalDocument } from '@/lib/technicalDocuments';

const operations = ['São Paulo', 'Rio de Janeiro', 'Brasília', 'Curitiba'];
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const uid = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
const inputClass = 'w-full rounded-xl border border-slate-300 bg-slate-100 px-3 py-2.5 text-slate-900 outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-400/20';
const labelClass = 'mb-1.5 block text-sm font-medium text-slate-700';
const buttonClass = 'inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 font-semibold transition disabled:cursor-not-allowed disabled:opacity-60';
type Photo = ReportPhoto & { id: string };
type Downloads = { reportUrl: string; pendingUrl: string; reportName: string; pendingName: string; reportBlob: Blob; pendingBlob: Blob };
type ShareableNavigator = Navigator & { canShare?: (data: ShareData) => boolean };
function downloadFile(url: string, name: string) {
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = name; anchor.rel = 'noopener';
  document.body.appendChild(anchor); anchor.click(); anchor.remove();
}
// Compartilhamento nativo exige HTTPS (ou localhost) e navegador com suporte a arquivos.
async function sharePdf(blob: Blob, name: string, title: string): Promise<'shared' | 'unsupported' | 'cancelled'> {
  const nav = navigator as ShareableNavigator;
  if (typeof nav.share !== 'function') return 'unsupported';
  const file = new File([blob], name, { type: 'application/pdf' });
  const payload: ShareData = { files: [file], title };
  if (nav.canShare && !nav.canShare(payload)) return 'unsupported';
  try { await nav.share(payload); return 'shared'; }
  catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return 'cancelled';
    return 'unsupported';
  }
}
function Section({ number, title, children }: { number: number; title: string; children: ReactNode }) {
  return <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
    <h2 className="mb-5 flex items-center gap-3 text-base font-bold text-slate-900"><span className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-400 text-sm font-extrabold text-zinc-900">{number}</span>{title}</h2>
    {children}
  </section>;
}
async function prepareImage(file: File): Promise<Omit<Photo, 'id'>> {
  // Safari antigo não oferece createImageBitmap; Image + object URL funciona em iOS e Android.
  const url = URL.createObjectURL(file);
  const img = new Image();
  try {
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve(); img.onerror = () => reject(new Error('Não foi possível abrir a foto.'));
      img.src = url;
    });
    const w = img.naturalWidth, h = img.naturalHeight;
    if (!w || !h) throw new Error('Fotografia inválida.');
    const scale = Math.min(1, 2200 / Math.max(w, h));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(w * scale)); canvas.height = Math.max(1, Math.round(h * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Não foi possível processar a fotografia.');
    context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(img, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.90);
    if (dataUrl.length > 12_000_000) throw new Error('Fotografia muito grande após processamento.');
    return { dataUrl, name: file.name || 'Foto da visita', width: canvas.width, height: canvas.height };
  } finally { URL.revokeObjectURL(url); }
}
export function TechnicalReportPage({ embedded = false }: { embedded?: boolean }) {
  const [cliente, setCliente] = useState('');
  const [numeroOdd, setNumeroOdd] = useState('');
  const requestId = useRef(newDocumentRequestId());
  const [data, setData] = useState(today);
  const [operacao, setOperacao] = useState('');
  const [endereco, setEndereco] = useState('');
  const [tecnicos, setTecnicos] = useState(['']);
  const [status, setStatus] = useState<ReportStatus>('');
  const [servico, setServico] = useState('');
  const [pendencias, setPendencias] = useState<string[]>([]);
  const [fotos, setFotos] = useState<Photo[]>([]);
  const [observacoes, setObservacoes] = useState('');
  const [working, setWorking] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [downloads, setDownloads] = useState<Downloads | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const downloadsRef = useRef<Downloads | null>(null);
  // Revogar URLs anteriores após novo download e quando a página for fechada.
  useEffect(() => () => { if (downloadsRef.current) { URL.revokeObjectURL(downloadsRef.current.reportUrl); URL.revokeObjectURL(downloadsRef.current.pendingUrl); } }, []);
  function clearPrevious() {
    if (downloadsRef.current) { URL.revokeObjectURL(downloadsRef.current.reportUrl); URL.revokeObjectURL(downloadsRef.current.pendingUrl); downloadsRef.current = null; }
    setDownloads(null);
  }
  const addPhotos = async (files: FileList | null) => {
    if (!files?.length) return;
    setNotice(null); requestId.current = newDocumentRequestId(); clearPrevious(); setWorking(true);
    const added: Photo[] = [];
    try {
      for (const file of Array.from(files).slice(0, Math.max(0, 10 - fotos.length))) {
        if (!file.type.startsWith('image/')) continue;
        try { added.push({ ...await prepareImage(file), id: uid() }); }
        catch { setNotice({ ok: false, text: `Não foi possível preparar ${file.name}. Use JPG, PNG ou WebP.` }); }
      }
      setFotos(prev => [...prev, ...added].slice(0, 10));
    } finally { setWorking(false); if (fileInput.current) fileInput.current.value = ''; if (cameraInput.current) cameraInput.current.value = ''; }
  };
  async function createPdfs() {
    if (!cliente.trim() || !data || !servico.trim()) {
      setNotice({ ok: false, text: 'Preencha cliente, data e descrição do serviço antes de exportar.' }); return;
    }
    setWorking(true); clearPrevious(); setNotice(null);
    try {
      const values = {
        cliente: cliente.trim(), numeroOdd: numeroOdd.trim(), data, operacao, endereco, tecnicos: tecnicos.map(x => x.trim()).filter(Boolean), status,
        servico: servico.trim(), pendencias: pendencias.map(x => x.trim()).filter(Boolean), observacoes, fotos: fotos.map(({ dataUrl, name, width, height }) => ({ dataUrl, name, width, height }))
      };
      const saved = await saveTechnicalDocument('technical_report', values, requestId.current, !embedded);
      const reportBlob = generateTechnicalPdf(values, true);
      const pendingBlob = generateTechnicalPdf(values, false);
      const [year, month, day] = data.split('-');
      const dateLabel = year && month && day ? `${day}-${month}-${year}` : data;
      const clienteLabel = cliente.normalize('NFC').replace(/[\\/:*?"<>|\x00-\x1f]/g, '').trim().replace(/\s+/g, ' ').slice(0, 75) || 'Cliente';
      const next = {
        reportUrl: URL.createObjectURL(reportBlob), pendingUrl: URL.createObjectURL(pendingBlob),
        reportName: `${dateLabel} - ${clienteLabel} - Relatório técnico completo.pdf`, pendingName: `${dateLabel} - ${clienteLabel} - Relatório técnico sem pendências.pdf`, reportBlob, pendingBlob
      };
      downloadsRef.current = next; setDownloads(next);
      setNotice({ ok: true, text: `Relatório ${String(saved.document_number).padStart(3, '0')} salvo no Monitoramento. Os dois PDFs estão prontos para baixar ou compartilhar.` });
    } catch (error) { setNotice({ ok: false, text: error instanceof Error ? error.message : 'Não foi possível gerar os PDFs.' }); }
    finally { setWorking(false); }
  }
  const dirty = () => { requestId.current = newDocumentRequestId(); if (downloadsRef.current) clearPrevious(); };
  async function handleShare(kind: 'report' | 'pending') {
    const current = downloadsRef.current;
    if (!current) return;
    const isReport = kind === 'report';
    const blob = isReport ? current.reportBlob : current.pendingBlob;
    const name = isReport ? current.reportName : current.pendingName;
    const outcome = await sharePdf(blob, name, isReport ? 'Relatório Técnico Completo' : 'Relatório Técnico Sem Pendências');
    if (outcome === 'unsupported') {
      setNotice({ ok: false, text: 'O compartilhamento direto de PDF não está disponível neste navegador ou endereço. Use HTTPS no celular ou toque em Baixar PDF para enviá-lo pelo WhatsApp/Arquivos.' });
    }
  }
  return <div className={`${embedded ? 'min-h-full' : 'min-h-screen'} bg-slate-100 text-slate-900`} style={{ colorScheme: 'light' }}>
    {!embedded && <header className="border-b border-slate-200 bg-zinc-900 text-white"><div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-5 sm:px-6">
      <div className="flex items-center gap-3"><span className="rounded-xl bg-amber-400 p-2 text-zinc-900"><Wrench size={24} /></span><div><div className="text-xl font-black tracking-tight">FalaComigo</div><div className="text-xs text-zinc-300">Relatório Técnico · ImportsBR</div></div></div>
      <span className="rounded-full border border-zinc-600 px-3 py-1 text-xs font-medium">Acesso público</span>
    </div></header>}
    <main className="mx-auto max-w-4xl space-y-5 px-4 py-8 sm:px-6">
      <div className="mb-6"><div className="flex items-center gap-2 text-amber-700"><ClipboardList size={20} /><span className="text-sm font-bold uppercase tracking-wider">Documento de campo</span></div>
        <h1 className="mt-1 text-3xl font-extrabold tracking-tight">Relatório Técnico</h1>
        <p className="mt-1 text-sm text-slate-600">Preencha a visita e gere dois PDFs: um relatório técnico completo (incluindo pendências) e outro com todas as informações, exceto as pendências. Os dados do formulário são registrados para monitoramento.</p>
      </div>
      <Section number={1} title="Identificação"><div className="grid gap-4 sm:grid-cols-2">
        <div><label className={labelClass}>Cliente *</label><input className={inputClass} value={cliente} maxLength={120} onChange={e => { dirty(); setCliente(e.target.value); }} placeholder="Nome do cliente" /></div>
        <div><label className={labelClass}>Data *</label><input type="date" className={inputClass} value={data} onChange={e => { dirty(); setData(e.target.value); }} /></div>
        <div><label className={labelClass}>Operação</label><select className={inputClass} value={operacao} onChange={e => { dirty(); setOperacao(e.target.value); }}><option value="">Selecione</option>{operations.map(x => <option key={x}>{x}</option>)}</select></div>
        <div><label className={labelClass}>Número ODD (opcional)</label><input className={inputClass} maxLength={120} value={numeroOdd} onChange={e => { dirty(); setNumeroOdd(e.target.value); }} placeholder="Ex.: 001" /></div>
        <div><label className={labelClass}>Endereço</label><input className={inputClass} value={endereco} onChange={e => { dirty(); setEndereco(e.target.value); }} placeholder="Endereço completo" /></div>
      </div></Section>
      <Section number={2} title="Técnicos em campo"><div className="space-y-3">{tecnicos.map((nome, i) => <div key={i} className="flex gap-2"><input className={inputClass} value={nome} onChange={e => { dirty(); setTecnicos(prev => prev.map((x, j) => i === j ? e.target.value : x)); }} placeholder="Nome do técnico" /><button type="button" aria-label="Remover técnico" className="rounded-lg p-2 text-red-600 hover:bg-red-50" onClick={() => { dirty(); setTecnicos(prev => prev.length === 1 ? [''] : prev.filter((_, j) => j !== i)); }}><Trash2 size={19} /></button></div>)}</div>
        <button type="button" className={`${buttonClass} mt-3 border border-slate-300 text-sm hover:bg-slate-100`} onClick={() => { dirty(); setTecnicos(prev => [...prev, '']); }}><Plus size={16} /> Adicionar técnico</button>
      </Section>
      <Section number={3} title="Serviço executado"><label className={labelClass}>Status do serviço</label><div className="mb-5 flex flex-wrap gap-2">{([['concluido', 'Concluído'], ['parcial', 'Parcial'], ['pendente', 'Pendente']] as const).map(([key, title]) => <button type="button" key={key} onClick={() => { dirty(); setStatus(key); }} className={`${buttonClass} border text-sm ${status === key ? 'border-amber-400 bg-amber-400 text-zinc-900' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-100'}`}>{title}</button>)}</div>
        <label className={labelClass}>Descrição do serviço realizado *</label><textarea className={inputClass} rows={5} maxLength={10000} value={servico} onChange={e => { dirty(); setServico(e.target.value); }} placeholder="Instalação, configuração, testes, ajustes..." />
      </Section>
      <Section number={4} title="Pendências"><p className="mb-3 text-sm text-slate-500">Estas informações aparecerão no relatório técnico completo, mas não no relatório sem pendências.</p><div className="space-y-3">{pendencias.length === 0 && <p className="text-sm text-slate-500">Nenhuma pendência registrada.</p>}{pendencias.map((pend, i) => <div key={i} className="flex gap-2"><textarea className={inputClass} rows={2} value={pend} onChange={e => { dirty(); setPendencias(prev => prev.map((x, j) => i === j ? e.target.value : x)); }} placeholder="Descreva a pendência" /><button type="button" aria-label="Remover pendência" className="self-start rounded-lg p-2 text-red-600 hover:bg-red-50" onClick={() => { dirty(); setPendencias(prev => prev.filter((_, j) => j !== i)); }}><Trash2 size={19} /></button></div>)}</div>
        <button type="button" className={`${buttonClass} mt-3 border border-slate-300 text-sm hover:bg-slate-100`} onClick={() => { dirty(); setPendencias(prev => [...prev, '']); }}><Plus size={16} /> Adicionar pendência</button>
      </Section>
      <Section number={5} title="Registro fotográfico"><p className="mb-3 text-sm text-slate-500">Cada fotografia terá uma área grande no PDF, sem corte, para permitir inspecionar detalhes.</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">{fotos.map(photo => <div key={photo.id} className="relative overflow-hidden rounded-xl border border-slate-200 bg-slate-50"><img className="aspect-square w-full object-contain" src={photo.dataUrl} alt={photo.name} /><button type="button" aria-label="Remover fotografia" onClick={() => { dirty(); setFotos(prev => prev.filter(x => x.id !== photo.id)); }} className="absolute right-2 top-2 rounded-full bg-red-600 p-1.5 text-white"><Trash2 size={16} /></button><div className="truncate px-2 py-1 text-xs text-slate-600">{photo.name}</div></div>)}</div>
        {fotos.length === 0 && <p className="text-sm text-slate-500">Nenhuma foto adicionada.</p>}
        <input ref={cameraInput} type="file" accept="image/*" capture="environment" className="hidden" onChange={e => void addPhotos(e.target.files)} />
        <input ref={fileInput} type="file" accept="image/*" multiple className="hidden" onChange={e => void addPhotos(e.target.files)} />
        <div className="mt-4 flex flex-wrap gap-3">
          <button type="button" disabled={fotos.length >= 10 || working} className={`${buttonClass} border border-amber-400 bg-amber-50 text-sm text-slate-900 hover:bg-amber-100`} onClick={() => cameraInput.current?.click()}><Camera size={17} /> Tirar foto agora</button>
          <button type="button" disabled={fotos.length >= 10 || working} className={`${buttonClass} border border-slate-300 text-sm hover:bg-slate-100`} onClick={() => fileInput.current?.click()}><Images size={17} /> Escolher fotos ({fotos.length}/10)</button>
        </div>
        <p className="mt-2 text-xs text-slate-500">No celular, “Tirar foto agora” solicita a câmera traseira quando o navegador permite. Você também pode selecionar fotos já existentes.</p>
      </Section>
      <Section number={6} title="Observações"><label className={labelClass}>Observações gerais</label><textarea className={inputClass} rows={4} maxLength={10000} value={observacoes} onChange={e => { dirty(); setObservacoes(e.target.value); }} placeholder="Informações adicionais, condições do local, recomendações..." /></Section>
      {notice && <div role="status" className={`rounded-xl border px-4 py-3 text-sm font-medium ${notice.ok ? 'border-green-300 bg-green-50 text-green-800' : 'border-red-300 bg-red-50 text-red-800'}`}>{notice.ok && <CheckCircle2 size={18} className="mr-2 inline" />}{notice.text}</div>}
      <div className="flex justify-end"><button type="button" disabled={working} onClick={createPdfs} className={`${buttonClass} bg-amber-400 text-zinc-900 hover:bg-amber-300`}>{working ? <Loader2 size={18} className="animate-spin" /> : <FileDown size={18} />} {working ? 'Processando...' : 'Exportar dois PDFs'}</button></div>
      {downloads && <div className="space-y-4 rounded-2xl border border-green-200 bg-white p-5 sm:p-6"><div className="flex items-center gap-2 font-semibold text-green-800"><CheckCircle2 size={20} /> Dois documentos prontos</div>
        <p className="text-sm text-slate-600">Compartilhe cada PDF diretamente com WhatsApp ou outros aplicativos, sem sair desta tela. Os dois permanecem disponíveis abaixo.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2 rounded-xl border border-slate-200 p-3"><div className="text-sm font-bold">Relatório técnico completo</div>
            <button type="button" onClick={() => void handleShare('report')} className={`${buttonClass} w-full bg-amber-400 text-zinc-900 hover:bg-amber-300`}><Share2 size={18} /> Compartilhar relatório</button>
            <button type="button" onClick={() => downloadFile(downloads.reportUrl, downloads.reportName)} className={`${buttonClass} w-full border border-slate-300 bg-slate-50 text-slate-900 hover:bg-slate-100`}><Download size={18} /> Baixar PDF</button></div>
          <div className="space-y-2 rounded-xl border border-slate-200 p-3"><div className="text-sm font-bold">Relatório técnico sem pendências</div>
            <button type="button" onClick={() => void handleShare('pending')} className={`${buttonClass} w-full bg-amber-400 text-zinc-900 hover:bg-amber-300`}><Share2 size={18} /> Compartilhar sem pendências</button>
            <button type="button" onClick={() => downloadFile(downloads.pendingUrl, downloads.pendingName)} className={`${buttonClass} w-full border border-slate-300 bg-slate-50 text-slate-900 hover:bg-slate-100`}><Download size={18} /> Baixar PDF</button></div>
        </div>
        <p className="text-xs text-slate-500">Compartilhamento nativo depende de HTTPS e do suporte do navegador. Em caso de incompatibilidade, use Baixar PDF. Não são criados links públicos permanentes.</p>
      </div>}
      <p className="pb-5 text-center text-xs text-slate-500">ImportsBR · Relatórios gerados localmente no navegador, sem armazenamento no NAS</p>
    </main>
  </div>;
}
