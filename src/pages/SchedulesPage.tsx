import { useEffect, useState, useCallback } from 'react';
import { useOrg } from '@/contexts/OrgContext';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { Spinner } from '@/components/ui/Spinner';
import { EmptyState } from '@/components/ui/EmptyState';
import { Modal } from '@/components/ui/Modal';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { toastSuccess, toastError } from '@/components/ui/Toast';
import type { Schedule, Contact } from '@/types';
import {
  CalendarClock, Plus, Trash2, Clock, CheckCircle, XCircle,
  Calendar, MessageSquare,
} from 'lucide-react';

export function SchedulesPage() {
  const { currentOrg } = useOrg();
  const { user } = useAuth();
  const orgId = currentOrg?.id;
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [showConfirmDelete, setShowConfirmDelete] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Schedule | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ title: '', message: '', contact_id: '', scheduled_at: '' });

  const load = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    try {
      const [schedRes, contactRes] = await Promise.all([
        supabase.from('schedules').select('*, contact:contacts(name)').eq('org_id', orgId).order('scheduled_at', { ascending: true }),
        supabase.from('contacts').select('id, name').eq('org_id', orgId).order('name'),
      ]);
      if (schedRes.error) throw schedRes.error;
      setSchedules((schedRes.data ?? []) as Schedule[]);
      setContacts((contactRes.data ?? []) as Contact[]);
    } catch {
      toastError('Erro ao carregar agendamentos');
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => { load(); }, [load]);

  function openCreate() {
    setForm({ title: '', message: '', contact_id: '', scheduled_at: '' });
    setShowModal(true);
  }

  async function handleSave() {
    if (!orgId || !user || !form.title.trim() || !form.scheduled_at) return;
    setSaving(true);
    try {
      const payload = {
        org_id: orgId,
        contact_id: form.contact_id || null,
        title: form.title.trim(),
        message: form.message.trim() || null,
        scheduled_at: new Date(form.scheduled_at).toISOString(),
        channel: 'whatsapp',
        status: 'pending',
        created_by: user.id,
      };
      const { error } = await supabase.from('schedules').insert(payload);
      if (error) throw error;
      toastSuccess('Agendamento criado');
      setShowModal(false);
      load();
    } catch {
      toastError('Erro ao criar agendamento');
    } finally {
      setSaving(false);
    }
  }

  async function handleCancel(sched: Schedule) {
    try {
      const { error } = await supabase
        .from('schedules')
        .update({ status: 'cancelled' })
        .eq('id', sched.id);
      if (error) throw error;
      toastSuccess('Agendamento cancelado');
      load();
    } catch {
      toastError('Erro ao cancelar agendamento');
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    try {
      const { error } = await supabase.from('schedules').delete().eq('id', deleteTarget.id);
      if (error) throw error;
      toastSuccess('Agendamento excluído');
      setShowConfirmDelete(false);
      setDeleteTarget(null);
      load();
    } catch {
      toastError('Erro ao excluir agendamento');
    }
  }

  const statusBadge = (status: string) => {
    const map: Record<string, { label: string; cls: string }> = {
      pending: { label: 'Pendente', cls: 'badge-yellow' },
      sent: { label: 'Enviado', cls: 'badge-green' },
      cancelled: { label: 'Cancelado', cls: 'badge-gray' },
      failed: { label: 'Falhou', cls: 'badge-red' },
    };
    const s = map[status] ?? { label: status, cls: 'badge-gray' };
    return <span className={`badge ${s.cls}`}>{s.label}</span>;
  };

  const upcoming = schedules.filter(s => s.status === 'pending');
  const past = schedules.filter(s => s.status !== 'pending');

  return (
    <div className="p-6 lg:p-8 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Agendamentos</h1>
          <p className="text-sm text-slate-500 mt-1">{upcoming.length} pendente(s) · {past.length} passado(s) · Não há envio automático habilitado.</p>
        </div>
        <button onClick={openCreate} className="btn-primary"><Plus size={18} /> Novo agendamento</button>
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><Spinner size={32} /></div>
      ) : schedules.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={<CalendarClock size={28} />}
            title="Nenhum agendamento"
            description="Agende mensagens e lembretes para seus contatos."
            action={<button onClick={openCreate} className="btn-primary"><Plus size={16} /> Criar agendamento</button>}
          />
        </div>
      ) : (
        <div className="space-y-6">
          {upcoming.length > 0 && (
            <div>
              <h2 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
                <Clock size={16} className="text-yellow-600" /> Próximos agendamentos
              </h2>
              <div className="space-y-2">
                {upcoming.map(sched => (
                  <div key={sched.id} className="card p-4 flex items-center justify-between hover:shadow-md transition-shadow">
                    <div className="flex items-start gap-3 min-w-0">
                      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-yellow-100 text-yellow-700 flex-shrink-0">
                        <Calendar size={20} />
                      </div>
                      <div className="min-w-0">
                        <p className="font-medium text-slate-900 truncate">{sched.title}</p>
                        <div className="flex items-center gap-2 mt-1">
                          <span className="text-xs text-slate-500">
                            {new Date(sched.scheduled_at).toLocaleString('pt-BR')}
                          </span>
                          {(sched as any).contact?.name && (
                            <span className="text-xs text-slate-400">· {(sched as any).contact.name}</span>
                          )}
                        </div>
                        {sched.message && (
                          <p className="text-xs text-slate-500 mt-1 truncate"><MessageSquare size={12} className="inline mr-1" />{sched.message}</p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {statusBadge(sched.status)}
                      <button onClick={() => handleCancel(sched)} className="btn-ghost text-xs px-2 py-1.5 text-yellow-600 hover:bg-yellow-50">
                        <XCircle size={14} /> Cancelar
                      </button>
                      <button
                        onClick={() => { setDeleteTarget(sched); setShowConfirmDelete(true); }}
                        className="btn-ghost text-xs px-2 py-1.5 text-red-600 hover:bg-red-50"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {past.length > 0 && (
            <div>
              <h2 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
                <CheckCircle size={16} className="text-slate-400" /> Histórico
              </h2>
              <div className="space-y-2">
                {past.map(sched => (
                  <div key={sched.id} className="card p-4 flex items-center justify-between opacity-75">
                    <div className="flex items-start gap-3 min-w-0">
                      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 text-slate-400 flex-shrink-0">
                        <Calendar size={20} />
                      </div>
                      <div className="min-w-0">
                        <p className="font-medium text-slate-700 truncate">{sched.title}</p>
                        <span className="text-xs text-slate-400">{new Date(sched.scheduled_at).toLocaleString('pt-BR')}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {statusBadge(sched.status)}
                      <button
                        onClick={() => { setDeleteTarget(sched); setShowConfirmDelete(true); }}
                        className="btn-ghost text-xs px-2 py-1.5 text-red-600 hover:bg-red-50"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <Modal open={showModal} onClose={() => setShowModal(false)} title="Novo agendamento" size="md">
        <div className="space-y-4">
          <div>
            <label className="label">Título *</label>
            <input type="text" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="input" placeholder="Ex: Ligar para cliente" />
          </div>
          <div>
            <label className="label">Contato (opcional)</label>
            <select value={form.contact_id} onChange={(e) => setForm({ ...form, contact_id: e.target.value })} className="input">
              <option value="">Sem contato vinculado</option>
              {contacts.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Data e hora *</label>
            <input type="datetime-local" value={form.scheduled_at} onChange={(e) => setForm({ ...form, scheduled_at: e.target.value })} className="input" />
          </div>
          <div>
            <label className="label">Mensagem (opcional)</label>
            <textarea value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} className="input resize-none" rows={3} placeholder="Anotações ou mensagem a enviar..." />
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button onClick={() => setShowModal(false)} className="btn-secondary">Cancelar</button>
            <button onClick={handleSave} disabled={saving || !form.title.trim() || !form.scheduled_at} className="btn-primary">
              {saving ? <Spinner size={16} /> : null}
              Criar agendamento
            </button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={showConfirmDelete}
        title="Excluir agendamento"
        message="Tem certeza que deseja excluir este agendamento?"
        confirmLabel="Excluir"
        danger
        onConfirm={handleDelete}
        onCancel={() => { setShowConfirmDelete(false); setDeleteTarget(null); }}
      />
    </div>
  );
}
