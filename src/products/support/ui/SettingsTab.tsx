import { useEffect, useState } from 'react';
import { Alert } from '../../../components/ui/Feedback';
import { Icon } from '../../../components/ui/Icon';
import { getAiStatus, type AiStatus } from '../../../lib/ai/adapter';
import { DEFAULT_SETTINGS } from '../logic/demoKb';
import type { SupportSettings, Tone } from '../logic/types';
import type { SetSupport, SupportState } from './state';

const lines = (s: string) => s.split('\n').map((x) => x.trim()).filter(Boolean);

export function SettingsTab({ state, setState }: { state: SupportState; setState: SetSupport }) {
  const s = state.settings;
  const set = (patch: Partial<SupportSettings>) => setState((x) => ({ ...x, settings: { ...x.settings, ...patch } }));
  const [ai, setAi] = useState<AiStatus | null>(null);
  useEffect(() => {
    let alive = true;
    void getAiStatus().then((st) => alive && setAi(st));
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div className="split" style={{ alignItems: 'start' }}>
      <div className="panel">
        <div className="panel__head">
          <h3 className="panel__title">Тон и оформление</h3>
        </div>
        <div className="panel__body" style={{ display: 'grid', gap: 12 }}>
          <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="field__label">Тон ответа</legend>
            <div className="chip-row">
              {(['friendly', 'formal'] as Tone[]).map((t) => (
                <button key={t} type="button" className={`chip${s.tone === t ? ' chip--active' : ''}`} aria-pressed={s.tone === t} onClick={() => set({ tone: t })}>
                  {t === 'friendly' ? 'Дружелюбный' : 'Официальный'}
                </button>
              ))}
            </div>
          </fieldset>
          <label className="field">
            <span className="field__label">Приветствие</span>
            <input className="input" value={s.greeting} maxLength={120} onChange={(e) => set({ greeting: e.target.value })} />
          </label>
          <label className="field">
            <span className="field__label">Подпись</span>
            <input className="input" value={s.signature} maxLength={120} onChange={(e) => set({ signature: e.target.value })} />
          </label>
          <label className="field">
            <span className="field__label">
              Порог уверенности: <b className="mono">{Math.round(s.threshold * 100)}%</b>
            </span>
            <input
              type="range"
              className="range"
              min={0.2}
              max={0.9}
              step={0.05}
              value={s.threshold}
              onChange={(e) => set({ threshold: Number(e.target.value) })}
              data-testid="threshold"
            />
            <span className="field__hint">Доля смысловых слов вопроса, которые должны найтись в источнике. Выше — меньше ответов, но точнее.</span>
          </label>
          <label className="field">
            <span className="field__label">Максимум источников в ответе</span>
            <select className="select" value={s.maxSources} onChange={(e) => set({ maxSources: Number(e.target.value) })}>
              {[1, 2, 3].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <div className="panel" style={{ background: 'var(--surface-2)' }}>
            <div className="panel__body" style={{ display: 'grid', gap: 8 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <span className={`cap ${ai?.available ? 'cap--live' : 'cap--connect'}`} aria-hidden />
                <b style={{ fontSize: 'var(--fs-sm)' }}>Языковая модель</b>
                <span className="badge badge--outline">{ai ? (ai.available ? 'подключена на сервере' : 'требует подключения') : 'проверяем…'}</span>
              </div>
              <p className="dim" style={{ fontSize: 'var(--fs-xs)' }}>
                {ai?.reason ?? 'Проверяем серверную функцию…'} Модель только переформулирует ответ по найденным статьям; при ошибке показывается локальный ответ.
              </p>
              <label className="check">
                <input type="checkbox" checked={s.useModel} disabled={!ai?.available} onChange={(e) => set({ useModel: e.target.checked })} />
                <span>Использовать модель для формулировки (вопрос и фрагменты статей отправляются на сервер сайта и провайдеру модели)</span>
              </label>
            </div>
          </div>
        </div>
      </div>
      <div className="panel">
        <div className="panel__head">
          <h3 className="panel__title">Правила</h3>
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => set({ ...DEFAULT_SETTINGS, useModel: s.useModel })}>
            <Icon name="refresh" /> По умолчанию
          </button>
        </div>
        <div className="panel__body" style={{ display: 'grid', gap: 12 }}>
          <ListField label="Эскалация: слова, при которых вопрос сразу уходит оператору" value={s.escalationKeywords} onChange={(v) => set({ escalationKeywords: v })} />
          <ListField label="Стоп-темы: на них система не отвечает" value={s.stopTopics} onChange={(v) => set({ stopTopics: v })} />
          <ListField label="Синонимы: «слово = вариант, вариант»" value={s.synonyms} onChange={(v) => set({ synonyms: v })} rows={7} />
          <Alert kind="info">Изменения применяются сразу к следующему вопросу в чате и сохраняются в браузере.</Alert>
        </div>
      </div>
    </div>
  );
}

function ListField({ label, value, onChange, rows = 4 }: { label: string; value: string[]; onChange: (v: string[]) => void; rows?: number }) {
  const [text, setText] = useState(value.join('\n'));
  useEffect(() => setText(value.join('\n')), [value]);
  return (
    <label className="field">
      <span className="field__label">{label}</span>
      <textarea className="textarea" rows={rows} value={text} onChange={(e) => setText(e.target.value)} onBlur={() => onChange(lines(text).slice(0, 100))} />
      <span className="field__hint">По одному на строку. Сохраняется при выходе из поля.</span>
    </label>
  );
}
