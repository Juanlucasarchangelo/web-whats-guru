import { useEffect, useState, useCallback, useRef } from 'react';
import { useOrg } from '@/contexts/OrgContext';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { apiRequest } from '@/lib/api';
import { Spinner } from '@/components/ui/Spinner';
import { EmptyState } from '@/components/ui/EmptyState';
import { Modal } from '@/components/ui/Modal';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { toastSuccess, toastError } from '@/components/ui/Toast';
import type { Conversation, Message, Tag, QuickReply, InternalNote, Contact } from '@/types';
import {
  Search, Filter, Send, Paperclip, Bot, User, Plus, Users as UsersIcon, RefreshCw,
  Tag as TagIcon, StickyNote, Zap, CheckCheck, Check, Circle,
  Inbox as InboxIcon, X, MoreVertical, UserCheck, Archive, MessageCircle,
} from 'lucide-react';
interface OrgMemberInfo {
  user_id: string;
  role: string;
  profile?: { full_name: string } | null;
}
export function InboxPage() {
  const { currentOrg } = useOrg();
  const { user } = useAuth();
  const orgId = currentOrg?.id;
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [creatingConversation, setCreatingConversation] = useState(false);
  const [availableContacts, setAvailableContacts] = useState<Contact[]>([]);
  const [newContactId, setNewContactId] = useState('');
  const [contactsMap, setContactsMap] = useState<Record<string, Contact>>({});
  const [selectedConv, setSelectedConv] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [quickReplies, setQuickReplies] = useState<QuickReply[]>([]);
  const [notes, setNotes] = useState<InternalNote[]>([]);
  const [members, setMembers] = useState<OrgMemberInfo[]>([]);
  const [convTags, setConvTags] = useState<Tag[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [assigneeFilter, setAssigneeFilter] = useState<string>('all');
  const [tagFilter, setTagFilter] = useState<string>('all');
  const [messageInput, setMessageInput] = useState('');
  const [suggestingAI, setSuggestingAI] = useState(false);
  const [whatsAppProvider, setWhatsAppProvider] = useState<'evolution_api' | 'meta' | 'unknown'>('unknown');
  const [syncing, setSyncing] = useState(false);
  const [syncInfo, setSyncInfo] = useState<string | null>(null);
  const [webhookInfo, setWebhookInfo] = useState<string | null>(null);
  const syncInProgress = useRef(false);
  const [showQuickReplies, setShowQuickReplies] = useState(false);
  const [showNotes, setShowNotes] = useState(false);
  const [showTags, setShowTags] = useState(false);
  const [showAssign, setShowAssign] = useState(false);
  const [noteInput, setNoteInput] = useState('');
  const [showConfirmClose, setShowConfirmClose] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const loadConversations = useCallback(async (silent = false) => {
    if (!orgId) return;
    if (!silent) setLoading(true);
    try {
      let query = supabase
        .from('conversations')
        .select('*')
        .eq('org_id', orgId)
        .order('last_message_at', { ascending: false });
      if (statusFilter !== 'all') query = query.eq('status', statusFilter);
      if (assigneeFilter === 'me') query = query.eq('assigned_to', user!.id);
      if (assigneeFilter === 'unassigned') query = query.is('assigned_to', null);
      if (tagFilter !== 'all') {
        const { data: ctData } = await supabase
          .from('conversation_tags')
          .select('conversation_id')
          .eq('tag_id', tagFilter);
        const convIds = (ctData ?? []).map((ct: any) => ct.conversation_id);
        if (convIds.length === 0) {
          setConversations([]);
          setLoading(false);
          return;
        }
        query = query.in('id', convIds);
      }
      const { data, error } = await query;
      if (error) throw error;
      let convList = (data ?? []) as Conversation[];
      if (search.trim()) {
        const contactIds = convList.map(c => c.contact_id);
        if (contactIds.length > 0) {
          const { data: contactsData } = await supabase
            .from('contacts')
            .select('*')
            .in('id', contactIds)
            .ilike('name', `%${search}%`);
          const matchingIds = new Set((contactsData ?? []).map((c: Contact) => c.id));
          convList = convList.filter(c => matchingIds.has(c.contact_id));
        }
      }
      // Load contacts for all conversations
      const allContactIds = convList.map(c => c.contact_id);
      if (allContactIds.length > 0) {
        const { data: contactsData } = await supabase
          .from('contacts')
          .select('*')
          .in('id', allContactIds);
        const map: Record<string, Contact> = {};
        (contactsData ?? []).forEach((c: Contact) => { map[c.id] = c as Contact; });
        setContactsMap(map);
      }
      setConversations(convList);
    } catch (err) {
      if (silent) console.warn('[Inbox] Falha ao atualizar conversas:', err);
      else toastError(err instanceof Error ? err.message : 'Erro ao carregar conversas');
    } finally {
      if (!silent) setLoading(false);
    }
  }, [orgId, statusFilter, assigneeFilter, tagFilter, search, user]);
  // Detecta o provedor da organizacao para mostrar opcoes compatíveis.
  useEffect(() => {
    if (!orgId) { setWhatsAppProvider('unknown'); return; }
    let active = true;
    apiRequest<{data: Array<{type:string; config?:{provider?:string}}>}>('/integrations')
      .then(result => {
        if (!active) return;
        const configured = result.data?.find(i => i.type === 'whatsapp');
        const provider = configured?.config?.provider;
        setWhatsAppProvider(provider === 'evolution_api' ? 'evolution_api' : provider ? 'meta' : 'unknown');
      })
      .catch(err => {
        console.warn('[Inbox] Falha ao consultar provedor WhatsApp:', err);
        if (active) setWhatsAppProvider('unknown');
      });
    return () => { active = false; };
  }, [orgId]);

  // Load tags, quick replies, and members
  useEffect(() => {
    if (!orgId) return;
    Promise.all([
      supabase.from('tags').select('*').eq('org_id', orgId),
      supabase.from('quick_replies').select('*').eq('org_id', orgId),
      supabase.from('org_members').select('user_id, role').eq('org_id', orgId).eq('status', 'active'),
    ]).then(async ([tagRes, qrRes, memberRes]) => {
      if (tagRes.data) setTags(tagRes.data as Tag[]);
      if (qrRes.data) setQuickReplies(qrRes.data as QuickReply[]);
      if (memberRes.data) {
        const memberInfos: OrgMemberInfo[] = [];
        for (const m of memberRes.data as any[]) {
          const { data: prof } = await supabase
            .from('user_profiles')
            .select('full_name')
            .eq('user_id', m.user_id)
            .maybeSingle();
          memberInfos.push({ user_id: m.user_id, role: m.role, profile: prof as any });
        }
        setMembers(memberInfos);
      }
    });
  }, [orgId]);
  useEffect(() => {
    loadConversations();
  }, [loadConversations]);
  // Load messages when selecting a conversation
  const loadMessages = useCallback(async (convId: string, silent = false) => {
    if (!silent) setLoadingMessages(true);
    try {
      const { data, error } = await supabase
        .from('messages')
        .select('*')
        .eq('conversation_id', convId)
        .order('created_at', { ascending: true });
      if (error) throw error;
      setMessages((data ?? []) as Message[]);
      // Load conversation tags
      const { data: ctData } = await supabase
        .from('conversation_tags')
        .select('tag:tags(*)')
        .eq('conversation_id', convId);
      setConvTags((ctData ?? []).map((ct: any) => ct.tag) as Tag[]);
      // Load notes
      const { data: noteData } = await supabase
        .from('internal_notes')
        .select('*')
        .eq('conversation_id', convId)
        .order('created_at', { ascending: false });
      setNotes((noteData ?? []) as InternalNote[]);
      // Mark as read
      if (selectedConv?.unread_count && selectedConv.unread_count > 0) {
        await supabase
          .from('conversations')
          .update({ unread_count: 0 })
          .eq('id', convId);
      }
    } catch (err) {
      if (silent) console.warn('[Inbox] Falha ao atualizar mensagens:', err);
      else toastError(err instanceof Error ? err.message : 'Erro ao carregar mensagens');
    } finally {
      if (!silent) setLoadingMessages(false);
    }
  }, [selectedConv]);
  useEffect(() => {
    if (selectedConv) {
      loadMessages(selectedConv.id);
    }
  }, [selectedConv?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  // Atualiza conversas e mensagens pelo MySQL enquanto o webhook e a recuperacao Evolution operam.
  useEffect(() => {
    if (!orgId) return;
    const handle = window.setInterval(() => {
      void loadConversations(true);
      if (selectedConv?.id) void loadMessages(selectedConv.id, true);
    }, 5000);
    return () => window.clearInterval(handle);
  }, [orgId, selectedConv?.id, loadConversations, loadMessages]);
  // Recover recent messages directly from Evolution if a webhook did not reach the local API.
  // The backend only imports messages belonging to the selected phone number.
  const syncFromEvolution = useCallback(async (conversationId: string, showToast = false) => {
    if (syncInProgress.current) return;
    syncInProgress.current = true;
    if (showToast) setSyncing(true);
    try {
      const result = await apiRequest<{ok:boolean; counts:Record<string,number>; scanned:number}>(
        `/conversations/${conversationId}/sync-evolution`, { method: 'POST' },
      );
      const received = result.counts?.received ?? 0;
      const unresolved = result.counts?.ignored_phone_unresolved ?? 0;
      setSyncInfo(received > 0 ? `${received} nova(s) mensagem(ns) recebida(s)` :
        unresolved > 0 ? 'Mensagens com identificador sem telefone. Consulte o diagnóstico.' :
        'Mensagens sincronizadas');
      await Promise.all([loadMessages(conversationId, true), loadConversations(true)]);
      if (showToast) toastSuccess(received > 0 ? `${received} mensagem(ns) recuperada(s)` : 'Conversa sincronizada');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Falha ao sincronizar Evolution';
      setSyncInfo(`Falha na sincronização: ${message}`);
      console.warn('[Inbox] Sincronização Evolution:', message);
      if (showToast) toastError(message);
    } finally {
      syncInProgress.current = false;
      if (showToast) setSyncing(false);
    }
  }, [loadMessages, loadConversations]);

  // Webhook is primary; this bounded per-chat recovery runs only while the chat is open.
  useEffect(() => {
    if (whatsAppProvider !== 'evolution_api' || !selectedConv?.id || selectedConv.channel !== 'whatsapp') return;
    const convId = selectedConv.id;
    void syncFromEvolution(convId);
    const handle = window.setInterval(() => void syncFromEvolution(convId), 30000);
    return () => window.clearInterval(handle);
  }, [orgId, selectedConv?.id, whatsAppProvider]); // eslint-disable-line react-hooks/exhaustive-deps

  async function inspectWebhook() {
    try {
      const result = await apiRequest<{
        webhook?: {enabled:boolean;messages_upsert:boolean;has_url:boolean};
        webhook_error?:string;last_event?:{received_at:string;processed:boolean;error?:string};
        webhook_configured_in_server:boolean;
      }>('/integrations/whatsapp/diagnostics');
      if (result.webhook_error) setWebhookInfo(`Erro ao consultar Evolution: ${result.webhook_error}`);
      else if (!result.webhook_configured_in_server) setWebhookInfo('Webhook não configurado no server/.env. Use Sincronizar para recuperar mensagens.');
      else if (!result.webhook?.enabled || !result.webhook.messages_upsert)
        setWebhookInfo('Webhook não ativo na Evolution. Clique em Ativar recebimento.');
      else if (result.last_event && !result.last_event.processed)
        setWebhookInfo('Webhook ativo, mas último evento falhou. Consulte o terminal do backend.');
      else setWebhookInfo(`Webhook ativo${result.last_event?.received_at ? ` • Último evento: ${new Date(result.last_event.received_at).toLocaleString('pt-BR')}` : ' • Aguardando primeira resposta'}`);
    } catch (error) {
      setWebhookInfo(`Diagnóstico indisponível: ${error instanceof Error ? error.message : 'erro inesperado'}`);
    }
  }

  async function activateWebhook() {
    try {
      await apiRequest('/integrations/whatsapp/reconfigure-webhook', { method: 'POST' });
      toastSuccess('Registro de webhook solicitado à Evolution');
      await inspectWebhook();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Falha ao ativar webhook';
      setWebhookInfo(message);
      toastError(message);
    }
  }

  async function openNewConversation() {
    try {
      const response = await apiRequest<{data:Contact[]}>('/contacts?limit=100');
      setAvailableContacts(response.data);
      setNewContactId(response.data[0]?.id || '');
      setCreatingConversation(true);
    } catch (err) { toastError(err instanceof Error ? err.message : 'Erro ao carregar contatos'); }
  }
  async function createConversation() {
    if (!newContactId) return;
    try {
      const conversation = await apiRequest<Conversation>('/conversations', {
        method: 'POST', body: JSON.stringify({contact_id:newContactId,channel:'whatsapp'}),
      });
      setContactsMap(prev => ({...prev, ...Object.fromEntries(availableContacts.map(c=>[c.id,c]))}));
      setSelectedConv(conversation);
      setCreatingConversation(false);
      await loadConversations();
      toastSuccess('Conversa criada');
    } catch (err) { toastError(err instanceof Error ? err.message : 'Erro ao criar conversa'); }
  }
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);
  async function sendApprovedTemplate() {
    if (!selectedConv || selectedConv.channel !== 'whatsapp') return;
    const name = window.prompt('Nome exato do template aprovado na Meta (ex.: hello_world):', 'hello_world');
    if (!name) return;
    const language = window.prompt('Idioma do template aprovado (ex.: en_US ou pt_BR):', 'en_US');
    if (!language) return;
    try {
      const r = await apiRequest<{message:Message;accepted_by_meta:boolean}>('/integrations/whatsapp/template', {
        method:'POST',body:JSON.stringify({conversation_id:selectedConv.id,name,language}),
      });
      setMessages(prev=>[...prev,r.message]);
      toastSuccess('Template aceito pela Meta; entrega ainda nao confirmada');
    } catch(e) {toastError(e instanceof Error?e.message:'Falha ao enviar template');}
  }
  async function suggestWithAI() {
    if (!selectedConv || suggestingAI) return;
    setSuggestingAI(true);
    try {
      const r = await apiRequest<{suggestion:string;sent:boolean}>('/integrations/ai/suggest', {
        method:'POST',body:JSON.stringify({conversation_id:selectedConv.id}),
      });
      setMessageInput(r.suggestion);
      toastSuccess('Sugestao inserida no campo. Revise antes de enviar.');
    } catch(e) { toastError(e instanceof Error?e.message:'Falha na IA'); }
    finally {setSuggestingAI(false);}
  }
  async function handleSendMessage() {
    if (!messageInput.trim() || !selectedConv || !orgId || !user) return;
    const body = messageInput.trim();
    setMessageInput('');
    setShowQuickReplies(false);
    try {
      // WhatsApp messages are sent by the configured provider (Evolution or Meta).
      const data = await apiRequest<Message>(`/conversations/${selectedConv.id}/messages`, {
        method: 'POST', body: JSON.stringify({body, is_internal:false}),
      });
      setMessages(prev => [...prev, data]);
      if (selectedConv.channel === 'whatsapp') toastSuccess('Mensagem encaminhada ao provedor; entrega ainda nao confirmada');
    } catch (err) {
      toastError(err instanceof Error ? err.message : 'Erro ao enviar mensagem');
      setMessageInput(body);
    }
  }
  async function handleAddNote() {
    if (!noteInput.trim() || !selectedConv || !orgId || !user) return;
    try {
      const { data, error } = await supabase
        .from('internal_notes')
        .insert({
          conversation_id: selectedConv.id,
          org_id: orgId,
          author_id: user.id,
          body: noteInput.trim(),
        })
        .select('*')
        .maybeSingle();
      if (error) throw error;
      if (data) setNotes(prev => [data as InternalNote, ...prev]);
      setNoteInput('');
      toastSuccess('Nota interna adicionada');
    } catch (err) {
      toastError('Erro ao adicionar nota');
    }
  }
  async function handleAssign(userId: string | null) {
    if (!selectedConv) return;
    try {
      const { error } = await supabase
        .from('conversations')
        .update({ assigned_to: userId })
        .eq('id', selectedConv.id);
      if (error) throw error;
      setSelectedConv({ ...selectedConv, assigned_to: userId });
      setConversations(prev => prev.map(c => c.id === selectedConv.id ? { ...c, assigned_to: userId } : c));
      setShowAssign(false);
      toastSuccess(userId ? 'Conversa atribuída' : 'Atribuição removida');
    } catch {
      toastError('Erro ao atribuir conversa');
    }
  }
  async function handleToggleTag(tagId: string) {
    if (!selectedConv) return;
    const hasTag = convTags.some(t => t.id === tagId);
    try {
      if (hasTag) {
        await supabase
          .from('conversation_tags')
          .delete()
          .eq('conversation_id', selectedConv.id)
          .eq('tag_id', tagId);
        setConvTags(prev => prev.filter(t => t.id !== tagId));
      } else {
        await supabase
          .from('conversation_tags')
          .insert({ conversation_id: selectedConv.id, tag_id: tagId });
        const tag = tags.find(t => t.id === tagId);
        if (tag) setConvTags(prev => [...prev, tag]);
      }
    } catch {
      toastError('Erro ao alterar etiqueta');
    }
  }
  async function handleCloseConversation() {
    if (!selectedConv) return;
    try {
      const { error } = await supabase
        .from('conversations')
        .update({ status: 'closed' })
        .eq('id', selectedConv.id);
      if (error) throw error;
      setSelectedConv({ ...selectedConv, status: 'closed' });
      setConversations(prev => prev.map(c => c.id === selectedConv.id ? { ...c, status: 'closed' } : c));
      setShowConfirmClose(false);
      toastSuccess('Conversa encerrada');
    } catch {
      toastError('Erro ao encerrar conversa');
    }
  }
  async function handleReopenConversation() {
    if (!selectedConv) return;
    try {
      const { error } = await supabase
        .from('conversations')
        .update({ status: 'open' })
        .eq('id', selectedConv.id);
      if (error) throw error;
      setSelectedConv({ ...selectedConv, status: 'open' });
      setConversations(prev => prev.map(c => c.id === selectedConv.id ? { ...c, status: 'open' } : c));
      toastSuccess('Conversa reaberta');
    } catch {
      toastError('Erro ao reabrir conversa');
    }
  }
  function handleQuickReply(qr: QuickReply) {
    setMessageInput(qr.body);
    setShowQuickReplies(false);
  }
  const memberName = (userId: string | null) => {
    if (!userId) return null;
    const m = members.find(mem => mem.user_id === userId);
    return m?.profile?.full_name ?? 'Atendente';
  };
  const contact = selectedConv ? contactsMap[selectedConv.contact_id] : null;
  return (
    <div className="flex h-full">
      {/* Conversations list */}
      <div className="w-full md:w-80 lg:w-96 border-r border-slate-200 bg-white flex flex-col">
        {/* Search & filters */}
        <div className="p-4 border-b border-slate-100 space-y-3">
          <button type="button" className="btn-primary w-full justify-center" onClick={openNewConversation}><Plus size={16}/> Nova conversa</button>
          {creatingConversation && <div className="rounded-lg bg-blue-50 border border-blue-200 p-3 space-y-2">
            <p className="text-sm font-medium">Selecione um contato</p>
            {availableContacts.length ? <><select className="input w-full" value={newContactId} onChange={e=>setNewContactId(e.target.value)}>
              {availableContacts.map(c=><option key={c.id} value={c.id}>{c.name} {c.phone ? `(${c.phone})` : ''}</option>)}
            </select><div className="flex gap-2"><button className="btn-primary" onClick={createConversation}>Criar</button><button className="btn-secondary" onClick={()=>setCreatingConversation(false)}>Cancelar</button></div></>
            : <p className="text-sm text-slate-500">Cadastre um contato primeiro na aba Contatos.</p>}
          </div>}
          {whatsAppProvider === 'evolution_api' && (
            <div className="rounded-lg bg-slate-50 border border-slate-200 p-2 text-xs text-slate-600 space-y-2">
              <div className="flex flex-wrap gap-2 items-center justify-between">
                <span>WhatsApp Evolution • Recebimento</span>
                <button type="button" className="text-blue-700 underline" onClick={inspectWebhook}>Verificar</button>
                <button type="button" className="text-blue-700 underline" onClick={activateWebhook}>Ativar webhook</button>
              </div>
              {webhookInfo && <p role="status" className="break-words">{webhookInfo}</p>}
            </div>
          )}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por contato..."
              className="input pl-9 py-2 text-sm"
            />
          </div>
          <div className="flex gap-2 flex-wrap">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="rounded-lg border-0 bg-slate-100 px-2.5 py-1.5 text-xs font-medium text-slate-600 ring-1 ring-inset ring-slate-200 cursor-pointer"
            >
              <option value="all">Todos status</option>
              <option value="open">Abertas</option>
              <option value="pending">Pendentes</option>
              <option value="closed">Fechadas</option>
            </select>
            <select
              value={assigneeFilter}
              onChange={(e) => setAssigneeFilter(e.target.value)}
              className="rounded-lg border-0 bg-slate-100 px-2.5 py-1.5 text-xs font-medium text-slate-600 ring-1 ring-inset ring-slate-200 cursor-pointer"
            >
              <option value="all">Todos atendentes</option>
              <option value="me">Atribuídas a mim</option>
              <option value="unassigned">Sem atribuição</option>
            </select>
            {tags.length > 0 && (
              <select
                value={tagFilter}
                onChange={(e) => setTagFilter(e.target.value)}
                className="rounded-lg border-0 bg-slate-100 px-2.5 py-1.5 text-xs font-medium text-slate-600 ring-1 ring-inset ring-slate-200 cursor-pointer"
              >
                <option value="all">Todas etiquetas</option>
                {tags.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            )}
          </div>
        </div>
        {/* Conversation list */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex justify-center py-8"><Spinner /></div>
          ) : conversations.length === 0 ? (
            <EmptyState
              icon={<InboxIcon size={28} />}
              title="Nenhuma conversa"
              description="Não há conversas que correspondam aos filtros."
            />
          ) : (
            conversations.map((conv) => {
              const c = contactsMap[conv.contact_id];
              const isActive = selectedConv?.id === conv.id;
              return (
                <button
                  key={conv.id}
                  onClick={() => setSelectedConv(conv)}
                  className={`w-full flex items-start gap-3 px-4 py-3 border-b border-slate-50 text-left transition-colors hover:bg-slate-50 ${
                    isActive ? 'bg-blue-50 hover:bg-blue-50' : ''
                  }`}
                >
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-200 text-sm font-semibold text-slate-700 flex-shrink-0">
                    {(c?.name ?? '?').charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-medium text-slate-900 truncate">{c?.name ?? 'Desconhecido'}</p>
                      {conv.unread_count > 0 && (
                        <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-blue-600 px-1.5 text-xs font-bold text-white">
                          {conv.unread_count}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-400 mt-0.5">
                      {conv.status === 'open' ? 'Aberta' : conv.status === 'pending' ? 'Pendente' : 'Fechada'}
                      {memberName(conv.assigned_to) && ` · ${memberName(conv.assigned_to)}`}
                    </p>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>
      {/* Chat area */}
      {selectedConv ? (
        <div className="flex-1 flex flex-col bg-slate-50">
          {/* Chat header */}
          <div className="bg-white border-b border-slate-200 px-4 py-3 flex items-center justify-between">
            <div className="flex items-center gap-3 min-w-0">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-200 text-sm font-semibold text-slate-700 flex-shrink-0">
                {(contact?.name ?? '?').charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0">
                <p className="font-medium text-slate-900 truncate">{contact?.name ?? 'Desconhecido'}</p>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className={`badge ${
                    selectedConv.status === 'open' ? 'badge-green' :
                    selectedConv.status === 'pending' ? 'badge-yellow' : 'badge-gray'
                  }`}>
                    {selectedConv.status === 'open' ? 'Aberta' : selectedConv.status === 'pending' ? 'Pendente' : 'Fechada'}
                  </span>
                  {memberName(selectedConv.assigned_to) && (
                    <span className="text-xs text-slate-400">{memberName(selectedConv.assigned_to)}</span>
                  )}
                  {convTags.map(t => (
                    <span key={t.id} className="badge badge-blue" style={{ backgroundColor: `${t.color}15`, color: t.color }}>
                      {t.name}
                    </span>
                  ))}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-1">
              {selectedConv.channel === 'whatsapp' && whatsAppProvider === 'evolution_api' && (
                <button type="button" className="btn-ghost px-2 py-1.5" disabled={syncing}
                  onClick={() => void syncFromEvolution(selectedConv.id, true)}
                  title="Sincronizar respostas diretamente da Evolution API">
                  <RefreshCw size={18} className={syncing ? 'animate-spin' : ''} />
                </button>
              )}
              <button onClick={() => setShowAssign(true)} className="btn-ghost px-2 py-1.5" title="Atribuir">
                <UserCheck size={18} />
              </button>
              <button onClick={() => setShowTags(true)} className="btn-ghost px-2 py-1.5" title="Etiquetas">
                <TagIcon size={18} />
              </button>
              <button onClick={() => setShowNotes(true)} className="btn-ghost px-2 py-1.5" title="Notas internas">
                <StickyNote size={18} />
              </button>
              {selectedConv.status !== 'closed' ? (
                <button onClick={() => setShowConfirmClose(true)} className="btn-ghost px-2 py-1.5" title="Encerrar">
                  <Archive size={18} />
                </button>
              ) : (
                <button onClick={handleReopenConversation} className="btn-ghost px-2 py-1.5" title="Reabrir">
                  <InboxIcon size={18} />
                </button>
              )}
            </div>
          </div>
          {syncInfo && selectedConv.channel === 'whatsapp' && whatsAppProvider === 'evolution_api' && (
            <div className={`px-4 py-1 text-xs ${syncInfo.startsWith('Falha') ? 'bg-amber-50 text-amber-800' : 'bg-slate-100 text-slate-500'}`} role="status">
              {syncInfo}
            </div>
          )}
          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {loadingMessages ? (
              <div className="flex justify-center py-8"><Spinner /></div>
            ) : messages.length === 0 ? (
              <EmptyState icon={<MessageBubble />} title="Sem mensagens" description="Inicie a conversa enviando uma mensagem." />
            ) : (
              messages.map((msg) => {
                const isAgent = msg.sender_type === 'agent' || msg.sender_type === 'bot';
                return (
                  <div key={msg.id} className={`flex ${isAgent ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[75%] rounded-2xl px-4 py-2.5 ${
                      isAgent
                        ? msg.is_bot ? 'bg-purple-100 text-purple-900' : 'bg-blue-600 text-white'
                        : 'bg-white text-slate-900 shadow-sm ring-1 ring-slate-100'
                    }`}>
                      {msg.is_bot && (
                        <div className="flex items-center gap-1 mb-1 text-xs opacity-70">
                          <Bot size={12} /> Bot
                        </div>
                      )}
                      <p className="text-sm whitespace-pre-wrap break-words">{msg.body}</p>
                      <div className={`flex items-center gap-1 mt-1 text-xs ${isAgent ? (msg.is_bot ? 'text-purple-500' : 'text-blue-200') : 'text-slate-400'}`}>
                        {new Date(msg.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                        {isAgent && !msg.is_bot && (
                          msg.status === 'read' ? <CheckCheck size={14} /> :
                          msg.status === 'delivered' ? <CheckCheck size={14} className="opacity-50" /> :
                          <Check size={14} />
                        )}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
            <div ref={messagesEndRef} />
          </div>
          {/* Message input */}
          {selectedConv.status !== 'closed' && (
            <div className="bg-white border-t border-slate-200 p-3">
              {showQuickReplies && (
                <div className="mb-2 rounded-lg border border-slate-200 shadow-sm max-h-48 overflow-y-auto">
                  <div className="px-3 py-2 border-b border-slate-100 flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-600">Respostas Rápidas</span>
                    <button onClick={() => setShowQuickReplies(false)}><X size={14} className="text-slate-400" /></button>
                  </div>
                  {quickReplies.length === 0 ? (
                    <p className="px-3 py-4 text-sm text-slate-400 text-center">Nenhuma resposta rápida cadastrada.</p>
                  ) : (
                    quickReplies.map(qr => (
                      <button
                        key={qr.id}
                        onClick={() => handleQuickReply(qr)}
                        className="w-full flex items-center gap-2 px-3 py-2.5 hover:bg-slate-50 text-left border-b border-slate-50 last:border-0"
                      >
                        <Zap size={14} className="text-blue-500 flex-shrink-0" />
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-slate-700">{qr.title}</p>
                          <p className="text-xs text-slate-400 truncate">{qr.shortcut}</p>
                        </div>
                      </button>
                    ))
                  )}
                </div>
              )}
              {selectedConv.channel === 'whatsapp' && whatsAppProvider === 'meta' && <p className="text-xs text-amber-700 pb-2">WhatsApp oficial: mensagens livres exigem janela de atendimento de 24h. Fora dela, utilize template aprovado na Meta. Aceite nao confirma entrega.</p>}
              <div className="flex justify-end gap-2 pb-2">
                {selectedConv.channel === 'whatsapp' && whatsAppProvider === 'meta' && <button type="button" className="btn-ghost text-xs" onClick={sendApprovedTemplate}>Enviar template aprovado</button>}
                <button type="button" className="btn-ghost text-xs" disabled={suggestingAI} onClick={suggestWithAI}><Bot size={14} className="inline mr-1"/>{suggestingAI?'Gerando…':'Sugerir resposta com IA'}</button>
              </div>
              <div className="flex items-end gap-2">
                <button
                  onClick={() => setShowQuickReplies(!showQuickReplies)}
                  className="btn-ghost px-2 py-2"
                  title="Respostas rápidas"
                >
                  <Zap size={20} />
                </button>
                <button className="btn-ghost px-2 py-2" title="Anexar arquivo" onClick={() => toastError('Anexos requerem configuração de armazenamento')}>
                  <Paperclip size={20} />
                </button>
                <textarea
                  value={messageInput}
                  onChange={(e) => setMessageInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleSendMessage();
                    }
                  }}
                  placeholder="Digite sua mensagem..."
                  rows={1}
                  className="flex-1 resize-none rounded-lg border-0 py-2.5 px-3.5 text-sm ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-blue-600 max-h-32"
                />
                <button
                  onClick={handleSendMessage}
                  disabled={!messageInput.trim()}
                  className="btn-primary px-3 py-2.5"
                >
                  <Send size={18} />
                </button>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="flex-1 hidden md:flex items-center justify-center bg-slate-50">
          <EmptyState
            icon={<InboxIcon size={32} />}
            title="Selecione uma conversa"
            description="Escolha uma conversa à esquerda para visualizar as mensagens."
          />
        </div>
      )}
      {/* Assign modal */}
      <Modal open={showAssign} onClose={() => setShowAssign(false)} title="Atribuir conversa" size="sm">
        <div className="space-y-2">
          <button
            onClick={() => handleAssign(null)}
            className="flex items-center gap-3 w-full px-3 py-2.5 rounded-lg hover:bg-slate-50 text-left"
          >
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100">
              <UsersIcon size={16} className="text-slate-400" />
            </div>
            <span className="text-sm text-slate-700">Sem atribuição</span>
          </button>
          {members.map(m => (
            <button
              key={m.user_id}
              onClick={() => handleAssign(m.user_id)}
              className={`flex items-center gap-3 w-full px-3 py-2.5 rounded-lg hover:bg-slate-50 text-left ${
                selectedConv?.assigned_to === m.user_id ? 'bg-blue-50' : ''
              }`}
            >
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-100 text-sm font-semibold text-blue-700">
                {(m.profile?.full_name ?? '?').charAt(0).toUpperCase()}
              </div>
              <div>
                <p className="text-sm font-medium text-slate-700">{m.profile?.full_name ?? 'Atendente'}</p>
                <p className="text-xs text-slate-400 capitalize">{m.role}</p>
              </div>
            </button>
          ))}
        </div>
      </Modal>
      {/* Tags modal */}
      <Modal open={showTags} onClose={() => setShowTags(false)} title="Etiquetas da conversa" size="sm">
        {tags.length === 0 ? (
          <p className="text-sm text-slate-500 text-center py-4">Nenhuma etiqueta cadastrada.</p>
        ) : (
          <div className="space-y-2">
            {tags.map(tag => {
              const active = convTags.some(t => t.id === tag.id);
              return (
                <button
                  key={tag.id}
                  onClick={() => handleToggleTag(tag.id)}
                  className={`flex items-center gap-3 w-full px-3 py-2.5 rounded-lg text-left transition-colors ${
                    active ? 'bg-blue-50' : 'hover:bg-slate-50'
                  }`}
                >
                  <div className="h-4 w-4 rounded-full flex-shrink-0" style={{ backgroundColor: tag.color }} />
                  <span className="text-sm text-slate-700 flex-1">{tag.name}</span>
                  {active && <Check size={16} className="text-blue-600" />}
                </button>
              );
            })}
          </div>
        )}
      </Modal>
      {/* Notes modal */}
      <Modal open={showNotes} onClose={() => setShowNotes(false)} title="Notas internas" size="md">
        <div className="space-y-4">
          <div className="flex gap-2">
            <textarea
              value={noteInput}
              onChange={(e) => setNoteInput(e.target.value)}
              placeholder="Escreva uma nota interna (visível apenas para a equipe)..."
              rows={3}
              className="input resize-none"
            />
            <button onClick={handleAddNote} disabled={!noteInput.trim()} className="btn-primary px-3 self-stretch">
              <Send size={16} />
            </button>
          </div>
          {notes.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-4">Nenhuma nota interna ainda.</p>
          ) : (
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {notes.map(note => (
                <div key={note.id} className="rounded-lg bg-yellow-50 ring-1 ring-yellow-200 p-3">
                  <p className="text-sm text-slate-700">{note.body}</p>
                  <p className="text-xs text-slate-400 mt-1">
                    {memberName(note.author_id)} · {new Date(note.created_at).toLocaleString('pt-BR')}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </Modal>
      {/* Close confirmation */}
      <ConfirmDialog
        open={showConfirmClose}
        title="Encerrar conversa"
        message="Tem certeza que deseja encerrar esta conversa? Você poderá reabri-la depois."
        confirmLabel="Encerrar"
        onConfirm={handleCloseConversation}
        onCancel={() => setShowConfirmClose(false)}
      />
    </div>
  );
}
function MessageBubble() {
  return <MessageCircle size={28} className="text-slate-300" />;
}
