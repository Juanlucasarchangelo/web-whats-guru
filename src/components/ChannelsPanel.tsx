import { useCallback, useEffect, useState } from 'react';
import { apiRequest } from '@/lib/api';
import { Modal } from '@/components/ui/Modal';
import { toastError, toastSuccess } from '@/components/ui/Toast';
import {
  AlertCircle, CheckCircle2, ChevronDown, ChevronUp, Link2, Loader2,
  Plus, QrCode, RefreshCw, Settings2, ShieldCheck, Smartphone, Unplug,
} from 'lucide-react';

type Channel = {
  id: string; name: string; instance_name: string | null; provider_url: string | null;
  status: string; status_error?: string | null; team_ids: string[];
  provider: string; display_phone_number?: string | null;
};
type WebhookInfo = { enabled: boolean; has_url: boolean; messages_upsert: boolean; events: string[] };
type QRResponse = { status: string; qr_code: string | null; pairing_code?: string | null };
type AttachResponse = { channel: Channel; webhook?: { ok: boolean; verified?: boolean; error?: string | null } };

function displayName(c: Channel) {
  // Historical Evolution records were incorrectly named as if they were Meta.
  return c.name === 'WhatsApp Business Platform' ? `WhatsApp · ${c.instance_name || 'principal'}` : c.name;
}
function ChannelStatus({ channel }: { channel: Channel }) {
  if (channel.status_error) return <span className="badge badge-yellow"><AlertCircle size={12} /> Sem verificação</span>;
  if (channel.status === 'connected') return <span className="badge badge-green"><CheckCircle2 size={12} /> Conectado</span>;
  if (channel.status === 'connecting') return <span className="badge badge-yellow"><RefreshCw size={12} /> Aguardando QR</span>;
  return <span className="badge badge-gray"><Unplug size={12} /> Desconectado</span>;
}

export function ChannelsPanel({ canManage = true }: { canManage?: boolean }) {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [qrChannel, setQrChannel] = useState<Channel | null>(null);
  const [qrData, setQrData] = useState<QRResponse | null>(null);
  const [qrError, setQrError] = useState('');
  const [webhooks, setWebhooks] = useState<Record<string, WebhookInfo | null>>({});
  const [webhookErrors, setWebhookErrors] = useState<Record<string, string>>({});
  const [names, setNames] = useState<Record<string, string>>({});
  const [form, setForm] = useState({ name: '', provider_url: 'http://127.0.0.1:8080', instance_name: '', api_key: '' });

  const load = useCallback(async () => {
    try {
      const result = await apiRequest<{ data: Channel[] }>('/channels');
      setChannels((result.data || []).filter(channel => channel.provider === 'evolution_api'));
    } catch (error) {
      toastError(error instanceof Error ? error.message : 'Não foi possível carregar os WhatsApps.');
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function checkStatus(channel: Channel) {
    setBusyId(channel.id);
    try {
      const r = await apiRequest<{ status: string }>(`/channels/${channel.id}/status`, { method: 'POST' });
      await load();
      toastSuccess(r.status === 'connected' ? 'Número conectado à Evolution.' : 'Estado atualizado.');
    } catch (error) { toastError(error instanceof Error ? error.message : 'Falha ao verificar conexão.'); }
    finally { setBusyId(null); }
  }

  async function showQr(channel: Channel) {
    setQrChannel(channel);
    setQrData(null);
    setQrError('');
    setBusyId(channel.id);
    try {
      const r = await apiRequest<QRResponse>(`/channels/${channel.id}/qr`, { method: 'POST' });
      setQrData(r);
      if (r.status === 'connected') {
        setQrChannel(null);
        toastSuccess('Este WhatsApp já está conectado.');
        await load();
      } else if (!r.qr_code) {
        setQrError('A Evolution não retornou um QR Code nesta tentativa. Clique em Atualizar QR.');
      }
    } catch (error) { setQrError(error instanceof Error ? error.message : 'Não foi possível gerar o QR Code.'); }
    finally { setBusyId(null); }
  }

  // Poll only while the QR modal is open, so the user sees the result after scanning.
  useEffect(() => {
    if (!qrChannel) return;
    let cancelled = false;
    const timer = window.setInterval(async () => {
      try {
        const result = await apiRequest<{ status: string }>(`/channels/${qrChannel.id}/status`, { method: 'POST' });
        if (result.status === 'connected' && !cancelled) {
          setQrChannel(null);
          setQrData(null);
          toastSuccess('WhatsApp conectado!');
          await load();
        }
      } catch { /* A temporary Docker/network error should not close the QR modal. */ }
    }, 5000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [qrChannel?.id, load]);

  async function attach() {
    if (!form.provider_url.trim() || !form.instance_name.trim() || !form.api_key.trim()) return;
    setBusyId('add');
    try {
      const result = await apiRequest<AttachResponse>('/channels/attach', {
        method: 'POST', body: JSON.stringify({
          provider_url: form.provider_url.trim(), instance_name: form.instance_name.trim(),
          api_key: form.api_key.trim(), ...(form.name.trim() ? { name: form.name.trim() } : {}),
        }),
      });
      setForm(previous => ({ ...previous, name: '', instance_name: '', api_key: '' }));
      setAdding(false);
      await load();
      toastSuccess('Instância vinculada ao Whats-Guru.');
      if (result.webhook?.error) toastError(`Webhook: ${result.webhook.error}`);
      if (result.channel.status !== 'connected') await showQr(result.channel);
    } catch (error) { toastError(error instanceof Error ? error.message : 'Não foi possível vincular a instância.'); }
    finally { setBusyId(null); }
  }

  async function showDetails(channel: Channel) {
    if (expanded === channel.id) { setExpanded(null); return; }
    setExpanded(channel.id);
    setNames(previous => ({ ...previous, [channel.id]: displayName(channel) }));
    setWebhookErrors(previous => ({ ...previous, [channel.id]: '' }));
    try {
      const result = await apiRequest<{ webhook: WebhookInfo }>(`/channels/${channel.id}/webhook`);
      setWebhooks(previous => ({ ...previous, [channel.id]: result.webhook }));
    } catch (error) {
      setWebhookErrors(previous => ({ ...previous, [channel.id]: error instanceof Error ? error.message : 'Não foi possível consultar o webhook.' }));
    }
  }

  async function repairWebhook(channel: Channel) {
    setBusyId(channel.id);
    try {
      await apiRequest(`/channels/${channel.id}/webhook`, { method: 'POST' });
      const result = await apiRequest<{ webhook: WebhookInfo }>(`/channels/${channel.id}/webhook`);
      setWebhooks(previous => ({ ...previous, [channel.id]: result.webhook }));
      setWebhookErrors(previous => ({ ...previous, [channel.id]: '' }));
      toastSuccess('Configuração de recebimento registrada na Evolution.');
    } catch (error) { toastError(error instanceof Error ? error.message : 'Não foi possível configurar recebimento.'); }
    finally { setBusyId(null); }
  }

  async function saveName(channel: Channel) {
    const name = (names[channel.id] || '').trim();
    if (name.length < 2) return;
    setBusyId(channel.id);
    try {
      await apiRequest(`/channels/${channel.id}/name`, { method: 'PATCH', body: JSON.stringify({ name }) });
      await load();
      toastSuccess('Nome atualizado.');
    } catch (error) { toastError(error instanceof Error ? error.message : 'Não foi possível salvar o nome.'); }
    finally { setBusyId(null); }
  }

  async function disconnect(channel: Channel) {
    if (!channel.instance_name || !window.confirm(
      `Desconectar somente “${displayName(channel)}” (${channel.instance_name}) do WhatsApp?\n\nO histórico no Whats-Guru será mantido. Para voltar a usar este número, será necessário escanear outro QR Code.`
    )) return;
    setBusyId(channel.id);
    try {
      await apiRequest(`/channels/${channel.id}/logout`, {
        method: 'POST', body: JSON.stringify({ confirm_instance: channel.instance_name }),
      });
      await load();
      setExpanded(null);
      toastSuccess(`WhatsApp “${displayName(channel)}” desconectado.`);
    } catch (error) { toastError(error instanceof Error ? error.message : 'Falha ao desconectar. Nenhuma configuração foi removida.'); }
    finally { setBusyId(null); }
  }

  return <div className="card p-5 space-y-4">
    <div className="flex flex-wrap justify-between gap-3 items-start">
      <div>
        <h2 className="font-semibold text-slate-900 flex items-center gap-2"><Smartphone size={18} /> WhatsApp via Evolution API</h2>
        <p className="text-sm text-slate-500 mt-1">Um painel para conectar, verificar e desconectar cada número. Os atendimentos continuam separados por instância.</p>
      </div>
      {canManage && <button className="btn-primary text-sm" onClick={() => setAdding(v => !v)}><Plus size={15} /> Adicionar instância</button>}
    </div>

    {loading ? <div className="text-sm text-slate-500 py-5 flex items-center gap-2"><Loader2 size={16} className="animate-spin" /> Consultando instâncias...</div>
      : !channels.length ? <p className="text-sm text-slate-500 py-4">Nenhuma instância Evolution cadastrada nesta organização.</p>
      : <div className="space-y-3">{channels.map(channel => <div key={channel.id} className="rounded-xl border border-slate-200 overflow-hidden">
        <div className="p-4 flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0 flex items-start gap-3">
            <div className="w-10 h-10 bg-green-50 text-green-700 rounded-lg flex items-center justify-center flex-shrink-0"><Smartphone size={20}/></div>
            <div>
              <p className="text-sm font-semibold text-slate-900">{displayName(channel)}</p>
              <p className="text-xs text-slate-500 mt-0.5">Instância: <code>{channel.instance_name}</code> · {channel.team_ids.length ? `${channel.team_ids.length} time(s) autorizado(s)` : 'Sem restrição por time'}</p>
              <div className="mt-2"><ChannelStatus channel={channel} /></div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {canManage && channel.status !== 'connected' && <button className="btn-primary text-xs" disabled={busyId === channel.id} onClick={() => void showQr(channel)}><QrCode size={14} /> Conectar com QR Code</button>}
            <button className="btn-secondary text-xs" disabled={busyId === channel.id} onClick={() => void checkStatus(channel)}>
              {busyId === channel.id ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14}/>} Verificar
            </button>
            <button className="btn-secondary text-xs" onClick={() => void showDetails(channel)}>{expanded === channel.id ? <ChevronUp size={14}/> : <ChevronDown size={14}/>} Detalhes</button>
          </div>
        </div>
        {expanded === channel.id && <div className="bg-slate-50 p-4 border-t border-slate-200 space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <p className="font-semibold text-xs text-slate-700 flex items-center gap-2"><Settings2 size={14}/> Identificação</p>
              <p className="text-xs text-slate-500 mt-1">Este nome é exibido no Whats-Guru; não altera a instância Evolution.</p>
              {canManage && <div className="flex gap-2 mt-2"><input className="input flex-1 min-w-0" value={names[channel.id] ?? displayName(channel)} onChange={e => setNames(p => ({ ...p, [channel.id]: e.target.value }))}/><button className="btn-secondary text-xs" disabled={busyId === channel.id || !(names[channel.id] || '').trim()} onClick={() => void saveName(channel)}>Salvar</button></div>}
              <p className="text-xs text-slate-500 mt-2">Servidor: {channel.provider_url || '—'}</p>
            </div>
            <div>
              <p className="font-semibold text-xs text-slate-700 flex items-center gap-2"><ShieldCheck size={14}/> Recebimento de mensagens (webhook)</p>
              {webhookErrors[channel.id]
                ? <p className="text-xs text-amber-700 mt-2">{webhookErrors[channel.id]}</p>
                : webhooks[channel.id]
                  ? <p className="text-xs text-slate-600 mt-2">{webhooks[channel.id]?.enabled && webhooks[channel.id]?.has_url && webhooks[channel.id]?.messages_upsert
                      ? 'Configuração ativa na Evolution. Teste uma mensagem para confirmar o recebimento.'
                      : 'Configuração ausente ou incompleta. Você pode corrigir aqui.'}</p>
                  : <p className="text-xs text-slate-500 mt-2">Consultando configuração...</p>}
              <p className="text-xs text-slate-500 mt-2">O webhook entrega mensagens da Evolution ao Whats-Guru. Não conecta o celular e não envia mensagens.</p>
              {canManage && <button className="btn-secondary text-xs mt-2" disabled={busyId === channel.id} onClick={() => void repairWebhook(channel)}><Link2 size={14} /> Reconfigurar recebimento</button>}
            </div>
          </div>
          {canManage && <div className="pt-3 border-t border-slate-200 flex items-center justify-between gap-3 flex-wrap">
            <p className="text-xs text-slate-500">O histórico das conversas permanece no Whats-Guru mesmo após desconectar.</p>
            <button className="btn-secondary text-xs text-red-700" disabled={busyId === channel.id || channel.status === 'disconnected'} onClick={() => void disconnect(channel)}><Unplug size={14}/> Desconectar este WhatsApp</button>
          </div>}
        </div>}
      </div>)}</div>}

    {canManage && adding && <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 space-y-3">
      <div><p className="font-semibold text-sm text-blue-900">Adicionar uma instância existente</p>
        <p className="text-xs text-blue-700 mt-1">A instância deve existir na Evolution. Se ainda não estiver ligada a um celular, o QR Code aparecerá aqui.</p></div>
      <div><label className="label">Nome para identificar o número (opcional)</label><input className="input" value={form.name} onChange={e => setForm(p => ({...p,name:e.target.value}))} placeholder="Ex.: Vendas" /></div>
      <div><label className="label">Endereço da Evolution API</label><input className="input" value={form.provider_url} onChange={e => setForm(p => ({...p,provider_url:e.target.value}))} placeholder="http://127.0.0.1:8080" /></div>
      <div><label className="label">Nome exato da instância</label><input className="input" value={form.instance_name} onChange={e => setForm(p => ({...p,instance_name:e.target.value}))} placeholder="minha-instancia" /></div>
      <div><label className="label">API Key da Evolution</label><input className="input" type="password" autoComplete="off" value={form.api_key} onChange={e => setForm(p => ({...p,api_key:e.target.value}))} placeholder="Chave configurada na Evolution" /></div>
      <div className="flex justify-end gap-2"><button className="btn-secondary" onClick={() => setAdding(false)}>Cancelar</button>
        <button className="btn-primary" disabled={busyId !== null || !form.instance_name.trim() || !form.provider_url.trim() || !form.api_key.trim()} onClick={() => void attach()}>
          {busyId === 'add' ? <Loader2 size={16} className="animate-spin"/> : <Plus size={16}/>} Vincular instância
        </button>
      </div>
    </div>}
    <p className="text-xs text-slate-500">Controle de acesso aos números: Equipe &amp; Permissões → Permissões por WhatsApp.</p>

    <Modal open={qrChannel !== null} onClose={() => {setQrChannel(null);setQrData(null);setQrError('');}} title={`Conectar: ${qrChannel ? displayName(qrChannel) : ''}`} size="md">
      <div className="space-y-4 text-center">
        <p className="text-sm text-slate-600">No celular: WhatsApp → Aparelhos conectados → Conectar um aparelho. Escaneie o código abaixo.</p>
        {qrData?.qr_code && <img src={qrData.qr_code} alt="QR Code da instância Evolution" className="w-72 h-72 mx-auto object-contain bg-[#F2F2F0] rounded-lg p-2 border border-slate-200"/>}
        {!qrData?.qr_code && !qrError && <div className="h-56 flex items-center justify-center text-slate-500 gap-2"><Loader2 size={20} className="animate-spin"/> Gerando QR Code...</div>}
        {qrError && <p className="text-sm text-amber-800 bg-amber-50 p-3 rounded-lg">{qrError}</p>}
        {!qrData?.qr_code && qrData?.pairing_code && <p className="text-sm text-slate-700">Código de pareamento alternativo: <code className="font-semibold">{qrData.pairing_code}</code></p>}
        <p className="text-xs text-slate-500">A conexão será detectada automaticamente. Se o QR expirar, gere outro.</p>
        <div className="flex items-center justify-center gap-2">
          <button className="btn-secondary" disabled={busyId === qrChannel?.id || !qrChannel} onClick={() => qrChannel && void showQr(qrChannel)}><RefreshCw size={14}/> Atualizar QR</button>
          <button className="btn-primary" onClick={() => {setQrChannel(null);setQrData(null);}}>Fechar</button>
        </div>
      </div>
    </Modal>
  </div>;
}
