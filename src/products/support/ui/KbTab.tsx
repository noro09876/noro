import { useEffect, useMemo, useState } from 'react';
import { EmptyState } from '../../../components/ui/Feedback';
import { Icon } from '../../../components/ui/Icon';
import { UploadButton } from '../../../components/ui/UploadButton';
import { useToast } from '../../../components/ui/Toast';
import { downloadFile, stamp } from '../../../lib/download';
import { decodeText, readFileBuffer, validateFile } from '../../../lib/files';
import { fmtDate } from '../../../lib/format';
import { uid } from '../../../lib/id';
import { articlesFromJson, articlesFromText } from '../logic/importer';
import type { Article } from '../logic/types';
import type { SetSupport, SupportState } from './state';

export async function importKbFile(file: File): Promise<Article[]> {
  const ext = validateFile(file, { extensions: ['md', 'txt', 'json', 'markdown'], maxBytes: 2 * 1024 * 1024 });
  const { text } = decodeText(await readFileBuffer(file));
  if (ext === 'json') return articlesFromJson(text);
  const list = articlesFromText(text, file.name);
  if (!list.length) throw new Error('В файле нет текста для статей.');
  return list;
}

interface Props {
  state: SupportState;
  setState: SetSupport;
  selectedId: string | null;
  setSelectedId: (id: string | null) => void;
  /** title to prefill a new article with (from «вопросы без ответа») */
  prefill?: string;
}

export function KbTab({ state, setState, selectedId, setSelectedId, prefill = '' }: Props) {
  const toast = useToast();
  const [q, setQ] = useState('');
  const selected = state.articles.find((a) => a.id === selectedId) ?? null;
  const [form, setForm] = useState({ title: '', category: '', body: '' });
  useEffect(() => {
    setForm(selected ? { title: selected.title, category: selected.category, body: selected.body } : { title: prefill, category: '', body: '' });
  }, [selected, prefill]);

  const list = useMemo(() => {
    const n = q.trim().toLowerCase();
    return state.articles.filter((a) => !n || a.title.toLowerCase().includes(n) || a.body.toLowerCase().includes(n) || a.category.toLowerCase().includes(n));
  }, [state.articles, q]);

  const dirty = selected ? form.title !== selected.title || form.body !== selected.body || form.category !== selected.category : Boolean(form.title || form.body);
  const valid = form.title.trim().length > 0 && form.body.trim().length >= 10;

  const save = () => {
    if (!valid) return;
    const article: Article = {
      id: selected?.id ?? uid('kb'),
      title: form.title.trim().slice(0, 200),
      category: form.category.trim() || 'Без категории',
      body: form.body.trim().slice(0, 20000),
      updatedAt: Date.now(),
    };
    setState((s) => ({ ...s, articles: selected ? s.articles.map((a) => (a.id === article.id ? article : a)) : [article, ...s.articles] }));
    setSelectedId(article.id);
    toast.success(selected ? 'Статья обновлена — поиск пересчитан' : 'Статья добавлена — задайте по ней вопрос в чате');
  };

  const remove = () => {
    if (!selected) return;
    const removed = selected;
    const idx = state.articles.findIndex((a) => a.id === removed.id);
    setState((s) => ({ ...s, articles: s.articles.filter((a) => a.id !== removed.id) }));
    setSelectedId(null);
    toast.success(`Статья «${removed.title}» удалена`, {
      action: {
        label: 'Отменить',
        onClick: () =>
          setState((s) => {
            const next = [...s.articles];
            next.splice(Math.min(idx, next.length), 0, removed);
            return { ...s, articles: next };
          }),
      },
    });
  };

  const onImport = async (file: File) => {
    try {
      const imported = await importKbFile(file);
      setState((s) => {
        const ids = new Set(s.articles.map((a) => a.id));
        return { ...s, articles: [...imported.map((a) => (ids.has(a.id) ? { ...a, id: uid('kb') } : a)), ...s.articles] };
      });
      toast.success(`Импортировано статей: ${imported.length}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Не удалось импортировать файл');
    }
  };

  const exportJson = () => {
    downloadFile(`noro-support-kb-${stamp()}.json`, JSON.stringify({ format: 'noro-support-kb', version: 1, articles: state.articles }, null, 2), 'application/json');
  };

  return (
    <div className="split split--side-l" style={{ alignItems: 'start' }}>
      <div className="panel" style={{ minWidth: 0 }}>
        <div className="panel__body" style={{ display: 'grid', gap: 10 }}>
          <div className="btn-row">
            <button type="button" className="btn btn--primary btn--sm" onClick={() => setSelectedId(null)} data-testid="kb-new">
              <Icon name="plus" /> Статья
            </button>
            <UploadButton accept=".md,.txt,.json,.markdown" onFile={(f) => void onImport(f)}>
              Импорт
            </UploadButton>
            <button type="button" className="btn btn--ghost btn--sm" onClick={exportJson} disabled={!state.articles.length} data-testid="kb-export">
              <Icon name="download" /> JSON
            </button>
          </div>
          <label className="search">
            <Icon name="search" size={14} />
            <span className="sr-only">Поиск по статьям</span>
            <input className="input input--sm" placeholder="Поиск по статьям" value={q} onChange={(e) => setQ(e.target.value)} />
          </label>
          <ul className="list-reset kb-list" aria-label="Статьи базы знаний">
            {list.map((a) => (
              <li key={a.id}>
                <button type="button" className={`kb-item${a.id === selectedId ? ' is-active' : ''}`} onClick={() => setSelectedId(a.id)} aria-current={a.id === selectedId}>
                  <b>{a.title}</b>
                  <small>
                    {a.category} · {fmtDate(a.updatedAt)}
                  </small>
                </button>
              </li>
            ))}
            {list.length === 0 ? <li className="dim" style={{ fontSize: 'var(--fs-sm)', padding: 8 }}>Ничего не найдено</li> : null}
          </ul>
        </div>
      </div>
      <div className="panel" style={{ minWidth: 0 }}>
        <div className="panel__head">
          <h3 className="panel__title">{selected ? 'Редактирование статьи' : 'Новая статья'}</h3>
          {dirty ? <span className="badge badge--warning">Есть несохранённые изменения</span> : null}
        </div>
        <div className="panel__body" style={{ display: 'grid', gap: 12 }}>
          {state.articles.length === 0 && !selected ? (
            <EmptyState icon="book" title="База знаний пуста" text="Добавьте статью вручную или импортируйте .md/.txt (статьи делятся по заголовкам #) или JSON-экспорт." />
          ) : null}
          <div className="split" style={{ gap: 10 }}>
            <label className="field">
              <span className="field__label">Заголовок</span>
              <input className="input" value={form.title} maxLength={200} onChange={(e) => setForm({ ...form, title: e.target.value })} data-testid="kb-title" />
            </label>
            <label className="field">
              <span className="field__label">Категория</span>
              <input className="input" value={form.category} maxLength={60} onChange={(e) => setForm({ ...form, category: e.target.value })} list="kb-cats" />
              <datalist id="kb-cats">
                {[...new Set(state.articles.map((a) => a.category))].map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </label>
          </div>
          <label className="field">
            <span className="field__label">Текст</span>
            <textarea className="textarea" rows={12} value={form.body} maxLength={20000} onChange={(e) => setForm({ ...form, body: e.target.value })} data-testid="kb-body" />
            <span className="field__hint">Пустая строка разделяет абзацы — поиск работает по абзацам. {form.body.length.toLocaleString('ru-RU')} / 20 000 символов.</span>
          </label>
          {!valid && dirty ? <p className="field__error">Нужен заголовок и текст не короче 10 символов.</p> : null}
          <div className="btn-row">
            <button type="button" className="btn btn--primary btn--sm" onClick={save} disabled={!valid || !dirty} data-testid="kb-save">
              <Icon name="check" /> Сохранить
            </button>
            {selected ? (
              <button type="button" className="btn btn--ghost btn--sm" onClick={remove}>
                <Icon name="trash" /> Удалить
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
