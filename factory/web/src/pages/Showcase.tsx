import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';
import { api } from '../api';
import { cover, ItemTile, PipelineRail } from '../components/content';
import { Badge, Empty, Lightbox, Loading, Notice, PlatformChip, PostStatusBadge, fmtDate } from '../components/ui';
import { KIND_LABEL, type VideoData } from '../../../shared/types';
import { useWs, useWsApi } from '../session';
import type { Brand, Campaign, ItemRow, Post, StageView } from '../types';

export function ShowcasePage() {
  const { ws, base } = useWs();
  const u = useWsApi();
  const camps = useQuery({ queryKey: ['campaigns', ws.id], queryFn: () => api.get<Campaign[]>(u('/campaigns')) });
  const first = camps.data?.[0];
  const q = useQuery({ queryKey: ['campaign', first?.id], queryFn: () => api.get<{ campaign: Campaign; brand: Brand; stages: StageView[]; items: ItemRow[]; posts: Post[] }>(u(`/campaigns/${first!.id}`)), enabled: !!first });
  const [zoom, setZoom] = useState<string | null>(null);
  if (camps.isLoading || (first && q.isLoading)) return <Loading />;
  if (!ws.isDemo) return <Notice tone="info">Витрина находится в демо-пространстве. <Link to="/showcase" style={{ color: 'var(--lime)' }}>Открыть</Link></Notice>;
  if (!first || !q.data) return <div className="card"><Empty title="Витрина ещё не собрана">Запустите <span className="mono">npm run showcase:build</span> на сервере.</Empty></div>;
  const { campaign, brand, items, posts, stages } = q.data;
  const videos = items.filter((i) => i.kind === 'video' && i.assets.some((a) => a.kind === 'video'));
  const visuals = items.filter((i) => i.kind === 'graphic' || i.kind === 'carousel');
  const tz = campaign.brief.timezone;

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <div className="row tight" style={{ marginBottom: 8 }}>
            <Badge tone="demo">ДЕМО</Badge>
            <span className="small muted">вымышленный бренд · тексты подготовлены при разработке витрины · визуалы и видео отрендерены фабрикой</span>
          </div>
          <h1>{brand.name}: {campaign.title}</h1>
          <p>{brand.description}</p>
        </div>
        <a className="btn" href={u(`/campaigns/${campaign.id}/export`)}>Скачать всю кампанию ZIP</a>
      </div>
      <PipelineRail stages={stages} />

      {videos.length > 0 && (
        <>
          <h2>Вертикальное видео</h2>
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
            {videos.map((v) => {
              const file = v.assets.find((a) => a.kind === 'video')!;
              const vtt = v.assets.find((a) => a.role === 'subtitles-vtt');
              const data = v.version?.data as unknown as VideoData;
              return (
                <div key={v.id} className="card card-pad stack">
                  <div className="phone">
                    <video src={file.url} controls playsInline preload="metadata" poster={cover(v)}>
                      {vtt && <track kind="subtitles" src={vtt.url} srcLang="ru" label="Русский" />}
                    </video>
                  </div>
                  <b>{data.title}</b>
                  <div className="small muted">{data.scenes.length} сцен · {Math.round((file.durationMs ?? 0) / 1000)} с · {file.width}×{file.height} · озвучка {(file.meta.voice as string) ?? 'нет'} · субтитры</div>
                  <div className="row tight">
                    <a className="btn xs" href={`${file.url}?download=1`}>MP4</a>
                    {v.assets.filter((a) => a.kind === 'subtitle').map((a) => <a key={a.id} className="btn xs" href={`${a.url}?download=1`}>{a.role === 'subtitles-vtt' ? 'VTT' : 'SRT'}</a>)}
                    <Link className="btn xs" to={`${base}/items/${v.id}`}>Сценарий и версии</Link>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      <h2>Графика и карусели</h2>
      <div className="gallery" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))' }}>
        {visuals.flatMap((i) => i.assets.filter((a) => a.kind === 'image').map((a) => (
          <button key={a.id} onClick={() => setZoom(a.url)} title={`${KIND_LABEL[i.kind]} · ${i.title}`}>
            <img src={a.url} alt={i.title} loading="lazy" style={a.role === 'graphic-wide' ? { aspectRatio: '16/9' } : undefined} />
          </button>
        )))}
      </div>

      <h2>Все материалы</h2>
      <div className="grid auto-fill">{items.map((i) => <ItemTile key={i.id} item={i} base={base} tz={tz} />)}</div>

      {posts.length > 0 && (
        <div className="card">
          <div className="card-head"><h2>Версии для площадок и календарь</h2><span className="small muted">публикации демо не отправляются</span></div>
          <div className="table-wrap">
            <table className="table">
              <tbody>
                {posts.map((p) => (
                  <tr key={p.id}>
                    <td className="mono small nowrap">{p.scheduledAt ? fmtDate(p.scheduledAt, tz) : '—'}</td>
                    <td><PlatformChip id={p.platform} /></td>
                    <td className="small" style={{ maxWidth: 420 }}><div className="ellipsis">{p.text}</div></td>
                    <td><PostStatusBadge status={p.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      <Lightbox src={zoom} onClose={() => setZoom(null)} />
    </div>
  );
}
