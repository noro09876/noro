import { useMemo, type Dispatch, type SetStateAction } from 'react';
import { BarList } from '../../../components/charts/BarList';
import { Icon } from '../../../components/ui/Icon';
import { uid } from '../../../lib/id';
import { DEFAULT_SCORING } from '../logic/scoring';
import { FIELD_LABELS, LEAD_FIELDS, OPERATOR_LABELS, type LeadField, type RuleOperator, type ScoreResult, type ScoringRule } from '../logic/types';
import type { LeadState } from './LeadEngineApp';

interface Props {
  state: LeadState;
  setState: Dispatch<SetStateAction<LeadState>>;
  scores: Map<string, ScoreResult>;
}

const NO_VALUE: RuleOperator[] = ['not_empty', 'empty', 'corporate_email'];

export function ScoringTab({ state, setState, scores }: Props) {
  const { rules, thresholds } = state.scoring;

  const updateRule = (id: string, patch: Partial<ScoringRule>) =>
    setState((s) => ({ ...s, scoring: { ...s.scoring, rules: s.scoring.rules.map((r) => (r.id === id ? { ...r, ...patch } : r)) } }));
  const removeRule = (id: string) => setState((s) => ({ ...s, scoring: { ...s.scoring, rules: s.scoring.rules.filter((r) => r.id !== id) } }));
  const addRule = () =>
    setState((s) => ({
      ...s,
      scoring: { ...s.scoring, rules: [...s.scoring.rules, { id: uid('r'), label: 'Новое правило', field: 'industry', operator: 'contains_any', value: '', points: 10, enabled: true }] },
    }));
  const setThreshold = (k: 'a' | 'b', v: number) =>
    setState((s) => {
      const t = { ...s.scoring.thresholds, [k]: v };
      if (k === 'a' && t.b > v) t.b = v;
      if (k === 'b' && t.a < v) t.a = v;
      return { ...s, scoring: { ...s.scoring, thresholds: t } };
    });

  const stats = useMemo(() => {
    const tiers = { A: 0, B: 0, C: 0 };
    const fired = new Map<string, number>();
    let sum = 0;
    for (const s of scores.values()) {
      tiers[s.tier]++;
      sum += s.score;
      for (const f of s.factors) fired.set(f.ruleId, (fired.get(f.ruleId) ?? 0) + 1);
    }
    return { tiers, fired, avg: scores.size ? sum / scores.size : 0 };
  }, [scores]);

  const total = Math.max(1, scores.size);
  const maxPossible = rules.filter((r) => r.enabled && r.points > 0).reduce((s, r) => s + r.points, 0);

  return (
    <div className="split split--side">
      <div className="panel">
        <div className="panel__head">
          <span className="panel__title">
            <Icon name="sliders" size={15} /> Правила скоринга
          </span>
          <div className="btn-row">
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => setState((s) => ({ ...s, scoring: DEFAULT_SCORING }))}>
              <Icon name="refresh" /> По умолчанию
            </button>
            <button type="button" className="btn btn--sm" onClick={addRule}>
              <Icon name="plus" /> Правило
            </button>
          </div>
        </div>
        <div className="table-wrap">
          <table className="table table--compact">
            <caption className="sr-only">Правила скоринга</caption>
            <thead>
              <tr>
                <th>Вкл.</th>
                <th>Название</th>
                <th>Поле</th>
                <th>Условие</th>
                <th>Значение</th>
                <th className="num">Баллы</th>
                <th className="num">Срабатываний</th>
                <th>
                  <span className="sr-only">Удалить</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rules.map((r) => (
                <tr key={r.id} style={{ opacity: r.enabled ? 1 : 0.55 }}>
                  <td>
                    <input type="checkbox" checked={r.enabled} onChange={(e) => updateRule(r.id, { enabled: e.target.checked })} aria-label={`Включить правило «${r.label}»`} style={{ accentColor: 'var(--accent)' }} />
                  </td>
                  <td>
                    <input className="input input--sm" style={{ minWidth: 150 }} value={r.label} onChange={(e) => updateRule(r.id, { label: e.target.value })} aria-label="Название правила" />
                  </td>
                  <td>
                    <select className="select select--sm" value={r.field} onChange={(e) => updateRule(r.id, { field: e.target.value as LeadField })} aria-label="Поле">
                      {LEAD_FIELDS.map((f) => (
                        <option key={f} value={f}>
                          {FIELD_LABELS[f]}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <select className="select select--sm" value={r.operator} onChange={(e) => updateRule(r.id, { operator: e.target.value as RuleOperator })} aria-label="Условие">
                      {(Object.keys(OPERATOR_LABELS) as RuleOperator[]).map((o) => (
                        <option key={o} value={o}>
                          {OPERATOR_LABELS[o]}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    {NO_VALUE.includes(r.operator) ? (
                      <span className="dim">—</span>
                    ) : (
                      <input
                        className="input input--sm"
                        style={{ minWidth: 200 }}
                        value={r.value}
                        onChange={(e) => updateRule(r.id, { value: e.target.value })}
                        placeholder={r.operator === 'contains_any' ? 'через запятую' : 'значение'}
                        inputMode={r.operator.startsWith('number') ? 'numeric' : undefined}
                        aria-label="Значение условия"
                        title={r.value}
                      />
                    )}
                  </td>
                  <td className="num">
                    <input
                      className="input input--sm"
                      type="number"
                      min={-100}
                      max={100}
                      style={{ width: 72, textAlign: 'right' }}
                      value={r.points}
                      onChange={(e) => updateRule(r.id, { points: Math.max(-100, Math.min(100, Number(e.target.value) || 0)) })}
                      aria-label={`Баллы правила «${r.label}»`}
                      data-testid={`points-${r.id}`}
                    />
                  </td>
                  <td className="num mono">{stats.fired.get(r.id) ?? 0}</td>
                  <td>
                    <button type="button" className="btn btn--ghost btn--icon btn--sm" onClick={() => removeRule(r.id)} aria-label={`Удалить правило «${r.label}»`}>
                      <Icon name="trash" size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="table-foot">
          <span>
            Итог = сумма баллов сработавших правил, ограниченная диапазоном 0–100. Максимум при текущих правилах: {maxPossible}.
          </span>
        </div>
      </div>

      <div style={{ display: 'grid', gap: 16, alignContent: 'start' }}>
        <div className="panel">
          <div className="panel__head">
            <span className="panel__title">Пороги категорий</span>
          </div>
          <div className="panel__body" style={{ display: 'grid', gap: 14 }}>
            <label className="field">
              <span className="field__label">
                A — от <b className="mono">{thresholds.a}</b> баллов
              </span>
              <input className="range" type="range" min={0} max={100} value={thresholds.a} onChange={(e) => setThreshold('a', Number(e.target.value))} />
            </label>
            <label className="field">
              <span className="field__label">
                B — от <b className="mono">{thresholds.b}</b> баллов
              </span>
              <input className="range" type="range" min={0} max={100} value={thresholds.b} onChange={(e) => setThreshold('b', Number(e.target.value))} />
            </label>
            <BarList
              ariaLabel="Распределение по категориям"
              max={total}
              items={(['A', 'B', 'C'] as const).map((t) => ({
                key: t,
                label: `Категория ${t}`,
                value: stats.tiers[t],
                display: String(stats.tiers[t]),
                secondary: `${Math.round((stats.tiers[t] / total) * 100)}%`,
              }))}
            />
            <p className="dim" style={{ fontSize: 'var(--fs-xs)' }} data-testid="avg-score">
              Средний балл: {stats.avg.toFixed(1)}
            </p>
          </div>
        </div>
        <div className="panel">
          <div className="panel__head">
            <span className="panel__title">Модель оценки</span>
          </div>
          <div className="panel__body" style={{ display: 'grid', gap: 8, fontSize: 'var(--fs-sm)' }}>
            <span className="cap cap--live">Работает сейчас: правила (локально)</span>
            <span className="cap cap--connect">Требует подключения: ML-модель по вашим сделкам</span>
            <p className="dim" style={{ fontSize: 'var(--fs-xs)' }}>
              Алгоритм — прозрачная сумма правил, а не нейросеть. В индивидуальной версии подключаем модель, обученную на истории ваших сделок, через серверный адаптер с тем же интерфейсом.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
