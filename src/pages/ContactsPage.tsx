import { useEffect, useState, useCallback } from 'react';
import { useOrg } from '@/contexts/OrgContext';
import { apiRequest } from '@/lib/api';
import { Spinner } from '@/components/ui/Spinner';
import { EmptyState } from '@/components/ui/EmptyState';
import { Modal } from '@/components/ui/Modal';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { toastSuccess, toastError } from '@/components/ui/Toast';
import type { Contact } from '@/types';
import {
  Users, Search, Plus, Pencil, Trash2, Mail, Phone,
  DollarSign, Building2,
} from 'lucide-react';

const CRM_STAGES = [
  { value: 'lead', label: 'Lead' },
  { value: 'qualified', label: 'Qualificado' },
  { value: 'negotiation', label: 'Negociação' },
  { value: 'won', label: 'Ganho' },
  { value: 'lost', label: 'Perdido' },
];

export function ContactsPage() {
  const { currentOrg } = useOrg();
  const orgId = currentOrg?.id;
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [stageFilter, setStageFilter] = useState('all');
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<Contact | null>(null);
  const [showConfirmDelete, setShowConfirmDelete] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Contact | null>(null);
  const [form, setForm] = useState({
    name: '', email: '', phone: '', crm_stage: 'lead', crm_value: '0',
  });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!orgId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      // O backend define a organizacao a partir do token de login.
      // A primeira etapa mostra ate 100 contatos; as buscas abaixo sao locais.
      const response = await apiRequest<{ data: Contact[]; total: number }>('/contacts?limit=100');
      setContacts(response.data.map((contact) => ({
        ...contact,
        crm_value: Number(contact.crm_value ?? 0),
        custom_fields: contact.custom_fields ?? {},
      })));
      setTotal(response.total);
    } catch (error) {
      toastError(error instanceof Error ? error.message : 'Erro ao carregar contatos do MySQL');
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => { load(); }, [load]);

  function openCreate() {
    setEditing(null);
    setForm({ name: '', email: '', phone: '', crm_stage: 'lead', crm_value: '0' });
    setShowModal(true);
  }

  function openEdit(contact: Contact) {
    setEditing(contact);
    setForm({
      name: contact.name,
      email: contact.email ?? '',
      phone: contact.phone ?? '',
      crm_stage: contact.crm_stage,
      crm_value: String(contact.crm_value),
    });
    setShowModal(true);
  }

  async function handleSave() {
    if (!orgId || !form.name.trim()) return;
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        email: form.email.trim() || null,
        phone: form.phone.trim() || null,
        crm_stage: form.crm_stage,
        crm_value: parseFloat(form.crm_value) || 0,
      };

      if (editing) {
        await apiRequest(`/contacts/${editing.id}`, { method: 'PATCH', body: JSON.stringify(payload) });
        toastSuccess('Contato atualizado');
      } else {
        await apiRequest('/contacts', { method: 'POST', body: JSON.stringify(payload) });
        toastSuccess('Contato criado');
      }
      setShowModal(false);
      await load();
    } catch (error) {
      toastError(error instanceof Error ? error.message : 'Erro ao salvar contato');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    try {
      await apiRequest(`/contacts/${deleteTarget.id}`, { method: 'DELETE' });
      toastSuccess('Contato excluído');
      setShowConfirmDelete(false);
      setDeleteTarget(null);
      await load();
    } catch (error) {
      toastError(error instanceof Error ? error.message : 'Erro ao excluir contato');
    }
  }

  const visibleContacts = contacts.filter((contact) =>
    (stageFilter === 'all' || contact.crm_stage === stageFilter)
    && contact.name.toLocaleLowerCase('pt-BR').includes(search.trim().toLocaleLowerCase('pt-BR')),
  );

  const stageLabel = (s: string) => CRM_STAGES.find(st => st.value === s)?.label ?? s;
  const stageBadge = (s: string) => {
    const map: Record<string, string> = {
      lead: 'badge-blue', qualified: 'badge-yellow', negotiation: 'badge-purple',
      won: 'badge-green', lost: 'badge-red',
    };
    return map[s] ?? 'badge-gray';
  };

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Contatos</h1>
          <p className="text-sm text-slate-500 mt-1">{total} contato(s) no MySQL</p>
        </div>
        <button onClick={openCreate} className="btn-primary">
          <Plus size={18} /> Novo contato
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nome..."
            className="input pl-9"
          />
        </div>
        <select
          value={stageFilter}
          onChange={(e) => setStageFilter(e.target.value)}
          className="input sm:w-48"
        >
          <option value="all">Todos os estágios</option>
          {CRM_STAGES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
      </div>

      {total > contacts.length && !loading && (
        <p className="mb-4 text-sm text-amber-700">
          Mostrando os 100 contatos mais recentes. A busca nesta etapa considera esses 100 contatos.
        </p>
      )}

      {loading ? (
        <div className="flex justify-center py-12"><Spinner size={32} /></div>
      ) : visibleContacts.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={<Users size={28} />}
            title="Nenhum contato"
            description={contacts.length === 0 ? 'Crie seu primeiro contato no MySQL.' : 'Nenhum contato encontrado com estes filtros.'}
            action={<button onClick={openCreate} className="btn-primary"><Plus size={16} /> Criar contato</button>}
          />
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {visibleContacts.map(contact => (
            <div key={contact.id} className="card p-5 hover:shadow-md transition-shadow">
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-11 w-11 items-center justify-center rounded-full bg-slate-200 text-base font-semibold text-slate-700">
                    {contact.name.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <p className="font-medium text-slate-900">{contact.name}</p>
                    <span className={`badge ${stageBadge(contact.crm_stage)} mt-1`}>
                      {stageLabel(contact.crm_stage)}
                    </span>
                  </div>
                </div>
                {contact.is_demo && <span className="badge badge-gray text-[10px]">Demo</span>}
              </div>

              <div className="space-y-1.5 text-sm text-slate-600">
                {contact.email && (
                  <div className="flex items-center gap-2"><Mail size={14} className="text-slate-400" /> {contact.email}</div>
                )}
                {contact.phone && (
                  <div className="flex items-center gap-2"><Phone size={14} className="text-slate-400" /> {contact.phone}</div>
                )}
                {Number(contact.crm_value) > 0 && (
                  <div className="flex items-center gap-2"><DollarSign size={14} className="text-slate-400" /> {contact.crm_value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</div>
                )}
                {contact.custom_fields?.empresa ? (
                  <div className="flex items-center gap-2"><Building2 size={14} className="text-slate-400" /> {String(contact.custom_fields.empresa)}</div>
                ) : null}
              </div>

              <div className="flex items-center gap-2 mt-4 pt-3 border-t border-slate-50">
                <button onClick={() => openEdit(contact)} className="btn-ghost text-xs px-2 py-1.5">
                  <Pencil size={14} /> Editar
                </button>
                <button
                  onClick={() => { setDeleteTarget(contact); setShowConfirmDelete(true); }}
                  className="btn-ghost text-xs px-2 py-1.5 text-red-600 hover:bg-red-50"
                >
                  <Trash2 size={14} /> Excluir
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create/Edit modal */}
      <Modal
        open={showModal}
        onClose={() => setShowModal(false)}
        title={editing ? 'Editar contato' : 'Novo contato'}
        size="md"
      >
        <div className="space-y-4">
          <div>
            <label className="label">Nome *</label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="input"
              placeholder="Nome do contato"
              autoFocus
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="label">E-mail</label>
              <input
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                className="input"
                placeholder="email@exemplo.com"
              />
            </div>
            <div>
              <label className="label">Telefone</label>
              <input
                type="text"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                className="input"
                placeholder="+55 11 99999-9999"
              />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="label">Estágio do CRM</label>
              <select
                value={form.crm_stage}
                onChange={(e) => setForm({ ...form, crm_stage: e.target.value })}
                className="input"
              >
                {CRM_STAGES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Valor (R$)</label>
              <input
                type="number"
                value={form.crm_value}
                onChange={(e) => setForm({ ...form, crm_value: e.target.value })}
                className="input"
                placeholder="0,00"
                min="0"
                step="0.01"
              />
            </div>
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button onClick={() => setShowModal(false)} className="btn-secondary">Cancelar</button>
            <button onClick={handleSave} disabled={saving || !form.name.trim()} className="btn-primary">
              {saving ? <Spinner size={16} /> : null}
              {editing ? 'Salvar alterações' : 'Criar contato'}
            </button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={showConfirmDelete}
        title="Excluir contato"
        message={`Tem certeza que deseja excluir "${deleteTarget?.name}"? Esta ação não pode ser desfeita.`}
        confirmLabel="Excluir"
        danger
        onConfirm={handleDelete}
        onCancel={() => { setShowConfirmDelete(false); setDeleteTarget(null); }}
      />
    </div>
  );
}
