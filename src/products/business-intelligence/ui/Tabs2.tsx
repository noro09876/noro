import { useMemo, useState } from 'react';
import { BarList } from '../../../components/charts/BarList';
import { DataTable, type Column } from '../../../components/ui/DataTable';
import { EmptyState } from '../../../components/ui/Feedback';
import { fmtDelta, fmtInt, fmtMoney, fmtMoneyCompact, fmtPct } from '../../../lib/format';
import { contributions, type BreakdownRow } from '../logic/analytics';
import { dayToRu } from '../logic/dataset';
import { DIM_LABELS, type Anomaly, type Dimension } from '../logic/types';

export function PivotTab({ breakdowns }: { breakdowns: Array<{ dim: Dimension; rows: BreakdownRow[] }> }) {
  const [dim, setDim] = useState<Dimension | undefined>(breakdowns[0]?.dim);
  const rows = breakdowns.find((b) => b.dim === dim)?.rows ?? [];
  const hasOrders = rows.some((r) => r.orders != null);
  const columns: Column<BreakdownRow>[] = [
    { key: 'key', header: dim ? DIM_LABELS[dim] : '', sortValue: (r) => r.key, render: (r) => r.key },
    { key: 'rev', header: 'Выручка', num: true, sortValue: (r) => r.revenue, render: (r) => fmtMoney(r.revenue) },
    { key: 'share', header: 'Доля', num: true, sortValue: (r) => r.share, render: (r) => fmtPct(r.share * 100) },
    { key: 'prev', header: 'Прошлый период', num: true, sortValue: (r) => r.prev ?? 0, render: (r) => (r.prev == null ? '—' : fmtMoney(r.prev)) },
    {
      key: 'delta',
      header: 'Изменение',
      num: true,
      sortValue: (r) => r.delta ?? -Infinity,
      render: (r) => (r.delta == null ? '—' : <span className={`delta ${r.delta >= 0 ? 'delta--up' : 'delta--down'}`}>{fmtDelta(r.delta)}</span>),
    },
    ...(hasOrders
      ? [
          { key: 'orders', header: 'Заказы', num: true, sortValue: (r: BreakdownRow) => r.orders ?? 0, render: (r: BreakdownRow) => (r.orders == null ? '—' : fmtInt(r.orders)) },
          { key: 'aov', header: 'Средний чек', num: true, sortValue: (r: BreakdownRow) => (r.orders ? r.revenue / r.orders : 0), render: (r: BreakdownRow) => (r.orders ? fmtMoney(r.revenue / r.orders) : '—') },
        ]
      : []),
  ];
  if (!breakdowns.length) return <EmptyState icon="table" title="Нет измерений" text="Для таблицы нужна хотя бы одна колонка: категория, канал или регион." />;
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div className="chip-row" role="group" aria-label="Измерение">
        {breakdowns.map((b) => (
          <button key={b.dim} type="button" className={`chip${dim === b.dim ? ' chip--active' : ''}`} aria-pressed={dim === b.dim} onClick={() => setDim(b.dim)}>
            {DIM_LABELS[b.dim]}
          </button>
        ))}
      </div>
      <DataTable<BreakdownRow> caption="Сводная таблица" rows={rows} columns={columns} rowKey={(r) => r.key} initialSort={{ key: 'rev', dir: 'desc' }} />
    </div>
  );
}

export function AnomaliesTab({ anomalies, threshold, setThreshold }: { anomalies: Anomaly[]; threshold: number; setThreshold: (n: number) => void }) {
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <label className="field" style={{ maxWidth: 420 }}>
        <span className="field__label">
          Чувствительность: |z| ≥ <b className="mono">{threshold.toFixed(1)}</b>
        </span>
        <input type="range" className="range" min={2.5} max={6} step={0.5} value={threshold} onChange={(e) => setThreshold(Number(e.target.value))} data-testid="anomaly-threshold" />
        <span className="field__hint">Меньше — больше найденных дней, но и больше случайных колебаний.</span>
      </label>
      {anomalies.length === 0 ? (
        <EmptyState icon="checkCircle" title="Аномалий не найдено" text="В выбранном периоде и фильтрах дневная выручка не выходила за пределы обычного разброса." />
      ) : (
        <ul className="list-reset" style={{ display: 'grid', gap: 10 }} data-testid="anomaly-list">
          {anomalies.map((a) => (
            <li key={a.day} className={`panel bi-anomaly ${a.z < 0 ? 'is-down' : 'is-up'}`}>
              <div className="panel__body" style={{ display: 'grid', gap: 6 }}>
                <div style={{ display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap' }}>
                  <b className="mono">{dayToRu(a.day)}</b>
                  <span className={`delta ${a.z < 0 ? 'delta--down' : 'delta--up'}`}>{fmtDelta(a.deltaPct)} к норме</span>
                  <span className="dim mono" style={{ fontSize: 'var(--fs-xs)' }}>z = {a.z.toFixed(1)}</span>
                </div>
                <p style={{ fontSize: 'var(--fs-sm)' }}>
                  Выручка {fmtMoney(a.value)} при обычной {fmtMoney(a.expected)} (медиана соседних ±14 дней).
                  {a.drivers.length ? ` Сильнее всего изменились: ${a.drivers.map((d) => `${d.key} (${DIM_LABELS[d.dim].toLowerCase()}, ${d.delta >= 0 ? '+' : '−'}${fmtMoneyCompact(Math.abs(d.delta))})`).join(', ')}.` : ''}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
      <p className="dim" style={{ fontSize: 'var(--fs-xs)' }}>
        Аномалия — статистический сигнал, а не диагноз. Причину (сбой сайта, акция, праздник) подтверждает человек.
      </p>
    </div>
  );
}

export function ChangesTab({ breakdowns, hasPrev }: { breakdowns: Array<{ dim: Dimension; rows: BreakdownRow[] }>; hasPrev: boolean }) {
  const data = useMemo(() => breakdowns.map((b) => ({ dim: b.dim, items: contributions(b.rows).slice(0, 8) })), [breakdowns]);
  if (!hasPrev) return <EmptyState icon="history" title="Нет предыдущего периода" text="Выберите период короче, чтобы в данных был такой же период до него." />;
  return (
    <div className="bi-breakdowns">
      {data.map(({ dim, items }) => (
        <div key={dim} className="panel">
          <div className="panel__head">
            <h3 className="panel__title">Вклад в изменение: {DIM_LABELS[dim].toLowerCase()}</h3>
          </div>
          <div className="panel__body">
            <BarList
              ariaLabel={`Вклад в изменение выручки: ${DIM_LABELS[dim]}`}
              items={items.map((i) => ({ key: i.key, label: i.key, value: i.delta, display: `${i.delta >= 0 ? '+' : '−'}${fmtMoneyCompact(Math.abs(i.delta))}`, secondary: fmtPct(i.shareOfChange * 100, 0) }))}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

export function MethodTab() {
  return (
    <div className="prose" style={{ maxWidth: 760 }}>
      <h3>Как считаются показатели</h3>
      <ul>
        <li><b>Выручка</b> — сумма колонки выручки по строкам периода и фильтров. Строки с нераспознанной датой или суммой не учитываются (их число показано после импорта).</li>
        <li><b>Заказы</b> — число уникальных номеров заказа. Если номера нет, но есть колонка с числом заказов (агрегированные данные), берётся её сумма.</li>
        <li><b>Средний чек</b> = выручка / заказы. <b>Маржа</b> = (выручка − себестоимость) / выручка.</li>
        <li><b>Конверсия</b> считается, только если есть и числитель, и знаменатель: заявки / визиты, заказы / визиты.</li>
        <li><b>Периоды</b> отсчитываются от последней даты в данных, а не от сегодняшнего дня. Сравнение — с периодом той же длины прямо перед выбранным.</li>
        <li><b>Недели</b> начинаются с понедельника, месяцы — календарные. Неполные первая и последняя корзины не достраиваются.</li>
        <li><b>Аномалии</b>: для каждого дня берётся медиана выручки соседних ±14 дней и медианное абсолютное отклонение (MAD × 1,4826). День отмечается, если отклонение больше выбранного порога. Метод устойчив к самим выбросам, в отличие от среднего.</li>
        <li><b>Вклад в изменение</b> — разница выручки по значению измерения между периодами; сумма вкладов равна общему изменению.</li>
      </ul>
      <p className="dim">Прогнозов нет: показываются только факты и сравнения. Все вычисления выполняются в браузере.</p>
    </div>
  );
}
