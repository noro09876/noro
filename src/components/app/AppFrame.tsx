import type { ReactNode } from 'react';
import { Icon, type IconName } from '../ui/Icon';
import './app.css';

interface AppFrameProps {
  icon: IconName;
  name: string;
  source?: string;
  actions?: ReactNode;
  nav?: ReactNode;
  children: ReactNode;
  status?: ReactNode;
  id?: string;
  /** When the app shows tabs, the body becomes the matching tabpanel. */
  panel?: { base: string; tabKey: string };
}

/** Window-like frame shared by all six product apps. */
export function AppFrame({ icon, name, source, actions, nav, children, status, id, panel }: AppFrameProps) {
  return (
    <section className="app" id={id} aria-label={`Приложение ${name}`}>
      <div className="app__bar">
        <div className="app__brand">
          <span className="app__logo" aria-hidden>
            <Icon name={icon} size={16} />
          </span>
          <div style={{ minWidth: 0 }}>
            <div className="app__name">NORO {name}</div>
            {source ? <div className="app__source" title={source}>{source}</div> : null}
          </div>
        </div>
        {actions ? <div className="app__actions">{actions}</div> : null}
      </div>
      {nav ? <div className="app__nav">{nav}</div> : null}
      <div
        className="app__body"
        {...(panel ? { role: 'tabpanel', id: `${panel.base}-panel-${panel.tabKey}`, 'aria-labelledby': `${panel.base}-tab-${panel.tabKey}` } : {})}
      >
        {children}
      </div>
      {status ? <div className="app__status">{status}</div> : null}
    </section>
  );
}

export function StorageStatus({ saveError, extra }: { saveError?: string | null; extra?: ReactNode }) {
  return (
    <>
      <span>
        <Icon name="lock" size={12} /> Данные обрабатываются в браузере и не отправляются на сервер
      </span>
      <span>
        <Icon name="database" size={12} /> {saveError ? <span style={{ color: '#ffaaaa' }}>{saveError}</span> : 'Сохраняется в этом браузере'}
      </span>
      {extra}
    </>
  );
}

interface StartPanelProps {
  title: string;
  text: ReactNode;
  steps: string[];
  onDemo: () => void;
  demoBusy?: boolean;
  upload?: ReactNode;
  demoLabel?: string;
  extra?: ReactNode;
}

/** First-run screen: what the tool does, how to start, demo + own data. */
export function StartPanel({ title, text, steps, onDemo, demoBusy, upload, demoLabel = 'Попробовать демо', extra }: StartPanelProps) {
  return (
    <div className="start">
      <div>
        <h3 className="start__title">{title}</h3>
        <p className="muted" style={{ fontSize: 'var(--fs-sm)' }}>
          {text}
        </p>
        <ol className="start__steps list-reset">
          {steps.map((s) => (
            <li key={s} className="start__step">
              <span>{s}</span>
            </li>
          ))}
        </ol>
        <div className="btn-row" style={{ marginTop: 18 }}>
          <button type="button" className="btn btn--primary btn--lg" onClick={onDemo} disabled={demoBusy} data-testid="demo-button">
            {demoBusy ? <span className="spinner" aria-hidden /> : <Icon name="play" />}
            {demoLabel}
          </button>
        </div>
        {extra}
      </div>
      <div>{upload}</div>
    </div>
  );
}
