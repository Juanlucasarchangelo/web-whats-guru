import { useCallback, useEffect, useRef, useState } from 'react';
import { MessageCircle, Send, X, RefreshCw, Check, CheckCheck } from 'lucide-react';
import { apiRequest } from '@/lib/api';
import { MessageMedia } from '@/components/inbox/MessageMedia';
import { Spinner } from '@/components/ui/Spinner';
import { toastError, toastSuccess } from '@/components/ui/Toast';
import type { Contact, Conversation, Message } from '@/types';

type Channel = { id: string; name: string; status: string };

/** CRM chat uses the same authenticated API and Evolution/Meta delivery as Inbox. */
export function CrmConversationModal({ contact, onClose }: { contact: Contact; onClose: () => void }) {
  const [threads, setThreads] = useState<Conversation[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [newChannelId, setNewChannelId] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [creating, setCreating] = useState(false);
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const selectedRef = useRef('');
  selectedRef.current = selectedId;

  useEffect(() => {
    const before = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const esc = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', esc);
    return () => { document.body.style.overflow = before; window.removeEventListener('keydown', esc); };
  }, [onClose]);

  const loadThreads = useCallback(async () => {
    const [conversationResponse, channelResponse] = await Promise.all([
      apiRequest<{ data: Conversation[] }>(`/conversations?contact_id=${encodeURIComponent(contact.id)}&limit=100`),
      apiRequest<{ data: Channel[] }>('/channels'),
    ]);
    const matching = conversationResponse.data
      .filter(c => c.contact_id === contact.id)
      .sort((a, b) => new Date(b.last_message_at).getTime() - new Date(a.last_message_at).getTime());
    setThreads(matching);
    setChannels(channelResponse.data);
    setNewChannelId(current => current || channelResponse.data[0]?.id || '');
    setSelectedId(current => matching.some(c => c.id === current) ? current : matching[0]?.id || '');
  }, [contact.id]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    loadThreads().catch(e => { if (active) toastError(e instanceof Error ? e.message : 'Erro ao carregar conversas'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [loadThreads]);

  const loadMessages = useCallback(async (id: string, silent = false) => {
    if (!silent) setLoadingMessages(true);
    try {
      const result = await apiRequest<{ data: Message[] }>(`/conversations/${id}/messages`);
      if (selectedRef.current === id) setMessages(result.data);
    } catch (e) {
      if (!silent) toastError(e instanceof Error ? e.message : 'Erro ao carregar mensagens');
    } finally {
      if (!silent) setLoadingMessages(false);
    }
  }, []);

  useEffect(() => {
    setMessages([]);
    if (!selectedId) return;
    void loadMessages(selectedId);
    const poll = window.setInterval(() => {
      if (!document.hidden) void loadMessages(selectedId, true);
    }, 5000);
    return () => window.clearInterval(poll);
  }, [selectedId, loadMessages]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ block: 'end' }); }, [messages]);

  async function createThread() {
    if (!newChannelId) return toastError('Selecione uma conexão WhatsApp.');
    setCreating(true);
    try {
      const conversation = await apiRequest<Conversation>('/conversations', {
        method: 'POST',
        body: JSON.stringify({ contact_id: contact.id, channel: 'whatsapp', integration_id: newChannelId }),
      });
      await loadThreads();
      setSelectedId(conversation.id);
      toastSuccess('Conversa pronta para atendimento.');
    } catch (e) {
      toastError(e instanceof Error ? e.message : 'Não foi possível iniciar conversa');
    } finally { setCreating(false); }
  }

  async function sendMessage(event: React.FormEvent) {
    event.preventDefault();
    const body = draft.trim();
    if (!body || !selectedId || sending) return;
    setSending(true);
    try {
      const sent = await apiRequest<Message>(`/conversations/${selectedId}/messages`, {
        method: 'POST', body: JSON.stringify({ body, is_internal: false }),
      });
      setDraft('');
      setMessages(previous => previous.some(m => m.id === sent.id) ? previous : [...previous, sent]);
      // A confirmação de entrega continua sendo controlada pelo provedor.
    } catch (e) {
      toastError(e instanceof Error ? e.message : 'Erro ao enviar mensagem');
    } finally { setSending(false); }
  }

  const selected = threads.find(c => c.id === selectedId);
  const tag = 'text-xs text-slate-500';
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-3 sm:p-6" role="dialog" aria-modal="true" aria-label={`Conversa com ${contact.name}`}>
      <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative flex w-full max-w-4xl h-[min(88vh,850px)] min-h-[360px] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <header className="flex items-center justify-between gap-4 border-b border-slate-200 p-4">
          <div className="min-w-0 flex items-center gap-3">
            <div className="rounded-full bg-blue-50 p-2 text-blue-700"><MessageCircle size={20}/></div>
            <div className="min-w-0"><h2 className="font-semibold text-slate-900 truncate">{contact.name}</h2><p className={tag}>{contact.phone || 'Sem telefone cadastrado'}</p></div>
          </div>
          <button className="btn-ghost" onClick={onClose} title="Fechar conversa"><X size={20}/></button>
        </header>
        {loading ? <div className="m-auto"><Spinner /></div> : (
          <>
            {threads.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-2">
                <label className={tag} htmlFor="crm-thread">Conversa:</label>
                <select id="crm-thread" className="input text-sm max-w-full sm:max-w-sm" value={selectedId} onChange={e => setSelectedId(e.target.value)}>
                  {threads.map(c => <option value={c.id} key={c.id}>{channels.find(x => x.id === c.integration_id)?.name || c.channel} · {c.status}</option>)}
                </select>
                <button className="btn-ghost ml-auto" title="Atualizar mensagens" onClick={() => selectedId && void loadMessages(selectedId)}><RefreshCw size={17}/></button>
              </div>
            )}
            {!selected && (
              <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
                <MessageCircle className="text-slate-400" size={32}/>
                <p className="font-medium">Este contato ainda não tem conversa acessível.</p>
                {!contact.phone && <p className={tag}>Cadastre o telefone para começar pelo WhatsApp.</p>}
                {channels.length === 0 && <p className={tag}>Nenhuma conexão WhatsApp disponível para sua conta.</p>}
                {channels.length > 0 && contact.phone && <>
                  <label className={tag} htmlFor="crm-new-channel">Número de saída</label>
                  <select id="crm-new-channel" className="input w-full max-w-sm" value={newChannelId} onChange={e => setNewChannelId(e.target.value)}>
                    {channels.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                  <button className="btn-primary" disabled={creating || !newChannelId} onClick={() => void createThread()}>{creating ? 'Preparando…' : 'Iniciar conversa'}</button>
                </>}
              </div>
            )}
            {selected && <>
              <div className="min-h-0 flex-1 overflow-y-auto bg-slate-50 p-4 space-y-3" aria-label="Mensagens da conversa">
                {loadingMessages ? <div className="flex justify-center py-8"><Spinner/></div> : messages.length === 0 ? <p className="text-sm text-slate-500 text-center py-6">Nenhuma mensagem. Envie a primeira mensagem.</p> : messages.map(msg => {
                  const outgoing = msg.sender_type === 'agent' || msg.sender_type === 'bot';
                  return <div key={msg.id} className={`flex ${outgoing ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[85%] sm:max-w-[75%] rounded-2xl px-4 py-2.5 shadow-sm ${outgoing ? 'bg-blue-600 text-white' : 'bg-white text-slate-900 border border-slate-200'}`}>
                      <MessageMedia message={msg}/>
                      {msg.body && !(msg.media_type && /^\[(Imagem|Vídeo|Áudio|Documento|Figurinha|Localização)\]$/.test(msg.body)) && <p className="text-sm whitespace-pre-wrap break-words">{msg.body}</p>}
                      <div className={`flex items-center justify-end gap-1 mt-1 text-xs ${outgoing ? 'text-blue-100' : 'text-slate-400'}`}>
                        {new Date(msg.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                        {outgoing && (msg.status === 'read' || msg.status === 'delivered' ? <CheckCheck size={14}/> : <Check size={14}/>)}
                      </div>
                    </div>
                  </div>;
                })}
                <div ref={bottomRef}/>
              </div>
              {selected.status === 'closed' || selected.status === 'resolved' ? (
                <p className="border-t p-4 text-center text-sm text-slate-500">Conversa encerrada. Reabra na Caixa de Entrada para enviar mensagens.</p>
              ) : (
                <form onSubmit={e => void sendMessage(e)} className="flex items-end gap-2 border-t border-slate-200 bg-white p-3">
                  <textarea value={draft} onChange={e => setDraft(e.target.value)} rows={2} maxLength={10000} placeholder="Escreva uma mensagem…" className="input min-h-[44px] max-h-32 flex-1 resize-y" onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); e.currentTarget.form?.requestSubmit(); } }}/>
                  <button type="submit" className="btn-primary" disabled={!draft.trim() || sending} aria-label="Enviar mensagem"><Send size={18}/><span className="hidden sm:inline">Enviar</span></button>
                </form>
              )}
            </>}
          </>
        )}
      </div>
    </div>
  );
}
