import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, CircleAlert, Loader2, RefreshCw, ShieldCheck, Smartphone } from 'lucide-react';
import { apiRequest } from '@/lib/api';

type Company={id:string;name:string;status:string};
type Recipient={id:string;name:string;email:string;role:string};
type Channel={id:string;name:string;org_id:string;provider:string;owner_user_id:string|null;status:string;instance_name:string|null;display_phone_number:string|null;phone_number_id:string|null};
type ProvisionResult={channel:Channel;webhook?:{ok:boolean;error?:string|null};webhook_verify_token?:string;next_step:string};
type Provider='evolution'|'meta';
const initial={name:'',provider_url:'',instance_name:'',api_key:'',phone_number_id:'',business_account_id:'',access_token:'',app_secret:''};

export function DevIntegrationsPanel({organizations}:{organizations:Company[]}){
  const [orgId,setOrgId]=useState('');
  const [recipients,setRecipients]=useState<Recipient[]>([]);
  const [channels,setChannels]=useState<Channel[]>([]);
  const [ownerId,setOwnerId]=useState('');
  const [owners,setOwners]=useState<Record<string,string>>({});
  const [provider,setProvider]=useState<Provider>('evolution');
  const [form,setForm]=useState(initial);
  const [loading,setLoading]=useState(false);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [metaVerify,setMetaVerify]=useState('');
  useEffect(()=>{
    if(organizations.some(o=>o.id===orgId&&o.status==='active'))return;
    setOrgId(organizations.find(o=>o.status==='active')?.id||'');
  },[organizations,orgId]);
  const load=useCallback(async()=>{
    if(!orgId){setRecipients([]);setChannels([]);return;}
    setLoading(true);setError('');
    try{
      const [members,integrations]=await Promise.all([
        apiRequest<{data:Recipient[]}>(`/dev/integrations/members?org_id=${encodeURIComponent(orgId)}`),
        apiRequest<{data:Channel[]}>(`/dev/integrations?org_id=${encodeURIComponent(orgId)}`),
      ]);
      setRecipients(members.data);setChannels(integrations.data);
    }catch(e){setError(e instanceof Error?e.message:'Falha ao carregar integrações.');}
    finally{setLoading(false);}
  },[orgId]);
  useEffect(()=>{setOwnerId('');setForm(initial);setOwners({});setMetaVerify('');setNotice('');void load();},[load]);
  async function provision(){
    if(!orgId||!ownerId||busy)return;
    const recipient=recipients.find(r=>r.id===ownerId);
    const org=organizations.find(o=>o.id===orgId);
    if(!recipient||!org)return;
    if(!window.confirm(`Preparar ${provider==='evolution'?'Evolution API':'Meta Cloud API'} para ${recipient.name} (${recipient.email}) na empresa ${org.name}?`))return;
    setBusy(true);setError('');setNotice('');setMetaVerify('');
    try{
      const common={org_id:orgId,owner_user_id:ownerId,...(form.name.trim()?{name:form.name.trim()}:{})};
      const body=provider==='evolution'
        ?{...common,provider_url:form.provider_url.trim(),instance_name:form.instance_name.trim(),api_key:form.api_key.trim()}
        :{...common,phone_number_id:form.phone_number_id.trim(),business_account_id:form.business_account_id.trim(),access_token:form.access_token.trim(),...(form.app_secret.trim()?{app_secret:form.app_secret.trim()}:{})};
      const result=await apiRequest<ProvisionResult>(`/dev/integrations/${provider}`,{method:'POST',body:JSON.stringify(body)});
      setForm(initial);
      setNotice(result.next_step+(result.webhook&&!result.webhook.ok?' Atenção: webhook Evolution pendente; revise as variáveis do servidor.':''));
      if(result.webhook_verify_token)setMetaVerify(result.webhook_verify_token);
      await load();
    }catch(e){setError(e instanceof Error?e.message:'Não foi possível preparar a integração.');}
    finally{setBusy(false);}
  }
  async function reassign(channel:Channel){
    const newOwner=owners[channel.id]||channel.owner_user_id;
    if(!newOwner||newOwner===channel.owner_user_id||busy)return;
    const target=recipients.find(r=>r.id===newOwner);
    if(!target||!window.confirm(`Atribuir ${channel.name} para ${target.name}? A conversa e o histórico continuam na empresa atual.`))return;
    setBusy(true);setError('');setNotice('');
    try{
      await apiRequest(`/dev/integrations/${channel.id}/owner`,{method:'PATCH',body:JSON.stringify({owner_user_id:newOwner})});
      setNotice(`Responsável de ${channel.name} atualizado. O usuário poderá encontrar o WhatsApp em sua Caixa de Entrada.`);
      await load();
    }catch(e){setError(e instanceof Error?e.message:'Falha ao atribuir número.');}
    finally{setBusy(false);}
  }
  return <div className="space-y-5">
    <div className="card space-y-4 p-5">
      <div className="flex flex-wrap items-start justify-between gap-4"><div><h2 className="flex items-center gap-2 text-lg font-semibold text-slate-900"><ShieldCheck size={20}/> Integrações por usuário</h2><p className="mt-1 text-sm text-slate-500">Prepare integrações para outros usuários sem usar suas senhas. O DEV não pode escanear QR Code ou conectar um WhatsApp à própria conta.</p></div><button type="button" className="btn-secondary text-xs" disabled={busy||loading} onClick={()=>void load()}><RefreshCw size={15}/> Atualizar</button></div>
      <label className="block text-sm font-medium text-slate-700">Empresa
        <select className="input mt-1 w-full" value={orgId} disabled={busy} onChange={e=>setOrgId(e.target.value)}><option value="">Escolha a empresa...</option>{organizations.filter(o=>o.status==='active').map(o=><option key={o.id} value={o.id}>{o.name}</option>)}</select>
      </label>
      {error&&<p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700"><CircleAlert size={15} className="mr-1 inline"/>{error}</p>}
      {notice&&<p role="status" className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700"><CheckCircle2 size={15} className="mr-1 inline"/>{notice}</p>}
      {metaVerify&&<div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900"><p className="font-semibold">Token de verificação do webhook da Meta — copie agora</p><code className="mt-2 block break-all select-all">{metaVerify}</code><p className="mt-2 text-xs">Registre e confirme o webhook no Meta Business Manager. Não é um QR Code; a Meta exige configuração oficial.</p></div>}
      <div className="border-t border-slate-200 pt-4"><h3 className="mb-3 text-sm font-semibold text-slate-900">Preparar nova integração</h3>
        <div className="grid gap-4 md:grid-cols-2">
          <label className="block text-sm">Provedor
            <select className="input mt-1 w-full" value={provider} disabled={busy} onChange={e=>{setProvider(e.target.value as Provider);setForm(initial);setMetaVerify('');}}><option value="evolution">Evolution API — conexão por QR Code</option><option value="meta">Meta Cloud API — conexão oficial sem QR</option></select>
          </label>
          <label className="block text-sm">Usuário responsável
            <select className="input mt-1 w-full" value={ownerId} disabled={!orgId||busy} onChange={e=>setOwnerId(e.target.value)}><option value="">Selecione um usuário aprovado...</option>{recipients.map(u=><option key={u.id} value={u.id}>{u.name} — {u.email} ({u.role})</option>)}</select>
          </label>
          <label className="block text-sm">Identificação do número (opcional)<input className="input mt-1 w-full" value={form.name} maxLength={100} disabled={busy} onChange={e=>setForm(v=>({...v,name:e.target.value}))} placeholder="Ex.: Atendimento Marketing"/></label>
          {provider==='evolution'?<>
            <label className="block text-sm">URL da Evolution API<input className="input mt-1 w-full" value={form.provider_url} disabled={busy} onChange={e=>setForm(v=>({...v,provider_url:e.target.value}))} placeholder="https://evolution.suaempresa.com"/></label>
            <label className="block text-sm">Nome exato da instância já criada<input className="input mt-1 w-full" value={form.instance_name} disabled={busy} onChange={e=>setForm(v=>({...v,instance_name:e.target.value}))} placeholder="empresa-marketing"/></label>
            <label className="block text-sm">API Key da Evolution<input type="password" className="input mt-1 w-full" autoComplete="off" value={form.api_key} disabled={busy} onChange={e=>setForm(v=>({...v,api_key:e.target.value}))} placeholder="Chave da Evolution"/></label>
          </>:<>
            <label className="block text-sm">Phone Number ID (Meta)<input className="input mt-1 w-full" value={form.phone_number_id} disabled={busy} onChange={e=>setForm(v=>({...v,phone_number_id:e.target.value}))} placeholder="ID numérico"/></label>
            <label className="block text-sm">WhatsApp Business Account ID<input className="input mt-1 w-full" value={form.business_account_id} disabled={busy} onChange={e=>setForm(v=>({...v,business_account_id:e.target.value}))} placeholder="ID numérico"/></label>
            <label className="block text-sm">Access Token da Meta<input type="password" autoComplete="off" className="input mt-1 w-full" value={form.access_token} disabled={busy} onChange={e=>setForm(v=>({...v,access_token:e.target.value}))} placeholder="Token de acesso"/></label>
            <label className="block text-sm">App Secret (opcional)<input type="password" autoComplete="off" className="input mt-1 w-full" value={form.app_secret} disabled={busy} onChange={e=>setForm(v=>({...v,app_secret:e.target.value}))} placeholder="App Secret"/></label>
          </>}
        </div>
        <p className="mt-3 text-xs text-slate-500">{provider==='evolution'?'A instância deve existir no Evolution Manager. Este cadastro apenas vincula a instância ao usuário; o próprio usuário escaneia o QR Code em Caixa de Entrada → Conectar meu WhatsApp.':'Meta Cloud API não usa QR Code. O registro aqui valida e guarda as credenciais, mas NÃO ativa o envio/recebimento: ainda será necessária a integração multiempresa do webhook e do backend Meta.'}</p>
        <div className="mt-4 flex justify-end"><button type="button" className="btn-primary" disabled={busy||loading||!orgId||!ownerId||(provider==='evolution'?(!form.provider_url.trim()||!form.instance_name.trim()||!form.api_key.trim()):(!form.phone_number_id.trim()||!form.business_account_id.trim()||!form.access_token.trim()))} onClick={()=>void provision()}>{busy?<Loader2 size={16} className="animate-spin"/>:<Smartphone size={16}/>} Preparar para o usuário</button></div>
      </div>
    </div>
    <div className="card overflow-hidden"><div className="border-b border-slate-200 p-5"><h3 className="font-semibold text-slate-900">Números cadastrados nesta empresa</h3><p className="mt-1 text-xs text-slate-500">Você pode trocar o responsável sem desconectar o número nem alterar o histórico. Chaves e tokens nunca são exibidos.</p></div>
      {loading?<p className="p-6 text-sm text-slate-500"><Loader2 size={16} className="inline animate-spin"/> Consultando...</p>:!channels.length?<p className="p-6 text-sm text-slate-500">Nenhum número cadastrado nesta empresa.</p>:<div className="divide-y divide-slate-200">{channels.map(channel=><div key={channel.id} className="flex flex-col gap-3 p-4 lg:flex-row lg:items-center lg:justify-between"><div><p className="font-medium text-slate-900">{channel.name}</p><p className="text-xs text-slate-500">{channel.provider==='evolution_api'?'Evolution API':'Meta Cloud API'} · {channel.instance_name||channel.display_phone_number||channel.phone_number_id||'Sem identificador'} · {channel.status}</p></div><div className="flex flex-wrap items-center gap-2"><select className="input w-full text-xs sm:w-72" aria-label={`Responsável por ${channel.name}`} value={owners[channel.id]??channel.owner_user_id??''} disabled={busy} onChange={e=>setOwners(v=>({...v,[channel.id]:e.target.value}))}><option value="">Sem responsável atribuído</option>{recipients.map(u=><option key={u.id} value={u.id}>{u.name} ({u.email})</option>)}</select><button type="button" className="btn-secondary text-xs" disabled={busy||!(owners[channel.id])||owners[channel.id]===channel.owner_user_id} onClick={()=>void reassign(channel)}>Atribuir</button></div></div>)}</div>}
    </div>
  </div>;
}
