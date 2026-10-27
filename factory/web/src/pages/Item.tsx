import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { api } from '../api';
import { wordDiff } from '../components/diff';
import { ContentEditor, RegenDialog } from '../components/editors';
import { Icon } from '../components/icons';
import { PlatformPreview, PostsPanel } from '../components/posts';
import { Badge, Button, ErrorBox, Field, fmtBytes, fmtDate, fmtDuration, ItemStatus, Lightbox, Loading, Modal, Notice, Seg, SourceBadge, Tabs, TextArea, useToast } from '../components/ui';
import { adaptForPlatform, textOf } from '../../../shared/quality';
import { KIND_LABEL, type VideoData } from '../../../shared/types';
import { useWs, useWsApi } from '../session';
import type { Asset, Brand, ItemRow, Post, Version } from '../types';
import { PLATFORMS, type PlatformId } from '../../../shared/platforms';

interface ItemView {
  item: ItemRow;
  campaign: { id: string; title: string; timezone: string; platforms: string[]; isDemo: boolean };
  brand: Brand;
  versions: Version[];
  approvals: { id: string; versionId: string; status: string; comment: string | null; decidedAt: string | null; createdAt: string }[];
  posts: Post[];
  children: { id: string; title: string; status: string }[];
}

type Tab = 'content' | 'platforms' | 'versions' | 'review';

export function ItemPage() {
  const { id } = useParams();
  const { base, can } = useWs();
  const u = useWsApi();
  const qc = useQueryClient();
  const nav = useNavigate();
  const toast = useToast();
  const [tab, setTab] = useState<Tab>('content');
  const [draft, setDraft] = useState<Record<string, unknown> | null>(null);
  const [regen, setRegen] = useState<{ target: string; label: string } | null>(null);
  const [reject, setReject] = useState(false);
  const [comment, setComment] = useState('');

  const q = useQuery({
    queryKey: ['item', id],
    queryFn: () => api.get<ItemView>(u(`/items/${id}`)),
    refetchInterval: (query) => (query.state.data?.item.status === 'generating' || query.state.data?.posts.some((p) => p.status === 'publishing') ? 2000 : 12_000),
  });
  const data = q.data;
  const current = data?.versions.find((v) => v.id === data.item.currentVersionId) ?? data?.versions[0];
  useEffect(() => setDraft(null), [current?.id]);

  const refresh = () => qc.invalidateQueries({ queryKey: ['item', id] });
  const save = useMutation({ mutationFn: () => api.post(u(`/items/${id}/versions`), { data: draft, note: 'Ручная правка' }), onSuccess: () => { toast.ok('Сохранено как новая версия'); setDraft(null); refresh(); }, onError: toast.err });
  const regenerate = useMutation({ mutationFn: (b: { instruction?: string; target?: string }) => api.post(u(`/items/${id}/regenerate`), b), onSuccess: () => { setRegen(null); toast.info('Генерация запущена'); refresh(); }, onError: toast.err });
  const render = useMutation({ mutationFn: (withoutVoice: boolean) => api.post(u(`/items/${id}/render`), { withoutVoice }), onSuccess: () => { toast.info('Рендер поставлен в очередь'); refresh(); }, onError: toast.err });
  const review = useMutation({ mutationFn: () => api.post(u(`/items/${id}/review`)), onSuccess: () => { toast.ok('Отправлено на согласование'); refresh(); }, onError: toast.err });
  const decide = useMutation({ mutationFn: (b: { decision: 'approved' | 'rejected'; comment?: string }) => api.post(u(`/items/${id}/decision`), b), onSuccess: () => { setReject(false); setComment(''); refresh(); }, onError: toast.err });
  const makeVideo = useMutation({ mutationFn: (aspect: string) => api.post<{ id: string }>(u(`/items/${id}/video`), { aspect }), onSuccess: (v) => { toast.info('Видео создаётся: озвучка, субтитры, рендер'); nav(`${base}/items/${v.id}`); }, onError: toast.err });

  if (q.isLoading || !data || !current) return q.error ? <ErrorBox error={q.error} /> : <Loading />;
  const { item, brand } = data;
  const shown = draft ?? current.data;
  const busy = item.status === 'generating';
  const check = current.check;

  return (
    <div className="stack">
      <div className="page-head">
        <div style={{ minWidth: 0 }}>
          <div className="row tight" style={{ marginBottom: 6 }}>
            <Link to={`${base}/campaigns/${data.campaign.id}`} className="small muted">← {data.campaign.title}</Link>
          </div>
          <h1>{item.title}</h1>
          <div className="row tight" style={{ marginTop: 8 }}>
            <Badge>{KIND_LABEL[item.kind]}</Badge>
            <ItemStatus status={item.status} />
            <SourceBadge source={current.source} model={current.model} />
            <span className="small muted">версия {current.version}{item.plannedAt ? ` · план: ${fmtDate(item.plannedAt, data.campaign.timezone)}` : ''}</span>
          </div>
        </div>
        <div className="row">
          <a className="btn" href={u(`/items/${item.id}/export`)}><Icon name="download" /> ZIP</a>
          {item.kind === 'video_script' && can('edit') && (
            <Button icon="film" onClick={() => makeVideo.mutate('9:16')} loading={makeVideo.isPending} disabled={busy}>Сделать видео 9:16</Button>
          )}
          {can('edit') && ['ready', 'rejected'].includes(item.status) && (
            <Button icon="send" onClick={() => review.mutate()} loading={review.isPending} disabled={!check?.passed}>На согласование</Button>
          )}
          {can('approve') && ['ready', 'in_review'].includes(item.status) && (
            <>
              <Button variant="primary" icon="check" onClick={() => decide.mutate({ decision: 'approved' })} loading={decide.isPending} disabled={!check?.passed}>Согласовать</Button>
              <Button variant="danger" onClick={() => setReject(true)}>Отклонить</Button>
            </>
          )}
        </div>
      </div>

      {current.source === 'test' && <Notice tone="warn">Эта версия создана тестовым провайдером (детерминированный шаблон, не ИИ). Подключите языковую модель для реальной генерации.</Notice>}
      {current.source === 'demo' && <Notice tone="info">Демо-материал: тексты подготовлены при разработке витрины, бренд вымышленный. Визуалы и видео отрендерены фабрикой.</Notice>}
      {item.lastError && <Notice tone="err">{item.lastError}</Notice>}
      {busy && <Notice tone="info" icon="refresh">Идёт генерация или рендер. Страница обновится сама.</Notice>}
      {data.children.length > 0 && (
        <Notice tone="info">
          По сценарию созданы видео: {data.children.map((c) => <Link key={c.id} to={`${base}/items/${c.id}`} style={{ color: 'var(--lime)', marginRight: 10 }}>{c.title}</Link>)}
        </Notice>
      )}

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'content', label: 'Контент' },
          { value: 'platforms', label: `Площадки · ${data.posts.filter((p) => p.status !== 'cancelled').length}` },
          { value: 'versions', label: `Версии · ${data.versions.length}` },
          { value: 'review', label: <>Проверка {check ? (check.passed ? <span style={{ color: 'var(--lime)' }}>✓</span> : <span style={{ color: 'var(--red)' }}>!</span>) : null}</> },
        ]}
      />

      {tab === 'content' && (
        <div className="split">
          <div className="card card-pad stack">
            <div className="row between">
              <h2>Редактор</h2>
              <div className="row tight">
                {can('edit') && <Button size="sm" icon="sparkle" onClick={() => setRegen({ target: '', label: 'весь материал' })} disabled={busy}>Переписать всё</Button>}
              </div>
            </div>
            <fieldset disabled={!can('edit') || busy} style={{ border: 0, padding: 0, margin: 0 }}>
              <ContentEditor kind={item.kind} data={shown} onChange={setDraft} regen={can('edit') ? (target, label) => setRegen({ target, label }) : undefined} />
            </fieldset>
            {draft && (
              <div className="row" style={{ position: 'sticky', bottom: 12, background: 'var(--panel)', padding: 10, borderRadius: 12, border: '1px solid var(--line-2)' }}>
                <Button variant="primary" icon="check" onClick={() => save.mutate()} loading={save.isPending}>Сохранить версию</Button>
                <Button variant="ghost" onClick={() => setDraft(null)}>Отменить правки</Button>
                {(item.kind === 'carousel' || item.kind === 'graphic') && <span className="tiny dim">После сохранения визуалы перерисуются</span>}
                {item.kind === 'video' && <span className="tiny dim">После сохранения нажмите «Перерендерить»</span>}
              </div>
            )}
            <ErrorBox error={save.error} />
          </div>
          <div className="stack" style={{ position: 'sticky', top: 76 }}>
            <MediaPreview item={item} version={current} brand={brand} draft={shown} onRender={can('edit') ? (wv) => render.mutate(wv) : undefined} rendering={render.isPending || busy} />
          </div>
        </div>
      )}

      {tab === 'platforms' && <PostsPanel item={item} posts={data.posts} assets={current.assets} brandName={brand.name} tz={data.campaign.timezone} />}

      {tab === 'versions' && <VersionsPanel versions={data.versions} kind={item.kind} currentId={current.id} onRestore={can('edit') ? async (vid) => { await api.post(u(`/items/${id}/restore`), { versionId: vid }); toast.ok('Версия восстановлена'); refresh(); } : undefined} />}

      {tab === 'review' && (
        <div className="split">
          <div className="card">
            <div className="card-head">
              <h2>Проверка качества</h2>
              {check && <Badge tone={check.passed ? 'ok' : 'err'}>{check.passed ? 'пройдена' : 'есть ошибки'}</Badge>}
            </div>
            <div className="card-body">
              {check ? (
                check.results.map((r, i) => (
                  <div key={i} className="check-row">
                    <span className="ic" style={{ color: r.level === 'ok' ? 'var(--lime)' : r.level === 'warning' ? 'var(--amber)' : 'var(--red)' }}>{r.level === 'ok' ? '✓' : r.level === 'warning' ? '!' : '×'}</span>
                    <div style={{ flex: 1 }}>
                      <div>{r.message}</div>
                      {r.platform && <span className="tiny dim">{r.platform}</span>}
                    </div>
                  </div>
                ))
              ) : (
                <p className="muted small">Проверка выполняется после генерации и рендера.</p>
              )}
            </div>
          </div>
          <div className="card">
            <div className="card-head"><h2>Согласование</h2></div>
            <div className="card-body">
              {data.approvals.length ? (
                <ul className="list">
                  {data.approvals.map((a) => (
                    <li key={a.id}>
                      <Badge tone={a.status === 'approved' ? 'ok' : a.status === 'rejected' ? 'err' : a.status === 'pending' ? 'warn' : undefined}>
                        {{ approved: 'согласовано', rejected: 'отклонено', pending: 'ожидает', cancelled: 'отменено' }[a.status] ?? a.status}
                      </Badge>
                      <div style={{ flex: 1 }}>
                        <div className="small">версия {data.versions.find((v) => v.id === a.versionId)?.version ?? '?'} · {fmtDate(a.decidedAt ?? a.createdAt)}</div>
                        {a.comment && <div className="small muted">{a.comment}</div>}
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="small muted">Материал ещё не отправлялся на согласование. Согласование относится к конкретной версии: после правки его нужно получить заново.</p>
              )}
            </div>
          </div>
        </div>
      )}

      <RegenDialog
        target={regen ? regen.target || 'all' : null}
        label={regen?.label ?? ''}
        onClose={() => setRegen(null)}
        busy={regenerate.isPending}
        onSubmit={(instruction) => regenerate.mutate({ instruction, target: regen?.target || undefined })}
      />
      <Modal open={reject} onClose={() => setReject(false)} title="Отклонить материал" footer={<><Button onClick={() => setReject(false)}>Отмена</Button><Button variant="danger" disabled={!comment.trim()} loading={decide.isPending} onClick={() => decide.mutate({ decision: 'rejected', comment })}>Отклонить</Button></>}>
        <Field label="Что исправить"><TextArea value={comment} onChange={setComment} rows={4} autoFocus /></Field>
      </Modal>
    </div>
  );
}

function MediaPreview({ item, version, brand, draft, onRender, rendering }: { item: ItemRow; version: Version; brand: Brand; draft: Record<string, unknown>; onRender?: (withoutVoice: boolean) => void; rendering?: boolean }) {
  const [zoom, setZoom] = useState<string | null>(null);
  const [platform, setPlatform] = useState<PlatformId>(item.platforms[0] ?? 'telegram');
  const assets = version.assets;
  const images = assets.filter((a) => a.kind === 'image' && a.role !== 'cover');
  const video = assets.find((a) => a.kind === 'video');
  const vtt = assets.find((a) => a.role === 'subtitles-vtt');
  const files = assets.filter((a) => a.kind !== 'image' || a.role === 'cover');
  const adapted = useMemo(() => {
    const d = draft as Record<string, string | string[]>;
    const body = (d.body ?? d.caption ?? '') as string;
    return adaptForPlatform(platform, { headline: (d.headline ?? d.title) as string, body, cta: d.cta as string, hashtags: (d.hashtags as string[]) ?? [] }, images.length > 0 || !!video);
  }, [draft, platform, images.length, video]);

  if (item.kind === 'video' || item.kind === 'video_script') {
    const vd = version.data as unknown as VideoData;
    return (
      <div className="card card-pad stack">
        <div className="row between">
          <h2>{item.kind === 'video' ? 'Ролик' : 'Раскадровка'}</h2>
          {item.kind === 'video' && onRender && (
            <div className="row tight">
              <Button size="sm" icon="refresh" onClick={() => onRender(false)} loading={rendering}>{video ? 'Перерендерить' : 'Рендер'}</Button>
              <Button size="sm" variant="ghost" onClick={() => onRender(true)} disabled={rendering} title="Без озвучки (если TTS не подключён)">без голоса</Button>
            </div>
          )}
        </div>
        {video ? (
          <>
            <div className={vd.aspect === '16:9' ? 'player' : 'phone'}>
              <video src={video.url} controls playsInline preload="metadata" poster={assets.find((a) => a.role === 'cover')?.url}>
                {vtt && <track kind="subtitles" src={vtt.url} srcLang="ru" label="Русский" />}
              </video>
            </div>
            <div className="row tight small muted">
              <span>{video.width}×{video.height}</span>·<span>{fmtDuration(video.durationMs)}</span>·<span>{fmtBytes(video.bytes)}</span>·
              <span>озвучка: {(video.meta.voice as string) ?? 'нет'}</span>·<span>субтитры вшиты и отдельно</span>
            </div>
            {version.id !== video.versionId && <Notice tone="warn">Ролик от предыдущей версии сценария — перерендерите.</Notice>}
          </>
        ) : item.kind === 'video' ? (
          <Notice tone={rendering ? 'info' : 'warn'}>{rendering ? 'Рендер идёт: озвучка по сценам, сборка таймлайна, субтитры, видео 1080p.' : 'Файл ролика ещё не создан для этой версии.'}</Notice>
        ) : (
          <div className="col">
            {vd.scenes.map((s, i) => (
              <div key={s.id} className="scene-card">
                <div className="row between"><span className="mono tiny dim">{String(i + 1).padStart(2, '0')} · {s.kind} · {s.durationSec} с</span></div>
                <b style={{ fontFamily: 'var(--display)', fontSize: 14 }}>{s.title}</b>
                <span className="small muted">🎙 {s.voiceover}</span>
              </div>
            ))}
          </div>
        )}
        <FileList files={files} />
        <Lightbox src={zoom} onClose={() => setZoom(null)} />
      </div>
    );
  }

  return (
    <div className="card card-pad stack">
      <div className="row between">
        <h2>Предпросмотр</h2>
        <Seg value={platform} onChange={setPlatform} options={item.platforms.map((p) => ({ value: p, label: PLATFORMS[p].short }))} />
      </div>
      {(item.kind === 'carousel' || item.kind === 'graphic') && (
        <>
          {images.length ? (
            <div className="gallery">
              {images.map((a) => (
                <button key={a.id} onClick={() => setZoom(a.url)} aria-label={`Открыть ${a.role}`}>
                  <img src={a.url} alt={a.role ?? ''} loading="lazy" style={a.role === 'graphic-wide' ? { aspectRatio: '16 / 9' } : undefined} />
                </button>
              ))}
            </div>
          ) : (
            <Notice tone={rendering ? 'info' : 'warn'}>{rendering ? 'Рендер визуалов…' : 'Изображения не отрендерены.'}</Notice>
          )}
          {onRender && <Button size="sm" icon="refresh" onClick={() => onRender(false)} loading={rendering} style={{ alignSelf: 'flex-start' }}>Перерисовать</Button>}
        </>
      )}
      <PlatformPreview platform={platform} text={adapted.text} title={adapted.title} media={item.kind === 'graphic' ? images.slice(0, 1) : images} brandName={brand.name} />
      {adapted.truncated && <p className="tiny dim">Текст будет сокращён под лимит площадки.</p>}
      <p className="tiny dim">Слов: {textOf(item.kind, draft).split(/\s+/).filter(Boolean).length}</p>
      <Lightbox src={zoom} onClose={() => setZoom(null)} />
    </div>
  );
}

function FileList({ files }: { files: Asset[] }) {
  if (!files.length) return null;
  const NAMES: Record<string, string> = { final: 'Видео MP4', cover: 'Обложка JPG', 'subtitles-vtt': 'Субтитры VTT', 'subtitles-srt': 'Субтитры SRT', voiceover: 'Озвучка WAV' };
  return (
    <div className="row tight">
      {files.map((f) => (
        <a key={f.id} className="btn xs" href={`${f.url}?download=1`}>
          <Icon name="download" /> {NAMES[f.role ?? ''] ?? f.role}
        </a>
      ))}
    </div>
  );
}

function VersionsPanel({ versions, kind, currentId, onRestore }: { versions: Version[]; kind: ItemRow['kind']; currentId: string; onRestore?: (id: string) => void }) {
  const [a, setA] = useState(versions[1]?.id ?? versions[0]!.id);
  const [b, setB] = useState(versions[0]!.id);
  const va = versions.find((v) => v.id === a)!;
  const vb = versions.find((v) => v.id === b)!;
  const parts = useMemo(() => wordDiff(textOf(kind, va.data), textOf(kind, vb.data)), [va, vb, kind]);
  return (
    <div className="split">
      <div className="card">
        <div className="card-head"><h2>История версий</h2></div>
        <div className="table-wrap">
          <table className="table">
            <tbody>
              {versions.map((v) => (
                <tr key={v.id}>
                  <td className="mono">v{v.version}</td>
                  <td>
                    <div className="row tight"><SourceBadge source={v.source} model={v.model} />{v.id === currentId && <Badge tone="ok">текущая</Badge>}</div>
                    <div className="small muted" style={{ marginTop: 4 }}>{v.note}</div>
                    <div className="tiny dim">{fmtDate(v.createdAt)} · {v.assets.length} файлов{v.check ? ` · проверка ${v.check.passed ? 'пройдена' : 'не пройдена'}` : ''}</div>
                  </td>
                  <td>{onRestore && v.id !== currentId && <Button size="xs" onClick={() => onRestore(v.id)}>Сделать текущей</Button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="card card-pad stack">
        <div className="row">
          <h2>Сравнение</h2>
          <select className="select" style={{ width: 90 }} value={a} onChange={(e) => setA(e.target.value)}>{versions.map((v) => <option key={v.id} value={v.id}>v{v.version}</option>)}</select>
          <span className="muted">→</span>
          <select className="select" style={{ width: 90 }} value={b} onChange={(e) => setB(e.target.value)}>{versions.map((v) => <option key={v.id} value={v.id}>v{v.version}</option>)}</select>
        </div>
        <div className="diff">
          {parts.map((p, i) => (p.type === 'same' ? <span key={i}>{p.text}</span> : p.type === 'add' ? <ins key={i}>{p.text}</ins> : <del key={i}>{p.text}</del>))}
        </div>
        {va.assets.some((x) => x.kind === 'image') && vb.assets.some((x) => x.kind === 'image') && (
          <div className="grid g2">
            <img src={va.assets.find((x) => x.kind === 'image')!.url} alt={`v${va.version}`} style={{ borderRadius: 10 }} />
            <img src={vb.assets.find((x) => x.kind === 'image')!.url} alt={`v${vb.version}`} style={{ borderRadius: 10 }} />
          </div>
        )}
      </div>
    </div>
  );
}
