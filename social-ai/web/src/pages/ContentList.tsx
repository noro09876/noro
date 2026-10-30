import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { get, post } from '../api';
import type { Content, Format, Platform } from '../types';
import { Alert, DemoBadge, Empty, ErrorBox, FORMAT_LABEL, fmtDateTime, Icon, Loading, Modal, PLATFORM_LABEL, PlatformIcon, StatusBadge, useLoad, useToast } from '../ui';

const FILTERS: [string, string][] = [['', 'Все'], ['draft', 'Черновики'], ['ready', 'Готовые'], ['scheduled', 'Запланированные'], ['published', 'Опубликованные'], ['failed', 'С ошибками'], ['archived', 'Архив']];

export function ContentList() {
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState(false);
  const toast = useToast();
  const { data, error, loading, reload } = useLoad(() => get<Content[]>(`/api/content?status=${status}&q=${encodeURIComponent(q)}`), [status, q]);

  return (
    <div className="page">
      <div className="row">
        <div className="chips" role="group" aria-label="Фильтр по статусу">
          {FILTERS.map(([v, l]) => <button key={v} className="chip" aria-pressed={status === v} onClick={() => setStatus(v)}>{l}</button>)}
        </div>
        <div className="spacer" />
        <input className="input" style={{ width: 220 }} placeholder="Поиск" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Поиск" />
        <button className="btn btn-primary" onClick={() => setCreating(true)}><Icon name="plus" />Создать</button>
      </div>

      {error && <ErrorBox error={error} retry={reload} />}
      {loading && !data ? <Loading /> : data && data.length ? (
        <div className="content-grid">
          {data.map((c) => (
            <Link key={c.id} to={`/content/${c.id}`} className="card content-card">
              <div className="content-thumb">
                {c.thumb ? <img src={c.thumb} alt="" loading="lazy" /> : <Icon name="layers" size={28} />}
                {c.format === 'carousel' && <span className="badge plain count">{c.slideCount} слайдов</span>}
              </div>
              <div className="content-meta">
                <div className="row" style={{ gap: 6 }}>
                  <StatusBadge kind="content" status={c.status} />
                  <span className="badge plain">{FORMAT_LABEL[c.format]}</span>
                  {c.isDemo && <DemoBadge />}
                  {c.review?.errors.length ? <span className="badge badge-critical">{c.review.errors.length} ошиб.</span> : null}
                </div>
                <h3>{c.title || 'Без названия'}</h3>
                <p>{c.body}</p>
                <div className="row" style={{ gap: 6 }}>
                  {c.platforms.map((p) => <PlatformIcon key={p} platform={p} small />)}
                  <span className="spacer" />
                  <span className="muted" style={{ fontSize: 12 }}>{fmtDateTime(c.updatedAt)}</span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <div className="card">
          <Empty title="Материалов нет" text="Создайте материал вручную, сгенерируйте его моделью или включите ИИ-агента." action={
            <div className="row">
              <button className="btn btn-primary" onClick={() => setCreating(true)}><Icon name="plus" />Создать</button>
              <button className="btn" onClick={async () => { await post('/api/demo'); toast('info', 'Загружены демонстрационные материалы (помечены «ДЕМО»)'); await reload(); }}>Загрузить демо</button>
            </div>
          } />
        </div>
      )}
      {creating && <CreateDialog onClose={() => setCreating(false)} />}
    </div>
  );
}

function CreateDialog({ onClose }: { onClose: () => void }) {
  const nav = useNavigate();
  const brands = useLoad(() => get<{ topics: { name: string; enabled: number }[] }[]>('/api/brands'));
  const topics = (brands.data?.[0]?.topics ?? []).filter((t) => t.enabled).map((t) => t.name);
  const [mode, setMode] = useState<'ai' | 'manual'>('ai');
  const [topic, setTopic] = useState('');
  const [angle, setAngle] = useState('');
  const [format, setFormat] = useState<Format>('carousel');
  const [platforms, setPlatforms] = useState<Platform[]>(['telegram', 'vk']);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const t = topic || topics[0] || 'ИИ и автоматизация';
      const c = mode === 'ai'
        ? await post<Content>('/api/content/generate', { topic: t, angle, format, platforms })
        : await post<Content>('/api/content', { topic: t, title: angle, format, platforms, slides: format === 'carousel' ? [{ title: angle || 'Обложка', text: '' }, { title: '', text: '' }, { title: '', text: '' }] : [] });
      nav(`/content/${c.id}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <Modal title="Новый материал" onClose={onClose} footer={<>
      <button className="btn btn-ghost" onClick={onClose}>Отмена</button>
      <button className="btn btn-primary" disabled={busy} onClick={submit}>{busy ? <><span className="spinner" />{mode === 'ai' ? 'Модель пишет…' : 'Создаю…'}</> : mode === 'ai' ? <><Icon name="sparkle" />Сгенерировать</> : 'Создать черновик'}</button>
    </>}>
      {error && <Alert kind="critical">{error}</Alert>}
      <div className="seg" role="group">
        <button aria-pressed={mode === 'ai'} onClick={() => setMode('ai')}>Сгенерировать ИИ</button>
        <button aria-pressed={mode === 'manual'} onClick={() => setMode('manual')}>Написать вручную</button>
      </div>
      <label className="field"><span>Тематика</span>
        <select className="select" value={topic} onChange={(e) => setTopic(e.target.value)}>
          {topics.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </label>
      <label className="field"><span>{mode === 'ai' ? 'Идея или угол (необязательно)' : 'Заголовок'}</span>
        <input className="input" value={angle} onChange={(e) => setAngle(e.target.value)} placeholder={mode === 'ai' ? 'например: как выбрать первый процесс для ИИ-агента' : ''} />
      </label>
      <div className="field"><span>Формат</span>
        <div className="seg" role="group">
          {(['carousel', 'post', 'article'] as Format[]).map((f) => <button key={f} aria-pressed={format === f} onClick={() => setFormat(f)}>{FORMAT_LABEL[f]}</button>)}
        </div>
      </div>
      <div className="field"><span>Площадки</span>
        <div className="chips">
          {(Object.keys(PLATFORM_LABEL) as Platform[]).map((p) => (
            <button key={p} className="chip" aria-pressed={platforms.includes(p)} onClick={() => setPlatforms(platforms.includes(p) ? platforms.filter((x) => x !== p) : [...platforms, p])}>{PLATFORM_LABEL[p]}</button>
          ))}
        </div>
      </div>
      {mode === 'ai' && <p className="muted" style={{ margin: 0, fontSize: 12 }}>Генерация идёт на подключённой модели (Ollama). На слабом компьютере это может занять несколько минут.</p>}
    </Modal>
  );
}
