import { useMemo, useState } from 'react';
import { BarList } from '../../../components/charts/BarList';
import { fmtPct } from '../../../lib/format';
import { funnel, groupStats } from '../logic/stats';
import { STATUS_LABELS, type LeadField, type ScoreResult } from '../logic/types';
import type { LeadState } from './LeadEngineApp';

export function FunnelTab({ state, scores }: { state: LeadState; scores: Map<string, ScoreResult> }) {
  const [dim, setDim] = useState<LeadField>('source');
  const f = useMemo(() => funnel(state.leads), [state.leads]);
  const groups = useMemo(() => groupStats(state.leads, dim, scores), [state.leads, dim, scores]);
  const total = state.leads.length;
  const tierA = [...scores.values()].filter((s) => s.tier === 'A').length;
  const contactable = state.leads.filter((l) => l.fields.email || l.fields.phone).length;
  const qualified = f.stages.find((s) => s.status === 'qualified')?.reached ?? 0;
  const top = f.stages[0]?.reached || 1;

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div className="stat-grid">
        <div className="stat">
          <span className="stat__label">Всего лидов</span>
          <span className="stat__value">{total}</span>
        </div>
        <div className="stat">
          <span className="stat__label">Категория A</span>
          <span className="stat__value">{tierA}</span>
          <span className="stat__meta">{fmtPct((tierA / Math.max(1, total)) * 100)} базы</span>
        </div>
        <div className="stat">
          <span className="stat__label">С контактами</span>
          <span className="stat__value">{fmtPct((contactable / Math.max(1, total)) * 100, 0)}</span>
          <span className="stat__meta">{contactable} из {total}</span>
        </div>
        <div className="stat">
          <span className="stat__label">Квалифицировано</span>
          <span className="stat__value">{qualified}</span>
          <span className="stat__meta">дошли до этапа «Квалифицирован»</span>
        </div>
        <div className="stat">
          <span className="stat__label">Отказы</span>
          <span className="stat__value">{f.lost}</span>
        </div>
      </div>

      <div className="split">
        <div className="panel">
          <div className="panel__head">
            <span className="panel__title">Воронка по статусам</span>
          </div>
          <div className="panel__body">
            <BarList
              ariaLabel="Воронка"
              max={top}
              items={f.stages.map((s) => ({
                key: s.status,
                label: STATUS_LABELS[s.status],
                value: s.reached,
                display: String(s.reached),
                secondary: `${fmtPct((s.reached / top) * 100, 0)} · сейчас ${s.current}`,
              }))}
            />
            <p className="dim" style={{ fontSize: 'var(--fs-xs)', marginTop: 10 }}>
              Этап считается пройденным, если текущий статус лида не ниже него. Отказы исключены из воронки. Меняйте статусы в карточках лидов — воронка пересчитается.
            </p>
          </div>
        </div>
        <div className="panel">
          <div className="panel__head">
            <span className="panel__title">Разбивка</span>
            <select className="select select--sm" style={{ width: 'auto' }} value={dim} onChange={(e) => setDim(e.target.value as LeadField)} aria-label="Измерение разбивки">
              <option value="source">По источнику</option>
              <option value="industry">По отрасли</option>
              <option value="city">По городу</option>
            </select>
          </div>
          <div className="panel__body">
            <BarList
              ariaLabel="Разбивка лидов"
              items={groups.slice(0, 10).map((g) => ({
                key: g.key,
                label: g.key,
                value: g.count,
                display: String(g.count),
                secondary: `ср. ${g.avgScore.toFixed(0)} · A ${fmtPct(g.shareA * 100, 0)}`,
              }))}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
