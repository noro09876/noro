import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { Icon } from './Icon';

type ToastKind = 'success' | 'error' | 'info';

interface ToastItem {
  id: number;
  kind: ToastKind;
  message: ReactNode;
  action?: { label: string; onClick: () => void };
}

interface ToastApi {
  show: (kind: ToastKind, message: ReactNode, opts?: { action?: ToastItem['action']; duration?: number }) => void;
  success: (message: ReactNode, opts?: { action?: ToastItem['action']; duration?: number }) => void;
  error: (message: ReactNode) => void;
  info: (message: ReactNode) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => setItems((list) => list.filter((t) => t.id !== id)), []);

  const show = useCallback<ToastApi['show']>(
    (kind, message, opts) => {
      const id = nextId.current++;
      setItems((list) => [...list.slice(-3), { id, kind, message, action: opts?.action }]);
      const duration = opts?.duration ?? (opts?.action ? 8000 : kind === 'error' ? 7000 : 4000);
      window.setTimeout(() => dismiss(id), duration);
    },
    [dismiss],
  );

  const api = useMemo<ToastApi>(
    () => ({
      show,
      success: (m, o) => show('success', m, o),
      error: (m) => show('error', m),
      info: (m) => show('info', m),
    }),
    [show],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toasts" role="region" aria-label="Уведомления">
        <div aria-live="polite" style={{ display: 'grid', gap: 8 }}>
          {items.map((t) => (
            <div key={t.id} className={`toast toast--${t.kind}`} role={t.kind === 'error' ? 'alert' : 'status'}>
              <Icon className="toast__icon" name={t.kind === 'success' ? 'checkCircle' : t.kind === 'error' ? 'alertCircle' : 'info'} />
              <div className="toast__body">{t.message}</div>
              {t.action ? (
                <button
                  type="button"
                  className="btn btn--sm btn--outline toast__action"
                  onClick={() => {
                    t.action!.onClick();
                    dismiss(t.id);
                  }}
                >
                  {t.action.label}
                </button>
              ) : null}
              <button type="button" className="btn btn--ghost btn--icon btn--sm" style={{ width: 28, minHeight: 28 }} onClick={() => dismiss(t.id)} aria-label="Закрыть уведомление">
                <Icon name="x" size={14} />
              </button>
            </div>
          ))}
        </div>
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside ToastProvider');
  return ctx;
}
