import { useMemo, useState } from 'react';
import { Icon } from '../../../components/ui/Icon';
import { applyRules, netChanges, newRule, renderProductTemplate, RULE_META } from '../logic/rules';
import { CATALOG_FIELDS, FIELD_LABELS, type CatalogField, type Product, type Rule, type RuleType } from '../logic/types';

interface Props {
  rows: Product[];
  rules: Rule[];
  setRules: (r: Rule[]) => void;
  commit: (label: string, next: Product[], toast?: string) => void;
}

const PRICE_FIELDS: CatalogField[] = ['price', 'oldPrice'];

export function RulesTab({ rows, rules, setRules, commit }: Props) {
  const [addType, setAddType] = useState<RuleType>('normalizePrice');
  const [preview, setPreview] = useState<ReturnType<typeof netChanges> | null>(null);
  const update = (id: string, patch: Partial<Rule>) => {
    setRules(rules.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    setPreview(null);
  };
  const move = (i: number, d: number) => {
    const next = [...rules];
    const [r] = next.splice(i, 1);
    next.splice(i + d, 0, r!);
    setRules(next);
    setPreview(null);
  };
  const run = () => setPreview(netChanges(applyRules(rows, rules).changes));
  const apply = () => {
    const { rows: next, changes } = applyRules(rows, rules);
    const n = netChanges(changes).length;
    commit('применение правил', next, `Изменено ячеек: ${n.toLocaleString('ru-RU')}`);
    setPreview(null);
  };
  const posOf = useMemo(() => new Map(rows.map((r, i) => [r.id, i])), [rows]);
  const sample = rows[0];

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div className="split split--side" style={{ alignItems: 'start' }}>
        <div style={{ display: 'grid', gap: 10 }}>
          {rules.length === 0 ? <p className="dim">Правил пока нет. Добавьте первое — например, «Нормализовать цены».</p> : null}
          <ol className="list-reset" style={{ display: 'grid', gap: 10 }} aria-label="Правила преобразования">
            {rules.map((r, i) => (
              <li key={r.id} className={`panel cs-rule${r.enabled ? '' : ' is-off'}`} data-testid={`rule-${r.type}`}>
                <div className="panel__head">
                  <label className="check">
                    <input type="checkbox" checked={r.enabled} onChange={(e) => update(r.id, { enabled: e.target.checked })} />
                    <span>
                      <b>
                        {i + 1}. {RULE_META[r.type].label}
                      </b>
                    </span>
                  </label>
                  <div style={{ display: 'flex', gap: 2 }}>
                    <button type="button" className="btn btn--ghost btn--icon btn--sm" aria-label="Выше" disabled={i === 0} onClick={() => move(i, -1)}>
                      <Icon name="chevronDown" size={14} style={{ transform: 'rotate(180deg)' }} />
                    </button>
                    <button type="button" className="btn btn--ghost btn--icon btn--sm" aria-label="Ниже" disabled={i === rules.length - 1} onClick={() => move(i, 1)}>
                      <Icon name="chevronDown" size={14} />
                    </button>
                    <button type="button" className="btn btn--ghost btn--icon btn--sm" aria-label={`Удалить правило ${RULE_META[r.type].label}`} onClick={() => { setRules(rules.filter((x) => x.id !== r.id)); setPreview(null); }}>
                      <Icon name="trash" size={14} />
                    </button>
                  </div>
                </div>
                <div className="panel__body cs-rule__body">
                  <p className="dim" style={{ fontSize: 'var(--fs-xs)', gridColumn: '1 / -1' }}>
                    {RULE_META[r.type].hint}
                  </p>
                  <RuleFields rule={r} onChange={(p) => update(r.id, p)} />
                  {r.type === 'template' && sample ? (
                    <p style={{ gridColumn: '1 / -1', fontSize: 'var(--fs-xs)' }}>
                      <span className="dim">Пример для первой строки:</span> {renderProductTemplate(r.template ?? '', sample, r.maxLength) || '—'}
                    </p>
                  ) : null}
                </div>
              </li>
            ))}
          </ol>
          <div className="btn-row">
            <label className="sr-only" htmlFor="cs-add-rule">
              Тип правила
            </label>
            <select id="cs-add-rule" className="select" style={{ width: 'auto', height: 36 }} value={addType} onChange={(e) => setAddType(e.target.value as RuleType)}>
              {(Object.keys(RULE_META) as RuleType[]).map((t) => (
                <option key={t} value={t}>
                  {RULE_META[t].label}
                </option>
              ))}
            </select>
            <button type="button" className="btn btn--outline btn--sm" onClick={() => { setRules([...rules, newRule(addType)]); setPreview(null); }} data-testid="rule-add">
              <Icon name="plus" /> Добавить правило
            </button>
          </div>
        </div>
        <div className="panel">
          <div className="panel__head">
            <h3 className="panel__title">Запуск</h3>
          </div>
          <div className="panel__body" style={{ display: 'grid', gap: 10 }}>
            <p className="dim" style={{ fontSize: 'var(--fs-sm)' }}>
              Правила выполняются сверху вниз. Сначала посмотрите предпросмотр: таблица не изменится, пока вы не нажмёте «Применить». Применение можно отменить.
            </p>
            <button type="button" className="btn btn--outline" onClick={run} disabled={!rules.some((r) => r.enabled)} data-testid="rules-preview">
              <Icon name="eye" /> Предпросмотр
            </button>
            <button type="button" className="btn btn--primary" onClick={apply} disabled={!preview || preview.length === 0} data-testid="rules-apply">
              <Icon name="check" /> Применить {preview ? `(${preview.length.toLocaleString('ru-RU')})` : ''}
            </button>
          </div>
        </div>
      </div>
      {preview ? (
        <div className="panel" data-testid="rules-diff">
          <div className="panel__head">
            <h3 className="panel__title">Изменения: {preview.length.toLocaleString('ru-RU')} ячеек</h3>
            {preview.length > 300 ? <span className="dim" style={{ fontSize: 'var(--fs-xs)' }}>показаны первые 300</span> : null}
          </div>
          {preview.length === 0 ? (
            <p className="panel__body dim">Правила ничего не меняют в текущих данных.</p>
          ) : (
            <div className="table-wrap" style={{ maxHeight: 380 }}>
              <table className="table table--compact">
                <caption className="sr-only">Предпросмотр изменений</caption>
                <thead>
                  <tr>
                    <th>Строка</th>
                    <th>Поле</th>
                    <th>Было</th>
                    <th>Станет</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.slice(0, 300).map((c) => (
                    <tr key={`${c.rowId}:${c.field}`}>
                      <td className="mono dim">{(posOf.get(c.rowId) ?? 0) + 2}</td>
                      <td>{FIELD_LABELS[c.field]}</td>
                      <td className="cs-before">{c.before || <span className="dim">пусто</span>}</td>
                      <td className="cell-changed">{c.after || <span className="dim">пусто</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

function FieldSelect({ value, onChange, fields = [...CATALOG_FIELDS], label = 'Поле' }: { value?: CatalogField; onChange: (f: CatalogField) => void; fields?: CatalogField[]; label?: string }) {
  return (
    <label className="field">
      <span className="field__label">{label}</span>
      <select className="select" value={value} onChange={(e) => onChange(e.target.value as CatalogField)}>
        {fields.map((f) => (
          <option key={f} value={f}>
            {FIELD_LABELS[f]}
          </option>
        ))}
      </select>
    </label>
  );
}

function RuleFields({ rule: r, onChange }: { rule: Rule; onChange: (p: Partial<Rule>) => void }) {
  switch (r.type) {
    case 'markup':
      return (
        <>
          <FieldSelect value={r.field} fields={PRICE_FIELDS} onChange={(field) => onChange({ field })} />
          <label className="field">
            <span className="field__label">Процент</span>
            <input type="number" className="input" value={r.num ?? 0} min={-90} max={500} onChange={(e) => onChange({ num: Number(e.target.value) })} />
          </label>
        </>
      );
    case 'round':
      return (
        <>
          <FieldSelect value={r.field} fields={PRICE_FIELDS} onChange={(field) => onChange({ field })} />
          <label className="field">
            <span className="field__label">Способ</span>
            <select className="select" value={r.mode} onChange={(e) => onChange({ mode: e.target.value })}>
              <option value="int">До целого</option>
              <option value="10">До 10</option>
              <option value="99">Вверх до …99</option>
            </select>
          </label>
        </>
      );
    case 'replace':
      return (
        <>
          <FieldSelect value={r.field} onChange={(field) => onChange({ field })} />
          <label className="field">
            <span className="field__label">Найти</span>
            <input className="input" value={r.find ?? ''} onChange={(e) => onChange({ find: e.target.value })} />
          </label>
          <label className="field">
            <span className="field__label">Заменить на</span>
            <input className="input" value={r.replaceWith ?? ''} onChange={(e) => onChange({ replaceWith: e.target.value })} />
          </label>
          <label className="check" style={{ alignSelf: 'end' }}>
            <input type="checkbox" checked={r.mode === 'case'} onChange={(e) => onChange({ mode: e.target.checked ? 'case' : undefined })} />
            <span>Учитывать регистр</span>
          </label>
        </>
      );
    case 'fillEmpty':
      return (
        <>
          <FieldSelect value={r.field} onChange={(field) => onChange({ field })} />
          <label className="field">
            <span className="field__label">Значение</span>
            <input className="input" value={r.replaceWith ?? ''} onChange={(e) => onChange({ replaceWith: e.target.value })} />
          </label>
        </>
      );
    case 'template':
      return (
        <>
          <FieldSelect value={r.field} fields={['seoTitle', 'description', 'name']} onChange={(field) => onChange({ field })} label="Куда записать" />
          <label className="field">
            <span className="field__label">Лимит длины</span>
            <input type="number" className="input" min={0} max={5000} value={r.maxLength ?? 0} onChange={(e) => onChange({ maxLength: Number(e.target.value) || undefined })} />
          </label>
          <label className="field" style={{ gridColumn: '1 / -1' }}>
            <span className="field__label">Шаблон</span>
            <input className="input" value={r.template ?? ''} onChange={(e) => onChange({ template: e.target.value })} />
            <span className="field__hint">
              Подстановки: {CATALOG_FIELDS.map((f) => `{{${FIELD_LABELS[f]}}}`).join(' ')}. Запасное значение: {'{{Бренд|без бренда}}'}.
            </span>
          </label>
          <label className="check">
            <input type="checkbox" checked={Boolean(r.onlyEmpty)} onChange={(e) => onChange({ onlyEmpty: e.target.checked })} />
            <span>Только пустые</span>
          </label>
        </>
      );
    default:
      return null;
  }
}
