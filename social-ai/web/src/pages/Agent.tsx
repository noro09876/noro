import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { del, get, post, put } from '../api';
import type { Brand, EventRow, Format, PlanItem, Platform, Settings } from '../types';
import { Alert, Empty, ErrorBox, FORMAT_LABEL, fmtDateTime, fmtRelative, Icon, Loading, PLATFORM_LABEL, Switch, useLoad, useToast } from '../ui';

interface AgentData {
  settings: Settings['agent'];
  state: { consecutiveFailures: number; pausedReason: string | null; lastCycleAt: string | null };
  generationsLeft: number;
  plan: PlanItem[];
  runs: { id: number; kind: string; started_at: string; finished_at: string | null; status: string; summary: string | null; error: string | null }[];
  history: EventRow[];
  ai: { provider: string; model: string };
}

export function AgentPage({ onAgentChange }: { onAgentChange: (v: boolean) => void }) {
  const toast = useToast();
  const { data, error, loading, reload } = useLoad(() => get<AgentData>('/api/agent'));
  const brands = useLoad(() => get<Brand[]>('/api/brands'));
  const [form, setForm] = useState<Settings['agent'] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [newTopic, setNewTopic] = useState('');
  const [tab, setTab] = useState<'plan' | 'history' | 'runs'>('plan');

  useEffect(() => {
    if (data) setForm(data.settings);
  }, [data]);

  if ((loading && !data) || !form) return <div className="page">{error ? <ErrorBox error={error} retry={reload} /> : <Loading />}</div>;
  if (!data) return null;
  const brand = brands.data?.find((b) => b.id === (form.brandId ?? brands.data?.[0]?.id)) ?? brands.data?.[0];
  const dirty = JSON.stringify(form) !== JSON.stringify(data.settings);
  const noModel = data.ai.provider === 'offline' || !data.ai.model;

  const save = async (patch?: Partial<Settings['agent']>) => {
    setBusy('save');
    try {
      const next = await put<Settings['agent']>('/api/agent', patch ?? form);
      setForm(next);
      onAgentChange(next.enabled);
      toast('success', patch && 'enabled' in patch ? (next.enabled ? 'Агент включён' : 'Агент остановлен') : 'Настройки агента сохранены');
      await reload();
    } catch (e) {
      toast('error', (e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const act = async (name: string, fn: () => Promise<unknown>, ok?: string) => {
    setBusy(name);
    try {
      const r = await fn();
      if (ok) toast('success', ok);
      else if (r && typeof r === 'object' && 'summary' in r) toast('info', `Цикл: ${(r as { summary: string }).summary}`);
      await reload();
      await brands.reload();
    } catch (e) {
      toast('error', (e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const toggleList = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  return (
    <div className="page">
      {data.state.pausedReason && (
        <Alert kind="critical">
          Агент приостановлен защитой: {data.state.pausedReason}. Устраните причину (например, запустите Ollama) и возобновите работу.{' '}
          <button className="btn btn-sm" onClick={() => act('resume', () => post('/api/agent/resume'), 'Агент возобновлён')}>Возобновить</button>
        </Alert>
      )}
      {noModel && <Alert kind="warning">Модель не подключена: агент будет создавать только заготовки, которые не публикуются автоматически. <Link to="/settings">Подключить Ollama</Link></Alert>}

      <section className="card">
        <div className="card-body row">
          <Switch checked={form.enabled} disabled={busy === 'save'} onChange={(v) => save({ enabled: v })} label={<strong>{form.enabled ? 'Агент работает автоматически' : 'Агент выключен'}</strong>} />
          <span className="muted">Последний цикл: {fmtRelative(data.state.lastCycleAt)} · генераций сегодня осталось: {data.generationsLeft}</span>
          <div className="spacer" />
          <button className="btn" disabled={!!busy} onClick={() => act('plan', () => post('/api/agent/plan'), 'План обновлён')}>{busy === 'plan' ? <span className="spinner" /> : <Icon name="calendar" />}Дополнить план</button>
          <button className="btn btn-primary" disabled={!!busy} onClick={() => act('run', () => post('/api/agent/run'))}>{busy === 'run' ? <span className="spinner" /> : <Icon name="play" />}Запустить цикл сейчас</button>
        </div>
      </section>

      <div className="grid grid-2">
        <section className="card">
          <div className="card-head"><h3>Тематики</h3><span className="muted">{brand?.name}</span></div>
          <div className="card-body stack">
            <div className="chips">
              {brand?.topics.map((t) => (
                <button key={t.id} className="chip" aria-pressed={Boolean(t.enabled)} title={t.description}
                  onClick={() => act('topic', () => put(`/api/topics/${t.id}`, { enabled: !t.enabled }))}>{t.name}</button>
              ))}
            </div>
            <form className="row" onSubmit={(e) => { e.preventDefault(); if (newTopic.trim() && brand) void act('topic', () => post('/api/topics', { brandId: brand.id, name: newTopic.trim() }), 'Тематика добавлена').then(() => setNewTopic('')); }}>
              <input className="input" style={{ flex: 1 }} placeholder="Новая тематика" value={newTopic} onChange={(e) => setNewTopic(e.target.value)} />
              <button className="btn" disabled={!newTopic.trim()}><Icon name="plus" />Добавить</button>
            </form>
            {brand && brand.topics.length > 0 && (
              <details>
                <summary className="muted" style={{ cursor: 'pointer' }}>Удалить тематику</summary>
                <div className="chips" style={{ marginTop: 8 }}>
                  {brand.topics.map((t) => <button key={t.id} className="chip" onClick={() => act('topic', () => del(`/api/topics/${t.id}`))}>{t.name} ✕</button>)}
                </div>
              </details>
            )}
          </div>
        </section>

        <section className="card">
          <div className="card-head"><h3>Частота и форматы</h3></div>
          <div className="card-body stack">
            <div className="grid grid-2">
              <label className="field"><span>Публикаций в день</span>
                <select className="select" value={form.postsPerDay} onChange={(e) => setForm({ ...form, postsPerDay: Number(e.target.value) })}>
                  {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </label>
              <label className="field"><span>Планировать на дней вперёд</span><input className="input" type="number" min={1} max={30} value={form.planDays} onChange={(e) => setForm({ ...form, planDays: Number(e.target.value) })} /></label>
            </div>
            <div className="field"><span>Время публикаций</span>
              <div className="row" style={{ gap: 6 }}>
                {Array.from({ length: form.postsPerDay }, (_, i) => (
                  <input key={i} className="input" type="time" style={{ width: 120 }} value={form.postTimes[i] ?? '12:00'} onChange={(e) => { const t = [...form.postTimes]; t[i] = e.target.value; setForm({ ...form, postTimes: t }); }} />
                ))}
              </div>
            </div>
            <div className="field"><span>Форматы</span>
              <div className="chips">{(['carousel', 'post', 'article'] as Format[]).map((f) => <button key={f} className="chip" aria-pressed={form.formats.includes(f)} onClick={() => setForm({ ...form, formats: toggleList(form.formats, f) })}>{FORMAT_LABEL[f]}</button>)}</div>
            </div>
            <div className="field"><span>Площадки</span>
              <div className="chips">{(Object.keys(PLATFORM_LABEL) as Platform[]).map((p) => <button key={p} className="chip" aria-pressed={form.platforms.includes(p)} onClick={() => setForm({ ...form, platforms: toggleList(form.platforms, p) })}>{PLATFORM_LABEL[p]}</button>)}</div>
            </div>
          </div>
        </section>

        <section className="card">
          <div className="card-head"><h3>Тон, стиль и ограничения</h3></div>
          <div className="card-body stack">
            <label className="field"><span>Тон</span><input className="input" value={form.tone} onChange={(e) => setForm({ ...form, tone: e.target.value })} /></label>
            <label className="field"><span>Стиль</span><textarea className="textarea" rows={2} value={form.style} onChange={(e) => setForm({ ...form, style: e.target.value })} /></label>
            <label className="field"><span>Ограничения (что нельзя делать)</span><textarea className="textarea" rows={4} value={form.constraints} onChange={(e) => setForm({ ...form, constraints: e.target.value })} /></label>
          </div>
        </section>

        <section className="card">
          <div className="card-head"><h3>Автономность и предохранители</h3></div>
          <div className="card-body stack">
            <Switch checked={form.autoApprove} onChange={(v) => setForm({ ...form, autoApprove: v })} label="Публиковать без моего подтверждения, если проверка пройдена" />
            <p className="muted" style={{ margin: 0, fontSize: 12 }}>Выключено — агент готовит материалы и ждёт вашего «Подтвердить». Включено — сам ставит в расписание аккаунтов с включённой автопубликацией. Заготовки без модели не публикуются никогда.</p>
            <div className="grid grid-2">
              <label className="field"><span>Готовить за, часов</span><input className="input" type="number" min={1} max={168} value={form.leadHours} onChange={(e) => setForm({ ...form, leadHours: Number(e.target.value) })} /></label>
              <label className="field"><span>Генераций в день, максимум</span><input className="input" type="number" min={1} max={100} value={form.maxGenerationsPerDay} onChange={(e) => setForm({ ...form, maxGenerationsPerDay: Number(e.target.value) })} /></label>
              <label className="field"><span>Попыток на один слот</span><input className="input" type="number" min={1} max={5} value={form.maxAttemptsPerItem} onChange={(e) => setForm({ ...form, maxAttemptsPerItem: Number(e.target.value) })} /></label>
              <label className="field"><span>Пауза после ошибок подряд</span><input className="input" type="number" min={1} max={20} value={form.maxConsecutiveFailures} onChange={(e) => setForm({ ...form, maxConsecutiveFailures: Number(e.target.value) })} /></label>
            </div>
          </div>
        </section>
      </div>

      {dirty && (
        <div className="row end">
          <button className="btn btn-ghost" onClick={() => setForm(data.settings)}>Сбросить</button>
          <button className="btn btn-primary" disabled={busy === 'save'} onClick={() => save()}>Сохранить настройки агента</button>
        </div>
      )}

      <section className="card">
        <div className="tabs" role="tablist" style={{ padding: '0 12px' }}>
          <button role="tab" aria-selected={tab === 'plan'} onClick={() => setTab('plan')}>Контент-план</button>
          <button role="tab" aria-selected={tab === 'history'} onClick={() => setTab('history')}>История действий</button>
          <button role="tab" aria-selected={tab === 'runs'} onClick={() => setTab('runs')}>Циклы</button>
        </div>
        {tab === 'plan' && (data.plan.length ? (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Когда</th><th>Тематика</th><th>Идея</th><th>Формат</th><th>Статус</th><th /></tr></thead>
              <tbody>
                {data.plan.map((p) => (
                  <tr key={p.id}>
                    <td style={{ whiteSpace: 'nowrap' }}>{fmtDateTime(p.date, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</td>
                    <td>{p.topic}</td>
                    <td className="text-2">{p.angle}{p.note && <div style={{ fontSize: 12, color: 'var(--warning)' }}>{p.note}</div>}</td>
                    <td>{FORMAT_LABEL[p.format]}</td>
                    <td><span className={`badge ${p.status === 'generated' ? 'badge-good' : p.status === 'skipped' ? '' : p.status === 'generating' ? 'badge-info' : 'badge-signal'}`}>{({ planned: 'В плане', generating: 'Генерация', generated: 'Создан', skipped: 'Пропущен' } as Record<string, string>)[p.status] ?? p.status}</span></td>
                    <td className="num">
                      {p.contentId ? <Link className="btn btn-sm btn-ghost" to={`/content/${p.contentId}`}>Открыть</Link>
                        : p.status === 'planned' && <button className="btn btn-sm btn-ghost" onClick={() => act('skip', () => del(`/api/plan/${p.id}`))}>Пропустить</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <Empty icon="calendar" title="План пуст" text="Нажмите «Дополнить план» или включите агента." />)}
        {tab === 'history' && (data.history.length ? data.history.map((e) => (
          <div key={e.id} className="log-line">
            <span className="mono muted">{fmtDateTime(e.ts)}</span>
            <span className={`mono lvl-${e.level}`}>{e.scope}</span>
            <span className="msg">{e.content_id ? <Link to={`/content/${e.content_id}`}>{e.message}</Link> : e.message}</span>
          </div>
        )) : <Empty icon="log" title="Действий пока нет" />)}
        {tab === 'runs' && (data.runs.length ? data.runs.map((r) => (
          <div key={r.id} className="log-line">
            <span className="mono muted">{fmtDateTime(r.started_at)}</span>
            <span className={`mono ${r.status === 'error' ? 'lvl-error' : 'lvl-info'}`}>{r.status}</span>
            <span className="msg">{r.error ?? r.summary ?? '…'}</span>
          </div>
        )) : <Empty icon="bot" title="Циклов ещё не было" />)}
      </section>
    </div>
  );
}
