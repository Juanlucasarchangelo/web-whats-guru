import { useEffect, useState } from 'react';
import { useOrg } from '@/contexts/OrgContext';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { Spinner } from '@/components/ui/Spinner';
import { EmptyState } from '@/components/ui/EmptyState';
import {
  Inbox, Users, Kanban, Megaphone, TrendingUp, Clock,
  MessageCircle, UserCheck, Bot, Zap,
} from 'lucide-react';

interface Stats {
  openConversations: number;
  totalContacts: number;
  pipelineValue: number;
  activeCampaigns: number;
  todayMessages: number;
  resolvedToday: number;
  activeBots: number;
  activeAutomations: number;
}

interface RecentConversation {
  id: string;
  contact_name: string;
  status: string;
  unread_count: number;
  last_message_at: string;
  channel: string;
}

export function DashboardPage() {
  const { currentOrg } = useOrg();
  const { user } = useAuth();
  const [stats, setStats] = useState<Stats | null>(null);
  const [recentConvs, setRecentConvs] = useState<RecentConversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!currentOrg) return;
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const orgId = currentOrg!.id;

        const [convRes, contactRes, campRes, msgRes, botRes, autoRes] = await Promise.all([
          supabase.from('conversations').select('id, status, unread_count, last_message_at').eq('org_id', orgId),
          supabase.from('contacts').select('id, crm_value, crm_stage').eq('org_id', orgId),
          supabase.from('campaigns').select('id, status').eq('org_id', orgId).in('status', ['scheduled', 'sending']),
          supabase.from('messages').select('id, created_at, sender_type').eq('org_id', orgId).order('created_at', { ascending: false }).limit(1000),
          supabase.from('chatbots').select('id, status').eq('org_id', orgId).eq('status', 'active'),
          supabase.from('automations').select('id, status').eq('org_id', orgId).eq('status', 'active'),
        ]);

        if (convRes.error || contactRes.error || campRes.error || msgRes.error || botRes.error || autoRes.error) {
          throw new Error('Erro ao carregar dados');
        }

        const conversations = convRes.data ?? [];
        const contacts = contactRes.data ?? [];
        const todayMessages = (msgRes.data ?? []).filter(m => String(m.created_at).slice(0, 10) === new Date().toISOString().slice(0, 10));
        const resolvedToday = conversations.filter(c => c.status === 'closed').length;
        const pipelineValue = contacts
          .filter(c => !['lost', 'won'].includes(c.crm_stage))
          .reduce((sum, c) => sum + Number(c.crm_value), 0);

        if (cancelled) return;
        setStats({
          openConversations: conversations.filter(c => c.status === 'open' || c.status === 'pending').length,
          totalContacts: contacts.length,
          pipelineValue,
          activeCampaigns: campRes.data?.length ?? 0,
          todayMessages: todayMessages.length,
          resolvedToday,
          activeBots: botRes.data?.length ?? 0,
          activeAutomations: autoRes.data?.length ?? 0,
        });

        // Recent conversations with contact names
        const { data: recentData, error: recentErr } = await supabase
          .from('conversations')
          .select('id, status, unread_count, last_message_at, channel, contact:contacts(name)')
          .eq('org_id', orgId)
          .order('last_message_at', { ascending: false })
          .limit(5);

        if (recentErr) throw new Error('Erro ao carregar conversas recentes');
        if (cancelled) return;

        const recent = (recentData ?? []).map((c: any) => ({
          id: c.id,
          contact_name: c.contact?.name ?? 'Desconhecido',
          status: c.status,
          unread_count: c.unread_count,
          last_message_at: c.last_message_at,
          channel: c.channel,
        }));
        setRecentConvs(recent);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Erro ao carregar');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [currentOrg]);

  if (loading) return <div className="flex items-center justify-center h-full py-20"><Spinner size={32} /></div>;
  if (error) return <div className="p-6 text-sm text-red-600">{error}</div>;
  if (!stats) return null;

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Bom dia' : hour < 18 ? 'Boa tarde' : 'Boa noite';

  const statCards = [
    { label: 'Conversas Abertas', value: stats.openConversations, icon: Inbox, color: 'text-blue-600 bg-blue-50' },
    { label: 'Contatos', value: stats.totalContacts, icon: Users, color: 'text-green-600 bg-green-50' },
    { label: 'Pipeline', value: stats.pipelineValue.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }), icon: TrendingUp, color: 'text-yellow-600 bg-yellow-50' },
    { label: 'Campanhas Ativas', value: stats.activeCampaigns, icon: Megaphone, color: 'text-pink-600 bg-pink-50' },
    { label: 'Mensagens Hoje', value: stats.todayMessages, icon: MessageCircle, color: 'text-indigo-600 bg-indigo-50' },
    { label: 'Resolvidas Hoje', value: stats.resolvedToday, icon: UserCheck, color: 'text-teal-600 bg-teal-50' },
    { label: 'Chatbots Ativos', value: stats.activeBots, icon: Bot, color: 'text-purple-600 bg-purple-50' },
    { label: 'Automações Ativas', value: stats.activeAutomations, icon: Zap, color: 'text-orange-600 bg-orange-50' },
  ];

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-slate-900">{greeting}!</h1>
        <p className="text-sm text-slate-500 mt-1">Aqui está um resumo da sua organização hoje.</p>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        {statCards.map((card) => {
          const Icon = card.icon;
          return (
            <div key={card.label} className="card p-5">
              <div className="flex items-center justify-between mb-3">
                <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${card.color}`}>
                  <Icon size={20} />
                </div>
              </div>
              <p className="text-2xl font-bold text-slate-900">{card.value}</p>
              <p className="text-sm text-slate-500 mt-0.5">{card.label}</p>
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent conversations */}
        <div className="card p-6">
          <div className="flex items-center gap-2 mb-4">
            <Inbox size={18} className="text-slate-400" />
            <h2 className="font-semibold text-slate-900">Conversas Recentes</h2>
          </div>
          {recentConvs.length === 0 ? (
            <EmptyState
              icon={<Inbox size={28} />}
              title="Nenhuma conversa ainda"
              description="As conversas recebidas aparecerão aqui."
            />
          ) : (
            <div className="space-y-3">
              {recentConvs.map((conv) => (
                <div key={conv.id} className="flex items-center justify-between py-2.5 border-b border-slate-50 last:border-0">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-sm font-semibold text-slate-600 flex-shrink-0">
                      {conv.contact_name.charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-900 truncate">{conv.contact_name}</p>
                      <p className="text-xs text-slate-400">{formatRelativeTime(conv.last_message_at)}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {conv.unread_count > 0 && (
                      <span className="badge badge-red">{conv.unread_count} não lidas</span>
                    )}
                    <span className={`badge ${
                      conv.status === 'open' ? 'badge-green' :
                      conv.status === 'pending' ? 'badge-yellow' : 'badge-gray'
                    }`}>
                      {conv.status === 'open' ? 'Aberta' : conv.status === 'pending' ? 'Pendente' : 'Fechada'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Quick info */}
        <div className="card p-6">
          <div className="flex items-center gap-2 mb-4">
            <Clock size={18} className="text-slate-400" />
            <h2 className="font-semibold text-slate-900">Atividade de Hoje</h2>
          </div>
          <div className="space-y-4">
            <ActivityRow label="Mensagens trocadas" value={stats.todayMessages} total={Math.max(stats.todayMessages, 1)} color="bg-indigo-500" />
            <ActivityRow label="Conversas resolvidas" value={stats.resolvedToday} total={Math.max(stats.resolvedToday + stats.openConversations, 1)} color="bg-teal-500" />
            <ActivityRow label="Chatbots ativos" value={stats.activeBots} total={Math.max(stats.activeBots, 1)} color="bg-purple-500" />
            <ActivityRow label="Automações ativas" value={stats.activeAutomations} total={Math.max(stats.activeAutomations, 1)} color="bg-orange-500" />
          </div>
        </div>
      </div>
    </div>
  );
}

function ActivityRow({ label, value, total, color }: { label: string; value: number; total: number; color: string }) {
  const pct = Math.min((value / total) * 100, 100);
  return (
    <div>
      <div className="flex justify-between text-sm mb-1.5">
        <span className="text-slate-600">{label}</span>
        <span className="font-semibold text-slate-900">{value}</span>
      </div>
      <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
        <div className={`h-full rounded-full ${color} transition-all duration-500`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'agora';
  if (mins < 60) return `há ${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `há ${hours}h`;
  const days = Math.floor(hours / 24);
  return `há ${days}d`;
}
