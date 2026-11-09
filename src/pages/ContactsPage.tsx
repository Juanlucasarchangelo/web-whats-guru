import { useEffect, useState, useCallback, useRef } from 'react';
import { useAuth } from '@/contexts/AuthContext';
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
  Building2,
} from 'lucide-react';

type ContactTagLink = { contact_id: string; tag_id: string };

export function ContactsPage() {
  const { currentOrg, currentMembership } = useOrg();
  const { user } = useAuth();
  const isManager = user?.global_role === 'dev' || ['master','administrador','owner','admin'].includes(currentMembership?.role ?? '');
  const orgId = currentOrg?.id;
  const [contacts, setContacts] = useState<Contact[]>([]);
  const contactsRequestVersion = useRef(0);
  const pageSize = 50;
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [instanceFilter, setInstanceFilter] = useState('all');
  const [channels, setChannels] = useState<{id:string;name:string;instance_name:string|null;owner_user_id:string|null;owner_name?:string|null}[]>([]);
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
    const requestVersion = ++contactsRequestVersion.current;
    if (!orgId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const query = new URLSearchParams({page: String(page), limit: String(pageSize), q: search.trim(), tag: tagFilter});
      if (instanceFilter.startsWith('user:')) query.set('owner_user_id', instanceFilter.slice(5));
      else if (instanceFilter !== 'all') query.set('integration_id', instanceFilter);
      const response = await apiRequest<{ data: Array<Contact & { tag_ids?: string[] }>; total: number }>(`/contacts?${query}`);
      if (requestVersion !== contactsRequestVersion.current) return;
      setContacts(response.data.map((contact) => ({
        ...contact,
        crm_value: Number(contact.crm_value ?? 0),
        custom_fields: contact.custom_fields ?? {},
      })));
      setTotal(response.total);
      setContactTags(response.data.flatMap(contact => (contact.tag_ids ?? []).map(tag_id => ({contact_id: contact.id,tag_id}))));
      if (isManager) {
        const channelsResponse = await apiRequest<{ data: typeof channels }>('/channels');
        if (requestVersion !== contactsRequestVersion.current) return;
        setChannels(channelsResponse.data ?? []);
      }
      // Mesmas tabelas usadas pelo CRM Kanban e pela Caixa de Entrada.
      const tagsResult = await supabase.from('tags').select('*').eq('org_id', orgId).order('name', { ascending: true });
      if (tagsResult.error) throw tagsResult.error;
      if (requestVersion !== contactsRequestVersion.current) return;
      setTags((tagsResult.data ?? []) as Tag[]);
    } catch (error) {
      if (requestVersion === contactsRequestVersion.current) toastError(error instanceof Error ? error.message : 'Erro ao carregar contatos do MySQL');
    } finally {
      if (requestVersion === contactsRequestVersion.current) setLoading(false);
    }
  }, [orgId, page, search, tagFilter, instanceFilter, isManager]);

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
  const visibleContacts = contacts;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

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
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            placeholder="Buscar por nome..."
            className="input pl-9"
          />
        </div>
        <select
          value={tagFilter}
          onChange={(e) => { setTagFilter(e.target.value); setPage(1); }}
          className="input sm:w-48"
        >
          <option value="all">Todas as etiquetas</option>
          <option value="none">Sem etiqueta</option>
          {tags.map(tag => <option key={tag.id} value={tag.id}>{tag.name}</option>)}
        </select>
      </div>

      {isManager && <div className="mb-4 flex flex-wrap gap-3 items-center">
        <label htmlFor="contacts-instance" className="text-sm font-medium">Instância / usuário responsável</label>
        <select id="contacts-instance" className="input max-w-sm" value={instanceFilter} onChange={e => {setInstanceFilter(e.target.value);setPage(1);}}>
          <option value="all">Todas as instâncias</option>
          {[...new Set(channels.map(channel=>channel.owner_user_id||'unknown'))].map(ownerId=><optgroup key={ownerId} label={channels.find(c=>(c.owner_user_id||'unknown')===ownerId)?.owner_name || (ownerId==='unknown'?'Sem usuário atribuído':`Usuário ${ownerId.slice(0,8)}`)}>
            {ownerId!=='unknown' && <option value={`user:${ownerId}`}>Todas as instâncias deste usuário</option>}
            {channels.filter(c=>(c.owner_user_id||'unknown')===ownerId).map(channel=><option key={channel.id} value={channel.id}>{channel.name} · {channel.instance_name||'WhatsApp'}</option>)}
          </optgroup>)}
        </select>
      </div>}

      {!loading && <div className="mb-3 flex flex-wrap items-center justify-between gap-3 text-sm text-slate-600">
        <span>{total === 0 ? 'Nenhum contato' : `${(page-1)*pageSize+1}–${Math.min(page*pageSize,total)} de ${total} contatos`}</span>
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-500">Página {page} de {totalPages}</span>
          <button type="button" className="btn-secondary" disabled={page <= 1} onClick={()=>setPage(n=>n-1)}>Anterior</button>
          <button type="button" className="btn-secondary" disabled={page >= totalPages} onClick={()=>setPage(n=>n+1)}>Próxima</button>
        </div>
      </div>}
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
        <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
          <div className="hidden lg:grid lg:grid-cols-12 gap-3 px-4 py-3 bg-slate-50 border-b border-slate-200 text-xs font-semibold uppercase tracking-wide text-slate-500">
            <span className="col-span-3">Contato</span>
            <span className="col-span-2">Telefone</span>
            <span className="col-span-3">E-mail</span>
            <span className="col-span-2">Etiquetas</span>
            <span className="col-span-2 text-right">Ações</span>
          </div>
          <div className="divide-y divide-slate-100">
            {visibleContacts.map(contact => (
              <div key={contact.id} className="grid grid-cols-1 lg:grid-cols-12 gap-x-3 gap-y-2 px-4 py-3 hover:bg-slate-50 transition-colors items-center">
                <div className="lg:col-span-3 min-w-0 flex items-center gap-3">
                  <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-slate-200 text-sm font-semibold text-slate-700">
                    {contact.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <p className="font-medium text-sm text-slate-900 break-words">{contact.name}</p>
                    {contact.custom_fields?.empresa ? (
                      <p className="text-xs text-slate-500 truncate flex items-center gap-1"><Building2 size={12} /> {String(contact.custom_fields.empresa)}</p>
                    ) : null}
                    {contact.is_demo && <span className="text-xs text-slate-400">Contato demo</span>}
                  </div>
                </div>
                <div className="lg:col-span-2 min-w-0 text-sm text-slate-600 flex items-center gap-2">
                  <Phone size={14} className="text-slate-400 flex-shrink-0" />
                  <span className="break-all">{contact.phone || '—'}</span>
                </div>
                <div className="lg:col-span-3 min-w-0 text-sm text-slate-600 flex items-center gap-2">
                  <Mail size={14} className="text-slate-400 flex-shrink-0" />
                  <span className="break-all">{contact.email || '—'}</span>
                </div>
                <div className="lg:col-span-2 min-w-0 flex flex-wrap gap-1">
                  {tags.filter(tag => idsOf(contact.id).includes(tag.id)).map(tag => (
                    <span key={tag.id} className="badge badge-gray" style={{ borderColor: tag.color, color: tag.color }}>
                      {tag.name}
                    </span>
                  ))}
                  {idsOf(contact.id).length === 0 && <span className="text-xs text-slate-400">Sem etiqueta</span>}
                </div>
                <div className="lg:col-span-2 flex items-center lg:justify-end gap-1">
                  <button type="button" onClick={() => openEdit(contact)} className="btn-ghost text-xs px-2 py-1.5" aria-label={`Editar ${contact.name}`}>
                    <Pencil size={14} /> Editar
                  </button>
                  <button type="button" onClick={() => { setDeleteTarget(contact); setShowConfirmDelete(true); }}
                    className="btn-ghost text-xs px-2 py-1.5 text-red-600 hover:bg-red-50" aria-label={`Excluir ${contact.name}`}>
                    <Trash2 size={14} /> Excluir
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {!loading && total > pageSize && (
        <div className="mt-4 flex flex-wrap items-center justify-end gap-3 text-sm text-slate-600">
          <span>Página {page} de {totalPages} · {total} contatos</span>
          <button type="button" className="btn-secondary" disabled={page <= 1} onClick={() => {setPage(n => n - 1); window.scrollTo({top: 0, behavior: 'smooth'});}}>Anterior</button>
          <button type="button" className="btn-secondary" disabled={page >= totalPages} onClick={() => {setPage(n => n + 1); window.scrollTo({top: 0, behavior: 'smooth'});}}>Próxima</button>
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
