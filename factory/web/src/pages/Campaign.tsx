import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { api } from '../api';
import { ItemTile, PipelineRail } from '../components/content';
import { Icon } from '../components/icons';
import { Badge, Button, Empty, ErrorBox, Field, Loading, Modal, PlatformChip, PostStatusBadge, Seg, SourceBadge, TextArea, Toggles, useToast, fmtDate } from '../components/ui';
import { PLATFORMS, type PlatformId } from '../../../shared/platforms';
import { CONTENT_KINDS, KIND_LABEL, type ContentKind, type PlanEntry, type StrategyData } from '../../../shared/types';
import { useWs, useWsApi } from '../session';
import type { Brand, Campaign, ItemRow, Post, StageView } from '../types';

interface CampaignView {
  campaign: Campaign;
  brand: Brand;
  stages: StageView[];
  items: ItemRow[];
  posts: Post[];
}

export function CampaignPage() {
  const { id } = useParams();
  const { base, can } = useWs();
  const u = useWsApi();
  const qc = useQueryClient();
  const toast = useToast();
  const [kind, setKind] = useState<'all' | ContentKind>('all');
  const [editStrategy, setEditStrategy] = useState(false);
  const q = useQuery({
    queryKey: ['campaign', id],
    queryFn: () => api.get<CampaignView>(u(`/campaigns/${id}`)),
    refetchInterval: (query) => (query.state.data?.stages.some((s) => s.status === 'running') || query.state.data?.items.some((i) => i.status === 'generating') ? 2500 : 15_000),
  });
  const regen = useMutation({
    mutationFn: () => api.post(u(`/campaigns/${id}/strategy/regenerate`)),
    onSuccess: () => {
      toast.info('Стратегия поставлена в очередь');
      qc.invalidateQueries({ queryKey: ['campaign', id] });
    },
    onError: toast.err,
  });
  if (q.isLoading || !q.data) return <Loading />;
  const { campaign: c, stages, items, posts } = q.data;
  const tz = c.brief.timezone;
  const shown = kind === 'all' ? items : items.filter((i) => i.kind === kind);
  const strategyFailed = stages.find((s) => s.stage === 'strategy')?.status === 'failed';

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <div className="row tight" style={{ marginBottom: 6 }}>
            <Link to={`${base}/campaigns`} className="small muted">← Кампании</Link>
            {c.isDemo && <Badge tone="demo">ДЕМО · вымышленный бренд</Badge>}
            {c.ruleId && <Badge tone="info">создана автоматизацией</Badge>}
          </div>
          <h1>{c.title}</h1>
          <p>
            {q.data.brand?.name} · {c.brief.platforms.map((p) => PLATFORMS[p].name).join(', ')} · {c.brief.frequency}/нед × {c.brief.weeks} нед · {tz}
          </p>
        </div>
        <div className="row">
          <a className="btn" href={u(`/campaigns/${c.id}/export`)}>
            <Icon name="download" /> Экспорт ZIP
          </a>
          {can('edit') && (
            <Button icon="refresh" onClick={() => regen.mutate()} loading={regen.isPending}>
              {c.strategy ? 'Новая стратегия' : 'Повторить'}
            </Button>
          )}
        </div>
      </div>

      <PipelineRail stages={stages} />

      {strategyFailed && (
        <ErrorBox error={new Error(stages.find((s) => s.stage === 'strategy')?.error ?? 'Стратегия не создана')} />
      )}

      {c.strategy && (
        <div className="card">
          <div className="card-head">
            <div className="row">
              <h2>Стратегия</h2>
              {c.strategySource && <SourceBadge source={c.strategySource} />}
            </div>
            {can('edit') && (
              <Button size="sm" icon="edit" onClick={() => setEditStrategy(true)}>
                Редактировать
              </Button>
            )}
          </div>
          <div className="card-body grid g2">
            <div className="stack">
              <p>{c.strategy.summary}</p>
              <p className="muted small"><b style={{ color: 'var(--text)' }}>Позиционирование:</b> {c.strategy.positioning}</p>
              <p className="muted small"><b style={{ color: 'var(--text)' }}>Тон:</b> {c.strategy.tone}</p>
            </div>
            <div className="stack">
              <div className="col" style={{ gap: 6 }}>
                {c.strategy.pillars.map((p) => (
                  <div key={p.name} className="small"><Badge tone="info">{p.name}</Badge> <span className="muted">{p.description}</span></div>
                ))}
              </div>
              <div className="small">
                <b>Ключевые сообщения</b>
                <ul className="steps" style={{ marginTop: 6 }}>{c.strategy.keyMessages.map((m) => <li key={m}>{m}</li>)}</ul>
              </div>
              <div className="small muted">KPI: {c.strategy.kpis.join(' · ')}</div>
            </div>
          </div>
        </div>
      )}

      <div className="row between">
        <h2>Материалы · {items.length}</h2>
        <Seg value={kind} onChange={setKind} options={[{ value: 'all', label: 'Все' }, ...CONTENT_KINDS.filter((k) => items.some((i) => i.kind === k)).map((k) => ({ value: k, label: KIND_LABEL[k] }))]} />
      </div>
      {shown.length ? (
        <div className="grid auto-fill">
          {shown.map((i) => (
            <ItemTile key={i.id} item={i} base={base} tz={tz} />
          ))}
        </div>
      ) : (
        <div className="card">
          <Empty title={c.plan ? 'Материалы ещё не созданы' : 'Ждём стратегию'}>Материалы появятся после построения контент-плана.</Empty>
        </div>
      )}

      {posts.length > 0 && (
        <div className="card">
          <div className="card-head">
            <h2>Публикации кампании</h2>
            <Link to={`${base}/calendar`} className="small muted">Календарь →</Link>
          </div>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th>Когда</th><th>Площадка</th><th>Текст</th><th>Статус</th><th /></tr>
              </thead>
              <tbody>
                {posts.map((p) => (
                  <tr key={p.id}>
                    <td className="mono small nowrap">{p.scheduledAt ? fmtDate(p.scheduledAt, tz) : '—'}</td>
                    <td><PlatformChip id={p.platform} /></td>
                    <td className="small" style={{ maxWidth: 340 }}><div className="ellipsis">{p.text}</div></td>
                    <td><PostStatusBadge status={p.status} testMode={p.testMode} /></td>
                    <td>{p.externalUrl && <a className="btn xs" href={p.externalUrl} target="_blank" rel="noreferrer"><Icon name="external" /></a>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {editStrategy && c.strategy && (
        <StrategyEditor
          campaign={c}
          onClose={() => setEditStrategy(false)}
          onSaved={() => {
            setEditStrategy(false);
            toast.ok('Стратегия сохранена');
            qc.invalidateQueries({ queryKey: ['campaign', id] });
          }}
        />
      )}
    </div>
  );
}

function StrategyEditor({ campaign, onClose, onSaved }: { campaign: Campaign; onClose: () => void; onSaved: () => void }) {
  const u = useWsApi();
  const [s, setS] = useState<StrategyData>(campaign.strategy!);
  const [plan, setPlan] = useState<PlanEntry[]>(campaign.plan ?? []);
  const save = useMutation({
    mutationFn: async () => {
      await api.put(u(`/campaigns/${campaign.id}/strategy`), { strategy: s, plan });
      await api.post(u(`/campaigns/${campaign.id}/items`));
    },
    onSuccess: onSaved,
  });
  const lines = (v: string[]) => v.join('\n');
  const unlines = (v: string) => v.split('\n').map((x) => x.trim()).filter(Boolean);
  return (
    <Modal open onClose={onClose} title="Стратегия и план" wide footer={<><Button onClick={onClose}>Отмена</Button><Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>Сохранить</Button></>}>
      <div className="stack">
        <Field label="Суть"><TextArea value={s.summary} onChange={(v) => setS({ ...s, summary: v })} rows={3} /></Field>
        <div className="grid g2">
          <Field label="Позиционирование"><TextArea value={s.positioning} onChange={(v) => setS({ ...s, positioning: v })} rows={3} /></Field>
          <Field label="Тон"><TextArea value={s.tone} onChange={(v) => setS({ ...s, tone: v })} rows={3} /></Field>
        </div>
        <div className="grid g2">
          <Field label="Ключевые сообщения" hint="По одному в строке"><TextArea value={lines(s.keyMessages)} onChange={(v) => setS({ ...s, keyMessages: unlines(v) })} rows={4} /></Field>
          <Field label="KPI" hint="По одному в строке"><TextArea value={lines(s.kpis)} onChange={(v) => setS({ ...s, kpis: unlines(v) })} rows={4} /></Field>
        </div>
        <h3>Контент-план</h3>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>День</th><th>Время</th><th>Формат</th><th>Тема</th><th>Площадки</th><th /></tr></thead>
            <tbody>
              {plan.map((p, i) => (
                <tr key={i}>
                  <td style={{ width: 70 }}><input className="input" type="number" min={0} max={60} value={p.day} onChange={(e) => setPlan(plan.map((x, j) => (j === i ? { ...x, day: Number(e.target.value) } : x)))} /></td>
                  <td style={{ width: 100 }}><input className="input" type="time" value={p.time} onChange={(e) => setPlan(plan.map((x, j) => (j === i ? { ...x, time: e.target.value } : x)))} /></td>
                  <td style={{ width: 140 }}>
                    <select className="select" value={p.kind} onChange={(e) => setPlan(plan.map((x, j) => (j === i ? { ...x, kind: e.target.value as ContentKind } : x)))}>
                      {CONTENT_KINDS.filter((k) => k !== 'video').map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
                    </select>
                  </td>
                  <td><input className="input" value={p.topic} onChange={(e) => setPlan(plan.map((x, j) => (j === i ? { ...x, topic: e.target.value } : x)))} /></td>
                  <td><Toggles options={campaign.brief.platforms} value={p.platforms} onChange={(v) => setPlan(plan.map((x, j) => (j === i ? { ...x, platforms: v as PlatformId[] } : x)))} render={(pl) => PLATFORMS[pl].short} /></td>
                  <td>{i >= (campaign.plan?.length ?? 0) && <Button size="sm" variant="ghost" icon="trash" onClick={() => setPlan(plan.filter((_, j) => j !== i))} aria-label="Удалить" />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Button size="sm" icon="plus" onClick={() => setPlan([...plan, { day: (plan.at(-1)?.day ?? 0) + 1, time: '10:00', kind: 'post', pillar: s.pillars[0]?.name ?? '', topic: 'Новая тема', angle: 'Новая тема', platforms: campaign.brief.platforms }])}>
          Добавить слот
        </Button>
        <p className="small muted">Для новых слотов будут созданы материалы. Существующие слоты связаны с материалами и не удаляются отсюда — материал можно отменить в его карточке.</p>
        <ErrorBox error={save.error} />
      </div>
    </Modal>
  );
}
