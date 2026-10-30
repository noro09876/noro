import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { AccountStatus, ContentStatus, Format, Platform, PubStatus } from './types';

// ---------- icons (stroke icons drawn for this app) ----------
const PATHS: Record<string, string> = {
  home: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z',
  users: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75',
  layers: 'M12 2 2 7l10 5 10-5zM2 17l10 5 10-5M2 12l10 5 10-5',
  calendar: 'M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z',
  bot: 'M12 8V4H8M4 12h16v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2zM2 14h2M20 14h2M9 16v1M15 16v1M6 8h12a2 2 0 0 1 2 2v2H4v-2a2 2 0 0 1 2-2z',
  chart: 'M3 3v18h18M7 15l4-4 3 3 5-6',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z',
  log: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  plus: 'M12 5v14M5 12h14',
  check: 'M20 6 9 17l-5-5',
  x: 'M18 6 6 18M6 6l12 12',
  alert: 'M12 9v4M12 17h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z',
  info: 'M12 16v-4M12 8h.01M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z',
  refresh: 'M21 12a9 9 0 1 1-2.64-6.36L21 8M21 3v5h-5',
  send: 'm22 2-7 20-4-9-9-4zM22 2 11 13',
  trash: 'M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6',
  archive: 'M21 8v13H3V8M1 3h22v5H1zM10 12h4',
  edit: 'M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z',
  sparkle: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 17l.8 2.2L22 20l-2.2.8L19 23l-.8-2.2L16 20l2.2-.8z',
  chevronL: 'm15 18-6-6 6-6',
  chevronR: 'm9 18 6-6-6-6',
  download: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3',
  play: 'M6 4l14 8-14 8z',
  pause: 'M6 4h4v16H6zM14 4h4v16h-4z',
  clock: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 6v6l4 2',
  link: 'M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71',
  menu: 'M3 6h18M3 12h18M3 18h18',
  shield: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z',
  copy: 'M20 9h-9a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2v-9a2 2 0 0 0-2-2zM5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1',
  logout: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
  plug: 'M12 22v-5M9 8V2M15 8V2M18 8v5a6 6 0 0 1-12 0V8z',
};

export function Icon({ name, size }: { name: keyof typeof PATHS | string; size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[name] ?? PATHS.info} />
    </svg>
  );
}

const PLATFORM_GLYPH: Record<Platform, ReactNode> = {
  telegram: <path d="M21.5 4.5 2.8 11.7c-.9.4-.9 1.6.1 1.9l4.6 1.5 1.8 5.5c.3.8 1.3 1 1.9.4l2.6-2.4 4.8 3.5c.7.5 1.6.1 1.8-.7l3.2-15.3c.2-1-.8-1.9-1.9-1.6zM9.5 14.8l8.2-6.9" fill="none" stroke="#5fb3e6" strokeWidth="1.7" strokeLinejoin="round" />,
  vk: <text x="12" y="16.5" textAnchor="middle" fontSize="11" fontWeight="700" fill="#6f9ce8" fontFamily="system-ui">VK</text>,
  instagram: <g fill="none" stroke="#e57aa8" strokeWidth="1.8"><rect x="3.5" y="3.5" width="17" height="17" rx="5" /><circle cx="12" cy="12" r="4" /><circle cx="17.3" cy="6.7" r="0.6" fill="#e57aa8" /></g>,
  x: <path d="M4 4l16 16M20 4 4 20" stroke="#e8eaea" strokeWidth="1.9" strokeLinecap="round" />,
};
export const PLATFORM_LABEL: Record<Platform, string> = { telegram: 'Telegram', vk: 'ВКонтакте', instagram: 'Instagram', x: 'X' };

export function PlatformIcon({ platform, small }: { platform: Platform; small?: boolean }) {
  return (
    <span className={`platform${small ? ' sm' : ''}`} title={PLATFORM_LABEL[platform]}>
      <svg viewBox="0 0 24 24" aria-label={PLATFORM_LABEL[platform]}>{PLATFORM_GLYPH[platform]}</svg>
    </span>
  );
}

// ---------- labels ----------
export const FORMAT_LABEL: Record<Format, string> = { carousel: 'Карусель', post: 'Пост', article: 'Статья' };

const CONTENT_STATUS: Record<ContentStatus, [string, string]> = {
  draft: ['Черновик', ''], ready: ['Готов', 'badge-signal'], scheduled: ['Запланирован', 'badge-info'], published: ['Опубликован', 'badge-good'],
  partial: ['Частично', 'badge-warning'], failed: ['Ошибка', 'badge-critical'], archived: ['Архив', ''],
};
const PUB_STATUS: Record<PubStatus, [string, string]> = {
  scheduled: ['Запланирована', 'badge-info'], publishing: ['Публикуется', 'badge-info'], retrying: ['Повтор', 'badge-warning'],
  published: ['Опубликована', 'badge-good'], failed: ['Ошибка', 'badge-critical'], blocked: ['Остановлена', 'badge-critical'],
  needs_check: ['Нужна проверка', 'badge-warning'], cancelled: ['Отменена', ''],
};
const ACCOUNT_STATUS: Record<AccountStatus, [string, string]> = {
  pending: ['Не проверен', ''], connected: ['Подключён', 'badge-good'], needs_auth: ['Нужна авторизация', 'badge-critical'],
  no_permission: ['Нет прав', 'badge-critical'], payment_required: ['Нужна оплата API', 'badge-warning'], error: ['Ошибка', 'badge-critical'], disabled: ['Отключён', ''],
};

export function StatusBadge({ kind, status }: { kind: 'content' | 'pub' | 'account'; status: string }) {
  const map = (kind === 'content' ? CONTENT_STATUS : kind === 'pub' ? PUB_STATUS : ACCOUNT_STATUS) as Record<string, [string, string]>;
  const [label, cls] = map[status] ?? [status, ''];
  return <span className={`badge ${cls}`}>{label}</span>;
}

export const DemoBadge = () => <span className="badge badge-demo" title="Демонстрационные данные, не реальный контент">ДЕМО</span>;

// ---------- formatting ----------
export const tz = { current: 'Europe/Moscow' };

export function fmtDateTime(iso: string | null | undefined, opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('ru-RU', { timeZone: tz.current, ...opts }).format(new Date(iso));
}
export const fmtTime = (iso: string) => fmtDateTime(iso, { hour: '2-digit', minute: '2-digit' });
export function fmtRelative(iso: string | null | undefined) {
  if (!iso) return 'никогда';
  const diff = (Date.now() - Date.parse(iso)) / 1000;
  const abs = Math.abs(diff);
  const r = new Intl.RelativeTimeFormat('ru', { numeric: 'auto' });
  if (abs < 60) return 'только что';
  if (abs < 3600) return r.format(-Math.round(diff / 60), 'minute');
  if (abs < 86400) return r.format(-Math.round(diff / 3600), 'hour');
  return r.format(-Math.round(diff / 86400), 'day');
}
export const fmtNum = (n: number | null | undefined) => (n == null ? '—' : new Intl.NumberFormat('ru-RU').format(n));

/** Wall-clock parts of an ISO instant in the app timezone. */
export function zonedParts(iso: string) {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: tz.current, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(iso));
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? '';
  return { day: `${g('year')}-${g('month')}-${g('day')}`, time: `${g('hour')}:${g('minute')}` };
}

/** Converts a wall-clock day+time in the app timezone to ISO UTC. */
export function zonedToIso(day: string, time: string): string {
  const [y, m, d] = day.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const offset = (ms: number) => {
    const z = zonedParts(new Date(ms).toISOString());
    const [zy, zm, zd] = z.day.split('-').map(Number);
    const [zh, zmin] = z.time.split(':').map(Number);
    return Date.UTC(zy, zm - 1, zd, zh, zmin) - ms;
  };
  const first = guess - offset(guess);
  return new Date(guess - offset(first)).toISOString();
}

// ---------- hooks ----------
export function useLoad<T>(loader: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const ref = useRef(loader);
  ref.current = loader;
  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setData(await ref.current());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return { data, setData, error, loading, reload };
}

// ---------- toast ----------
type ToastKind = 'success' | 'error' | 'info';
interface ToastItem { id: number; kind: ToastKind; text: string }
const ToastCtx = createContext<(kind: ToastKind, text: string) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const push = useCallback((kind: ToastKind, text: string) => {
    const id = Date.now() + Math.random();
    setItems((xs) => [...xs.slice(-3), { id, kind, text }]);
    setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), kind === 'error' ? 8000 : 4000);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>
            <Icon name={t.kind === 'error' ? 'alert' : t.kind === 'success' ? 'check' : 'info'} />
            <span>{t.text}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

// ---------- modal ----------
export function Modal({ title, onClose, children, footer, wide }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>('input, select, textarea, button:not(.modal-close)')?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      prev?.focus();
    };
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal${wide ? ' wide' : ''}`} role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="btn btn-ghost btn-icon modal-close" onClick={onClose} aria-label="Закрыть"><Icon name="x" /></button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function Confirm({ title, text, danger, confirmLabel, onConfirm, onClose }: { title: string; text: string; danger?: boolean; confirmLabel: string; onConfirm: () => void; onClose: () => void }) {
  return (
    <Modal title={title} onClose={onClose} footer={<>
      <button className="btn btn-ghost" onClick={onClose}>Отмена</button>
      <button className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} onClick={() => { onConfirm(); onClose(); }}>{confirmLabel}</button>
    </>}>
      <p className="text-2" style={{ margin: 0 }}>{text}</p>
    </Modal>
  );
}

export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; disabled?: boolean }) {
  return (
    <label className="switch">
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="switch-track" />
      <span>{label}</span>
    </label>
  );
}

export function Empty({ icon = 'layers', title, text, action }: { icon?: string; title: string; text?: string; action?: ReactNode }) {
  return (
    <div className="empty">
      <Icon name={icon} size={28} />
      <h3>{title}</h3>
      {text && <p>{text}</p>}
      {action}
    </div>
  );
}

export function Alert({ kind = 'info', children }: { kind?: 'info' | 'warning' | 'critical' | 'good'; children: ReactNode }) {
  return (
    <div className={`alert alert-${kind}`} role={kind === 'critical' ? 'alert' : undefined}>
      <Icon name={kind === 'good' ? 'check' : kind === 'info' ? 'info' : 'alert'} />
      <div>{children}</div>
    </div>
  );
}

export function Loading() {
  return <div className="row" style={{ padding: 24 }}><span className="spinner" /> <span className="muted">Загрузка…</span></div>;
}

export function ErrorBox({ error, retry }: { error: string; retry?: () => void }) {
  return <Alert kind="critical">{error} {retry && <button className="btn btn-sm" onClick={retry}>Повторить</button>}</Alert>;
}
