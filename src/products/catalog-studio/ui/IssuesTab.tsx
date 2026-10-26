import { Icon } from '../../../components/ui/Icon';
import { CATALOG_FIELDS, FIELD_LABELS, ISSUE_META, type CatalogField, type CheckSettings, type IssueKind } from '../logic/types';
import { safeRegex } from '../logic/issues';

interface Props {
  summary: Array<{ kind: IssueKind; count: number; rows: number }>;
  total: number;
  checks: CheckSettings;
  setChecks: (c: CheckSettings) => void;
  mapped: Set<CatalogField>;
  openKind: (k: IssueKind) => void;
  goRules: () => void;
}

export function IssuesTab({ summary, total, checks, setChecks, mapped, openKind, goRules }: Props) {
  const errors = summary.filter((s) => ISSUE_META[s.kind].severity === 'error').reduce((a, s) => a + s.count, 0);
  const warns = summary.filter((s) => ISSUE_META[s.kind].severity === 'warning').reduce((a, s) => a + s.count, 0);
  const patternOk = !checks.skuPattern || safeRegex(checks.skuPattern) !== null;
  return (
    <div className="split split--side" style={{ alignItems: 'start' }}>
      <div style={{ display: 'grid', gap: 12 }}>
        <div className="stat-grid">
          <div className="stat">
            <div className="stat__label">Строк</div>
            <div className="stat__value">{total.toLocaleString('ru-RU')}</div>
          </div>
          <div className="stat">
            <div className="stat__label">Ошибки</div>
            <div className="stat__value" data-testid="cs-errors">{errors}</div>
          </div>
          <div className="stat">
            <div className="stat__label">Предупреждения</div>
            <div className="stat__value">{warns}</div>
          </div>
        </div>
        {summary.length === 0 ? (
          <div className="alert alert--good">
            <Icon name="checkCircle" /> Проблем не найдено.
          </div>
        ) : (
          <div className="issue-grid">
            {summary.map((s) => {
              const meta = ISSUE_META[s.kind];
              return (
                <button key={s.kind} type="button" className={`issue-card issue-card--${meta.severity}`} onClick={() => openKind(s.kind)} data-testid={`issue-${s.kind}`}>
                  <span className="issue-card__count">{s.count}</span>
                  <span className="issue-card__label">{meta.label}</span>
                  <small className="dim">
                    {meta.severity === 'error' ? 'ошибка' : meta.severity === 'warning' ? 'предупреждение' : 'совет'} · строк: {s.rows}
                  </small>
                  {meta.fix ? <small style={{ color: 'var(--accent)' }}>{meta.fix}</small> : null}
                </button>
              );
            })}
          </div>
        )}
        {summary.some((s) => ISSUE_META[s.kind].fix?.startsWith('Правило')) ? (
          <button type="button" className="btn btn--primary btn--sm" style={{ justifySelf: 'start' }} onClick={goRules}>
            <Icon name="wand" /> Исправить правилами
          </button>
        ) : null}
      </div>
      <div className="panel">
        <div className="panel__head">
          <h3 className="panel__title">Настройки проверок</h3>
        </div>
        <div className="panel__body" style={{ display: 'grid', gap: 12 }}>
          <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="field__label">Обязательные поля</legend>
            <div style={{ display: 'grid', gap: 4 }}>
              {CATALOG_FIELDS.filter((f) => mapped.has(f)).map((f) => (
                <label key={f} className="check">
                  <input
                    type="checkbox"
                    checked={checks.required.includes(f)}
                    onChange={(e) => setChecks({ ...checks, required: e.target.checked ? [...checks.required, f] : checks.required.filter((x) => x !== f) })}
                  />
                  <span>{FIELD_LABELS[f]}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <label className="field">
            <span className="field__label">Шаблон артикула (регулярное выражение)</span>
            <input className="input mono" value={checks.skuPattern} onChange={(e) => setChecks({ ...checks, skuPattern: e.target.value })} aria-invalid={!patternOk} />
            {patternOk ? <span className="field__hint">Пусто — не проверять. По умолчанию: три латинские буквы, дефис, пять цифр.</span> : <span className="field__error">Некорректное выражение — проверка отключена</span>}
          </label>
          <label className="field">
            <span className="field__label">Максимальная длина названия</span>
            <input type="number" min={20} max={500} className="input" value={checks.maxNameLength} onChange={(e) => setChecks({ ...checks, maxNameLength: Math.max(20, Math.min(500, Number(e.target.value) || 120)) })} />
          </label>
        </div>
      </div>
    </div>
  );
}
