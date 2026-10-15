import { useEffect, useState, useCallback } from 'react';
import { CheckCircle2, XCircle, AlertCircle, Info, X } from 'lucide-react';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

interface Toast {
  id: string;
  type: ToastType;
  message: string;
}

let toastId = 0;
const listeners: ((toast: Toast) => void)[] = [];

export function toast(type: ToastType, message: string) {
  const t: Toast = { id: `toast-${++toastId}`, type, message };
  listeners.forEach((l) => l(t));
}

export const toastSuccess = (msg: string) => toast('success', msg);
export const toastError = (msg: string) => toast('error', msg);
export const toastWarning = (msg: string) => toast('warning', msg);
export const toastInfo = (msg: string) => toast('info', msg);

export function ToastContainer() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const remove = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  useEffect(() => {
    const listener = (t: Toast) => {
      setToasts((prev) => [...prev, t]);
      setTimeout(() => remove(t.id), 4000);
    };
    listeners.push(listener);
    return () => {
      const idx = listeners.indexOf(listener);
      if (idx >= 0) listeners.splice(idx, 1);
    };
  }, [remove]);

  const icons = {
    success: <CheckCircle2 size={20} className="text-green-600" />,
    error: <XCircle size={20} className="text-red-600" />,
    warning: <AlertCircle size={20} className="text-yellow-600" />,
    info: <Info size={20} className="text-blue-600" />,
  };

  const bgColors = {
    success: 'bg-white ring-green-200',
    error: 'bg-white ring-red-200',
    warning: 'bg-white ring-yellow-200',
    info: 'bg-white ring-blue-200',
  };

  return (
    <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 max-w-sm">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`flex items-start gap-3 rounded-lg shadow-lg ring-1 px-4 py-3 ${bgColors[t.type]} animate-in slide-in-from-bottom-2`}
        >
          {icons[t.type]}
          <p className="text-sm text-slate-700 flex-1">{t.message}</p>
          <button onClick={() => remove(t.id)} className="text-slate-400 hover:text-slate-600">
            <X size={16} />
          </button>
        </div>
      ))}
    </div>
  );
}
