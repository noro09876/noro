import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { api } from '../api';
import { Icon } from '../components/icons';
import { Badge, Empty, fmtDate, fmtRelative, Loading, Notice, PlatformChip, PostStatusBadge } from '../components/ui';
import { useWs, useWsApi } from '../session';
import type { Account, AuditRow, Brand, Post } from '../types';

interface Dash {
  items: Record<string, number>;
  posts: Record<string, number>;
  upcoming: Post[];
  problems: Post[];
  review: { id: string; title: string; kind: string; campaignId: string }[];
  failedItems: { id: string; title: string; lastError: string | null }[];
  accounts: Account[];
  providers: { kind: string; status: string; label: string }[];
  campaigns: { id: string; title: string; createdAt: string }[];
  journal: AuditRow[];
}

const sum = (o: Record<string, number>, keys?: string[]) => Object.entries(o).filter(([k]) => !keys || keys.includes(k)).reduce((a, [, v]) => a + v, 0);

export function DashboardPage() {
  const { ws, base } = useWs();
  const u = useWsApi();
  const q = useQuery({ queryKey: ['dash', ws.id], queryFn: () => api.get<Dash>(u('/dashboard')), refetchInterval: 15_000 });
  const brands = useQuery({ queryKey: ['brands', ws.id], queryFn: () => api.get<Brand[]>(u('/brands')) });
  if (q.isLoading || !q.data) return <Loading />;
  const d = q.data;
  const llm = d.providers.find((p) => p.kind === 'llm');
  const setup = [
    { done: !!llm, label: 'Подключить языковую модель', hint: llm ? `${llm.label} · ${llm.status === 'ok' ? 'работает' : 'есть ошибка'}` : 'Без ключа можно только редактировать вручную', to: 'settings' },
    { done: (brands.data?.length ?? 0) > 0, label: 'Описать бренд', hint: brands.data?.[0]?.name ?? 'Тон, аудитория, цвета, запреты', to: 'brand' },
    { done: d.accounts.some((a) => a.status === 'connected'), label: 'Подключить соцсеть', hint: `${d.accounts.filter((a) => a.status === 'connected').length} подключено`, to: 'accounts' },
    { done: d.campaigns.length > 0, label: 'Запустить первую кампанию', hint: d.campaigns[0]?.title ?? 'Бриф → стратегия → материалы', to: 'campaigns/new' },
  ];
  const published = (d.posts.published ?? 0) + (d.posts.manual_done ?? 0);

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>Обзор</h1>
          <p>Только фактическое состояние пространства: счётчики считаются из базы, без прогнозов и примерных цифр.</p>
        </div>
        {!ws.isDemo && (
          <Link to={`${base}/campaigns/new`} className="btn primary">
            <Icon name="plus" /> Новая кампания
          </Link>
        )}
      </div>

      {setup.some((s) => !s.done) && !ws.isDemo && (
        <div className="card">
          <div className="card-head">
            <h2>Запуск фабрики</h2>
            <span className="small muted">{setup.filter((s) => s.done).length} из {setup.length}</span>
          </div>
          <div className="grid g4" style={{ padding: 16 }}>
            {setup.map((s, i) => (
              <Link key={s.label} to={`${base}/${s.to}`} className="card card-pad" style={{ background: 'var(--bg-2)', borderColor: s.done ? 'rgba(201,244,95,.3)' : undefined }}>
                <div className="row between">
                  <span className="mono tiny dim">0{i + 1}</span>
                  {s.done ? <Badge tone="ok">готово</Badge> : <Badge>нужно</Badge>}
                </div>
                <div style={{ fontWeight: 600, marginTop: 10 }}>{s.label}</div>
                <div className="small muted ellipsis">{s.hint}</div>
              </Link>
            ))}
          </div>
        </div>
      )}

      <div className="grid g4">
        <div className="card stat">
          <div className="label">Материалов всего</div>
          <div className="value">{sum(d.items)}</div>
          <div className="sub">{d.items.generating ?? 0} создаётся · {d.items.failed ?? 0} с ошибкой</div>
        </div>
        <div className="card stat">
          <div className="label">Ждут согласования</div>
          <div className="value">{d.items.in_review ?? 0}</div>
          <div className="sub">{d.items.approved ?? 0} согласовано</div>
        </div>
        <div className="card stat">
          <div className="label">Запланировано</div>
          <div className="value">{d.posts.scheduled ?? 0}</div>
          <div className="sub">{d.posts.manual_pending ?? 0} ждут ручного размещения</div>
        </div>
        <div className="card stat">
          <div className="label">Опубликовано (подтверждено)</div>
          <div className="value">{published}</div>
          <div className="sub">{d.posts.failed ?? 0} с ошибкой публикации</div>
        </div>
      </div>

      {(d.problems.length > 0 || d.failedItems.length > 0 || d.accounts.some((a) => a.status !== 'connected')) && (
        <div className="card">
          <div className="card-head">
            <h2>Требует внимания</h2>
          </div>
          <div className="card-body">
            <ul className="list">
              {d.accounts.filter((a) => a.status !== 'connected').map((a) => (
                <li key={a.id}>
                  <PlatformChip id={a.platform} label={false} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <b>{a.displayName}</b> — нужно переподключить
                    <div className="small muted">{a.lastError}</div>
                  </div>
                  <Link className="btn sm" to={`${base}/accounts`}>Открыть</Link>
                </li>
              ))}
              {d.problems.map((p) => (
                <li key={p.id}>
                  <PlatformChip id={p.platform} label={false} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="ellipsis">{p.text.slice(0, 80)}</div>
                    <div className="small" style={{ color: 'var(--red)' }}>{p.lastError}</div>
                  </div>
                  <Link className="btn sm" to={`${base}/items/${p.itemId}`}>Разобраться</Link>
                </li>
              ))}
              {d.failedItems.map((i) => (
                <li key={i.id}>
                  <Badge tone="err">материал</Badge>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="ellipsis">{i.title}</div>
                    <div className="small" style={{ color: 'var(--red)' }}>{i.lastError}</div>
                  </div>
                  <Link className="btn sm" to={`${base}/items/${i.id}`}>Открыть</Link>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      <div className="split">
        <div className="card">
          <div className="card-head">
            <h2>Ближайшие 7 дней</h2>
            <Link to={`${base}/calendar`} className="small muted">Календарь →</Link>
          </div>
          {d.upcoming.length ? (
            <div className="table-wrap">
              <table className="table">
                <tbody>
                  {d.upcoming.map((p) => (
                    <tr key={p.id}>
                      <td className="mono small nowrap">{fmtDate(p.scheduledAt, p.timezone)}</td>
                      <td><PlatformChip id={p.platform} /></td>
                      <td className="small" style={{ maxWidth: 280 }}><Link to={`${base}/items/${p.itemId}`} className="ellipsis" style={{ display: 'block' }}>{p.text.slice(0, 90)}</Link></td>
                      <td><PostStatusBadge status={p.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty title="Ничего не запланировано">Согласуйте материалы и поставьте их в календарь.</Empty>
          )}
        </div>
        <div className="card">
          <div className="card-head">
            <h2>Журнал</h2>
            <Link to={`${base}/journal`} className="small muted">Весь журнал →</Link>
          </div>
          <div className="card-body">
            {d.journal.length ? (
              <ul className="list">
                {d.journal.map((j) => (
                  <li key={j.id}>
                    <span className="mono tiny dim nowrap" style={{ flex: "none", minWidth: 96 }}>{fmtRelative(j.createdAt)}</span>
                    <span className="small" style={{ color: j.level === 'error' ? 'var(--red)' : j.level === 'warn' ? 'var(--amber)' : undefined }}>{j.message}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <Empty title="Пока пусто">Здесь появятся все операции: генерации, рендеры, публикации и ошибки.</Empty>
            )}
          </div>
        </div>
      </div>

      {d.review.length > 0 && (
        <div className="card">
          <div className="card-head">
            <h2>На согласовании</h2>
          </div>
          <div className="card-body">
            <ul className="list">
              {d.review.map((r) => (
                <li key={r.id}>
                  <Link to={`${base}/items/${r.id}`} style={{ flex: 1 }}>{r.title}</Link>
                  <Link className="btn sm" to={`${base}/items/${r.id}`}>Проверить</Link>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
      {ws.isDemo && <Notice tone="info">В демо-пространстве счётчики относятся к вымышленной кампании витрины.</Notice>}
    </div>
  );
}
