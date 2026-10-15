// API local do Converso, sem dependencia do Supabase.
// Durante o desenvolvimento, o token fica apenas na sessao desta aba.
const API_BASE = (import.meta.env.VITE_API_URL || 'http://127.0.0.1:4000').replace(/\/$/, '');
const TOKEN_KEY = 'converso_local_session';
const ORG_KEY = 'converso_local_org_id';
export const getSelectedOrg = () => sessionStorage.getItem(ORG_KEY);
export const selectOrg = (orgId: string) => sessionStorage.setItem(ORG_KEY, orgId);

export function getToken(): string | null {
  return sessionStorage.getItem(TOKEN_KEY);
}
export function setToken(token: string): void {
  sessionStorage.setItem(TOKEN_KEY, token);
}
export function clearToken(): void {
  sessionStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(ORG_KEY);
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function apiRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set('Accept', 'application/json');
  if (options.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const token = getToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const orgId = getSelectedOrg();
  if (orgId) headers.set('x-org-id', orgId);

  let response: Response;
  try {
    response = await fetch(`${API_BASE}/api${path}`, { ...options, headers });
  } catch {
    throw new ApiError(0, 'Nao foi possivel acessar a API local. Confira se o servidor esta rodando na porta 4000.');
  }

  const body = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) {
    throw new ApiError(response.status, typeof body?.error === 'string' ? body.error : `Falha ao acessar a API (HTTP ${response.status}).`);
  }
  return body as T;
}

export interface AuthMeResponse {
  user: { id: string; email: string; is_active?: boolean };
  profile: {
    id: string; user_id: string; full_name: string; avatar_url: string | null;
    phone: string | null; created_at: string; updated_at: string;
  } | null;
  organizations: Array<{ id: string; name: string; slug: string; plan: string; status: string; role: 'owner' | 'admin' | 'agent' }>;
}
