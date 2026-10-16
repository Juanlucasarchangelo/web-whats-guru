import { useCallback, useEffect, useMemo, useState } from 'react';
import { useOrg } from '@/contexts/OrgContext';
import { supabase } from '@/lib/supabase';
import { apiRequest } from '@/lib/api';
import { toastError, toastSuccess } from '@/components/ui/Toast';
import { Modal } from '@/components/ui/Modal';
import { Spinner } from '@/components/ui/Spinner';
import { GripVertical, Search, Pencil, Phone, CircleDollarSign, RefreshCw, Plus, Tags, Trash2 } from 'lucide-react';
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
 const [tagColor,setTagColor] = useState('#3b82f6');

 const load = useCallback(async (silent=false) => {
  if(!currentOrg?.id)return;
  if(!silent)setLoading(true);
  try {
   const [cs,ts,ls] = await Promise.all([
    supabase.from('contacts').select('*').eq('org_id',currentOrg.id).order('updated_at',{ascending:false}),
    supabase.from('tags').select('*').eq('org_id',currentOrg.id).order('name',{ascending:true}),
    supabase.from('contact_tags').select('*').limit(1000),
   ]);
   if(cs.error)throw cs.error;if(ts.error)throw ts.error;if(ls.error)throw ls.error;
   setContacts((cs.data||[]) as Contact[]);setTags((ts.data||[]) as Tag[]);setLinks((ls.data||[]) as Link[]);
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
 const filtered=useMemo(()=>contacts.filter(c=>`${c.name} ${c.email||''} ${c.phone||''}`.toLowerCase().includes(search.toLowerCase())),[contacts,search]);
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
 function openTag(tag?:Tag){setTagEditing(tag||null);setTagName(tag?.name||'');setTagColor(tag?.color||'#3b82f6');setTagModal(true);}
 async function saveTag(){if(!currentOrg?.id||!tagName.trim())return toastError('Informe o nome da etiqueta.');if(tags.some(t=>t.name.toLowerCase()===tagName.trim().toLowerCase()&&t.id!==tagEditing?.id))return toastError('Essa etiqueta já existe.');setSaving(true);
  try{const payload={name:tagName.trim(),color:tagColor};const r=tagEditing?await supabase.from('tags').update(payload).eq('id',tagEditing.id):await supabase.from('tags').insert({...payload,org_id:currentOrg.id});if(r.error)throw r.error;setTagModal(false);toastSuccess(tagEditing?'Etiqueta atualizada.':'Coluna criada.');await load(true);}
  catch(e){toastError(e instanceof Error?e.message:'Erro ao salvar etiqueta');}finally{setSaving(false);}
 }
 async function deleteTag(tag:Tag){if(!window.confirm(`Excluir a etiqueta "${tag.name}"? Ela será removida dos contatos e conversas, mas nenhum histórico será excluído.`))return;
  const r=await supabase.from('tags').delete().eq('id',tag.id);if(r.error)return toastError(r.error.message);toastSuccess('Etiqueta excluída.');await load(true);
 }
 const columns=[{id:'none',name:'Sem etiqueta',color:'#94a3b8'},...tags.map(t=>({id:t.id,name:t.name,color:t.color}))];
 return <div className="p-4 lg:p-6 h-full flex flex-col gap-4">
  <div className="flex flex-wrap items-center justify-between gap-2"><div><h1 className="text-2xl font-bold text-slate-900">CRM Kanban</h1><p className="text-sm text-slate-500">{filtered.length} contato(s) · Valor estimado: {brl(total)}</p></div><div className="flex flex-wrap gap-2"><button className="btn-secondary" onClick={()=>void load()}><RefreshCw size={16}/> Atualizar</button><button className="btn-secondary" onClick={()=>openTag()}><Tags size={16}/> Nova etiqueta</button><button className="btn-primary" onClick={()=>setNewOpen(true)}><Plus size={16}/> Nova oportunidade</button></div></div>
  <div className="flex gap-2 items-center bg-white border border-slate-200 rounded-lg px-3 max-w-lg"><Search size={17} className="text-slate-400"/><input className="py-2.5 outline-none flex-1 text-sm" placeholder="Buscar contato" value={search} onChange={e=>setSearch(e.target.value)}/></div>
  <p className="text-xs text-slate-500">As etiquetas são as colunas. Arrastar um contato muda a etiqueta desta coluna sem remover as demais; etiquetas adicionadas na Caixa de Entrada ou por automações aparecem aqui.</p>
  {loading?<div className="mx-auto p-10"><Spinner/></div>:<div className="overflow-x-auto flex-1 pb-4"><div className="flex gap-4 min-w-max h-full">{columns.map(col=>{
   const list=filtered.filter(c=>col.id==='none'?idsOf(c.id).length===0:idsOf(c.id).includes(col.id));
   return <div key={col.id} className={`w-72 rounded-xl bg-slate-100/70 flex flex-col ${over===col.id?'ring-2 ring-blue-400':''}`} onDragOver={e=>{e.preventDefault();setOver(col.id);}} onDragLeave={()=>setOver(null)} onDrop={()=>{if(dragged)void move(dragged.id,col.id,dragged.from);setDragged(null);setOver(null);}}>
    <div className="border-t-4 bg-white rounded-t-xl px-4 py-3 flex items-center gap-2" style={{borderTopColor:col.color}}><div className="flex-1 min-w-0"><strong className="text-sm truncate block">{col.name}</strong><p className="text-xs text-slate-500">{brl(list.reduce((s,c)=>s+Number(c.crm_value||0),0))}</p></div><span className="badge badge-gray">{list.length}</span>{col.id!=='none'&&<><button title="Editar etiqueta" onClick={()=>openTag(tags.find(t=>t.id===col.id))}><Pencil size={14}/></button><button title="Excluir etiqueta" onClick={()=>void deleteTag(tags.find(t=>t.id===col.id)!)}><Trash2 size={14}/></button></>}</div>
    <div className="p-2 space-y-2 overflow-y-auto">{list.map(c=><div key={c.id} draggable onDragStart={()=>setDragged({id:c.id,from:col.id})} onDragEnd={()=>{setDragged(null);setOver(null);}} className="bg-white p-3 rounded-lg border border-slate-200 cursor-move hover:shadow-sm space-y-2"><div className="flex items-center gap-2"><GripVertical size={14} className="text-slate-300"/><strong className="text-sm flex-1 truncate">{c.name}</strong><button className="text-blue-600" title="Editar oportunidade" onClick={()=>edit(c)}><Pencil size={15}/></button></div>{Number(c.crm_value)>0&&<p className="text-sm text-green-700"><CircleDollarSign size={14} className="inline mr-1"/>{brl(Number(c.crm_value))}</p>}{c.phone&&<p className="text-xs text-slate-500"><Phone size={12} className="inline mr-1"/>{c.phone}</p>}<select className="input text-xs py-1" aria-label={`Mover ${c.name}`} value={col.id} onChange={e=>void move(c.id,e.target.value,col.id)}>{columns.map(opt=><option key={opt.id} value={opt.id}>{opt.name}</option>)}</select></div>)}{list.length===0&&<p className="text-xs text-center text-slate-400 p-5">Arraste contatos aqui</p>}</div>
   </div>;
  })}</div></div>}
  <Modal open={tagModal} onClose={()=>setTagModal(false)} title={tagEditing?'Editar etiqueta':'Nova etiqueta / coluna'} size="sm"><div className="space-y-3"><div><label className="label">Nome *</label><input className="input" maxLength={191} value={tagName} onChange={e=>setTagName(e.target.value)}/></div><div><label className="label">Cor</label><input type="color" value={tagColor} onChange={e=>setTagColor(e.target.value)}/></div><div className="flex justify-end gap-2"><button className="btn-secondary" onClick={()=>setTagModal(false)}>Cancelar</button><button className="btn-primary" disabled={saving} onClick={()=>void saveTag()}>Salvar</button></div></div></Modal>
  <Modal open={newOpen} onClose={()=>setNewOpen(false)} title="Nova oportunidade" size="md"><div className="space-y-3"><div><label className="label">Nome *</label><input className="input" value={newLead.name} onChange={e=>setNewLead({...newLead,name:e.target.value})}/></div><div><label className="label">WhatsApp / telefone</label><input className="input" value={newLead.phone} onChange={e=>setNewLead({...newLead,phone:e.target.value})}/></div><div><label className="label">E-mail</label><input className="input" value={newLead.email} onChange={e=>setNewLead({...newLead,email:e.target.value})}/></div><div><label className="label">Valor estimado (R$)</label><input className="input" value={newLead.crm_value} onChange={e=>setNewLead({...newLead,crm_value:e.target.value})}/></div><div><label className="label">Coluna</label><select className="input" value={newLead.tag_id} onChange={e=>setNewLead({...newLead,tag_id:e.target.value})}><option value="">Sem etiqueta</option>{tags.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select></div><div className="flex justify-end gap-2"><button className="btn-secondary" onClick={()=>setNewOpen(false)}>Cancelar</button><button className="btn-primary" disabled={saving} onClick={()=>void addLead()}>Criar</button></div></div></Modal>
  <Modal open={Boolean(editing)} onClose={()=>setEditing(null)} title={`Oportunidade — ${editing?.name||''}`} size="md"><div className="space-y-3"><div><label className="label">Etiquetas (podem ser múltiplas)</label><div className="flex flex-wrap gap-2">{tags.map(t=><label key={t.id} className="flex gap-2 items-center text-sm border rounded-lg px-2 py-1"><input type="checkbox" checked={editTags.includes(t.id)} onChange={e=>setEditTags(v=>e.target.checked?[...v,t.id]:v.filter(x=>x!==t.id))}/><span style={{color:t.color}}>●</span>{t.name}</label>)}</div></div><div><label className="label">Valor estimado (R$)</label><input className="input" value={editValue} onChange={e=>setEditValue(e.target.value)}/></div><div><label className="label">Anotações comerciais</label><textarea className="input" rows={4} value={editNotes} onChange={e=>setEditNotes(e.target.value)}/></div><div className="flex justify-end gap-2"><button className="btn-secondary" onClick={()=>setEditing(null)}>Cancelar</button><button className="btn-primary" disabled={saving} onClick={()=>void save()}>Salvar</button></div></div></Modal>
 </div>;
}
