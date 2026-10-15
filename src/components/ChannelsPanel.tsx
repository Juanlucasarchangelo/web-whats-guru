import { useCallback, useEffect, useState } from 'react';
import { apiRequest } from '@/lib/api';
import { toastError, toastSuccess } from '@/components/ui/Toast';
import { Loader2, Plus, RefreshCw, ShieldCheck, Smartphone } from 'lucide-react';
type Channel={id:string;name:string;instance_name:string|null;provider_url:string|null;status:string;team_ids:string[];provider:string};
type AttachResponse={channel:Channel;webhook?:{ok:boolean;error?:string|null;verified?:boolean}};
export function ChannelsPanel({canManage=true}:{canManage?:boolean}){
 const [channels,setChannels]=useState<Channel[]>([]);const [busy,setBusy]=useState(false);const [adding,setAdding]=useState(false);
 const [providerUrl,setProviderUrl]=useState('http://127.0.0.1:8080');const [instance,setInstance]=useState('');const [apiKey,setApiKey]=useState('');const [name,setName]=useState('');
 const [info,setInfo]=useState<string|null>(null);
 const load=useCallback(async()=>{try{const r=await apiRequest<{data:Channel[]}>('/channels');setChannels(r.data||[]);}catch(e){console.warn('[Canais]',e);}},[]);
 useEffect(()=>{void load();},[load]);
 async function attach(){if(!instance.trim()||!providerUrl.trim()||!apiKey.trim())return;setBusy(true);setInfo(null);
  try{const r=await apiRequest<AttachResponse>('/channels/attach',{method:'POST',body:JSON.stringify({provider_url:providerUrl.trim(),instance_name:instance.trim(),api_key:apiKey.trim(),...(name.trim()?{name:name.trim()}:{})})});
   setApiKey('');setInstance('');setName('');setAdding(false);await load();
   if(r.webhook?.ok){setInfo('Instância cadastrada e webhook registrado. Faça o teste com outro celular.');toastSuccess('WhatsApp adicional cadastrado');}
   else {setInfo(`Instância cadastrada, mas webhook ainda não está ativo: ${r.webhook?.error??'Verifique o webhook manualmente.'}`);toastSuccess('Instância cadastrada');}
  }catch(e){toastError(e instanceof Error?e.message:'Falha ao cadastrar instância');}finally{setBusy(false);}}
 async function webhook(id:string){setBusy(true);setInfo(null);
  try{const r=await apiRequest<{webhook:{verified?:boolean}}>('/channels/'+id+'/webhook',{method:'POST'});
   setInfo(r.webhook?.verified?'Webhook confirmado para este WhatsApp.':'Registro solicitado; verifique o recebimento de uma mensagem.');toastSuccess('Webhook configurado');}
  catch(e){toastError(e instanceof Error?e.message:'Falha ao ativar webhook');}finally{setBusy(false);}}
 async function status(id:string){setBusy(true);try{const r=await apiRequest<{status:string}>('/channels/'+id+'/status',{method:'POST'});setInfo(`Estado informado pela Evolution: ${r.status}`);await load();}catch(e){toastError(e instanceof Error?e.message:'Erro ao consultar instância');}finally{setBusy(false);}}
 return <div className="card p-5 space-y-4">
  <div className="flex flex-wrap justify-between gap-3 items-start"><div><h2 className="font-semibold text-slate-900 flex items-center gap-2"><Smartphone size={18}/> Meus números de WhatsApp</h2>
   <p className="text-sm text-slate-500 mt-1">Gerencie várias instâncias da Evolution. A mesma empresa pode atender clientes por números diferentes, sem misturar os históricos.</p></div>
   {canManage&&<button className="btn-primary text-sm" onClick={()=>setAdding(!adding)}><Plus size={15}/> Adicionar número existente</button>}</div>
  {!channels.length?<p className="text-sm text-slate-500">Nenhum número cadastrado. Configure o primeiro acima ou adicione uma instância que já existe na Evolution.</p>:<div className="space-y-2">{channels.map(c=><div className="p-3 rounded-lg border border-slate-200 flex justify-between items-center gap-3 flex-wrap" key={c.id}>
   <div><p className="text-sm font-medium">{c.name} <span className="font-normal text-slate-500">· {c.instance_name||'Meta oficial'}</span></p>
    <p className="text-xs text-slate-500">{c.provider==='evolution_api'?'Evolution API':'API oficial'} · {c.status==='connected'?'Conectado':c.status==='connecting'?'Conectando':'Desconectado'} · {c.team_ids.length?`${c.team_ids.length} time(s) autorizado(s)`:'Sem restrição por time'}</p></div>
   {canManage&&c.provider==='evolution_api'&&<div className="flex gap-2 flex-wrap"><button disabled={busy} className="btn-secondary text-xs" onClick={()=>void status(c.id)}><RefreshCw size={14}/> Verificar</button>
    <button disabled={busy} className="btn-secondary text-xs" onClick={()=>void webhook(c.id)}><ShieldCheck size={14}/> Ativar webhook</button></div>}</div>)}</div>}
  {info&&<p className="text-sm p-3 rounded-lg bg-blue-50 text-blue-800">{info}</p>}
  {canManage&&adding&&<div className="rounded-lg border border-blue-200 bg-blue-50 p-4 space-y-3"><strong className="text-sm">Vincular uma instância já criada na Evolution</strong>
   <p className="text-xs text-blue-700">Informe a mesma API Key usada na Evolution. O Whats-Guru não exclui nem desconecta seus números existentes.</p>
   <div><label className="label">Nome amigável (opcional)</label><input className="input" value={name} onChange={e=>setName(e.target.value)} placeholder="Ex.: Vendas"/></div>
   <div><label className="label">URL da Evolution</label><input className="input" value={providerUrl} onChange={e=>setProviderUrl(e.target.value)} placeholder="http://127.0.0.1:8080"/></div>
   <div><label className="label">Nome exato da instância</label><input className="input" value={instance} onChange={e=>setInstance(e.target.value)} placeholder="meu-segundo-whatsapp"/></div>
   <div><label className="label">Evolution API Key</label><input className="input" type="password" autoComplete="off" value={apiKey} onChange={e=>setApiKey(e.target.value)} placeholder="Cole a chave da sua Evolution"/></div>
   <div className="flex justify-end gap-2"><button className="btn-secondary" onClick={()=>setAdding(false)}>Cancelar</button>
    <button className="btn-primary" disabled={busy||!instance||!providerUrl||!apiKey} onClick={()=>void attach()}>{busy?<Loader2 size={16} className="animate-spin"/>:<Plus size={16}/>} Vincular instância</button></div></div>}
  <p className="text-xs text-slate-500">Para definir quais atendentes enxergam cada número, abra Equipe & Permissões → Permissões por WhatsApp.</p>
 </div>;
}
