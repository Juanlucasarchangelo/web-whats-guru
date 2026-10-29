import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiRequest } from '@/lib/api';
import { useOrg } from '@/contexts/OrgContext';
import { toastError, toastSuccess } from '@/components/ui/Toast';
import { Plus, Save, ShieldCheck, Trash2 } from 'lucide-react';

export type AccessRole = {id:string;org_id:string;slug:string;name:string;description:string|null;permissions:string[];is_system:boolean};
type Permission = {key:string;label:string;group:string};
const slugify = (name:string) => name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'').slice(0,32);

export function RoleManager({ roles, onChange }: {roles:AccessRole[]; onChange:()=>Promise<void>}) {
 const {can, refresh}=useOrg();
 const [catalog,setCatalog]=useState<Permission[]>([]);
 const [selected,setSelected]=useState<string>('');
 const [name,setName]=useState('');
 const [slug,setSlug]=useState('');
 const [description,setDescription]=useState('');
 const [permissions,setPermissions]=useState<string[]>([]);
 const [saving,setSaving]=useState(false);
 const isNew=selected==='new';
 const record=roles.find(r=>r.id===selected);
 const locked=record?.slug==='master';
 const grouped=useMemo(()=>Object.entries(catalog.filter(p=>!['roles.manage','members.assign_master'].includes(p.key)).reduce<Record<string,Permission[]>>((a,p)=>{(a[p.group]??=[]).push(p);return a;},{})),[catalog]);
 const loadCatalog=useCallback(async()=>{
  try{const result=await apiRequest<{data:Permission[]}>('/access/catalog');setCatalog(result.data);}catch(err){toastError(err instanceof Error?err.message:'Erro ao carregar permissões');}
 },[]);
 useEffect(()=>{void loadCatalog();},[loadCatalog]);
 function choose(id:string){
  setSelected(id);
  const role=roles.find(r=>r.id===id);
  setName(role?.name??'');setSlug(role?.slug??'');setDescription(role?.description??'');setPermissions(role?.permissions.filter(p=>!['roles.manage','members.assign_master'].includes(p))??[]);
 }
 async function save(){
  if(!name.trim()||!permissions.length&&!window.confirm('Criar um cargo sem acesso a nenhuma página?'))return;
  setSaving(true);
  try {
   if(isNew){await apiRequest('/access/roles',{method:'POST',body:JSON.stringify({name:name.trim(),slug:slugify(slug||name),description:description.trim(),permissions})});}
   else if(record){await apiRequest(`/access/roles/${record.id}`,{method:'PATCH',body:JSON.stringify({name:name.trim(),description:description.trim(),permissions})});}
   await onChange();await refresh();setSelected('');toastSuccess('Permissões do cargo salvas.');
  }catch(e){toastError(e instanceof Error?e.message:'Erro ao salvar cargo');}finally{setSaving(false);}
 }
 async function remove(){
  if(!record||record.is_system||!window.confirm(`Excluir o cargo ${record.name}? Ele precisa estar sem membros.`))return;
  setSaving(true);
  try{await apiRequest(`/access/roles/${record.id}`,{method:'DELETE'});await onChange();setSelected('');toastSuccess('Cargo excluído.');}
  catch(e){toastError(e instanceof Error?e.message:'Não foi possível excluir');}finally{setSaving(false);}
 }
 if(!can('roles.manage'))return null;
 return <section className="card p-5 space-y-4">
  <div className="flex gap-3 flex-wrap justify-between items-center">
   <div><h2 className="font-semibold flex items-center gap-2"><ShieldCheck size={18}/> Cargos e permissões</h2><p className="text-sm text-slate-500 mt-1">Exclusivo do Master. Crie cargos e escolha exatamente quais páginas e funções podem acessar.</p></div>
   <button className="btn-primary" onClick={()=>choose('new')}><Plus size={16}/> Novo cargo</button>
  </div>
  <div className="flex gap-2 flex-wrap">{roles.map(r=><button key={r.id} className={`px-3 py-2 rounded-lg text-sm border ${selected===r.id?'bg-blue-50 text-blue-700 border-blue-400':'border-slate-200'}`} onClick={()=>choose(r.id)}>{r.name}</button>)}</div>
  {(isNew||record)&&<div className="border border-slate-200 rounded-xl p-4 space-y-4">
   {locked&&<p className="text-sm text-amber-700">Master possui acesso permanente a todas as funções, inclusive criação de outros Masters. Este cargo é protegido contra alterações.</p>}
   <div className="grid sm:grid-cols-2 gap-3"><div><label className="label">Nome do cargo</label><input className="input" maxLength={80} disabled={locked||saving} value={name} onChange={e=>{setName(e.target.value);if(isNew)setSlug(slugify(e.target.value));}}/></div>
    <div><label className="label">Identificador {isNew?'(gerado automaticamente)':'(fixo)'}</label><input className="input" value={slug} disabled={!isNew||saving} onChange={e=>setSlug(slugify(e.target.value))}/></div></div>
   <div><label className="label">Descrição</label><input className="input" maxLength={300} disabled={locked||saving} value={description} onChange={e=>setDescription(e.target.value)}/></div>
   <div className="space-y-4">{grouped.map(([group,items])=><fieldset key={group} className="rounded-lg border border-slate-200 p-3"><legend className="px-2 font-medium text-sm">{group}</legend>
    <div className="grid sm:grid-cols-2 gap-2">{items.map(item=><label key={item.key} className="flex items-center gap-2 cursor-pointer text-sm py-1"><input type="checkbox" disabled={locked||saving} checked={locked||permissions.includes(item.key)} onChange={e=>setPermissions(old=>e.target.checked?[...new Set([...old,item.key])]:old.filter(k=>k!==item.key))}/>{item.label}</label>)}</div></fieldset>)}</div>
   <p className="text-xs text-slate-500">Por segurança, gerenciar cargos e atribuir Master são privilégios exclusivos e permanentes do Master. Novos cargos não podem recebê-los.</p>
   {!locked&&<div className="flex justify-end gap-2 flex-wrap">{record&&!record.is_system&&<button className="btn-secondary text-red-700" disabled={saving} onClick={()=>void remove()}><Trash2 size={15}/> Excluir cargo</button>}<button className="btn-primary" disabled={saving||name.trim().length<2||slug.length<2} onClick={()=>void save()}><Save size={15}/>{saving?'Salvando…':'Salvar cargo e permissões'}</button></div>}
  </div>}
 </section>;
}
