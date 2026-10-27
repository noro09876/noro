import { useQuery } from '@tanstack/react-query';
import { api } from '../api';
import { Badge, Empty, fmtDate, Loading, Notice, PlatformChip } from '../components/ui';
import { PLATFORM_IDS, type PlatformId } from '../../../shared/platforms';
import { useWs, useWsApi } from '../session';

interface AnalyticsView {
  posts: { id: string; platform: PlatformId; title: string | null; text: string; externalUrl: string | null; publishedAt: string; status: string; testMode: boolean; isDemo: boolean; metrics: { values: Record<string, number>; unavailable: Record<string, string>; collected_at: string } | null }[];
  perPlatform: Record<string, { posts: number; withData: number; totals: Record<string, number> }>;
  capabilities: Record<PlatformId, string>;
}

const METRIC: Record<string, string> = { views: 'Просмотры', likes: 'Лайки', comments: 'Комментарии', reposts: 'Репосты', shares: 'Поделились', reach: 'Охват', saved: 'Сохранения', replies: 'Ответы', quotes: 'Цитаты', favorites: 'Избранное' };
const nf = new Intl.NumberFormat('ru-RU');

export function AnalyticsPage() {
  const { ws } = useWs();
  const u = useWsApi();
  const q = useQuery({ queryKey: ['analytics', ws.id], queryFn: () => api.get<AnalyticsView>(u('/analytics')) });
  if (q.isLoading || !q.data) return <Loading />;
  const d = q.data;
  const platforms = Object.entries(d.perPlatform);
  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>Аналитика</h1>
          <p>Только цифры, которые вернули API площадок для подтверждённых публикаций за 90 дней. Тестовые и демо-публикации в сумму не входят. Чего площадка не отдаёт — показано как «недоступно» с причиной.</p>
        </div>
      </div>
      {platforms.length === 0 ? (
        <div className="card"><Empty title="Данных пока нет">Метрики появятся после первых публикаций через API. Сбор — раз в 6 часов.</Empty></div>
      ) : (
        <div className="grid auto-fill">
          {platforms.map(([p, agg]) => (
            <div key={p} className="card card-pad stack">
              <div className="row between"><PlatformChip id={p as PlatformId} /><span className="small muted">{agg.withData} из {agg.posts} с данными</span></div>
              {Object.keys(agg.totals).length ? (
                <div className="grid g2">
                  {Object.entries(agg.totals).map(([k, v]) => (
                    <div key={k}><div className="tiny muted">{METRIC[k] ?? k}</div><div style={{ fontFamily: 'var(--display)', fontSize: 22, fontWeight: 600 }}>{nf.format(v)}</div></div>
                  ))}
                </div>
              ) : (
                <p className="small muted">{d.capabilities[p as PlatformId]}</p>
              )}
            </div>
          ))}
        </div>
      )}
      {d.posts.length > 0 && (
        <div className="card table-wrap">
          <table className="table">
            <thead><tr><th>Дата</th><th>Площадка</th><th>Публикация</th><th>Метрики</th></tr></thead>
            <tbody>
              {d.posts.map((p) => (
                <tr key={p.id}>
                  <td className="mono small nowrap">{fmtDate(p.publishedAt)}</td>
                  <td><PlatformChip id={p.platform} label={false} /></td>
                  <td className="small" style={{ maxWidth: 320 }}>
                    <div className="ellipsis">{p.title ?? p.text}</div>
                    <div className="row tight" style={{ marginTop: 4 }}>
                      {p.testMode && <Badge tone="test">ТЕСТ</Badge>}
                      {p.isDemo && <Badge tone="demo">ДЕМО</Badge>}
                      {p.status === 'manual_done' && <Badge>вручную</Badge>}
                      {p.externalUrl && <a href={p.externalUrl} target="_blank" rel="noreferrer" style={{ color: 'var(--lime)' }}>открыть</a>}
                    </div>
                  </td>
                  <td className="small">
                    {p.metrics ? (
                      <>
                        {Object.entries(p.metrics.values).map(([k, v]) => <span key={k} style={{ marginRight: 12 }}>{METRIC[k] ?? k}: <b>{nf.format(v)}</b></span>)}
                        {Object.entries(p.metrics.unavailable).map(([k, v]) => <div key={k} className="tiny dim">{METRIC[k] ?? k}: недоступно — {v}</div>)}
                      </>
                    ) : p.status === 'manual_done' ? (
                      <span className="dim">площадка без API — метрик нет</span>
                    ) : (
                      <span className="dim">ещё не собраны</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="card">
        <div className="card-head"><h2>Что отдают площадки</h2></div>
        <div className="table-wrap">
          <table className="table">
            <tbody>
              {PLATFORM_IDS.map((p) => (
                <tr key={p}><td style={{ width: 170 }}><PlatformChip id={p} /></td><td className="small muted">{d.capabilities[p]}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <Notice tone="info">Фабрика не дорисовывает, не усредняет и не прогнозирует метрики.</Notice>
    </div>
  );
}
