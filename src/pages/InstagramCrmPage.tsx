import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiRequest } from '@/lib/api';
import { createPortal } from 'react-dom';
import {
  Instagram, UsersRound, UserCheck, ShieldBan, Search, RefreshCw,
  Plus, Play, MessageSquareText, Send, Trash2, ExternalLink,
  ChevronLeft, ChevronRight, ChevronDown, Database, Filter,
} from 'lucide-react';

type LeadStatus = 'Novo' | 'Selecionado' | 'Descartado';
type InstagramLead = {
  usuario: string;
  nome?: string;
  origem_curtida?: boolean;
  origem_comentario?: boolean;
  perfis_origem?: string[];
  perfis_monitorados?: unknown;
  perfil_monitorado?: unknown;
  perfil_origem?: unknown;
  status?: LeadStatus;
  bloqueado?: boolean;
};
type MonitoredProfile = {
  perfil: string;
  curtidas: number;
  comentarios: number;
  estado: string;
  ultima_coleta?: string;
  detalhe?: string;
};

type ResponseLeads = { sucesso: boolean; leads: InstagramLead[]; erro?: string };
type ResponseMonitor = { sucesso: boolean; perfis: MonitoredProfile[]; erro?: string };
type ResponseAction = { sucesso: boolean; status?: LeadStatus; bloqueado?: boolean; mensagem?: string; erro?: string };

const norm = (value: unknown) => String(value ?? '').trim().replace(/^@/, '').toLowerCase();
function origins(lead: InstagramLead): string[] {
  const result = new Set<string>();
  const read = (v: unknown): void => {
    if (Array.isArray(v)) { v.forEach(read); return; }
    if (v && typeof v === 'object') { const o = v as Record<string, unknown>; read(o.perfil ?? o.username ?? o.usuario); return; }
    const s = String(v ?? '').trim();
    if (s.startsWith('[')) { try { const a: unknown = JSON.parse(s); if (Array.isArray(a)) { read(a); return; } } catch { /* valor legado */ } }
    s.split(/[,;\n]+/).forEach(p => { const u = norm(p); if (/^[a-z0-9._]{1,30}$/.test(u)) result.add(u); });
  };
  read(lead.perfis_origem); read(lead.perfis_monitorados); read(lead.perfil_monitorado); read(lead.perfil_origem);
  return [...result];
}
const blocked = (v: unknown) => v === true || v === 1 || String(v).toLowerCase() === 'true';
const messageOf = (e: unknown) => e instanceof Error ? e.message : 'Não foi possível completar a operação.';

const fieldClass = 'input w-full min-h-[44px] text-sm';
const labelClass = 'mb-2 block text-sm font-medium text-slate-700';

function StatusChip({ children, kind = 'neutral' }: { children: React.ReactNode; kind?: 'neutral' | 'accent' }) {
  return <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-medium ${kind === 'accent' ? 'border-blue-500/40 bg-blue-50 text-blue-700' : 'border-slate-200 bg-slate-100 text-slate-600'}`}>{children}</span>;
}

function LeadActions({ lead, busy, onAction }: {
  lead: InstagramLead;
  busy: boolean;
  onAction: (usuario: string, acao: string) => Promise<unknown> | void;
}) {
  const [menu, setMenu] = useState<{ top: number; left: number; upward: boolean } | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const options = (lead.status !== 'Selecionado' ? ['Selecionar'] : [])
    .concat(lead.status !== 'Descartado' ? ['Descartar'] : [],
      lead.status !== 'Novo' ? ['Restaurar'] : [],
      [blocked(lead.bloqueado) ? 'Desbloquear' : 'Bloquear']);
  useEffect(() => {
    if (!menu) return;
    const closeOnOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!trigger.current?.contains(target) && !popup.current?.contains(target)) setMenu(null);
    };
    const close = () => setMenu(null);
    document.addEventListener('mousedown', closeOnOutside);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('mousedown', closeOnOutside);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [menu]);
  const toggle = () => {
    if (menu) { setMenu(null); return; }
    const rect = trigger.current?.getBoundingClientRect();
    if (!rect) return;
    const height = options.length * 40 + 16;
    const upward = window.innerHeight - rect.bottom < height + 12 && rect.top > height;
    setMenu({
      top: upward ? rect.top - height - 4 : rect.bottom + 4,
      left: Math.max(8, Math.min(rect.right - 172, window.innerWidth - 180)),
      upward,
    });
  };
  const colors: Record<string, string> = {
    Selecionar: 'text-amber-500 hover:bg-amber-400/10',
    Restaurar: 'text-emerald-500 hover:bg-emerald-500/10',
    Descartar: 'text-slate-300 hover:bg-slate-500/10',
    Bloquear: 'text-rose-400 hover:bg-rose-500/10',
    Desbloquear: 'text-sky-400 hover:bg-sky-500/10',
  };
  const actions: Record<string, string> = {
    Selecionar: 'selecionar', Descartar: 'descartar',
    Restaurar: 'restaurar', Bloquear: 'bloquear', Desbloquear: 'desbloquear',
  };
  return <>
    <button ref={trigger} type="button" disabled={busy} onClick={toggle}
      aria-expanded={!!menu} aria-haspopup="menu"
      className="inline-flex h-9 items-center gap-2 whitespace-nowrap rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 text-sm font-medium text-amber-500 transition-colors hover:bg-amber-400/20 disabled:opacity-50">
      Ações <ChevronDown size={15} className={menu ? 'rotate-180' : ''}/>
    </button>
    {menu && createPortal(
      <div ref={popup} role="menu" aria-label={`Ações de ${lead.usuario}`}
        style={{ position: 'fixed', top: menu.top, left: menu.left, width: 172, zIndex: 9999 }}
        className="rounded-xl border border-slate-600/50 bg-[#262626] p-2 shadow-xl">
        {options.map(label => (
          <button key={label} type="button" role="menuitem" disabled={busy}
            onClick={() => { setMenu(null); void onAction(lead.usuario, actions[label]); }}
            className={`block w-full rounded-md px-3 py-2 text-left text-sm font-medium transition-colors disabled:opacity-50 ${colors[label]}`}>
            {label}
          </button>
        ))}
      </div>, document.body)}
  </>;
}

export function InstagramCrmPage() {
  const [query, setQuery] = useState('');
  const [profileFilter, setProfileFilter] = useState('todos');
  const [originFilter, setOriginFilter] = useState('todos');
  const [statusFilter, setStatusFilter] = useState('todos');
  const [blockedFilter, setBlockedFilter] = useState('todos');
  const [pageSize, setPageSize] = useState(20);
  const [page, setPage] = useState(1);
  const [newProfile, setNewProfile] = useState('');
  const [campaignMessage, setCampaignMessage] = useState('');
  const [leadsBase, setLeadsBase] = useState<InstagramLead[]>([]);
  const [profiles, setProfiles] = useState<MonitoredProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [collectionPending, setCollectionPending] = useState(false);
  const updating = useRef(false);
  const load = useCallback(async (silent = false) => {
    if (updating.current) return;
    updating.current = true;
    if (!silent) setLoading(true);
    try {
      const [m, l] = await Promise.all([
        apiRequest<ResponseMonitor>('/stalker/monitor'),
        apiRequest<ResponseLeads>('/stalker/leads'),
      ]);
      if (m.sucesso !== true || !Array.isArray(m.perfis) || l.sucesso !== true || !Array.isArray(l.leads)) throw new Error('Resposta inválida do n8n.');
      setProfiles(m.perfis); setLeadsBase(l.leads); setError('');
      if (m.perfis.every(p => p.estado !== 'Coletando')) setCollectionPending(false);
    } catch (e) { if (!silent) setError(messageOf(e)); }
    finally { updating.current = false; if (!silent) setLoading(false); }
  }, []);
  useEffect(() => { void load(); const id = window.setInterval(() => { void load(true); }, 6000); return () => window.clearInterval(id); }, [load]);
  const run = async (task: () => Promise<void>) => {
    if (busy) return;
    setBusy(true); setError(''); setNotice('');
    try { await task(); } catch (e) { setError(messageOf(e) + ' Verifique o estado atual antes de repetir a operação.'); }
    finally { setBusy(false); }
  };
  const action = async (usuario: string, acao: string) => run(async () => {
    const reply = await apiRequest<ResponseAction>('/stalker/lead', { method: 'POST', body: JSON.stringify({ usuario, acao }) });
    if (!reply.sucesso) throw new Error(reply.erro ?? reply.mensagem ?? 'Alteração não confirmada.');
    setNotice(reply.mensagem || 'Lead atualizado.'); await load();
  });
  const changeProfile = async (perfil: string, acao: 'adicionar' | 'remover') => run(async () => {
    if (acao === 'remover') {
      if (profiles.length <= 1) return;
      if (!window.confirm(`Excluir definitivamente @${perfil} e os dados associados? Leads exclusivos também serão apagados. Esta ação não pode ser desfeita.`)) return;
      const clean = await apiRequest<ResponseAction>('/stalker/profile/cleanup', {method:'POST', body: JSON.stringify({perfil, confirmacao:'EXCLUIR_DADOS'})});
      if (!clean.sucesso) throw new Error(clean.erro ?? 'Não foi possível excluir os dados.');
    }
    const reply = await apiRequest<ResponseAction>('/stalker/profile', {method:'POST', body: JSON.stringify({perfil, acao})});
    if (!reply.sucesso) throw new Error(reply.erro ?? 'Alteração não confirmada.');
    if (acao === 'adicionar') setNewProfile(''); setNotice(acao === 'adicionar' ? 'Perfil adicionado.' : 'Perfil removido.'); await load();
  });
  const scrape = async () => run(async () => {
    if (!window.confirm(`Iniciar raspagem de ${profiles.length} perfil(is) no n8n/Apify?`)) return;
    const reply = await apiRequest<ResponseAction>('/stalker/scrape', {method:'POST', body:JSON.stringify({acao:'iniciar'})});
    if (!reply.sucesso) throw new Error(reply.erro ?? 'Raspagem não confirmada.');
    setCollectionPending(true); setNotice('Raspagem iniciada. O status será atualizado automaticamente.'); await load();
  });
  const campaign = async (modo: 'selecionados'|'comentarios') => run(async () => {
    const message = campaignMessage.trim();
    if (!message || message.length > 1000 || /[\r\n]/.test(message)) throw new Error('Informe uma mensagem de até 1000 caracteres, sem quebras de linha.');
    const users = [...new Set(leads.filter(l => !blocked(l.bloqueado) && l.status !== 'Descartado' && (modo === 'comentarios' ? l.origem_comentario === true : l.status === 'Selecionado')).map(l => norm(l.usuario)).filter(u => /^[a-z0-9._]{1,30}$/.test(u)))];
    if (!users.length) throw new Error('Nenhum destinatário elegível.');
    if (!window.confirm(`Adicionar ${users.length} destinatário(s) à fila do n8n? Confirme que autorizaram o contato.`)) return;
    const campaignId = `crm_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
    const reply = await apiRequest<ResponseAction>('/stalker/campaign', {method:'POST', body: JSON.stringify({ campanha_id:campaignId, mensagem:message, usuarios:users, modo })});
    if (!reply.sucesso) throw new Error(reply.erro ?? 'Campanha não confirmada.');
    setNotice('Campanha adicionada à fila do n8n. Isso não confirma a entrega das mensagens.');
  });
  const clearSelection = async () => run(async () => {
    if (!window.confirm('Retornar todos os leads selecionados ao status Novo?')) return;
    const reply = await apiRequest<ResponseAction>('/stalker/lead', {method:'POST',body:JSON.stringify({usuario:'',acao:'limpar_selecao'})});
    if (!reply.sucesso) throw new Error(reply.erro ?? 'Operação não confirmada.');
    setNotice('Seleção limpa.'); await load();
  });

  const active = new Set(profiles.map(p => norm(p.perfil)));
  const leads = useMemo(() => leadsBase.filter(l => (l.origem_curtida === true || l.origem_comentario === true) && origins(l).some(p => active.has(p))).map(l => ({...l, perfis_origem: origins(l).filter(p => active.has(p))})), [leadsBase, profiles]);
  const collecting = collectionPending || profiles.some(p => p.estado === 'Coletando');
  const selected = leads.filter(lead => lead.status === 'Selecionado').length;
  const blockedCount = leads.filter(lead => blocked(lead.bloqueado)).length;
  const normalizedQuery = query.trim().toLocaleLowerCase('pt-BR');

  const filtered = useMemo(() => leads.filter(lead => {
    const sourceProfiles = origins(lead);
    if (normalizedQuery && !`${lead.usuario} ${lead.nome ?? ''}`.toLocaleLowerCase('pt-BR').includes(normalizedQuery)) return false;
    if (profileFilter !== 'todos' && !sourceProfiles.includes(profileFilter)) return false;
    if (originFilter === 'curtida' && !lead.origem_curtida) return false;
    if (originFilter === 'comentario' && !lead.origem_comentario) return false;
    if (statusFilter !== 'todos' && (lead.status ?? 'Novo') !== statusFilter) return false;
    if (blockedFilter === 'bloqueados' && !blocked(lead.bloqueado)) return false;
    if (blockedFilter === 'liberados' && blocked(lead.bloqueado)) return false;
    return true;
  }), [leads, normalizedQuery, profileFilter, originFilter, statusFilter, blockedFilter]);
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const actualPage = Math.min(page, pages);
  const current = filtered.slice((actualPage - 1) * pageSize, actualPage * pageSize);
  const resetPage = () => setPage(1);

  return (
    <div className="stalker-page mx-auto w-full min-w-0 max-w-7xl space-y-5 overflow-x-clip p-4 pb-8 lg:p-8 lg:pb-10">
      {/* O AppShell já possui uma área de rolagem interna (main).
          Nesta rota, impedir que html/body/#root também rolem evita a segunda
          barra e o vazio depois do final. Preservar o scroll real da sidebar. */}
      <style>{`
        html:has(.stalker-page),
        body:has(.stalker-page) {
          height: 100%;
          overflow: hidden;
        }
        body:has(.stalker-page) #root {
          height: 100%;
          overflow: hidden;
        }
        main:has(> .stalker-page) {
          min-height: 0;
          overflow-y: auto;
          overscroll-behavior-y: contain;
        }
      `}</style>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-[32px] font-light leading-tight text-slate-900">Stalker</h1>
          <p className="mt-2 text-sm text-slate-500">Monitore perfis, qualifique interações e prepare campanhas em um único lugar.</p>
        </div>
        <StatusChip>{loading ? 'Carregando dados...' : error ? 'Conexão indisponível' : collecting ? 'Coleta em andamento' : 'Conectado ao n8n'}</StatusChip>
      </div>

      {error && <div className="rounded-xl border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-500" role="alert">{error} <button className="ml-2 underline" onClick={() => void load()} type="button">Tentar novamente</button></div>}
      {notice && <div className="rounded-xl border border-slate-200 bg-slate-100 p-4 text-sm text-slate-800" role="status">{notice}</div>}

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-3" aria-label="Indicadores de leads">
        {[
          { label: 'Total de leads', icon: UsersRound, value: leads.length },
          { label: 'Selecionados', icon: UserCheck, value: selected },
          { label: 'Bloqueados', icon: ShieldBan, value: blockedCount },
        ].map(({ label, icon: Icon, value }) => (
          <div key={label} className="min-w-0 rounded-[18px] border border-slate-200 bg-white p-5">
            <div className="flex items-center justify-between gap-2"><span className="text-sm text-slate-500">{label}</span><Icon size={20} className="text-slate-500" /></div>
            <div className="mt-3 text-[36px] font-light leading-none tabular-nums text-slate-900">{loading ? '—' : value}</div>

          </div>
        ))}
      </section>

      <section className="min-w-0 overflow-hidden rounded-[18px] border border-slate-200 bg-white" aria-labelledby="ig-monitor-heading">
        <div className="border-b border-slate-200 px-5 py-4">
          <div className="flex items-center gap-3"><Instagram size={21} className="text-slate-600"/><h2 id="ig-monitor-heading" className="text-[24px] font-normal leading-tight text-slate-900">Monitoramento de perfis</h2></div>
          <p className="mt-2 text-sm text-slate-500">Gerencie os perfis acompanhados e consulte o andamento das coletas.</p>
        </div>
        <div className="space-y-4 p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="min-w-0 flex-1"><label htmlFor="ig-new-profile" className={labelClass}>Perfil do Instagram</label>
              <input id="ig-new-profile" className={fieldClass} placeholder="@perfil_do_instagram" value={newProfile} maxLength={31} onChange={e => setNewProfile(e.target.value)} />
            </div>
            <button className="btn-secondary shrink-0" type="button" disabled={loading || busy || collecting || !/^[a-z0-9._]{1,30}$/i.test(newProfile.replace(/^@/, ''))} onClick={() => void changeProfile(norm(newProfile), 'adicionar')}><Plus size={16}/> Adicionar perfil</button>
          </div>
          {profiles.length ? <div className="grid gap-4 md:grid-cols-2">
            {profiles.map(profile => <div key={profile.perfil} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex items-center justify-between gap-3"><strong className="text-sm text-slate-900">@{profile.perfil}</strong><StatusChip>{profile.estado}</StatusChip></div>
              <p className="mt-3 text-sm text-slate-500">{profile.curtidas} curtidas · {profile.comentarios} comentários</p>
              {profile.ultima_coleta && <p className="mt-1 text-xs text-slate-500">Última coleta: {new Date(profile.ultima_coleta).toLocaleString('pt-BR')}</p>}
              <button type="button" className="btn-secondary mt-4" disabled={busy || collecting || profiles.length <= 1} onClick={() => void changeProfile(profile.perfil, 'remover')}><Trash2 size={15}/> Remover perfil e dados</button>
            </div>)}
          </div> : <div className="flex flex-col items-center rounded-xl border border-dashed border-slate-200 px-6 py-9 text-center"><Database size={24} className="mb-3 text-slate-400"/><p className="font-medium text-slate-800">Nenhum perfil carregado</p><p className="mt-1 text-sm text-slate-500">Nenhum perfil retornado pelo n8n.</p></div>}
          <div className="flex flex-wrap gap-3">
            <button type="button" className="btn-primary" disabled={loading || busy || collecting || !profiles.length} onClick={() => void scrape()}><Play size={16}/> Iniciar raspagem</button>
            <button type="button" className="btn-secondary" disabled={loading || busy} onClick={() => void load()}><RefreshCw size={16}/> Atualizar resultados</button>
          </div>
          <p className="text-xs leading-relaxed text-slate-500">A coleta considera curtidas e comentários de perfis monitorados. A remoção de um perfil poderá excluir definitivamente dados vinculados a ele; essa ação exigirá confirmação.</p>
        </div>
      </section>

      <section className="min-w-0 overflow-hidden rounded-[18px] border border-slate-200 bg-white" aria-labelledby="ig-campaign-heading">
        <div className="border-b border-slate-200 px-5 py-4"><div className="flex items-center gap-3"><MessageSquareText size={21} className="text-slate-600"/><h2 id="ig-campaign-heading" className="text-[24px] font-normal leading-tight text-slate-900">Campanhas de mensagens</h2></div><p className="mt-2 text-sm text-slate-500">Prepare a mensagem e escolha o público antes de enviar para processamento.</p></div>
        <div className="space-y-4 p-5">
          <div><label htmlFor="ig-campaign-message" className={labelClass}>Mensagem da campanha</label>
            <textarea id="ig-campaign-message" className="input min-h-[120px] w-full resize-y text-sm" maxLength={1000} placeholder="Escreva a mensagem para os destinatários selecionados." value={campaignMessage} onChange={e => setCampaignMessage(e.target.value)}/>
            <div className="mt-2 text-right text-xs text-slate-500">{campaignMessage.length}/1000 caracteres</div>
          </div>
          <div className="flex flex-wrap gap-3"><button type="button" className="btn-secondary" disabled={busy || !selected} onClick={() => void clearSelection()}><Trash2 size={16}/> Limpar seleção</button><button type="button" className="btn-primary" disabled={busy || !selected || !campaignMessage.trim()} onClick={() => void campaign('selecionados')}><Send size={16}/> Enviar para selecionados</button><button type="button" className="btn-secondary" disabled={busy || !campaignMessage.trim()} onClick={() => void campaign('comentarios')}><UsersRound size={16}/> Enviar para todos os elegíveis</button></div>
          <p className="text-xs leading-relaxed text-slate-500">Somente contatos que autorizaram mensagens devem receber campanhas. A inclusão na fila do n8n não representa confirmação de entrega.</p>
        </div>
      </section>

      <section className="min-w-0 overflow-hidden rounded-[18px] border border-slate-200 bg-white" aria-labelledby="ig-leads-heading">
        <div className="border-b border-slate-200 px-5 py-4"><div className="flex items-center gap-3"><Filter size={21} className="text-slate-600"/><h2 id="ig-leads-heading" className="text-[24px] font-normal leading-tight text-slate-900">Lista de leads</h2></div><p className="mt-2 text-sm text-slate-500">Pesquise, filtre e organize os perfis identificados nas interações.</p></div>
        <div className="grid min-w-0 gap-3 p-5 md:grid-cols-2 xl:grid-cols-3">
          <div className="relative md:col-span-2 xl:col-span-1"><label className="sr-only" htmlFor="ig-search">Pesquisar usuário ou nome</label><Search size={17} className="pointer-events-none absolute left-3 top-3.5 text-slate-500"/><input id="ig-search" className={`${fieldClass} pl-10`} value={query} onChange={e => {setQuery(e.target.value);resetPage();}} placeholder="Pesquisar usuário ou nome" /></div>
          <label className="sr-only" htmlFor="ig-filter-profile">Perfil monitorado</label><select id="ig-filter-profile" className={fieldClass} value={profileFilter} onChange={e => {setProfileFilter(e.target.value);resetPage();}}><option value="todos">Todos os perfis monitorados</option>{profiles.map(p => <option key={p.perfil} value={p.perfil}>@{p.perfil}</option>)}</select>
          <label className="sr-only" htmlFor="ig-filter-origin">Origem</label><select id="ig-filter-origin" className={fieldClass} value={originFilter} onChange={e => {setOriginFilter(e.target.value);resetPage();}}><option value="todos">Todas as origens</option><option value="curtida">Curtidas</option><option value="comentario">Comentários</option></select>
          <label className="sr-only" htmlFor="ig-filter-status">Status</label><select id="ig-filter-status" className={fieldClass} value={statusFilter} onChange={e => {setStatusFilter(e.target.value);resetPage();}}><option value="todos">Todos os status</option><option value="Novo">Novos</option><option value="Selecionado">Selecionados</option><option value="Descartado">Descartados</option></select>
          <label className="sr-only" htmlFor="ig-filter-blocked">Bloqueio</label><select id="ig-filter-blocked" className={fieldClass} value={blockedFilter} onChange={e => {setBlockedFilter(e.target.value);resetPage();}}><option value="todos">Todos os leads</option><option value="liberados">Não bloqueados</option><option value="bloqueados">Bloqueados</option></select>
          <label className="sr-only" htmlFor="ig-page-size">Itens por página</label><select id="ig-page-size" className={fieldClass} value={pageSize} onChange={e => {setPageSize(Number(e.target.value));resetPage();}}><option value={20}>20 por página</option><option value={40}>40 por página</option><option value={60}>60 por página</option></select>
        </div>
        <div className="w-full min-w-0 overflow-x-auto" role="region" aria-label="Tabela de leads" tabIndex={0}><table className="w-full min-w-[920px] text-left text-sm"><thead className="bg-slate-100 text-xs text-slate-600"><tr>{['Usuário','Nome','Origem','Perfil de origem','Status','Bloqueado','Instagram','Ações'].map(h=><th key={h} scope="col" className="px-4 py-4 font-medium">{h}</th>)}</tr></thead><tbody className="divide-y divide-slate-200">{current.length ? current.map(lead => <tr key={lead.usuario} className="hover:bg-slate-100/50"><td className="px-4 py-4 font-medium text-slate-900">@{lead.usuario}</td><td className="px-4 py-4">{lead.nome || '—'}</td><td className="px-4 py-4"><div className="flex flex-wrap gap-1">{lead.origem_curtida && <StatusChip>Curtida</StatusChip>}{lead.origem_comentario && <StatusChip>Comentário</StatusChip>}</div></td><td className="px-4 py-4">{origins(lead).map(p => `@${p}`).join(', ') || '—'}</td><td className="px-4 py-4"><StatusChip kind={lead.status === 'Selecionado' ? 'accent' : 'neutral'}>{lead.status ?? 'Novo'}</StatusChip></td><td className="px-4 py-4">{blocked(lead.bloqueado) ? 'Sim' : 'Não'}</td><td className="px-4 py-4"><a className="inline-flex items-center gap-1 underline underline-offset-2" href={`https://www.instagram.com/${encodeURIComponent(lead.usuario.replace(/^@/, ''))}/`} target="_blank" rel="noopener noreferrer">Abrir perfil <ExternalLink size={14}/></a></td><td className="px-3 py-3 align-middle"><LeadActions lead={lead} busy={busy} onAction={action}/></td></tr>) : <tr><td colSpan={8} className="px-6 py-12 text-center"><Database size={25} className="mx-auto mb-3 text-slate-400"/><p className="font-medium text-slate-800">{'Nenhum lead encontrado'}</p><p className="mt-1 text-sm text-slate-500">{'Ajuste os filtros ou atualize os resultados.'}</p></td></tr>}</tbody></table></div>
        <div className="flex flex-wrap items-center justify-between gap-4 border-t border-slate-200 px-5 py-4 text-sm text-slate-500"><span>Exibindo {current.length ? (actualPage - 1) * pageSize + 1 : 0}–{Math.min(actualPage * pageSize, filtered.length)} de {filtered.length} leads</span><div className="flex items-center gap-3"><button type="button" className="btn-secondary" disabled={actualPage <= 1} onClick={() => setPage(p => Math.max(1,p-1))} aria-label="Página anterior"><ChevronLeft size={16}/></button><span className="tabular-nums">{actualPage} / {pages}</span><button type="button" className="btn-secondary" disabled={actualPage >= pages} onClick={() => setPage(p => Math.min(pages,p+1))} aria-label="Próxima página"><ChevronRight size={16}/></button></div></div>
      </section>
    </div>
  );
}
