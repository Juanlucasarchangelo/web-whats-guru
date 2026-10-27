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
import { useState } from 'react';
import { TechnicalReportPage } from '@/pages/TechnicalReportPage';
import { OrderOfDayPage } from '@/pages/OrderOfDayPage';

function AppContent() {
  const { user, loading: authLoading } = useAuth();
  const { loading: orgLoading } = useOrg();
  const [currentPage, setCurrentPage] = useState<PageId>('dashboard');

  if (authLoading || (user && orgLoading)) return <FullPageSpinner />;
  if (!user) return <AuthPage />;

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
  // Página pública independente dos providers de autenticação e organização.
  const path=window.location.pathname.replace(/\/$/, '');
  if (path === '/ordem-do-dia' || path === '/odd') {
    return <OrderOfDayPage />;
  }
  if (path === '/relatorio-tecnico') {
    return <TechnicalReportPage />;
  }
  return (
    <AuthProvider>
      <OrgProvider>
        <AppContent />
        <ToastContainer />
      </OrgProvider>
    </AuthProvider>
  );
}
