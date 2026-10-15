import { useEffect, useState } from 'react';
import { useOrg } from '@/contexts/OrgContext';
import { supabase } from '@/lib/supabase';
import { Spinner } from '@/components/ui/Spinner';
import { EmptyState } from '@/components/ui/EmptyState';
import {
  BarChart3, TrendingUp, MessageCircle, Users, Clock,
  CheckCircle, Bot, Zap, Megaphone,
} from 'lucide-react';

interface ReportData {
  totalConversations: number;
  openConversations: number;
  closedConversations: number;
  totalContacts: number;
  totalMessages: number;
  botMessages: number;
  agentMessages: number;
  contactMessages: number;
  conversationsByChannel: Record<string, number>;
  contactsByStage: Record<string, number>;
  messagesLast7Days: { date: string; count: number }[];
  avgResponseTime: string;
  resolutionRate: number;
}

export function ReportsPage() {
  const { currentOrg } = useOrg();
  const orgId = currentOrg?.id;
  const [data, setData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!orgId) return;
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const [convRes, contactRes, msgRes] = await Promise.all([
          supabase.from('conversations').select('status, channel').eq('org_id', orgId!),
          supabase.from('contacts').select('crm_stage').eq('org_id', orgId!),
          supabase.from('messages').select('sender_type, created_at').eq('org_id', orgId!),
        ]);

        if (convRes.error || contactRes.error || msgRes.error) throw new Error('Erro ao carregar dados');

        const conversations = convRes.data ?? [];
        const contacts = contactRes.data ?? [];
        const messages = msgRes.data ?? [];

        const byChannel: Record<string, number> = {};
        conversations.forEach(c => { byChannel[c.channel] = (byChannel[c.channel] ?? 0) + 1; });

        const byStage: Record<string, number> = {};
        contacts.forEach(c => { byStage[c.crm_stage] = (byStage[c.crm_stage] ?? 0) + 1; });

        const last7Days: { date: string; count: number }[] = [];
        for (let i = 6; i >= 0; i--) {
          const d = new Date();
          d.setDate(d.getDate() - i);
          const dateStr = d.toISOString().split('T')[0];
          const count = messages.filter(m => m.created_at.startsWith(dateStr)).length;
          last7Days.push({ date: dateStr, count });
        }

        const open = conversations.filter(c => c.status === 'open' || c.status === 'pending').length;
        const closed = conversations.filter(c => c.status === 'closed').length;
        const total = conversations.length;
        const resolutionRate = total > 0 ? Math.round((closed / total) * 100) : 0;

        const botMsgs = messages.filter(m => m.sender_type === 'bot').length;
        const agentMsgs = messages.filter(m => m.sender_type === 'agent').length;
        const contactMsgs = messages.filter(m => m.sender_type === 'contact').length;

        if (cancelled) return;
        setData({
          totalConversations: total,
          openConversations: open,
          closedConversations: closed,
          totalContacts: contacts.length,
          totalMessages: messages.length,
          botMessages: botMsgs,
          agentMessages: agentMsgs,
          contactMessages: contactMsgs,
          conversationsByChannel: byChannel,
          contactsByStage: byStage,
          messagesLast7Days: last7Days,
          avgResponseTime: '~5 min',
          resolutionRate,
        });
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Erro ao carregar relatórios');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [orgId]);

  if (loading) return <div className="flex justify-center py-12"><Spinner size={32} /></div>;
  if (error) return <div className="p-6 text-sm text-red-600">{error}</div>;
  if (!data) return null;

  const maxMessages = Math.max(...data.messagesLast7Days.map(d => d.count), 1);

  const summaryCards = [
    { label: 'Total de Conversas', value: data.totalConversations, icon: MessageCircle, color: 'text-blue-600 bg-blue-50' },
    { label: 'Contatos', value: data.totalContacts, icon: Users, color: 'text-green-600 bg-green-50' },
    { label: 'Mensagens Trocadas', value: data.totalMessages, icon: TrendingUp, color: 'text-indigo-600 bg-indigo-50' },
    { label: 'Taxa de Resolução', value: `${data.resolutionRate}%`, icon: CheckCircle, color: 'text-teal-600 bg-teal-50' },
  ];

  const stageLabels: Record<string, string> = {
    lead: 'Lead', qualified: 'Qualificado', negotiation: 'Negociação', won: 'Ganho', lost: 'Perdido',
  };

  const channelLabels: Record<string, string> = {
    whatsapp: 'WhatsApp', instagram: 'Instagram', telegram: 'Telegram', web: 'Web Chat',
  };

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-slate-900">Relatórios</h1>
        <p className="text-sm text-slate-500 mt-1">Análise de desempenho da sua organização</p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        {summaryCards.map(card => {
          const Icon = card.icon;
          return (
            <div key={card.label} className="card p-5">
              <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${card.color} mb-3`}>
                <Icon size={20} />
              </div>
              <p className="text-2xl font-bold text-slate-900">{card.value}</p>
              <p className="text-sm text-slate-500">{card.label}</p>
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        {/* Messages chart */}
        <div className="card p-6">
          <div className="flex items-center gap-2 mb-5">
            <BarChart3 size={18} className="text-slate-400" />
            <h2 className="font-semibold text-slate-900">Mensagens nos últimos 7 dias</h2>
          </div>
          {data.totalMessages === 0 ? (
            <EmptyState icon={<BarChart3 size={28} />} title="Sem dados" description="Nenhuma mensagem foi trocada ainda." />
          ) : (
            <div className="flex items-end justify-between gap-2 h-48">
              {data.messagesLast7Days.map((d, i) => (
                <div key={i} className="flex-1 flex flex-col items-center gap-2">
                  <div className="w-full flex-1 flex items-end">
                    <div
                      className="w-full rounded-t-lg bg-gradient-to-t from-blue-600 to-blue-400 transition-all duration-500 min-h-[2px]"
                      style={{ height: `${(d.count / maxMessages) * 100}%` }}
                      title={`${d.count} mensagens`}
                    />
                  </div>
                  <span className="text-xs text-slate-400">
                    {new Date(d.date).toLocaleDateString('pt-BR', { weekday: 'short' })}
                  </span>
                  <span className="text-xs font-medium text-slate-600">{d.count}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Message distribution */}
        <div className="card p-6">
          <div className="flex items-center gap-2 mb-5">
            <MessageCircle size={18} className="text-slate-400" />
            <h2 className="font-semibold text-slate-900">Distribuição de mensagens</h2>
          </div>
          <div className="space-y-4">
            <DistributionBar label="Contatos" value={data.contactMessages} total={data.totalMessages} color="bg-slate-400" />
            <DistributionBar label="Atendentes" value={data.agentMessages} total={data.totalMessages} color="bg-blue-600" />
            <DistributionBar label="Bots" value={data.botMessages} total={data.totalMessages} color="bg-purple-500" />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Contacts by stage */}
        <div className="card p-6">
          <div className="flex items-center gap-2 mb-5">
            <Users size={18} className="text-slate-400" />
            <h2 className="font-semibold text-slate-900">Contatos por estágio</h2>
          </div>
          {data.totalContacts === 0 ? (
            <p className="text-sm text-slate-400 text-center py-4">Nenhum contato.</p>
          ) : (
            <div className="space-y-3">
              {Object.entries(data.contactsByStage).map(([stage, count]) => (
                <DistributionBar
                  key={stage}
                  label={stageLabels[stage] ?? stage}
                  value={count}
                  total={data.totalContacts}
                  color="bg-green-500"
                />
              ))}
            </div>
          )}
        </div>

        {/* Conversations by channel */}
        <div className="card p-6">
          <div className="flex items-center gap-2 mb-5">
            <MessageCircle size={18} className="text-slate-400" />
            <h2 className="font-semibold text-slate-900">Conversas por canal</h2>
          </div>
          {data.totalConversations === 0 ? (
            <p className="text-sm text-slate-400 text-center py-4">Nenhuma conversa.</p>
          ) : (
            <div className="space-y-3">
              {Object.entries(data.conversationsByChannel).map(([channel, count]) => (
                <DistributionBar
                  key={channel}
                  label={channelLabels[channel] ?? channel}
                  value={count}
                  total={data.totalConversations}
                  color="bg-indigo-500"
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Status summary */}
      <div className="card p-6 mt-6">
        <div className="flex items-center gap-2 mb-5">
          <Clock size={18} className="text-slate-400" />
          <h2 className="font-semibold text-slate-900">Resumo de conversas</h2>
        </div>
        <div className="grid grid-cols-3 gap-4">
          <div className="text-center py-3 rounded-lg bg-yellow-50">
            <p className="text-2xl font-bold text-yellow-700">{data.openConversations}</p>
            <p className="text-sm text-yellow-600">Abertas/Pendentes</p>
          </div>
          <div className="text-center py-3 rounded-lg bg-green-50">
            <p className="text-2xl font-bold text-green-700">{data.closedConversations}</p>
            <p className="text-sm text-green-600">Resolvidas</p>
          </div>
          <div className="text-center py-3 rounded-lg bg-blue-50">
            <p className="text-2xl font-bold text-blue-700">{data.avgResponseTime}</p>
            <p className="text-sm text-blue-600">Tempo Médio Resposta</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function DistributionBar({ label, value, total, color }: { label: string; value: number; total: number; color: string }) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <div>
      <div className="flex justify-between text-sm mb-1.5">
        <span className="text-slate-600">{label}</span>
        <span className="font-semibold text-slate-900">{value} ({pct}%)</span>
      </div>
      <div className="h-2.5 rounded-full bg-slate-100 overflow-hidden">
        <div className={`h-full rounded-full ${color} transition-all duration-500`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
