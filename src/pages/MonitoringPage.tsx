import { useCallback, useEffect, useRef, useState } from 'react';
import { useOrg } from '@/contexts/OrgContext';
import { ClipboardList, FileText, Download, RefreshCw, Search, UserRound, ShieldCheck, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import { apiRequest } from '@/lib/api';
import { generateOddPdf, generateTechnicalPdf, type OddData, type TechnicalReportData } from '@/lib/technicalReportPdf';
import { cleanTechnicalFilename, technicalDateFilename, formatDocumentNumber, type DocumentKind, type DocumentList, type DocumentDetail, type DocumentSummary } from '@/lib/technicalDocuments';

function pdfDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  // O navegador ainda pode estar lendo o objeto após o clique.
  window.setTimeout(() => URL.revokeObjectURL(url), 60000);
}
function dateBR(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const [y,m,d] = value.split('-'); return `${d}/${m}/${y}`;
}
function typeTitle(type: DocumentKind) { return type === 'odd' ? 'Ordens do Dia' : 'Relatórios técnicos'; }

export function MonitoringPage() {
  const { currentOrg } = useOrg();
  const requestSequence = useRef(0);
  const [kind, setKind] = useState<DocumentKind>('odd');
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<DocumentList | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState('');
  const load = useCallback(async () => {
    const sequence = ++requestSequence.current;
    setLoading(true); setError(''); setResult(null);
    try {
      const data = await apiRequest<DocumentList>(`/technical-documents?type=${kind}&page=${page}&limit=25&q=${encodeURIComponent(search)}`);
      if (sequence === requestSequence.current) setResult(data);
    } catch (e) {
      if (sequence === requestSequence.current) {
        setError(e instanceof Error ? e.message : 'Falha ao carregar documentos.'); setResult(null);
      }
    } finally { if (sequence === requestSequence.current) setLoading(false); }
  }, [kind, page, search, currentOrg?.id]);
  useEffect(() => { void load(); }, [load]);

  const switchKind = (next: DocumentKind) => {
    setKind(next); setPage(1); setSearch(''); setQuery(''); setResult(null);
  };

  async function regenerate(record: DocumentSummary, variant: 'odd' | 'complete' | 'without') {
    setBusyId(`${record.id}-${variant}`); setError('');
    try {
      // Consulta completa é autenticada e verificada na API para a empresa corrente.
      const details = await apiRequest<DocumentDetail>(`/technical-documents/${record.id}`);
      const base = `${technicalDateFilename(details.document_date)} - ${cleanTechnicalFilename(details.client_name)}`;
      if (details.doc_type === 'odd') {
        pdfDownload(generateOddPdf(details.payload as OddData), `${base} - ODD.pdf`);
      } else {
        const full = variant === 'complete';
        pdfDownload(generateTechnicalPdf(details.payload as TechnicalReportData, full),
          `${base} - Relatório técnico ${full ? 'completo' : 'sem pendências'}.pdf`);
      }
    } catch (e) { setError(e instanceof Error ? e.message : 'Não foi possível reconstruir o PDF.'); }
    finally { setBusyId(''); }
  }
  return (
    <div className="mx-auto max-w-7xl space-y-6 p-4 lg:p-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="mb-2 flex items-center gap-2 text-xs font-mono uppercase tracking-widest text-slate-500"><ShieldCheck size={16} /> Área restrita · Gestão técnica</div>
          <h1 className="text-[32px] font-light text-slate-900">Monitoramento</h1>
          <p className="mt-2 text-sm text-slate-500">Histórico de ODDs e relatórios técnicos salvos por sua empresa. Os formulários públicos não têm acesso a esta página.</p>
        </div>
        <button type="button" className="btn-secondary" disabled={loading} onClick={() => void load()} aria-label="Atualizar documentos">
          <RefreshCw size={16} /> Atualizar
        </button>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2" role="tablist" aria-label="Tipo de documento">
        <button type="button" role="tab" aria-selected={kind === 'odd'} onClick={() => switchKind('odd')}
          className={`flex items-center gap-4 rounded-xl border px-6 py-4 text-left transition-colors ${kind === 'odd' ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-100'}`}>
          <ClipboardList size={22} /><span className="flex-1"><span className="block font-medium">Ordens do Dia</span><span className="block text-xs opacity-80">ODD, proposta e criador</span></span>
        </button>
        <button type="button" role="tab" aria-selected={kind === 'technical_report'} onClick={() => switchKind('technical_report')}
          className={`flex items-center gap-4 rounded-xl border px-6 py-4 text-left transition-colors ${kind === 'technical_report' ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-100'}`}>
          <FileText size={22} /><span className="flex-1"><span className="block font-medium">Relatórios técnicos</span><span className="block text-xs opacity-80">Serviços, ODD vinculada e PDFs</span></span>
        </button>
      </div>

      <section className="rounded-[18px] border border-slate-200 bg-white overflow-hidden" aria-label={typeTitle(kind)}>
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 p-6">
          <div><h2 className="text-[26px]">{typeTitle(kind)}</h2><p className="mt-2 text-sm text-slate-500">{result ? `${result.total} documento(s) encontrado(s)` : 'Registros salvos no MySQL'}</p></div>
          <form className="flex w-full items-center gap-2 sm:w-auto" onSubmit={event => { event.preventDefault(); setPage(1); setSearch(query.trim()); }}>
            <label className="sr-only" htmlFor="monitor-search">Buscar cliente, criador ou referência</label>
            <input id="monitor-search" className="input min-w-0 flex-1 sm:w-64" placeholder="Cliente, criador ou referência" value={query} maxLength={120} onChange={e=>setQuery(e.target.value)} />
            <button className="btn-primary" type="submit" aria-label="Buscar"><Search size={17}/><span className="hidden sm:inline">Buscar</span></button>
          </form>
        </div>
        {error && <div role="alert" className="m-5 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
        {loading ? <div className="flex items-center gap-4 p-8 text-sm text-slate-500"><Loader2 size={18} className="animate-spin"/> Carregando documentos...</div> :
          !result?.data.length ? <div className="p-10 text-center text-slate-500"><ClipboardList className="mx-auto mb-3 opacity-60" size={28}/><p className="text-sm">Nenhum {kind === 'odd' ? 'ODD' : 'relatório técnico'} registrado nesta seleção.</p></div> :
          <div className="overflow-x-auto"><table className="w-full min-w-[820px] text-left text-sm">
            <thead className="bg-slate-100 text-xs text-slate-600"><tr>
              <th scope="col" className="px-6 py-4 font-medium">Número</th>
              <th scope="col" className="px-4 py-4 font-medium">Criado por</th>
              <th scope="col" className="px-4 py-4 font-medium">Data</th>
              <th scope="col" className="px-4 py-4 font-medium">Cliente</th>
              <th scope="col" className="px-4 py-4 font-medium">{kind === 'odd' ? 'Número de proposta' : 'Número ODD'}</th>
              <th scope="col" className="px-4 py-4 font-medium">Gerar PDF novamente</th>
            </tr></thead>
            <tbody className="divide-y divide-slate-200">{result.data.map(row => <tr key={row.id} className="hover:bg-slate-100/50">
              <td className="px-6 py-4 font-mono font-medium text-slate-900">{formatDocumentNumber(row.document_number)}</td>
              <td className="px-4 py-4"><span className="inline-flex items-center gap-2"><UserRound size={16} className="shrink-0 text-slate-400"/><span>{row.creator_name}</span></span>
                {row.creator_kind === 'public' && <span className="block text-xs text-slate-500">Formulário público · não logado</span>}</td>
              <td className="whitespace-nowrap px-4 py-4 font-mono text-slate-600">{dateBR(row.document_date)}</td>
              <td className="max-w-xs px-4 py-4 text-slate-900">{row.client_name}</td>
              <td className="px-4 py-4 font-mono text-slate-600">{row.reference_number || '—'}</td>
              <td className="px-4 py-4"><div className="flex flex-wrap gap-2">
                {kind === 'odd' ? <button type="button" className="btn-secondary whitespace-nowrap" disabled={Boolean(busyId)} onClick={() => void regenerate(row, 'odd')}>{busyId === `${row.id}-odd` ? <Loader2 className="animate-spin" size={15}/> : <Download size={15}/>} PDF da ODD</button> : <>
                  <button type="button" className="btn-secondary whitespace-nowrap" disabled={Boolean(busyId)} onClick={() => void regenerate(row, 'complete')}>{busyId === `${row.id}-complete` ? <Loader2 className="animate-spin" size={15}/> : <Download size={15}/>} Completo</button>
                  <button type="button" className="btn-secondary whitespace-nowrap" disabled={Boolean(busyId)} onClick={() => void regenerate(row, 'without')}>{busyId === `${row.id}-without` ? <Loader2 className="animate-spin" size={15}/> : <Download size={15}/>} Sem pendências</button>
                </>}
              </div></td>
            </tr>)}</tbody>
          </table></div>}
        <div className="flex items-center justify-between gap-4 border-t border-slate-200 px-6 py-4 text-sm text-slate-600">
          <span>{result?.total ? `Página ${page} de ${Math.max(1, Math.ceil(result.total / 25))}` : 'Página 1'}</span>
          <div className="flex items-center gap-2">
            <button type="button" className="btn-secondary" aria-label="Página anterior" disabled={loading || page <= 1} onClick={() => setPage(p => Math.max(1, p-1))}><ChevronLeft size={17}/></button>
            <button type="button" className="btn-secondary" aria-label="Próxima página" disabled={loading || !result || page * 25 >= result.total} onClick={() => setPage(p => p+1)}><ChevronRight size={17}/></button>
          </div>
        </div>
      </section>
      <p className="text-xs text-slate-500">Os PDFs são reconstruídos localmente a partir dos formulários armazenados. O histórico é exclusivo da empresa selecionada e exige a permissão Monitoramento.</p>
    </div>
  );
}
