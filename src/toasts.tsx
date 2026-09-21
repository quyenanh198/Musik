import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useI18n } from './I18nProvider';

export type ToastKind = 'info' | 'error';
export type Notify = (message: string, kind?: ToastKind) => void;

interface Toast {
  id: number;
  message: string;
  kind: ToastKind;
}

const LIFETIME_MS: Record<ToastKind, number> = { info: 3500, error: 7000 };
const MAX_VISIBLE = 4;

const ToastContext = createContext<Notify | null>(null);

/**
 * Stacked, self-dismissing messages. Each toast owns its timer, so a repeated message can no longer close its twin
 * early, and errors are announced as alerts and stay longer than confirmations.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);
  const timers = useRef(new Map<number, number>());

  const dismiss = useCallback((id: number) => {
    window.clearTimeout(timers.current.get(id));
    timers.current.delete(id);
    setToasts((list) => list.filter((toast) => toast.id !== id));
  }, []);

  const notify = useCallback<Notify>(
    (message, kind = 'info') => {
      const id = nextId.current++;
      setToasts((list) => [...list.slice(-(MAX_VISIBLE - 1)), { id, message, kind }]);
      timers.current.set(id, window.setTimeout(() => dismiss(id), LIFETIME_MS[kind]));
    },
    [dismiss],
  );

  useEffect(() => {
    const active = timers.current;
    return () => active.forEach((timer) => window.clearTimeout(timer));
  }, []);

  const value = useMemo(() => notify, [notify]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toasts">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast toast--${toast.kind}`} role={toast.kind === 'error' ? 'alert' : 'status'}>
            <span>{toast.message}</span>
            <button className="toast__close" onClick={() => dismiss(toast.id)} aria-label={t('common.dismiss')}>
              ×
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): Notify {
  const notify = useContext(ToastContext);
  if (!notify) throw new Error('useToast must be used inside ToastProvider');
  return notify;
}
