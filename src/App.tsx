import { AuthProvider, useAuth } from '@/contexts/AuthContext';
import { OrgProvider, useOrg } from '@/contexts/OrgContext';
import { ToastContainer } from '@/components/ui/Toast';
import { FullPageSpinner } from '@/components/ui/Spinner';
import { AuthPage } from '@/pages/AuthPage';
import { AppShell, type PageId } from '@/components/AppShell';
import { DashboardPage } from '@/pages/DashboardPage';
import { ContactsPage } from '@/pages/ContactsPage';
import { InboxPage } from '@/pages/InboxPage';
import { CrmPage } from '@/pages/CrmPage';
import { ChatbotsPage } from '@/pages/ChatbotsPage';
import { AutomationsPage } from '@/pages/AutomationsPage';
import { CampaignsPage } from '@/pages/CampaignsPage';
import { SchedulesPage } from '@/pages/SchedulesPage';
import { ReportsPage } from '@/pages/ReportsPage';
import { TeamPage } from '@/pages/TeamPage';
import { SettingsPage } from '@/pages/SettingsPage';
import { ProfilePage } from '@/pages/ProfilePage';
import { useEffect, useState } from 'react';
import { TechnicalReportPage } from '@/pages/TechnicalReportPage';
import { OrderOfDayPage } from '@/pages/OrderOfDayPage';

function AppContent() {
  const { user, loading: authLoading } = useAuth();
  const { loading: orgLoading, currentOrg, permissions } = useOrg();
  const [currentPage, setCurrentPage] = useState<PageId>(() => {
    const path = window.location.pathname.replace(/\/$/, '');
    return path === '/ordem-do-dia' || path === '/odd' ? 'technicalOdd' : path === '/relatorio-tecnico' ? 'technicalReport' : 'dashboard';
  });
  const ordered: PageId[] = ['dashboard','inbox','contacts','crm','chatbots','automations','campaigns','schedules','reports','technicalOdd','technicalReport','team','settings','profile'];
  const firstAllowed = ordered.find(page => permissions.includes(`page.${page}`));
  useEffect(() => {
    if (!orgLoading && firstAllowed && !permissions.includes(`page.${currentPage}`)) setCurrentPage(firstAllowed);
  }, [orgLoading, currentPage, permissions, firstAllowed]);

  if (authLoading || (user && orgLoading)) return <FullPageSpinner />;
  if (!user) return <AuthPage />;

  if (!currentOrg) return <div className="p-8 text-slate-700">Você não possui uma organização ativa ou não foi possível carregar suas permissões.</div>;
  if (!firstAllowed) return <div className="p-8 text-slate-700">Seu cargo ainda não possui páginas autorizadas. Solicite acesso ao Master.</div>;
  if (!permissions.includes(`page.${currentPage}`)) return <FullPageSpinner />;

  return (
    <AppShell currentPage={currentPage} onNavigate={setCurrentPage}>
      {{
        dashboard: <DashboardPage />,
        contacts: <ContactsPage />,
        inbox: <InboxPage />,
        crm: <CrmPage />,
        chatbots: <ChatbotsPage />,
        automations: <AutomationsPage />,
        campaigns: <CampaignsPage />,
        schedules: <SchedulesPage />,
        reports: <ReportsPage />,
        technicalOdd: <OrderOfDayPage embedded />,
        technicalReport: <TechnicalReportPage embedded />,
        team: <TeamPage />,
        settings: <SettingsPage />,
        profile: <ProfilePage />,
      }[currentPage]}
    </AppShell>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <OrgProvider>
        <AppContent />
        <ToastContainer />
      </OrgProvider>
    </AuthProvider>
  );
}
