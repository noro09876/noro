import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { PLATFORMS, type PlatformId } from '../../../shared/platforms';
import { POST_STATUS_LABEL, SOURCE_LABEL, type PostStatus, type VersionSource } from '../../../shared/types';
import { Icon, type IconName } from './icons';

/* ---------------- Buttons ---------------- */

type BtnProps = React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' | 'danger'; size?: 'sm' | 'xs'; icon?: IconName; loading?: boolean };

export function Button({ variant, size, icon, loading, children, className = '', disabled, ...rest }: BtnProps) {
  return (
    <button className={`btn ${variant ?? ''} ${size ?? ''} ${!children ? 'icon' : ''} ${className}`} disabled={disabled || loading} {...rest}>
      {loading ? <span className="spinner" style={{ width: 14, height: 14 }} /> : icon ? <Icon name={icon} /> : null}
      {children}
    </button>
  );
}

/* ---------------- Badges ---------------- */

export function Badge({ tone, children, dot, running, title }: { tone?: 'ok' | 'info' | 'warn' | 'err' | 'demo' | 'test'; children: ReactNode; dot?: boolean; running?: boolean; title?: string }) {
  return (
    <span className={`badge ${tone ?? ''} ${running ? 'running' : ''}`} title={title}>
      {dot && <span className="dot" />}
      {children}
    </span>
  );
}

const ITEM_STATUS: Record<string, { label: string; tone?: 'ok' | 'info' | 'warn' | 'err' }> = {
  draft: { label: 'Черновик' },
  generating: { label: 'Создаётся', tone: 'info' },
  ready: { label: 'Готов к проверке', tone: 'info' },
  in_review: { label: 'На согласовании', tone: 'warn' },
  approved: { label: 'Согласован', tone: 'ok' },
  rejected: { label: 'Отклонён', tone: 'err' },
  failed: { label: 'Ошибка', tone: 'err' },
};

export function ItemStatus({ status }: { status: string }) {
  const s = ITEM_STATUS[status] ?? { label: status };
  return (
    <Badge tone={s.tone} dot running={status === 'generating'}>
      {s.label}
    </Badge>
  );
}

const POST_TONE: Record<PostStatus, 'ok' | 'info' | 'warn' | 'err' | undefined> = {
  draft: undefined,
  ready: 'info',
  scheduled: 'info',
  publishing: 'info',
  published: 'ok',
  failed: 'err',
  manual_pending: 'warn',
  manual_done: 'ok',
  cancelled: undefined,
};

export function PostStatusBadge({ status, testMode }: { status: PostStatus; testMode?: boolean }) {
  return (
    <span className="row tight">
      <Badge tone={POST_TONE[status]} dot running={status === 'publishing'}>
        {POST_STATUS_LABEL[status]}
      </Badge>
      {testMode && status === 'published' && <Badge tone="test">ТЕСТ</Badge>}
    </span>
  );
}

/** Where a version came from. Test and demo outputs are always visibly marked. */
export function SourceBadge({ source, model }: { source: VersionSource; model?: string | null }) {
  const tone = source === 'test' ? 'test' : source === 'demo' ? 'demo' : source === 'ai' ? 'info' : undefined;
  return (
    <Badge tone={tone} title={model ?? undefined}>
      {source === 'test' ? 'ТЕСТ · не ИИ' : source === 'demo' ? 'ДЕМО' : SOURCE_LABEL[source]}
      {source === 'ai' && model ? <span className="mono tiny dim">{model}</span> : null}
    </Badge>
  );
}

export function PlatformChip({ id, label = true }: { id: PlatformId; label?: boolean }) {
  const p = PLATFORMS[id];
  if (!p) return <span className="chip">{id}</span>;
  return (
    <span className="chip" title={p.name}>
      <i style={{ background: `hsl(${p.hue} 70% 68%)` }}>{p.short}</i>
      {label && p.name}
    </span>
  );
}

export const MODE_BADGE: Record<string, { label: string; tone: 'ok' | 'warn' | 'demo' }> = {
  api: { label: 'Автопубликация по API', tone: 'ok' },
  api_review: { label: 'API после одобрения площадки', tone: 'warn' },
  manual: { label: 'Только вручную: нет API', tone: 'demo' },
};

/* ---------------- Forms ---------------- */

export function Field({ label, hint, children, error }: { label: ReactNode; hint?: ReactNode; children: ReactNode; error?: string }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {error ? <span className="hint" style={{ color: 'var(--red)' }}>{error}</span> : hint ? <span className="hint">{hint}</span> : null}
    </label>
  );
}

export function TextArea({ value, onChange, max, rows = 4, ...rest }: { value: string; onChange: (v: string) => void; max?: number; rows?: number } & Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, 'onChange' | 'value'>) {
  const n = [...(value ?? '')].length;
  return (
    <div className="col" style={{ gap: 4 }}>
      <textarea className={`textarea ${max && n > max ? 'err' : ''}`} rows={rows} value={value} onChange={(e) => onChange(e.target.value)} {...rest} />
      {max ? <div className={`counter ${n > max ? 'over' : ''}`}>{n} / {max}</div> : null}
    </div>
  );
}

export function Toggles<T extends string>({ options, value, onChange, render }: { options: readonly T[]; value: T[]; onChange: (v: T[]) => void; render?: (v: T) => ReactNode }) {
  return (
    <div className="toggle-group">
      {options.map((o) => {
        const on = value.includes(o);
        return (
          <button type="button" key={o} className={`toggle ${on ? 'on' : ''}`} onClick={() => onChange(on ? value.filter((x) => x !== o) : [...value, o])} aria-pressed={on}>
            {render ? render(o) : o}
          </button>
        );
      })}
    </div>
  );
}

export function Seg<T extends string>({ options, value, onChange }: { options: { value: T; label: ReactNode }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="seg" role="tablist">
      {options.map((o) => (
        <button type="button" key={o.value} className={o.value === value ? 'on' : ''} onClick={() => onChange(o.value)} role="tab" aria-selected={o.value === value}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { value: T; label: ReactNode }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button key={t.value} className={t.value === value ? 'on' : ''} onClick={() => onChange(t.value)} role="tab" aria-selected={t.value === value}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

/* ---------------- Feedback ---------------- */

export function Spinner() {
  return <span className="spinner" role="status" aria-label="Загрузка" />;
}

export function Loading() {
  return (
    <div className="center">
      <Spinner />
    </div>
  );
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      {children && <p className="small" style={{ maxWidth: 520 }}>{children}</p>}
      {action}
    </div>
  );
}

export function Notice({ tone = 'info', children, icon }: { tone?: 'info' | 'warn' | 'err' | 'ok'; children: ReactNode; icon?: IconName }) {
  return (
    <div className={`notice ${tone}`}>
      <Icon name={icon ?? (tone === 'err' || tone === 'warn' ? 'alert' : tone === 'ok' ? 'check' : 'info')} />
      <div style={{ minWidth: 0 }}>{children}</div>
    </div>
  );
}

export function ErrorBox({ error }: { error: unknown }) {
  if (!error) return null;
  return <Notice tone="err">{(error as Error).message ?? String(error)}</Notice>;
}

/* ---------------- Overlays ---------------- */

export function Modal({ open, onClose, title, children, wide, footer }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; wide?: boolean; footer?: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`card modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true">
        <div className="card-head">
          <h2>{title}</h2>
          <Button variant="ghost" size="sm" icon="x" onClick={onClose} aria-label="Закрыть" />
        </div>
        <div className="card-body">{children}</div>
        {footer && <div className="card-body row" style={{ justifyContent: 'flex-end', borderTop: '1px solid var(--line)' }}>{footer}</div>}
      </div>
    </div>
  );
}

export function Drawer({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-modal="true">
        <div className="card-head" style={{ position: 'sticky', top: 0, background: 'var(--panel)', zIndex: 2 }}>
          <h2 className="ellipsis">{title}</h2>
          <Button variant="ghost" size="sm" icon="x" onClick={onClose} aria-label="Закрыть" />
        </div>
        <div className="card-body">{children}</div>
      </aside>
    </>
  );
}

export function Lightbox({ src, onClose, alt }: { src: string | null; onClose: () => void; alt?: string }) {
  useEffect(() => {
    if (!src) return;
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [src, onClose]);
  if (!src) return null;
  return (
    <div className="overlay" onClick={onClose}>
      <div className="lightbox col" onClick={(e) => e.stopPropagation()}>
        <img src={src} alt={alt ?? ''} />
        <div className="row" style={{ justifyContent: 'center' }}>
          <a className="btn sm" href={`${src}?download=1`}>
            <Icon name="download" /> Скачать оригинал
          </a>
          <Button size="sm" onClick={onClose}>Закрыть</Button>
        </div>
      </div>
    </div>
  );
}

/* ---------------- Toasts ---------------- */

interface Toast {
  id: number;
  tone: 'ok' | 'err' | 'info';
  text: string;
}
const ToastCtx = createContext<(tone: Toast['tone'], text: string) => void>(() => undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [list, setList] = useState<Toast[]>([]);
  const push = useCallback((tone: Toast['tone'], text: string) => {
    const id = Math.random();
    setList((l) => [...l.slice(-3), { id, tone, text }]);
    setTimeout(() => setList((l) => l.filter((t) => t.id !== id)), tone === 'err' ? 9000 : 4500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" aria-live="polite">
        {list.map((t) => (
          <div key={t.id} className={`toast ${t.tone}`}>
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast() {
  const push = useContext(ToastCtx);
  return { ok: (t: string) => push('ok', t), err: (e: unknown) => push('err', (e as Error)?.message ?? String(e)), info: (t: string) => push('info', t) };
}

/* ---------------- Formatting ---------------- */

export function fmtDate(d: string | Date | null | undefined, tz?: string, withTime = true) {
  if (!d) return '—';
  return new Intl.DateTimeFormat('ru-RU', { timeZone: tz, day: 'numeric', month: 'short', year: undefined, ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}) }).format(new Date(d));
}

export function fmtRelative(d: string | Date | null | undefined) {
  if (!d) return '—';
  const diff = (new Date(d).getTime() - Date.now()) / 1000;
  const rtf = new Intl.RelativeTimeFormat('ru', { numeric: 'auto' });
  const abs = Math.abs(diff);
  if (abs < 60) return rtf.format(Math.round(diff), 'second');
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
  return rtf.format(Math.round(diff / 86400), 'day');
}

export function fmtBytes(n: number) {
  if (n < 1024) return `${n} Б`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} КБ`;
  return `${(n / 1024 ** 2).toFixed(1)} МБ`;
}

export function fmtDuration(ms: number | null | undefined) {
  if (!ms) return '—';
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
