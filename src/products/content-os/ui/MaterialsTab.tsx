import { useEffect, useState } from 'react';
import { EmptyState } from '../../../components/ui/Feedback';
import { Icon } from '../../../components/ui/Icon';
import { Modal } from '../../../components/ui/Modal';
import { useToast } from '../../../components/ui/Toast';
import { copyText } from '../../../lib/download';
import { fmtDateTime } from '../../../lib/format';
import { lengthState } from '../logic/generate';
import { PLATFORMS, STATUSES, STATUS_LABELS, type ContentItem, type ItemStatus, type Project } from '../logic/types';

interface Props {
  project: Project;
  updateItem: (id: string, patch: Partial<ContentItem>, versionLabel?: string) => void;
  onRebuild: (overwrite: boolean) => void;
  onVariant: () => void;
  goToProject: () => void;
  initialItemId?: string | null;
}

export function MaterialsTab({ project: p, updateItem, onRebuild, onVariant, goToProject, initialItemId }: Props) {
  const toast = useToast();
  const [activeId, setActiveId] = useState<string | null>(initialItemId ?? p.items[0]?.id ?? null);
  const active = p.items.find((i) => i.id === activeId) ?? p.items[0] ?? null;
  const [title, setTitle] = useState(active?.title ?? '');
  const [body, setBody] = useState(active?.body ?? '');
  const [history, setHistory] = useState(false);
  useEffect(() => {
    setTitle(active?.title ?? '');
    setBody(active?.body ?? '');
  }, [active?.id, active?.title, active?.body]);

  if (!p.analysis || !p.items.length) {
    return (
      <EmptyState icon="layers" title="Материалы ещё не собраны" text="Вставьте исходный текст, выберите площадки и нажмите «Собрать материалы».">
        <button type="button" className="btn btn--primary btn--sm" onClick={goToProject}>
          К исходнику
        </button>
      </EmptyState>
    );
  }
  const a = p.analysis;
  const dirty = active ? title !== active.title || body !== active.body : false;
  const len = active ? lengthState(active.platform, body) : null;
  const copy = (t: string, what: string) => void copyText(t).then((ok) => (ok ? toast.success(`${what} скопирован${what.endsWith('а') ? 'а' : ''}`) : toast.error('Не удалось скопировать')));

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div className="co-analysis">
        <div className="panel">
          <div className="panel__head">
            <h3 className="panel__title">Тезисы</h3>
            <span className="badge badge--outline">{a.stats.words} слов · {a.stats.readingMinutes} мин чтения</span>
          </div>
          <ol className="panel__body co-theses" data-testid="co-theses">
            {a.theses.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ol>
        </div>
        <div className="panel">
          <div className="panel__head">
            <h3 className="panel__title">Заголовки и призывы</h3>
          </div>
          <div className="panel__body" style={{ display: 'grid', gap: 10 }}>
            <ul className="list-reset co-copylist" data-testid="co-headlines">
              {a.headlines.map((h) => (
                <li key={h}>
                  <span>{h}</span>
                  <button type="button" className="btn btn--ghost btn--icon btn--sm" aria-label={`Копировать заголовок «${h}»`} onClick={() => copy(h, 'Заголовок')}>
                    <Icon name="copy" size={14} />
                  </button>
                </li>
              ))}
            </ul>
            <div className="chip-row" aria-label="Ключевые слова">
              {a.keywords.map((k) => (
                <span key={k} className="badge badge--accent">
                  {k}
                </span>
              ))}
            </div>
            <div>
              <div className="field__label" style={{ marginBottom: 4 }}>Призывы к действию</div>
              <ul className="list-reset co-ctas">
                {a.ctas.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </div>

      <div className="toolbar">
        <div className="tabs co-items" role="tablist" aria-label="Материалы по площадкам">
          {p.items.map((i) => (
            <button
              key={i.id}
              type="button"
              role="tab"
              aria-selected={i.id === active?.id}
              className="tab"
              onClick={() => {
                if (dirty && !window.confirm('Есть несохранённые изменения. Перейти без сохранения?')) return;
                setActiveId(i.id);
              }}
              data-testid={`co-item-${i.platform}`}
            >
              {PLATFORMS[i.platform].label}
              <span className={`co-dot co-dot--${i.status}`} role="img" aria-label={STATUS_LABELS[i.status]} />
            </button>
          ))}
        </div>
        <span className="toolbar__spacer" />
        <button type="button" className="btn btn--ghost btn--sm" onClick={onVariant} title="Другие заголовки, вступления и призывы">
          <Icon name="refresh" /> Другой вариант
        </button>
        <button type="button" className="btn btn--ghost btn--sm" onClick={() => onRebuild(false)}>
          <Icon name="wand" /> Пересобрать
        </button>
      </div>

      {active ? (
        <div className="split split--side" style={{ alignItems: 'start' }} role="tabpanel" aria-label={PLATFORMS[active.platform].label}>
          <div className="panel">
            <div className="panel__head">
              <h3 className="panel__title">
                {PLATFORMS[active.platform].label} <span className="dim">· {PLATFORMS[active.platform].kind}</span>
              </h3>
              {active.edited ? <span className="badge badge--info">Отредактировано вручную</span> : <span className="badge badge--outline">Черновик по шаблону</span>}
            </div>
            <div className="panel__body" style={{ display: 'grid', gap: 10 }}>
              <label className="field">
                <span className="field__label">Заголовок / тема</span>
                <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={300} />
                {PLATFORMS[active.platform].titleMax && title.length > PLATFORMS[active.platform].titleMax! ? (
                  <span className="field__error">
                    Длиннее {PLATFORMS[active.platform].titleMax} символов — площадка может обрезать
                  </span>
                ) : null}
              </label>
              <label className="field">
                <span className="field__label">Текст</span>
                <textarea className="textarea mono-soft" rows={16} value={body} onChange={(e) => setBody(e.target.value)} data-testid="co-body" />
              </label>
              {len ? (
                <div className={`co-len co-len--${len.level}`} data-testid="co-length">
                  <div className="co-len__bar">
                    <span style={{ width: `${Math.min(100, (len.len / PLATFORMS[active.platform].recommended[1]) * 100)}%` }} />
                  </div>
                  <span className="mono">
                    {len.len.toLocaleString('ru-RU')} / {PLATFORMS[active.platform].maxChars.toLocaleString('ru-RU')}
                  </span>
                  <span>{len.hint}</span>
                </div>
              ) : null}
              <div className="btn-row">
                <button
                  type="button"
                  className="btn btn--primary btn--sm"
                  disabled={!dirty || len?.level === 'over'}
                  onClick={() => {
                    updateItem(active.id, { title, body, edited: true }, 'Ручная правка');
                    toast.success('Сохранено. Прошлая версия — в истории');
                  }}
                  data-testid="co-save"
                >
                  <Icon name="check" /> Сохранить
                </button>
                <button type="button" className="btn btn--outline btn--sm" onClick={() => copy(`${title}\n\n${body}`, 'Текст')}>
                  <Icon name="copy" /> Копировать
                </button>
                <button type="button" className="btn btn--ghost btn--sm" onClick={() => setHistory(true)} disabled={!active.versions.length} data-testid="co-history">
                  <Icon name="history" /> История ({active.versions.length})
                </button>
                {dirty ? (
                  <button type="button" className="btn btn--ghost btn--sm" onClick={() => { setTitle(active.title); setBody(active.body); }}>
                    Отменить правки
                  </button>
                ) : null}
              </div>
            </div>
          </div>
          <div className="panel">
            <div className="panel__head">
              <h3 className="panel__title">Публикация</h3>
            </div>
            <div className="panel__body" style={{ display: 'grid', gap: 12 }}>
              <label className="field">
                <span className="field__label">Статус</span>
                <select className="select" value={active.status} onChange={(e) => updateItem(active.id, { status: e.target.value as ItemStatus })} data-testid="co-status">
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {STATUS_LABELS[s]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span className="field__label">Дата публикации</span>
                <input type="date" className="input" value={active.date} onChange={(e) => e.target.value && updateItem(active.id, { date: e.target.value })} />
              </label>
              <p className="dim" style={{ fontSize: 'var(--fs-xs)' }}>
                «Опубликовано» — отметка для вашего учёта. Автопубликация в {PLATFORMS[active.platform].label} требует подключения API площадки.
              </p>
            </div>
          </div>
        </div>
      ) : null}

      {history && active ? (
        <Modal open title={`История: ${PLATFORMS[active.platform].label}`} onClose={() => setHistory(false)} wide>
          <ul className="list-reset" style={{ display: 'grid', gap: 12 }}>
            {[...active.versions].reverse().map((v, i) => (
              <li key={`${v.at}-${i}`} className="panel">
                <div className="panel__head">
                  <span className="mono dim" style={{ fontSize: 'var(--fs-xs)' }}>
                    {fmtDateTime(v.at)} · {v.label}
                  </span>
                  <button
                    type="button"
                    className="btn btn--outline btn--sm"
                    onClick={() => {
                      updateItem(active.id, { title: v.title, body: v.body, edited: true }, 'Перед восстановлением');
                      setHistory(false);
                      toast.success('Версия восстановлена');
                    }}
                  >
                    <Icon name="undo" /> Восстановить
                  </button>
                </div>
                <pre className="panel__body co-version">{v.body}</pre>
              </li>
            ))}
          </ul>
        </Modal>
      ) : null}
    </div>
  );
}
