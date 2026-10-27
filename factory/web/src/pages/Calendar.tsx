import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { api } from '../api';
import { Button, Drawer, fmtDate, Loading, Notice, PlatformChip, PostStatusBadge, Seg } from '../components/ui';
import { PLATFORMS } from '../../../shared/platforms';
import { addDays, formatInTz, zonedToUtc } from '../../../shared/time';
import { useWs, useWsApi } from '../session';
import type { Post } from '../types';

const WD = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

function weekdayMon(date: string) {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
}

export function CalendarPage() {
  const { ws, base } = useWs();
  const u = useWsApi();
  const [tz, setTz] = useState(Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Moscow');
  const [month, setMonth] = useState(() => formatInTz(new Date(), tz).date.slice(0, 7));
  const [view, setView] = useState<'month' | 'list'>(() => (window.innerWidth < 700 ? 'list' : 'month'));
  const [open, setOpen] = useState<Post | null>(null);

  const first = `${month}-01`;
  const gridStart = addDays(first, -weekdayMon(first));
  const days = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  const from = zonedToUtc(days[0]!, '00:00', tz);
  const to = zonedToUtc(addDays(days[41]!, 1), '00:00', tz);
  const q = useQuery({ queryKey: ['posts', ws.id, from.toISOString(), to.toISOString()], queryFn: () => api.get<Post[]>(u(`/posts?from=${from.toISOString()}&to=${to.toISOString()}`)), refetchInterval: 15_000 });
  const byDay = useMemo(() => {
    const m = new Map<string, Post[]>();
    for (const p of q.data ?? []) {
      const at = p.scheduledAt ?? p.publishedAt;
      if (!at) continue;
      const d = formatInTz(at, tz).date;
      m.set(d, [...(m.get(d) ?? []), p]);
    }
    return m;
  }, [q.data, tz]);
  const today = formatInTz(new Date(), tz).date;
  const shift = (n: number) => {
    const [y, m] = month.split('-').map(Number) as [number, number];
    const d = new Date(Date.UTC(y, m - 1 + n, 1));
    setMonth(d.toISOString().slice(0, 7));
  };
  const monthName = new Intl.DateTimeFormat('ru-RU', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${first}T00:00:00Z`));
  const listDays = days.filter((d) => d.startsWith(month) && byDay.has(d));

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>Календарь</h1>
          <p>Время публикаций хранится в UTC и показывается в выбранном часовом поясе. Конфликты (две публикации в один аккаунт ближе часа, дневные лимиты площадок) проверяются при планировании.</p>
        </div>
        <div className="row">
          <Seg value={view} onChange={setView} options={[{ value: 'month', label: 'Месяц' }, { value: 'list', label: 'Список' }]} />
          <input className="input" style={{ width: 190 }} value={tz} onChange={(e) => setTz(e.target.value)} aria-label="Часовой пояс" />
        </div>
      </div>
      <div className="row between">
        <div className="row">
          <Button size="sm" icon="arrowLeft" onClick={() => shift(-1)} aria-label="Предыдущий месяц" />
          <h2 style={{ textTransform: 'capitalize', minWidth: 170, textAlign: 'center' }}>{monthName}</h2>
          <Button size="sm" icon="arrowRight" onClick={() => shift(1)} aria-label="Следующий месяц" />
          <Button size="sm" variant="ghost" onClick={() => setMonth(today.slice(0, 7))}>Сегодня</Button>
        </div>
        <div className="row tight small muted">
          <span className="ev scheduled" style={{ cursor: 'default' }}>запланировано</span>
          <span className="ev published" style={{ cursor: 'default' }}>опубликовано</span>
          <span className="ev manual_pending" style={{ cursor: 'default' }}>вручную</span>
          <span className="ev failed" style={{ cursor: 'default' }}>ошибка</span>
        </div>
      </div>
      {q.isLoading ? (
        <Loading />
      ) : view === 'month' ? (
        <div className="card" style={{ overflow: 'hidden' }}>
          <div className="cal">
            {WD.map((d) => <div key={d} className="cal-h">{d}</div>)}
            {days.map((d) => (
              <div key={d} className={`cal-d ${d.startsWith(month) ? '' : 'out'} ${d === today ? 'today' : ''}`}>
                <span className="n">{Number(d.slice(8))}</span>
                {(byDay.get(d) ?? []).slice(0, 4).map((p) => (
                  <button key={p.id} className={`ev ${p.status}`} onClick={() => setOpen(p)} title={p.item?.title}>
                    <span className="t">{formatInTz(p.scheduledAt ?? p.publishedAt!, tz).time}</span>
                    <span style={{ color: `hsl(${PLATFORMS[p.platform].hue} 70% 70%)`, fontFamily: 'var(--mono)', fontSize: 10 }}>{PLATFORMS[p.platform].short}</span>
                    <span className="label ellipsis">{p.item?.title ?? p.text}</span>
                  </button>
                ))}
                {(byDay.get(d)?.length ?? 0) > 4 && <span className="tiny dim">ещё {byDay.get(d)!.length - 4}</span>}
              </div>
            ))}
          </div>
        </div>
      ) : listDays.length ? (
        <div className="card">
          {listDays.map((d) => (
            <div key={d} className="card-body" style={{ borderBottom: '1px solid var(--line)' }}>
              <div className="small muted" style={{ marginBottom: 8 }}>{new Intl.DateTimeFormat('ru-RU', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(`${d}T00:00:00Z`))}</div>
              <div className="col" style={{ gap: 6 }}>
                {byDay.get(d)!.map((p) => (
                  <button key={p.id} className={`ev ${p.status}`} onClick={() => setOpen(p)} style={{ padding: 8 }}>
                    <span className="t">{formatInTz(p.scheduledAt ?? p.publishedAt!, tz).time}</span>
                    <PlatformChip id={p.platform} label={false} />
                    <span className="ellipsis" style={{ flex: 1 }}>{p.item?.title ?? p.text}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <Notice tone="info">В этом месяце нет публикаций.</Notice>
      )}

      <Drawer open={!!open} onClose={() => setOpen(null)} title={open?.item?.title ?? 'Публикация'}>
        {open && (
          <div className="stack">
            <div className="row"><PlatformChip id={open.platform} /><PostStatusBadge status={open.status} testMode={open.testMode} /></div>
            <dl className="kv">
              <dt>Время</dt><dd>{fmtDate(open.scheduledAt, tz)} <span className="dim small">({tz})</span></dd>
              {open.publishedAt && <><dt>Опубликовано</dt><dd>{fmtDate(open.publishedAt, tz)}</dd></>}
              <dt>Попытки</dt><dd>{open.attempts} из {open.maxAttempts}</dd>
              {open.externalUrl && <><dt>Ссылка</dt><dd><a href={open.externalUrl} target="_blank" rel="noreferrer" style={{ color: 'var(--lime)' }}>{open.externalUrl}</a></dd></>}
              {open.lastError && <><dt>Ошибка</dt><dd style={{ color: 'var(--red)' }}>{open.lastError}</dd></>}
            </dl>
            <div className="pre small" style={{ background: 'var(--bg-2)', padding: 12, borderRadius: 10 }}>{open.text}</div>
            <Link className="btn primary" to={`${base}/items/${open.itemId}`}>Открыть материал и публикацию</Link>
          </div>
        )}
      </Drawer>
    </div>
  );
}
