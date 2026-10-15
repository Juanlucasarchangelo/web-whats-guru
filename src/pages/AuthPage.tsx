import { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { MessageCircle, Mail, Lock, User as UserIcon, Loader2 } from 'lucide-react';

export function AuthPage() {
  const { signIn, signUp } = useAuth();
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    if (mode === 'signup') {
      if (fullName.trim().length < 2) {
        setError('Informe seu nome completo.');
        setLoading(false);
        return;
      }
      if (password.length < 10) {
        setError('A senha deve ter pelo menos 10 caracteres.');
        setLoading(false);
        return;
      }
      const { error: err } = await signUp(email, password, fullName);
      if (err) setError(err);
    } else {
      const { error: err } = await signIn(email, password);
      if (err) setError(err);
    }

    setLoading(false);
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900 p-4">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-blue-600 shadow-lg shadow-blue-600/30 mb-4">
            <MessageCircle className="text-white" size={28} />
          </div>
          <h1 className="text-2xl font-bold text-white">Converso</h1>
          <p className="text-sm text-slate-400 mt-1">Atendimento multicanal, CRM e automação</p>
        </div>

        <div className="card p-8">
          <div className="flex gap-1 mb-6 rounded-lg bg-slate-100 p-1">
            <button
              onClick={() => { setMode('login'); setError(null); }}
              className={`flex-1 rounded-md py-2 text-sm font-medium transition-all ${
                mode === 'login' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              Entrar
            </button>
            <button
              onClick={() => { setMode('signup'); setError(null); }}
              className={`flex-1 rounded-md py-2 text-sm font-medium transition-all ${
                mode === 'signup' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              Criar conta
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === 'signup' && (
              <div>
                <label className="label">Nome completo</label>
                <div className="relative">
                  <UserIcon className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                  <input
                    type="text"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    className="input pl-10"
                    placeholder="Seu nome"
                    required
                  />
                </div>
              </div>
            )}

            <div>
              <label className="label">E-mail</label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="input pl-10"
                  placeholder="voce@empresa.com"
                  required
                />
              </div>
            </div>

            <div>
              <label className="label">Senha</label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="input pl-10"
                  placeholder="Mínimo 10 caracteres"
                  required
                />
              </div>
            </div>

            {error && (
              <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 ring-1 ring-red-200">
                {error}
              </div>
            )}

            <button type="submit" disabled={loading} className="btn-primary w-full">
              {loading ? (
                <><Loader2 size={18} className="animate-spin" /> Aguarde...</>
              ) : mode === 'login' ? (
                'Entrar'
              ) : (
                'Criar conta gratuita'
              )}
            </button>
          </form>

          <p className="mt-4 text-center text-xs text-slate-500">
            Ao se cadastrar, sua empresa será criada automaticamente e você poderá começar a usar a plataforma.
          </p>
        </div>
      </div>
    </div>
  );
}
