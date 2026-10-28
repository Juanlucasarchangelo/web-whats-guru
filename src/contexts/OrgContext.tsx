import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { apiRequest, getSelectedOrg, selectOrg, type AuthMeResponse } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import type { Organization, OrgMember } from '@/types';

interface OrgContextValue {
  currentOrg: Organization | null;
  currentMembership: OrgMember | null;
  permissions: string[];
  roleName: string;
  can: (permission: string) => boolean;
  loading: boolean;
  refresh: () => Promise<void>;
  organizations: Array<{ id:string; name:string; role:string }> ;
  switchOrganization: (id:string) => void;
}
const OrgContext = createContext<OrgContextValue | undefined>(undefined);

export function OrgProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [currentOrg, setCurrentOrg] = useState<Organization | null>(null);
  const [currentMembership, setCurrentMembership] = useState<OrgMember | null>(null);
  const [loading, setLoading] = useState(false);
  const [permissions, setPermissions] = useState<string[]>([]);
  const [roleName, setRoleName] = useState('');
  const [organizations, setOrganizations] = useState<Array<{ id:string; name:string; role:string }>>([]);

  const refresh = useCallback(async () => {
    if (!user) {
      setCurrentOrg(null);
      setCurrentMembership(null);
      setPermissions([]);
      setRoleName('');
      setOrganizations([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const result = await apiRequest<AuthMeResponse>('/auth/me');
      setOrganizations(result.organizations);
      const org = result.organizations.find(o => o.id === getSelectedOrg()) || result.organizations[0];
      if (!org) {
        setCurrentOrg(null);
        setCurrentMembership(null);
        setPermissions([]);
        setRoleName('');
        return;
      }
      selectOrg(org.id);
      setCurrentOrg({
        id: org.id, name: org.name, slug: org.slug, plan: org.plan,
        status: org.status, owner_id: org.role === 'master' ? user.id : '',
        settings: {}, created_at: '', updated_at: '',
      });
      const access = await apiRequest<{role:string;role_name:string;permissions:string[]}>('/access/me');
      setPermissions(access.permissions);
      setRoleName(access.role_name);
      setCurrentMembership({
        id: '', org_id: org.id, user_id: user.id,
        role: access.role, status: 'active', created_at: '',
      });
    } catch (error) {
      console.error('Erro ao consultar organizacao local:', error);
      setCurrentOrg(null);
      setCurrentMembership(null);
      setPermissions([]);
      setRoleName('');
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => { void refresh(); }, [refresh]);
  return (
    <OrgContext.Provider value={{ currentOrg, currentMembership, permissions, roleName, can:(permission:string)=>permissions.includes(permission), loading, refresh, organizations, switchOrganization: (id:string) => { selectOrg(id); void refresh(); } }}>
      {children}
    </OrgContext.Provider>
  );
}
export function useOrg() {
  const context = useContext(OrgContext);
  if (!context) throw new Error('useOrg deve ser usado dentro de OrgProvider');
  return context;
}
