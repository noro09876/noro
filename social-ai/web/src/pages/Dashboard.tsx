import { Link } from 'react-router';
import { get } from '../api';
import type { AccountStatus, Platform, Publication } from '../types';
import { Alert, DemoBadge, Empty, ErrorBox, fmtDateTime, fmtNum, fmtRelative, Icon, Loading, PlatformIcon, StatusBadge, useLoad } from '../ui';

interface DashboardData {
  agent: { enabled: boolean; paused: string | null; lastCycleAt: string | null; lastRun: { status: string; summary: string | null; error: string | null } | null; provider: string; model: string; generationsLeft: number };
  scheduler: { running: boolean; lastTickAt: string | null; lastTickError: string | null };
  accounts: { id: number; name: string; platform: Platform; status: AccountStatus; remoteName: string | null; lastError: string | null }[];
  content: Record<string, number>;
  publications: Record<string, number>;
  publishedWeek: number;
  upcoming: (Publication & { title: string; accountName: string; platform: Platform; isDemo: boolean })[];
  errors: { id: number; ts: string; scope: string; message: string }[];
  metrics: { views: number | null; likes: number | null; tracked: number };
  demoCount: number;
}

export function Dashboard() {
  const { data, error, loading, reload } = useLoad(() => get<DashboardData>('/api/dashboard'));
  if (loading && !data) return <div className="page"><Loading /></div>;
  if (error || !data) return <div className="page"><ErrorBox error={error ?? 'Нет данных'} retry={reload} /></div>;

  const a = data.agent;
  const agentState = a.paused ? { label: 'Приостановлен', dot: 'err' } : a.enabled ? { label: 'Работает', dot: 'on' } : { label: 'Выключен', dot: 'off' };
  const totalContent = Object.entries(data.content).filter(([k]) => k !== 'archived').reduce((s, [, n]) => s + n, 0);
  const noModel = a.provider === 'offline' || !a.model;

  return (
    <div className="page">
      {a.paused && <Alert kind="critical">Агент приостановлен: {a.paused}. <Link to="/agent">Открыть ИИ-агента</Link></Alert>}
      {noModel && <Alert kind="warning">Языковая модель не подключена — агент создаёт только черновики-заготовки. <Link to="/settings">Подключите Ollama</Link></Alert>}
      {!data.accounts.length && <Alert kind="info">Нет подключённых аккаунтов. <Link to="/accounts">Подключите Telegram или ВКонтакте</Link>, чтобы агент мог публиковать.</Alert>}

      <div className="grid grid-4">
        <div className="card stat">
          <span className="stat-label">ИИ-агент</span>
          <span className="stat-value row" style={{ fontSize: '1.4rem' }}><span className={`dot ${agentState.dot}`} />{agentState.label}</span>
          <span className="stat-note">Цикл: {fmtRelative(a.lastCycleAt)} · генераций сегодня осталось {a.generationsLeft}</span>
        </div>
        <div className="card stat">
          <span className="stat-label">Опубликовано за 7 дней</span>
          <span className="stat-value">{data.publishedWeek}</span>
          <span className="stat-note">Всего публикаций: {data.publications.published ?? 0}</span>
        </div>
        <div className="card stat">
          <span className="stat-label">Материалы</span>
          <span className="stat-value">{totalContent}</span>
          <span className="stat-note">Черновиков {data.content.draft ?? 0} · готово {data.content.ready ?? 0} · в плане {data.content.scheduled ?? 0}</span>
        </div>
        <div className="card stat">
          <span className="stat-label">Просмотры</span>
          <span className="stat-value">{data.metrics.tracked ? fmtNum(data.metrics.views) : '—'}</span>
          <span className="stat-note">{data.metrics.tracked ? `По данным площадок, ${data.metrics.tracked} публ.` : 'Статистики с площадок пока нет'}</span>
        </div>
      </div>

      <div className="grid grid-2">
        <section className="card">
          <div className="card-head"><h2>Ближайшие публикации</h2><div className="spacer" /><Link className="btn btn-ghost btn-sm" to="/calendar">Календарь</Link></div>
          {data.upcoming.length ? (
            <div className="list">
              {data.upcoming.map((p) => (
                <Link key={p.id} to={`/content/${p.contentId}`} className="list-item" style={{ textDecoration: 'none' }}>
                  <PlatformIcon platform={p.platform} />
                  <div className="grow">
                    <div className="ellipsis">{p.title || 'Без названия'} {p.isDemo && <DemoBadge />}</div>
                    <div className="muted" style={{ fontSize: 12 }}>{p.accountName} · {fmtDateTime(p.nextAttemptAt ?? p.scheduledAt)}</div>
                  </div>
                  <StatusBadge kind="pub" status={p.status} />
                </Link>
              ))}
            </div>
          ) : <Empty icon="calendar" title="Ничего не запланировано" text="Подтвердите готовый материал и назначьте время или включите агента." />}
        </section>

        <section className="card">
          <div className="card-head"><h2>Аккаунты</h2><div className="spacer" /><Link className="btn btn-ghost btn-sm" to="/accounts">Управление</Link></div>
          {data.accounts.length ? (
            <div className="list">
              {data.accounts.map((acc) => (
                <div key={acc.id} className="list-item">
                  <PlatformIcon platform={acc.platform} />
                  <div className="grow">
                    <div className="ellipsis">{acc.name}</div>
                    <div className="muted ellipsis" style={{ fontSize: 12 }}>{acc.lastError ?? acc.remoteName ?? '—'}</div>
                  </div>
                  <StatusBadge kind="account" status={acc.status} />
                </div>
              ))}
            </div>
          ) : <Empty icon="users" title="Аккаунты не подключены" action={<Link className="btn btn-primary btn-sm" to="/accounts"><Icon name="plus" />Подключить</Link>} />}
        </section>
      </div>

      <section className="card">
        <div className="card-head"><h2>Последние ошибки</h2><div className="spacer" /><Link className="btn btn-ghost btn-sm" to="/journal">Журнал</Link></div>
        {data.errors.length ? (
          <div>
            {data.errors.map((e) => (
              <div key={e.id} className="log-line">
                <span className="mono muted">{fmtDateTime(e.ts)}</span>
                <span className="mono lvl-error">{e.scope}</span>
                <span className="msg">{e.message}</span>
              </div>
            ))}
          </div>
        ) : <Empty icon="check" title="Ошибок нет" />}
      </section>

      <p className="muted" style={{ margin: 0, fontSize: 12 }}>
        Планировщик: {data.scheduler.running ? 'работает' : 'остановлен'}, последний такт {fmtRelative(data.scheduler.lastTickAt)}.
        {data.demoCount > 0 && ` В базе ${data.demoCount} демонстрационных материалов — они помечены «ДЕМО» и не участвуют в статистике.`}
      </p>
    </div>
  );
}
