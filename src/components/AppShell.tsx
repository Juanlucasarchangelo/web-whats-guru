import { useState, type ReactNode } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useOrg } from '@/contexts/OrgContext';
import {
  MessageCircle, LayoutDashboard, Inbox, Users, Kanban, Bot,
  Zap, Megaphone, CalendarClock, BarChart3, UsersRound, Settings,
  LogOut, Menu, X, Shield,
} from 'lucide-react';

export type PageId =
  | 'dashboard' | 'inbox' | 'contacts' | 'crm' | 'chatbots'
  | 'automations' | 'campaigns' | 'schedules' | 'reports'
  | 'team' | 'settings';

interface AppShellProps {
  currentPage: PageId;
  onNavigate: (page: PageId) => void;
  children: ReactNode;
}

const navItems: { id: PageId; label: string; icon: typeof LayoutDashboard }[] = [
  { id: 'dashboard', label: 'Painel', icon: LayoutDashboard },
  { id: 'inbox', label: 'Caixa de Entrada', icon: Inbox },
  { id: 'contacts', label: 'Contatos', icon: Users },
  { id: 'crm', label: 'CRM Kanban', icon: Kanban },
  { id: 'chatbots', label: 'Chatbots', icon: Bot },
  { id: 'automations', label: 'Automações', icon: Zap },
  { id: 'campaigns', label: 'Campanhas', icon: Megaphone },
  { id: 'schedules', label: 'Agendamentos', icon: CalendarClock },
  { id: 'reports', label: 'Relatórios', icon: BarChart3 },
  { id: 'team', label: 'Equipe & Permissões', icon: UsersRound },
  { id: 'settings', label: 'Integrações', icon: Settings },
];

export function AppShell({ currentPage, onNavigate, children }: AppShellProps) {
  const { user, profile, signOut } = useAuth();
  const { currentOrg, currentMembership, organizations, switchOrganization } = useOrg();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);

  const isAdmin = currentMembership?.role === 'owner' || currentMembership?.role === 'admin';

  function handleNavigate(page: PageId) {
    onNavigate(page);
    setSidebarOpen(false);
  }

  function handleSignOut() {
    signOut();
  }

  return (
    <div className="flex h-screen bg-slate-50">
      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-30 bg-slate-900/40 lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      {/* Sidebar */}
      <aside className={`
        fixed lg:static inset-y-0 left-0 z-40
        w-64 bg-white border-r border-slate-200 flex flex-col
        transform transition-transform duration-200
        ${sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
      `}>
        {/* Logo */}
        <div className="flex items-center justify-between h-16 px-5 border-b border-slate-100">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-600 shadow-sm shadow-blue-600/20">
              <MessageCircle className="text-white" size={20} />
            </div>
            <span className="text-lg font-bold text-slate-900">Converso</span>
          </div>
          <button onClick={() => setSidebarOpen(false)} className="lg:hidden text-slate-400">
            <X size={20} />
          </button>
        </div>

        {/* Company identity */}
        <div className="px-3 py-3 border-b border-slate-100">
          <div className="flex items-center gap-2.5 rounded-lg px-3 py-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-100 text-slate-500 flex-shrink-0">
              <span className="text-sm font-semibold">{currentOrg?.name?.charAt(0) ?? 'C'}</span>
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium text-slate-900 truncate">{currentOrg?.name ?? 'Converso'}</p>
              <p className="text-xs text-slate-400 capitalize">{currentMembership?.role ?? 'equipe'}</p>
            </div>
          </div>
          {organizations.length > 1 && <select className="input w-full text-sm mt-2" aria-label="Empresa ativa" value={currentOrg?.id || ''} onChange={e=>switchOrganization(e.target.value)}>
            {organizations.map(o=><option key={o.id} value={o.id}>{o.name}</option>)}
          </select>}
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto px-3 py-3 space-y-0.5">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = currentPage === item.id;
            const restricted = (item.id === 'team' || item.id === 'settings') && !isAdmin;
            return (
              <button
                key={item.id}
                onClick={() => handleNavigate(item.id)}
                className={`sidebar-item w-full ${isActive ? 'sidebar-item-active' : ''} ${restricted ? 'opacity-60' : ''}`}
                title={restricted ? 'Acesso restrito a administradores' : undefined}
              >
                <Icon size={18} />
                <span className="flex-1 text-left">{item.label}</span>
                {restricted && <Shield size={14} className="text-slate-400" />}
              </button>
            );
          })}
        </nav>

        {/* User section */}
        <div className="border-t border-slate-100 p-3 relative">
          <button
            onClick={() => setUserMenuOpen(!userMenuOpen)}
            className="flex items-center gap-2.5 w-full rounded-lg px-3 py-2 hover:bg-slate-50 transition-colors"
          >
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-100 text-blue-700 text-sm font-semibold flex-shrink-0">
              {profile?.full_name?.charAt(0)?.toUpperCase() ?? user?.email?.charAt(0)?.toUpperCase() ?? '?'}
            </div>
            <div className="min-w-0 flex-1 text-left">
              <p className="text-sm font-medium text-slate-900 truncate">
                {profile?.full_name || 'Usuário'}
              </p>
              <p className="text-xs text-slate-400 truncate">{user?.email}</p>
            </div>
          </button>

          {userMenuOpen && (
            <div className="absolute left-3 right-3 bottom-full mb-1 rounded-lg bg-white shadow-lg ring-1 ring-slate-200 py-1 z-10">
              <button
                onClick={handleSignOut}
                className="flex items-center gap-2 w-full px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 transition-colors"
              >
                <LogOut size={16} />
                Sair da conta
              </button>
            </div>
          )}
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Mobile header */}
        <header className="lg:hidden flex items-center justify-between h-14 px-4 bg-white border-b border-slate-200">
          <button onClick={() => setSidebarOpen(true)} className="text-slate-600">
            <Menu size={22} />
          </button>
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-600">
              <MessageCircle className="text-white" size={16} />
            </div>
            <span className="font-bold text-slate-900">Converso</span>
          </div>
          <div className="w-8" />
        </header>

        <main className="flex-1 overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
