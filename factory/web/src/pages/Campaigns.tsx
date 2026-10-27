import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { api } from '../api';
import { Icon } from '../components/icons';
import { Badge, Button, Empty, ErrorBox, Field, fmtDate, Loading, Notice, PlatformChip, SourceBadge, TextArea, Toggles } from '../components/ui';
import { PLATFORM_IDS, PLATFORMS, type PlatformId } from '../../../shared/platforms';
import { CONTENT_KINDS, KIND_LABEL, type ContentKind } from '../../../shared/types';
import { useWs, useWsApi } from '../session';
import type { Brand, Campaign, ProviderConfig } from '../types';

export function CampaignsPage() {
  const { ws, base, can } = useWs();
  const u = useWsApi();
  const q = useQuery({ queryKey: ['campaigns', ws.id], queryFn: () => api.get<Campaign[]>(u('/campaigns')), refetchInterval: 10_000 });
  if (q.isLoading) return <Loading />;
  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>Кампании</h1>
          <p>Каждая кампания проходит конвейер: идея → стратегия → генерация → дизайн → проверка → согласование → планирование → публикация → аналитика.</p>
        </div>
        {can('edit') && (
          <Link to={`${base}/campaigns/new`} className="btn primary">
            <Icon name="plus" /> Новая кампания
          </Link>
        )}
      </div>
      {!q.data?.length ? (
        <div className="card">
          <Empty title="Кампаний пока нет" action={can('edit') ? <Link to={`${base}/campaigns/new`} className="btn primary">Заполнить бриф</Link> : undefined}>
            Опишите задачу, аудиторию и площадки — модель предложит стратегию и контент-план, а фабрика создаст материалы.
          </Empty>
        </div>
      ) : (
        <div className="card table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Кампания</th>
                <th>Площадки</th>
                <th>Материалы</th>
                <th>Стратегия</th>
                <th>Создана</th>
              </tr>
            </thead>
            <tbody>
              {q.data.map((c) => {
                const total = Object.values(c.items ?? {}).reduce((a, b) => a + b, 0);
                return (
                  <tr key={c.id}>
                    <td>
                      <Link to={`${base}/campaigns/${c.id}`} style={{ fontWeight: 600 }}>{c.title}</Link>
                      <div className="row tight" style={{ marginTop: 4 }}>
                        {c.isDemo && <Badge tone="demo">ДЕМО</Badge>}
                        {c.ruleId && <Badge tone="info">автоматизация</Badge>}
                      </div>
                    </td>
                    <td><div className="row tight">{c.brief.platforms.map((p) => <PlatformChip key={p} id={p} label={false} />)}</div></td>
                    <td className="small">
                      {total} · <span style={{ color: 'var(--lime)' }}>{c.items?.approved ?? 0} согл.</span>
                      {c.items?.failed ? <span style={{ color: 'var(--red)' }}> · {c.items.failed} ошибок</span> : null}
                    </td>
                    <td>{c.strategySource ? <SourceBadge source={c.strategySource} /> : <Badge running dot tone="info">в работе</Badge>}</td>
                    <td className="small muted nowrap">{fmtDate(c.createdAt)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const today = () => new Date(Date.now() + 86400_000).toISOString().slice(0, 10);

export function NewCampaignPage() {
  const { ws, base } = useWs();
  const u = useWsApi();
  const nav = useNavigate();
  const brands = useQuery({ queryKey: ['brands', ws.id], queryFn: () => api.get<Brand[]>(u('/brands')) });
  const providers = useQuery({ queryKey: ['providers', ws.id], queryFn: () => api.get<{ configured: ProviderConfig[] }>(u('/providers')) });
  const [f, setF] = useState({
    title: '',
    brandId: '',
    task: '',
    audience: '',
    goal: '',
    platforms: ['telegram', 'vk'] as PlatformId[],
    formats: ['post', 'carousel', 'graphic', 'video_script'] as ContentKind[],
    frequency: 4,
    weeks: 2,
    startDate: today(),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Moscow',
    constraints: '',
  });
  const create = useMutation({
    mutationFn: () => {
      const { title, brandId, ...brief } = f;
      return api.post<Campaign>(u('/campaigns'), { title, brandId: brandId || brands.data?.[0]?.id, brief });
    },
    onSuccess: (c) => nav(`${base}/campaigns/${c.id}`),
  });
  if (brands.isLoading) return <Loading />;
  const llm = providers.data?.configured.find((p) => p.kind === 'llm' && p.isDefault) ?? providers.data?.configured.find((p) => p.kind === 'llm');
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF({ ...f, [k]: v });
  const posts = f.frequency * f.weeks;

  if (!brands.data?.length) {
    return (
      <div className="card">
        <Empty title="Сначала опишите бренд" action={<Link className="btn primary" to={`${base}/brand`}>Открыть Brand Studio</Link>}>
          Тон, аудитория, цвета и запреты бренда используются в каждой генерации и в проверке качества.
        </Empty>
      </div>
    );
  }

  return (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault();
        create.mutate();
      }}
    >
      <div className="page-head">
        <div>
          <h1>Новая кампания</h1>
          <p>Бриф — единственный обязательный ввод. Стратегию, план и каждый материал потом можно отредактировать без полной перегенерации.</p>
        </div>
      </div>
      {!llm && (
        <Notice tone="warn">
          Языковая модель не подключена — стратегия не будет создана. <Link to={`${base}/settings`} style={{ color: 'var(--lime)' }}>Подключить в настройках</Link>. Подписка на чат-интерфейс ИИ не даёт доступа к API: нужен отдельный ключ.
        </Notice>
      )}
      {llm?.provider === 'test' && <Notice tone="warn">Выбран тестовый провайдер: тексты будут шаблонными и помечены «[ТЕСТ]». Это не результат ИИ.</Notice>}
      <div className="split">
        <div className="card card-pad stack">
          <Field label="Название кампании">
            <input className="input" required minLength={2} value={f.title} onChange={(e) => set('title', e.target.value)} placeholder="Запуск отчётов по юнит-экономике" />
          </Field>
          <Field label="Бренд">
            <select className="select" value={f.brandId || brands.data[0]!.id} onChange={(e) => set('brandId', e.target.value)}>
              {brands.data.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          </Field>
          <Field label="Задача" hint="Что нужно донести и почему сейчас">
            <TextArea value={f.task} onChange={(v) => set('task', v)} rows={4} required minLength={10} max={4000} />
          </Field>
          <Field label="Аудитория">
            <TextArea value={f.audience} onChange={(v) => set('audience', v)} rows={2} required max={1000} />
          </Field>
          <Field label="Цель" hint="Например: заявки на демо, подписки, узнаваемость">
            <input className="input" required value={f.goal} onChange={(e) => set('goal', e.target.value)} />
          </Field>
          <Field label="Ограничения" hint="Что нельзя обещать, юридические оговорки, обязательные элементы">
            <TextArea value={f.constraints} onChange={(v) => set('constraints', v)} rows={3} max={2000} />
          </Field>
        </div>
        <div className="card card-pad stack">
          <Field label="Площадки">
            <Toggles options={PLATFORM_IDS} value={f.platforms} onChange={(v) => set('platforms', v)} render={(p) => <><PlatformChip id={p} label={false} />{PLATFORMS[p].name}</>} />
          </Field>
          <Field label="Форматы">
            <Toggles options={CONTENT_KINDS.filter((k) => k !== 'video')} value={f.formats} onChange={(v) => set('formats', v)} render={(k) => KIND_LABEL[k]} />
          </Field>
          <div className="grid g3">
            <Field label="Публикаций в неделю">
              <input className="input" type="number" min={1} max={14} value={f.frequency} onChange={(e) => set('frequency', Number(e.target.value))} />
            </Field>
            <Field label="Недель">
              <input className="input" type="number" min={1} max={8} value={f.weeks} onChange={(e) => set('weeks', Number(e.target.value))} />
            </Field>
            <Field label="Старт">
              <input className="input" type="date" value={f.startDate} onChange={(e) => set('startDate', e.target.value)} />
            </Field>
          </div>
          <Field label="Часовой пояс" hint="Время в плане и календаре задаётся в этом поясе">
            <input className="input" value={f.timezone} onChange={(e) => set('timezone', e.target.value)} />
          </Field>
          <Notice tone="info">
            Будет запланировано около <b>{posts}</b> материалов (лимит пространства — {ws.limits.maxItemsPerCampaign}). Сценарии видео превращаются в ролики отдельной кнопкой: рендер — затратная операция.
          </Notice>
          {f.platforms.some((p) => PLATFORMS[p].mode === 'manual') && (
            <Notice tone="warn">
              {f.platforms.filter((p) => PLATFORMS[p].mode === 'manual').map((p) => PLATFORMS[p].name).join(', ')}: нет официального API публикации. Фабрика подготовит пакет и напомнит, размещение — вручную.
            </Notice>
          )}
          <ErrorBox error={create.error} />
          <Button variant="primary" type="submit" loading={create.isPending} disabled={!f.platforms.length || !f.formats.length}>
            Создать и построить стратегию
          </Button>
        </div>
      </div>
    </form>
  );
}
