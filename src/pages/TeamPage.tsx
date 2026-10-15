import { useEffect, useState, useCallback } from 'react';
import { useOrg } from '@/contexts/OrgContext';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { apiRequest } from '@/lib/api';
import { Spinner } from '@/components/ui/Spinner';
import { EmptyState } from '@/components/ui/EmptyState';
import { Modal } from '@/components/ui/Modal';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { toastSuccess, toastError } from '@/components/ui/Toast';
import type { Team, OrgMember } from '@/types';
import {
  UsersRound, Plus, Trash2, Pencil, Shield, Crown, User,
  Check, X,
} from 'lucide-react';

const ROLES = [
  { value: 'owner', label: 'Proprietário', icon: Crown, color: 'text-yellow-600 bg-yellow-50' },
  { value: 'admin', label: 'Administrador', icon: Shield, color: 'text-blue-600 bg-blue-50' },
  { value: 'agent', label: 'Atendente', icon: User, color: 'text-slate-600 bg-slate-50' },
];

interface MemberWithProfile extends OrgMember {
  full_name?: string;
  email?: string;
}

export function TeamPage() {
  const { currentOrg, currentMembership } = useOrg();
  const { user } = useAuth();
  const orgId = currentOrg?.id;
  const [members, setMembers] = useState<MemberWithProfile[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);
  const [showTeamModal, setShowTeamModal] = useState(false);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [showConfirmRemove, setShowConfirmRemove] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<MemberWithProfile | null>(null);
  const [editingTeam, setEditingTeam] = useState<Team | null>(null);
  const [teamName, setTeamName] = useState('');
  const [teamDesc, setTeamDesc] = useState('');
  const [saving, setSaving] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('agent');

  const isAdmin = currentMembership?.role === 'owner' || currentMembership?.role === 'admin';

  const load = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    try {
      const [memberRes, teamRes] = await Promise.all([
        supabase.from('org_members').select('*').eq('org_id', orgId),
        supabase.from('teams').select('*').eq('org_id', orgId),
      ]);
      if (memberRes.error || teamRes.error) throw memberRes.error ?? teamRes.error;

      const memberList = memberRes.data ?? [];
      const membersWithProfiles: MemberWithProfile[] = [];
      for (const m of memberList) {
        const { data: prof } = await supabase
          .from('user_profiles')
          .select('full_name')
          .eq('user_id', m.user_id)
          .maybeSingle();
        membersWithProfiles.push({
          ...m as OrgMember,
          full_name: (prof as any)?.full_name ?? 'Usuário',
        });
      }
      setMembers(membersWithProfiles);
      setTeams((teamRes.data ?? []) as Team[]);
    } catch {
      toastError('Erro ao carregar equipe');
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => { load(); }, [load]);

  function openCreateTeam() {
    setEditingTeam(null);
    setTeamName('');
    setTeamDesc('');
    setShowTeamModal(true);
  }

  function openEditTeam(team: Team) {
    setEditingTeam(team);
    setTeamName(team.name);
    setTeamDesc(team.description ?? '');
    setShowTeamModal(true);
  }

  async function handleSaveTeam() {
    if (!orgId || !teamName.trim()) return;
    setSaving(true);
    try {
      if (editingTeam) {
        const { error } = await supabase
          .from('teams')
          .update({ name: teamName.trim(), description: teamDesc.trim() || null })
          .eq('id', editingTeam.id);
        if (error) throw error;
        toastSuccess('Time atualizado');
      } else {
        const { error } = await supabase
          .from('teams')
          .insert({ org_id: orgId, name: teamName.trim(), description: teamDesc.trim() || null });
        if (error) throw error;
        toastSuccess('Time criado');
      }
      setShowTeamModal(false);
      load();
    } catch {
      toastError('Erro ao salvar time');
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteTeam(team: Team) {
    try {
      const { error } = await supabase.from('teams').delete().eq('id', team.id);
      if (error) throw error;
      toastSuccess('Time excluído');
      load();
    } catch {
      toastError('Erro ao excluir time');
    }
  }

  async function handleUpdateRole(member: MemberWithProfile, newRole: string) {
    if (member.user_id === user?.id) {
      toastError('Você não pode alterar sua própria função');
      return;
    }
    try {
      const { error } = await supabase
        .from('org_members')
        .update({ role: newRole })
        .eq('id', member.id);
      if (error) throw error;
      toastSuccess('Função atualizada');
      load();
    } catch {
      toastError('Erro ao atualizar função');
    }
  }

  async function handleRemoveMember() {
    if (!removeTarget) return;
    try {
      const { error } = await supabase
        .from('org_members')
        .delete()
        .eq('id', removeTarget.id);
      if (error) throw error;
      toastSuccess('Membro removido');
      setShowConfirmRemove(false);
      setRemoveTarget(null);
      load();
    } catch {
      toastError('Erro ao remover membro');
    }
  }

  async function handleInvite() {
    if (!orgId || !inviteEmail.trim()) return;
    setSaving(true);
    try {
      await apiRequest('/team/members', {
        method:'POST', body: JSON.stringify({email:inviteEmail.trim(), role:inviteRole}),
      });
      toastSuccess('Usuário local adicionado à equipe');
      setShowInviteModal(false);
      setInviteEmail('');
      load();
    } catch (e) {
      toastError(e instanceof Error ? e.message : 'Erro ao adicionar usuário');
    } finally { setSaving(false); }
  }

  if (loading) return <div className="flex justify-center py-12"><Spinner size={32} /></div>;

  return (
    <div className="p-6 lg:p-8 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Equipe & Permissões</h1>
          <p className="text-sm text-slate-500 mt-1">{members.length} membro(s) · {teams.length} time(s)</p>
        </div>
        {isAdmin && (
          <div className="flex gap-2">
            <button onClick={() => setShowInviteModal(true)} className="btn-secondary"><Plus size={16} /> Adicionar usuário</button>
            <button onClick={openCreateTeam} className="btn-primary"><Plus size={16} /> Novo time</button>
          </div>
        )}
      </div>

      {/* Members */}
      <div className="card p-6 mb-6">
        <h2 className="font-semibold text-slate-900 mb-4">Membros da organização</h2>
        <div className="space-y-2">
          {members.map(member => {
            const role = ROLES.find(r => r.value === member.role) ?? ROLES[2];
            const RoleIcon = role.icon;
            return (
              <div key={member.id} className="flex items-center justify-between py-3 border-b border-slate-50 last:border-0">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-100 text-sm font-semibold text-blue-700 flex-shrink-0">
                    {(member.full_name ?? '?').charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-900 truncate">{member.full_name}</p>
                    <p className="text-xs text-slate-400">{member.user_id === user?.id ? 'Você' : 'Membro'}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3 flex-shrink-0">
                  <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg ${role.color}`}>
                    <RoleIcon size={14} />
                    <span className="text-xs font-medium">{role.label}</span>
                  </div>
                  {isAdmin && member.user_id !== user?.id && (
                    <>
                      <select
                        value={member.role}
                        onChange={(e) => handleUpdateRole(member, e.target.value)}
                        className="rounded-lg border-0 bg-slate-100 px-2 py-1 text-xs ring-1 ring-inset ring-slate-200 cursor-pointer"
                      >
                        <option value="admin">Administrador</option>
                        <option value="agent">Atendente</option>
                      </select>
                      <button
                        onClick={() => { setRemoveTarget(member); setShowConfirmRemove(true); }}
                        className="btn-ghost text-red-600 px-2 py-1"
                      >
                        <Trash2 size={16} />
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Teams */}
      <div className="card p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-slate-900">Times</h2>
          {isAdmin && <button onClick={openCreateTeam} className="btn-ghost text-sm"><Plus size={16} /> Adicionar</button>}
        </div>
        {teams.length === 0 ? (
          <EmptyState
            icon={<UsersRound size={28} />}
            title="Nenhum time"
            description="Crie times para organizar atendentes por área."
          />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {teams.map(team => (
              <div key={team.id} className="rounded-xl bg-slate-50 p-4 ring-1 ring-slate-200">
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-slate-900">{team.name}</p>
                    {team.description && <p className="text-sm text-slate-500 mt-1">{team.description}</p>}
                  </div>
                  {isAdmin && (
                    <div className="flex gap-1">
                      <button onClick={() => openEditTeam(team)} className="btn-ghost px-2 py-1"><Pencil size={14} /></button>
                      <button onClick={() => handleDeleteTeam(team)} className="btn-ghost text-red-600 px-2 py-1"><Trash2 size={14} /></button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Team modal */}
      <Modal open={showTeamModal} onClose={() => setShowTeamModal(false)} title={editingTeam ? 'Editar time' : 'Novo time'} size="sm">
        <div className="space-y-4">
          <div>
            <label className="label">Nome do time *</label>
            <input type="text" value={teamName} onChange={(e) => setTeamName(e.target.value)} className="input" placeholder="Ex: Suporte" autoFocus />
          </div>
          <div>
            <label className="label">Descrição</label>
            <input type="text" value={teamDesc} onChange={(e) => setTeamDesc(e.target.value)} className="input" placeholder="Opcional" />
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button onClick={() => setShowTeamModal(false)} className="btn-secondary">Cancelar</button>
            <button onClick={handleSaveTeam} disabled={saving || !teamName.trim()} className="btn-primary">
              {saving ? <Spinner size={16} /> : null}
              {editingTeam ? 'Salvar' : 'Criar'}
            </button>
          </div>
        </div>
      </Modal>

      {/* Invite modal */}
      <Modal open={showInviteModal} onClose={() => setShowInviteModal(false)} title="Adicionar usuário existente" size="sm">
        <div className="space-y-4">
          <div className="rounded-lg bg-blue-50 p-3 ring-1 ring-blue-200">
            <p className="text-sm text-blue-700">
              O convite funciona adicionando um usuário que já tem conta no Converso. Peça para a pessoa se cadastrar primeiro com o e-mail dele, depois adicione-a à organização aqui.
            </p>
          </div>
          <div>
            <label className="label">E-mail do membro</label>
            <input type="email" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} className="input" placeholder="email@exemplo.com" />
          </div>
          <div>
            <label className="label">Função</label>
            <select value={inviteRole} onChange={(e) => setInviteRole(e.target.value)} className="input">
              <option value="admin">Administrador</option>
              <option value="agent">Atendente</option>
            </select>
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button onClick={() => setShowInviteModal(false)} className="btn-secondary">Cancelar</button>
            <button onClick={handleInvite} disabled={saving || !inviteEmail.trim()} className="btn-primary">
              {saving ? <Spinner size={16} /> : null}
              Adicionar usuário
            </button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={showConfirmRemove}
        title="Remover membro"
        message={`Tem certeza que deseja remover "${removeTarget?.full_name}" da organização?`}
        confirmLabel="Remover"
        danger
        onConfirm={handleRemoveMember}
        onCancel={() => { setShowConfirmRemove(false); setRemoveTarget(null); }}
      />
    </div>
  );
}
