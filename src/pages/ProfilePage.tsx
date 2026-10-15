import { useCallback, useEffect, useState } from 'react';
import { apiRequest } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { toastError, toastSuccess } from '@/components/ui/Toast';
import { UserRound, Lock, ShieldCheck, Save } from 'lucide-react';

type Info={profile:{full_name:string;phone:string|null;avatar_url:string|null}|null;user:{email:string;last_login_at:string|null;created_at:string}|null;role:string};
export function ProfilePage(){
 const {refreshProfile}=useAuth();const [info,setInfo]=useState<Info|null>(null);const [name,setName]=useState('');const [phone,setPhone]=useState('');const [avatar,setAvatar]=useState('');const [current,setCurrent]=useState('');const [password,setPassword]=useState('');const [confirm,setConfirm]=useState('');const [saving,setSaving]=useState(false);
 const load=useCallback(async()=>{try{const a=await apiRequest<Info>('/profile');setInfo(a);setName(a.profile?.full_name||'');setPhone(a.profile?.phone||'');setAvatar(a.profile?.avatar_url||'');}catch(e){toastError(e instanceof Error?e.message:'Falha ao carregar perfil');}},[]);
 useEffect(()=>{void load();},[load]);
 async function save(){setSaving(true);try{await apiRequest('/profile',{method:'PATCH',body:JSON.stringify({full_name:name.trim(),phone:phone.trim()||null,avatar_url:avatar.trim()||null})});await refreshProfile();await load();toastSuccess('Perfil atualizado.');}catch(e){toastError(e instanceof Error?e.message:'Erro ao atualizar perfil');}finally{setSaving(false);}}
 async function changePassword(){if(password!==confirm)return toastError('As senhas não coincidem.');if(password.length<10)return toastError('Use pelo menos 10 caracteres.');setSaving(true);
  try{await apiRequest('/auth/change-password',{method:'POST',body:JSON.stringify({current_password:current,new_password:password})});setCurrent('');setPassword('');setConfirm('');toastSuccess('Senha alterada.');}catch(e){toastError(e instanceof Error?e.message:'Senha não alterada');}finally{setSaving(false);}}
 return <div className="p-4 lg:p-7 max-w-3xl mx-auto space-y-5"><div><h1 className="text-2xl font-bold text-slate-900">Meu Perfil</h1><p className="text-sm text-slate-500">Dados pessoais, acesso e segurança</p></div>
 <div className="card p-5 space-y-4"><h2 className="font-semibold flex gap-2 items-center"><UserRound size={18}/> Informações pessoais</h2>
 <div className="flex gap-3 items-center"><div className="h-14 w-14 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-xl font-bold overflow-hidden">{info?.profile?.avatar_url?<img src={info.profile.avatar_url} alt="Foto de perfil" className="h-full w-full object-cover"/>:name.charAt(0).toUpperCase()}</div><div><strong>{info?.user?.email||'Carregando…'}</strong><p className="text-xs text-slate-500">Função: {info?.role||'—'} · E-mail não editável aqui</p></div></div>
 <div><label className="label">Nome completo *</label><input className="input" value={name} onChange={e=>setName(e.target.value)}/></div>
 <div><label className="label">Telefone</label><input className="input" value={phone} onChange={e=>setPhone(e.target.value)} placeholder="5511999999999"/></div>
 <div><label className="label">URL da foto de perfil (HTTPS; opcional)</label><input className="input" value={avatar} onChange={e=>setAvatar(e.target.value)} placeholder="https://…"/></div>
 <button className="btn-primary" onClick={()=>void save()} disabled={saving||name.trim().length<2}><Save size={16}/> Salvar perfil</button></div>
 <div className="card p-5 space-y-4"><h2 className="font-semibold flex gap-2 items-center"><Lock size={18}/> Alterar senha</h2>
 <p className="text-sm text-slate-500">Informe a senha atual. Sua nova senha deve ter pelo menos 10 caracteres.</p>
 <div><label className="label">Senha atual</label><input type="password" autoComplete="current-password" className="input" value={current} onChange={e=>setCurrent(e.target.value)}/></div>
 <div><label className="label">Nova senha</label><input type="password" autoComplete="new-password" className="input" value={password} onChange={e=>setPassword(e.target.value)}/></div>
 <div><label className="label">Confirmar nova senha</label><input type="password" autoComplete="new-password" className="input" value={confirm} onChange={e=>setConfirm(e.target.value)}/></div>
 <button className="btn-secondary" onClick={()=>void changePassword()} disabled={saving||!current||password.length<10||password!==confirm}><ShieldCheck size={16}/> Atualizar senha</button>
 </div><p className="text-xs text-slate-500">Por segurança, a troca de e-mail exige um processo de verificação e não está habilitada.</p></div>;
}
