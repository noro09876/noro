import { useCallback, useEffect, useState } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router';
import { get, handleUnauthorized, post, setCsrf } from './api';
import { Icon, Loading, tz } from './ui';
import { Login } from './pages/Login';
import { Dashboard } from './pages/Dashboard';
import { Accounts } from './pages/Accounts';
import { ContentList } from './pages/ContentList';
import { ContentEditor } from './pages/ContentEditor';
import { Calendar } from './pages/Calendar';
import { AgentPage } from './pages/Agent';
import { Analytics } from './pages/Analytics';
import { SettingsPage } from './pages/Settings';
import { Journal } from './pages/Journal';

interface AuthState { setupRequired: boolean; setupNeedsToken: boolean; authenticated: boolean; username: string | null; csrf: string | null }

const NAV = [
  { to: '/', label: 'Главная', icon: 'home', end: true },
  { to: '/accounts', label: 'Аккаунты', icon: 'users' },
  { to: '/content', label: 'Контент', icon: 'layers' },
  { to: '/calendar', label: 'Календарь', icon: 'calendar' },
  { to: '/agent', label: 'ИИ-агент', icon: 'bot' },
  { to: '/analytics', label: 'Аналитика', icon: 'chart' },
  { to: '/journal', label: 'Журнал', icon: 'log' },
  { to: '/settings', label: 'Настройки', icon: 'settings' },
];

const TITLES: Record<string, string> = Object.fromEntries(NAV.map((n) => [n.to, n.label]));

export function App() {
  const [auth, setAuth] = useState<AuthState | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [agentOn, setAgentOn] = useState<boolean | null>(null);
  const location = useLocation();

  const refresh = useCallback(async () => {
    const a = await get<AuthState>('/api/auth/state');
    setCsrf(a.csrf);
    setAuth(a);
    if (a.authenticated) {
      const s = await get<{ settings: { schedule: { timezone: string }; agent: { enabled: boolean } } }>('/api/settings');
      tz.current = s.settings.schedule.timezone;
      setAgentOn(s.settings.agent.enabled);
    }
  }, []);

  useEffect(() => {
    handleUnauthorized(() => void refresh());
    void refresh().catch(() => setAuth({ setupRequired: false, setupNeedsToken: false, authenticated: false, username: null, csrf: null }));
  }, [refresh]);

  useEffect(() => setMenuOpen(false), [location.pathname]);

  if (!auth) return <div className="auth-wrap"><Loading /></div>;
  if (!auth.authenticated) return <Login setup={auth.setupRequired} needsToken={auth.setupNeedsToken} onDone={refresh} />;

  const section = '/' + (location.pathname.split('/')[1] ?? '');
  const title = TITLES[section] ?? 'NORO';

  return (
    <div className="shell">
      <aside className={`sidebar${menuOpen ? ' open' : ''}`}>
        <NavLink to="/" className="brand">
          <svg className="brand-mark" viewBox="0 0 32 32" aria-hidden="true"><rect x="0.75" y="0.75" width="30.5" height="30.5" rx="8" fill="#131517" stroke="#3a4045" strokeWidth="1.5" /><path d="M9 23V9l14 14V9" fill="none" stroke="#c9f45f" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" /><circle cx="9" cy="9" r="2.6" fill="#eef0ee" /><circle cx="23" cy="23" r="2.6" fill="#eef0ee" /></svg>
          <span><span className="brand-name">NORO</span><span className="brand-sub">Social AI</span></span>
        </NavLink>
        <nav className="nav" aria-label="Разделы">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end}>
              <Icon name={n.icon} />
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-foot">
          <div className="agent-pill"><span className={`dot ${agentOn ? 'on' : 'off'}`} /> Агент {agentOn ? 'работает' : 'выключен'}</div>
          <div className="row">
            <span className="muted ellipsis" style={{ flex: 1 }}>{auth.username}</span>
            <button className="btn btn-ghost btn-sm btn-icon" title="Выйти" aria-label="Выйти" onClick={async () => { await post('/api/auth/logout'); await refresh(); }}><Icon name="logout" /></button>
          </div>
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <button className="btn btn-ghost btn-icon menu-btn" aria-label="Меню" onClick={() => setMenuOpen((v) => !v)}><Icon name="menu" /></button>
          <h1>{title}</h1>
          <div className="spacer" />
        </header>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/accounts" element={<Accounts />} />
          <Route path="/content" element={<ContentList />} />
          <Route path="/content/:id" element={<ContentEditor />} />
          <Route path="/calendar" element={<Calendar />} />
          <Route path="/agent" element={<AgentPage onAgentChange={setAgentOn} />} />
          <Route path="/analytics" element={<Analytics />} />
          <Route path="/journal" element={<Journal />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
    </div>
  );
}
