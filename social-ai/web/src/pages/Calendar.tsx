import { useMemo, useState, type DragEvent } from 'react';
import { Link } from 'react-router';
import { get, post, put } from '../api';
import type { Format, PlanItem, Platform, Publication } from '../types';
import { Alert, DemoBadge, ErrorBox, FORMAT_LABEL, fmtDateTime, fmtTime, Icon, Loading, Modal, PlatformIcon, StatusBadge, useLoad, useToast, zonedParts, zonedToIso } from '../ui';

type View = 'month' | 'week' | 'day';
type Ev = Publication & { title: string; format: Format; isDemo: boolean; accountName: string; platform: Platform };

const DOW = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const MOVABLE = ['scheduled', 'retrying', 'failed', 'blocked'];

function addDays(day: string, n: number) {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
function weekday(day: string) {
  const [y, m, d] = day.split('-').map(Number);
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
}

export function Calendar() {
  const toast = useToast();
  const today = zonedParts(new Date().toISOString()).day;
  const [view, setView] = useState<View>(() => (window.innerWidth < 700 ? 'day' : 'month'));
  const [anchor, setAnchor] = useState(today);
  const [moving, setMoving] = useState<Ev | null>(null);
  const [dropDay, setDropDay] = useState<string | null>(null);

  const days = useMemo(() => {
    if (view === 'day') return [anchor];
    if (view === 'week') {
      const start = addDays(anchor, -weekday(anchor));
      return Array.from({ length: 7 }, (_, i) => addDays(start, i));
    }
    const first = `${anchor.slice(0, 8)}01`;
    const start = addDays(first, -weekday(first));
    return Array.from({ length: 42 }, (_, i) => addDays(start, i));
  }, [view, anchor]);

  const from = zonedToIso(days[0], '00:00');
  const to = zonedToIso(addDays(days[days.length - 1], 1), '00:00');
  const { data, error, loading, reload } = useLoad(() => get<{ publications: Ev[]; plan: PlanItem[] }>(`/api/calendar?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`), [from, to]);

  const byDay = useMemo(() => {
    const map = new Map<string, { pubs: Ev[]; plan: PlanItem[] }>();
    for (const p of data?.publications ?? []) {
      const d = zonedParts(p.publishedAt ?? p.scheduledAt).day;
      if (!map.has(d)) map.set(d, { pubs: [], plan: [] });
      map.get(d)!.pubs.push(p);
    }
    for (const p of data?.plan ?? []) {
      if (p.status === 'skipped') continue;
      const d = zonedParts(p.date).day;
      if (!map.has(d)) map.set(d, { pubs: [], plan: [] });
      map.get(d)!.plan.push(p);
    }
    return map;
  }, [data]);

  const shift = (dir: number) => {
    if (view === 'day') setAnchor(addDays(anchor, dir));
    else if (view === 'week') setAnchor(addDays(anchor, dir * 7));
    else {
      const [y, m] = anchor.split('-').map(Number);
      const d = new Date(Date.UTC(y, m - 1 + dir, 1));
      setAnchor(d.toISOString().slice(0, 10));
    }
  };

  const title = view === 'month'
    ? new Intl.DateTimeFormat('ru-RU', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${anchor}T12:00:00Z`))
    : view === 'week'
      ? `${fmtShort(days[0])} — ${fmtShort(days[6])}`
      : new Intl.DateTimeFormat('ru-RU', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(`${anchor}T12:00:00Z`));

  const onDrop = async (e: DragEvent, day: string) => {
    e.preventDefault();
    setDropDay(null);
    const id = Number(e.dataTransfer.getData('text/plain'));
    const ev = data?.publications.find((p) => p.id === id);
    if (!ev) return;
    const time = zonedParts(ev.scheduledAt).time;
    try {
      await put(`/api/publications/${id}`, { at: zonedToIso(day, time) });
      toast('success', `Перенесено на ${fmtShort(day)}, ${time}`);
      await reload();
    } catch (err) {
      toast('error', (err as Error).message);
    }
  };

  const renderEvents = (day: string, full = false) => {
    const d = byDay.get(day);
    if (!d) return null;
    return (
      <>
        {d.pubs.map((p) => (
          <button key={p.id} className={`cal-ev s-${p.status}`} draggable={MOVABLE.includes(p.status)}
            onDragStart={(e) => e.dataTransfer.setData('text/plain', String(p.id))}
            onClick={() => setMoving(p)} title={`${p.title} · ${p.accountName}`}>
            <PlatformIcon platform={p.platform} small />
            <span className="t">{fmtTime(p.publishedAt ?? p.scheduledAt)}</span>
            <span className="ellipsis">{p.title || 'Без названия'}</span>
            {full && <StatusBadge kind="pub" status={p.status} />}
          </button>
        ))}
        {d.plan.map((p) => (
          <div key={`plan-${p.id}`} className="cal-ev plan" title={`В плане агента: ${p.angle}`}>
            <span className="t">{fmtTime(p.date)}</span>
            <span className="ellipsis">{full ? `План: ${p.topic} — ${p.angle}` : `План · ${p.topic}`}</span>
          </div>
        ))}
      </>
    );
  };

  return (
    <div className="page">
      <div className="row">
        <div className="row" style={{ gap: 6 }}>
          <button className="btn btn-icon" aria-label="Назад" onClick={() => shift(-1)}><Icon name="chevronL" /></button>
          <button className="btn" onClick={() => setAnchor(today)}>Сегодня</button>
          <button className="btn btn-icon" aria-label="Вперёд" onClick={() => shift(1)}><Icon name="chevronR" /></button>
        </div>
        <h2 style={{ margin: 0, fontSize: 'var(--fs-lg)', fontWeight: 600, textTransform: 'capitalize' }}>{title}</h2>
        <div className="spacer" />
        {loading && <span className="spinner" />}
        <div className="seg" role="group" aria-label="Вид">
          {(['day', 'week', 'month'] as View[]).map((v) => <button key={v} aria-pressed={view === v} onClick={() => setView(v)}>{v === 'day' ? 'День' : v === 'week' ? 'Неделя' : 'Месяц'}</button>)}
        </div>
      </div>
      <div className="legend">
        <span><i style={{ background: 'var(--info)' }} />Запланирована</span>
        <span><i style={{ background: 'var(--good)' }} />Опубликована</span>
        <span><i style={{ background: 'var(--warning)' }} />Повтор / проверка</span>
        <span><i style={{ background: 'var(--critical)' }} />Ошибка</span>
        <span><i style={{ border: '1px dashed var(--text-3)' }} />План агента</span>
        <span>Перетащите публикацию на другой день, чтобы перенести; нажмите — чтобы изменить время.</span>
      </div>
      {error && <ErrorBox error={error} retry={reload} />}
      {!data && loading ? <Loading /> : view === 'day' ? (
        <section className="card cal-day">
          {byDay.get(anchor) ? <div className="list" style={{ padding: 12, gap: 6, display: 'grid' }}>{renderEvents(anchor, true)}</div> : <div className="card-body muted">На этот день ничего не запланировано.</div>}
        </section>
      ) : (
        <section className="card" style={{ overflow: 'hidden' }}>
          <div className={view === 'month' ? 'cal-month' : 'cal-week'}>
            {view === 'month' && DOW.map((d) => <div key={d} className="cal-dow">{d}</div>)}
            {days.map((day) => (
              <div key={day}
                className={`cal-cell${view === 'month' && day.slice(0, 7) !== anchor.slice(0, 7) ? ' out' : ''}${day === today ? ' today' : ''}${dropDay === day ? ' drop' : ''}`}
                onDragOver={(e) => { e.preventDefault(); setDropDay(day); }} onDragLeave={() => setDropDay(null)} onDrop={(e) => onDrop(e, day)}>
                <span className="cal-num">{view === 'week' ? `${DOW[weekday(day)]} ${Number(day.slice(8))}` : Number(day.slice(8))}</span>
                {renderEvents(day)}
              </div>
            ))}
          </div>
        </section>
      )}
      {moving && <EventDialog ev={moving} onClose={() => setMoving(null)} onSaved={async () => { setMoving(null); await reload(); }} />}
    </div>
  );
}

const fmtShort = (day: string) => new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${day}T12:00:00Z`));

function EventDialog({ ev, onClose, onSaved }: { ev: Ev; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const start = zonedParts(ev.scheduledAt);
  const [day, setDay] = useState(start.day);
  const [time, setTime] = useState(start.time);
  const [error, setError] = useState<string | null>(null);
  const movable = MOVABLE.includes(ev.status);

  const save = async () => {
    try {
      await put(`/api/publications/${ev.id}`, { at: zonedToIso(day, time) });
      toast('success', 'Время изменено');
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const cancel = async () => {
    try {
      await post(`/api/publications/${ev.id}/cancel`);
      toast('info', 'Публикация отменена');
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <Modal title={ev.title || 'Публикация'} onClose={onClose} footer={<>
      <Link className="btn btn-ghost" to={`/content/${ev.contentId}`}>Открыть материал</Link>
      {movable && <button className="btn btn-danger" onClick={cancel}>Отменить</button>}
      {movable && <button className="btn btn-primary" onClick={save}>Сохранить время</button>}
    </>}>
      {error && <Alert kind="critical">{error}</Alert>}
      <dl className="kv">
        <dt>Аккаунт</dt><dd className="row" style={{ gap: 6 }}><PlatformIcon platform={ev.platform} small />{ev.accountName}</dd>
        <dt>Статус</dt><dd><StatusBadge kind="pub" status={ev.status} /> {ev.isDemo && <DemoBadge />}</dd>
        <dt>Формат</dt><dd>{FORMAT_LABEL[ev.format]}</dd>
        <dt>{ev.publishedAt ? 'Опубликовано' : 'Запланировано'}</dt><dd>{fmtDateTime(ev.publishedAt ?? ev.scheduledAt, { dateStyle: 'long', timeStyle: 'short' })}</dd>
        {ev.lastError && <><dt>Причина</dt><dd style={{ color: 'var(--critical)' }}>{ev.lastError}</dd></>}
      </dl>
      {movable ? (
        <div className="grid grid-2">
          <label className="field"><span>Дата</span><input className="input" type="date" value={day} onChange={(e) => setDay(e.target.value)} /></label>
          <label className="field"><span>Время</span><input className="input" type="time" value={time} onChange={(e) => setTime(e.target.value)} /></label>
        </div>
      ) : <p className="muted" style={{ margin: 0 }}>Эту публикацию уже нельзя перенести.</p>}
    </Modal>
  );
}
