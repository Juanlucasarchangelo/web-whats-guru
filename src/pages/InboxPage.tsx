import { useEffect, useLayoutEffect, useState, useCallback, useRef } from 'react';
import { useOrg } from '@/contexts/OrgContext';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { apiRequest } from '@/lib/api';
import { ChannelsPanel } from '@/components/ChannelsPanel';
import { MessageMedia } from '@/components/inbox/MessageMedia';
import { Spinner } from '@/components/ui/Spinner';
import { EmptyState } from '@/components/ui/EmptyState';
import { Modal } from '@/components/ui/Modal';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { toastSuccess, toastError } from '@/components/ui/Toast';
import type { Conversation, Message, Tag, QuickReply, InternalNote, Contact } from '@/types';
import {
  Search, Filter, Send, Paperclip, Bot, User, Plus, Users as UsersIcon, RefreshCw,
  Tag as TagIcon, StickyNote, Zap, CheckCheck, Check, Circle,
  Inbox as InboxIcon, X, MoreVertical, UserCheck, Archive, MessageCircle, ArrowLeft, ChevronDown,
} from 'lucide-react';
interface ImportStatus { status:string; contacts?:number; chats?:number; scanned?:number;
  pages?:number; counts?:Record<string,number>; aliases?:number; alias_warning?:boolean; cutoff?:string; truncated?:boolean; partial?:boolean; error?:string; }
interface ChannelInfo { id:string; name:string; instance_name:string|null; provider:string; status:string; contact_sync?:ImportStatus; }
interface OrgMemberInfo {
  user_id: string;
  role: string;
  profile?: { full_name: string } | null;
}
export function InboxPage() {
  const { currentOrg, currentMembership, organizations, switchOrganization } = useOrg();
  const { user } = useAuth();
  const orgId = currentOrg?.id;
  const isDev = user?.global_role === 'dev';
  const isMaster = currentMembership?.role === 'master' || currentMembership?.role === 'owner';
  const showMasterFilters = isMaster && !isDev;
  const showNumberFilter = isDev || isMaster;
  const [showMyWhatsApp,setShowMyWhatsApp] = useState(false);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [moreConversations, setMoreConversations] = useState(false);
  const [conversationPage, setConversationPage] = useState(1);
  const [loadingMore, setLoadingMore] = useState(false);
  const [creatingConversation, setCreatingConversation] = useState(false);
  const [availableContacts, setAvailableContacts] = useState<Contact[]>([]);
  const [contactPage, setContactPage] = useState(1);
  const [moreAvailableContacts, setMoreAvailableContacts] = useState(false);
  const [availableContactsTotal, setAvailableContactsTotal] = useState(0);
  const [loadingAvailableContacts, setLoadingAvailableContacts] = useState(false);
  const contactRequestVersion = useRef(0);
  const [newContactId, setNewContactId] = useState('');
  const [newContactQuery, setNewContactQuery] = useState('');
  const [contactPickerOpen, setContactPickerOpen] = useState(false);
  const contactPickerRef = useRef<HTMLDivElement>(null);
  const [channels, setChannels] = useState<ChannelInfo[]>([]);
  const [channelsLoaded, setChannelsLoaded] = useState(false);
  const [channelFilter, setChannelFilter] = useState('all');
  const [newChannelId, setNewChannelId] = useState('');
  const [contactsMap, setContactsMap] = useState<Record<string, Contact>>({});
  const [selectedConv, setSelectedConv] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [olderCursor, setOlderCursor] = useState<string | null>(null);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
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
  const [contactSyncRequesting, setContactSyncRequesting] = useState(false);
  const [syncInfo, setSyncInfo] = useState<string | null>(null);
  const [conversationProvider, setConversationProvider] = useState<string | null>(null);
  const [syncRun, setSyncRun] = useState(0);
  const [webhookInfo, setWebhookInfo] = useState<string | null>(null);
  const syncInProgress = useRef(new Set<string>());
  const activeConvRef = useRef<string | null>(null);
  const restoreScrollRef = useRef<{ top: number; height: number } | null>(null);
  const messageListRef = useRef<HTMLDivElement>(null);
  const firstChatScrollRef = useRef(true);
  const [showQuickReplies, setShowQuickReplies] = useState(false);
  const [showNotes, setShowNotes] = useState(false);
  const [showTags, setShowTags] = useState(false);
  const [showAssign, setShowAssign] = useState(false);
  const [noteInput, setNoteInput] = useState('');
  const [showConfirmClose, setShowConfirmClose] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  // Listagem obtida exclusivamente da API autorizada, com contato incluído
  // no resultado; sem consultas IN > 500 e sem depender do limite do adapter.
  const loadConversations = useCallback(async (silent = false, page = 1) => {
    if (!orgId) return;
    if (!silent && page === 1) setLoading(true);
    if (page > 1) setLoadingMore(true);
    try {
      const query = new URLSearchParams({ limit: '100', page: String(page) });
      if (channelFilter !== 'all') query.set('integration_id', channelFilter);
      if (statusFilter !== 'all') query.set('status', statusFilter);
      if (assigneeFilter !== 'all') query.set('assignee', assigneeFilter);
      if (tagFilter !== 'all') query.set('tag_id', tagFilter);
      if (search.trim()) query.set('search', search.trim());
      const response = await apiRequest<{data:Array<Conversation & {contact:Contact|null}>;total:number;has_more:boolean}>(
        `/conversations?${query.toString()}`);
      const map: Record<string, Contact> = {};
      const data = response.data.map(({contact, ...conversation}) => {
        if (contact) map[contact.id] = contact;
        return conversation as Conversation;
      });
      setContactsMap(previous => page === 1 && !silent ? map : {...previous,...map});
      setConversations(previous => {
        if (page === 1 && !silent) return data;
        // Preserve older pages while refreshing first-page status/unread counts.
        const updated = new Map<string,Conversation>();
        if (page === 1) {
          data.forEach(row => updated.set(row.id,row));
          previous.forEach(row => { if (!updated.has(row.id)) updated.set(row.id,row); });
        } else {
          previous.forEach(row => updated.set(row.id,row));
          data.forEach(row => updated.set(row.id,row));
        }
        return [...updated.values()];
      });
      if (!silent || page > 1) setMoreConversations(response.has_more);
      if (page > 1) setConversationPage(page);
      else if (!silent) setConversationPage(1);
    } catch (err) {
      if (silent) console.warn('[Inbox] Falha ao atualizar conversas:',err);
      else toastError(err instanceof Error ? err.message : 'Erro ao carregar conversas');
    } finally {
      if (page > 1) setLoadingMore(false);
      if (!silent && page === 1) setLoading(false);
    }
  }, [orgId, statusFilter, assigneeFilter, tagFilter, search, channelFilter]);
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

  const refreshChannels=useCallback(async()=>{
    if(!orgId)return;
    try{
      const r=await apiRequest<{data:ChannelInfo[]}>('/channels?inbox=1');
      setChannels(r.data??[]);
      setChannelsLoaded(true);
      setNewChannelId(old => old && r.data?.some(c=>c.id===old) ? old : r.data?.length===1?r.data[0].id:'');
    }catch(err){console.warn('[Inbox] Números indisponíveis:',err);}
  },[orgId]);
  useEffect(()=>{setChannelFilter('all');setSelectedConv(null);setChannels([]);setChannelsLoaded(false);},[orgId]);
  useEffect(()=>{void refreshChannels();},[refreshChannels]);
  useEffect(() => {
    // Do not keep conversations of removed/unauthorized WhatsApps on screen.
    if (!orgId || !channels.length) return;
    const allowed = new Set(channels.map(channel => channel.id));
    setConversations(previous => previous.filter(conv => conv.channel !== 'whatsapp' ||
      (!!conv.integration_id && allowed.has(conv.integration_id))));
    setSelectedConv(previous => previous && previous.channel === 'whatsapp' &&
      (!previous.integration_id || !allowed.has(previous.integration_id)) ? null : previous);
  }, [orgId, channels]);
  const selectedChannel = channels.find(c=>c.id===selectedConv?.integration_id);
  const activeConversationProvider = selectedChannel?.provider ?? conversationProvider;
  // Administradores can view their company's chats without managing the other
  // owners' numbers. Resolve only the non-sensitive provider type for history sync.
  useEffect(() => {
    if (!selectedConv || selectedConv.channel !== 'whatsapp') { setConversationProvider(null); return; }
    if (selectedChannel) { setConversationProvider(selectedChannel.provider); return; }
    let active = true;
    setConversationProvider(null);
    void apiRequest<{provider:string|null}>(`/conversations/${selectedConv.id}/sync-evolution-status`)
      .then(result => { if (active) setConversationProvider(result.provider); })
      .catch(() => { if (active) setConversationProvider(null); });
    return () => { active = false; };
  }, [selectedConv?.id, selectedChannel?.provider]); // eslint-disable-line react-hooks/exhaustive-deps
  const connectedEvolutionChannels = channels.filter(c => c.provider === 'evolution_api' && c.status === 'connected');
  const syncableChannel = channelFilter !== 'all'
    ? connectedEvolutionChannels.find(c => c.id === channelFilter)
    : connectedEvolutionChannels.length === 1 ? connectedEvolutionChannels[0] : undefined;
  const manuallySyncContacts = async () => {
    if (!syncableChannel || contactSyncRequesting) return;
    setContactSyncRequesting(true);
    try {
      await apiRequest(`/channels/${syncableChannel.id}/sync-contacts`, { method: 'POST' });
      toastSuccess('Sincronização de contatos e chats solicitada');
      await refreshChannels();
    } catch (err) { toastError(err instanceof Error ? err.message : 'Falha ao atualizar contatos'); }
    finally { setContactSyncRequesting(false); }
  };

  useEffect(() => {
    if (!channels.some(c => ['queued','running'].includes(c.contact_sync?.status ?? ''))) return;
    const timer = window.setInterval(() => { void refreshChannels(); void loadConversations(true); }, 8000);
    return () => window.clearInterval(timer);
  }, [channels, refreshChannels, loadConversations]);

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
    setMoreConversations(false);
    setConversationPage(1);
    setConversations([]);
    setContactsMap({});
    setSelectedConv(null);
    void loadConversations();
  }, [loadConversations]);
  // Load recent messages first; older messages can be retrieved by cursor.
  const loadMessages = useCallback(async (convId: string, silent = false) => {
    if (!silent) setLoadingMessages(true);
    try {
      const result = await apiRequest<{data:Message[];next_cursor:string|null}>(`/conversations/${convId}/messages?limit=100`);
      if (activeConvRef.current !== convId) return;
      if (!silent) { setMessages(result.data); setOlderCursor(result.next_cursor); }
      else {
        setMessages(previous => {
          const byId = new Map(previous.map(msg => [msg.id, msg]));
          result.data.forEach(msg => byId.set(msg.id, msg));
          return [...byId.values()].sort((a,b) =>
            new Date(a.created_at).getTime()-new Date(b.created_at).getTime() || a.id.localeCompare(b.id));
        });
      }
      if (!silent) {
        const [ctRes, noteRes] = await Promise.all([
          supabase.from('conversation_tags').select('tag:tags(*)').eq('conversation_id', convId),
          supabase.from('internal_notes').select('*').eq('conversation_id', convId).order('created_at', { ascending: false }),
        ]);
        if (activeConvRef.current !== convId) return;
        setConvTags((ctRes.data ?? []).map((ct: any) => ct.tag) as Tag[]);
        setNotes((noteRes.data ?? []) as InternalNote[]);
        if (selectedConv?.unread_count && selectedConv.unread_count > 0)
          await supabase.from('conversations').update({ unread_count: 0 }).eq('id', convId);
      }
    } catch (err) {
      if (silent) console.warn('[Inbox] Falha ao atualizar mensagens:', err);
      else toastError(err instanceof Error ? err.message : 'Erro ao carregar mensagens');
    } finally { if (!silent) setLoadingMessages(false); }
  }, [selectedConv?.id, selectedConv?.unread_count]);

  const loadEarlier = useCallback(async () => {
    if (!selectedConv || !olderCursor || loadingEarlier) return;
    setLoadingEarlier(true);
    try {
      const response = await apiRequest<{data:Message[];next_cursor:string|null}>(
        `/conversations/${selectedConv.id}/messages?limit=100&cursor=${encodeURIComponent(olderCursor)}`);
      if (activeConvRef.current !== selectedConv.id) return;
      const messageList = messageListRef.current;
      if (messageList) restoreScrollRef.current = { top: messageList.scrollTop, height: messageList.scrollHeight };
      setMessages(previous => {
        const byId = new Map(previous.map(m => [m.id,m]));
        response.data.forEach(m => byId.set(m.id,m));
        return [...byId.values()].sort((a,b) =>
          new Date(a.created_at).getTime()-new Date(b.created_at).getTime() || a.id.localeCompare(b.id));
      });
      setOlderCursor(response.next_cursor);
    } catch (err) { toastError(err instanceof Error ? err.message : 'Falha ao carregar mensagens anteriores'); }
    finally { setLoadingEarlier(false); }
  }, [selectedConv?.id, olderCursor, loadingEarlier]);

  useEffect(() => {
    activeConvRef.current = selectedConv?.id ?? null;
    setMessages([]); setOlderCursor(null); setSyncInfo(null);
    firstChatScrollRef.current = true; restoreScrollRef.current = null;
    if (selectedConv) void loadMessages(selectedConv.id);
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
  // Start the background history job without blocking chat rendering.
  const syncFromEvolution = useCallback(async (conversationId: string, showToast = false) => {
    if (syncInProgress.current.has(conversationId)) return;
    syncInProgress.current.add(conversationId);
    if (showToast) setSyncing(true);
    try {
      const result = await apiRequest<{ok:boolean;sync:ImportStatus}>(
        `/conversations/${conversationId}/sync-evolution`,
        { method:'POST', body: JSON.stringify({ force: showToast }) });
      if (activeConvRef.current === conversationId) {
        setSyncInfo(result.sync?.status === 'done' ? 'Histórico já sincronizado' :
          'Buscando histórico disponível dos últimos 3 meses...');
        setSyncRun(n => n + 1);
      }
      if (showToast) toastSuccess('Importação do histórico iniciada');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Falha ao sincronizar Evolution';
      if (activeConvRef.current === conversationId) setSyncInfo(`Falha na sincronização: ${message}`);
      if (showToast) { setSyncing(false); toastError(message); }
    } finally { syncInProgress.current.delete(conversationId); }
  }, []);

  useEffect(() => {
    const convId = selectedConv?.id;
    if (!convId || selectedConv?.channel !== 'whatsapp' || activeConversationProvider !== 'evolution_api') return;
    void syncFromEvolution(convId);
  }, [orgId, selectedConv?.id, activeConversationProvider]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const convId = selectedConv?.id;
    if (!convId || activeConversationProvider !== 'evolution_api' || syncRun === 0) return;
    let active = true;
    let pollTimer: ReturnType<typeof window.setTimeout> | undefined;
    const poll = async () => {
      try {
        const response = await apiRequest<{sync:ImportStatus}>(`/conversations/${convId}/sync-evolution-status`);
        if (!active || activeConvRef.current !== convId) return;
        const state = response.sync;
        if (state?.status === 'running' || state?.status === 'queued') {
          setSyncing(true);
          setSyncInfo(state.status === 'queued' ? 'Histórico aguardando sua vez na fila...' : `Sincronizando histórico: ${state.pages || 0} página(s), ${state.scanned || 0} mensagens verificadas...`);
          pollTimer = window.setTimeout(poll, 2500);
        } else {
          setSyncing(false);
          const imported = (state?.counts?.received || 0) + (state?.counts?.sent_from_phone || 0);
          const existing = (state?.counts?.duplicate || 0) + (state?.counts?.already_sent_from_panel || 0);
          const count = state?.scanned || 0;
          const rejected = Object.entries(state?.counts || {}).filter(([key, value]) =>
            key.startsWith('ignored_') && value > 0 && key !== 'ignored_out_of_period')
            .map(([key, value]) => `${key.replace('ignored_', '')}: ${value}`).join(', ');
          const details = `Consultadas ${count} mensagens na Evolution; ${imported} novas, ${existing} já existentes.`;
          setSyncInfo(state?.status === 'error' ? `Falha na sincronização: ${state.error || 'erro desconhecido'}` :
            state?.truncated ? `${details} Importação parcial: paginação incompleta na Evolution.` :
            count === 0 ? 'A Evolution não disponibilizou mensagens armazenadas para esta conversa. Confira o histórico salvo na Evolution.' :
            `${details}${rejected ? ` Ignoradas (${rejected}).` : ''}${state?.alias_warning ? ' Alguns dados de associação de contatos não puderam ser consultados.' : ''}`);
          void loadMessages(convId, true); void loadConversations(true);
        }
      } catch (err) {
        if (!active) return;
        setSyncing(false);
        setSyncInfo(`Falha ao consultar sincronização: ${err instanceof Error ? err.message : 'erro'}`);
      }
    };
    void poll();
    return () => { active = false; if (pollTimer) window.clearTimeout(pollTimer); };
  }, [selectedConv?.id, activeConversationProvider, syncRun]); // eslint-disable-line react-hooks/exhaustive-deps

  async function inspectWebhook() {
    try {
      const result = await apiRequest<{
        webhook?: {enabled:boolean;messages_upsert:boolean;messages_update?:boolean;has_url:boolean};
        webhook_error?:string;last_event?:{received_at:string;processed:boolean;error?:string};
        webhook_configured_in_server:boolean;
      }>('/integrations/whatsapp/diagnostics');
      if (result.webhook_error) setWebhookInfo(`Erro ao consultar Evolution: ${result.webhook_error}`);
      else if (!result.webhook_configured_in_server) setWebhookInfo('Webhook não configurado no server/.env. Use Sincronizar para recuperar mensagens.');
      else if (!result.webhook?.enabled || !result.webhook.messages_upsert)
        setWebhookInfo('Webhook não ativo na Evolution. Clique em Ativar recebimento.');
      else if (!result.webhook?.messages_update)
        setWebhookInfo('Webhook de entrega/leitura não ativo. Clique em Ativar webhook para habilitar MESSAGES_UPDATE.');
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
    const version = ++contactRequestVersion.current;
    setContactPickerOpen(false);
    setLoadingAvailableContacts(true);
    try {
      const response = await apiRequest<{data:Contact[];total:number}>('/contacts?limit=100&page=1');
      if (version !== contactRequestVersion.current) return;
      setAvailableContacts(response.data ?? []);
      setAvailableContactsTotal(response.total ?? response.data?.length ?? 0);
      setNewContactId(response.data?.[0]?.id || '');
      setNewContactQuery('');
      setContactPage(1);
      setMoreAvailableContacts((response.data?.length ?? 0) < (response.total ?? 0));
      setCreatingConversation(true);
    } catch (err) { toastError(err instanceof Error ? err.message : 'Erro ao carregar contatos'); }
    finally { if (version === contactRequestVersion.current) setLoadingAvailableContacts(false); }
  }
  useEffect(() => {
    if (!creatingConversation) return;
    const version = ++contactRequestVersion.current;
    const timer = window.setTimeout(async () => {
      setLoadingAvailableContacts(true);
      try {
        const query = encodeURIComponent(newContactQuery.trim());
        const result = await apiRequest<{data:Contact[];total:number}>(`/contacts?limit=100&page=1&q=${query}`);
        if (version !== contactRequestVersion.current) return;
        setAvailableContacts(result.data ?? []);
        setAvailableContactsTotal(result.total ?? result.data?.length ?? 0);
        setContactPage(1);
        setMoreAvailableContacts((result.data?.length ?? 0) < (result.total ?? 0));
        setNewContactId(old => result.data?.some(x=>x.id===old) ? old : (result.data?.[0]?.id ?? ''));
      } catch (err) {
        if (version === contactRequestVersion.current) toastError(err instanceof Error ? err.message : 'Falha ao buscar contatos');
      } finally { if (version === contactRequestVersion.current) setLoadingAvailableContacts(false); }
    }, 350);
    return () => { window.clearTimeout(timer); };
  }, [creatingConversation, newContactQuery]);

  async function loadMoreNewContacts() {
    if (loadingAvailableContacts || !moreAvailableContacts) return;
    const version = contactRequestVersion.current;
    setLoadingAvailableContacts(true);
    try {
      const nextPage = contactPage + 1;
      const q = encodeURIComponent(newContactQuery.trim());
      const result = await apiRequest<{data:Contact[];total:number}>(`/contacts?limit=100&page=${nextPage}&q=${q}`);
      if (version !== contactRequestVersion.current) return;
      const seen = new Set(availableContacts.map(contact => contact.id));
      const appended = (result.data ?? []).filter(contact => !seen.has(contact.id));
      setAvailableContacts(previous => [...previous, ...appended]);
      setAvailableContactsTotal(result.total ?? 0);
      setContactPage(nextPage);
      setMoreAvailableContacts(nextPage * 100 < (result.total ?? 0));
    } catch (err) { if (version === contactRequestVersion.current) toastError(err instanceof Error ? err.message : 'Falha ao carregar mais contatos'); }
    finally { if (version === contactRequestVersion.current) setLoadingAvailableContacts(false); }
  }
  useEffect(() => {
    if (!creatingConversation || !contactPickerOpen) return;
    function closeOnOutsideClick(event: MouseEvent) {
      if (contactPickerRef.current && !contactPickerRef.current.contains(event.target as Node)) setContactPickerOpen(false);
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') setContactPickerOpen(false);
    }
    document.addEventListener('mousedown', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('mousedown', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [creatingConversation, contactPickerOpen]);

  async function createConversation() {
    if (!newContactId) return;
    if (!newChannelId) {toastError('Selecione o número de WhatsApp para esta conversa.');return;}
    try {
      const conversation = await apiRequest<Conversation>('/conversations', {
        method: 'POST', body: JSON.stringify({contact_id:newContactId,channel:'whatsapp',integration_id:newChannelId}),
      });
      setContactsMap(prev => ({...prev, ...Object.fromEntries(availableContacts.map(c=>[c.id,c]))}));
      setSelectedConv(conversation);
      setCreatingConversation(false);
      setContactPickerOpen(false);
      await loadConversations();
      toastSuccess('Conversa criada');
    } catch (err) { toastError(err instanceof Error ? err.message : 'Erro ao criar conversa'); }
  }
  useLayoutEffect(() => {
    const list = messageListRef.current;
    if (!list) return;
    if (restoreScrollRef.current) {
      list.scrollTop = restoreScrollRef.current.top + list.scrollHeight - restoreScrollRef.current.height;
      restoreScrollRef.current = null;
      return;
    }
    if (firstChatScrollRef.current && !loadingMessages && messages.length) {
      list.scrollTop = list.scrollHeight;
      firstChatScrollRef.current = false;
      return;
    }
    // Do not move the user's scroll position while older messages/statuses arrive.
    if (list.scrollHeight - list.scrollTop - list.clientHeight < 130) list.scrollTop = list.scrollHeight;
  }, [messages, loadingMessages]);
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
        const { error } = await supabase
          .from('conversation_tags')
          .delete()
          .eq('conversation_id', selectedConv.id)
          .eq('tag_id', tagId);
        if (error) throw error;
        setConvTags(prev => prev.filter(t => t.id !== tagId));
      } else {
        const { error } = await supabase
          .from('conversation_tags')
          .insert({ conversation_id: selectedConv.id, tag_id: tagId });
        if (error) throw error;
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
    <div className="flex h-full min-h-0 min-w-0 overflow-hidden">
      <Modal open={showMyWhatsApp} onClose={()=>setShowMyWhatsApp(false)} title="Meu WhatsApp • Evolution API" size="xl">
        <ChannelsPanel canManage={false} canConnect ownOnly onChannelsChanged={refreshChannels} />
      </Modal>
      {/* Conversations list */}
      <div className={`${selectedConv ? 'hidden md:flex' : 'flex'} w-full min-w-0 min-h-0 md:w-80 lg:w-96 md:flex-shrink-0 border-r border-slate-200 bg-white flex-col`}>
        {/* Search & filters */}
        <div className="p-4 border-b border-slate-100 space-y-3">
          <button type="button" className="btn-primary w-full justify-center" onClick={openNewConversation}><Plus size={16}/> Nova conversa</button>
          {creatingConversation && <div className="rounded-lg bg-blue-50 border border-blue-200 p-3 space-y-2">
            <p className="text-sm font-medium">Selecione um contato</p>
            <label className="text-xs font-medium">Enviar pelo número</label>
            <select className="input w-full" value={newChannelId} onChange={e=>setNewChannelId(e.target.value)}>
              <option value="">Selecione um WhatsApp</option>
              {channels.map(c=><option key={c.id} value={c.id}>{c.name} ({c.instance_name||'Oficial'})</option>)}
            </select>
            <input className="input w-full" value={newContactQuery} onChange={e=>{setNewContactQuery(e.target.value);setContactPickerOpen(false);}} placeholder="Buscar contato por nome ou número..." />
            {availableContacts.length ? <>
            <div className="relative" ref={contactPickerRef}>
              <button type="button" className="input w-full flex items-center justify-between gap-2 text-left"
                aria-label="Selecionar contato para nova conversa" aria-haspopup="listbox" aria-expanded={contactPickerOpen}
                onClick={() => setContactPickerOpen(open => !open)}>
                <span className="truncate min-w-0">
                  {(() => { const selected = availableContacts.find(c => c.id === newContactId);
                    return selected ? `${selected.name}${selected.phone ? ` (${selected.phone})` : ''}` : 'Selecione um contato'; })()}
                </span>
                <ChevronDown size={16} className="flex-shrink-0 text-slate-400" />
              </button>
              {contactPickerOpen && (
                <div className="absolute left-0 right-0 top-full mt-1 z-50 rounded-lg border border-slate-300 bg-white shadow-xl max-h-64 overflow-y-auto overscroll-contain"
                  role="listbox" aria-label="Contatos disponíveis">
                  {availableContacts.map(c => (
                    <button type="button" key={c.id} role="option" aria-selected={newContactId === c.id}
                      onClick={() => { setNewContactId(c.id); setContactPickerOpen(false); }}
                      className={`block w-full text-left text-xs px-3 py-2 border-b border-slate-100 hover:bg-blue-50 break-words ${newContactId === c.id ? 'bg-blue-50 font-semibold text-slate-900' : 'text-slate-700'}`}>
                      {c.name} {c.phone ? `(${c.phone})` : ''}
                    </button>
                  ))}
                  {moreAvailableContacts && (
                    <button type="button" className="w-full px-3 py-3 text-xs font-semibold text-blue-700 bg-slate-50 hover:bg-blue-50 disabled:opacity-50"
                      disabled={loadingAvailableContacts} onClick={() => void loadMoreNewContacts()}>
                      {loadingAvailableContacts ? 'Carregando...' : `Carregar mais contatos · ${availableContacts.length} de ${availableContactsTotal}`}
                    </button>
                  )}
                  {!moreAvailableContacts && <p className="px-3 py-2 text-xs text-slate-400">Todos os {availableContacts.length} contatos encontrados foram carregados.</p>}
                </div>
              )}
            </div>
            <p className="text-[11px] text-slate-500">Busque pelo nome ou telefone acima. Para ver mais resultados, abra o seletor e escolha “Carregar mais contatos”.</p>
            <div className="flex gap-2"><button className="btn-primary" disabled={!newContactId || loadingAvailableContacts} onClick={createConversation}>Criar</button><button className="btn-secondary" onClick={()=>{setCreatingConversation(false);setContactPickerOpen(false);}}>Cancelar</button></div></>
            : <p className="text-sm text-slate-500">{loadingAvailableContacts ? 'Buscando contatos...' : 'Nenhum contato encontrado. Aguarde a sincronização ou cadastre um contato.'}</p>}
          </div>}
          {isDev && organizations.length>0 && <div><label className="block mb-1 text-xs font-medium text-slate-600">Conversas por empresa</label><select className="input w-full text-sm" aria-label="Empresa das conversas" value={orgId||''} onChange={e=>switchOrganization(e.target.value)}>{organizations.map(o=><option key={o.id} value={o.id}>{o.name}</option>)}</select></div>}
          {!isMaster && !isDev && channelsLoaded && channels.length === 0 && <button type="button" className="btn-secondary w-full text-xs" onClick={()=>setShowMyWhatsApp(true)}>Conectar meu WhatsApp (Evolution API)</button>}
          {showMasterFilters && whatsAppProvider === 'evolution_api' && (
            <div className="rounded-lg bg-slate-50 border border-slate-200 p-2 text-xs text-slate-600 space-y-2">
              <div className="flex flex-wrap gap-2 items-center justify-between">
                <span>WhatsApp Evolution • Recebimento</span>
                <button type="button" className="text-blue-700 underline" onClick={inspectWebhook}>Verificar</button>
                <button type="button" className="text-blue-700 underline" onClick={activateWebhook}>Ativar webhook</button>
              </div>
              {webhookInfo && <p role="status" className="break-words">{webhookInfo}</p>}
            </div>
          )}
          {channels.some(c => ['queued','running'].includes(c.contact_sync?.status ?? '')) && (
            <p className="text-xs text-blue-700" role="status">Sincronizando contatos e chats: {channels.filter(c=>['queued','running'].includes(c.contact_sync?.status ?? '')).map(c=>`${c.name} (${c.contact_sync?.contacts || 0} contatos)`).join(', ')}</p>
          )}
          {channels.filter(c => c.contact_sync?.status === 'error').map(channel => (
            <p key={channel.id} className="text-xs text-amber-700" role="alert">
              Falha na sincronização de {channel.name}: {channel.contact_sync?.error || 'Verifique os logs do backend.'}
            </p>
          ))}
          {channels.some(c => c.contact_sync?.partial) && (
            <p className="text-xs text-amber-700">Alguns contatos/chats podem não ter sido recuperados. Veja o backend.</p>
          )}
          {syncableChannel && <button type="button" className="btn-ghost text-xs"
            disabled={contactSyncRequesting || ['queued','running'].includes(syncableChannel.contact_sync?.status ?? '')}
            onClick={() => void manuallySyncContacts()}>
            <RefreshCw size={12}/> {contactSyncRequesting ? 'Solicitando sincronização...' : 'Atualizar agenda deste WhatsApp'}
          </button>}
          {showNumberFilter && <select className="input w-full text-sm" aria-label="Filtrar número de WhatsApp" value={channelFilter} onChange={e=>{setChannelFilter(e.target.value);setSelectedConv(null);}}>
            <option value="all">Todos os números</option>
            {channels.map(c=><option key={c.id} value={c.id}>{c.name} · {c.instance_name||'Oficial'}</option>)}
          </select>}
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
            {showNumberFilter && <select
              value={assigneeFilter}
              onChange={(e) => setAssigneeFilter(e.target.value)}
              className="rounded-lg border-0 bg-slate-100 px-2.5 py-1.5 text-xs font-medium text-slate-600 ring-1 ring-inset ring-slate-200 cursor-pointer"
            >
              <option value="all">Todos atendentes</option>
              <option value="me">Atribuídas a mim</option>
              <option value="unassigned">Sem atribuição</option>
            </select>}
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
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
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
                      {conv.channel === 'whatsapp' && ` · WhatsApp: ${channels.find(x=>x.id===conv.integration_id)?.name || 'Sem instância vinculada'}`}
                    </p>
                  </div>
                </button>
              );
            })
          )}
          {!loading && moreConversations && <button type="button"
            className="btn-ghost text-xs w-full py-3 justify-center" disabled={loadingMore}
            onClick={() => void loadConversations(false,conversationPage+1)}>
            {loadingMore ? 'Carregando...' : 'Carregar mais conversas'}
          </button>}
        </div>
      </div>
      {/* Chat area */}
      {selectedConv ? (
        <div className="flex flex-1 min-w-0 min-h-0 w-full flex-col bg-slate-50">
          {/* Chat header */}
          <div className="bg-white border-b border-slate-200 px-2 sm:px-4 py-2 sm:py-3 flex items-center gap-1 sm:gap-3 justify-between min-w-0">
            <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
              <button type="button" className="md:hidden btn-ghost shrink-0 p-2" aria-label="Voltar para conversas"
                title="Voltar para conversas" onClick={() => setSelectedConv(null)}><ArrowLeft size={20} /></button>
              <div className="hidden sm:flex h-10 w-10 items-center justify-center rounded-full bg-slate-200 text-sm font-semibold text-slate-700 flex-shrink-0">
                {(contact?.name ?? '?').charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0">
                <p className="font-medium text-slate-900 truncate">{contact?.name ?? 'Desconhecido'}</p>
                <div className="hidden sm:flex items-center gap-2 mt-0.5 min-w-0">
                  <span className={`badge ${
                    selectedConv.status === 'open' ? 'badge-green' :
                    selectedConv.status === 'pending' ? 'badge-yellow' : 'badge-gray'
                  }`}>
                    {selectedConv.status === 'open' ? 'Aberta' : selectedConv.status === 'pending' ? 'Pendente' : 'Fechada'}
                  </span>
                  {selectedChannel && <span className="text-xs text-green-700 rounded bg-green-50 px-2 py-0.5">WhatsApp: {selectedChannel.name} ({selectedChannel.instance_name||'Oficial'})</span>}
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
            <div className="flex shrink-0 max-w-[47vw] sm:max-w-none items-center gap-1 overflow-x-auto">
              {selectedConv.channel === 'whatsapp' && activeConversationProvider === 'evolution_api' && (
                <button type="button" className="btn-ghost px-2 py-1.5" disabled={syncing}
                  onClick={() => void syncFromEvolution(selectedConv.id, true)}
                  title="Sincronizar respostas diretamente da Evolution API">
                  <RefreshCw size={18} className={syncing ? 'animate-spin' : ''} />
                </button>
              )}
              <button onClick={() => setShowAssign(true)} className="btn-ghost px-2 py-1.5" title="Atribuir">
                <UserCheck size={18} />
              </button>
              <button onClick={() => { void (async()=>{const [all,active]=await Promise.all([supabase.from('tags').select('*').eq('org_id',orgId),supabase.from('conversation_tags').select('tag:tags(*)').eq('conversation_id',selectedConv!.id)]);if(all.data)setTags(all.data as Tag[]);if(active.data)setConvTags(active.data.map((x:any)=>x.tag) as Tag[]);setShowTags(true);})(); }} className="btn-ghost px-2 py-1.5" title="Etiquetas">
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
          {syncInfo && selectedConv.channel === 'whatsapp' && activeConversationProvider === 'evolution_api' && (
            <div className={`px-4 py-1 text-xs ${syncInfo.startsWith('Falha') ? 'bg-amber-50 text-amber-800' : 'bg-slate-100 text-slate-500'}`} role="status">
              {syncInfo}
            </div>
          )}
          {/* Messages */}
          <div ref={messageListRef} className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-2 sm:p-4 space-y-3">
            {olderCursor && !loadingMessages && (
              <div className="text-center"><button type="button" className="btn-secondary text-xs" disabled={loadingEarlier} onClick={() => void loadEarlier()}>
                {loadingEarlier ? 'Carregando...' : 'Carregar mensagens anteriores'}
              </button></div>
            )}
            {loadingMessages ? (
              <div className="flex justify-center py-8"><Spinner /></div>
            ) : messages.length === 0 ? (
              <EmptyState icon={<MessageBubble />} title="Sem mensagens" description="Inicie a conversa enviando uma mensagem." />
            ) : (
              messages.map((msg) => {
                const isAgent = msg.sender_type === 'agent' || msg.sender_type === 'bot';
                return (
                  <div key={msg.id} className={`flex ${isAgent ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[90%] sm:max-w-[75%] min-w-0 rounded-2xl px-4 py-2.5 ${
                      isAgent
                        ? msg.is_bot ? 'bg-purple-100 text-purple-900' : 'bg-blue-600 text-brand-on-accent'
                        : 'bg-white text-slate-900 shadow-sm ring-1 ring-slate-100'
                    }`}>
                      {msg.is_bot && (
                        <div className="flex items-center gap-1 mb-1 text-xs opacity-70">
                          <Bot size={12} /> Bot
                        </div>
                      )}
                      <MessageMedia message={msg} />
                      {msg.body && !(msg.media_type && /^\[(Imagem|Vídeo|Áudio|Documento|Figurinha|Localização)\]$/.test(msg.body)) && (
                        <p className="text-sm whitespace-pre-wrap break-words">{msg.body}</p>
                      )}
                      <div className={`flex items-center gap-1 mt-1 text-xs ${isAgent ? (msg.is_bot ? 'text-purple-500' : 'text-blue-200') : 'text-slate-400'}`}>
                        {new Date(msg.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                        {isAgent && !msg.is_bot && (
                          msg.status === 'read' || msg.status === 'played' ?
                            <CheckCheck size={16} className="text-cyan-200" role="img" aria-label="Visualizada" /> :
                          msg.status === 'delivered' ?
                            <CheckCheck size={16} className="text-blue-100" role="img" aria-label="Entregue" /> :
                          msg.status === 'failed' ?
                            <Circle size={14} className="text-red-200" role="img" aria-label="Falha no envio" /> :
                            <Check size={16} role="img" aria-label="Enviada" />
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
            <div className="bg-white border-t border-slate-200 p-2 sm:p-3 shrink-0">
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
              <div className="flex items-end gap-1 sm:gap-2 min-w-0">
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
                  className="flex-1 min-w-0 resize-none rounded-lg border-0 py-2.5 px-3.5 text-sm ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-blue-600 max-h-32"
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
