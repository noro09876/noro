import { useMemo, useState } from 'react';
import { get, post } from '../api';
import type { Platform } from '../types';
import { Alert, Empty, ErrorBox, FORMAT_LABEL, fmtDateTime, fmtNum, Icon, Loading, PLATFORM_LABEL, PlatformIcon, useLoad, useToast } from '../ui';

interface Row {
  id: number; published_at: string; external_url: string | null; platform: Platform; account_name: string; title: string; format: 'carousel' | 'post' | 'article'; topic: string;
  views: number | null; reach: number | null; likes: number | null; comments: number | null; shares: number | null; saves: number | null; fetched_at: string | null;
}
interface Data { rows: Row[]; byPlatform: Record<string, { published: number; withMetrics: number; views: number; likes: number; comments: number; shares: number }>; notes: Record<Platform, string> }

type SortKey = 'published_at' | 'views' | 'likes' | 'comments' | 'shares';

export function Analytics() {
  const toast = useToast();
  const { data, error, loading, reload } = useLoad(() => get<Data>('/api/analytics'));
  const [platform, setPlatform] = useState<Platform | ''>('');
  const [sort, setSort] = useState<SortKey>('published_at');
  const [busy, setBusy] = useState(false);

  const rows = useMemo(() => {
    const xs = (data?.rows ?? []).filter((r) => !platform || r.platform === platform);
    return [...xs].sort((a, b) => (sort === 'published_at' ? b.published_at.localeCompare(a.published_at) : (b[sort] ?? -1) - (a[sort] ?? -1)));
  }, [data, platform, sort]);

  const maxViews = Math.max(1, ...rows.map((r) => r.views ?? 0));

  if (loading && !data) return <div className="page"><Loading /></div>;
  if (error || !data) return <div className="page"><ErrorBox error={error ?? ''} retry={reload} /></div>;

  return (
    <div className="page">
      <Alert kind="info">Здесь только реальные данные, полученные от площадок. Если площадка не отдаёт статистику, стоит «—», а не оценка. Демо-материалы в аналитику не попадают.</Alert>
      <div className="grid grid-4">
        {(Object.keys(PLATFORM_LABEL) as Platform[]).map((p) => {
          const b = data.byPlatform[p];
          return (
            <div key={p} className="card stat">
              <span className="stat-label row" style={{ gap: 8 }}><PlatformIcon platform={p} small />{PLATFORM_LABEL[p]}</span>
              <span className="stat-value">{b?.published ?? 0}</span>
              <span className="stat-note">{b?.withMetrics ? `просмотров ${fmtNum(b.views)} · лайков ${fmtNum(b.likes)}` : 'статистика недоступна или ещё не собрана'}</span>
            </div>
          );
        })}
      </div>

      <section className="card">
        <div className="card-head">
          <h3>Публикации</h3>
          <div className="spacer" />
          <select className="select" style={{ width: 160 }} value={platform} onChange={(e) => setPlatform(e.target.value as Platform | '')} aria-label="Площадка">
            <option value="">Все площадки</option>
            {(Object.keys(PLATFORM_LABEL) as Platform[]).map((p) => <option key={p} value={p}>{PLATFORM_LABEL[p]}</option>)}
          </select>
          <select className="select" style={{ width: 170 }} value={sort} onChange={(e) => setSort(e.target.value as SortKey)} aria-label="Сортировка">
            <option value="published_at">Сначала новые</option><option value="views">По просмотрам</option><option value="likes">По лайкам</option><option value="comments">По комментариям</option><option value="shares">По репостам</option>
          </select>
          <button className="btn btn-sm" disabled={busy} onClick={async () => { setBusy(true); try { const r = await post<{ updated: number }>('/api/analytics/refresh'); toast('info', `Обновлено записей: ${r.updated}`); await reload(); } catch (e) { toast('error', (e as Error).message); } finally { setBusy(false); } }}>{busy ? <span className="spinner" /> : <Icon name="refresh" />}Обновить</button>
        </div>
        {rows.length ? (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Материал</th><th>Площадка</th><th>Дата</th><th className="num">Просмотры</th><th className="num">Охват</th><th className="num">Лайки</th><th className="num">Комм.</th><th className="num">Репосты</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td style={{ minWidth: 220 }}>
                      <div className="ellipsis" style={{ maxWidth: 360 }}>{r.external_url ? <a href={r.external_url} target="_blank" rel="noreferrer">{r.title}</a> : r.title}</div>
                      <div className="muted" style={{ fontSize: 12 }}>{FORMAT_LABEL[r.format]} · {r.topic}</div>
                      {r.views != null && <div className="bar" style={{ marginTop: 6, maxWidth: 240 }}><i style={{ width: `${((r.views ?? 0) / maxViews) * 100}%` }} /></div>}
                    </td>
                    <td><div className="row" style={{ gap: 6, flexWrap: 'nowrap' }}><PlatformIcon platform={r.platform} small />{r.account_name}</div></td>
                    <td style={{ whiteSpace: 'nowrap' }}>{fmtDateTime(r.published_at)}</td>
                    <td className="num">{fmtNum(r.views)}</td><td className="num">{fmtNum(r.reach)}</td><td className="num">{fmtNum(r.likes)}</td><td className="num">{fmtNum(r.comments)}</td><td className="num">{fmtNum(r.shares)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <Empty icon="chart" title="Опубликованных материалов пока нет" text="Статистика появится после первых публикаций в подключённые аккаунты." />}
      </section>

      <section className="card">
        <div className="card-head"><h3>Что отдаёт каждая площадка</h3></div>
        <div className="list">
          {(Object.keys(data.notes) as Platform[]).map((p) => (
            <div key={p} className="list-item"><PlatformIcon platform={p} /><div className="grow text-2">{data.notes[p]}</div></div>
          ))}
        </div>
      </section>
    </div>
  );
}
