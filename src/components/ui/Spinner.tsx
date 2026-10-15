interface SpinnerProps {
  size?: number;
  className?: string;
}

export function Spinner({ size = 20, className = '' }: SpinnerProps) {
  return (
    <div
      className={`inline-block animate-spin rounded-full border-2 border-slate-200 border-t-blue-600 ${className}`}
      style={{ width: size, height: size }}
    />
  );
}

export function FullPageSpinner() {
  return (
    <div className="flex h-screen items-center justify-center bg-slate-50">
      <Spinner size={40} />
    </div>
  );
}
