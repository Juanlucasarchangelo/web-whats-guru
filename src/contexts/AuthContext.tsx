import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { apiRequest, ApiError, clearToken, getToken, setToken, type AuthMeResponse } from '@/lib/api';
import type { UserProfile } from '@/types';

interface LocalUser { id: string; email: string; global_role?: string; must_change_password?: boolean; user_metadata?: { full_name?: string } }
interface LocalSession { access_token: string }
interface AuthContextValue {
  session: LocalSession | null;
  user: LocalUser | null;
  profile: UserProfile | null;
  loading: boolean;
  signUp: (email: string, password: string, fullName: string, region: string) => Promise<{ error: string | null; pending?: boolean }>;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}
const AuthContext = createContext<AuthContextValue | undefined>(undefined);

interface AuthResult { token: string; user: { id: string; email: string } }

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<LocalSession | null>(null);
  const [user, setUser] = useState<LocalUser | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  async function hydrate(): Promise<void> {
    const details = await apiRequest<AuthMeResponse>('/auth/me');
    setUser({ ...details.user, user_metadata: { full_name: details.profile?.full_name ?? '' } });
    setProfile(details.profile);
    const token = getToken();
    setSession(token ? { access_token: token } : null);
  }

  useEffect(() => {
    let mounted = true;
    if (!getToken()) {
      setLoading(false);
      return;
    }
    apiRequest<AuthMeResponse>('/auth/me')
      .then((details) => {
        if (!mounted) return;
        setUser({ ...details.user, user_metadata: { full_name: details.profile?.full_name ?? '' } });
        setProfile(details.profile);
        const token = getToken();
        setSession(token ? { access_token: token } : null);
      })
      .catch(() => {
        if (!mounted) return;
        clearToken();
        setUser(null);
        setProfile(null);
        setSession(null);
      })
      .finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, []);

  // Outros dispositivos permanecem sem acesso assim que o DEV revoga a versao do JWT.
  // Verificacao periodica serve apenas para retirar a interface antiga de quem esta ocioso.
  useEffect(() => {
    const endSession=() => { clearToken();setUser(null);setProfile(null);setSession(null); };
    window.addEventListener('falacomigo:session-ended',endSession);
    const refreshId=window.setInterval(() => {
      if (!getToken()) return;
      void apiRequest('/auth/me').catch(() => { /* 401 e tratado por apiRequest */ });
    },45000);
    return () => {window.removeEventListener('falacomigo:session-ended',endSession);window.clearInterval(refreshId);};
  },[]);

  async function finishAuth(result: AuthResult): Promise<void> {
    setToken(result.token);
    try {
      await hydrate();
    } catch (err) {
      clearToken();
      setSession(null);
      setUser(null);
      setProfile(null);
      throw err;
    }
  }

  async function signUp(email: string, password: string, fullName: string, region: string) {
    try {
      const result = await apiRequest<AuthResult & { pending?: boolean }>('/auth/register', {
        method: 'POST', body: JSON.stringify({ email, password, fullName, org_id: region }),
      });
      if ('pending' in result && result.pending === true) return { error: null, pending: true };
      await finishAuth(result);
      return { error: null };
    } catch (err) {
      return { error: formatError(err) };
    }
  }

  async function signIn(email: string, password: string) {
    try {
      const result = await apiRequest<AuthResult>('/auth/login', {
        method: 'POST', body: JSON.stringify({ email, password }),
      });
      await finishAuth(result);
      return { error: null };
    } catch (err) {
      return { error: formatError(err) };
    }
  }

  async function signOut() {
    if (getToken()) await apiRequest('/auth/logout',{method:'POST'}).catch(()=>{});
    clearToken();
    setSession(null);
    setUser(null);
    setProfile(null);
  }

  async function refreshProfile() {
    if (getToken()) await hydrate();
  }

  return (
    <AuthContext.Provider value={{ session, user, profile, loading, signUp, signIn, signOut, refreshProfile }}>
      {children}
    </AuthContext.Provider>
  );
}

function formatError(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return 'Nao foi possivel concluir a operacao.';
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth deve ser usado dentro de AuthProvider');
  return context;
}
