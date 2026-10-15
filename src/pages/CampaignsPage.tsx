import { useCallback, useEffect, useState } from 'react';
import { useOrg } from '@/contexts/OrgContext';
import { apiRequest } from '@/lib/api';
import { supabase } from '@/lib/supabase';
import { toastError, toastSuccess } from '@/components/ui/Toast';
import { Modal } from '@/components/ui/Modal';
import { Spinner } from '@/components/ui/Spinner';
import { Megaphone, Plus, Play, Pause, RotateCcw, Trash2, Users, ShieldCheck, RefreshCw, Eye } from 'lucide-react';
import type { Campaign, Tag } from '@/types';

type Channel = {id:string;name:string;provider?:string;status:string};
type OptContact = {id:string;name:string;phone:string|null;opt_in:boolean};
type Recipient = {id:string;status:string;sent_at:string|null;error:string|null;contact?:{name:string;phone:string}};
const STAGES=[['','Todos os estágios'],['lead','Lead'],['qualified','Qualificado'],['negotiation','Negociação'],['won','Ganho'],['lost','Perdido']];
const initial={name:'',message:'',integration_id:'',segment_stage:'',daily_limit:'10',scheduled_at:''};
const labelStatus:Record<string,string>={draft:'Rascunho',scheduled:'Agendada',sending:'Enviando',paused:'Pausada',completed:'Concluída',failed:'Falhou'};

export function CampaignsPage(){
 const {currentOrg}=useOrg();
 const [campaigns,setCampaigns]=useState<(Campaign&{integration_id?:string|null})[]>([]);
 const [channels,setChannels]=useState<Channel[]>([]);const [tags,setTags]=useState<Tag[]>([]);
 const [form,setForm]=useState(initial);const [selectedTags,setSelectedTags]=useState<string[]>([]);
 const [loading,setLoading]=useState(true);const [saving,setSaving]=useState(false);const [showForm,setShowForm]=useState(false);
 const [details,setDetails]=useState<(Campaign&{integration_id?:string|null})|null>(null);
 const [recipients,setRecipients]=useState<Recipient[]>([]);const [preview,setPreview]=useState<number|null>(null);
 const [consentOpen,setConsentOpen]=useState(false);const [consents,setConsents]=useState<OptContact[]>([]);
 const load=useCallback(async(silent=false)=>{if(!currentOrg?.id)return; if(!silent)setLoading(true);
  try{const [a,b,t]=await Promise.all([apiRequest<{data:typeof campaigns}>('/operations/campaigns'),apiRequest<{data:Channel[]}>('/operations/channels'),supabase.from('tags').select('*').eq('org_id',currentOrg.id)]);
   setCampaigns(a.data);setChannels(b.data);setTags((t.data??[]) as Tag[]);
  }catch(e){toastError(e instanceof Error?e.message:'Erro ao carregar campanhas');}finally{setLoading(false);}
 },[currentOrg?.id]);
 useEffect(()=>{void load();const i=window.setInterval(()=>void load(true),12000);return()=>window.clearInterval(i);},[load]);
 async function run(action:()=>Promise<unknown>,success:string){try{setSaving(true);await action();toastSuccess(success);await load(true);}catch(e){toastError(e instanceof Error?e.message:'Não foi possível completar a operação');}finally{setSaving(false);}}
 async function save(){if(!form.name.trim()||!form.message.trim()||!form.integration_id)return toastError('Nome, mensagem e WhatsApp são obrigatórios.');
  await run(async()=>{await apiRequest('/operations/campaigns',{method:'POST',body:JSON.stringify({name:form.name,message:form.message,integration_id:form.integration_id,segment_stage:form.segment_stage||null,segment_tags:selectedTags,daily_limit:Number(form.daily_limit),scheduled_at:form.scheduled_at?new Date(form.scheduled_at).toISOString():null})});setShowForm(false);setForm(initial);setSelectedTags([]);},'Campanha criada como rascunho. Nenhuma mensagem foi enviada.');
 }
 async function openDetails(c:Campaign){setDetails(c);setPreview(null);setRecipients([]);
  try{const [a,b]=await Promise.all([apiRequest<{eligible:number}>(`/operations/campaigns/${c.id}/preview`),apiRequest<{data:Recipient[]}>(`/operations/campaigns/${c.id}/recipients`)]);setPreview(a.eligible);setRecipients(b.data);}catch(e){toastError(e instanceof Error?e.message:'Erro ao consultar destinatários');}
 }
 async function activate(c:Campaign){try{const r=await apiRequest<{eligible:number}>(`/operations/campaigns/${c.id}/preview`);
  if(!r.eligible)return toastError('Nenhum contato com consentimento e telefone válido no segmento.');
  if(!window.confirm(`ATENÇÃO: ativar ${c.name} enviará mensagens REAIS para ${r.eligible} contato(s), de forma gradual, pelo WhatsApp selecionado. Confirmar?`))return;
  await run(()=>apiRequest(`/operations/campaigns/${c.id}/activate`,{method:'POST'}),'Campanha ativada: envios graduais iniciados ou agendados.');
 }catch(e){toastError(e instanceof Error?e.message:'Falha ao validar público');}}
 async function openConsent(){try{setConsents((await apiRequest<{data:OptContact[]}>('/operations/consent')).data);setConsentOpen(true);}catch(e){toastError(e instanceof Error?e.message:'Falha ao carregar contatos');}}
 async function toggleConsent(c:OptContact){const granting=!c.opt_in;
  if(!window.confirm(granting?`Confirma que ${c.name} deu consentimento explícito para campanhas de WhatsApp? Não marque sem autorização real.`:`Revogar o consentimento de ${c.name}?`))return;
  const source=window.prompt('Registre a origem do consentimento (ex.: formulário de cadastro, data da autorização):',granting?'Autorização confirmada pelo cliente':'Revogação solicitada pelo cliente');
  if(!source||source.trim().length<5)return toastError('Informe a origem ou motivo (mínimo 5 caracteres).');
  await run(async()=>{await apiRequest(`/operations/consent/${c.id}`,{method:'PUT',body:JSON.stringify({consent:granting,source})});setConsents(old=>old.map(x=>x.id===c.id?{...x,opt_in:granting}:x));},granting?'Consentimento registrado.':'Consentimento revogado.');
 }
 const nameChannel=(id?:string|null)=>channels.find(c=>c.id===id)?.name||'Não definido';
 return <div className="p-4 lg:p-7 max-w-7xl mx-auto space-y-5">
  <div className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-2xl font-bold text-slate-900">Campanhas</h1><p className="text-sm text-slate-500">Público segmentado, consentimento, fila gradual e histórico por WhatsApp</p></div>
   <div className="flex gap-2"><button className="btn-secondary" onClick={openConsent}><ShieldCheck size={16}/> Consentimentos</button><button className="btn-primary" onClick={()=>{setForm(initial);setSelectedTags([]);setShowForm(true);}}><Plus size={16}/> Nova campanha</button></div></div>
  <div className="rounded-xl p-3 border border-amber-200 bg-amber-50 text-sm text-amber-900">Envio real somente após clicar em <b>Ativar</b>. Limite de 30 envios/dia por campanha, 50/dia por empresa e 1 tentativa a cada 30 segundos. Use somente contatos que autorizaram campanhas. “Aceita” não significa “entregue”.</div>
  {loading?<Spinner/>:campaigns.length===0?<div className="card p-10 text-center text-slate-500"><Megaphone className="mx-auto mb-2"/>Crie sua primeira campanha.</div>:
  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">{campaigns.map(c=><div className="card p-5 space-y-3" key={c.id}>
   <div className="flex justify-between gap-2"><div><h3 className="font-semibold text-slate-900">{c.name}</h3><p className="text-xs text-slate-500">{nameChannel(c.integration_id)} · {labelStatus[c.status]||c.status}</p></div><button className="btn-ghost" onClick={()=>void openDetails(c)} title="Destinatários"><Eye size={17}/></button></div>
   <p className="text-sm text-slate-600 line-clamp-2">{c.message}</p>
   <div className="grid grid-cols-3 gap-2 text-center text-xs"><div className="bg-blue-50 rounded p-2"><strong className="block text-lg">{c.sent_count}</strong>Aceitas</div><div className="bg-red-50 rounded p-2"><strong className="block text-lg">{c.failed_count}</strong>Falhas</div><div className="bg-slate-100 rounded p-2"><strong className="block text-lg">{c.daily_limit}</strong>Limite/dia</div></div>
   {c.scheduled_at&&<p className="text-xs text-slate-500">Programada: {new Date(c.scheduled_at).toLocaleString('pt-BR')}</p>}
   <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-100">
   {c.status==='draft'&&<button className="btn-primary text-xs" disabled={saving} onClick={()=>void activate(c)}><Play size={14}/> Ativar</button>}
   {['scheduled','sending'].includes(c.status)&&<button className="btn-secondary text-xs" disabled={saving} onClick={()=>void run(()=>apiRequest(`/operations/campaigns/${c.id}/pause`,{method:'POST'}),'Campanha pausada')}><Pause size={14}/> Pausar</button>}
   {c.status==='paused'&&<button className="btn-primary text-xs" disabled={saving} onClick={()=>void run(()=>apiRequest(`/operations/campaigns/${c.id}/resume`,{method:'POST'}),'Campanha retomada')}><RotateCcw size={14}/> Retomar</button>}
   {['draft','completed','paused','failed'].includes(c.status)&&<button className="btn-ghost text-xs text-red-600" disabled={saving} onClick={()=>{if(window.confirm(`Excluir campanha ${c.name} e sua lista de destinatários?`))void run(()=>apiRequest(`/operations/campaigns/${c.id}`,{method:'DELETE'}),'Campanha excluída');}}><Trash2 size={14}/> Excluir</button>}
   <button className="btn-ghost text-xs ml-auto" onClick={()=>void openDetails(c)}><Users size={14}/> Destinatários</button></div>
  </div>)}</div>}
  <Modal open={showForm} onClose={()=>setShowForm(false)} title="Nova campanha" size="lg"><div className="space-y-3">
   <label className="label">Nome *</label><input className="input" value={form.name} onChange={e=>setForm({...form,name:e.target.value})}/>
   <label className="label">WhatsApp responsável *</label><select className="input" value={form.integration_id} onChange={e=>setForm({...form,integration_id:e.target.value})}><option value="">Selecione o número</option>{channels.filter(c=>c.provider==='evolution_api').map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select>
   <label className="label">Mensagem *</label><textarea className="input" rows={4} value={form.message} onChange={e=>setForm({...form,message:e.target.value})} placeholder="Olá, {nome}! ..."/><p className="text-xs text-slate-500">Use {'{nome}'} para inserir o nome do contato.</p>
   <div className="grid grid-cols-2 gap-3"><div><label className="label">Estágio CRM</label><select className="input" value={form.segment_stage} onChange={e=>setForm({...form,segment_stage:e.target.value})}>{STAGES.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></div><div><label className="label">Limite diário (1–30)</label><input type="number" min="1" max="30" className="input" value={form.daily_limit} onChange={e=>setForm({...form,daily_limit:e.target.value})}/></div></div>
   <label className="label">Filtrar pelas etiquetas (contato deve ter todas)</label><div className="flex flex-wrap gap-2">{tags.length?tags.map(t=><label key={t.id} className="text-sm bg-slate-100 rounded px-3 py-1.5"><input type="checkbox" checked={selectedTags.includes(t.id)} onChange={e=>setSelectedTags(prev=>e.target.checked?[...prev,t.id]:prev.filter(x=>x!==t.id))}/> {t.name}</label>):<span className="text-sm text-slate-400">Nenhuma etiqueta cadastrada</span>}</div>
   <label className="label">Data e hora (opcional; se vazia, inicia após ativação)</label><input className="input" type="datetime-local" value={form.scheduled_at} onChange={e=>setForm({...form,scheduled_at:e.target.value})}/>
   <div className="rounded-lg bg-slate-50 p-3 text-xs text-slate-600">Somente contatos com consentimento de marketing registrado e telefone válido entram na lista. Criar não envia mensagens.</div>
   <div className="flex justify-end gap-2"><button className="btn-secondary" onClick={()=>setShowForm(false)}>Cancelar</button><button className="btn-primary" disabled={saving} onClick={()=>void save()}>Salvar rascunho</button></div></div></Modal>
  <Modal open={Boolean(details)} onClose={()=>setDetails(null)} title={`Destinatários — ${details?.name||''}`} size="lg"><div className="space-y-3 text-sm">
    <p className="text-slate-600">{preview===null?'Calculando…':`${preview} contato(s) elegível(is) hoje, com consentimento e telefone válido.`} Lista real de envios: {recipients.length} registro(s).</p>
    <button className="btn-secondary text-xs" onClick={()=>{if(details)void openDetails(details)}}><RefreshCw size={14}/> Atualizar</button>
    <div className="max-h-80 overflow-auto space-y-2">{recipients.length?recipients.map(r=><div key={r.id} className="border-b border-slate-100 pb-2"><div className="flex justify-between"><strong>{r.contact?.name||'Contato'}</strong><span>{r.status}</span></div>{r.error&&<p className="text-xs text-red-600">{r.error}</p>}{r.sent_at&&<p className="text-xs text-slate-500">Aceita: {new Date(r.sent_at).toLocaleString('pt-BR')}</p>}</div>):<p className="text-slate-400">Nenhum envio preparado. Ative o rascunho para congelar o público.</p>}</div>
   </div></Modal>
  <Modal open={consentOpen} onClose={()=>setConsentOpen(false)} title="Consentimento para campanhas" size="lg"><div className="space-y-3"><p className="text-sm text-amber-800 bg-amber-50 p-2 rounded">Marque apenas quando o próprio cliente autorizou receber campanhas. A confirmação fica registrada com origem e data.</p><div className="max-h-96 overflow-auto space-y-1">{consents.map(c=><div key={c.id} className="flex items-center justify-between gap-2 border-b py-2"><div className="min-w-0"><p className="text-sm font-semibold truncate">{c.name}</p><p className="text-xs text-slate-500">{c.phone||'Sem telefone'}</p></div><button className={`text-xs ${c.opt_in?'btn-secondary':'btn-primary'}`} onClick={()=>void toggleConsent(c)}>{c.opt_in?'Revogar':'Registrar autorização'}</button></div>)}</div></div></Modal>
 </div>;
}
