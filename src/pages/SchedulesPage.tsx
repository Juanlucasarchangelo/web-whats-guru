import { useCallback, useEffect, useState } from 'react';
import { useOrg } from '@/contexts/OrgContext';
import { apiRequest } from '@/lib/api';
import { supabase } from '@/lib/supabase';
import { Modal } from '@/components/ui/Modal';
import { Spinner } from '@/components/ui/Spinner';
import { toastError, toastSuccess } from '@/components/ui/Toast';
import { CalendarClock, Plus, Trash2, XCircle, Play, Pencil, RefreshCw } from 'lucide-react';
import type { Contact, Schedule } from '@/types';

type Row=Schedule & { integration_id?:string|null; delivery_enabled?:boolean;contact?:{name:string}|null };
type Channel={id:string;name:string;provider?:string};
const empty={title:'',contact_id:'',integration_id:'',message:'',scheduled_at:'',send_whatsapp:true};
const labels:Record<string,string>={pending:'Pendente',processing:'Processando',sent:'Aceita pela Evolution',cancelled:'Cancelado',failed:'Falha - revisar',done:'Concluído'};
export function SchedulesPage(){
 const {currentOrg}=useOrg();const [rows,setRows]=useState<Row[]>([]);const [contacts,setContacts]=useState<Contact[]>([]);const [channels,setChannels]=useState<Channel[]>([]);
 const [form,setForm]=useState(empty);const [editId,setEditId]=useState<string|null>(null);const [open,setOpen]=useState(false);const [loading,setLoading]=useState(true);const [saving,setSaving]=useState(false);
 const load=useCallback(async(silent=false)=>{if(!currentOrg?.id)return;if(!silent)setLoading(true);
  try{const [a,b,c]=await Promise.all([apiRequest<{data:Row[]}>('/operations/schedules'),supabase.from('contacts').select('*').eq('org_id',currentOrg.id).order('name'),apiRequest<{data:Channel[]}>('/operations/channels')]);
   setRows(a.data);setContacts((b.data||[]) as Contact[]);setChannels(c.data);
  }catch(e){toastError(e instanceof Error?e.message:'Falha ao carregar agendamentos');}finally{setLoading(false);}
 },[currentOrg?.id]);
 useEffect(()=>{void load();const t=window.setInterval(()=>void load(true),12000);return()=>window.clearInterval(t);},[load]);
 async function run(action:()=>Promise<unknown>,message:string){setSaving(true);try{await action();toastSuccess(message);await load(true);}catch(e){toastError(e instanceof Error?e.message:'Falha na operação');}finally{setSaving(false);}}
 function create(){setEditId(null);setForm(empty);setOpen(true);}
 function edit(r:Row){if(r.status!=='pending')return;setEditId(r.id);setForm({title:r.title,contact_id:r.contact_id||'',integration_id:r.integration_id||'',message:r.message||'',scheduled_at:toLocal(r.scheduled_at),send_whatsapp:Boolean(r.delivery_enabled)});setOpen(true);}
 async function save(){if(!form.title.trim()||!form.scheduled_at)return toastError('Informe título, data e hora.');if(form.send_whatsapp&&(!form.contact_id||!form.integration_id||!form.message.trim()))return toastError('Para enviar pelo WhatsApp, informe contato, número e mensagem.');
  if(new Date(form.scheduled_at)<=new Date())return toastError('A data precisa estar no futuro.');
  const body={title:form.title,contact_id:form.contact_id||null,integration_id:form.integration_id||null,message:form.message||null,scheduled_at:new Date(form.scheduled_at).toISOString(),send_whatsapp:form.send_whatsapp};
  await run(async()=>{await apiRequest(editId?`/operations/schedules/${editId}`:'/operations/schedules',{method:editId?'PATCH':'POST',body:JSON.stringify(body)});setOpen(false);},editId?'Agendamento alterado.':'Agendamento criado.');
 }
 async function viewLog(r:Row){try{const resp=await apiRequest<{data:{action:string;details:{error?:string};created_at:string}[]}>(`/operations/schedules/${r.id}/log`);const latest=resp.data[0];window.alert(latest?.details?.error||'Sem detalhes adicionais no log. Confira o terminal do backend.');}catch(e){toastError(e instanceof Error?e.message:'Erro ao carregar log');}}
 const pending=rows.filter(r=>r.status==='pending');const history=rows.filter(r=>r.status!=='pending');
 return <div className="p-4 lg:p-7 max-w-6xl mx-auto space-y-5">
  <div className="flex flex-wrap justify-between items-center gap-2"><div><h1 className="text-2xl font-bold text-slate-900">Agendamentos</h1><p className="text-sm text-slate-500">Lembretes internos ou mensagens automáticas por WhatsApp</p></div><button className="btn-primary" onClick={create}><Plus size={16}/> Novo agendamento</button></div>
  <div className="p-3 rounded-lg bg-blue-50 border border-blue-100 text-sm text-blue-900">Agendamentos novos com envio ativado são processados enquanto o backend estiver ligado (consulta a cada 30 segundos). Mensagem aceita não significa entrega confirmada. Agendamentos antigos permanecem sem disparo automático até serem editados e ativados.</div>
  {loading?<Spinner/>:<div className="space-y-6"><section><h2 className="text-lg font-semibold mb-3">Próximos ({pending.length})</h2>{!pending.length?<p className="card p-6 text-slate-500">Nenhum agendamento pendente.</p>:<div className="space-y-3">{pending.map(r=><ScheduleCard key={r.id} r={r} channel={channels.find(c=>c.id===r.integration_id)?.name} busy={saving} onEdit={()=>edit(r)} onCancel={()=>{if(window.confirm(`Cancelar agendamento ${r.title}?`))void run(()=>apiRequest(`/operations/schedules/${r.id}/cancel`,{method:'POST'}),'Agendamento cancelado.');}} onNow={()=>{if(window.confirm(`Enviar agora a mensagem real para ${r.contact?.name||'o contato'}?`))void run(()=>apiRequest(`/operations/schedules/${r.id}/send-now`,{method:'POST'}),'Envio antecipado incluído na fila. Aguarde até 30 segundos.');}} onDone={()=>void run(()=>apiRequest(`/operations/schedules/${r.id}/complete`,{method:'POST'}),'Lembrete concluído.')} onLog={()=>void viewLog(r)} onDelete={()=>{}}/>)}</div>}</section>
   <section><h2 className="text-lg font-semibold mb-3">Histórico ({history.length})</h2><div className="space-y-2">{history.map(r=><ScheduleCard key={r.id} r={r} channel={channels.find(c=>c.id===r.integration_id)?.name} busy={saving} onEdit={()=>{}} onCancel={()=>{}} onNow={()=>{}} onDone={()=>{}} onLog={()=>void viewLog(r)} onDelete={()=>{if(window.confirm(`Excluir registro de ${r.title}?`))void run(()=>apiRequest(`/operations/schedules/${r.id}`,{method:'DELETE'}),'Registro excluído.');}}/>)}</div></section>
  </div>}
  <Modal open={open} onClose={()=>setOpen(false)} title={editId?'Editar agendamento':'Novo agendamento'} size="md"><div className="space-y-3">
   <div><label className="label">Título *</label><input className="input" value={form.title} onChange={e=>setForm({...form,title:e.target.value})} placeholder="Ex.: Retornar orçamento"/></div>
   <div><label className="label">Data e hora *</label><input type="datetime-local" className="input" value={form.scheduled_at} onChange={e=>setForm({...form,scheduled_at:e.target.value})}/></div>
   <label className="flex items-center gap-2 bg-slate-50 p-3 rounded text-sm"><input type="checkbox" checked={form.send_whatsapp} onChange={e=>setForm({...form,send_whatsapp:e.target.checked})}/> Enviar mensagem pelo WhatsApp automaticamente</label>
   {form.send_whatsapp&&<><div><label className="label">Número remetente *</label><select className="input" value={form.integration_id} onChange={e=>setForm({...form,integration_id:e.target.value})}><option value="">Selecione</option>{channels.filter(c=>c.provider==='evolution_api').map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
    <div><label className="label">Contato destinatário *</label><select className="input" value={form.contact_id} onChange={e=>setForm({...form,contact_id:e.target.value})}><option value="">Selecione</option>{contacts.map(c=><option key={c.id} value={c.id}>{c.name}{c.phone?` · ${c.phone}`:''}</option>)}</select></div></>}
   <div><label className="label">{form.send_whatsapp?'Mensagem que será enviada *':'Anotações (opcional)'}</label><textarea className="input" rows={3} value={form.message} onChange={e=>setForm({...form,message:e.target.value})}/></div>
   <div className="flex justify-end gap-2"><button className="btn-secondary" onClick={()=>setOpen(false)}>Cancelar</button><button className="btn-primary" disabled={saving} onClick={()=>void save()}>{editId?'Salvar alterações':'Criar agendamento'}</button></div>
  </div></Modal>
 </div>;
}
function toLocal(iso:string){const d=new Date(iso);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}T${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;}
function ScheduleCard({r,channel,busy,onEdit,onCancel,onNow,onDone,onLog,onDelete}:{r:Row;channel?:string;busy:boolean;onEdit:()=>void;onCancel:()=>void;onNow:()=>void;onDone:()=>void;onLog:()=>void;onDelete:()=>void}){
 return <div className="card p-4 flex flex-wrap items-center justify-between gap-3"><div className="min-w-0"><div className="flex gap-2 items-center"><CalendarClock size={16} className="text-blue-500"/><strong className="text-sm text-slate-900">{r.title}</strong><span className="badge badge-gray">{labels[r.status]||r.status}</span></div>
  <p className="text-xs text-slate-500 mt-1">{new Date(r.scheduled_at).toLocaleString('pt-BR')} · {r.delivery_enabled?`WhatsApp ${channel||''} → ${r.contact?.name||'Contato'}`:'Lembrete interno'}</p>
  {r.message&&<p className="text-sm text-slate-600 mt-2 line-clamp-2">{r.message}</p>}
 </div><div className="flex gap-2">{r.status==='pending'?<><button className="btn-ghost text-xs" disabled={busy} onClick={onEdit}><Pencil size={15}/> Editar</button>{!r.delivery_enabled&&<button className="btn-secondary text-xs" disabled={busy} onClick={onDone}>Concluir</button>}{r.delivery_enabled&&<button className="btn-secondary text-xs" disabled={busy} onClick={onNow}><Play size={14}/> Enviar agora</button>}<button className="btn-ghost text-xs text-red-600" disabled={busy} onClick={onCancel}><XCircle size={14}/> Cancelar</button></>:<>{r.status==='failed'&&<button className="btn-secondary text-xs" onClick={onLog}>Ver erro</button>}<button className="btn-ghost text-xs text-red-600" disabled={busy} onClick={onDelete}><Trash2 size={14}/> Excluir</button></>}</div></div>;
}
