import { BarList } from '../../../components/charts/BarList';
import { LineChart } from '../../../components/charts/LineChart';
import { Icon } from '../../../components/ui/Icon';
import { fmtDelta, fmtInt, fmtMoney, fmtMoneyCompact, fmtNum, fmtPct } from '../../../lib/format';
import { bucketLabel, pctChange, type BreakdownRow } from '../logic/analytics';
import { dayToRu } from '../logic/dataset';
import { DIM_LABELS, type Anomaly, type Dimension, type Granularity, type Kpis } from '../logic/types';

interface Props {
  kpis: Kpis;
  prevKpis: Kpis | null;
  cur: { buckets: number[]; values: number[] };
  prev: { buckets: number[]; values: number[] } | null;
  granularity: Granularity;
  breakdowns: Array<{ dim: Dimension; rows: BreakdownRow[] }>;
  activeFilters: Partial<Record<Dimension, string[]>>;
  toggleFilter: (dim: Dimension, key: string) => void;
  anomalies: Anomaly[];
  openAnomalies: () => void;
}

interface Tile {
  key: string;
  label: string;
  value: number | null;
  prev: number | null | undefined;
  fmt: (n: number) => string;
  need: string;
  /** for rates show change in percentage points */
  rate?: boolean;
}

export function Overview({ kpis: k, prevKpis: p, cur, prev, granularity, breakdowns, activeFilters, toggleFilter, anomalies, openAnomalies }: Props) {
  const tiles: Tile[] = [
    { key: 'revenue', label: 'Выручка', value: k.revenue, prev: p?.revenue, fmt: fmtMoney, need: '' },
    { key: 'orders', label: 'Заказы', value: k.orders, prev: p?.orders, fmt: fmtInt, need: 'номер заказа или число заказов' },
    { key: 'aov', label: 'Средний чек', value: k.aov, prev: p?.aov, fmt: fmtMoney, need: 'номер заказа или число заказов' },
    { key: 'units', label: 'Продано единиц', value: k.units, prev: p?.units, fmt: fmtInt, need: 'количество' },
    { key: 'customers', label: 'Клиенты', value: k.customers, prev: p?.customers, fmt: fmtInt, need: 'клиент' },
    { key: 'margin', label: 'Валовая маржа', value: k.margin == null ? null : k.margin * 100, prev: p?.margin == null ? null : p.margin * 100, fmt: (n) => fmtPct(n), need: 'себестоимость', rate: true },
    { key: 'visits', label: 'Визиты', value: k.visits, prev: p?.visits, fmt: fmtInt, need: 'визиты' },
    { key: 'conv', label: 'Конверсия в заявку', value: k.convLead == null ? null : k.convLead * 100, prev: p?.convLead == null ? null : p.convLead * 100, fmt: (n) => fmtPct(n, 2), need: 'визиты и заявки', rate: true },
    { key: 'convOrder', label: 'Конверсия в заказ', value: k.convOrder == null ? null : k.convOrder * 100, prev: p?.convOrder == null ? null : p.convOrder * 100, fmt: (n) => fmtPct(n, 2), need: 'визиты и заказы', rate: true },
  ];
  const available = tiles.filter((t) => t.value != null);
  const missing = tiles.filter((t) => t.value == null);
  const labels = cur.buckets.map((b) => bucketLabel(b, granularity));
  const markers = granularity === 'day' ? anomalies.map((a) => ({ index: cur.buckets.indexOf(a.day), label: `Аномалия ${dayToRu(a.day)}` })).filter((m) => m.index >= 0) : [];

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div className="stat-grid bi-kpis" data-testid="bi-kpis">
        {available.map((t) => {
          const d = t.rate ? (t.prev == null || t.value == null ? null : t.value - t.prev) : pctChange(t.value, t.prev ?? null);
          return (
            <div key={t.key} className="stat" data-kpi={t.key}>
              <div className="stat__label">{t.label}</div>
              <div className="stat__value">{t.fmt(t.value!)}</div>
              <div className="stat__meta">
                {d == null ? (
                  <span className="dim">нет данных для сравнения</span>
                ) : (
                  <span className={`delta ${d > 0.05 ? 'delta--up' : d < -0.05 ? 'delta--down' : 'delta--flat'}`}>
                    {t.rate ? `${d >= 0 ? '+' : '−'}${fmtNum(Math.abs(d), 2)} п.п.` : fmtDelta(d)} <span className="dim">к прошлому периоду</span>
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {missing.length ? (
        <p className="dim" style={{ fontSize: 'var(--fs-xs)', display: 'flex', gap: 6, alignItems: 'baseline' }}>
          <Icon name="info" size={12} style={{ flex: 'none', transform: 'translateY(2px)' }} />
          <span>Не рассчитываются, потому что в данных нет нужных полей: {missing.map((t) => `${t.label.toLowerCase()} (нужно: ${t.need})`).join('; ')}.</span>
        </p>
      ) : null}

      <div className="panel">
        <div className="panel__head">
          <h3 className="panel__title">Выручка по {granularity === 'day' ? 'дням' : granularity === 'week' ? 'неделям' : 'месяцам'}</h3>
          {markers.length ? (
            <button type="button" className="btn btn--ghost btn--sm" onClick={openAnomalies}>
              <span className="chart__key" style={{ background: 'var(--critical)', width: 8, height: 8, borderRadius: '50%' }} /> Аномалии: {markers.length}
            </button>
          ) : null}
        </div>
        <div className="panel__body">
          {cur.values.length < 2 ? (
            <p className="dim">Слишком короткий период для графика — выберите больше дней или другую гранулярность.</p>
          ) : (
            <LineChart
              ariaLabel="Динамика выручки за период и предыдущий период"
              labels={labels}
              height={280}
              formatY={(n) => fmtMoneyCompact(n)}
              markers={markers}
              series={[
                { id: 'cur', label: 'Текущий период', color: 'var(--accent)', values: cur.values, area: true },
                ...(prev ? [{ id: 'prev', label: 'Предыдущий период', color: 'var(--text-3)', values: cur.values.map((_, i) => prev.values[i] ?? null), dashed: true }] : []),
              ]}
            />
          )}
        </div>
      </div>

      <div className="bi-breakdowns">
        {breakdowns.map(({ dim, rows }) => (
          <div key={dim} className="panel">
            <div className="panel__head">
              <h3 className="panel__title">{DIM_LABELS[dim]}</h3>
              <span className="dim" style={{ fontSize: 'var(--fs-xs)' }}>нажмите, чтобы отфильтровать</span>
            </div>
            <div className="panel__body">
              <BarList
                ariaLabel={`Выручка: ${DIM_LABELS[dim]}`}
                items={rows.slice(0, 8).map((r) => ({
                  key: r.key,
                  label: r.key,
                  value: r.revenue,
                  display: fmtMoneyCompact(r.revenue),
                  secondary: r.delta == null ? fmtPct(r.share * 100, 0) : `${fmtPct(r.share * 100, 0)} · ${fmtDelta(r.delta)}`,
                }))}
                onSelect={(key) => toggleFilter(dim, key)}
                activeKeys={new Set(activeFilters[dim] ?? [])}
              />
              {rows.length > 8 ? <p className="dim" style={{ fontSize: 'var(--fs-xs)', marginTop: 8 }}>Ещё {rows.length - 8} — во вкладке «Таблица».</p> : null}
            </div>
          </div>
        ))}
        {breakdowns.length === 0 ? <p className="dim">Разбивки появятся, если в данных есть категория, канал или регион.</p> : null}
      </div>
    </div>
  );
}
