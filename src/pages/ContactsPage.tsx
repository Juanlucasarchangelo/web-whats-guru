import { useEffect, useState, useCallback } from 'react';
import { useOrg } from '@/contexts/OrgContext';
import { apiRequest } from '@/lib/api';
import { supabase } from '@/lib/supabase';
import { Spinner } from '@/components/ui/Spinner';
import { EmptyState } from '@/components/ui/EmptyState';
import { Modal } from '@/components/ui/Modal';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { toastSuccess, toastError } from '@/components/ui/Toast';
import type { Contact, Tag } from '@/types';
import {
  Users, Search, Plus, Pencil, Trash2, Mail, Phone,
  DollarSign, Building2,
} from 'lucide-react';

type ContactTagLink = { contact_id: string; tag_id: string };

export function ContactsPage() {
  const { currentOrg } = useOrg();
  const orgId = currentOrg?.id;
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [tagFilter, setTagFilter] = useState('all');
  const [tags, setTags] = useState<Tag[]>([]);
  const [contactTags, setContactTags] = useState<ContactTagLink[]>([]);
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
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
      // Mesmas tabelas usadas pelo CRM Kanban e pela Caixa de Entrada.
      const [tagsResult, linksResult] = await Promise.all([
        supabase.from('tags').select('*').eq('org_id', orgId).order('name', { ascending: true }),
        supabase.from('contact_tags').select('contact_id,tag_id').limit(1000),
      ]);
      if (tagsResult.error) throw tagsResult.error;
      if (linksResult.error) throw linksResult.error;
      setTags((tagsResult.data ?? []) as Tag[]);
      setContactTags((linksResult.data ?? []) as ContactTagLink[]);
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
    setSelectedTagIds([]);
    setShowModal(true);
  }

  function openEdit(contact: Contact) {
    setEditing(contact);
    setSelectedTagIds(contactTags.filter(link => link.contact_id === contact.id).map(link => link.tag_id));
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

      let contactId: string;
      if (editing) {
        await apiRequest(`/contacts/${editing.id}`, { method: 'PATCH', body: JSON.stringify(payload) });
        contactId = editing.id;
      } else {
        const created = await apiRequest<Contact>('/contacts', { method: 'POST', body: JSON.stringify(payload) });
        contactId = created.id;
      }
      // Alteracoes em contact_tags espelham automaticamente as etiquetas
      // para todas as conversas deste contato (regra do backend existente).
      const oldIds = new Set(editing ? contactTags.filter(link => link.contact_id === editing.id).map(link => link.tag_id) : []);
      const newIds = new Set(selectedTagIds);
      for (const id of oldIds) {
        if (!newIds.has(id)) {
          const result = await supabase.from('contact_tags').delete().eq('contact_id', contactId).eq('tag_id', id);
          if (result.error) throw result.error;
        }
      }
      for (const id of newIds) {
        if (!oldIds.has(id)) {
          const result = await supabase.from('contact_tags').insert({ contact_id: contactId, tag_id: id });
          if (result.error) throw result.error;
        }
      }
      toastSuccess(editing ? 'Contato e etiquetas atualizados' : 'Contato criado com etiquetas');
      setShowModal(false);
      await load();
    } catch (error) {
      toastError(error instanceof Error ? error.message : 'Erro ao salvar contato ou sincronizar etiquetas. Atualize a tela para conferir o resultado');
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

  const idsOf = (contactId: string) => contactTags.filter(link => link.contact_id === contactId).map(link => link.tag_id);
  const visibleContacts = contacts.filter((contact) =>
    (tagFilter === 'all' || (tagFilter === 'none' ? idsOf(contact.id).length === 0 : idsOf(contact.id).includes(tagFilter)))
    && contact.name.toLocaleLowerCase('pt-BR').includes(search.trim().toLocaleLowerCase('pt-BR')),
  );

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
          value={tagFilter}
          onChange={(e) => setTagFilter(e.target.value)}
          className="input sm:w-48"
        >
          <option value="all">Todas as etiquetas</option>
          <option value="none">Sem etiqueta</option>
          {tags.map(tag => <option key={tag.id} value={tag.id}>{tag.name}</option>)}
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
                    <div className="flex flex-wrap gap-1 mt-1">
                      {tags.filter(tag => idsOf(contact.id).includes(tag.id)).map(tag => (
                        <span key={tag.id} className="badge badge-gray" style={{ borderColor: tag.color, color: tag.color }}>
                          {tag.name}
                        </span>
                      ))}
                      {idsOf(contact.id).length === 0 && <span className="text-xs text-slate-400">Sem etiqueta</span>}
                    </div>
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
              <label className="label">Etiquetas / Colunas do Kanban</label>
              <div className="border border-slate-200 rounded-lg p-2 max-h-40 overflow-y-auto space-y-1">
                {tags.length === 0 ? (
                  <span className="text-xs text-slate-500">Nenhuma etiqueta cadastrada. Crie uma no CRM Kanban.</span>
                ) : tags.map(tag => (
                  <label key={tag.id} className="flex items-center gap-2 px-2 py-1 text-sm cursor-pointer">
                    <input type="checkbox" checked={selectedTagIds.includes(tag.id)} onChange={e =>
                      setSelectedTagIds(ids => e.target.checked ? [...ids, tag.id] : ids.filter(id => id !== tag.id))
                    } />
                    <span style={{ color: tag.color }}>●</span> {tag.name}
                  </label>
                ))}
              </div>
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
