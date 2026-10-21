import { useCallback, useEffect, useMemo, useState } from 'react';
import { useOrg } from '@/contexts/OrgContext';
import { supabase } from '@/lib/supabase';
import { apiRequest } from '@/lib/api';
import { toastError, toastSuccess } from '@/components/ui/Toast';
import { Modal } from '@/components/ui/Modal';
import { CrmConversationModal } from '@/components/CrmConversationModal';
import { Spinner } from '@/components/ui/Spinner';
import { GripVertical, Search, Pencil, Phone, CircleDollarSign, RefreshCw, Plus, Tags, Trash2, Columns3, List, MessageCircle } from 'lucide-react';
import type { Contact, Tag } from '@/types';

type Link = { contact_id: string; tag_id: string };
const brl = (n:number) => n.toLocaleString('pt-BR', { style:'currency', currency:'BRL' });

export function CrmPage() {
 const {currentOrg} = useOrg();
 const [contacts,setContacts] = useState<Contact[]>([]);
 const [tags,setTags] = useState<Tag[]>([]);
 const [links,setLinks] = useState<Link[]>([]);
 const [loading,setLoading] = useState(true);
 const [search,setSearch] = useState('');
 const [view,setView] = useState<'kanban'|'list'>('kanban');
 const [tagFilter,setTagFilter] = useState('all');
 const [draggedColumn,setDraggedColumn] = useState<string|null>(null);
 const [columnOver,setColumnOver] = useState<string|null>(null);
 const [sortingColumns,setSortingColumns] = useState(false);
 const [chatContact,setChatContact] = useState<Contact|null>(null);
 const [dragged,setDragged] = useState<{id:string;from:string}|null>(null);
 const [over,setOver] = useState<string|null>(null);
 const [editing,setEditing] = useState<Contact|null>(null);
 const [editValue,setEditValue] = useState('0');
 const [editNotes,setEditNotes] = useState('');
 const [editTags,setEditTags] = useState<string[]>([]);
 const [saving,setSaving] = useState(false);
 const [newOpen,setNewOpen] = useState(false);
 const [newLead,setNewLead] = useState({name:'',phone:'',email:'',crm_value:'0',tag_id:''});
 const [tagModal,setTagModal] = useState(false);
 const [tagEditing,setTagEditing] = useState<Tag|null>(null);
 const [tagName,setTagName] = useState('');
 const [tagColor,setTagColor] = useState('#FFC734');

 const load = useCallback(async (silent=false) => {
  if(!currentOrg?.id)return;
  if(!silent)setLoading(true);
  try {
   const [cs,ts,ls] = await Promise.all([
    supabase.from('contacts').select('*').eq('org_id',currentOrg.id).order('updated_at',{ascending:false}),
    supabase.from('tags').select('*').eq('org_id',currentOrg.id).order('created_at',{ascending:true}),
    supabase.from('contact_tags').select('*').limit(1000),
   ]);
   if(cs.error)throw cs.error;if(ts.error)throw ts.error;if(ls.error)throw ls.error;
   setContacts((cs.data||[]) as Contact[]);setTags(((ts.data||[]) as Tag[]).sort((a,b)=>{
    const ap=(a as Tag & {sort_order?:number|null}).sort_order; const bp=(b as Tag & {sort_order?:number|null}).sort_order;
    if(ap!=null&&bp!=null&&ap!==bp)return ap-bp;
    if(ap!=null&&bp==null)return -1;if(ap==null&&bp!=null)return 1;
    return a.created_at.localeCompare(b.created_at)||a.id.localeCompare(b.id);
   }));setLinks((ls.data||[]) as Link[]);
  } catch(e) {toastError(e instanceof Error?e.message:'Erro ao carregar etiquetas e CRM');}
  finally{setLoading(false);}
 },[currentOrg?.id]);
 useEffect(()=>{void load();},[load]);
 // Refresh on return from Inbox, and while the Kanban is visible so automation changes appear.
 useEffect(()=>{const onFocus=()=>void load(true);const onVisible=()=>{if(!document.hidden)void load(true);};
  window.addEventListener('focus',onFocus);document.addEventListener('visibilitychange',onVisible);
  const interval=window.setInterval(()=>{if(!document.hidden)void load(true);},15000);
  return ()=>{window.removeEventListener('focus',onFocus);document.removeEventListener('visibilitychange',onVisible);window.clearInterval(interval);};
 },[load]);
 const idsOf=useCallback((id:string)=>links.filter(l=>l.contact_id===id).map(l=>l.tag_id),[links]);
 const filtered=useMemo(()=>contacts.filter(c=>`${c.name} ${c.email||''} ${c.phone||''}`.toLowerCase().includes(search.toLowerCase()) && (tagFilter==='all'||(tagFilter==='none'?idsOf(c.id).length===0:idsOf(c.id).includes(tagFilter)))),[contacts,search,tagFilter,idsOf]);
 const total=filtered.reduce((sum,c)=>sum+Number(c.crm_value||0),0);
 async function putTag(contactId:string,tagId:string){const {error}=await supabase.from('contact_tags').insert({contact_id:contactId,tag_id:tagId});if(error)throw error;}
 async function removeTag(contactId:string,tagId:string){const {error}=await supabase.from('contact_tags').delete().eq('contact_id',contactId).eq('tag_id',tagId);if(error)throw error;}
 async function move(contactId:string, target:string, from:string){
  if(from===target)return;
  const previous=idsOf(contactId);
  try {
   // Troca apenas a etiqueta desta coluna; preserva outras categorias do contato.
   if(from!=='none'&&previous.includes(from))await removeTag(contactId,from);
   if(target!=='none'&&!previous.includes(target))await putTag(contactId,target);
   toastSuccess('Etiqueta atualizada na conversa e no Kanban.');await load(true);
  }catch(e){toastError(e instanceof Error?e.message:'Não foi possível mover o contato');await load(true);}
 }

 function edit(c:Contact){setEditing(c);setEditValue(String(c.crm_value||0));setEditNotes(String(c.custom_fields?.crm_notes||''));setEditTags(idsOf(c.id));}
 async function save(){if(!editing)return;const val=Number(editValue.replace(',','.'));if(!Number.isFinite(val)||val<0||val>9999999999)return toastError('Valor inválido.');setSaving(true);
  try{
   const {error}=await supabase.from('contacts').update({crm_value:val,custom_fields:{...(editing.custom_fields||{}),crm_notes:editNotes.trim()}}).eq('id',editing.id);if(error)throw error;
   const before=idsOf(editing.id);
   for(const id of before)if(!editTags.includes(id))await removeTag(editing.id,id);
   for(const id of editTags)if(!before.includes(id))await putTag(editing.id,id);
   setEditing(null);toastSuccess('Contato e etiquetas atualizados.');await load(true);
  }catch(e){toastError(e instanceof Error?e.message:'Erro ao salvar contato');}finally{setSaving(false);}
 }
 async function addLead(){if(!currentOrg?.id||newLead.name.trim().length<2)return toastError('Informe o nome do contato.');const val=Number(newLead.crm_value.replace(',','.'));if(!Number.isFinite(val)||val<0)return toastError('Valor inválido.');setSaving(true);
  try{const created=await apiRequest<Contact>('/contacts',{method:'POST',body:JSON.stringify({name:newLead.name.trim(),phone:newLead.phone.trim()||null,email:newLead.email.trim()||null,crm_stage:'lead',crm_value:val,custom_fields:{}})});
   if(newLead.tag_id)await putTag(created.id,newLead.tag_id);
   setNewOpen(false);setNewLead({name:'',phone:'',email:'',crm_value:'0',tag_id:''});toastSuccess('Oportunidade criada.');await load(true);
  }catch(e){toastError(e instanceof Error?e.message:'Erro ao criar contato');}finally{setSaving(false);}
 }
 function openTag(tag?:Tag){setTagEditing(tag||null);setTagName(tag?.name||'');setTagColor(tag?.color||'#FFC734');setTagModal(true);}
 async function saveTag(){if(!currentOrg?.id||!tagName.trim())return toastError('Informe o nome da etiqueta.');if(tags.some(t=>t.name.toLowerCase()===tagName.trim().toLowerCase()&&t.id!==tagEditing?.id))return toastError('Essa etiqueta já existe.');setSaving(true);
  try{const payload={name:tagName.trim(),color:tagColor};const r=tagEditing?await supabase.from('tags').update(payload).eq('id',tagEditing.id):await supabase.from('tags').insert({...payload,org_id:currentOrg.id});if(r.error)throw r.error;setTagModal(false);toastSuccess(tagEditing?'Etiqueta atualizada.':'Coluna criada.');await load(true);}
  catch(e){toastError(e instanceof Error?e.message:'Erro ao salvar etiqueta');}finally{setSaving(false);}
 }
 async function deleteTag(tag:Tag){if(!window.confirm(`Excluir a etiqueta "${tag.name}"? Ela será removida dos contatos e conversas, mas nenhum histórico será excluído.`))return;
  const r=await supabase.from('tags').delete().eq('id',tag.id);if(r.error)return toastError(r.error.message);toastSuccess('Etiqueta excluída.');await load(true);
 }
 async function reorderColumn(source:string,target:string){
  setDraggedColumn(null);setColumnOver(null);
  if(source===target||sortingColumns)return;
  const current=[...tags];const from=current.findIndex(t=>t.id===source);const to=current.findIndex(t=>t.id===target);
  if(from<0||to<0)return;
  const [moved]=current.splice(from,1);current.splice(to,0,moved);
  setTags(current);setSortingColumns(true);
  try{
   // Persiste a ordem no MySQL para todos os usuarios e dispositivos.
   for(let i=0;i<current.length;i++){
    const {error}=await supabase.from('tags').update({sort_order:i}).eq('id',current[i].id);
    if(error)throw error;
   }
   toastSuccess('Ordem das colunas salva.');
  }catch(e){toastError(e instanceof Error?e.message:'Erro ao ordenar colunas');await load(true);}
  finally{setSortingColumns(false);}
 }
 // Apenas etiquetas cadastradas são colunas do Kanban. Contatos sem etiqueta permanecem na Lista.
 const columns=tags.map(t=>({id:t.id,name:t.name,color:t.color}));
 return <div className="p-4 lg:p-6 h-full flex flex-col gap-4">
  <div className="flex flex-wrap items-center justify-between gap-2"><div><h1 className="text-2xl font-bold text-slate-900">CRM Kanban</h1><p className="text-sm text-slate-500">{filtered.length} contato(s) · Valor estimado: {brl(total)}</p></div><div className="flex flex-wrap gap-2"><button className="btn-secondary" onClick={()=>void load()}><RefreshCw size={16}/> Atualizar</button><button className="btn-secondary" onClick={()=>openTag()}><Tags size={16}/> Nova etiqueta</button><button className="btn-primary" onClick={()=>setNewOpen(true)}><Plus size={16}/> Nova oportunidade</button></div></div>
  <div className="flex flex-wrap items-center justify-between gap-3">
   <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1" role="group" aria-label="Visualização do CRM">
    <button type="button" onClick={()=>{setTagFilter(current=>current==='none'?'all':current);setView('kanban');}} aria-pressed={view==='kanban'} className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm ${view==='kanban'?'bg-white font-semibold shadow-sm text-blue-700':'text-slate-600'}`}><Columns3 size={16}/> Kanban</button>
    <button type="button" onClick={()=>setView('list')} aria-pressed={view==='list'} className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm ${view==='list'?'bg-white font-semibold shadow-sm text-blue-700':'text-slate-600'}`}><List size={16}/> Lista</button>
   </div>
   <div className="flex flex-wrap items-center gap-2">
    <div className="flex gap-2 items-center bg-white border border-slate-200 rounded-lg px-3 min-w-[180px]"><Search size={17} className="text-slate-400"/><input className="py-2.5 outline-none flex-1 min-w-0 text-sm" placeholder="Buscar contato" value={search} onChange={e=>setSearch(e.target.value)}/></div>
    <select className="input text-sm w-auto max-w-[220px]" aria-label="Filtrar por etiqueta" value={tagFilter} onChange={e=>setTagFilter(e.target.value)}><option value="all">Todas as etiquetas</option>{view==='list'&&<option value="none">Sem etiqueta</option>}{tags.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select>
   </div>
  </div>
  <p className="text-xs text-slate-500">{view==='kanban'?'Colunas por ordem de criação. Arraste o cabeçalho para reorganizar; arraste o card para mudar sua etiqueta.':'Cada contato aparece uma única vez. Veja todas as etiquetas na mesma linha e filtre pelo seletor.'} Clique no contato para abrir a conversa.</p>
  {loading?<div className="mx-auto p-10"><Spinner/></div>:view==='list'?
   <div className="min-h-0 flex-1 overflow-auto rounded-xl border border-slate-200 bg-white">
    <table className="w-full min-w-[780px] border-collapse text-left text-sm">
     <thead className="sticky top-0 z-10 bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-4 py-3 font-semibold">Contato</th><th className="px-3 py-3 font-semibold">Telefone</th><th className="px-3 py-3 w-[210px] font-semibold">Etiquetas</th><th className="px-3 py-3 text-right font-semibold">Valor</th><th className="px-4 py-3 w-[100px] text-right font-semibold">Ações</th></tr></thead>
     <tbody className="divide-y divide-slate-100">{filtered.map(c=>{const contactTags=tags.filter(t=>idsOf(c.id).includes(t.id));return <tr key={c.id} className="hover:bg-blue-50/50 cursor-pointer" onClick={()=>setChatContact(c)} title="Abrir conversa">
      <td className="px-4 py-2.5"><div className="font-medium text-slate-900 truncate max-w-[290px]">{c.name}</div>{c.email&&<div className="text-xs text-slate-400 truncate max-w-[290px]">{c.email}</div>}</td>
      <td className="px-3 py-2.5 text-slate-600 whitespace-nowrap">{c.phone||'—'}</td>
      <td className="px-3 py-2.5"><div className="flex max-w-[200px] flex-nowrap items-center gap-1 overflow-hidden" title={contactTags.map(t=>t.name).join(', ')}>{contactTags.length?contactTags.slice(0,2).map(t=><span key={t.id} className="inline-flex max-w-[92px] shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium" style={{borderColor:`${t.color}66`,backgroundColor:`${t.color}12`,color:t.color}}><span className="truncate">{t.name}</span></span>):<span className="text-xs text-slate-400">Sem etiqueta</span>}{contactTags.length>2&&<span className="shrink-0 text-xs font-semibold text-slate-500">+{contactTags.length-2}</span>}</div></td>
      <td className="px-3 py-2.5 text-right whitespace-nowrap font-medium text-slate-800">{brl(Number(c.crm_value||0))}</td>
      <td className="px-4 py-2.5"><div className="flex justify-end gap-3"><button type="button" title="Editar oportunidade" className="text-slate-500 hover:text-blue-600" onClick={e=>{e.stopPropagation();edit(c);}}><Pencil size={16}/></button><button type="button" title="Abrir conversa" className="text-blue-600" onClick={e=>{e.stopPropagation();setChatContact(c);}}><MessageCircle size={17}/></button></div></td>
     </tr>;})}</tbody>
    </table>
    {!filtered.length&&<div className="py-12 text-center text-sm text-slate-400">Nenhum contato encontrado.</div>}
   </div>
   :<div className="overflow-x-auto flex-1 pb-4"><div className="flex gap-4 min-w-max h-full">{columns.map(col=>{
    const list=filtered.filter(c=>idsOf(c.id).includes(col.id));
    return <div key={col.id} className={`w-72 rounded-xl bg-slate-100/70 flex flex-col ${over===col.id?'ring-2 ring-blue-400':''} ${columnOver===col.id?'ring-2 ring-indigo-400':''}`} onDragOver={e=>{e.preventDefault();if(draggedColumn){setColumnOver(col.id);}else{setOver(col.id);}}} onDragLeave={()=>{setOver(null);setColumnOver(null);}} onDrop={e=>{e.preventDefault();if(draggedColumn){void reorderColumn(draggedColumn,col.id);}else if(dragged){void move(dragged.id,col.id,dragged.from);}setDragged(null);setOver(null);setColumnOver(null);}}>
     <div draggable={!sortingColumns} onDragStart={e=>{e.stopPropagation();setDraggedColumn(col.id);setDragged(null);e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',col.id);}} onDragEnd={()=>{setDraggedColumn(null);setColumnOver(null);}} title="Arraste este cabeçalho para reordenar colunas" className={`border-t-4 bg-white rounded-t-xl px-4 py-3 flex items-center gap-2 cursor-grab active:cursor-grabbing`} style={{borderTopColor:col.color}}><GripVertical size={16} className="text-slate-400 shrink-0"/><div className="flex-1 min-w-0"><strong className="text-sm truncate block">{col.name}</strong><p className="text-xs text-slate-500">{brl(list.reduce((s,c)=>s+Number(c.crm_value||0),0))}</p></div><span className="badge badge-gray">{list.length}</span><button title="Editar etiqueta" onClick={()=>openTag(tags.find(t=>t.id===col.id))}><Pencil size={14}/></button><button title="Excluir etiqueta" onClick={()=>void deleteTag(tags.find(t=>t.id===col.id)!)}><Trash2 size={14}/></button></div>
     <div className="p-2 space-y-2 overflow-y-auto">{list.map(c=><div key={c.id} draggable onDragStart={e=>{e.stopPropagation();setDragged({id:c.id,from:col.id});setDraggedColumn(null);e.dataTransfer.effectAllowed='move';}} onDragEnd={()=>{setDragged(null);setOver(null);}} className="bg-white p-3 rounded-lg border border-slate-200 cursor-pointer hover:shadow-sm space-y-2" onClick={()=>setChatContact(c)} title="Abrir conversa"><div className="flex items-center gap-2"><GripVertical size={14} className="text-slate-300"/><strong className="text-sm flex-1 truncate">{c.name}</strong><button className="text-blue-600" title="Editar oportunidade" onClick={e=>{e.stopPropagation();edit(c);}}><Pencil size={15}/></button></div>{Number(c.crm_value)>0&&<p className="text-sm text-green-700"><CircleDollarSign size={14} className="inline mr-1"/>{brl(Number(c.crm_value))}</p>}{c.phone&&<p className="text-xs text-slate-500"><Phone size={12} className="inline mr-1"/>{c.phone}</p>}<select className="input text-xs py-1" aria-label={`Mover ${c.name}`} value={col.id} onClick={e=>e.stopPropagation()} onChange={e=>void move(c.id,e.target.value,col.id)}>{columns.map(opt=><option key={opt.id} value={opt.id}>{opt.name}</option>)}</select></div>)}{list.length===0&&<p className="text-xs text-center text-slate-400 p-5">Arraste contatos aqui</p>}</div>
    </div>;
   })}</div></div>}
  {chatContact&&<CrmConversationModal contact={chatContact} onClose={()=>setChatContact(null)}/>}
  <Modal open={tagModal} onClose={()=>setTagModal(false)} title={tagEditing?'Editar etiqueta':'Nova etiqueta / coluna'} size="sm"><div className="space-y-3"><div><label className="label">Nome *</label><input className="input" maxLength={191} value={tagName} onChange={e=>setTagName(e.target.value)}/></div><div><label className="label">Cor</label><input type="color" value={tagColor} onChange={e=>setTagColor(e.target.value)}/></div><div className="flex justify-end gap-2"><button className="btn-secondary" onClick={()=>setTagModal(false)}>Cancelar</button><button className="btn-primary" disabled={saving} onClick={()=>void saveTag()}>Salvar</button></div></div></Modal>
  <Modal open={newOpen} onClose={()=>setNewOpen(false)} title="Nova oportunidade" size="md"><div className="space-y-3"><div><label className="label">Nome *</label><input className="input" value={newLead.name} onChange={e=>setNewLead({...newLead,name:e.target.value})}/></div><div><label className="label">WhatsApp / telefone</label><input className="input" value={newLead.phone} onChange={e=>setNewLead({...newLead,phone:e.target.value})}/></div><div><label className="label">E-mail</label><input className="input" value={newLead.email} onChange={e=>setNewLead({...newLead,email:e.target.value})}/></div><div><label className="label">Valor estimado (R$)</label><input className="input" value={newLead.crm_value} onChange={e=>setNewLead({...newLead,crm_value:e.target.value})}/></div><div><label className="label">Coluna</label><select className="input" value={newLead.tag_id} onChange={e=>setNewLead({...newLead,tag_id:e.target.value})}><option value="">Sem etiqueta</option>{tags.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select></div><div className="flex justify-end gap-2"><button className="btn-secondary" onClick={()=>setNewOpen(false)}>Cancelar</button><button className="btn-primary" disabled={saving} onClick={()=>void addLead()}>Criar</button></div></div></Modal>
  <Modal open={Boolean(editing)} onClose={()=>setEditing(null)} title={`Oportunidade — ${editing?.name||''}`} size="md"><div className="space-y-3"><div><label className="label">Etiquetas (podem ser múltiplas)</label><div className="flex flex-wrap gap-2">{tags.map(t=><label key={t.id} className="flex gap-2 items-center text-sm border rounded-lg px-2 py-1"><input type="checkbox" checked={editTags.includes(t.id)} onChange={e=>setEditTags(v=>e.target.checked?[...v,t.id]:v.filter(x=>x!==t.id))}/><span style={{color:t.color}}>●</span>{t.name}</label>)}</div></div><div><label className="label">Valor estimado (R$)</label><input className="input" value={editValue} onChange={e=>setEditValue(e.target.value)}/></div><div><label className="label">Anotações comerciais</label><textarea className="input" rows={4} value={editNotes} onChange={e=>setEditNotes(e.target.value)}/></div><div className="flex justify-end gap-2"><button className="btn-secondary" onClick={()=>setEditing(null)}>Cancelar</button><button className="btn-primary" disabled={saving} onClick={()=>void save()}>Salvar</button></div></div></Modal>
 </div>;
}
