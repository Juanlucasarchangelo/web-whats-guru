import { useCallback, useEffect, useState } from 'react';
import { useOrg } from '@/contexts/OrgContext';
import { useAuth } from '@/contexts/AuthContext';
import { apiRequest } from '@/lib/api';
import { Spinner } from '@/components/ui/Spinner';
import { Modal } from '@/components/ui/Modal';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { toastError, toastSuccess } from '@/components/ui/Toast';
import type { Team, OrgMember } from '@/types';
import { Crown, Shield, UsersRound, UserRound, Plus, Pencil, Trash2, PhoneCall } from 'lucide-react';

type Member = OrgMember & { full_name: string; email: string; is_active: boolean };
type TeamLink = { team_id: string; user_id: string };
type Channel = { id: string; name: string; instance_name: string | null; team_ids: string[]; status: string };
type Overview = { members: Member[]; teams: Team[]; team_members: TeamLink[] };
const roles: Record<string,string> = {owner:'Proprietário',admin:'Administrador',agent:'Atendente'};

export function TeamPage(){
 const { currentOrg,currentMembership }=useOrg();const {user}=useAuth();
 const isAdmin=['owner','admin'].includes(currentMembership?.role??'');
 const isOwner=currentMembership?.role==='owner';
 const [members,setMembers]=useState<Member[]>([]);const [teams,setTeams]=useState<Team[]>([]);
 const [links,setLinks]=useState<TeamLink[]>([]);const [channels,setChannels]=useState<Channel[]>([]);
 const [loading,setLoading]=useState(true);const [saving,setSaving]=useState(false);
 const [teamModal,setTeamModal]=useState(false);const [inviteModal,setInviteModal]=useState(false);
 const [newUserModal,setNewUserModal]=useState(false);const [newUserName,setNewUserName]=useState('');
 const [generated,setGenerated]=useState<{email:string;initial_password:string}|null>(null);
 const [passwordModal,setPasswordModal]=useState(false);const [currentPwd,setCurrentPwd]=useState('');const [newPwd,setNewPwd]=useState('');
 const [editing,setEditing]=useState<Team|null>(null);const [teamName,setTeamName]=useState('');const [teamDesc,setTeamDesc]=useState('');
 const [teamUsers,setTeamUsers]=useState<string[]>([]);const [email,setEmail]=useState('');const [role,setRole]=useState('agent');
 const [remove,setRemove]=useState<{kind:'member'|'team';id:string;name:string}|null>(null);
 const load=useCallback(async(silent=false)=>{
  if(!currentOrg?.id)return;if(!silent)setLoading(true);
  try {const [o,c]=await Promise.all([apiRequest<Overview>('/team/overview'),apiRequest<{data:Channel[]}>('/channels')]);
   setMembers(o.members);setTeams(o.teams);setLinks(o.team_members);setChannels(c.data);
  }catch(e){toastError(e instanceof Error?e.message:'Falha ao carregar equipe');}
  finally{if(!silent)setLoading(false);}
 },[currentOrg?.id]);
 useEffect(()=>{void load();},[load]);
 async function call(path:string,method:string,body?:unknown){setSaving(true);try{await apiRequest(path,{method,...(body?{body:JSON.stringify(body)}:{})});await load(true);toastSuccess('Alteração salva');return true;}catch(e){toastError(e instanceof Error?e.message:'Erro ao salvar');return false;}finally{setSaving(false);}}
 function editTeam(team:Team|null){setEditing(team);setTeamName(team?.name??'');setTeamDesc(team?.description??'');setTeamUsers(team?links.filter(x=>x.team_id===team.id).map(x=>x.user_id):[]);setTeamModal(true);}
 async function saveTeam(){if(!teamName.trim())return;setSaving(true);try{
  const saved=await apiRequest<Team>(editing?`/team/teams/${editing.id}`:'/team/teams',{
   method:editing?'PATCH':'POST',body:JSON.stringify({name:teamName.trim(),description:teamDesc.trim()||null})});
  await apiRequest(`/team/teams/${saved.id}/members`,{method:'PUT',body:JSON.stringify({user_ids:teamUsers})});
  setTeamModal(false);await load(true);toastSuccess('Time e integrantes salvos');
 }catch(e){toastError(e instanceof Error?e.message:'Erro ao salvar time');}finally{setSaving(false);}}
 async function invite(){if(await call('/team/members','POST',{email:email.trim(),role})){setInviteModal(false);setEmail('');}}
 async function createUser(){if(!newUserName.trim()||!email.trim())return;setSaving(true);
  try{const r=await apiRequest<{email:string;initial_password:string}>('/team/users',{method:'POST',body:JSON.stringify({full_name:newUserName.trim(),email:email.trim(),role})});
   setGenerated(r);await load(true);toastSuccess('Usuário criado. Guarde a senha inicial apresentada.');}
  catch(e){toastError(e instanceof Error?e.message:'Erro ao cadastrar usuário');}finally{setSaving(false);}}
 async function changePassword(){if(newPwd.length<10)return;setSaving(true);try{
  await apiRequest('/auth/change-password',{method:'POST',body:JSON.stringify({current_password:currentPwd,new_password:newPwd})});
  setPasswordModal(false);setCurrentPwd('');setNewPwd('');toastSuccess('Senha alterada');
 }catch(e){toastError(e instanceof Error?e.message:'Erro ao alterar senha');}finally{setSaving(false);}}

 async function updateMember(member:Member,change:object){await call(`/team/members/${member.id}`,'PATCH',change);}
 async function confirmRemove(){if(!remove)return;const path=remove.kind==='member'?`/team/members/${remove.id}`:`/team/teams/${remove.id}`;
  if(await call(path,'DELETE'))setRemove(null);}
 async function saveAccess(channel:Channel,ids:string[]){await call(`/channels/${channel.id}/teams`,'PUT',{team_ids:ids});}
 if(loading)return <div className="flex justify-center py-12"><Spinner size={32}/></div>;
 return <div className="p-6 lg:p-8 max-w-6xl mx-auto space-y-6">
  <div className="flex items-center justify-between flex-wrap gap-3"><div><h1 className="text-2xl font-bold text-slate-900">Equipe & Permissões</h1>
   <p className="text-sm text-slate-500 mt-1">{members.filter(m=>m.status==='active').length} membros ativos · {teams.length} times · {channels.length} números disponíveis</p></div>
   <div className="flex gap-2 flex-wrap"><button className="btn-secondary" onClick={()=>setPasswordModal(true)}>Alterar minha senha</button>
   {isOwner&&<button className="btn-secondary" onClick={()=>{setEmail('');setNewUserName('');setGenerated(null);setNewUserModal(true);}}><Plus size={16}/> Criar usuário</button>}
   {isOwner&&<button className="btn-secondary" onClick={()=>{setEmail('');setInviteModal(true);}}><Plus size={16}/> Adicionar existente</button>}
   {isAdmin&&<button className="btn-primary" onClick={()=>editTeam(null)}><Plus size={16}/> Novo time</button>}</div></div>
  <div className="card p-5"><h2 className="font-semibold text-slate-900 mb-1">Usuários e funções</h2>
   <p className="text-xs text-slate-500 mb-4">Proprietário: acesso total. Administrador: configura times e números. Atendente: acesso aos números permitidos por seus times.</p>
   <div className="divide-y divide-slate-100">{members.map(m=><div key={m.id} className="flex items-center justify-between gap-3 py-3 flex-wrap">
    <div className="flex items-center gap-3 min-w-0"><div className="rounded-full bg-blue-50 text-blue-700 h-10 w-10 flex items-center justify-center"><UserRound size={20}/></div>
     <div><div className="font-medium text-sm">{m.full_name} {m.user_id===user?.id&&<span className="text-xs text-slate-400">(você)</span>}</div>
     <p className="text-xs text-slate-500">{m.email||'Sem e-mail'} · {m.status==='active'?'Ativo':'Desativado'}</p></div></div>
    <div className="flex items-center gap-2"><span className="text-slate-500">{m.role==='owner'?<Crown size={16}/>:m.role==='admin'?<Shield size={16}/>:<UserRound size={16}/>}</span>
     {isOwner&&m.role!=='owner'&&m.user_id!==user?.id?<>
      <select className="input text-sm" value={m.role} disabled={saving} onChange={e=>void updateMember(m,{role:e.target.value})}>
       <option value="agent">Atendente</option><option value="admin">Administrador</option></select>
      {m.status!=='active'?<button className="btn-secondary text-xs" disabled={saving} onClick={()=>void updateMember(m,{status:'active'})}>Reativar</button>:
       <button className="btn-ghost text-red-600" title="Desativar acesso" disabled={saving} onClick={()=>setRemove({kind:'member',id:m.id,name:m.full_name})}><Trash2 size={16}/></button>}
     </>:<span className="badge badge-gray">{roles[m.role]??m.role}</span>}</div>
   </div>)}</div></div>
  <div className="card p-5"><div className="flex justify-between items-center mb-4"><div><h2 className="font-semibold">Times / Setores</h2><p className="text-xs text-slate-500">Organize Vendas, Suporte, Financeiro etc. Os membros do time podem atender seus números autorizados.</p></div>
   {isAdmin&&<button className="btn-secondary" onClick={()=>editTeam(null)}><Plus size={16}/> Time</button>}</div>
   {teams.length===0?<div className="flex flex-col items-center gap-2 py-6 text-slate-400"><UsersRound/><p>Crie seu primeiro time.</p></div>:<div className="grid md:grid-cols-2 gap-3">{teams.map(t=>{
    const assigned=links.filter(x=>x.team_id===t.id);return <div key={t.id} className="rounded-xl border border-slate-200 p-4">
     <div className="flex justify-between"><div><strong>{t.name}</strong><p className="text-sm text-slate-500">{t.description||'Sem descrição'}</p></div>
     {isAdmin&&<div className="flex gap-1"><button className="btn-ghost" title="Editar time" onClick={()=>editTeam(t)}><Pencil size={15}/></button>
      <button className="btn-ghost text-red-600" title="Excluir time" onClick={()=>setRemove({kind:'team',id:t.id,name:t.name})}><Trash2 size={15}/></button></div>}</div>
     <div className="flex flex-wrap gap-1.5 mt-3">{assigned.length?assigned.map(m=><span key={m.user_id} className="badge badge-blue">{members.find(x=>x.user_id===m.user_id)?.full_name||'Usuário'}</span>):<span className="text-xs text-amber-600">Sem integrantes</span>}</div>
    </div>})}</div>}</div>
  <div className="card p-5"><h2 className="font-semibold flex items-center gap-2"><PhoneCall size={18}/> Permissões por WhatsApp</h2>
   <p className="text-sm text-slate-500 mt-1 mb-4">Selecione quais times podem visualizar e responder cada número. Sem time selecionado = todos os atendentes ativos da empresa podem acessar.</p>
   {!channels.length?<p className="text-sm text-slate-500">Conecte seus números em Integrações para configurar acesso.</p>:channels.map(c=><div key={c.id} className="border-t border-slate-100 py-4">
    <div className="font-medium text-sm">{c.name} <span className="text-slate-500 font-normal">({c.instance_name??'WhatsApp'})</span></div>
    <div className="flex flex-wrap gap-3 mt-2">{teams.map(t=><label key={t.id} className="flex items-center gap-2 text-sm cursor-pointer">
     <input type="checkbox" disabled={!isAdmin||saving} checked={c.team_ids.includes(t.id)} onChange={e=>void saveAccess(c,e.target.checked?[...c.team_ids,t.id]:c.team_ids.filter(x=>x!==t.id))}/>{t.name}</label>)}
     {!teams.length&&<span className="text-xs text-slate-500">Nenhum time criado: acesso liberado para os membros.</span>}</div>
   </div>)}</div>
  <Modal open={newUserModal} onClose={()=>{setNewUserModal(false);setGenerated(null);}} title="Criar usuário local" size="sm"><div className="space-y-3">
   {generated?<div className="space-y-3"><p className="text-green-700 font-semibold">Usuário criado! A senha será exibida somente aqui.</p>
    <p className="text-sm">E-mail: <strong>{generated.email}</strong></p>
    <div><label className="label">Senha inicial</label><input readOnly className="input font-mono" value={generated.initial_password}/></div>
    <button className="btn-secondary" onClick={()=>{void navigator.clipboard.writeText(`E-mail: ${generated.email}\nSenha inicial: ${generated.initial_password}`);toastSuccess('Credenciais copiadas');}}>Copiar credenciais</button>
    <p className="text-xs text-slate-600">Envie ao atendente por um canal seguro. Peça para ele trocar a senha em Equipe & Permissões após entrar.</p>
    <button className="btn-primary" onClick={()=>{setNewUserModal(false);setGenerated(null);}}>Concluído</button></div>:<>
    <div><label className="label">Nome completo</label><input className="input" value={newUserName} onChange={e=>setNewUserName(e.target.value)} placeholder="Nome do atendente"/></div>
    <div><label className="label">E-mail</label><input className="input" type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="atendente@empresa.com"/></div>
    <div><label className="label">Função</label><select className="input" value={role} onChange={e=>setRole(e.target.value)}><option value="agent">Atendente</option><option value="admin">Administrador</option></select></div>
    <button className="btn-primary" disabled={saving||newUserName.trim().length<2||!email.trim()} onClick={()=>void createUser()}>Criar conta e gerar senha</button></>}
   </div></Modal>
  <Modal open={passwordModal} onClose={()=>{setPasswordModal(false);setCurrentPwd('');setNewPwd('');}} title="Alterar minha senha" size="sm"><div className="space-y-3">
   <div><label className="label">Senha atual</label><input className="input" type="password" autoComplete="current-password" value={currentPwd} onChange={e=>setCurrentPwd(e.target.value)}/></div>
   <div><label className="label">Nova senha (mínimo 10 caracteres)</label><input className="input" type="password" autoComplete="new-password" value={newPwd} onChange={e=>setNewPwd(e.target.value)}/></div>
   <button className="btn-primary" disabled={saving||newPwd.length<10||!currentPwd} onClick={()=>void changePassword()}>Alterar senha</button>
  </div></Modal>
  <Modal open={inviteModal} onClose={()=>setInviteModal(false)} title="Adicionar usuário existente" size="sm"><div className="space-y-4">
   <p className="text-sm text-blue-700 bg-blue-50 p-3 rounded">O usuário deve criar sua conta primeiro na tela de cadastro. Depois informe o mesmo e-mail aqui.</p>
   <div><label className="label">E-mail</label><input className="input" type="email" value={email} onChange={e=>setEmail(e.target.value)}/></div>
   <div><label className="label">Função</label><select className="input" value={role} onChange={e=>setRole(e.target.value)}><option value="agent">Atendente</option><option value="admin">Administrador</option></select></div>
   <div className="flex justify-end gap-2"><button className="btn-secondary" onClick={()=>setInviteModal(false)}>Cancelar</button><button disabled={saving||!email.trim()} className="btn-primary" onClick={()=>void invite()}>Adicionar</button></div>
  </div></Modal>
  <Modal open={teamModal} onClose={()=>setTeamModal(false)} title={editing?'Editar time':'Novo time'} size="md"><div className="space-y-4">
   <div><label className="label">Nome *</label><input className="input" value={teamName} onChange={e=>setTeamName(e.target.value)} placeholder="Ex.: Vendas" /></div>
   <div><label className="label">Descrição</label><input className="input" value={teamDesc} onChange={e=>setTeamDesc(e.target.value)} placeholder="Opcional"/></div>
   <div><label className="label">Integrantes</label><div className="border rounded-lg max-h-48 overflow-y-auto divide-y">{members.filter(m=>m.status==='active').map(m=><label className="flex gap-2 px-3 py-2 cursor-pointer text-sm" key={m.user_id}>
    <input type="checkbox" checked={teamUsers.includes(m.user_id)} onChange={e=>setTeamUsers(old=>e.target.checked?[...old,m.user_id]:old.filter(x=>x!==m.user_id))}/>{m.full_name} <span className="text-slate-400">({roles[m.role]})</span></label>)}</div></div>
   <div className="flex justify-end gap-2"><button className="btn-secondary" onClick={()=>setTeamModal(false)}>Cancelar</button><button className="btn-primary" disabled={saving||teamName.trim().length<2} onClick={()=>void saveTeam()}>{saving?<Spinner size={14}/>:null} Salvar time</button></div>
  </div></Modal>
  <ConfirmDialog open={!!remove} title={remove?.kind==='team'?'Excluir time':'Desativar usuário'} message={remove?.kind==='team'?`Excluir ${remove.name}? Os vínculos com canais devem ser removidos antes.`:`Desativar acesso de ${remove?.name}? O histórico será preservado.`} confirmLabel="Confirmar" onConfirm={()=>void confirmRemove()} onCancel={()=>setRemove(null)}/>
 </div>;
}
