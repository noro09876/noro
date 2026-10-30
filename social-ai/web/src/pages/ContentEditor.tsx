import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { ApiError, del, get, post, put } from '../api';
import type { Account, Content, Format, Platform, Review, Slide } from '../types';
import {
  Alert, Confirm, DemoBadge, ErrorBox, FORMAT_LABEL, fmtDateTime, Icon, Loading, Modal, PLATFORM_LABEL, PlatformIcon, StatusBadge,
  useLoad, useToast, zonedParts, zonedToIso,
} from '../ui';

const LOCKED = ['published', 'partial'];

export function ContentEditor() {
  const { id } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const { data, setData, error, loading, reload } = useLoad(() => get<Content>(`/api/content/${id}`), [id]);
  const [draft, setDraft] = useState<Content | null>(null);
  const [slide, setSlide] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [dialog, setDialog] = useState<'schedule' | 'publish' | 'delete' | null>(null);
  const [review, setReview] = useState<Review | null>(null);

  useEffect(() => {
    if (data) {
      setDraft(data);
      setReview(data.review);
      setSlide((s) => Math.min(s, Math.max(0, (data.media?.length ?? 1) - 1)));
    }
  }, [data]);

  const dirty = useMemo(() => {
    if (!data || !draft) return false;
    const pick = (c: Content) => JSON.stringify([c.title, c.body, c.summary, c.cta, c.hashtags, c.slides, c.platforms, c.format, c.topic]);
    return pick(data) !== pick(draft);
  }, [data, draft]);

  if (loading && !data) return <div className="page"><Loading /></div>;
  if (error || !data || !draft) return <div className="page"><ErrorBox error={error ?? 'Материал не найден'} retry={reload} /></div>;

  const locked = LOCKED.includes(data.status);
  const media = data.media ?? [];
  const set = (patch: Partial<Content>) => setDraft({ ...draft, ...patch });
  const setSlideField = (i: number, patch: Partial<Slide>) => set({ slides: draft.slides.map((s, j) => (j === i ? { ...s, ...patch } : s)) });

  const run = async (name: string, fn: () => Promise<void>) => {
    setBusy(name);
    try {
      await fn();
    } catch (e) {
      const err = e as ApiError;
      if (err.data?.review) setReview(err.data.review as Review);
      toast('error', err.message);
    } finally {
      setBusy(null);
    }
  };

  const save = () => run('save', async () => {
    const c = await put<Content>(`/api/content/${data.id}`, {
      title: draft.title, body: draft.body, summary: draft.summary, cta: draft.cta, hashtags: draft.hashtags, slides: draft.slides,
      platforms: draft.platforms, format: draft.format, topic: draft.topic,
    });
    setData(c);
    toast('success', data.status === 'scheduled' || data.status === 'ready' ? 'Сохранено. Материал вернулся в черновики — подтвердите его снова' : 'Сохранено, изображения пересобраны');
  });

  return (
    <div className="page">
      <div className="row">
        <Link to="/content" className="btn btn-ghost btn-sm"><Icon name="chevronL" />Контент</Link>
        <StatusBadge kind="content" status={data.status} />
        <span className="badge plain">{FORMAT_LABEL[data.format]}</span>
        {data.isDemo && <DemoBadge />}
        <span className="muted" style={{ fontSize: 12 }}>{data.source === 'agent' ? `ИИ-агент${data.model ? ` · ${data.model}` : ' · без модели'}` : 'Вручную'} · генераций {data.generationCount}</span>
        <div className="spacer" />
        {!locked && <button className="btn" disabled={!!busy} onClick={() => run('regen', async () => { setData(await post<Content>(`/api/content/${data.id}/regenerate`, {})); toast('success', 'Материал перегенерирован'); })}>{busy === 'regen' ? <span className="spinner" /> : <Icon name="sparkle" />}Повторить генерацию</button>}
        {!locked && <button className="btn btn-primary" disabled={!dirty || !!busy} onClick={save}>{busy === 'save' ? <span className="spinner" /> : <Icon name="check" />}Сохранить</button>}
      </div>

      {data.isDemo && <Alert kind="warning">Это демонстрационный материал. Его можно публиковать для проверки интеграций, но в статистике он не учитывается.</Alert>}
      {locked && <Alert kind="info">Материал уже опубликован и не редактируется — это защищает от расхождений с вышедшими постами. Сделайте копию, чтобы изменить текст.</Alert>}

      {review && (review.errors.length > 0 || review.warnings.length > 0) && (
        <div className="stack">
          {review.errors.length > 0 && <Alert kind="critical"><strong>Публикация будет остановлена:</strong><ul>{review.errors.map((e) => <li key={e}>{e}</li>)}</ul></Alert>}
          {review.warnings.length > 0 && <Alert kind="warning"><strong>Проверьте:</strong><ul>{review.warnings.map((e) => <li key={e}>{e}</li>)}</ul></Alert>}
        </div>
      )}

      <div className="editor">
        <div className="stack-lg">
          <section className="card">
            <div className="card-head"><h3>Текст</h3></div>
            <div className="card-body stack">
              <div className="grid grid-2">
                <label className="field"><span>Тематика</span><input className="input" value={draft.topic} disabled={locked} onChange={(e) => set({ topic: e.target.value })} /></label>
                <div className="field"><span>Формат</span>
                  <div className="seg" role="group">
                    {(['carousel', 'post', 'article'] as Format[]).map((f) => <button key={f} disabled={locked} aria-pressed={draft.format === f} onClick={() => set({ format: f, slides: f === 'carousel' && !draft.slides.length ? [{ title: draft.title, text: draft.summary }, { title: '', text: '' }, { title: '', text: '' }] : draft.slides })}>{FORMAT_LABEL[f]}</button>)}
                  </div>
                </div>
              </div>
              <label className="field"><span>Заголовок</span><input className="input" value={draft.title} disabled={locked} onChange={(e) => set({ title: e.target.value })} /></label>
              <label className="field"><span>Основной текст <span className="muted">· {draft.body.length} симв.</span></span><textarea className="textarea" rows={draft.format === 'article' ? 16 : 9} value={draft.body} disabled={locked} onChange={(e) => set({ body: e.target.value })} /></label>
              <label className="field"><span>Краткое описание (для X и превью) <span className="muted">· {draft.summary.length}/240</span></span><textarea className="textarea" rows={2} value={draft.summary} disabled={locked} onChange={(e) => set({ summary: e.target.value })} /></label>
              <label className="field"><span>Призыв к действию</span><input className="input" value={draft.cta} disabled={locked} onChange={(e) => set({ cta: e.target.value })} /></label>
              <label className="field"><span>Хештеги через пробел</span><input className="input" value={draft.hashtags.map((h) => `#${h}`).join(' ')} disabled={locked} onChange={(e) => set({ hashtags: e.target.value.split(/[\s,]+/).map((t) => t.replace(/^#/, '')).filter(Boolean) })} /></label>
              <div className="field"><span>Площадки</span>
                <div className="chips">
                  {(Object.keys(PLATFORM_LABEL) as Platform[]).map((p) => (
                    <button key={p} className="chip" disabled={locked} aria-pressed={draft.platforms.includes(p)} onClick={() => set({ platforms: draft.platforms.includes(p) ? draft.platforms.filter((x) => x !== p) : [...draft.platforms, p] })}>{PLATFORM_LABEL[p]}</button>
                  ))}
                </div>
              </div>
            </div>
          </section>

          {draft.format === 'carousel' && (
            <section className="card">
              <div className="card-head"><h3>Слайды</h3><span className="muted">{draft.slides.length} из 10</span><div className="spacer" />
                {!locked && <button className="btn btn-sm" disabled={draft.slides.length >= 10} onClick={() => set({ slides: [...draft.slides.slice(0, -1), { title: '', text: '' }, ...draft.slides.slice(-1)] })}><Icon name="plus" />Слайд</button>}
              </div>
              <div className="card-body stack">
                {draft.slides.map((s, i) => (
                  <div key={i} className="slide-edit" onFocus={() => setSlide(i)}>
                    <div className="slide-edit-head">
                      <span className="n">{String(i + 1).padStart(2, '0')}</span>
                      <span className="muted" style={{ fontSize: 12 }}>{i === 0 ? 'Обложка' : i === draft.slides.length - 1 && draft.slides.length >= 3 ? 'Финал / призыв' : 'Одна мысль'}</span>
                      <span className="spacer" style={{ flex: 1 }} />
                      {!locked && (
                        <>
                          <button className="btn btn-ghost btn-sm btn-icon" aria-label="Выше" disabled={i === 0} onClick={() => { const xs = [...draft.slides]; [xs[i - 1], xs[i]] = [xs[i], xs[i - 1]]; set({ slides: xs }); }}><Icon name="chevronL" /></button>
                          <button className="btn btn-ghost btn-sm btn-icon" aria-label="Ниже" disabled={i === draft.slides.length - 1} onClick={() => { const xs = [...draft.slides]; [xs[i + 1], xs[i]] = [xs[i], xs[i + 1]]; set({ slides: xs }); }}><Icon name="chevronR" /></button>
                          <button className="btn btn-ghost btn-sm btn-icon btn-danger" aria-label="Удалить слайд" disabled={draft.slides.length <= 2} onClick={() => set({ slides: draft.slides.filter((_, j) => j !== i) })}><Icon name="trash" /></button>
                        </>
                      )}
                    </div>
                    <input className="input" placeholder="Заголовок слайда" value={s.title} disabled={locked} onChange={(e) => setSlideField(i, { title: e.target.value })} />
                    <textarea className="textarea" rows={2} placeholder="Текст слайда — одна мысль" value={s.text} disabled={locked} onChange={(e) => setSlideField(i, { text: e.target.value })} />
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>

        <div className="preview-stage">
          <section className="card">
            <div className="card-head">
              <h3>Предпросмотр</h3>
              <span className="muted">{media.length ? `${slide + 1} / ${media.length}` : ''}</span>
              <div className="spacer" />
              {!locked && <button className="btn btn-sm btn-ghost" disabled={!!busy} onClick={() => run('render', async () => { setData(await post<Content>(`/api/content/${data.id}/render`)); })}>{busy === 'render' ? <span className="spinner" /> : <Icon name="refresh" />}Пересобрать</button>}
              {media.length > 0 && <a className="btn btn-sm btn-ghost" href={`/api/content/${data.id}/export.zip`}><Icon name="download" />ZIP</a>}
            </div>
            <div className="card-body stack">
              {dirty && <Alert kind="info">Есть несохранённые изменения — изображения обновятся после сохранения.</Alert>}
              {media.length ? (
                <>
                  <div className="slide-view">
                    <img src={media[slide]?.url} alt={`Слайд ${slide + 1}`} />
                    {media.length > 1 && <>
                      <button className="btn btn-icon slide-nav prev" aria-label="Предыдущий слайд" disabled={slide === 0} onClick={() => setSlide(slide - 1)}><Icon name="chevronL" /></button>
                      <button className="btn btn-icon slide-nav next" aria-label="Следующий слайд" disabled={slide === media.length - 1} onClick={() => setSlide(slide + 1)}><Icon name="chevronR" /></button>
                    </>}
                  </div>
                  {media.length > 1 && (
                    <div className="thumbs">
                      {media.map((m, i) => <button key={m.id} aria-current={i === slide} aria-label={`Слайд ${i + 1}`} onClick={() => setSlide(i)}><img src={m.url} alt="" /></button>)}
                    </div>
                  )}
                  <span className="muted" style={{ fontSize: 12 }}>{media[slide]?.width}×{media[slide]?.height} JPEG · {Math.round((media[slide]?.bytes ?? 0) / 1024)} КБ</span>
                </>
              ) : <p className="muted">Изображения ещё не созданы.</p>}
              {data.format !== 'carousel' && <div className="post-preview">{[data.title, data.body, data.cta, data.hashtags.map((h) => `#${h}`).join(' ')].filter(Boolean).join('\n\n')}</div>}
            </div>
          </section>

          <section className="card">
            <div className="card-head"><h3>Публикация</h3></div>
            <div className="card-body stack">
              {data.publications?.length ? (
                <div className="list" style={{ margin: '-8px -20px' }}>
                  {data.publications.map((p) => <PublicationRow key={p.id} p={p} onChange={reload} />)}
                </div>
              ) : <p className="muted" style={{ margin: 0 }}>Ещё не публиковался и не запланирован.</p>}
              <div className="row">
                {(data.status === 'draft' || data.status === 'failed') && (
                  <button className="btn btn-primary" disabled={!!busy || dirty} onClick={() => run('approve', async () => { setData(await post<Content>(`/api/content/${data.id}/approve`)); toast('success', 'Проверка пройдена, материал готов'); })}>{busy === 'approve' ? <span className="spinner" /> : <Icon name="check" />}Проверить и подтвердить</button>
                )}
                {['ready', 'scheduled', 'partial', 'failed'].includes(data.status) && data.status !== 'draft' && (
                  <>
                    <button className="btn" disabled={!!busy || dirty} onClick={() => setDialog('schedule')}><Icon name="clock" />Запланировать</button>
                    <button className="btn btn-primary" disabled={!!busy || dirty} onClick={() => setDialog('publish')}><Icon name="send" />Опубликовать сейчас</button>
                  </>
                )}
                {data.status === 'ready' && <button className="btn btn-ghost" onClick={() => run('unapprove', async () => { setData(await post<Content>(`/api/content/${data.id}/unapprove`)); })}>В черновики</button>}
              </div>
              <div className="row" style={{ borderTop: '1px solid var(--border)', paddingTop: 12 }}>
                <button className="btn btn-sm btn-ghost" onClick={() => run('dup', async () => { const c = await post<Content>(`/api/content/${data.id}/duplicate`); nav(`/content/${c.id}`); })}><Icon name="copy" />Копия</button>
                {data.status !== 'archived'
                  ? <button className="btn btn-sm btn-ghost" onClick={() => run('arch', async () => { setData(await post<Content>(`/api/content/${data.id}/archive`)); toast('info', 'Перемещено в архив'); })}><Icon name="archive" />В архив</button>
                  : <button className="btn btn-sm btn-ghost" onClick={() => run('restore', async () => { setData(await post<Content>(`/api/content/${data.id}/restore`)); })}>Вернуть из архива</button>}
                <button className="btn btn-sm btn-ghost btn-danger" onClick={() => setDialog('delete')}><Icon name="trash" />Удалить</button>
              </div>
            </div>
          </section>
        </div>
      </div>

      {(dialog === 'schedule' || dialog === 'publish') && <TargetDialog content={data} mode={dialog} onClose={() => setDialog(null)} onDone={(c) => { setData(c); setDialog(null); }} />}
      {dialog === 'delete' && <Confirm title="Удалить материал?" text="Материал, его изображения и история публикаций будут удалены из NORO. Уже вышедшие посты в соцсетях останутся." danger confirmLabel="Удалить" onClose={() => setDialog(null)} onConfirm={async () => { await del(`/api/content/${data.id}`); nav('/content'); }} />}
    </div>
  );
}

function PublicationRow({ p, onChange }: { p: NonNullable<Content['publications']>[number]; onChange: () => void }) {
  const toast = useToast();
  const act = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      onChange();
    } catch (e) {
      toast('error', (e as Error).message);
    }
  };
  return (
    <div className="list-item" style={{ alignItems: 'flex-start' }}>
      {p.account && <PlatformIcon platform={p.account.platform} />}
      <div className="grow">
        <div className="row" style={{ gap: 8 }}><span>{p.account?.name ?? 'Аккаунт удалён'}</span><StatusBadge kind="pub" status={p.status} /></div>
        <div className="muted" style={{ fontSize: 12 }}>
          {p.status === 'published' ? `Вышла ${fmtDateTime(p.publishedAt)}` : p.status === 'retrying' ? `Повтор ${fmtDateTime(p.nextAttemptAt)} · попытка ${p.attempts}` : `На ${fmtDateTime(p.scheduledAt)}`}
          {p.externalId && <> · ID <span className="mono">{p.externalId}</span></>}
        </div>
        {p.lastError && <div style={{ fontSize: 12, color: p.status === 'published' ? 'var(--warning)' : 'var(--critical)', marginTop: 4 }}>{p.lastError}</div>}
        <div className="row" style={{ marginTop: 6, gap: 6 }}>
          {p.externalUrl && <a className="btn btn-sm btn-ghost" href={p.externalUrl} target="_blank" rel="noreferrer"><Icon name="link" />Открыть</a>}
          {['failed', 'blocked'].includes(p.status) && <button className="btn btn-sm" onClick={() => act(() => post(`/api/publications/${p.id}/retry`))}><Icon name="refresh" />Повторить</button>}
          {['scheduled', 'retrying', 'failed', 'blocked'].includes(p.status) && <button className="btn btn-sm btn-ghost" onClick={() => act(() => post(`/api/publications/${p.id}/cancel`))}>Отменить</button>}
          {p.status === 'needs_check' && <>
            <button className="btn btn-sm" onClick={() => act(() => post(`/api/publications/${p.id}/resolve`, { published: true }))}>Пост вышел</button>
            <button className="btn btn-sm" onClick={() => act(() => post(`/api/publications/${p.id}/resolve`, { published: false }))}>Не вышел</button>
          </>}
        </div>
      </div>
    </div>
  );
}

function TargetDialog({ content, mode, onClose, onDone }: { content: Content; mode: 'schedule' | 'publish'; onClose: () => void; onDone: (c: Content) => void }) {
  const toast = useToast();
  const accounts = useLoad(() => get<Account[]>('/api/accounts'));
  const usable = (accounts.data ?? []).filter((a) => a.status !== 'disabled' && a.settings.enabled);
  const already = new Set((content.publications ?? []).filter((p) => p.status === 'published').map((p) => p.accountId));
  const [selected, setSelected] = useState<number[]>([]);
  const start = zonedParts(new Date(Date.now() + 3600e3).toISOString());
  const [day, setDay] = useState(start.day);
  const [time, setTime] = useState(start.time.slice(0, 2) + ':00');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (accounts.data) setSelected(usable.filter((a) => content.platforms.includes(a.platform) && !already.has(a.id)).map((a) => a.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accounts.data]);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      if (mode === 'schedule') {
        const c = await post<Content>(`/api/content/${content.id}/schedule`, { accountIds: selected, at: zonedToIso(day, time) });
        toast('success', 'Публикация запланирована');
        onDone(c);
      } else {
        const r = await post<{ results: { status: string; lastError: string | null }[]; content: Content }>(`/api/content/${content.id}/publish-now`, { accountIds: selected });
        const ok = r.results.filter((x) => x.status === 'published').length;
        const failed = r.results.filter((x) => x.status !== 'published');
        if (failed.length) toast('error', `Опубликовано ${ok} из ${r.results.length}. ${failed[0].lastError ?? ''}`);
        else toast('success', `Опубликовано: ${ok}`);
        onDone(r.content);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={mode === 'schedule' ? 'Запланировать публикацию' : 'Опубликовать сейчас'} onClose={onClose} footer={<>
      <button className="btn btn-ghost" onClick={onClose}>Отмена</button>
      <button className="btn btn-primary" disabled={busy || !selected.length} onClick={submit}>{busy ? <span className="spinner" /> : null}{mode === 'schedule' ? 'Запланировать' : 'Опубликовать'}</button>
    </>}>
      {error && <Alert kind="critical">{error}</Alert>}
      {accounts.loading && !accounts.data ? <Loading /> : usable.length ? (
        <div className="stack">
          {usable.map((a) => (
            <label key={a.id} className="check" style={{ opacity: already.has(a.id) ? 0.5 : 1 }}>
              <input type="checkbox" disabled={already.has(a.id)} checked={selected.includes(a.id)} onChange={(e) => setSelected(e.target.checked ? [...selected, a.id] : selected.filter((x) => x !== a.id))} />
              <PlatformIcon platform={a.platform} small /> {a.name} <StatusBadge kind="account" status={a.status} />
              {already.has(a.id) && <span className="muted">уже опубликовано</span>}
            </label>
          ))}
        </div>
      ) : <Alert kind="warning">Нет активных аккаунтов. <Link to="/accounts">Подключите аккаунт</Link>.</Alert>}
      {mode === 'schedule' && (
        <div className="grid grid-2">
          <label className="field"><span>Дата</span><input className="input" type="date" value={day} onChange={(e) => setDay(e.target.value)} /></label>
          <label className="field"><span>Время</span><input className="input" type="time" value={time} onChange={(e) => setTime(e.target.value)} /></label>
        </div>
      )}
      <p className="muted" style={{ margin: 0, fontSize: 12 }}>Перед отправкой NORO ещё раз проверит текст, изображения, лимиты и повторы. При критической ошибке публикация будет остановлена с указанием причины.</p>
    </Modal>
  );
}
