import { useMemo, useState } from 'react';
import { useElementWidth } from '../../hooks/useElementWidth';
import './charts.css';

export interface LineSeries {
  id: string;
  label: string;
  color: string;
  values: Array<number | null>;
  dashed?: boolean;
  area?: boolean;
}

interface LineChartProps {
  labels: string[];
  series: LineSeries[];
  height?: number;
  formatY?: (n: number) => string;
  markers?: Array<{ index: number; label: string }>;
  ariaLabel: string;
}

const PAD = { top: 12, right: 12, bottom: 26, left: 56 };

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const exp = Math.pow(10, Math.floor(Math.log10(v)));
  const f = v / exp;
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  return nice * exp;
}

/** Multi-series line chart with crosshair tooltip and optional anomaly markers. */
export function LineChart({ labels, series, height = 260, formatY = (n) => n.toLocaleString('ru-RU'), markers = [], ariaLabel }: LineChartProps) {
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const n = labels.length;
  const innerW = Math.max(10, width - PAD.left - PAD.right);
  const innerH = height - PAD.top - PAD.bottom;

  const { max, min } = useMemo(() => {
    let mx = 0;
    let mn = 0;
    for (const s of series) for (const v of s.values) if (v != null && Number.isFinite(v)) { mx = Math.max(mx, v); mn = Math.min(mn, v); }
    return { max: niceMax(mx), min: mn < 0 ? -niceMax(-mn) : 0 };
  }, [series]);

  const x = (i: number) => PAD.left + (n <= 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  const y = (v: number) => PAD.top + innerH - ((v - min) / (max - min || 1)) * innerH;

  const paths = series.map((s) => {
    let d = '';
    let started = false;
    s.values.forEach((v, i) => {
      if (v == null || !Number.isFinite(v)) {
        started = false;
        return;
      }
      d += `${started ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
      started = true;
    });
    const firstIdx = s.values.findIndex((v) => v != null);
    const lastIdx = s.values.length - 1 - [...s.values].reverse().findIndex((v) => v != null);
    const area = s.area && firstIdx >= 0 ? `${d}L${x(lastIdx)},${y(min)}L${x(firstIdx)},${y(min)}Z` : '';
    return { s, d, area };
  });

  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => min + (max - min) * t);
  const labelEvery = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(innerW / 70))));

  const onMove = (clientX: number, rect: DOMRect) => {
    if (n === 0) return;
    const rel = clientX - rect.left - PAD.left;
    const i = Math.round((rel / innerW) * (n - 1));
    setHover(Math.max(0, Math.min(n - 1, i)));
  };

  const tooltipLeft = hover != null ? Math.min(Math.max(x(hover) + 12, 0), width - 170) : 0;

  return (
    <div className="chart" ref={ref}>
      {series.length > 1 ? (
        <div className="chart__legend" aria-hidden>
          {series.map((s) => (
            <span key={s.id}>
              <i className="chart__key" style={{ background: s.color, opacity: s.dashed ? 0.6 : 1 }} />
              {s.label}
            </span>
          ))}
        </div>
      ) : null}
      <svg
        width={width}
        height={height}
        role="img"
        aria-label={ariaLabel}
        onMouseMove={(e) => onMove(e.clientX, e.currentTarget.getBoundingClientRect())}
        onMouseLeave={() => setHover(null)}
        onTouchStart={(e) => e.touches[0] && onMove(e.touches[0].clientX, e.currentTarget.getBoundingClientRect())}
        onTouchMove={(e) => e.touches[0] && onMove(e.touches[0].clientX, e.currentTarget.getBoundingClientRect())}
      >
        <g className="chart__grid">
          {ticks.map((t) => (
            <line key={t} x1={PAD.left} x2={PAD.left + innerW} y1={y(t)} y2={y(t)} />
          ))}
        </g>
        <g className="chart__axis">
          {ticks.map((t) => (
            <text key={t} x={PAD.left - 8} y={y(t) + 4} textAnchor="end">
              {formatY(t)}
            </text>
          ))}
          {labels.map((l, i) =>
            i % labelEvery === 0 ? (
              <text key={i} x={x(i)} y={height - 6} textAnchor="middle">
                {l}
              </text>
            ) : null,
          )}
        </g>
        {paths.map(({ s, d, area }) => (
          <g key={s.id}>
            {area ? <path d={area} className="chart__area" style={{ fill: s.color }} /> : null}
            <path
              d={d}
              className={s.dashed ? 'chart__line' : 'chart__line chart__line--animate'}
              pathLength={s.dashed ? undefined : 1}
              strokeDasharray={s.dashed ? '5 5' : undefined}
              style={{ stroke: s.color, opacity: s.dashed ? 0.7 : 1 }}
            />
          </g>
        ))}
        {markers.map((m) => {
          const v = series[0]?.values[m.index];
          if (v == null) return null;
          return <circle key={m.index} className="chart__marker" cx={x(m.index)} cy={y(v)} r={5}><title>{m.label}</title></circle>;
        })}
        {hover != null ? (
          <g>
            <line className="chart__cross" x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={PAD.top + innerH} />
            {series.map((s) => {
              const v = s.values[hover];
              return v == null ? null : <circle key={s.id} className="chart__dot" cx={x(hover)} cy={y(v)} r={4.5} style={{ fill: s.color }} />;
            })}
          </g>
        ) : null}
        <rect x={PAD.left} y={PAD.top} width={innerW} height={innerH} fill="transparent" />
      </svg>
      {hover != null ? (
        <div className="chart__tooltip" style={{ left: tooltipLeft, top: series.length > 1 ? 30 : 4 }}>
          <div className="chart__tooltip-title">{labels[hover]}</div>
          {series.map((s) => (
            <div className="chart__tooltip-row" key={s.id}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--text-2)' }}>
                <i className="chart__key" style={{ background: s.color }} />
                {s.label}
              </span>
              <span>{s.values[hover] == null ? '—' : formatY(s.values[hover]!)}</span>
            </div>
          ))}
          {markers.find((m) => m.index === hover) ? (
            <div style={{ color: '#ffaaaa', marginTop: 4 }}>{markers.find((m) => m.index === hover)!.label}</div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
