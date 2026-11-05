import { useState, type FormEvent } from 'react';
import { LockKeyhole } from 'lucide-react';
import { apiRequest } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';

export function ForcePasswordChangePage() {
  const { signOut } = useAuth();
  const [current,setCurrent]=useState('');
  const [next,setNext]=useState('');
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  async function submit(event:FormEvent) {
    event.preventDefault();setBusy(true);setError('');
    try{
      await apiRequest('/auth/change-password',{method:'POST',body:JSON.stringify({current_password:current,new_password:next})});
      await signOut(); // O backend invalida todas as sessoes apos mudar a senha.
    }catch(err){setError(err instanceof Error?err.message:'Nao foi possivel alterar a senha.');}
    finally{setBusy(false);}
  }
  return <div className="min-h-screen flex items-center justify-center p-4 bg-slate-50">
    <form onSubmit={submit} className="card w-full max-w-md p-7 space-y-5">
      <div className="flex items-center gap-3"><LockKeyhole className="text-amber-500"/><h1 className="text-xl font-semibold text-slate-900">Defina uma nova senha</h1></div>
      <p className="text-sm text-slate-500">O DEV redefiniu sua senha. Por seguranca, altere a senha temporaria antes de acessar o FalaComigo.</p>
      <label className="block text-sm font-medium text-slate-700">Senha temporária<input autoComplete="current-password" type="password" className="input mt-2 w-full" required value={current} onChange={e=>setCurrent(e.target.value)}/></label>
      <label className="block text-sm font-medium text-slate-700">Nova senha (mínimo 10 caracteres)<input autoComplete="new-password" minLength={10} type="password" className="input mt-2 w-full" required value={next} onChange={e=>setNext(e.target.value)}/></label>
      {error && <p role="alert" className="text-sm text-red-500">{error}</p>}
      <button disabled={busy} type="submit" className="btn-primary w-full">{busy?'Atualizando...':'Alterar senha e entrar novamente'}</button>
      <button onClick={()=>void signOut()} type="button" className="text-sm text-slate-500 underline">Sair</button>
    </form>
  </div>;
}
