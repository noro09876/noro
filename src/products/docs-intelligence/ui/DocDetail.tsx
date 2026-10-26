import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '../../../components/ui/Icon';
import { fmtDateTime, fmtMoney } from '../../../lib/format';
import { computeChecks, REQUIRED } from '../logic/checks';
import { DOC_STATUS_LABELS, DOC_TYPE_LABELS, FIELD_KEYS, FIELD_LABELS, type Check, type CustomRule, type DocRecord, type DocStatus, type DocType, type FieldKey } from '../logic/types';

interface Props {
  doc: DocRecord;
  rules: CustomRule[];
  onChange: (doc: DocRecord, historyText?: string) => void;
}

const LEVEL_ICON = { error: 'alertCircle', warning: 'alert', ok: 'checkCircle' } as const;

export function DocDetail({ doc, rules, onChange }: Props) {
  const checks = useMemo(() => computeChecks(doc), [doc]);
  const [focus, setFocus] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const byField = useMemo(() => {
    const m = new Map<string, Check[]>();
    for (const c of checks) if (c.field) m.set(c.field, [...(m.get(c.field) ?? []), c]);
    return m;
  }, [checks]);
  const errors = checks.filter((c) => c.level === 'error').length;
  const warnings = checks.filter((c) => c.level === 'warning').length;

  const visibleKeys = FIELD_KEYS.filter((k) => showAll || doc.fields[k] || REQUIRED[doc.type].includes(k) || byField.has(k));
  const sourceLine = focus ? (doc.fields[focus as FieldKey]?.source ?? doc.custom[focus]?.source ?? null) : null;

  const setField = (key: FieldKey, value: string) => {
    const prev = doc.fields[key];
    if ((prev?.value ?? '') === value) return;
    onChange(
      { ...doc, fields: { ...doc.fields, [key]: { value, source: prev?.source ?? 'введено вручную', confidence: 'high', edited: true } }, updatedAt: Date.now() },
      `${FIELD_LABELS[key]}: «${prev?.value ?? ''}» → «${value}»`,
    );
  };

  if (doc.type === 'registry' && doc.registry) {
    const rowIssues = new Map<number, Check[]>();
    for (const c of checks) if (c.field?.startsWith('row:')) {
      const i = Number(c.field.slice(4));
      rowIssues.set(i, [...(rowIssues.get(i) ?? []), c]);
    }
    return (
      <div style={{ display: 'grid', gap: 12 }}>
        <Header doc={doc} errors={errors} warnings={warnings} onChange={onChange} />
        <div className="table-wrap" style={{ maxHeight: 420 }}>
          <table className="table table--compact">
            <caption className="sr-only">Строки реестра</caption>
            <thead>
              <tr>
                <th>#</th>
                {doc.registry.headers.map((h) => (
                  <th key={h}>{h}</th>
                ))}
                <th>Проверка</th>
              </tr>
            </thead>
            <tbody>
              {doc.registry.rows.map((r) => {
                const issues = rowIssues.get(r.index) ?? [];
                return (
                  <tr key={r.index} className={issues.some((i) => i.level === 'error') ? 'row-error' : issues.length ? 'row-warning' : undefined}>
                    <td className="mono dim">{r.index + 2}</td>
                    {doc.registry!.headers.map((h) => (
                      <td key={h}>{r.cells[h] || <span className="dim">—</span>}</td>
                    ))}
                    <td style={{ minWidth: 220 }}>
                      {issues.length ? issues.map((i) => <div key={i.id} className={`chk chk--${i.level}`}>{i.title.replace(/^Строка \d+: /, '')}</div>) : <span className="chk chk--ok">OK</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <Header doc={doc} errors={errors} warnings={warnings} onChange={onChange} />
      <div className="split" style={{ alignItems: 'start' }}>
        <div className="panel">
          <div className="panel__head">
            <h3 className="panel__title">Поля</h3>
            <label className="check" style={{ fontSize: 'var(--fs-xs)' }}>
              <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
              <span>Все поля</span>
            </label>
          </div>
          <div className="panel__body doc-fields">
            {visibleKeys.map((k) => {
              const fc = byField.get(k) ?? [];
              const level = fc.some((c) => c.level === 'error') ? 'error' : fc.some((c) => c.level === 'warning') ? 'warning' : fc.some((c) => c.level === 'ok') ? 'ok' : null;
              const f = doc.fields[k];
              return (
                <div key={k} className={`doc-field${level ? ` doc-field--${level}` : ''}`}>
                  <label className="field__label" htmlFor={`df-${k}`}>
                    {FIELD_LABELS[k]}
                    {REQUIRED[doc.type].includes(k) ? <span aria-hidden> *</span> : null}
                    {f?.edited ? <span className="badge badge--info" style={{ marginLeft: 6 }}>изменено</span> : f?.confidence === 'low' || f?.confidence === 'medium' ? <span className="badge badge--outline" style={{ marginLeft: 6 }}>проверьте</span> : null}
                  </label>
                  <div className="doc-field__row">
                    <input
                      id={`df-${k}`}
                      key={`${doc.id}-${k}-${f?.value ?? ''}`}
                      className="input input--sm"
                      defaultValue={f?.value ?? ''}
                      placeholder="не найдено"
                      onFocus={() => setFocus(k)}
                      onBlur={(e) => setField(k, e.target.value.trim())}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                      }}
                      aria-invalid={level === 'error'}
                      aria-describedby={fc.length ? `dfc-${k}` : undefined}
                      data-testid={`field-${k}`}
                    />
                    {level ? <Icon name={LEVEL_ICON[level]} size={16} className={`chk-ico chk-ico--${level}`} aria-hidden /> : null}
                  </div>
                  {fc.filter((c) => c.level !== 'ok').length ? (
                    <div id={`dfc-${k}`} className={`chk chk--${level}`}>
                      {fc.filter((c) => c.level !== 'ok').map((c) => c.title).join('; ')}
                    </div>
                  ) : null}
                </div>
              );
            })}
            {rules.length ? (
              <>
                <div className="field__label" style={{ marginTop: 8 }}>Свои поля</div>
                {rules.map((r) => (
                  <div key={r.id} className="doc-field">
                    <span className="field__label">{r.label}</span>
                    <button type="button" className="input input--sm doc-field__ro" onClick={() => setFocus(r.id)}>
                      {doc.custom[r.id]?.value ?? <span className="dim">не найдено</span>}
                    </button>
                  </div>
                ))}
              </>
            ) : null}
          </div>
        </div>
        <div style={{ display: 'grid', gap: 12, minWidth: 0 }}>
          <div className="panel">
            <div className="panel__head">
              <h3 className="panel__title">Проверки</h3>
            </div>
            <ul className="panel__body list-reset doc-checks" data-testid="doc-checks">
              {checks.length === 0 ? <li className="dim">Нет данных для проверок.</li> : null}
              {[...checks]
                .sort((a, b) => ['error', 'warning', 'ok'].indexOf(a.level) - ['error', 'warning', 'ok'].indexOf(b.level))
                .map((c) => (
                  <li key={c.id} className={`doc-check doc-check--${c.level}`} data-level={c.level}>
                    <Icon name={LEVEL_ICON[c.level]} size={16} />
                    <div>
                      <b>{c.title}</b>
                      <small>{c.detail}</small>
                    </div>
                  </li>
                ))}
            </ul>
          </div>
          {doc.items.length ? (
            <div className="panel">
              <div className="panel__head">
                <h3 className="panel__title">Позиции ({doc.items.length})</h3>
              </div>
              <div className="table-wrap">
                <table className="table table--compact">
                  <caption className="sr-only">Позиции документа</caption>
                  <thead>
                    <tr>
                      <th>№</th>
                      <th>Наименование</th>
                      <th className="num">Кол-во</th>
                      <th className="num">Цена</th>
                      <th className="num">Сумма</th>
                    </tr>
                  </thead>
                  <tbody>
                    {doc.items.map((i) => (
                      <tr key={i.n} className={Math.abs(i.qty * i.price - i.sum) > 0.011 ? 'row-error' : undefined}>
                        <td className="mono">{i.n}</td>
                        <td>{i.name}</td>
                        <td className="num">{i.qty}</td>
                        <td className="num">{fmtMoney(i.price)}</td>
                        <td className="num">{fmtMoney(i.sum)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
          <div className="panel">
            <div className="panel__head">
              <h3 className="panel__title">Исходный текст</h3>
              {sourceLine ? <span className="badge badge--accent">подсвечена строка поля</span> : <span className="dim" style={{ fontSize: 'var(--fs-xs)' }}>выберите поле, чтобы увидеть источник</span>}
            </div>
            <SourceText text={doc.text} highlight={sourceLine} />
          </div>
        </div>
      </div>
      {doc.history.length > 1 ? (
        <details className="panel">
          <summary className="panel__head" style={{ cursor: 'pointer' }}>
            <span className="panel__title">История изменений ({doc.history.length})</span>
          </summary>
          <ul className="panel__body list-reset timeline">
            {[...doc.history].reverse().map((h, i) => (
              <li key={`${h.at}-${i}`}>
                <div>
                  <time>{fmtDateTime(h.at)}</time>
                  {h.text}
                </div>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

function Header({ doc, errors, warnings, onChange }: { doc: DocRecord; errors: number; warnings: number; onChange: Props['onChange'] }) {
  return (
    <div className="doc-head">
      <div style={{ minWidth: 0 }}>
        <h3 className="doc-head__title">{doc.fileName}</h3>
        <div className="dim" style={{ fontSize: 'var(--fs-xs)' }}>
          {DOC_TYPE_LABELS[doc.type]} · определено: {doc.typeReason}
        </div>
      </div>
      <div className="chip-row">
        <span className={`badge ${errors ? 'badge--critical' : 'badge--good'}`} data-testid="doc-errors">
          {errors ? `Ошибок: ${errors}` : 'Ошибок нет'}
        </span>
        {warnings ? <span className="badge badge--warning">Предупреждений: {warnings}</span> : null}
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <label className="sr-only" htmlFor="doc-type">
          Тип документа
        </label>
        {doc.type !== 'registry' ? (
          <select id="doc-type" className="select" style={{ height: 32 }} value={doc.type} onChange={(e) => onChange({ ...doc, type: e.target.value as DocType, typeReason: 'выбрано вручную', updatedAt: Date.now() }, `Тип: ${DOC_TYPE_LABELS[e.target.value as DocType]}`)}>
            {(Object.keys(DOC_TYPE_LABELS) as DocType[])
              .filter((t) => t !== 'registry')
              .map((t) => (
                <option key={t} value={t}>
                  {DOC_TYPE_LABELS[t]}
                </option>
              ))}
          </select>
        ) : null}
        <label className="sr-only" htmlFor="doc-status">
          Статус проверки
        </label>
        <select
          id="doc-status"
          className="select"
          style={{ height: 32 }}
          value={doc.status}
          onChange={(e) => onChange({ ...doc, status: e.target.value as DocStatus, updatedAt: Date.now() }, `Статус: ${DOC_STATUS_LABELS[e.target.value as DocStatus]}`)}
          data-testid="doc-status"
        >
          {(Object.keys(DOC_STATUS_LABELS) as DocStatus[]).map((s) => (
            <option key={s} value={s}>
              {DOC_STATUS_LABELS[s]}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

function SourceText({ text, highlight }: { text: string; highlight: string | null }) {
  const ref = useRef<HTMLPreElement>(null);
  const lines = text.split('\n');
  const idx = highlight ? lines.findIndex((l) => l.trim() === highlight.trim() || (highlight.length > 20 && l.includes(highlight.slice(0, 60)))) : -1;
  useEffect(() => {
    const pre = ref.current;
    const el = pre?.querySelector<HTMLElement>('.is-hl');
    // scroll only inside the panel, never the page
    if (pre && el) pre.scrollTop = el.offsetTop - pre.clientHeight / 2;
  }, [idx]);
  return (
    <pre ref={ref} className="doc-source" tabIndex={0} aria-label="Исходный текст документа">
      {lines.slice(0, 600).map((l, i) => (
        <span key={i} className={i === idx ? 'is-hl' : undefined}>
          {l || ' '}
          {'\n'}
        </span>
      ))}
      {lines.length > 600 ? <span className="dim">… ещё {lines.length - 600} строк</span> : null}
    </pre>
  );
}
