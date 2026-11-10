import { useEffect, useMemo, useState } from 'react';
import { Check, ChevronLeft, ChevronRight, Search, X } from 'lucide-react';
import { apiRequest } from '@/lib/api';

type Group = { id: string; subject: string; integration_id: string };
type Channel = { id: string; name: string };
const PAGE_SIZE = 30;
const MAX_GROUPS = 1000;

/** Group search is server-paginated: never render an entire instance's group list. */
export function GroupMultiPicker({selected, onChange, channels}: {
  selected: string[];
  onChange: (next: string[]) => void;
  channels: Channel[];
}) {
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [channelId, setChannelId] = useState('');
  const [page, setPage] = useState(0);
  const [results, setResults] = useState<Group[]>([]);
  const [known, setKnown] = useState<Record<string,Group>>({});
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showSelected, setShowSelected] = useState(false);
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const selectedKey = selected.join(',');

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 250);
    return () => clearTimeout(timer);
  }, [search]);
  useEffect(() => { setPage(0); }, [debouncedSearch, channelId]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError('');
    const params = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) });
    if (debouncedSearch) params.set('q', debouncedSearch);
    if (channelId) params.set('integration_id', channelId);
    apiRequest<{groups: Group[]; total: number}>(`/group-automations/groups/picker?${params}`)
      .then(data => {
        if (cancelled) return;
        setResults(data.groups ?? []); setTotal(data.total ?? 0);
        setKnown(prev => {
          const next = {...prev};
          for (const group of data.groups ?? []) next[group.id] = group;
          return next;
        });
      })
      .catch(e => { if (!cancelled) { setResults([]); setTotal(0); setError(e instanceof Error ? e.message : 'Falha ao buscar grupos.'); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [page, debouncedSearch, channelId]);

  // Load names for preselected groups, even when they are outside the current search page.
  useEffect(() => {
    if (!selected.length) return;
    let cancelled = false;
    const missing = selected.filter(id=>!known[id]);
    if (!missing.length) return;
    apiRequest<{groups: Group[]}>('/group-automations/groups/lookup', {
      method: 'POST', body: JSON.stringify({ ids: missing }),
    }).then(data => {
      if (cancelled) return;
      setKnown(prev => {
        const next = {...prev};
        for (const group of data.groups ?? []) next[group.id] = group;
        return next;
      });
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [selectedKey]);

  const add = (ids: string[]) => {
    const next = [...selected];
    for (const id of ids) if (!selectedSet.has(id) && next.length < MAX_GROUPS) next.push(id);
    onChange(next);
  };
  const remove = (id: string) => onChange(selected.filter(item => item !== id));
  const pageIds = results.map(g => g.id);
  const allPageSelected = !!pageIds.length && pageIds.every(id => selectedSet.has(id));
  const channelName = (id: string) => channels.find(c => c.id === id)?.name ?? 'WhatsApp';
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="label mb-0">Grupos monitorados *</label>
        <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-800">{selected.length} selecionado(s)</span>
      </div>
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,190px)]">
        <div className="relative">
          <Search size={17} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input type="search" aria-label="Buscar grupo" className="input pl-10" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Pesquisar pelo nome do grupo..." />
        </div>
        <select className="input" aria-label="Filtrar por instância" value={channelId} onChange={e=>setChannelId(e.target.value)}>
          <option value="">Todas as instâncias</option>
          {channels.map(channel => <option key={channel.id} value={channel.id}>{channel.name}</option>)}
        </select>
      </div>
      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-3 py-2 gap-2">
          <span className="text-xs text-slate-600">{loading ? 'Buscando...' : `${total.toLocaleString('pt-BR')} grupo(s) encontrado(s)`}</span>
          <button type="button" className="text-xs font-medium text-amber-700 disabled:opacity-40" disabled={!results.length || (selected.length>=MAX_GROUPS && !allPageSelected)}
            onClick={() => allPageSelected ? onChange(selected.filter(id=>!pageIds.includes(id))) : add(pageIds)}>
            {allPageSelected ? 'Remover desta página' : 'Adicionar esta página'}
          </button>
        </div>
        <div className="max-h-64 overflow-y-auto divide-y divide-slate-100">
          {error && <p role="alert" className="p-3 text-sm text-red-600">{error}</p>}
          {!loading && !error && results.length===0 && <p className="p-4 text-sm text-slate-500">Nenhum grupo encontrado. Tente outro nome ou instância.</p>}
          {results.map(g => {
            const checked = selectedSet.has(g.id);
            return <button key={g.id} type="button" aria-pressed={checked} disabled={!checked && selected.length>=MAX_GROUPS}
              className={`flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm hover:bg-slate-50 disabled:opacity-40 ${checked?'bg-amber-50/70':''}`}
              onClick={() => checked ? remove(g.id) : add([g.id])}>
              <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border ${checked?'border-amber-500 bg-amber-500 text-white':'border-slate-300 text-slate-500'}`}>{checked && <Check size={13}/>}</span>
              <span className="min-w-0 flex-1"><span className="block truncate font-medium text-slate-800" title={g.subject}>{g.subject}</span>
                <span className="block truncate text-xs text-slate-500">{channelName(g.integration_id)}</span></span>
              <span className="shrink-0 text-xs text-slate-500">{checked?'Selecionado':'Adicionar'}</span>
            </button>;
          })}
        </div>
        <div className="flex items-center justify-between gap-2 border-t border-slate-200 bg-slate-50 px-3 py-2">
          <span className="text-xs text-slate-500">Página {page+1} de {totalPages}</span>
          <div className="flex gap-1">
            <button type="button" className="rounded border border-slate-200 p-1.5 disabled:opacity-30" aria-label="Página anterior" disabled={loading || page===0} onClick={()=>setPage(p=>Math.max(0,p-1))}><ChevronLeft size={17}/></button>
            <button type="button" className="rounded border border-slate-200 p-1.5 disabled:opacity-30" aria-label="Próxima página" disabled={loading || page+1>=totalPages} onClick={()=>setPage(p=>p+1)}><ChevronRight size={17}/></button>
          </div>
        </div>
      </div>
      {selected.length > 0 && <div className="rounded-lg border border-amber-100 bg-amber-50/50 p-3 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <button type="button" className="text-sm font-semibold text-slate-800" onClick={()=>setShowSelected(v=>!v)} aria-expanded={showSelected}>
            {showSelected ? 'Ocultar grupos selecionados' : `Ver ${selected.length} grupo(s) selecionado(s)`}
          </button>
          <button type="button" className="text-xs text-slate-600 hover:text-red-700" onClick={()=>onChange([])}>Limpar seleção</button>
        </div>
        {showSelected && <div className="max-h-40 overflow-y-auto space-y-1">
          {selected.map(id => <div key={id} className="flex items-center justify-between gap-2 rounded bg-white px-2.5 py-1.5 text-sm">
            <span className="min-w-0 truncate" title={known[id]?.subject ?? id}>{known[id]?.subject ?? 'Grupo selecionado anteriormente'} <span className="text-xs text-slate-400">· {known[id] ? channelName(known[id].integration_id) : 'Carregando...'}</span></span>
            <button type="button" onClick={()=>remove(id)} aria-label={`Remover ${known[id]?.subject ?? 'grupo'} da seleção`} className="shrink-0 text-slate-500 hover:text-red-600"><X size={16}/></button>
          </div>)}
        </div>}
      </div>}
      <p className="text-xs text-slate-500">Pesquise e adicione grupos de qualquer instância autorizada. Até {MAX_GROUPS.toLocaleString('pt-BR')} grupos por automação; cada grupo terá um resumo separado.</p>
    </div>
  );
}
