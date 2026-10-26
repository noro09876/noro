import { useState } from 'react';
import { Icon } from '../../../components/ui/Icon';
import { UploadButton } from '../../../components/ui/UploadButton';
import { useToast } from '../../../components/ui/Toast';
import { decodeText, readFileBuffer, validateFile } from '../../../lib/files';
import { MAX_SOURCE, MIN_SOURCE, validateSource } from '../logic/analyze';
import { PLATFORMS, PLATFORM_IDS, TONE_LABELS, type PlatformId, type Project, type Tone } from '../logic/types';

interface Props {
  project: Project;
  onChange: (patch: Partial<Project>) => void;
  onBuild: () => void;
}

export function ProjectTab({ project: p, onChange, onBuild }: Props) {
  const toast = useToast();
  const [touched, setTouched] = useState(false);
  const error = validateSource(p.source);
  const togglePlatform = (id: PlatformId) =>
    onChange({ platforms: p.platforms.includes(id) ? p.platforms.filter((x) => x !== id) : PLATFORM_IDS.filter((x) => x === id || p.platforms.includes(x)) });

  const loadFile = async (file: File) => {
    try {
      validateFile(file, { extensions: ['txt', 'md', 'markdown'], maxBytes: 512 * 1024 });
      const { text } = decodeText(await readFileBuffer(file));
      onChange({ source: text.slice(0, MAX_SOURCE + 1000) });
      toast.success(`Загружен текст: ${text.length.toLocaleString('ru-RU')} символов`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Не удалось прочитать файл');
    }
  };

  return (
    <div className="split split--side" style={{ alignItems: 'start' }}>
      <div className="panel">
        <div className="panel__head">
          <h3 className="panel__title">
            <Icon name="fileText" size={16} /> Исходный материал
          </h3>
          <UploadButton accept=".txt,.md,.markdown" onFile={(f) => void loadFile(f)}>
            .txt / .md
          </UploadButton>
        </div>
        <div className="panel__body" style={{ display: 'grid', gap: 8 }}>
          <label className="sr-only" htmlFor="co-source">
            Исходный текст
          </label>
          <textarea
            id="co-source"
            className="textarea"
            rows={18}
            value={p.source}
            onChange={(e) => onChange({ source: e.target.value })}
            onBlur={() => setTouched(true)}
            placeholder="Вставьте статью, расшифровку вебинара, заметки эксперта…"
            data-testid="co-source"
            aria-invalid={touched && Boolean(error)}
            aria-describedby="co-source-hint"
          />
          <div id="co-source-hint" className="field__hint" style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
            <span>От {MIN_SOURCE} до {MAX_SOURCE.toLocaleString('ru-RU')} символов. Абзацы разделяйте пустой строкой.</span>
            <span className="mono">{p.source.trim().length.toLocaleString('ru-RU')} симв.</span>
          </div>
          {touched && error ? <p className="field__error">{error}</p> : null}
        </div>
      </div>
      <div className="panel">
        <div className="panel__head">
          <h3 className="panel__title">Параметры</h3>
        </div>
        <div className="panel__body" style={{ display: 'grid', gap: 12 }}>
          <label className="field">
            <span className="field__label">Название проекта</span>
            <input className="input" value={p.name} maxLength={120} onChange={(e) => onChange({ name: e.target.value })} />
          </label>
          <label className="field">
            <span className="field__label">Тема (для заголовков)</span>
            <input className="input" value={p.topic} maxLength={120} onChange={(e) => onChange({ topic: e.target.value })} placeholder="например, потеря заявок" />
          </label>
          <label className="field">
            <span className="field__label">Аудитория</span>
            <input className="input" value={p.audience} maxLength={120} onChange={(e) => onChange({ audience: e.target.value })} />
          </label>
          <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="field__label">Тон</legend>
            <div className="chip-row">
              {(Object.keys(TONE_LABELS) as Tone[]).map((t) => (
                <button key={t} type="button" className={`chip${p.tone === t ? ' chip--active' : ''}`} aria-pressed={p.tone === t} onClick={() => onChange({ tone: t })} data-testid={`tone-${t}`}>
                  {TONE_LABELS[t]}
                </button>
              ))}
            </div>
          </fieldset>
          <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="field__label">Площадки</legend>
            <div style={{ display: 'grid', gap: 6 }}>
              {PLATFORM_IDS.map((id) => (
                <label key={id} className="check">
                  <input type="checkbox" checked={p.platforms.includes(id)} onChange={() => togglePlatform(id)} />
                  <span>
                    {PLATFORMS[id].label} <span className="dim">· {PLATFORMS[id].kind}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          <label className="field">
            <span className="field__label">Дата старта публикаций</span>
            <input type="date" className="input" value={p.startDate} onChange={(e) => e.target.value && onChange({ startDate: e.target.value })} />
          </label>
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => {
              setTouched(true);
              if (!error && p.platforms.length) onBuild();
            }}
            disabled={!p.platforms.length}
            data-testid="co-build"
          >
            <Icon name="wand" /> {p.analysis ? 'Пересобрать материалы' : 'Собрать материалы'}
          </button>
          {!p.platforms.length ? <p className="field__error">Выберите хотя бы одну площадку.</p> : null}
          <p className="dim" style={{ fontSize: 'var(--fs-xs)' }}>
            Черновики собираются локально из тезисов вашего текста по шаблонам площадок. Это не генерация ИИ: новые факты не добавляются.
          </p>
        </div>
      </div>
    </div>
  );
}
