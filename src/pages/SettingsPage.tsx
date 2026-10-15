import { useEffect, useState, useCallback } from 'react';
import { useOrg } from '@/contexts/OrgContext';
import { ChannelsPanel } from '@/components/ChannelsPanel';
import { supabase } from '@/lib/supabase';
import { apiRequest } from '@/lib/api';
import { Spinner } from '@/components/ui/Spinner';
import { EmptyState } from '@/components/ui/EmptyState';
import { Modal } from '@/components/ui/Modal';
import { toastSuccess, toastError, toastWarning } from '@/components/ui/Toast';
import type { Integration, AuditLog, WebhookEvent } from '@/types';
import {
  Settings, MessageCircle, Bot, Webhook, FileText, Shield,
  CheckCircle, XCircle, AlertTriangle, Plug, Copy, ExternalLink,
  Loader2, Phone,
} from 'lucide-react';

const INTEGRATION_TYPES = [
  {
    type: 'whatsapp',
    name: 'WhatsApp Business Platform',
    description: 'Conecte à API oficial do WhatsApp para enviar e receber mensagens.',
    icon: MessageCircle,
    color: 'bg-green-100 text-green-700',
    docs: 'https://developers.facebook.com/docs/whatsapp/whatsapp-business-platform',
  },
  {
    type: 'ai_provider',
    name: 'Provedor de IA',
    description: 'Integre um provedor de IA para respostas inteligentes e triagem automática.',
    icon: Bot,
    color: 'bg-purple-100 text-purple-700',
    docs: 'https://platform.openai.com/docs',
  },
  {
    type: 'webhook',
    name: 'Webhook',
    description: 'Receba eventos em tempo real no seu endpoint via webhook.',
    icon: Webhook,
    color: 'bg-pink-100 text-pink-700',
    docs: 'https://docs.evolution-api.com/',
  },
];

export function SettingsPage() {
  const { currentOrg,currentMembership } = useOrg();
  const orgId = currentOrg?.id;
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [webhookEvents, setWebhookEvents] = useState<WebhookEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'integrations' | 'audit' | 'webhooks'>('integrations');
  const [showConfigModal, setShowConfigModal] = useState<Integration | null>(null);
  const [configType, setConfigType] = useState<string | null>(null);
  const [configForm, setConfigForm] = useState<Record<string, string>>({});
  const [whatsappSaving, setWhatsappSaving] = useState(false);
  const [whatsappResult, setWhatsappResult] = useState<{ verifyToken: string; phoneNumber: string; verifiedName: string; qrCode?: string } | null>(null);

  const load = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    try {
      const [intRes, activity] = await Promise.all([
        apiRequest<{ data: Integration[] }>('/integrations'),
        apiRequest<{ audit: AuditLog[], events: WebhookEvent[] }>('/integrations/activity'),
      ]);
      setIntegrations(intRes.data ?? []);
      setAuditLogs(activity.audit ?? []);
      setWebhookEvents(activity.events ?? []);
    } catch {
      toastError('Erro ao carregar configurações');
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => { load(); }, [load]);

  function getConfigValue(integ: Integration | undefined, key: string): string {
    if (!integ) return '';
    const val = (integ.config as Record<string, unknown>)?.[key];
    return val ? String(val) : '';
  }

  function openConfig(integType: string) {
    const existing = integrations.find(i => i.type === integType);
    setShowConfigModal(existing ?? null);
    setConfigType(integType);
    setWhatsappResult(null);
    const form: Record<string, string> = {};
    if (integType === 'whatsapp') {
      form.connection_mode = getConfigValue(existing, 'connection_mode') || 'official';
      form.phone_number_id = getConfigValue(existing, 'phone_number_id');
      form.business_account_id = getConfigValue(existing, 'business_account_id');
      form.access_token = '';
      form.app_secret = '';
      form.provider_url = getConfigValue(existing, 'provider_url');
      form.instance_name = getConfigValue(existing, 'instance_name');
      form.api_key = '';
    } else if (integType === 'ai_provider') {
      form.provider = getConfigValue(existing, 'provider') || 'openai';
      form.model = getConfigValue(existing, 'model') || 'gpt-4';
      form.api_key = '';
    } else if (integType === 'webhook') {
      form.url = getConfigValue(existing, 'url');
    }
    setConfigForm(form);
  }

  async function callWhatsAppApi(action: 'connect' | 'disconnect' | 'connect_unofficial', payload: Record<string, unknown>) {
    return apiRequest<any>('/integrations/whatsapp', { method: 'POST', body: JSON.stringify({ ...payload, action }) });
  }

  async function callIntegrationApi(payload: Record<string, unknown>) {
    return apiRequest<Record<string, unknown>>('/integrations/other', { method: 'POST', body: JSON.stringify(payload) });
  }

  async function handleSaveWhatsApp() {
    if (!orgId || configType !== 'whatsapp') return;
    setWhatsappSaving(true);
    try {
      const result = await callWhatsAppApi('connect', {
        org_id: orgId,
        phone_number_id: configForm.phone_number_id,
        business_account_id: configForm.business_account_id,
        access_token: configForm.access_token,
        app_secret: configForm.app_secret || undefined,
      });

      setWhatsappResult({
        verifyToken: result.webhook_verify_token ?? '',
        phoneNumber: result.display_phone_number ?? '',
        verifiedName: result.verified_name ?? '',
      });

      toastSuccess('WhatsApp conectado com sucesso!');
      load();
    } catch (err) {
      toastError(err instanceof Error ? err.message : 'Erro ao conectar WhatsApp');
    } finally {
      setWhatsappSaving(false);
    }
  }

  async function handleSaveUnofficialWhatsApp() {
    if (!orgId || configType !== 'whatsapp') return;
    setWhatsappSaving(true);
    try {
      const result = await callWhatsAppApi('connect_unofficial', {
        org_id: orgId,
        provider_url: configForm.provider_url,
        instance_name: configForm.instance_name,
        api_key: configForm.api_key,
      });

      setWhatsappResult({
        verifyToken: '',
        phoneNumber: '',
        verifiedName: 'Evolution API',
        qrCode: result.qr_code,
      });
      toastSuccess(result.qr_code ? 'QR Code gerado. Escaneie pelo WhatsApp.' : 'Instância criada. Verifique a conexão no Evolution API.');
      load();
    } catch (err) {
      toastError(err instanceof Error ? err.message : 'Erro ao gerar QR Code');
    } finally {
      setWhatsappSaving(false);
    }
  }

  async function handleDisconnectWhatsApp(integrationId?: string) {
    if (!orgId) return;
    setWhatsappSaving(true);
    try {
      await callWhatsAppApi('disconnect', { org_id: orgId, integration_id: integrationId });
      toastSuccess('WhatsApp desconectado');
      setShowConfigModal(null);
      load();
    } catch {
      toastError('Erro ao desconectar WhatsApp');
    } finally {
      setWhatsappSaving(false);
    }
  }

  async function handleSaveOtherConfig() {
    if (!orgId || !configType) return;
    try {
      const result = await callIntegrationApi({
        org_id: orgId,
        type: configType,
        provider: configForm.provider,
        model: configForm.model,
        api_key: configForm.api_key,
        url: configForm.url,
      });

      if (result.connected) toastSuccess('Integração configurada e validada com sucesso!');
      setShowConfigModal(null);
      setConfigType(null);
      load();
    } catch (err) {
      toastError(err instanceof Error ? err.message : 'Erro ao salvar configuração');
    }
  }

  async function handleDisconnect(integ: Integration) {
    if (integ.type === 'whatsapp') {
      setShowConfigModal(integ);
      setConfigType('whatsapp');
      await handleDisconnectWhatsApp(integ.id);
      return;
    }
    try {
      await apiRequest('/integrations/disconnect', { method: 'POST', body: JSON.stringify({ id: integ.id }) });
      toastSuccess('Integração desconectada');
      load();
    } catch {
      toastError('Erro ao desconectar');
    }
  }

  const getStatusBadge = (status: string) => {
    const map: Record<string, { label: string; cls: string; icon: typeof CheckCircle }> = {
      connected: { label: 'Conectado', cls: 'badge-green', icon: CheckCircle },
      disconnected: { label: 'Desconectado', cls: 'badge-gray', icon: XCircle },
      demo: { label: 'Modo Demonstração', cls: 'badge-yellow', icon: AlertTriangle },
      error: { label: 'Erro', cls: 'badge-red', icon: AlertTriangle },
    };
    const s = map[status] ?? map.disconnected;
    const Icon = s.icon;
    return <span className={`badge ${s.cls}`}><Icon size={12} /> {s.label}</span>;
  };

  const webhookUrl = `${import.meta.env.VITE_API_URL || 'http://127.0.0.1:4000'}/api/webhooks/whatsapp`;

  if (loading) return <div className="flex justify-center py-12"><Spinner size={32} /></div>;

  const whatsappIntegration = integrations.find(i => i.type === 'whatsapp');
  const whatsappConnected = whatsappIntegration?.status === 'connected';
  const whatsappDisplayPhone = getConfigValue(whatsappIntegration, 'display_phone_number');
  const whatsappVerifiedName = getConfigValue(whatsappIntegration, 'verified_name');

  return (
    <div className="p-6 lg:p-8 max-w-5xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Integrações</h1>
        <p className="text-sm text-slate-500 mt-1">Configure integrações com WhatsApp, IA e webhooks</p>
      </div>

      {/* Demo mode banner */}
      {integrations.some(i => i.status === 'demo') && (
        <div className="mb-6 rounded-xl bg-yellow-50 ring-1 ring-yellow-200 p-4 flex items-start gap-3">
          <AlertTriangle size={20} className="text-yellow-600 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-yellow-800">Modo de Demonstração Ativo</p>
            <p className="text-sm text-yellow-700 mt-0.5">
              Algumas integrações estão em modo demonstração porque não possuem credenciais reais configuradas.
              Nenhuma conexão externa é feita neste modo. Adicione suas credenciais para ativar as integrações.
            </p>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 mb-6 rounded-lg bg-slate-100 p-1 w-fit">
        <button
          onClick={() => setActiveTab('integrations')}
          className={`rounded-md px-4 py-2 text-sm font-medium transition-all ${activeTab === 'integrations' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}
        >
          <Plug size={14} className="inline mr-1.5" /> Integrações
        </button>
        <button
          onClick={() => setActiveTab('audit')}
          className={`rounded-md px-4 py-2 text-sm font-medium transition-all ${activeTab === 'audit' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}
        >
          <FileText size={14} className="inline mr-1.5" /> Logs de Auditoria
        </button>
        <button
          onClick={() => setActiveTab('webhooks')}
          className={`rounded-md px-4 py-2 text-sm font-medium transition-all ${activeTab === 'webhooks' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}
        >
          <Webhook size={14} className="inline mr-1.5" /> Webhooks
        </button>
      </div>

      {activeTab === 'integrations' && (
        <div className="space-y-4">
          <ChannelsPanel canManage={currentMembership?.role==='owner'||currentMembership?.role==='admin'} />
          {INTEGRATION_TYPES.map(integType => {
            const Icon = integType.icon;
            const existing = integrations.find(i => i.type === integType.type);
            return (
              <div key={integType.type} className="card p-5">
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-4 flex-1 min-w-0">
                    <div className={`flex h-12 w-12 items-center justify-center rounded-xl ${integType.color} flex-shrink-0`}>
                      <Icon size={24} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <p className="font-semibold text-slate-900">{integType.name}</p>
                        {existing && getStatusBadge(existing.status)}
                      </div>
                      <p className="text-sm text-slate-500">{integType.description}</p>
                      {integType.type === 'whatsapp' && whatsappConnected && whatsappDisplayPhone && (
                        <div className="mt-2 flex items-center gap-2 text-sm text-green-700">
                          <Phone size={14} />
                          <span className="font-medium">+{whatsappDisplayPhone}</span>
                          {whatsappVerifiedName && <span className="text-slate-400">· {whatsappVerifiedName}</span>}
                        </div>
                      )}
                      <a
                        href={integType.docs}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 mt-2"
                      >
                        Ver documentação <ExternalLink size={12} />
                      </a>
                    </div>
                  </div>
                  <div className="flex flex-col gap-2 flex-shrink-0">
                    <button onClick={() => openConfig(integType.type)} className="btn-secondary text-xs">
                      <Settings size={14} /> {existing ? 'Configurar' : 'Conectar'}
                    </button>
                    {existing && existing.status !== 'disconnected' && (
                      <button onClick={() => handleDisconnect(existing)} className="btn-ghost text-xs text-red-600">
                        Desconectar
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}

          {/* Webhook URL info */}
          <div className="card p-5">
            <div className="flex items-start gap-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-slate-100 text-slate-600 flex-shrink-0">
                <Webhook size={24} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-slate-900 mb-1">URL do Webhook</p>
                <p className="text-sm text-slate-500 mb-2">Use esta URL para receber webhooks do WhatsApp e outros serviços.</p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 text-xs bg-slate-100 rounded-lg px-3 py-2 text-slate-700 truncate">{webhookUrl}</code>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(webhookUrl);
                      toastSuccess('URL copiada!');
                    }}
                    className="btn-secondary text-xs py-2"
                  >
                    <Copy size={14} /> Copiar
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'audit' && (
        <div className="card p-6">
          <h2 className="font-semibold text-slate-900 mb-4 flex items-center gap-2">
            <Shield size={18} className="text-slate-400" /> Logs de Auditoria
          </h2>
          {auditLogs.length === 0 ? (
            <EmptyState icon={<FileText size={28} />} title="Sem logs" description="Nenhuma atividade registrada ainda." />
          ) : (
            <div className="space-y-1 max-h-96 overflow-y-auto">
              {auditLogs.map(log => (
                <div key={log.id} className="flex items-center justify-between py-2.5 border-b border-slate-50 last:border-0">
                  <div>
                    <p className="text-sm font-medium text-slate-700">{log.action}</p>
                    <p className="text-xs text-slate-400">
                      {log.entity_type && `${log.entity_type}`} {log.entity_id && `· ${log.entity_id.substring(0, 8)}`}
                    </p>
                  </div>
                  <span className="text-xs text-slate-400">{new Date(log.created_at).toLocaleString('pt-BR')}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === 'webhooks' && (
        <div className="card p-6">
          <h2 className="font-semibold text-slate-900 mb-4 flex items-center gap-2">
            <Webhook size={18} className="text-slate-400" /> Eventos de Webhook Recebidos
          </h2>
          {webhookEvents.length === 0 ? (
            <EmptyState
              icon={<Webhook size={28} />}
              title="Nenhum webhook recebido"
              description="Os webhooks recebidos aparecerão aqui. Configure a URL do webhook no seu provedor de WhatsApp."
            />
          ) : (
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {webhookEvents.map(ev => (
                <div key={ev.id} className="rounded-lg bg-slate-50 p-3 ring-1 ring-slate-200">
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <span className="badge badge-blue">{ev.source}</span>
                      {ev.event_type && <span className="text-xs text-slate-500">{ev.event_type}</span>}
                      {ev.processed ? (
                        <span className="badge badge-green text-[10px]"><CheckCircle size={10} /> Processado</span>
                      ) : (
                        <span className="badge badge-yellow text-[10px]"><AlertTriangle size={10} /> Pendente</span>
                      )}
                    </div>
                    <span className="text-xs text-slate-400">{new Date(ev.received_at).toLocaleString('pt-BR')}</span>
                  </div>
                  {ev.error && <p className="text-xs text-red-600 mt-1">{ev.error}</p>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Config modal */}
      <Modal
        open={configType !== null}
        onClose={() => { setShowConfigModal(null); setConfigType(null); }}
        title={`Configurar: ${INTEGRATION_TYPES.find(t => t.type === configType)?.name ?? ''}`}
        size="md"
      >
        <div className="space-y-4">
          {configType === 'whatsapp' && (
            <>
              {whatsappResult ? (
                <div className="space-y-4">
                  <div className="rounded-lg bg-green-50 ring-1 ring-green-200 p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <CheckCircle size={20} className="text-green-600" />
                      <p className="text-sm font-semibold text-green-800">{whatsappResult.qrCode ? 'Escaneie o QR Code para conectar' : 'WhatsApp conectado!'}</p>
                    </div>
                    {whatsappResult.qrCode ? (
                      <div className="mt-3 flex justify-center rounded-lg bg-white p-4">
                        <img src={whatsappResult.qrCode} alt="QR Code para conectar o WhatsApp" className="h-64 w-64 object-contain" />
                      </div>
                    ) : (
                      <>
                        {whatsappResult.phoneNumber && (
                          <p className="text-sm text-green-700">Numero: +{whatsappResult.phoneNumber}</p>
                        )}
                        {whatsappResult.verifiedName && (
                          <p className="text-sm text-green-700">Nome verificado: {whatsappResult.verifiedName}</p>
                        )}
                      </>
                    )}
                  </div>

                  {!whatsappResult.qrCode && <div className="rounded-lg bg-blue-50 ring-1 ring-blue-200 p-4 space-y-3">
                    <div>
                      <p className="text-sm font-medium text-blue-900 mb-1">Passo final: configure o webhook na Meta</p>
                      <p className="text-xs text-blue-700">
                        No Meta Business Manager, va em WhatsApp &gt; Configuracao de Webhook, cole a URL e o token de verificacao abaixo,
                        e inscreva-se no campo <code className="bg-blue-100 px-1 rounded">messages</code>.
                      </p>
                    </div>
                    <div>
                      <label className="label">URL do Webhook</label>
                      <div className="flex items-center gap-2">
                        <code className="flex-1 text-xs bg-white rounded-lg px-3 py-2 text-slate-700 truncate ring-1 ring-blue-200">{webhookUrl}</code>
                        <button
                          onClick={() => { navigator.clipboard.writeText(webhookUrl); toastSuccess('URL copiada!'); }}
                          className="btn-secondary text-xs py-2"
                        >
                          <Copy size={14} />
                        </button>
                      </div>
                    </div>
                    <div>
                      <label className="label">Token de Verificacao</label>
                      <div className="flex items-center gap-2">
                        <code className="flex-1 text-xs bg-white rounded-lg px-3 py-2 text-slate-700 truncate ring-1 ring-blue-200 font-mono">{whatsappResult.verifyToken}</code>
                        <button
                          onClick={() => { navigator.clipboard.writeText(whatsappResult.verifyToken); toastSuccess('Token copiado!'); }}
                          className="btn-secondary text-xs py-2"
                        >
                          <Copy size={14} />
                        </button>
                      </div>
                    </div>
                  </div>}

                  <div className="flex justify-end pt-2">
                    <button onClick={() => { setShowConfigModal(null); setConfigType(null); }} className="btn-primary">Concluir</button>
                  </div>
                </div>
              ) : (
                <>
                  <div>
                    <label className="label">Tipo de conexão</label>
                    <select
                      value={configForm.connection_mode ?? 'official'}
                      onChange={(e) => setConfigForm({ ...configForm, connection_mode: e.target.value })}
                      className="input"
                    >
                      <option value="official">API oficial da Meta</option>
                      <option value="unofficial">API não oficial com QR Code</option>
                    </select>
                  </div>

                  {configForm.connection_mode === 'official' && <>
                  <div>
                    <label className="label">Phone Number ID</label>
                    <input type="text" value={configForm.phone_number_id ?? ''} onChange={(e) => setConfigForm({ ...configForm, phone_number_id: e.target.value })} className="input" placeholder="Ex: 123456789" />
                    <p className="text-xs text-slate-400 mt-1">Encontre em Meta Business Manager &gt; WhatsApp &gt; Numeros de telefone.</p>
                  </div>
                  <div>
                    <label className="label">WhatsApp Business Account ID</label>
                    <input type="text" value={configForm.business_account_id ?? ''} onChange={(e) => setConfigForm({ ...configForm, business_account_id: e.target.value })} className="input" placeholder="Ex: 987654321" />
                  </div>
                  <div>
                    <label className="label">Access Token</label>
                    <input type="password" value={configForm.access_token ?? ''} onChange={(e) => setConfigForm({ ...configForm, access_token: e.target.value })} className="input" placeholder="Token de acesso permanente" />
                    <p className="text-xs text-slate-400 mt-1">Gerado em Configuracao do App &gt; Tokens de acesso. Armazenado com seguranca no servidor.</p>
                  </div>
                  <div>
                    <label className="label">App Secret (opcional)</label>
                    <input type="password" value={configForm.app_secret ?? ''} onChange={(e) => setConfigForm({ ...configForm, app_secret: e.target.value })} className="input" placeholder="Secret do app Meta" />
                    <p className="text-xs text-slate-400 mt-1">Usado para verificar a assinatura dos webhooks. Recomendado para seguranca.</p>
                  </div>

                  <div className="rounded-lg bg-slate-50 p-3 ring-1 ring-slate-200">
                    <p className="text-xs text-slate-600">
                      <AlertTriangle size={14} className="inline mr-1 text-amber-500" />
                      A conexao valida seu numero diretamente na API da Meta. O token de acesso e armazenado com seguranca no servidor, nunca visivel no navegador.
                    </p>
                  </div>

                  <div className="flex justify-end gap-3 pt-2">
                    <button onClick={() => { setShowConfigModal(null); setConfigType(null); }} className="btn-secondary">Cancelar</button>
                    <button
                      onClick={handleSaveWhatsApp}
                      disabled={whatsappSaving || !configForm.phone_number_id || !configForm.business_account_id || !configForm.access_token}
                      className="btn-primary flex items-center gap-2"
                    >
                      {whatsappSaving ? <Loader2 size={16} className="animate-spin" /> : <MessageCircle size={16} />}
                      {whatsappSaving ? 'Conectando...' : 'Conectar WhatsApp'}
                    </button>
                  </div>
                  </>}

                  {configForm.connection_mode === 'unofficial' && <>
                    <div>
                      <label className="label">URL do Evolution API</label>
                      <input type="url" value={configForm.provider_url ?? ''} onChange={(e) => setConfigForm({ ...configForm, provider_url: e.target.value })} className="input" placeholder="https://seu-provedor.com" />
                    </div>
                    <div>
                      <label className="label">Nome da instância</label>
                      <input type="text" value={configForm.instance_name ?? ''} onChange={(e) => setConfigForm({ ...configForm, instance_name: e.target.value })} className="input" placeholder="minha-empresa" />
                    </div>
                    <div>
                      <label className="label">API Key do provedor</label>
                      <input type="password" value={configForm.api_key ?? ''} onChange={(e) => setConfigForm({ ...configForm, api_key: e.target.value })} className="input" placeholder="Chave do Evolution API" />
                    </div>
                    <div className="rounded-lg bg-amber-50 p-3 ring-1 ring-amber-200">
                      <p className="text-xs text-amber-800">
                        <AlertTriangle size={14} className="inline mr-1" />
                        APIs não oficiais podem causar bloqueio ou perda do número pela Meta. Use apenas um provedor autorizado por você.
                      </p>
                    </div>
                    <div className="flex justify-end gap-3 pt-2">
                      <button onClick={() => { setShowConfigModal(null); setConfigType(null); }} className="btn-secondary">Cancelar</button>
                      <button
                        onClick={handleSaveUnofficialWhatsApp}
                        disabled={whatsappSaving || !configForm.provider_url || !configForm.instance_name || !configForm.api_key}
                        className="btn-primary flex items-center gap-2"
                      >
                        {whatsappSaving ? <Loader2 size={16} className="animate-spin" /> : <MessageCircle size={16} />}
                        {whatsappSaving ? 'Gerando QR...' : 'Gerar QR Code'}
                      </button>
                    </div>
                  </>}
                </>
              )}
            </>
          )}
          {configType === 'ai_provider' && (
            <>
              <div>
                <label className="label">Provedor</label>
                <select value={configForm.provider ?? 'openai'} onChange={(e) => setConfigForm({ ...configForm, provider: e.target.value })} className="input">
                  <option value="openai">OpenAI</option>
                  <option value="anthropic">Anthropic</option>
                  <option value="google">Google AI</option>
                </select>
              </div>
              <div>
                <label className="label">Modelo</label>
                <input type="text" value={configForm.model ?? ''} onChange={(e) => setConfigForm({ ...configForm, model: e.target.value })} className="input" placeholder="Ex: gpt-4" />
              </div>
              <div>
                <label className="label">API Key</label>
                <input type="password" value={configForm.api_key ?? ''} onChange={(e) => setConfigForm({ ...configForm, api_key: e.target.value })} className="input" placeholder="sua-chave-api" />
                <p className="text-xs text-slate-400 mt-1">A chave será validada pela OpenAI e armazenada somente no servidor.</p>
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button onClick={() => { setShowConfigModal(null); setConfigType(null); }} className="btn-secondary">Cancelar</button>
                <button onClick={handleSaveOtherConfig} disabled={!configForm.api_key} className="btn-primary">Conectar OpenAI</button>
              </div>
            </>
          )}
          {configType === 'webhook' && (
            <>
              <div>
                <label className="label">URL de destino</label>
                <input type="url" value={configForm.url ?? ''} onChange={(e) => setConfigForm({ ...configForm, url: e.target.value })} className="input" placeholder="https://sua-api.com/webhook" />
                <p className="text-xs text-slate-400 mt-1">Os eventos serão enviados para esta URL via POST.</p>
              </div>
              {!configForm.url && (
                <div className="rounded-lg bg-yellow-50 p-3 ring-1 ring-yellow-200">
                  <p className="text-xs text-yellow-700">
                    <AlertTriangle size={14} className="inline mr-1" />
                    Sem credenciais reais, a integracao sera salva em modo demonstracao.
                  </p>
                </div>
              )}
              <div className="flex justify-end gap-3 pt-2">
                <button onClick={() => { setShowConfigModal(null); setConfigType(null); }} className="btn-secondary">Cancelar</button>
                <button onClick={handleSaveOtherConfig} disabled={!configForm.url} className="btn-primary">Conectar webhook</button>
              </div>
            </>
          )}
        </div>
      </Modal>
    </div>
  );
}
