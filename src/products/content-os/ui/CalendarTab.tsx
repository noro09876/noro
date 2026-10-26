import { useMemo, useState } from 'react';
import { Icon } from '../../../components/ui/Icon';
import { PLATFORMS, STATUS_LABELS, type ContentItem, type Project } from '../logic/types';

const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];

const iso = (y: number, m: number, d: number) => `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

/** Monday-first month grid (6 weeks) as ISO days; null for padding cells. */
export function monthGrid(year: number, month: number): Array<string | null> {
  const first = new Date(Date.UTC(year, month, 1)).getUTCDay();
  const pad = (first + 6) % 7;
  const days = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const cells: Array<string | null> = Array.from({ length: pad }, () => null);
  for (let d = 1; d <= days; d++) cells.push(iso(year, month, d));
  while (cells.length % 7) cells.push(null);
  return cells;
}

interface Entry {
  project: Project;
  item: ContentItem;
}

interface Props {
  projects: Project[];
  activeProjectId: string;
  moveItem: (projectId: string, itemId: string, date: string) => void;
  openItem: (projectId: string, itemId: string) => void;
}

export function CalendarTab({ projects, activeProjectId, moveItem, openItem }: Props) {
  const active = projects.find((p) => p.id === activeProjectId);
  const start = active?.items[0]?.date ?? active?.startDate ?? new Date().toISOString().slice(0, 10);
  const [ym, setYm] = useState(() => ({ y: Number(start.slice(0, 4)), m: Number(start.slice(5, 7)) - 1 }));
  const [onlyActive, setOnlyActive] = useState(false);
  const [dragOver, setDragOver] = useState<string | null>(null);
  const [picked, setPicked] = useState<{ projectId: string; itemId: string } | null>(null);
  const today = new Date().toISOString().slice(0, 10);

  const byDay = useMemo(() => {
    const map = new Map<string, Entry[]>();
    for (const project of projects) {
      if (onlyActive && project.id !== activeProjectId) continue;
      for (const item of project.items) map.set(item.date, [...(map.get(item.date) ?? []), { project, item }]);
    }
    return map;
  }, [projects, onlyActive, activeProjectId]);

  const cells = monthGrid(ym.y, ym.m);
  const shift = (d: number) => setYm(({ y, m }) => ({ y: m + d < 0 ? y - 1 : m + d > 11 ? y + 1 : y, m: (m + d + 12) % 12 }));
  const pickedEntry = picked ? projects.find((p) => p.id === picked.projectId)?.items.find((i) => i.id === picked.itemId) : null;
  const total = [...byDay.values()].reduce((s, l) => s + l.length, 0);

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div className="toolbar">
        <button type="button" className="btn btn--ghost btn--icon btn--sm" onClick={() => shift(-1)} aria-label="Предыдущий месяц">
          <Icon name="chevronLeft" />
        </button>
        <h3 style={{ fontSize: 'var(--fs-lg)', minWidth: 160, textAlign: 'center' }} aria-live="polite">
          {MONTHS[ym.m]} {ym.y}
        </h3>
        <button type="button" className="btn btn--ghost btn--icon btn--sm" onClick={() => shift(1)} aria-label="Следующий месяц">
          <Icon name="chevronRight" />
        </button>
        <span className="toolbar__spacer" />
        <label className="check">
          <input type="checkbox" checked={onlyActive} onChange={(e) => setOnlyActive(e.target.checked)} />
          <span>Только текущий проект</span>
        </label>
      </div>
      {total === 0 ? <p className="dim">В календаре пока пусто: соберите материалы проекта — они встанут на даты от даты старта.</p> : null}
      <div className="cal" role="grid" aria-label={`Календарь публикаций, ${MONTHS[ym.m]} ${ym.y}`}>
        <div className="cal__row cal__head" role="row">
          {WEEKDAYS.map((d) => (
            <div key={d} role="columnheader" className="cal__wd">
              {d}
            </div>
          ))}
        </div>
        {Array.from({ length: cells.length / 7 }, (_, w) => (
          <div className="cal__row" role="row" key={w}>
            {cells.slice(w * 7, w * 7 + 7).map((day, i) => {
              const entries = day ? (byDay.get(day) ?? []) : [];
              return (
                <div
                  key={day ?? `pad-${w}-${i}`}
                  role="gridcell"
                  className={`cal__cell${day ? '' : ' cal__cell--pad'}${day === today ? ' is-today' : ''}${day && dragOver === day ? ' is-over' : ''}`}
                  onDragOver={(e) => {
                    if (!day) return;
                    e.preventDefault();
                    setDragOver(day);
                  }}
                  onDragLeave={() => setDragOver(null)}
                  onDrop={(e) => {
                    setDragOver(null);
                    if (!day) return;
                    const [pid, iid] = e.dataTransfer.getData('text/plain').split('|');
                    if (pid && iid) moveItem(pid, iid, day);
                  }}
                  data-day={day ?? undefined}
                >
                  {day ? <span className="cal__num">{Number(day.slice(8))}</span> : null}
                  {entries.map(({ project, item }) => (
                    <button
                      key={item.id}
                      type="button"
                      draggable
                      onDragStart={(e) => e.dataTransfer.setData('text/plain', `${project.id}|${item.id}`)}
                      className={`cal__item cal__item--${item.platform}${picked?.itemId === item.id ? ' is-picked' : ''}`}
                      title={`${project.name}: ${item.title} (${STATUS_LABELS[item.status]})`}
                      onClick={() => setPicked({ projectId: project.id, itemId: item.id })}
                    >
                      <span className={`co-dot co-dot--${item.status}`} aria-hidden />
                      {PLATFORMS[item.platform].label}
                    </button>
                  ))}
                </div>
              );
            })}
          </div>
        ))}
      </div>
      {picked && pickedEntry ? (
        <div className="panel">
          <div className="panel__body" style={{ display: 'flex', gap: 12, alignItems: 'end', flexWrap: 'wrap' }}>
            <div style={{ minWidth: 0, flex: '1 1 260px' }}>
              <div className="field__label">{PLATFORMS[pickedEntry.platform].label} · {STATUS_LABELS[pickedEntry.status]}</div>
              <b>{pickedEntry.title}</b>
            </div>
            <label className="field">
              <span className="field__label">Перенести на дату</span>
              <input type="date" className="input" value={pickedEntry.date} onChange={(e) => e.target.value && moveItem(picked.projectId, picked.itemId, e.target.value)} data-testid="cal-date" />
            </label>
            <button type="button" className="btn btn--outline btn--sm" onClick={() => openItem(picked.projectId, picked.itemId)}>
              <Icon name="edit" /> Открыть текст
            </button>
          </div>
        </div>
      ) : (
        <p className="dim" style={{ fontSize: 'var(--fs-xs)' }}>Перетащите материал на другой день или нажмите на него, чтобы выбрать дату с клавиатуры.</p>
      )}
    </div>
  );
}
