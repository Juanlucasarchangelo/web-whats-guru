import { useEffect, useRef, useState, type ReactNode } from 'react';
import { CalendarDays, CheckCircle2, ClipboardList, Download, FileDown, Loader2, Plus, Share2, Trash2, Wrench } from 'lucide-react';
import { generateOddPdf, type OddData, type OddTechnician } from '@/lib/technicalReportPdf';

const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const inputClass = 'w-full rounded-xl border border-slate-300 bg-slate-100 px-3 py-2.5 text-slate-900 outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-400/20';
const labelClass = 'mb-1.5 block text-sm font-medium text-slate-700';
const buttonClass = 'inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 font-semibold transition disabled:cursor-not-allowed disabled:opacity-60';
function Section({ number, title, children }: { number: number; title: string; children: ReactNode }) {
  return <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
    <h2 className="mb-5 flex items-center gap-3 text-base font-bold text-slate-900"><span className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-400 text-sm font-extrabold text-zinc-900">{number}</span>{title}</h2>
    {children}
  </section>;
}
function cleanFilename(value: string) { return (value.normalize('NFC').replace(/[\\/:*?"<>|\x00-\x1f]/g, '').trim().replace(/\s+/g, ' ').slice(0, 75) || 'Cliente'); }
function dateFilename(value: string) { const [y, m, d] = value.split('-'); return y && m && d ? `${d}-${m}-${y}` : value; }
function downloadPdf(blobUrl: string, name: string) { const a = document.createElement('a'); a.href = blobUrl; a.download = name; document.body.appendChild(a); a.click(); a.remove(); }
async function sharePdf(blob: Blob, name: string): Promise<'done' | 'cancelled' | 'unsupported'> {
  if (typeof navigator.share !== 'function') return 'unsupported';
  const file = new File([blob], name, { type: 'application/pdf' });
  const payload: ShareData = { files: [file], title: 'Ordem do Dia — ImportsBR' };
  if (navigator.canShare && !navigator.canShare(payload)) return 'unsupported';
  try { await navigator.share(payload); return 'done'; }
  catch (e) { return e instanceof DOMException && e.name === 'AbortError' ? 'cancelled' : 'unsupported'; }
}

type Generated = { blob: Blob; url: string; name: string };
export function OrderOfDayPage({ embedded = false }: { embedded?: boolean }) {
  const [coordenador, setCoordenador] = useState('');
  const [data, setData] = useState(today);
  const [cliente, setCliente] = useState('');
  const [endereco, setEndereco] = useState('');
  const [tecnicos, setTecnicos] = useState<OddTechnician[]>([{ nome: '', funcao: '' }]);
  const [objetivos, setObjetivos] = useState<string[]>(['']);
  const [observacoes, setObservacoes] = useState('');
  const [generated, setGenerated] = useState<Generated | null>(null);
  const generatedRef = useRef<Generated | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; message: string } | null>(null);
  useEffect(() => () => { if (generatedRef.current) URL.revokeObjectURL(generatedRef.current.url); }, []);
  function invalidate() { if (generatedRef.current) { URL.revokeObjectURL(generatedRef.current.url); generatedRef.current = null; setGenerated(null); } }
  function create() {
    if (!coordenador.trim() || !cliente.trim() || !data || !endereco.trim()) {
      setNotice({ ok: false, message: 'Preencha coordenador, data, cliente e endereço antes de gerar o PDF.' }); return;
    }
    setBusy(true); setNotice(null); invalidate();
    try {
      const values: OddData = {
        coordenador: coordenador.trim(), data, cliente: cliente.trim(), endereco: endereco.trim(),
        tecnicos: tecnicos.map(t => ({ nome: t.nome.trim(), funcao: t.funcao.trim() })).filter(t => t.nome || t.funcao),
        objetivos: objetivos.map(o => o.trim()).filter(Boolean), observacoes: observacoes.trim()
      };
      const blob = generateOddPdf(values);
      const next = { blob, url: URL.createObjectURL(blob), name: `${dateFilename(data)} - ${cleanFilename(cliente)} - ODD.pdf` };
      generatedRef.current = next; setGenerated(next);
      setNotice({ ok: true, message: 'PDF gerado. Você pode baixá-lo ou compartilhá-lo sem sair desta tela.' });
    } catch (e) { setNotice({ ok: false, message: e instanceof Error ? e.message : 'Não foi possível gerar o PDF.' }); }
    finally { setBusy(false); }
  }
  async function share() {
    if (!generatedRef.current) return;
    const result = await sharePdf(generatedRef.current.blob, generatedRef.current.name);
    if (result === 'unsupported') setNotice({ ok: false, message: 'Compartilhamento direto indisponível. Abra a página em HTTPS no celular ou baixe o PDF e compartilhe pelo aplicativo Arquivos/WhatsApp.' });
  }
  return <div className={`${embedded ? 'min-h-full' : 'min-h-screen'} bg-slate-100 text-slate-900`} style={{ colorScheme: 'light' }}>
    {!embedded && <header className="border-b border-slate-200 bg-zinc-900 text-white"><div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-5 sm:px-6">
      <div className="flex items-center gap-3"><span className="rounded-xl bg-amber-400 p-2 text-zinc-900"><Wrench size={24} /></span><div><div className="text-xl font-black tracking-tight">FalaComigo</div><div className="text-xs text-zinc-300">Área técnica · ImportsBR</div></div></div>
      <span className="rounded-full border border-zinc-600 px-3 py-1 text-xs font-medium">Acesso público</span>
    </div></header>}
    <main className="mx-auto max-w-4xl space-y-5 px-4 py-8 sm:px-6">
      <div className="mb-6"><div className="flex items-center gap-2 text-amber-700"><CalendarDays size={20} /><span className="text-sm font-bold uppercase tracking-wider">Documento de campo</span></div>
        <h1 className="mt-1 text-3xl font-extrabold tracking-tight">Ordem do Dia (ODD)</h1>
        <p className="mt-1 text-sm text-slate-600">Organize a visita técnica, a equipe e os objetivos da obra. Gere um único PDF para compartilhar. Nenhum dado é enviado ao servidor.</p>
      </div>
      <Section number={1} title="Dados gerais"><div className="grid gap-4 sm:grid-cols-2">
        <div><label className={labelClass} htmlFor="odd-coordenador">Coordenador técnico *</label><input id="odd-coordenador" className={inputClass} maxLength={120} placeholder="Nome completo" value={coordenador} onChange={e => { invalidate(); setCoordenador(e.target.value); }} /></div>
        <div><label className={labelClass} htmlFor="odd-data">Data *</label><input id="odd-data" type="date" className={inputClass} value={data} onChange={e => { invalidate(); setData(e.target.value); }} /></div>
        <div><label className={labelClass} htmlFor="odd-cliente">Cliente *</label><input id="odd-cliente" className={inputClass} maxLength={120} placeholder="Nome do cliente" value={cliente} onChange={e => { invalidate(); setCliente(e.target.value); }} /></div>
        <div><label className={labelClass} htmlFor="odd-endereco">Endereço da obra *</label><input id="odd-endereco" className={inputClass} maxLength={500} placeholder="Rua, número, cidade, ponto de referência" value={endereco} onChange={e => { invalidate(); setEndereco(e.target.value); }} /></div>
      </div></Section>
      <Section number={2} title="Técnicos em visita"><div className="space-y-3">{tecnicos.map((tech, i) => <div key={i} className="rounded-xl border border-slate-200 bg-slate-50 p-3 sm:p-4">
        <div className="mb-2 flex items-center justify-between"><span className="text-xs font-bold uppercase tracking-widest text-slate-500">Técnico {String(i + 1).padStart(2, '0')}</span><button type="button" aria-label={`Remover técnico ${i + 1}`} className="rounded-lg p-2 text-red-600 hover:bg-red-50" onClick={() => { invalidate(); setTecnicos(prev => prev.length === 1 ? [{ nome: '', funcao: '' }] : prev.filter((_, j) => j !== i)); }}><Trash2 size={18} /></button></div>
        <div className="grid gap-3 sm:grid-cols-2"><div><label className={labelClass}>Nome</label><input className={inputClass} maxLength={120} placeholder="Nome do técnico" value={tech.nome} onChange={e => { invalidate(); setTecnicos(prev => prev.map((x, j) => i === j ? { ...x, nome: e.target.value } : x)); }} /></div>
          <div><label className={labelClass}>Especialidade / Função</label><input className={inputClass} maxLength={120} placeholder="Ex.: automação, áudio, instalação" value={tech.funcao} onChange={e => { invalidate(); setTecnicos(prev => prev.map((x, j) => i === j ? { ...x, funcao: e.target.value } : x)); }} /></div></div>
      </div>)}</div>
        <button type="button" className={`${buttonClass} mt-3 border border-slate-300 text-sm hover:bg-slate-100`} onClick={() => { invalidate(); setTecnicos(prev => [...prev, { nome: '', funcao: '' }]); }}><Plus size={16} /> Adicionar técnico</button>
      </Section>
      <Section number={3} title="Objetivo do dia"><div className="space-y-3">{objetivos.map((obj, i) => <div key={i} className="flex items-start gap-2"><span className="mt-3 min-w-7 text-xs font-bold text-slate-500">{String(i + 1).padStart(2, '0')}</span><textarea className={inputClass} rows={2} maxLength={2000} placeholder="Descreva o objetivo do dia" value={obj} onChange={e => { invalidate(); setObjetivos(prev => prev.map((x, j) => i === j ? e.target.value : x)); }} /><button type="button" className="rounded-lg p-2 text-red-600 hover:bg-red-50" aria-label={`Remover objetivo ${i + 1}`} onClick={() => { invalidate(); setObjetivos(prev => prev.length === 1 ? [''] : prev.filter((_, j) => j !== i)); }}><Trash2 size={18} /></button></div>)}</div>
        <button type="button" className={`${buttonClass} mt-3 border border-slate-300 text-sm hover:bg-slate-100`} onClick={() => { invalidate(); setObjetivos(prev => [...prev, '']); }}><Plus size={16} /> Adicionar objetivo</button>
      </Section>
      <Section number={4} title="Observações gerais"><label className={labelClass} htmlFor="odd-observacoes">Observações gerais</label><textarea id="odd-observacoes" className={inputClass} rows={4} maxLength={10000} placeholder="Outras instruções ou pontos de atenção na obra" value={observacoes} onChange={e => { invalidate(); setObservacoes(e.target.value); }} /></Section>
      {notice && <div role="status" className={`rounded-xl border px-4 py-3 text-sm font-medium ${notice.ok ? 'border-green-300 bg-green-50 text-green-800' : 'border-red-300 bg-red-50 text-red-800'}`}>{notice.ok && <CheckCircle2 size={18} className="mr-2 inline" />}{notice.message}</div>}
      <div className="flex justify-end"><button type="button" disabled={busy} onClick={create} className={`${buttonClass} bg-amber-400 text-zinc-900 hover:bg-amber-300`}>{busy ? <Loader2 size={18} className="animate-spin" /> : <FileDown size={18} />} Gerar PDF da ODD</button></div>
      {generated && <div className="rounded-2xl border border-green-200 bg-white p-5 sm:p-6"><div className="mb-2 flex items-center gap-2 font-semibold text-green-800"><CheckCircle2 size={20} /> Ordem do Dia pronta</div><p className="mb-3 break-words text-sm text-slate-600">{generated.name}</p>
        <div className="flex flex-col gap-3 sm:flex-row"><button type="button" className={`${buttonClass} bg-amber-400 text-zinc-900 hover:bg-amber-300`} onClick={() => void share()}><Share2 size={18} /> Compartilhar PDF</button>
          <button type="button" className={`${buttonClass} border border-slate-300 bg-slate-50 text-slate-900 hover:bg-slate-100`} onClick={() => downloadPdf(generated.url, generated.name)}><Download size={18} /> Baixar PDF</button></div>
        <p className="mt-3 text-xs text-slate-500">O compartilhamento direto exige HTTPS e suporte do navegador. O PDF permanece disponível após o compartilhamento.</p>
      </div>}
      <p className="pb-5 text-center text-xs text-slate-500"><ClipboardList size={13} className="mr-1 inline" /> ImportsBR · Documentos produzidos localmente no navegador</p>
    </main>
  </div>;
}
