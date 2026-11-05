import { useCallback, useEffect, useState } from 'react';
import { ShieldCheck, UsersRound, Building2, UserRoundCheck, Layers3, Activity, RefreshCw, Search, X, Copy, Check, ChevronLeft, ChevronRight } from 'lucide-react';
import { apiRequest } from '@/lib/api';
import { useOrg } from '@/contexts/OrgContext';

type Tab = 'pending' | 'users' | 'organizations' | 'teams' | 'activity';
type Membership = { id:string;org_id:string;org_name:string;role:string;status:string };
type DevUser = { id:string;email:string;name:string;global_role:string;approval_status:string;is_active:boolean;requested_org_region?:string|null;requested_org_id?:string|null;created_at:string;last_login_at:string|null;memberships:Membership[];owned_organizations?:{id:string;name:string}[] };
type DevOrg = { id:string;name:string;slug:string;status:string;plan:string;region?:string|null;_count:{org_members:number;teams:number} };
type DevTeam = { id:string;name:string;description:string|null;org_id:string;org_name:string;members:number };
type DevSummary = { pending:number;total:number;active:number;organizations:number;teams:number;notifications_configured:boolean };
type ActivityRow = { id:string;action:string;actor_id?:string|null;user_id?:string|null;target_user_id?:string|null;created_at:string;org_id?:string|null };
type Role = { slug:string;name:string };
const navigation: {key:Tab;name:string;icon:typeof UsersRound}[] = [
  {key:'pending',name:'Aprovações',icon:UserRoundCheck},
  {key:'users',name:'Usuários',icon:UsersRound},
  {key:'organizations',name:'Empresas',icon:Building2},
  {key:'teams',name:'Equipes',icon:Layers3},
  {key:'activity',name:'Auditoria',icon:Activity},
];
function date(value:string|null|undefined) { if(!value)return '—';const d=new Date(value);return Number.isNaN(d.getTime())?'—':d.toLocaleString('pt-BR'); }
const chip=(positive:boolean)=>positive?'border-emerald-500/25 bg-emerald-500/10 text-emerald-500':'border-amber-500/25 bg-amber-500/10 text-amber-500';

export function DevConsolePage() {
  const { refresh: refreshOrganizations } = useOrg();
  const [tab,setTab]=useState<Tab>('pending');
  const [summary,setSummary]=useState<DevSummary|null>(null);
  const [users,setUsers]=useState<DevUser[]>([]);
  const [total,setTotal]=useState(0);
  const [page,setPage]=useState(1);
  const [search,setSearch]=useState('');
  const [statusFilter,setStatusFilter]=useState<'all'|'deleted'|'blocked'>('all');
  const [approvalRole,setApprovalRole]=useState<'administrador'|'master'>('administrador');
  const [approvalRegion,setApprovalRegion]=useState('');
  const [orgs,setOrgs]=useState<DevOrg[]>([]);
  const [deletedOrgs,setDeletedOrgs]=useState(false);
  const [createCompany,setCreateCompany]=useState(false);
  const [companyName,setCompanyName]=useState('');
  const [companyRegion,setCompanyRegion]=useState('');
  const [teams,setTeams]=useState<DevTeam[]>([]);
  const [events,setEvents]=useState<ActivityRow[]>([]);
  const [selected,setSelected]=useState<DevUser|null>(null);
  const [editedEmail,setEditedEmail]=useState('');
  const [editedName,setEditedName]=useState('');
  const [roleOptions,setRoleOptions]=useState<Record<string,Role[]>>({});
  const [targetOrg,setTargetOrg]=useState('');
  const [targetRole,setTargetRole]=useState('administrador');
  const [moveCompany,setMoveCompany]=useState(false);
  const [temporaryPassword,setTemporaryPassword]=useState('');
  const [userEvents,setUserEvents]=useState<ActivityRow[]|null>(null);
  const [copied,setCopied]=useState(false);
  const [notice,setNotice]=useState('');
  const [error,setError]=useState('');
  const [loading,setLoading]=useState(false);
  const [busy,setBusy]=useState(false);
  const [orgEdit,setOrgEdit]=useState<DevOrg|null>(null);
  const [orgName,setOrgName]=useState('');


  const load=useCallback(async()=>{
    setLoading(true);setError('');
    try{
      const [stats,accounts,companies,groups,logs]=await Promise.all([
        apiRequest<DevSummary>('/dev/summary'),
        apiRequest<{data:DevUser[];total:number}>(`/dev/users?page=${page}&status=${tab==='pending'?'pending':statusFilter}&q=${encodeURIComponent(search)}`),
        apiRequest<{data:DevOrg[]}>(`/dev/organizations?deleted=${deletedOrgs}`),
        apiRequest<{data:DevTeam[]}>('/dev/teams'),
        apiRequest<{dev_events:ActivityRow[];organization_events:ActivityRow[]}>('/dev/activity'),
      ]);
      setSummary(stats);setUsers(accounts.data);setTotal(accounts.total);setOrgs(companies.data);setTeams(groups.data);
      setOrgEdit(prev=>prev?(companies.data.find(o=>o.id===prev.id)||prev):null);
      setSelected(prev=>prev?(accounts.data.find(u=>u.id===prev.id)||prev):null);
      setEvents([...logs.dev_events,...logs.organization_events].sort((a,b)=>new Date(b.created_at).getTime()-new Date(a.created_at).getTime()).slice(0,120));
    }catch(err){setError(err instanceof Error?err.message:'Falha ao consultar dados do DEV.');}
    finally{setLoading(false);}
  },[page,search,tab,statusFilter,deletedOrgs]);
  useEffect(()=>{void load();},[load]);

  const operate=async(path:string,method:'POST'|'PATCH'|'DELETE',body?:unknown,success='Operação realizada.')=>{
    setBusy(true);setError('');setNotice('');
    try{
      await apiRequest(path,{method,...(body===undefined?{}:{body:JSON.stringify(body)})});
      setNotice(success);
      if(method==='DELETE'||path.endsWith('/approve')||path.endsWith('/reject'))setSelected(null);
      if(path.startsWith('/dev/organizations/') && method==='DELETE')setOrgEdit(null);
      await load();
      // Nao recarregar o contexto global durante operacoes do modal: isso nao deve desmontar a pagina.
      if(path.endsWith('/restore')||path.endsWith('/approve'))await refreshOrganizations();
      return true;
    }catch(err){setError(err instanceof Error?err.message:'Não foi possível concluir a operação.');return false;}
    finally{setBusy(false);}
  };

  function openUser(user:DevUser) {
    setSelected(user);setEditedEmail(user.email);setEditedName(user.name);setApprovalRole('administrador');setApprovalRegion(user.requested_org_id||'');
    setTemporaryPassword('');setCopied(false);setNotice('');setError('');setUserEvents(null);
    setTargetOrg('');setTargetRole('administrador');setMoveCompany(false);
    for(const m of user.memberships){
      if(!roleOptions[m.org_id])void apiRequest<{data:Role[]}>(`/dev/roles?org_id=${m.org_id}`).then(r=>setRoleOptions(prev=>({...prev,[m.org_id]:r.data}))).catch(()=>{});
    }
  }
  useEffect(()=>{
    if(!targetOrg || roleOptions[targetOrg])return;
    let cancelled=false;
    apiRequest<{data:Role[]}>(`/dev/roles?org_id=${targetOrg}`)
      .then(r=>{if(!cancelled)setRoleOptions(prev=>({...prev,[targetOrg]:r.data}));})
      .catch(()=>{if(!cancelled)setError('Nao foi possivel carregar cargos da empresa escolhida.');});
    return ()=>{cancelled=true;};
  },[targetOrg,roleOptions]);
  const assignCompany=async()=>{
    if(!selected||!targetOrg)return;
    const org=orgs.find(o=>o.id===targetOrg);
    if(!org)return;
    const action=moveCompany?'Transferir o usuario e desativar seus acessos nas outras empresas':'Adicionar acesso a outra empresa';
    if(!window.confirm(`${action}: ${selected.email} -> ${org.name} (${targetRole})?`))return;
    const ok=await operate(`/dev/users/${selected.id}/memberships`,'POST',{org_id:targetOrg,role:targetRole,move:moveCompany},moveCompany?'Usuario transferido. Sessoes anteriores revogadas.':'Vinculo adicionado. Sessoes anteriores revogadas.');
    if(ok){setTargetOrg('');setMoveCompany(false);}
  };
  const resetPassword=async(user:DevUser)=>{
    if(!window.confirm(`Gerar uma senha temporária e desconectar todas as sessões de ${user.email}?`))return;
    setBusy(true);setError('');setTemporaryPassword('');
    try {
      const result=await apiRequest<{temporary_password:string}>(`/dev/users/${user.id}/reset-password`,{method:'POST'});
      setTemporaryPassword(result.temporary_password);setNotice('Senha redefinida. Copie e entregue ao usuário por canal seguro; ela aparece somente agora.');
      await load();
    }catch(err){setError(err instanceof Error?err.message:'Falha ao redefinir a senha.');}
    finally{setBusy(false);}
  };
  const approve=async(u:DevUser,role:'administrador'|'master'='administrador',region?:string)=>{
    if(!region&&!u.requested_org_id&&!u.requested_org_region&&!u.memberships.length){openUser(u);setError('Selecione a empresa antes de aprovar.');return false;}
    return operate(`/dev/users/${u.id}/approve`,'POST',{role,...(u.memberships.length&&!u.requested_org_region&&!u.requested_org_id?{}:{...(region||u.requested_org_id?{org_id:region||u.requested_org_id}:{region:u.requested_org_region})})},`Acesso de ${u.email} aprovado como ${role}.`);
  };
  const deleteUser=async(u:DevUser)=>{
    const email=window.prompt(`Arquivar a conta ${u.email} e revogar todos os acessos? As empresas e equipes permanecem intactas.\nDigite o e-mail completo para confirmar:`);
    if(email===u.email)return operate(`/dev/users/${u.id}`,'DELETE',{confirm_email:email},'Conta arquivada; empresas e historicos preservados.');
    return false;
  };
  const deleteForever=async(u:DevUser)=>{
    const email=window.prompt(`EXCLUSAO DEFINITIVA da conta ${u.email}. Esta acao nao pode ser desfeita. Empresas e historicos serao preservados, mas a conta e seus vinculos serao removidos do banco.\nDigite o e-mail completo:`);
    if(email===u.email)return operate(`/dev/users/${u.id}/permanent`,'DELETE',{confirm_email:email},'Usuario removido definitivamente do banco.');
    return false;
  };
  const addCompany=async()=>{
    if(!companyName.trim())return;
    setBusy(true);setError('');
    try{
      await apiRequest('/dev/organizations',{method:'POST',body:JSON.stringify({name:companyName,region:companyRegion||null})});
      setCreateCompany(false);setCompanyName('');setCompanyRegion('');setNotice('Empresa cadastrada. Ela ja esta disponivel no cadastro publico.');
      setDeletedOrgs(false);await load();await refreshOrganizations();
    }catch(err){setError(err instanceof Error?err.message:'Falha ao cadastrar empresa.');}
    finally{setBusy(false);}
  };
  const editOrg=(org:DevOrg)=>{
    setOrgEdit(org);setOrgName(org.name);setError('');
  };
  const card='card p-5';
  const button='inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100 disabled:opacity-40';
  const danger='inline-flex items-center justify-center rounded-lg border border-red-500/25 bg-red-500/10 px-3 py-2 text-sm font-semibold text-red-500 hover:bg-red-500/20 disabled:opacity-40';
  const mild='inline-flex items-center justify-center rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm font-medium text-amber-500 hover:bg-amber-500/20 disabled:opacity-40';

  return <div className="w-full min-w-0 space-y-6 p-5 md:p-8">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div><div className="flex items-center gap-2 text-amber-500 text-xs font-semibold uppercase tracking-widest"><ShieldCheck size={16}/> Administração global</div>
        <h1 className="mt-2 text-3xl font-semibold text-slate-900">DEV · Controle do sistema</h1>
        <p className="mt-2 text-sm text-slate-500">Aprove acessos e administre usuários, empresas e equipes de todos os ambientes.</p></div>
      <button className={button} disabled={loading||busy} onClick={()=>void load()}><RefreshCw size={16} className={loading?'animate-spin':''}/>Atualizar</button>
    </div>

    {error&&<div role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-500">{error}</div>}
    {notice&&<div role="status" className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-4 text-sm text-emerald-500">{notice}</div>}
    {summary&&!summary.notifications_configured&&<div className="rounded-xl border border-amber-500/25 bg-amber-500/5 px-4 py-3 text-sm text-amber-500">E-mail de aprovação não configurado. Defina DEV_NOTIFICATION_EMAIL, RESEND_API_KEY e RESEND_FROM_EMAIL no servidor. As solicitações continuarão aparecendo aqui.</div>}

    <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
      {([['Pendentes',summary?.pending],['Usuários',summary?.total],['Ativos',summary?.active],['Empresas',summary?.organizations],['Equipes',summary?.teams]] as [string,number|undefined][]).map(([label,value])=><div key={label} className={card}><p className="text-sm text-slate-500">{label}</p><p className="mt-2 text-3xl font-semibold text-slate-900">{value??'—'}</p></div>)}
    </div>
    <div className="flex flex-wrap gap-2 border-b border-slate-200 pb-3">{navigation.map(t=>{
      const Icon=t.icon;return <button key={t.key} type="button" onClick={()=>{setTab(t.key);setPage(1);setSearch('');setError('');}} className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium ${tab===t.key?'bg-amber-400/15 text-amber-500':'text-slate-500 hover:bg-slate-100'}`}><Icon size={16}/>{t.name}{t.key==='pending'&&!!summary?.pending&&<span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs">{summary.pending}</span>}</button>;
    })}</div>

    {(tab==='users'||tab==='pending')&&<section className="card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 p-4">
        <h2 className="font-semibold text-slate-900">{tab==='pending'?'Solicitações aguardando aprovação':'Todos os usuários'}</h2>
        {tab==='users'&&<select aria-label="Filtrar usuários" className="input w-full max-w-[190px]" value={statusFilter} onChange={e=>{setStatusFilter(e.target.value as typeof statusFilter);setPage(1);}}><option value="all">Usuários ativos e pendentes</option><option value="blocked">Bloqueados</option><option value="deleted">Excluídos</option></select>}
        <div className="relative w-full max-w-xs"><Search size={16} className="absolute left-3 top-3 text-slate-400"/><input aria-label="Buscar usuário" placeholder="Nome ou e-mail" className="input w-full pl-10" value={search} onChange={e=>{setSearch(e.target.value);setPage(1);}}/></div>
      </div>
      <div className="overflow-x-auto"><table className="w-full min-w-[800px] text-sm"><thead className="bg-slate-50 text-left text-xs text-slate-500"><tr><th className="p-4">Usuário</th><th className="p-4">Cadastro</th><th className="p-4">Acesso</th><th className="p-4">Empresas</th><th className="p-4 text-right">Administração</th></tr></thead>
        <tbody>{users.map(u=><tr key={u.id} className="border-t border-slate-200"><td className="px-4 py-3"><div className="font-semibold text-slate-900">{u.name||'Sem nome'} {u.global_role==='dev'&&<span className="ml-2 text-xs text-amber-500">DEV</span>}</div><div className="text-slate-500">{u.email}</div></td>
          <td className="px-4 py-3 text-slate-500">{date(u.created_at)}</td>
          <td className="px-4 py-3"><span className={`rounded-full border px-2 py-1 text-xs font-medium ${chip(u.is_active&&u.approval_status==='approved')}`}>{u.approval_status==='pending'?'Aguardando':u.approval_status==='rejected'?'Rejeitado':u.approval_status==='deleted'?'Excluído (arquivado)':u.is_active?'Ativo':'Bloqueado'}</span></td>
          <td className="px-4 py-3 text-slate-500">{u.memberships.length?u.memberships.map(m=>m.org_name).join(', '):'Ainda não vinculado'}</td>
          <td className="px-4 py-3 text-right"><div className="inline-flex gap-2 whitespace-nowrap">{u.approval_status==='pending'&&<button disabled={busy} className={mild} onClick={()=>void approve(u)}>Aprovar como Administrador</button>}
            {u.global_role==='dev'?<span className="px-3 py-2 text-xs text-slate-500">DEV protegido</span>:<button className={button} onClick={()=>openUser(u)}>Gerenciar</button>}</div></td>
        </tr>)}{!users.length&&<tr><td colSpan={5} className="p-10 text-center text-slate-500">{loading?'Carregando...':'Nenhum usuário encontrado.'}</td></tr>}</tbody></table></div>
      <div className="flex items-center justify-between border-t border-slate-200 p-4 text-sm text-slate-500"><span>{users.length} de {total} registros na consulta</span><div className="flex items-center gap-3"><button aria-label="Página anterior" disabled={page<=1} className={button} onClick={()=>setPage(v=>Math.max(1,v-1))}><ChevronLeft size={16}/></button>Página {page}<button aria-label="Próxima página" disabled={page*50>=total} className={button} onClick={()=>setPage(v=>v+1)}><ChevronRight size={16}/></button></div></div>
    </section>}

    {tab==='organizations'&&<section className="card overflow-hidden"><div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 p-5"><div><h2 className="font-semibold text-slate-900">Empresas cadastradas</h2><p className="text-sm text-slate-500">Empresas independentes dos usuários. Somente empresas ativas aparecem no cadastro público.</p></div><div className="flex gap-2"><button className={button} onClick={()=>setDeletedOrgs(v=>!v)}>{deletedOrgs?"Ver empresas atuais":"Ver arquivadas"}</button><button className={mild} onClick={()=>setCreateCompany(true)}>+ Nova empresa</button></div></div>
      <div className="overflow-x-auto"><table className="w-full min-w-[700px] text-sm"><thead className="bg-slate-50 text-left text-xs text-slate-500"><tr><th className="p-4">Empresa</th><th className="p-4">Status</th><th className="p-4">Membros</th><th className="p-4">Equipes</th><th className="p-4">Ações</th></tr></thead><tbody>{orgs.map(o=><tr key={o.id} className="border-t border-slate-200"><td className="p-4"><div className="font-semibold text-slate-900">{o.name}</div><div className="text-xs text-slate-500">{o.slug}</div></td><td className="p-4"><span className={o.status==='active'?'text-emerald-500':'text-amber-500'}>{o.status==='active'?'Ativa':o.status==='deleted'?'Arquivada':'Suspensa'}</span></td><td className="p-4 text-slate-500">{o._count.org_members}</td><td className="p-4 text-slate-500">{o._count.teams}</td><td className="p-4"><button className={button} onClick={()=>editOrg(o)}>Gerenciar</button></td></tr>)}{!orgs.length&&<tr><td colSpan={5} className="p-8 text-center text-slate-500">Nenhuma empresa.</td></tr>}</tbody></table></div></section>}

    {tab==='teams'&&<section className="card overflow-hidden"><div className="border-b border-slate-200 p-5"><h2 className="font-semibold text-slate-900">Equipes de todas as empresas</h2><p className="text-sm text-slate-500">Exclusões respeitam vínculos de canais de WhatsApp.</p></div>
      <div className="overflow-x-auto"><table className="w-full min-w-[640px] text-sm"><thead className="bg-slate-50 text-left text-xs text-slate-500"><tr><th className="p-4">Equipe</th><th className="p-4">Empresa</th><th className="p-4">Membros</th><th className="p-4">Ações</th></tr></thead><tbody>{teams.map(t=><tr key={t.id} className="border-t border-slate-200"><td className="p-4 font-semibold text-slate-900">{t.name}</td><td className="p-4 text-slate-500">{t.org_name}</td><td className="p-4 text-slate-500">{t.members}</td><td className="p-4"><div className="flex gap-2"><button className={button} disabled={busy} onClick={()=>{const name=window.prompt('Novo nome da equipe:',t.name);if(name&&name!==t.name)void operate(`/dev/teams/${t.id}`,'PATCH',{name},'Equipe atualizada.');}}>Renomear</button><button className={danger} disabled={busy} onClick={()=>{const confirmation=window.prompt(`Para excluir a equipe, digite exatamente: ${t.name}`);if(confirmation===t.name)void operate(`/dev/teams/${t.id}`,'DELETE',{confirm_name:confirmation},'Equipe excluída.');}}>Excluir</button></div></td></tr>)}{!teams.length&&<tr><td colSpan={4} className="p-8 text-center text-slate-500">Nenhuma equipe cadastrada.</td></tr>}</tbody></table></div></section>}

    {tab==='activity'&&<section className="card overflow-hidden"><div className="border-b border-slate-200 p-5"><h2 className="font-semibold text-slate-900">Atividade recente</h2><p className="text-sm text-slate-500">Eventos administrativos globais e auditorias já registradas pelas empresas. Não inclui ações que o sistema antigo nunca auditou.</p></div>
      <div className="divide-y divide-slate-200">{events.map(e=><div key={e.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-sm"><div><p className="font-medium text-slate-900">{e.action.replaceAll('_',' ')}</p><p className="text-xs text-slate-500">{e.target_user_id?`Usuário: ${e.target_user_id}`:e.org_id?`Empresa: ${e.org_id}`:'Evento global'}</p></div><span className="text-slate-500">{date(e.created_at)}</span></div>)}{!events.length&&<div className="p-10 text-center text-slate-500">Nenhum evento registrado.</div>}</div></section>}

    {selected&&<div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4" role="presentation" onMouseDown={e=>{if(e.target===e.currentTarget)setSelected(null);}}>
      <div role="dialog" aria-modal="true" aria-label="Administração de usuário" className="card max-h-[90vh] w-full max-w-2xl overflow-y-auto p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-3"><div><h2 className="text-xl font-semibold text-slate-900">Administrar usuário</h2><p className="text-sm text-slate-500">{selected.email}</p></div><button aria-label="Fechar" className={button} onClick={()=>setSelected(null)}><X size={18}/></button></div>
        <div className="mt-5 grid gap-3 sm:grid-cols-2"><label className="text-sm font-medium text-slate-700">Nome<input className="input mt-1 w-full" value={editedName} onChange={e=>setEditedName(e.target.value)}/></label><label className="text-sm font-medium text-slate-700">E-mail<input type="email" className="input mt-1 w-full" value={editedEmail} onChange={e=>setEditedEmail(e.target.value)}/></label></div>
        <div className="mt-3"><button className={mild} disabled={busy||(!editedName.trim()&&!editedEmail.trim())} onClick={()=>void operate(`/dev/users/${selected.id}`,'PATCH',{email:editedEmail,full_name:editedName},'Dados do usuário atualizados.')}>Salvar dados</button></div>
        
        
        {['pending','rejected'].includes(selected.approval_status)&&<div className="mt-5 border-t border-slate-200 pt-5 space-y-3">
          <h3 className="font-semibold text-slate-900">Aprovar cadastro</h3>
          {selected.memberships.length&&!selected.requested_org_region&&!selected.requested_org_id?<p className="text-sm text-slate-500">Convite para empresa existente: {selected.memberships.map(m=>m.org_name).join(', ')}. O cargo já definido pela equipe será preservado.</p> : <div className="grid gap-3 sm:grid-cols-2"><label className="text-sm">Empresa<select className="input mt-1 w-full" value={approvalRegion} onChange={e=>setApprovalRegion(e.target.value)}><option value="">Selecione...</option>{orgs.filter(o=>o.status==='active').map(o=><option key={o.id} value={o.id}>{o.name}</option>)}</select></label>
          <label className="text-sm">Cargo inicial<select className="input mt-1 w-full" value={approvalRole} onChange={e=>setApprovalRole(e.target.value as 'administrador'|'master')}><option value="administrador">Administrador (padrão)</option><option value="master">Master</option></select></label></div>}
          <button disabled={busy||(!approvalRegion&&!selected.memberships.length&&!selected.requested_org_id)} className={mild} onClick={()=>void approve(selected,approvalRole,approvalRegion)}>Aprovar cadastro</button>
          {selected.approval_status==='pending'&&<button disabled={busy} className={danger} onClick={()=>{if(window.confirm(`Rejeitar o cadastro de ${selected.email}?`))void operate(`/dev/users/${selected.id}/reject`,'POST',undefined,'Solicitação rejeitada.');}}>Rejeitar cadastro</button>}</div>}
        {selected.approval_status==='deleted'&&<div className="mt-5 border-t border-slate-200 pt-5"><button className={mild} disabled={busy} onClick={()=>{if(window.confirm(`Restaurar o cadastro de ${selected.email}? Os vínculos anteriores continuarão inativos.`))void operate(`/dev/users/${selected.id}/restore`,'POST',undefined,'Conta restaurada, sem reativar vínculos de empresas.');}}>Restaurar cadastro arquivado</button></div>}
        {selected.approval_status==='approved'&&<div className="mt-5 border-t border-slate-200 pt-5"><h3 className="font-semibold text-slate-900">Segurança e acesso</h3><div className="mt-3 flex flex-wrap gap-2">
          <button disabled={busy} className={button} onClick={()=>{if(window.confirm(`Desconectar todas as sessões de ${selected.email}?`))void operate(`/dev/users/${selected.id}/revoke-sessions`,'POST',undefined,'Todas as sessões foram revogadas.');}}>Derrubar sessões</button>
          <button className={button} type="button" disabled={busy} onClick={()=>void apiRequest<{data:ActivityRow[]}>(`/dev/users/${selected.id}/activity`).then(result=>setUserEvents(result.data)).catch(err=>setError(err instanceof Error?err.message:'Falha ao consultar atividade.'))}>Ver atividade</button>
          <button disabled={busy} className={mild} onClick={()=>void resetPassword(selected)}>Redefinir senha</button>
          <button disabled={busy} className={selected.is_active?danger:mild} onClick={()=>{if(window.confirm(`${selected.is_active?'Bloquear':'Reativar'} ${selected.email}?`))void operate(`/dev/users/${selected.id}/set-active`,'POST',{active:!selected.is_active});}}>{selected.is_active?'Bloquear acesso':'Reativar acesso'}</button>
        </div>
        {userEvents&&<div className="mt-3 max-h-52 space-y-2 overflow-y-auto rounded-xl border border-slate-200 p-3">
          <p className="mb-2 text-xs font-semibold text-slate-500">Atividade recente deste usuário</p>
          {userEvents.length?userEvents.map(e=><div key={e.id} className="flex justify-between gap-3 text-xs text-slate-700"><span>{e.action.replaceAll('_',' ')}</span><span className="whitespace-nowrap text-slate-500">{date(e.created_at)}</span></div>):<p className="text-sm text-slate-500">Nenhum registro disponível.</p>}
        </div>}
        {temporaryPassword&&<div className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3"><p className="mb-2 text-xs font-medium text-amber-500">Senha temporária: copie agora. Não será exibida novamente.</p><div className="flex items-center gap-2"><code className="min-w-0 flex-1 break-all text-sm text-slate-900">{temporaryPassword}</code><button type="button" className={button} onClick={()=>{void navigator.clipboard?.writeText(temporaryPassword).then(()=>setCopied(true));}}>{copied?<Check size={16}/>:<Copy size={16}/>}</button></div></div>}</div>}
        <div className="mt-5 border-t border-slate-200 pt-5"><h3 className="font-semibold text-slate-900">Vínculos e cargos por empresa</h3>
          <div className="mt-3 space-y-3">{selected.memberships.map(m=><div key={m.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 p-3"><div><p className="font-medium text-slate-900">{m.org_name}</p><p className="text-xs text-slate-500">{m.role} · {m.status}</p></div><div className="flex flex-wrap gap-2"><select aria-label={`Cargo na empresa ${m.org_name}`} disabled={busy} className="input text-sm" value={m.role} onChange={e=>{const role=e.target.value;if(window.confirm(`Alterar cargo de ${selected.email} para ${role} em ${m.org_name}?`))void operate(`/dev/memberships/${m.id}`,'PATCH',{role},'Cargo alterado e sessões anteriores revogadas.');}}>
            {(roleOptions[m.org_id]||[{slug:m.role,name:m.role}]).map(r=><option key={r.slug} value={r.slug}>{r.name}</option>)}
          </select><button disabled={busy} className={m.status==='active'?danger:mild} onClick={()=>{if(window.confirm(`${m.status==='active'?'Desativar':'Ativar'} vínculo com ${m.org_name}?`))void operate(`/dev/memberships/${m.id}`,'PATCH',{status:m.status==='active'?'inactive':'active'},'Vínculo atualizado.');}}>{m.status==='active'?'Remover acesso':'Ativar vínculo'}</button></div></div>)}
            {!selected.memberships.length&&<p className="text-sm text-slate-500">Nenhuma empresa vinculada.</p>}
            <div className="mt-4 space-y-3 rounded-xl border border-amber-500/25 p-4">
              <p className="text-sm font-semibold text-slate-900">Vincular ou transferir para outra empresa</p>
              <label className="block text-xs font-medium">Empresa de destino
                <select className="input mt-1 w-full text-sm" value={targetOrg} onChange={e=>{setTargetOrg(e.target.value);setTargetRole('administrador');}} disabled={busy}>
                  <option value="">Selecione a empresa...</option>
                  {orgs.filter(o=>o.status==='active').map(o=><option key={o.id} value={o.id}>{o.name}</option>)}
                </select>
              </label>
              <label className="block text-xs font-medium">Cargo na empresa de destino
                <select className="input mt-1 w-full text-sm" value={targetRole} onChange={e=>setTargetRole(e.target.value)} disabled={busy||!targetOrg}>
                  {(roleOptions[targetOrg]||[{slug:'administrador',name:'Administrador'}]).map(r=><option key={r.slug} value={r.slug}>{r.name}</option>)}
                </select>
              </label>
              <label className="flex items-start gap-2 text-sm text-slate-700"><input type="checkbox" className="mt-1" checked={moveCompany} onChange={e=>setMoveCompany(e.target.checked)}/><span>Transferir: desativar vínculos das outras empresas e remover o usuário das equipes anteriores. As conversas permanecem na empresa de origem.</span></label>
              <button type="button" className={mild} disabled={busy||!targetOrg||!roleOptions[targetOrg]?.some(r=>r.slug===targetRole)} onClick={()=>void assignCompany()}>{moveCompany?'Transferir usuário':'Adicionar vínculo'}</button>
            </div>

          </div>
        </div>
        <div className="mt-5 border-t border-slate-200 pt-5"><div className="flex flex-wrap gap-2"><button className={button} disabled={busy} onClick={()=>void deleteUser(selected)}>Arquivar usuário</button><button className={danger} disabled={busy} onClick={()=>void deleteForever(selected)}>Excluir definitivamente do banco</button></div><p className="mt-2 text-xs text-slate-500">Empresas, equipes e históricos são preservados. A exclusão definitiva remove a conta e seus vínculos e não pode ser desfeita.</p></div>
      </div>
    </div>}

    {createCompany&&<div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4"><div className="card w-full max-w-lg space-y-4 p-6"><h2 className="text-xl font-semibold text-slate-900">Nova empresa</h2><label className="block text-sm">Nome da empresa<input className="input mt-2 w-full" value={companyName} maxLength={150} onChange={e=>setCompanyName(e.target.value)}/></label><label className="block text-sm">Região (opcional)<select className="input mt-2 w-full" value={companyRegion} onChange={e=>setCompanyRegion(e.target.value)}><option value="">Não especificada</option><option value="sao_paulo">São Paulo</option><option value="rio_de_janeiro">Rio de Janeiro</option><option value="brasilia">Brasília</option><option value="curitiba">Curitiba</option><option value="estados_unidos">Estados Unidos</option><option value="dubai">Dubai</option></select></label><div className="flex gap-3"><button className={button} onClick={()=>setCreateCompany(false)}>Cancelar</button><button className={mild} disabled={busy||companyName.trim().length<2} onClick={()=>void addCompany()}>Cadastrar empresa</button></div></div></div>}
    {orgEdit&&<div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4" onMouseDown={e=>{if(e.target===e.currentTarget)setOrgEdit(null);}}><div role="dialog" aria-modal="true" aria-label="Gerenciar empresa" className="card w-full max-w-lg space-y-5 p-6 shadow-2xl"><div className="flex items-start justify-between gap-3"><h2 className="text-xl font-semibold text-slate-900">Administrar empresa</h2><button aria-label="Fechar" className={button} onClick={()=>setOrgEdit(null)}><X size={18}/></button></div><label className="block text-sm text-slate-700">Nome da empresa<input className="input mt-2 w-full" value={orgName} onChange={e=>setOrgName(e.target.value)}/></label><button disabled={busy||!orgName.trim()} className={mild} onClick={()=>void operate(`/dev/organizations/${orgEdit.id}`,'PATCH',{name:orgName},'Empresa atualizada.')}>Salvar nome</button>
      <div className="border-t border-slate-200 pt-4">{orgEdit.status!=='deleted'&&<button disabled={busy} className={orgEdit.status==='active'?danger:mild} onClick={()=>{if(window.confirm(`${orgEdit.status==='active'?'Suspender':'Reativar'} a empresa ${orgEdit.name}?`))void operate(`/dev/organizations/${orgEdit.id}`,'PATCH',{status:orgEdit.status==='active'?'suspended':'active'});}}>{orgEdit.status==='active'?'Suspender empresa':'Reativar empresa'}</button>}</div>
      {orgEdit.status==='deleted'&&<div className="border-t border-slate-200 pt-4"><button className={mild} disabled={busy} onClick={()=>void operate(`/dev/organizations/${orgEdit.id}/restore`,'POST',{},'Empresa restaurada.')}>Restaurar empresa</button></div>}</div></div>}
  </div>;
}
