import { Link } from 'react-router';
import { STAGE_LABEL, KIND_LABEL, type CarouselData, type GraphicData, type PostData, type Stage, type VideoScriptData } from '../../../shared/types';
import type { ItemRow, StageView } from '../types';
import { Icon } from './icons';
import { fmtDate, ItemStatus, PlatformChip, SourceBadge } from './ui';

/** Pipeline rail: every status here comes from the database (server computeStages). */
export function PipelineRail({ stages }: { stages: StageView[] }) {
  return (
    <div className="card rail" aria-label="Конвейер кампании">
      {stages.map((s, i) => (
        <div key={s.stage} className={`rail-step s-${s.status}`}>
          <div className="rail-node">{s.status === 'done' ? '✓' : s.status === 'failed' ? '!' : i + 1}</div>
          <div className="rail-title">{STAGE_LABEL[s.stage as Stage]}</div>
          {s.total > 0 && (
            <div className="rail-bar">
              <i style={{ width: `${Math.round((s.done / s.total) * 100)}%` }} />
            </div>
          )}
          <div className="rail-detail" title={s.detail}>{s.detail}</div>
          {s.error && <div className="rail-error">{s.error}</div>}
        </div>
      ))}
    </div>
  );
}

export function cover(item: Pick<ItemRow, 'kind' | 'assets'>) {
  const a = item.assets;
  if (item.kind === 'carousel') return a.find((x) => x.role === 'slide-01')?.url ?? a.find((x) => x.kind === 'image')?.url;
  if (item.kind === 'graphic') return a.find((x) => x.role === 'graphic')?.url ?? a.find((x) => x.kind === 'image')?.url;
  if (item.kind === 'video') return a.find((x) => x.role === 'cover')?.url;
  return undefined;
}

export function headlineOf(item: Pick<ItemRow, 'kind' | 'version' | 'title'>): string {
  const d = item.version?.data;
  if (!d) return item.title;
  switch (item.kind) {
    case 'post':
      return (d as unknown as PostData).headline;
    case 'carousel':
      return (d as unknown as CarouselData).title;
    case 'graphic':
      return (d as unknown as GraphicData).headline;
    default:
      return (d as unknown as VideoScriptData).title;
  }
}

export function bodyOf(item: Pick<ItemRow, 'kind' | 'version'>): string {
  const d = item.version?.data;
  if (!d) return '';
  switch (item.kind) {
    case 'post':
      return (d as unknown as PostData).body;
    case 'carousel':
      return (d as unknown as CarouselData).caption;
    case 'graphic':
      return (d as unknown as GraphicData).caption;
    default:
      return (d as unknown as VideoScriptData).scenes?.map((s) => s.voiceover).join(' ') ?? '';
  }
}

export function ItemTile({ item, base, tz }: { item: ItemRow; base: string; tz?: string }) {
  const img = cover(item);
  return (
    <Link to={`${base}/items/${item.id}`} className="card tile">
      <div className={`tile-media ${img ? '' : 'text'}`} style={item.kind === 'video' ? { aspectRatio: '9 / 16', maxHeight: 360 } : undefined}>
        {img ? (
          <img src={img} alt="" loading="lazy" />
        ) : (
          <div className="textpost">
            <span className="mono tiny dim">{KIND_LABEL[item.kind]}</span>
            <b>{headlineOf(item)}</b>
            <span style={{ display: '-webkit-box', WebkitLineClamp: 4, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{bodyOf(item)}</span>
          </div>
        )}
        {img && (
          <span className="kind">
            <span className="badge" style={{ background: 'rgba(10,11,12,.75)' }}>
              {item.kind === 'video' && <Icon name="play" width={12} />} {KIND_LABEL[item.kind]}
              {item.kind === 'carousel' ? ` · ${item.assets.filter((a) => a.role?.startsWith('slide-')).length}` : ''}
            </span>
          </span>
        )}
        {item.version && (
          <span className="src">
            <SourceBadge source={item.version.source} />
          </span>
        )}
      </div>
      <div className="tile-body">
        <div className="tile-title">{item.title}</div>
        <div className="row between">
          <ItemStatus status={item.status} />
          <span className="mono tiny dim">{item.plannedAt ? fmtDate(item.plannedAt, tz) : ''}</span>
        </div>
        <div className="row tight">
          {item.platforms.map((p) => (
            <PlatformChip key={p} id={p} label={false} />
          ))}
        </div>
        {item.lastError && <div className="tiny" style={{ color: 'var(--red)' }}>{item.lastError}</div>}
      </div>
    </Link>
  );
}
