import { useEffect, useState, useCallback } from 'react';
import { useOrg } from '@/contexts/OrgContext';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { apiRequest } from '@/lib/api';
import { Spinner } from '@/components/ui/Spinner';
import { EmptyState } from '@/components/ui/EmptyState';
import { Modal } from '@/components/ui/Modal';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { toastSuccess, toastError, toastWarning } from '@/components/ui/Toast';
import type { Automation } from '@/types';
import {
  Zap, Plus, Pencil, Trash2, Play, Pause,
  Clock, MessageSquare, Tag, UserCheck, Webhook,
} from 'lucide-react';

const TRIGGER_TYPES: { value: string; label: string }[] = [
  { value: 'new_conversation', label: 'Nova conversa' },
  { value: 'no_response', label: 'Sem resposta em X minutos' },
  { value: 'out_of_hours', label: 'Fora do horário comercial' },
  { value: 'keyword', label: 'Palavra-chave detectada' },
  { value: 'tag_added', label: 'Etiqueta adicionada' },
];

const ACTION_TYPES: { value: string; label: string; icon: typeof MessageSquare }[] = [
  { value: 'send_message', label: 'Enviar mensagem', icon: MessageSquare },
  { value: 'add_tag', label: 'Adicionar etiqueta', icon: Tag },
  { value: 'assign_team', label: 'Atribuir ao time', icon: UserCheck },
  { value: 'call_webhook', label: 'Chamar webhook', icon: Webhook },
];

export function AutomationsPage() {
  const { currentOrg } = useOrg();
  const { user } = useAuth();
  const orgId = currentOrg?.id;
  const [automations, setAutomations] = useState<Automation[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<Automation | null>(null);
  const [showConfirmDelete, setShowConfirmDelete] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Automation | null>(null);
  const [saving, setSaving] = useState(false);
  const [recentRuns, setRecentRuns] = useState<{id:string;event_type:string;processed:boolean;error?:string;received_at:string}[]>([]);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [triggerType, setTriggerType] = useState('new_conversation');
  const [triggerTimeout, setTriggerTimeout] = useState('10');
  const [triggerHours, setTriggerHours] = useState('18:00-08:00');
  const [triggerKeyword, setTriggerKeyword] = useState('');
  const [triggerTag, setTriggerTag] = useState('');
  const [actions, setActions] = useState<{ type: string; text?: string; tag?: string; team?: string; url?: string }[]>([]);

  const load = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('automations')
        .select('*')
        .eq('org_id', orgId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      setAutomations((data ?? []) as Automation[]);
      const activity = await apiRequest<{events: {id:string;source:string;event_type:string;processed:boolean;error?:string;received_at:string}[]}>('/integrations/activity').catch(() => ({events: []}));
      setRecentRuns((activity.events ?? []).filter(e => e.source === 'workflow_engine').slice(0, 8));
    } catch {
      toastError('Erro ao carregar automações');
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => { load(); }, [load]);

  function openCreate() {
    setEditing(null);
    setName('');
    setDescription('');
    setTriggerType('new_conversation');
    setTriggerTimeout('10');
    setTriggerHours('18:00-08:00');
    setTriggerKeyword('');
    setTriggerTag('');
    setActions([]);
    setShowModal(true);
  }

  function openEdit(auto: Automation) {
    setEditing(auto);
    setName(auto.name);
    setDescription(auto.description ?? '');
    setTriggerType((auto.trigger as any)?.type ?? 'new_conversation');
    setTriggerTimeout(String((auto.trigger as any)?.timeout_minutes ?? 10));
    setTriggerHours(String((auto.trigger as any)?.hours ?? '18:00-08:00'));
    setTriggerKeyword(String((auto.trigger as any)?.keyword ?? ''));
    setTriggerTag(String((auto.trigger as any)?.tag ?? ''));
    setActions(auto.actions as any ?? []);
    setShowModal(true);
  }

  function addAction() {
    setActions(prev => [...prev, { type: 'send_message', text: '' }]);
  }

  function updateAction(index: number, key: string, value: string) {
    setActions(prev => prev.map((a, i) => i === index ? { ...a, [key]: value } : a));
  }

  function removeAction(index: number) {
    setActions(prev => prev.filter((_, i) => i !== index));
  }

  async function handleSave() {
    if (!orgId || !user || !name.trim()) return;
    if (!actions.length) { toastWarning('Adicione ao menos uma ação.'); return; }
    if (triggerType === 'keyword' && !triggerKeyword.trim()) { toastWarning('Informe a palavra-chave.'); return; }
    if (triggerType === 'tag_added' && !triggerTag.trim()) { toastWarning('Informe o nome da etiqueta.'); return; }
    if (triggerType === 'no_response' && !(Number(triggerTimeout) >= 1 && Number(triggerTimeout) <= 10080)) { toastWarning('Informe um tempo entre 1 e 10080 minutos.'); return; }
    for (const a of actions) {
      if (a.type === 'send_message' && !a.text?.trim() || a.type === 'add_tag' && !a.tag?.trim() || a.type === 'assign_team' && !a.team?.trim() || a.type === 'call_webhook' && !a.url?.trim()) {
        toastWarning('Preencha todos os dados das ações.'); return;
      }
    }
    setSaving(true);
    try {
      const trigger: Record<string, unknown> = { type: triggerType };
      if (triggerType === 'no_response') trigger.timeout_minutes = parseInt(triggerTimeout);
      if (triggerType === 'out_of_hours') trigger.hours = triggerHours;
      if (triggerType === 'keyword') trigger.keyword = triggerKeyword;
      if (triggerType === 'tag_added') trigger.tag = triggerTag;

      const payload = {
        org_id: orgId,
        name: name.trim(),
        description: description.trim() || null,
        trigger,
        actions: actions as any,
        created_by: user.id,
        ...(!editing ? { status: 'paused' } : {}),
      };

      if (editing) {
        const { error } = await supabase
          .from('automations')
          .update({ ...payload, updated_at: new Date().toISOString() })
          .eq('id', editing.id);
        if (error) throw error;
        toastSuccess('Automação atualizada');
      } else {
        const { error } = await supabase.from('automations').insert(payload);
        if (error) throw error;
        toastSuccess('Automação criada. Ative-a quando estiver pronta para enviar mensagens.');
      }
      setShowModal(false);
      load();
    } catch {
      toastError('Erro ao salvar automação');
    } finally {
      setSaving(false);
    }
  }

  async function toggleStatus(auto: Automation) {
    const newStatus = auto.status === 'active' ? 'paused' : 'active';
    try {
      const { error } = await supabase
        .from('automations')
        .update({ status: newStatus, updated_at: new Date().toISOString() })
        .eq('id', auto.id);
      if (error) throw error;
      toastSuccess(newStatus === 'active' ? 'Automação ativada' : 'Automação pausada');
      load();
    } catch {
      toastError('Erro ao alterar status');
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    try {
      const { error } = await supabase.from('automations').delete().eq('id', deleteTarget.id);
      if (error) throw error;
      toastSuccess('Automação excluída');
      setShowConfirmDelete(false);
      setDeleteTarget(null);
      load();
    } catch {
      toastError('Erro ao excluir automação');
    }
  }

  const triggerLabel = (t: Record<string, unknown>) => {
    const type = t.type as string;
    const found = TRIGGER_TYPES.find(tt => tt.value === type);
    if (!found) return 'Desconhecido';
    if (type === 'no_response') return `${found.label} (${t.timeout_minutes}min)`;
    if (type === 'out_of_hours') return `${found.label} (${t.hours})`;
    if (type === 'keyword') return `${found.label}: "${t.keyword}"`;
    if (type === 'tag_added') return `${found.label}: "${t.tag}"`;
    return found.label;
  };

  const actionIcon = (type: string) => {
    const at = ACTION_TYPES.find(a => a.value === type);
    return at ? at.icon : MessageSquare;
  };

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Automações</h1>
          <p className="text-sm text-slate-500 mt-1">{automations.length} automação(ões) · Executor ligado às mensagens recebidas pela Evolution.</p>
        </div>
        <button onClick={openCreate} className="btn-primary"><Plus size={18} /> Nova automação</button>
      </div>

      <p className="text-xs text-slate-500 mb-4">Ao criar uma automação ela fica pausada até você ativar. Variáveis disponíveis nas mensagens: {'{{nome}}'}, {'{{telefone}}'} e {'{{resposta}}'}. Fuso horário: São Paulo.</p>
      {loading ? (
        <div className="flex justify-center py-12"><Spinner size={32} /></div>
      ) : automations.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={<Zap size={28} />}
            title="Nenhuma automação"
            description="Crie automações para responder, atribuir e organizar conversas automaticamente."
            action={<button onClick={openCreate} className="btn-primary"><Plus size={16} /> Criar automação</button>}
          />
        </div>
      ) : (
        <div className="space-y-3">
          {automations.map(auto => (
            <div key={auto.id} className="card p-5 hover:shadow-md transition-shadow">
              <div className="flex items-start justify-between">
                <div className="flex items-start gap-3 flex-1 min-w-0">
                  <div className={`flex h-11 w-11 items-center justify-center rounded-xl flex-shrink-0 ${
                    auto.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-400'
                  }`}>
                    <Zap size={22} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-medium text-slate-900">{auto.name}</p>
                      <span className={`badge ${auto.status === 'active' ? 'badge-green' : 'badge-gray'}`}>
                        {auto.status === 'active' ? 'Ativa' : 'Pausada'}
                      </span>
                    </div>
                    {auto.description && <p className="text-sm text-slate-500 mt-1">{auto.description}</p>}
                    <div className="mt-2 flex flex-wrap gap-2">
                      <span className="badge badge-blue">
                        <Clock size={12} /> {triggerLabel(auto.trigger)}
                      </span>
                      {(auto.actions as any[]).map((act, i) => {
                        const Icon = actionIcon(act.type);
                        return (
                          <span key={i} className="badge badge-gray">
                            <Icon size={12} /> {act.text || act.tag || act.team || act.url || act.type}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button onClick={() => toggleStatus(auto)} className="btn-ghost px-2 py-1.5">
                    {auto.status === 'active' ? <Pause size={16} /> : <Play size={16} />}
                  </button>
                  <button onClick={() => openEdit(auto)} className="btn-ghost px-2 py-1.5">
                    <Pencil size={16} />
                  </button>
                  <button
                    onClick={() => { setDeleteTarget(auto); setShowConfirmDelete(true); }}
                    className="btn-ghost px-2 py-1.5 text-red-600 hover:bg-red-50"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="card p-4 mt-6">
        <h3 className="font-semibold text-slate-800">Últimas execuções de automações e chatbots</h3>
        {recentRuns.length === 0 ? <p className="text-sm text-slate-500 mt-2">Nenhuma execução registrada ainda. Envie uma mensagem de teste e atualize a página.</p> :
          <div className="mt-3 space-y-2">{recentRuns.map(log => <div key={log.id} className="text-xs flex items-start gap-2">
            <span className={log.processed ? 'text-green-700' : 'text-red-700'}>{log.processed ? 'OK' : 'ERRO'}</span>
            <span className="text-slate-600 flex-1 break-all">{log.event_type}{log.error ? ` — ${log.error}` : ''}</span>
            <span className="text-slate-400">{new Date(log.received_at).toLocaleTimeString('pt-BR')}</span>
          </div>)}</div>}
      </div>

      {/* Create/Edit modal */}
      <Modal open={showModal} onClose={() => setShowModal(false)} title={editing ? 'Editar automação' : 'Nova automação'} size="lg">
        <div className="space-y-5">
          <div>
            <label className="label">Nome *</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} className="input" placeholder="Ex: Auto-resposta fora do horário" />
          </div>
          <div>
            <label className="label">Descrição</label>
            <input type="text" value={description} onChange={(e) => setDescription(e.target.value)} className="input" placeholder="Descrição opcional" />
          </div>

          <div className="rounded-xl bg-slate-50 p-4 ring-1 ring-slate-200">
            <h4 className="font-semibold text-slate-900 mb-3 text-sm">Gatilho</h4>
            <div className="space-y-3">
              <div>
                <label className="label">Tipo de gatilho</label>
                <select value={triggerType} onChange={(e) => setTriggerType(e.target.value)} className="input">
                  {TRIGGER_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>
              {triggerType === 'no_response' && (
                <div>
                  <label className="label">Tempo limite (minutos)</label>
                  <input type="number" value={triggerTimeout} onChange={(e) => setTriggerTimeout(e.target.value)} className="input" min="1" />
                </div>
              )}
              {triggerType === 'out_of_hours' && (
                <div>
                  <label className="label">Horário (ex: 18:00-08:00)</label>
                  <input type="text" value={triggerHours} onChange={(e) => setTriggerHours(e.target.value)} className="input" />
                </div>
              )}
              {triggerType === 'keyword' && (
                <div>
                  <label className="label">Palavra-chave</label>
                  <input type="text" value={triggerKeyword} onChange={(e) => setTriggerKeyword(e.target.value)} className="input" placeholder="Ex: promoção" />
                </div>
              )}
              {triggerType === 'tag_added' && (
                <div>
                  <label className="label">Etiqueta</label>
                  <input type="text" value={triggerTag} onChange={(e) => setTriggerTag(e.target.value)} className="input" />
                </div>
              )}
            </div>
          </div>

          <div className="rounded-xl bg-slate-50 p-4 ring-1 ring-slate-200">
            <div className="flex items-center justify-between mb-3">
              <h4 className="font-semibold text-slate-900 text-sm">Ações</h4>
              <button onClick={addAction} className="btn-secondary text-xs py-1.5 px-3"><Plus size={14} /> Adicionar ação</button>
            </div>
            {actions.length === 0 ? (
              <p className="text-sm text-slate-400 text-center py-4">Nenhuma ação adicionada.</p>
            ) : (
              <div className="space-y-3">
                {actions.map((act, i) => (
                  <div key={i} className="flex gap-2 items-start">
                    <select
                      value={act.type}
                      onChange={(e) => updateAction(i, 'type', e.target.value)}
                      className="input py-2 w-40 flex-shrink-0"
                    >
                      {ACTION_TYPES.map(a => <option key={a.value} value={a.value}>{a.label}</option>)}
                    </select>
                    {act.type === 'send_message' && (
                      <input type="text" value={act.text ?? ''} onChange={(e) => updateAction(i, 'text', e.target.value)} className="input flex-1" placeholder="Mensagem a enviar" />
                    )}
                    {act.type === 'add_tag' && (
                      <input type="text" value={act.tag ?? ''} onChange={(e) => updateAction(i, 'tag', e.target.value)} className="input flex-1" placeholder="Etiqueta" />
                    )}
                    {act.type === 'assign_team' && (
                      <input type="text" value={act.team ?? ''} onChange={(e) => updateAction(i, 'team', e.target.value)} className="input flex-1" placeholder="Nome do time" />
                    )}
                    {act.type === 'call_webhook' && (
                      <input type="text" value={act.url ?? ''} onChange={(e) => updateAction(i, 'url', e.target.value)} className="input flex-1" placeholder="https://..." />
                    )}
                    <button onClick={() => removeAction(i)} className="btn-ghost text-red-600 px-2 py-2"><Trash2 size={16} /></button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button onClick={() => setShowModal(false)} className="btn-secondary">Cancelar</button>
            <button onClick={handleSave} disabled={saving || !name.trim()} className="btn-primary">
              {saving ? <Spinner size={16} /> : null}
              {editing ? 'Salvar alterações' : 'Criar automação'}
            </button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={showConfirmDelete}
        title="Excluir automação"
        message={`Tem certeza que deseja excluir "${deleteTarget?.name}"?`}
        confirmLabel="Excluir"
        danger
        onConfirm={handleDelete}
        onCancel={() => { setShowConfirmDelete(false); setDeleteTarget(null); }}
      />
    </div>
  );
}
