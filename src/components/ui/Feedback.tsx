import type { ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

export function EmptyState({ icon = 'inbox', title, text, children }: { icon?: IconName; title: string; text?: ReactNode; children?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty__icon">
        <Icon name={icon} />
      </div>
      <div className="empty__title">{title}</div>
      {text ? <div className="empty__text">{text}</div> : null}
      {children ? <div className="btn-row" style={{ justifyContent: 'center', marginTop: 6 }}>{children}</div> : null}
    </div>
  );
}

type AlertKind = 'info' | 'warning' | 'critical' | 'good';
const ALERT_ICON: Record<AlertKind, IconName> = { info: 'info', warning: 'alert', critical: 'alertCircle', good: 'checkCircle' };

export function Alert({ kind = 'info', title, children, action }: { kind?: AlertKind; title?: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className={`alert alert--${kind}`} role={kind === 'critical' ? 'alert' : undefined}>
      <Icon name={ALERT_ICON[kind]} />
      <div style={{ flex: 1, minWidth: 0 }}>
        {title ? <div className="alert__title">{title}</div> : null}
        {children ? <div className="muted">{children}</div> : null}
      </div>
      {action}
    </div>
  );
}

export function Spinner({ label = 'Загрузка' }: { label?: string }) {
  return <span className="spinner" role="status" aria-label={label} />;
}

export function ProgressBar({ value, label }: { value: number; label: string }) {
  const v = Math.max(0, Math.min(100, value));
  return (
    <div className="progress" role="progressbar" aria-label={label} aria-valuenow={Math.round(v)} aria-valuemin={0} aria-valuemax={100}>
      <div className="progress__bar" style={{ width: `${v}%` }} />
    </div>
  );
}
