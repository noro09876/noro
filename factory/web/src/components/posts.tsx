import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, ApiError } from '../api';
import { PLATFORMS, PLATFORM_IDS, type PlatformId } from '../../../shared/platforms';
import { formatInTz } from '../../../shared/time';
import { useWs, useWsApi } from '../session';
import type { Account, Asset, ItemRow, Post } from '../types';
import { Icon } from './icons';
import { Badge, Button, Empty, ErrorBox, Field, fmtDate, MODE_BADGE, Modal, Notice, PlatformChip, PostStatusBadge, TextArea, Toggles, useToast } from './ui';

/** Social-feed-like preview of one platform variant. */
export function PlatformPreview({ platform, text, title, media, brandName }: { platform: PlatformId; text: string; title?: string | null; media: Asset[]; brandName: string }) {
  const imgs = media.filter((m) => m.kind === 'image');
  const video = media.find((m) => m.kind === 'video');
  return (
    <div className="preview-post">
      <div className="pp-head">
        <div className="avatar">{brandName.slice(0, 2).toUpperCase()}</div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 14 }}>{brandName}</div>
          <div className="tiny dim">{PLATFORMS[platform].name} · предпросмотр</div>
        </div>
      </div>
      {video ? (
        <div className="pp-media" style={{ background: '#000' }}>
          <video src={video.url} controls preload="metadata" playsInline style={{ maxHeight: 420, margin: '0 auto' }} />
        </div>
      ) : imgs.length > 1 ? (
        <div className="pp-strip">{imgs.map((i) => <img key={i.id} src={i.url} alt="" loading="lazy" />)}</div>
      ) : imgs.length === 1 ? (
        <div className="pp-media"><img src={imgs[0]!.url} alt="" loading="lazy" /></div>
      ) : null}
      {title && <div className="pp-text" style={{ fontWeight: 700, paddingTop: 12, paddingBottom: 0 }}>{title}</div>}
      <div className="pp-text" style={{ paddingTop: 12 }}>{text}</div>
    </div>
  );
}

function limitFor(platform: PlatformId, hasMedia: boolean) {
  const l = PLATFORMS[platform].limits;
  return hasMedia && l.captionMax && platform !== 'telegram' ? l.captionMax : l.textMax;
}

export function PostsPanel({ item, posts, assets, brandName, tz }: { item: ItemRow; posts: Post[]; assets: Asset[]; brandName: string; tz: string }) {
  const { ws, can } = useWs();
  const u = useWsApi();
  const qc = useQueryClient();
  const toast = useToast();
  const accounts = useQuery({ queryKey: ['accounts', ws.id], queryFn: () => api.get<{ accounts: Account[] }>(u('/accounts')) });
  const [platforms, setPlatforms] = useState<PlatformId[]>(item.platforms);
  const [chosen, setChosen] = useState<Record<string, string>>({});
  const [failures, setFailures] = useState<{ platform: string; error?: string }[]>([]);
  const prepare = useMutation({
    mutationFn: () => api.post<{ platform: PlatformId; error?: string }[]>(u(`/items/${item.id}/posts`), { platforms, accounts: chosen }),
    onSuccess: (r) => {
      setFailures(r.filter((x) => x.error));
      qc.invalidateQueries({ queryKey: ['item', item.id] });
    },
    onError: toast.err,
  });
  const current = posts.filter((p) => p.versionId === item.currentVersionId && p.status !== 'cancelled');
  const older = posts.filter((p) => !current.includes(p));
  const conn = accounts.data?.accounts.filter((a) => a.status === 'connected') ?? [];

  return (
    <div className="stack">
      {item.status !== 'approved' && (
        <Notice tone="info">Версии под площадки можно готовить и править сразу, а планировать и публиковать — только после согласования материала.</Notice>
      )}
      {can('edit') && (
        <div className="card card-pad stack">
          <h3>Подготовить версии для площадок</h3>
          <Toggles options={PLATFORM_IDS} value={platforms} onChange={setPlatforms} render={(p) => <><PlatformChip id={p} label={false} />{PLATFORMS[p].name}</>} />
          {platforms.filter((p) => PLATFORMS[p].mode !== 'manual').map((p) => {
            const list = conn.filter((a) => a.platform === p);
            return (
              <div key={p} className="row">
                <span className="small" style={{ width: 120 }}>{PLATFORMS[p].name}</span>
                {list.length ? (
                  <select className="select" style={{ maxWidth: 320 }} value={chosen[p] ?? list[list.length - 1]!.id} onChange={(e) => setChosen({ ...chosen, [p]: e.target.value })}>
                    {list.map((a) => <option key={a.id} value={a.id}>{a.displayName}{a.meta.test ? ' (тестовый)' : ''}</option>)}
                  </select>
                ) : (
                  <span className="small muted">аккаунт не подключён — версия будет подготовлена, публикация станет доступна после подключения</span>
                )}
              </div>
            );
          })}
          {failures.map((f) => <Notice key={f.platform} tone="warn">{PLATFORMS[f.platform as PlatformId]?.name}: {f.error}</Notice>)}
          <div className="row">
            <Button variant="primary" icon="layers" onClick={() => prepare.mutate()} loading={prepare.isPending} disabled={!platforms.length || !item.currentVersionId}>
              Подготовить
            </Button>
            <a className="btn" href={u(`/items/${item.id}/export`)}>
              <Icon name="download" /> Пакет для ручной публикации
            </a>
          </div>
        </div>
      )}
      {current.length === 0 && <div className="card"><Empty title="Версий для площадок пока нет">Тексты адаптируются под лимиты и правила каждой площадки; файлы подбираются по формату.</Empty></div>}
      {current.map((p) => (
        <PostCard key={p.id} post={p} item={item} assets={assets} brandName={brandName} tz={tz} accounts={accounts.data?.accounts ?? []} />
      ))}
      {older.length > 0 && (
        <details className="card card-pad">
          <summary className="small muted" style={{ cursor: 'pointer' }}>Публикации прошлых версий и отменённые · {older.length}</summary>
          <div className="table-wrap" style={{ marginTop: 10 }}>
            <table className="table">
              <tbody>
                {older.map((p) => (
                  <tr key={p.id}>
                    <td><PlatformChip id={p.platform} /></td>
                    <td><PostStatusBadge status={p.status} testMode={p.testMode} /></td>
                    <td className="small mono">{fmtDate(p.publishedAt ?? p.scheduledAt, p.timezone)}</td>
                    <td>{p.externalUrl && <a href={p.externalUrl} target="_blank" rel="noreferrer" className="small" style={{ color: 'var(--lime)' }}>ссылка</a>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </div>
  );
}

function PostCard({ post, item, assets, brandName, tz, accounts }: { post: Post; item: ItemRow; assets: Asset[]; brandName: string; tz: string; accounts: Account[] }) {
  const { can } = useWs();
  const u = useWsApi();
  const qc = useQueryClient();
  const toast = useToast();
  const spec = PLATFORMS[post.platform];
  const media = post.assetIds.map((id) => assets.find((a) => a.id === id)).filter(Boolean) as Asset[];
  const [text, setText] = useState(post.text);
  const [title, setTitle] = useState(post.title ?? '');
  const local = post.scheduledAt ? formatInTz(post.scheduledAt, post.timezone) : null;
  const [when, setWhen] = useState({ date: local?.date ?? new Date(Date.now() + 86400_000).toISOString().slice(0, 10), time: local?.time ?? '10:00', timezone: post.timezone || tz });
  const [conflict, setConflict] = useState<string | null>(null);
  const [confirmPublish, setConfirmPublish] = useState(false);
  const [manualUrl, setManualUrl] = useState('');
  const [showLog, setShowLog] = useState(false);
  const refresh = () => qc.invalidateQueries({ queryKey: ['item', item.id] });
  const editable = ['draft', 'ready', 'scheduled', 'failed'].includes(post.status);
  const limit = limitFor(post.platform, media.length > 0);
  const account = accounts.find((a) => a.id === post.accountId);
  const unknown = post.lastErrorCode === 'unknown_outcome';

  const save = useMutation({ mutationFn: () => api.patch(u(`/posts/${post.id}`), { text, ...(spec.limits.titleMax || spec.mode === 'manual' ? { title: title || null } : {}) }), onSuccess: () => { toast.ok('Текст сохранён'); refresh(); }, onError: toast.err });
  const schedule = useMutation({
    mutationFn: (force: boolean) => api.post(u(`/posts/${post.id}/schedule`), { ...when, force }),
    onSuccess: () => { setConflict(null); toast.ok('Запланировано'); refresh(); qc.invalidateQueries({ queryKey: ['posts'] }); },
    onError: (e) => (e instanceof ApiError && e.code === 'schedule_conflict' ? setConflict(e.message) : toast.err(e)),
  });
  const publish = useMutation({ mutationFn: () => api.post(u(`/posts/${post.id}/publish`), { confirmNotPublished: unknown }), onSuccess: () => { setConfirmPublish(false); toast.info('Отправлено в очередь публикации. Статус обновится после ответа площадки.'); refresh(); }, onError: toast.err });
  const cancel = useMutation({ mutationFn: () => api.post(u(`/posts/${post.id}/cancel`)), onSuccess: refresh, onError: toast.err });
  const manual = useMutation({ mutationFn: () => api.post(u(`/posts/${post.id}/manual-done`), { url: manualUrl }), onSuccess: () => { toast.ok('Отмечено: размещено вручную'); refresh(); }, onError: toast.err });
  const log = useQuery({ queryKey: ['post', post.id], queryFn: () => api.get<{ attempts: { id: string; attempt: number; outcome: string; errorCode: string | null; message: string | null; startedAt: string; response: Record<string, unknown> | null }[] }>(u(`/posts/${post.id}`)), enabled: showLog, refetchInterval: showLog ? 4000 : false });

  return (
    <div className="card">
      <div className="card-head">
        <div className="row">
          <PlatformChip id={post.platform} />
          <Badge tone={MODE_BADGE[spec.mode]!.tone}>{MODE_BADGE[spec.mode]!.label}</Badge>
          <PostStatusBadge status={post.status} testMode={post.testMode} />
        </div>
        <div className="small muted">{account ? account.displayName : spec.mode === 'manual' ? 'ручное размещение' : 'аккаунт не выбран'}</div>
      </div>
      <div className="card-body split">
        <PlatformPreview platform={post.platform} text={text} title={title || null} media={media} brandName={brandName} />
        <div className="stack">
          {post.status === 'published' && (
            <Notice tone="ok">
              Площадка подтвердила публикацию {fmtDate(post.publishedAt, post.timezone)}.{' '}
              {post.externalUrl ? <a href={post.externalUrl} target="_blank" rel="noreferrer" style={{ color: 'var(--lime)' }}>Открыть пост</a> : <span className="mono tiny">id {post.externalId}</span>}
              {post.testMode && <div className="small">Это тестовая или видимая только автору публикация.</div>}
            </Notice>
          )}
          {post.status === 'manual_done' && <Notice tone="ok">Размещено вручную: <a href={post.externalUrl!} target="_blank" rel="noreferrer" style={{ color: 'var(--lime)' }}>{post.externalUrl}</a></Notice>}
          {post.status === 'manual_pending' && <Notice tone="warn">{spec.name} не даёт API публикации. Скачайте пакет, разместите материал и вставьте ссылку ниже.</Notice>}
          {post.lastError && post.status !== 'published' && (
            <Notice tone={post.status === 'failed' ? 'err' : 'warn'}>
              {post.lastError}
              {post.status === 'scheduled' && post.nextAttemptAt && <div className="small">Повтор: {fmtDate(post.nextAttemptAt, post.timezone)} · попытка {post.attempts + 1} из {post.maxAttempts}</div>}
            </Notice>
          )}
          {(spec.limits.titleMax || spec.mode === 'manual') && (
            <Field label={`Заголовок${spec.limits.titleMax ? ` (до ${spec.limits.titleMax})` : ''}`}>
              <input className="input" value={title} disabled={!editable || !can('edit')} maxLength={spec.limits.titleMax ?? 200} onChange={(e) => setTitle(e.target.value)} />
            </Field>
          )}
          <Field label="Текст для площадки">
            <TextArea rows={8} value={text} onChange={setText} max={limit} disabled={!editable || !can('edit')} />
          </Field>
          {post.meta.truncated ? <p className="tiny dim">Текст был сокращён под лимит {spec.name} по границе предложения.</p> : null}
          {editable && can('edit') && (text !== post.text || title !== (post.title ?? '')) && (
            <Button size="sm" onClick={() => save.mutate()} loading={save.isPending}>Сохранить текст</Button>
          )}
          {editable && can('publish') && (
            <>
              <div className="sep" />
              <div className="grid g3">
                <Field label="Дата"><input className="input" type="date" value={when.date} onChange={(e) => setWhen({ ...when, date: e.target.value })} /></Field>
                <Field label="Время"><input className="input" type="time" value={when.time} onChange={(e) => setWhen({ ...when, time: e.target.value })} /></Field>
                <Field label="Пояс"><input className="input" value={when.timezone} onChange={(e) => setWhen({ ...when, timezone: e.target.value })} /></Field>
              </div>
              {conflict && (
                <Notice tone="warn">
                  {conflict}
                  <div className="row" style={{ marginTop: 8 }}>
                    <Button size="sm" onClick={() => schedule.mutate(true)}>Всё равно запланировать</Button>
                  </div>
                </Notice>
              )}
              <div className="row">
                <Button icon="clock" onClick={() => schedule.mutate(false)} loading={schedule.isPending} disabled={item.status !== 'approved'}>
                  {post.status === 'scheduled' ? 'Перенести' : 'Запланировать'}
                </Button>
                {spec.mode !== 'manual' ? (
                  <Button variant="primary" icon="send" onClick={() => setConfirmPublish(true)} disabled={item.status !== 'approved' || !post.accountId}>
                    {unknown ? 'Повторить после проверки' : 'Опубликовать сейчас'}
                  </Button>
                ) : null}
                {['ready', 'scheduled', 'failed'].includes(post.status) && <Button variant="ghost" onClick={() => cancel.mutate()}>Отменить</Button>}
              </div>
            </>
          )}
          {(spec.mode === 'manual' || unknown) && ['ready', 'scheduled', 'manual_pending', 'failed'].includes(post.status) && can('publish') && (
            <div className="row">
              <input className="input" style={{ flex: 1, minWidth: 200 }} placeholder={`https://… ссылка на материал в ${spec.name}`} value={manualUrl} onChange={(e) => setManualUrl(e.target.value)} />
              <Button onClick={() => manual.mutate()} loading={manual.isPending} disabled={!manualUrl}>
                {unknown ? 'Пост вышел — отметить' : 'Размещено вручную'}
              </Button>
            </div>
          )}
          <button className="btn ghost sm" style={{ alignSelf: 'flex-start' }} onClick={() => setShowLog(!showLog)}>
            <Icon name="list" /> История попыток ({post.attempts})
          </button>
          {showLog && (
            <div className="col" style={{ gap: 6 }}>
              {log.data?.attempts.length ? (
                log.data.attempts.map((a) => (
                  <div key={a.id} className="small row" style={{ alignItems: 'flex-start' }}>
                    <span className="mono tiny dim nowrap">{fmtDate(a.startedAt)} · №{a.attempt}</span>
                    <Badge tone={a.outcome === 'success' ? 'ok' : a.outcome === 'test' ? 'test' : a.outcome === 'error' ? 'err' : undefined}>{a.outcome}</Badge>
                    <span className="muted" style={{ flex: 1, minWidth: 0 }}>{a.errorCode ? `${a.errorCode}: ` : ''}{a.message ?? (a.response?.url as string) ?? ''}</span>
                  </div>
                ))
              ) : (
                <span className="small muted">Попыток ещё не было.</span>
              )}
            </div>
          )}
        </div>
      </div>
      <Modal
        open={confirmPublish}
        onClose={() => setConfirmPublish(false)}
        title="Опубликовать сейчас?"
        footer={
          <>
            <Button onClick={() => setConfirmPublish(false)}>Отмена</Button>
            <Button variant="primary" icon="send" loading={publish.isPending} onClick={() => publish.mutate()}>Опубликовать</Button>
          </>
        }
      >
        <div className="stack">
          <p>
            Материал будет отправлен в <b>{account?.displayName ?? spec.name}</b> через официальный API {spec.name}. Это реальное действие в вашем аккаунте{account?.meta.test ? ' (аккаунт отмечен как тестовый)' : ''}.
          </p>
          {unknown && <Notice tone="warn">Прошлая попытка прервалась. Подтверждая, вы сообщаете, что проверили площадку и поста там нет — иначе появится дубль.</Notice>}
          <p className="small muted">Статус «Опубликовано» появится только после ответа площадки. При временной ошибке будет до {post.maxAttempts} попыток с паузами; повтор никогда не создаёт второй пост.</p>
          <ErrorBox error={publish.error} />
        </div>
      </Modal>
    </div>
  );
}
