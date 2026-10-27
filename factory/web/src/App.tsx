import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Navigate, NavLink, Outlet, Route, Routes, useLocation, useNavigate, useParams } from 'react-router';
import { api } from './api';
import { Icon, NoroMark, type IconName } from './components/icons';
import { Badge, Button, Loading, Notice } from './components/ui';
import { AccountsPage } from './pages/Accounts';
import { AnalyticsPage } from './pages/Analytics';
import { AuthPage } from './pages/Auth';
import { AutomationPage } from './pages/Automation';
import { BrandPage } from './pages/Brand';
import { CalendarPage } from './pages/Calendar';
import { CampaignPage } from './pages/Campaign';
import { CampaignsPage, NewCampaignPage } from './pages/Campaigns';
import { DashboardPage } from './pages/Dashboard';
import { ItemPage } from './pages/Item';
import { JournalPage } from './pages/Journal';
import { MotionPage } from './pages/Motion';
import { SettingsPage } from './pages/Settings';
import { ShowcasePage } from './pages/Showcase';
import { useMe, WsProvider } from './session';
import type { Workspace } from './types';

export function App() {
  const me = useMe();
  if (me.isLoading) return <Loading />;
  const user = me.data?.user;
  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/" replace /> : <AuthPage mode="login" />} />
      <Route path="/signup" element={user ? <Navigate to="/" replace /> : <AuthPage mode="signup" />} />
      {!user ? (
        <Route path="*" element={<Navigate to="/login" replace />} />
      ) : (
        <>
          <Route path="/" element={<HomeRedirect />} />
          <Route path="/accounts" element={<HomeRedirect to="accounts" />} />
          <Route path="/showcase" element={<ShowcaseRedirect />} />
          <Route path="/w/:ws" element={<WsLayout />}>
            <Route index element={<DashboardPage />} />
            <Route path="campaigns" element={<CampaignsPage />} />
            <Route path="campaigns/new" element={<NewCampaignPage />} />
            <Route path="campaigns/:id" element={<CampaignPage />} />
            <Route path="items/:id" element={<ItemPage />} />
            <Route path="brand" element={<BrandPage />} />
            <Route path="motion" element={<MotionPage />} />
            <Route path="calendar" element={<CalendarPage />} />
            <Route path="accounts" element={<AccountsPage />} />
            <Route path="automation" element={<AutomationPage />} />
            <Route path="analytics" element={<AnalyticsPage />} />
            <Route path="journal" element={<JournalPage />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="showcase" element={<ShowcasePage />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </>
      )}
    </Routes>
  );
}

function HomeRedirect({ to = '' }: { to?: string }) {
  const me = useMe();
  const loc = useLocation();
  const own = me.data?.workspaces.find((w) => !w.isDemo) ?? me.data?.workspaces[0];
  if (!own) return <Notice tone="warn">У вас нет рабочих пространств.</Notice>;
  return <Navigate to={`/w/${own.id}${to ? `/${to}` : ''}${loc.search}`} replace />;
}

function ShowcaseRedirect() {
  const me = useMe();
  const demo = me.data?.workspaces.find((w) => w.isDemo);
  if (!demo) return <Navigate to="/" replace />;
  return <Navigate to={`/w/${demo.id}/showcase`} replace />;
}

const NAV: { to: string; label: string; icon: IconName; group?: string }[] = [
  { to: '', label: 'Обзор', icon: 'home' },
  { to: 'campaigns', label: 'Кампании', icon: 'layers', group: 'Производство' },
  { to: 'motion', label: 'Motion Studio', icon: 'film' },
  { to: 'brand', label: 'Brand Studio', icon: 'brand' },
  { to: 'calendar', label: 'Календарь', icon: 'calendar', group: 'Публикация' },
  { to: 'accounts', label: 'Соцсети', icon: 'link' },
  { to: 'automation', label: 'Автоматизация', icon: 'bolt' },
  { to: 'analytics', label: 'Аналитика', icon: 'chart', group: 'Контроль' },
  { to: 'journal', label: 'Журнал операций', icon: 'list' },
  { to: 'settings', label: 'Настройки', icon: 'settings' },
];

function WsLayout() {
  const { ws: wsId } = useParams();
  const me = useMe();
  const nav = useNavigate();
  const qc = useQueryClient();
  const loc = useLocation();
  const [open, setOpen] = useState(false);
  const ws = useQuery({ queryKey: ['ws', wsId], queryFn: () => api.get<Workspace>(`/api/ws/${wsId}`) });
  useEffect(() => setOpen(false), [loc.pathname]);

  if (ws.isLoading) return <Loading />;
  if (ws.error || !ws.data) return <div className="content"><Notice tone="err">{(ws.error as Error)?.message ?? 'Пространство недоступно'}</Notice></div>;
  const w = ws.data;
  const base = `/w/${w.id}`;
  const demo = me.data?.workspaces.find((x) => x.isDemo);

  const logout = async () => {
    await api.post('/api/auth/logout');
    qc.clear();
    nav('/login');
  };

  return (
    <WsProvider ws={w}>
      <div className="shell">
        {open && <div className="scrim" onClick={() => setOpen(false)} />}
        <aside className={`side ${open ? 'open' : ''}`}>
          <div className="logo">
            <div className="logo-mark"><NoroMark /></div>
            <div>
              <b>NORO</b>
              <span>Content Factory</span>
            </div>
          </div>
          <select className="select" value={w.id} onChange={(e) => nav(`/w/${e.target.value}`)} aria-label="Рабочее пространство" style={{ marginBottom: 8 }}>
            {me.data?.workspaces.map((x) => (
              <option key={x.id} value={x.id}>
                {x.isDemo ? '◆ ' : ''}{x.name}
              </option>
            ))}
          </select>
          <nav className="nav">
            {NAV.map((n) => (
              <div key={n.to}>
                {n.group && <div className="nav-group">{n.group}</div>}
                <NavLink to={n.to ? `${base}/${n.to}` : base} end={!n.to}>
                  <Icon name={n.icon} />
                  {n.label}
                </NavLink>
              </div>
            ))}
            <div className="nav-group">Демо</div>
            {demo && (
              <NavLink to={`/w/${demo.id}/showcase`}>
                <Icon name="sparkle" />
                Витрина возможностей
              </NavLink>
            )}
          </nav>
          <div className="side-foot">
            <div className="small ellipsis">{me.data?.user?.name}</div>
            <div className="tiny dim ellipsis">{me.data?.user?.email} · {w.role}</div>
            <Button size="sm" variant="ghost" icon="logout" onClick={logout} style={{ justifyContent: 'flex-start', padding: 0 }}>
              Выйти
            </Button>
          </div>
        </aside>
        <div className="main">
          <header className="topbar">
            <Button className="burger" variant="ghost" icon="menu" onClick={() => setOpen(true)} aria-label="Меню" />
            <div className="crumbs ellipsis">
              <span className="ellipsis">{w.name}</span>
            </div>
            <div className="spacer" />
            {w.isDemo && <Badge tone="demo">Демо · только просмотр</Badge>}
          </header>
          {w.isDemo && (
            <div className="demo-banner">
              <Icon name="info" width={16} />
              <span>
                Это демонстрационное пространство с вымышленным брендом. Данные отделены от ваших и не публикуются. Чтобы работать, переключитесь на своё пространство.
              </span>
            </div>
          )}
          <main className="content">
            <Outlet />
          </main>
        </div>
      </div>
    </WsProvider>
  );
}
