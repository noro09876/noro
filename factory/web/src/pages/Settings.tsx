import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api';
import { Icon } from '../components/icons';
import { Badge, Button, ErrorBox, Field, fmtDate, Loading, Modal, Notice, Tabs, useToast } from '../components/ui';
import { ROLES, ROLE_LABEL } from '../../../shared/types';
import { useWs, useWsApi } from '../session';
import type { ProviderConfig, ProviderInfo, Role } from '../types';

type Tab = 'providers' | 'limits' | 'members' | 'usage';

export function SettingsPage() {
  const [tab, setTab] = useState<Tab>('providers');
  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>Настройки</h1>
          <p>Провайдеры ИИ, ключи, лимиты, участники. Ключи хранятся зашифрованными и не возвращаются в интерфейс — видна только маска.</p>
        </div>
      </div>
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'providers', label: 'Провайдеры ИИ' }, { value: 'limits', label: 'Лимиты' }, { value: 'members', label: 'Участники и роли' }, { value: 'usage', label: 'Расход' }]} />
      {tab === 'providers' && <Providers />}
      {tab === 'limits' && <Limits />}
      {tab === 'members' && <Members />}
      {tab === 'usage' && <Usage />}
    </div>
  );
}

const KIND_TITLE = { llm: 'Языковые модели (стратегия и тексты)', image: 'Изображения (фоны для графики)', tts: 'Озвучка (видео)' } as const;

function Providers() {
  const { ws, can } = useWs();
  const u = useWsApi();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['providers', ws.id], queryFn: () => api.get<{ catalog: ProviderInfo[]; configured: ProviderConfig[] }>(u('/providers')) });
  const [edit, setEdit] = useState<{ info: ProviderInfo; existing?: ProviderConfig } | null>(null);
  const check = useMutation({ mutationFn: (id: string) => api.post<{ ok: boolean; message: string }>(u(`/providers/${id}/check`)), onSuccess: (r) => { if (r.ok) toast.ok(r.message); else toast.err(new Error(r.message)); qc.invalidateQueries({ queryKey: ['providers'] }); } });
  const del = useMutation({ mutationFn: (id: string) => api.del(u(`/providers/${id}`)), onSuccess: () => qc.invalidateQueries({ queryKey: ['providers'] }) });
  if (q.isLoading || !q.data) return <Loading />;
  return (
    <div className="stack">
      <Notice tone="info">Подписка на чат-сервис (Claude Pro, ChatGPT Plus и т. п.) не даёт доступа к API. Для генерации нужен API-ключ с оплатой по использованию. Бесплатная локальная озвучка Piper работает без ключа.</Notice>
      {(['llm', 'tts', 'image'] as const).map((kind) => (
        <div key={kind} className="card">
          <div className="card-head"><h2>{KIND_TITLE[kind]}</h2></div>
          <div className="card-body grid auto-fill">
            {q.data.catalog.filter((c) => c.kind === kind).map((info) => {
              const cfgs = q.data.configured.filter((c) => c.provider === info.id);
              return (
                <div key={info.id} className="card card-pad stack" style={{ background: 'var(--bg-2)' }}>
                  <div className="row between">
                    <b>{info.name}</b>
                    <div className="row tight">
                      {info.local && <Badge tone="ok">локально · бесплатно</Badge>}
                      {info.testOnly && <Badge tone="test">ТЕСТ · не ИИ</Badge>}
                      {!info.available && <Badge tone="warn">не установлен</Badge>}
                    </div>
                  </div>
                  <p className="small muted">{info.setup}</p>
                  {info.pricing && <p className="tiny dim">{info.pricing}</p>}
                  {cfgs.map((c) => (
                    <div key={c.id} className="col" style={{ gap: 6, padding: 10, border: '1px solid var(--line)', borderRadius: 10 }}>
                      <div className="row between">
                        <span className="small">{c.label} <span className="mono tiny dim">{c.model}</span></span>
                        <div className="row tight">
                          {c.isDefault && <Badge tone="info">по умолчанию</Badge>}
                          <Badge tone={c.status === 'ok' ? 'ok' : c.status === 'error' ? 'err' : undefined} dot>{c.status === 'ok' ? 'работает' : c.status === 'error' ? 'ошибка' : 'не проверен'}</Badge>
                        </div>
                      </div>
                      {c.hasKey && <span className="mono tiny dim">ключ {c.keyHint}</span>}
                      {c.lastError && <span className="small" style={{ color: 'var(--red)' }}>{c.lastError}</span>}
                      {can('admin') && (
                        <div className="row tight">
                          <Button size="xs" icon="refresh" onClick={() => check.mutate(c.id)} loading={check.isPending}>Проверить</Button>
                          <Button size="xs" icon="edit" onClick={() => setEdit({ info, existing: c })}>Изменить</Button>
                          <Button size="xs" variant="danger" icon="trash" onClick={() => confirm('Удалить провайдера вместе с ключом?') && del.mutate(c.id)} />
                        </div>
                      )}
                    </div>
                  ))}
                  {can('admin') && cfgs.length === 0 && <Button size="sm" icon={info.needsKey ? 'key' : 'plus'} onClick={() => setEdit({ info })} disabled={!info.available}>{info.needsKey ? 'Добавить ключ' : 'Включить'}</Button>}
                  {info.docsUrl && <a className="tiny" href={info.docsUrl} target="_blank" rel="noreferrer" style={{ color: 'var(--blue)' }}>Документация <Icon name="external" width={11} /></a>}
                </div>
              );
            })}
          </div>
        </div>
      ))}
      {edit && <ProviderModal info={edit.info} existing={edit.existing} onClose={() => setEdit(null)} />}
    </div>
  );
}

function ProviderModal({ info, existing, onClose }: { info: ProviderInfo; existing?: ProviderConfig; onClose: () => void }) {
  const u = useWsApi();
  const qc = useQueryClient();
  const toast = useToast();
  const [model, setModel] = useState(existing?.model ?? info.defaultModel ?? '');
  const [values, setValues] = useState<Record<string, string>>(existing?.settings ?? {});
  const [isDefault, setDefault] = useState(existing?.isDefault ?? true);
  const save = useMutation({
    mutationFn: () => {
      const { apiKey, ...settings } = values;
      return api.post<{ check: { ok: boolean; message: string } }>(u('/providers'), { id: existing?.id, kind: info.kind, provider: info.id, model, settings, apiKey: apiKey || undefined, isDefault });
    },
    onSuccess: (r) => {
      if (r.check.ok) toast.ok(`Сохранено и проверено: ${r.check.message}`);
      else toast.err(new Error(`Сохранено, но проверка не прошла: ${r.check.message}`));
      qc.invalidateQueries({ queryKey: ['providers'] });
      onClose();
    },
  });
  return (
    <Modal open onClose={onClose} title={info.name} footer={<><Button onClick={onClose}>Отмена</Button><Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>Сохранить и проверить</Button></>}>
      <div className="stack">
        <p className="small muted">{info.setup}</p>
        {info.models?.length ? (
          <Field label="Модель">
            <input className="input mono" list={`models-${info.id}`} value={model} onChange={(e) => setModel(e.target.value)} />
            <datalist id={`models-${info.id}`}>{info.models.map((m) => <option key={m} value={m} />)}</datalist>
          </Field>
        ) : null}
        {info.fields.map((f) => (
          <Field key={f.key} label={`${f.label}${f.required ? '' : ' (необязательно)'}`} hint={f.key === 'apiKey' && existing?.hasKey ? `Сохранён ключ ${existing.keyHint}. Оставьте пустым, чтобы не менять.` : f.help}>
            <input className="input mono" type={f.secret ? 'password' : 'text'} autoComplete="off" placeholder={f.placeholder} value={values[f.key] ?? ''} onChange={(e) => setValues({ ...values, [f.key]: e.target.value })} />
          </Field>
        ))}
        <label className="check"><input type="checkbox" checked={isDefault} onChange={(e) => setDefault(e.target.checked)} /> Использовать по умолчанию</label>
        <ErrorBox error={save.error} />
      </div>
    </Modal>
  );
}

function Limits() {
  const { ws, can } = useWs();
  const u = useWsApi();
  const qc = useQueryClient();
  const toast = useToast();
  const [f, setF] = useState({ name: ws.name, dailyGenerationLimit: ws.limits.dailyGenerationLimit, dailyRenderLimit: ws.limits.dailyRenderLimit, maxItemsPerCampaign: ws.limits.maxItemsPerCampaign });
  const save = useMutation({ mutationFn: () => api.patch(u('/settings'), f), onSuccess: () => { toast.ok('Сохранено'); qc.invalidateQueries({ queryKey: ['ws'] }); qc.invalidateQueries({ queryKey: ['me'] }); } });
  const pct = (a: number, b: number) => Math.min(100, Math.round((a / b) * 100));
  return (
    <div className="split">
      <form className="card card-pad stack" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
        <h2>Пространство и лимиты</h2>
        <fieldset disabled={!can('admin')} style={{ border: 0, padding: 0, margin: 0 }} className="stack">
          <Field label="Название"><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="Генераций ИИ в сутки" hint="Защита от случайного массового расхода"><input className="input" type="number" min={1} value={f.dailyGenerationLimit} onChange={(e) => setF({ ...f, dailyGenerationLimit: Number(e.target.value) })} /></Field>
          <Field label="Рендеров в сутки" hint="Слайды, графика и видео"><input className="input" type="number" min={1} value={f.dailyRenderLimit} onChange={(e) => setF({ ...f, dailyRenderLimit: Number(e.target.value) })} /></Field>
          <Field label="Материалов в одной кампании"><input className="input" type="number" min={1} value={f.maxItemsPerCampaign} onChange={(e) => setF({ ...f, maxItemsPerCampaign: Number(e.target.value) })} /></Field>
          <ErrorBox error={save.error} />
          <Button variant="primary" type="submit" loading={save.isPending} style={{ alignSelf: 'flex-start' }}>Сохранить</Button>
        </fieldset>
      </form>
      <div className="card card-pad stack">
        <h2>Использовано за 24 часа</h2>
        {[
          { label: 'Генерации текста', used: ws.used.llm, max: ws.limits.dailyGenerationLimit },
          { label: 'Изображения', used: ws.used.image, max: ws.limits.dailyGenerationLimit },
          { label: 'Озвучка', used: ws.used.tts, max: ws.limits.dailyGenerationLimit },
          { label: 'Рендеры', used: ws.used.render, max: ws.limits.dailyRenderLimit },
        ].map((r) => (
          <div key={r.label} className="col" style={{ gap: 6 }}>
            <div className="row between small"><span>{r.label}</span><span className="mono">{r.used} / {r.max}</span></div>
            <div className="progress"><i style={{ width: `${pct(r.used, r.max)}%`, background: pct(r.used, r.max) > 85 ? 'var(--amber)' : undefined }} /></div>
          </div>
        ))}
        <p className="tiny dim">Хранилище файлов настраивается на сервере: локальный диск или S3-совместимое (AWS, Yandex Object Storage, MinIO). См. docs/architecture.md.</p>
      </div>
    </div>
  );
}

function Members() {
  const { ws, can } = useWs();
  const u = useWsApi();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['members', ws.id], queryFn: () => api.get<{ userId: string; email: string; name: string; role: Role; since: string }[]>(u('/members')) });
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('editor');
  const add = useMutation({ mutationFn: (b: { email: string; role: Role }) => api.post(u('/members'), b), onSuccess: () => { setEmail(''); qc.invalidateQueries({ queryKey: ['members'] }); }, onError: toast.err });
  const remove = useMutation({ mutationFn: (id: string) => api.del(u(`/members/${id}`)), onSuccess: () => qc.invalidateQueries({ queryKey: ['members'] }), onError: toast.err });
  if (q.isLoading) return <Loading />;
  return (
    <div className="split">
      <div className="card table-wrap">
        <table className="table">
          <thead><tr><th>Участник</th><th>Роль</th><th /></tr></thead>
          <tbody>
            {q.data?.map((m) => (
              <tr key={m.userId}>
                <td><div>{m.name}</div><div className="tiny dim">{m.email}</div></td>
                <td>
                  {can('admin') ? (
                    <select className="select" style={{ width: 170 }} value={m.role} onChange={(e) => add.mutate({ email: m.email, role: e.target.value as Role })}>
                      {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                    </select>
                  ) : ROLE_LABEL[m.role]}
                </td>
                <td>{can('admin') && <Button size="xs" variant="ghost" icon="trash" onClick={() => remove.mutate(m.userId)} aria-label="Удалить" />}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="card card-pad stack">
        <h2>Роли</h2>
        <dl className="kv small">
          <dt>Владелец, администратор</dt><dd>Всё, включая ключи, соцсети, автоматизации и участников</dd>
          <dt>Редактор</dt><dd>Кампании, правки, подготовка и планирование публикаций</dd>
          <dt>Согласующий</dt><dd>Просмотр, согласование и отклонение материалов</dd>
          <dt>Наблюдатель</dt><dd>Только просмотр</dd>
        </dl>
        {can('admin') && (
          <form className="stack" onSubmit={(e) => { e.preventDefault(); add.mutate({ email, role }); }}>
            <Field label="Email зарегистрированного пользователя"><input className="input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
            <Field label="Роль"><select className="select" value={role} onChange={(e) => setRole(e.target.value as Role)}>{ROLES.filter((r) => r !== 'owner' || ws.role === 'owner').map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select></Field>
            <Button type="submit" loading={add.isPending}>Добавить</Button>
          </form>
        )}
      </div>
    </div>
  );
}

function Usage() {
  const { ws } = useWs();
  const u = useWsApi();
  const q = useQuery({ queryKey: ['usage', ws.id], queryFn: () => api.get<{ day: string; kind: string; provider: string; n: number; inTok: number; outTok: number }[]>(u('/usage')) });
  if (q.isLoading) return <Loading />;
  return (
    <div className="card table-wrap">
      <table className="table">
        <thead><tr><th>День</th><th>Тип</th><th>Провайдер</th><th>Операций</th><th>Токены (вход / выход)</th></tr></thead>
        <tbody>
          {q.data?.map((r, i) => (
            <tr key={i}><td className="mono small">{r.day}</td><td>{r.kind}</td><td className="mono small">{r.provider}</td><td className="mono">{r.n}</td><td className="mono small">{r.inTok || r.outTok ? `${r.inTok} / ${r.outTok}` : '—'}</td></tr>
          ))}
          {!q.data?.length && <tr><td colSpan={5} className="muted small">За 30 дней операций не было. {fmtDate(new Date(), undefined, false)}</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
