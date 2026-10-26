import { useState } from 'react';
import { Icon } from '../../../components/ui/Icon';
import { uid } from '../../../lib/id';
import type { CustomRule } from '../logic/types';

export function RulesTab({ rules, onChange }: { rules: CustomRule[]; onChange: (r: CustomRule[]) => void }) {
  const [label, setLabel] = useState('');
  const [keyword, setKeyword] = useState('');
  const [pattern, setPattern] = useState('');
  let patternError = '';
  if (pattern) {
    try {
      new RegExp(pattern);
    } catch {
      patternError = 'Некорректное регулярное выражение';
    }
  }
  const valid = label.trim() && (keyword.trim() || (pattern.trim() && !patternError));
  const add = () => {
    if (!valid) return;
    onChange([...rules, { id: uid('r'), label: label.trim().slice(0, 60), keyword: keyword.trim().slice(0, 60), pattern: pattern.trim().slice(0, 200) || undefined }]);
    setLabel('');
    setKeyword('');
    setPattern('');
  };
  return (
    <div className="split" style={{ alignItems: 'start' }}>
      <div className="panel">
        <div className="panel__head">
          <h3 className="panel__title">Новое поле</h3>
        </div>
        <div className="panel__body" style={{ display: 'grid', gap: 12 }}>
          <label className="field">
            <span className="field__label">Название поля</span>
            <input className="input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="например, Ответственный" data-testid="rule-label" />
          </label>
          <label className="field">
            <span className="field__label">Ключевое слово</span>
            <input className="input" value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="Руководитель" data-testid="rule-keyword" />
            <span className="field__hint">Значение — текст после этого слова в той же строке.</span>
          </label>
          <label className="field">
            <span className="field__label">Или шаблон (регулярное выражение)</span>
            <input className="input mono" value={pattern} onChange={(e) => setPattern(e.target.value)} placeholder="Договор № ([\w-]+)" />
            <span className="field__hint">Значение — первая группа в скобках. Для опытных пользователей.</span>
            {patternError ? <span className="field__error">{patternError}</span> : null}
          </label>
          <button type="button" className="btn btn--primary btn--sm" onClick={add} disabled={!valid} data-testid="rule-add">
            <Icon name="plus" /> Добавить и применить ко всем документам
          </button>
        </div>
      </div>
      <div className="panel">
        <div className="panel__head">
          <h3 className="panel__title">Свои поля ({rules.length})</h3>
        </div>
        <ul className="panel__body list-reset" style={{ display: 'grid', gap: 8 }}>
          {rules.length === 0 ? <li className="dim">Пока нет. Например, добавьте поле «Руководитель» с ключевым словом «Руководитель».</li> : null}
          {rules.map((r) => (
            <li key={r.id} style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'space-between' }}>
              <span>
                <b>{r.label}</b> <span className="dim mono" style={{ fontSize: 'var(--fs-xs)' }}>{r.pattern ? `/${r.pattern}/` : `после «${r.keyword}»`}</span>
              </span>
              <button type="button" className="btn btn--ghost btn--icon btn--sm" aria-label={`Удалить поле ${r.label}`} onClick={() => onChange(rules.filter((x) => x.id !== r.id))}>
                <Icon name="trash" size={14} />
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
