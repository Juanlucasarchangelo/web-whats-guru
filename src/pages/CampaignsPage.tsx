import { useEffect, useState, useCallback } from 'react';
import { useOrg } from '@/contexts/OrgContext';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { Spinner } from '@/components/ui/Spinner';
import { EmptyState } from '@/components/ui/EmptyState';
import { Modal } from '@/components/ui/Modal';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { toastSuccess, toastError } from '@/components/ui/Toast';
import type { Campaign, Tag, Contact } from '@/types';
import {
  Megaphone, Plus, Trash2, Send, Users, Clock, CheckCheck,
  Check, XCircle, Eye, Play,
} from 'lucide-react';

const CAMPAIGN_STAGES = [
  { value: '', label: 'Todos os estágios' },
  { value: 'lead', label: 'Lead' },
  { value: 'qualified', label: 'Qualificado' },
  { value: 'negotiation', label: 'Negociação' },
  { value: 'won', label: 'Ganho' },
  { value: 'lost', label: 'Perdido' },
];

export function CampaignsPage() {
  const { currentOrg } = useOrg();
  const { user } = useAuth();
  const orgId = currentOrg?.id;
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [showRecipients, setShowRecipients] = useState<Campaign | null>(null);
  const [recipients, setRecipients] = useState<{ id: string; contact_name: string; status: string; sent_at: string | null }[]>([]);
  const [loadingRecipients, setLoadingRecipients] = useState(false);
  const [showConfirmDelete, setShowConfirmDelete] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Campaign | null>(null);
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    name: '', message: '', segment_stage: '', scheduled_at: '',
    consent_required: true, daily_limit: '100',
  });
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [previewCount, setPreviewCount] = useState(0);

  const load = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    try {
      const [campRes, tagRes] = await Promise.all([
        supabase.from('campaigns').select('*').eq('org_id', orgId).order('created_at', { ascending: false }),
        supabase.from('tags').select('*').eq('org_id', orgId),
      ]);
      if (campRes.error) throw campRes.error;
      setCampaigns((campRes.data ?? []) as Campaign[]);
      setTags((tagRes.data ?? []) as Tag[]);
    } catch {
      toastError('Erro ao carregar campanhas');
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => { load(); }, [load]);

  async function calculatePreview() {
    if (!orgId) return;
    let query = supabase.from('contacts').select('id').eq('org_id', orgId);
    if (form.segment_stage) query = query.eq('crm_stage', form.segment_stage);
    const { count } = await query;
    setPreviewCount(count ?? 0);
  }

  useEffect(() => { calculatePreview(); }, [form.segment_stage, orgId]); // eslint-disable-line

  function openCreate() {
    setForm({ name: '', message: '', segment_stage: '', scheduled_at: '', consent_required: true, daily_limit: '100' });
    setSelectedTags([]);
    setShowModal(true);
  }

  async function handleSave() {
    if (!orgId || !user || !form.name.trim() || !form.message.trim()) return;
    setSaving(true);
    try {
      const payload = {
        org_id: orgId,
        name: form.name.trim(),
        message: form.message.trim(),
        segment_tags: selectedTags,
        segment_stage: form.segment_stage || null,
        scheduled_at: form.scheduled_at ? new Date(form.scheduled_at).toISOString() : null,
        status: form.scheduled_at ? 'scheduled' : 'draft',
        consent_required: form.consent_required,
        daily_limit: parseInt(form.daily_limit) || 100,
        created_by: user.id,
      };
      const { error } = await supabase.from('campaigns').insert(payload);
      if (error) throw error;
      toastSuccess('Campanha criada');
      setShowModal(false);
      load();
    } catch {
      toastError('Erro ao criar campanha');
    } finally {
      setSaving(false);
    }
  }

  async function launchCampaign(camp: Campaign) {
    if (!orgId) return;
    try {
      // Find matching contacts
      let query = supabase.from('contacts').select('id').eq('org_id', orgId);
      if (camp.segment_stage) query = query.eq('crm_stage', camp.segment_stage);
      const { data: contacts } = await query;
      if (!contacts || contacts.length === 0) {
        toastError('Nenhum contato corresponde ao segmento desta campanha.');
        return;
      }

      // Create recipients
      const recipientRows = contacts.map((c: { id: string }) => ({ campaign_id: camp.id, contact_id: c.id, status: 'pending' }));
      const { error: recipError } = await supabase.from('campaign_recipients').insert(recipientRows);
      if (recipError) throw recipError;

      // Nenhum envio externo e executado nesta versao local.
      toastSuccess(`${contacts.length} destinatário(s) preparados. Nenhuma mensagem foi enviada.`);
      load();
    } catch {
      toastError('Erro ao preparar destinatários');
    }
  }

  async function viewRecipients(camp: Campaign) {
    setShowRecipients(camp);
    setLoadingRecipients(true);
    try {
      const { data, error } = await supabase
        .from('campaign_recipients')
        .select('id, status, sent_at, contact:contacts(name)')
        .eq('campaign_id', camp.id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      setRecipients((data ?? []).map((r: any) => ({
        id: r.id, contact_name: r.contact?.name ?? 'Desconhecido',
        status: r.status, sent_at: r.sent_at,
      })));
    } catch {
      toastError('Erro ao carregar destinatários');
    } finally {
      setLoadingRecipients(false);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    try {
      const { error } = await supabase.from('campaigns').delete().eq('id', deleteTarget.id);
      if (error) throw error;
      toastSuccess('Campanha excluída');
      setShowConfirmDelete(false);
      setDeleteTarget(null);
      load();
    } catch {
      toastError('Erro ao excluir campanha');
    }
  }

  const statusBadge = (status: string) => {
    const map: Record<string, { label: string; cls: string }> = {
      draft: { label: 'Rascunho', cls: 'badge-gray' },
      scheduled: { label: 'Agendada', cls: 'badge-yellow' },
      sending: { label: 'Enviando', cls: 'badge-blue' },
      completed: { label: 'Concluída', cls: 'badge-green' },
      failed: { label: 'Falhou', cls: 'badge-red' },
    };
    const s = map[status] ?? { label: status, cls: 'badge-gray' };
    return <span className={`badge ${s.cls}`}>{s.label}</span>;
  };

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Campanhas</h1>
          <p className="text-sm text-slate-500 mt-1">{campaigns.length} campanha(s) · Apenas preparação local. Disparos WhatsApp não habilitados.</p>
        </div>
        <button onClick={openCreate} className="btn-primary"><Plus size={18} /> Nova campanha</button>
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><Spinner size={32} /></div>
      ) : campaigns.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={<Megaphone size={28} />}
            title="Nenhuma campanha"
            description="Crie campanhas para enviar mensagens em massa com segmentação e agendamento."
            action={<button onClick={openCreate} className="btn-primary"><Plus size={16} /> Criar campanha</button>}
          />
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {campaigns.map(camp => (
            <div key={camp.id} className="card p-5 hover:shadow-md transition-shadow">
              <div className="flex items-start justify-between mb-3">
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-slate-900 truncate">{camp.name}</p>
                  <div className="mt-1">{statusBadge(camp.status)}</div>
                </div>
                <button
                  onClick={() => { setDeleteTarget(camp); setShowConfirmDelete(true); }}
                  className="btn-ghost text-red-600 px-2 py-1.5"
                >
                  <Trash2 size={16} />
                </button>
              </div>
              <p className="text-sm text-slate-600 line-clamp-2 mb-3">{camp.message}</p>

              <div className="flex flex-wrap gap-2 mb-3">
                {camp.segment_stage && <span className="badge badge-blue">Estágio: {camp.segment_stage}</span>}
                {camp.segment_tags.length > 0 && camp.segment_tags.map(t => (
                  <span key={t} className="badge badge-purple">{t}</span>
                ))}
                {camp.consent_required && <span className="badge badge-green">Consentimento obrigatório</span>}
                <span className="badge badge-gray">Limite: {camp.daily_limit}/dia</span>
              </div>

              {/* Stats */}
              <div className="grid grid-cols-4 gap-2 mb-3">
                <StatItem icon={<Send size={14} />} value={camp.sent_count} label="Enviadas" color="text-blue-600" />
                <StatItem icon={<CheckCheck size={14} />} value={camp.delivered_count} label="Entregues" color="text-green-600" />
                <StatItem icon={<Eye size={14} />} value={camp.read_count} label="Lidas" color="text-purple-600" />
                <StatItem icon={<XCircle size={14} />} value={camp.failed_count} label="Falhas" color="text-red-600" />
              </div>

              <div className="flex items-center gap-2 pt-3 border-t border-slate-50">
                {camp.status === 'draft' && (
                  <button onClick={() => launchCampaign(camp)} className="btn-primary text-xs py-2">
                    <Play size={14} /> Preparar lista
                  </button>
                )}
                <button onClick={() => viewRecipients(camp)} className="btn-ghost text-xs px-2 py-1.5">
                  <Users size={14} /> Destinatários
                </button>
                {camp.scheduled_at && (
                  <span className="text-xs text-slate-400 ml-auto">
                    <Clock size={12} className="inline" /> {new Date(camp.scheduled_at).toLocaleString('pt-BR')}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create modal */}
      <Modal open={showModal} onClose={() => setShowModal(false)} title="Nova campanha" size="lg">
        <div className="space-y-4">
          <div>
            <label className="label">Nome da campanha *</label>
            <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="input" placeholder="Ex: Black Friday 2026" />
          </div>
          <div>
            <label className="label">Mensagem *</label>
            <textarea value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} className="input resize-none" rows={4} placeholder="Conteúdo da mensagem que será enviada..." />
          </div>

          <div className="rounded-xl bg-slate-50 p-4 ring-1 ring-slate-200">
            <h4 className="font-semibold text-slate-900 mb-3 text-sm">Segmentação</h4>
            <div className="space-y-3">
              <div>
                <label className="label">Estágio do CRM</label>
                <select value={form.segment_stage} onChange={(e) => setForm({ ...form, segment_stage: e.target.value })} className="input">
                  {CAMPAIGN_STAGES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
              </div>
              <div>
                <label className="label">Etiquetas</label>
                <div className="flex flex-wrap gap-2">
                  {tags.length === 0 ? (
                    <p className="text-sm text-slate-400">Nenhuma etiqueta cadastrada.</p>
                  ) : tags.map(tag => {
                    const active = selectedTags.includes(tag.name);
                    return (
                      <button
                        key={tag.id}
                        onClick={() => setSelectedTags(prev => active ? prev.filter(t => t !== tag.name) : [...prev, tag.name])}
                        className={`badge ${active ? 'badge-blue' : 'badge-gray'} cursor-pointer transition-all`}
                      >
                        {tag.name}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="text-sm text-slate-500 bg-blue-50 rounded-lg px-3 py-2 ring-1 ring-blue-200">
                <Users size={14} className="inline mr-1 text-blue-600" />
                {previewCount} contato(s) correspondem ao segmento
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="label">Agendar para (opcional)</label>
              <input
                type="datetime-local"
                value={form.scheduled_at}
                onChange={(e) => setForm({ ...form, scheduled_at: e.target.value })}
                className="input"
              />
            </div>
            <div>
              <label className="label">Limite diário de envios</label>
              <input type="number" value={form.daily_limit} onChange={(e) => setForm({ ...form, daily_limit: e.target.value })} className="input" min="1" />
            </div>
          </div>

          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={form.consent_required}
              onChange={(e) => setForm({ ...form, consent_required: e.target.checked })}
              className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-600"
            />
            <span className="text-sm text-slate-700">Exigir consentimento de opt-in dos contatos</span>
          </label>

          <div className="flex justify-end gap-3 pt-2">
            <button onClick={() => setShowModal(false)} className="btn-secondary">Cancelar</button>
            <button onClick={handleSave} disabled={saving || !form.name.trim() || !form.message.trim()} className="btn-primary">
              {saving ? <Spinner size={16} /> : null}
              Criar campanha
            </button>
          </div>
        </div>
      </Modal>

      {/* Recipients modal */}
      <Modal open={!!showRecipients} onClose={() => setShowRecipients(null)} title={`Destinatários: ${showRecipients?.name}`} size="md">
        {loadingRecipients ? (
          <div className="flex justify-center py-6"><Spinner /></div>
        ) : recipients.length === 0 ? (
          <p className="text-sm text-slate-400 text-center py-4">Nenhum destinatário. Prepare a lista para visualizar aqui.</p>
        ) : (
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {recipients.map(r => (
              <div key={r.id} className="flex items-center justify-between py-2 border-b border-slate-50 last:border-0">
                <span className="text-sm text-slate-700">{r.contact_name}</span>
                <span className={`badge ${
                  r.status === 'sent' ? 'badge-blue' :
                  r.status === 'delivered' ? 'badge-green' :
                  r.status === 'read' ? 'badge-purple' :
                  r.status === 'failed' ? 'badge-red' : 'badge-gray'
                }`}>
                  {r.status === 'pending' ? 'Pendente' :
                   r.status === 'sent' ? 'Enviada' :
                   r.status === 'delivered' ? 'Entregue' :
                   r.status === 'read' ? 'Lida' : 'Falhou'}
                </span>
              </div>
            ))}
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={showConfirmDelete}
        title="Excluir campanha"
        message={`Tem certeza que deseja excluir "${deleteTarget?.name}"?`}
        confirmLabel="Excluir"
        danger
        onConfirm={handleDelete}
        onCancel={() => { setShowConfirmDelete(false); setDeleteTarget(null); }}
      />
    </div>
  );
}

function StatItem({ icon, value, label, color }: { icon: React.ReactNode; value: number; label: string; color: string }) {
  return (
    <div className="text-center">
      <div className={`flex items-center justify-center ${color} mb-0.5`}>{icon}</div>
      <p className="text-lg font-bold text-slate-900">{value}</p>
      <p className="text-[10px] text-slate-400">{label}</p>
    </div>
  );
}
