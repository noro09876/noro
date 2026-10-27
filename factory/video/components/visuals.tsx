import React from 'react';
import { interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import type { SlideVisual } from '../../shared/types';
import { alpha, type Theme } from '../theme';

/**
 * Visual building blocks shared by stills (carousel slides, graphics) and video scenes.
 * In stills `still` is true and every animation renders at its final state.
 */

export function useAnim(still: boolean) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return {
    frame,
    fps,
    /** spring 0→1 starting at `delay` frames */
    sp: (delay = 0, damping = 18, mass = 0.8) => (still ? 1 : spring({ frame: frame - delay, fps, config: { damping, mass } })),
    /** linear 0→1 between frames a and b */
    lin: (a: number, b: number) => (still ? 1 : interpolate(frame, [a, b], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })),
  };
}

export const Backdrop: React.FC<{ theme: Theme; still?: boolean; variant?: number }> = ({ theme, still = false, variant = 0 }) => {
  const { frame } = useAnim(still);
  const drift = still ? 0 : frame * 0.35;
  const cell = 72;
  return (
    <div style={{ position: 'absolute', inset: 0, background: theme.bg, overflow: 'hidden' }}>
      <div
        style={{
          position: 'absolute',
          inset: -cell,
          backgroundImage: `linear-gradient(${alpha(theme.text, 0.045)} 1px, transparent 1px), linear-gradient(90deg, ${alpha(theme.text, 0.045)} 1px, transparent 1px)`,
          backgroundSize: `${cell}px ${cell}px`,
          transform: `translate(${(drift % cell) - cell / 2}px, ${(drift * 0.6) % cell}px)`,
          maskImage: 'radial-gradient(ellipse 80% 70% at 50% 40%, black 30%, transparent 85%)',
          WebkitMaskImage: 'radial-gradient(ellipse 80% 70% at 50% 40%, black 30%, transparent 85%)',
        }}
      />
      <div
        style={{
          position: 'absolute',
          width: '95%',
          aspectRatio: '1',
          left: variant % 2 ? '-30%' : '40%',
          top: variant % 3 === 2 ? '55%' : '-25%',
          borderRadius: '50%',
          background: `radial-gradient(circle, ${alpha(theme.primary, 0.2)} 0%, transparent 62%)`,
          transform: `translateY(${Math.sin(drift / 40) * 30}px)`,
        }}
      />
      <div
        style={{
          position: 'absolute',
          width: '80%',
          aspectRatio: '1',
          left: variant % 2 ? '45%' : '-35%',
          top: '50%',
          borderRadius: '50%',
          background: `radial-gradient(circle, ${alpha(theme.accent, 0.13)} 0%, transparent 60%)`,
          transform: `translateX(${Math.cos(drift / 50) * 30}px)`,
        }}
      />
      <div style={{ position: 'absolute', inset: 0, background: `linear-gradient(180deg, transparent 60%, ${alpha(theme.bg, 0.85)} 100%)` }} />
    </div>
  );
};

export const Mono: React.FC<{ theme: Theme; children: React.ReactNode; size?: number; color?: string; style?: React.CSSProperties }> = ({ theme, children, size = 26, color, style }) => (
  <div style={{ fontFamily: theme.fontMono, fontSize: size, letterSpacing: '0.08em', textTransform: 'uppercase', color: color ?? theme.muted, ...style }}>{children}</div>
);

export const BrandChip: React.FC<{ theme: Theme; label?: string }> = ({ theme, label }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
    <div style={{ width: 34, height: 34, borderRadius: 10, background: theme.primary, display: 'grid', placeItems: 'center' }}>
      <div style={{ width: 12, height: 12, borderRadius: 3, background: theme.primaryInk, transform: 'rotate(45deg)' }} />
    </div>
    <div style={{ fontFamily: theme.fontDisplay, fontSize: 30, fontWeight: 600, color: theme.text, letterSpacing: '-0.01em' }}>{theme.brandName}</div>
    {label ? <Mono theme={theme} size={22} style={{ marginLeft: 8, padding: '6px 12px', border: `1px solid ${theme.border}`, borderRadius: 999 }}>{label}</Mono> : null}
  </div>
);

/* ---------- Visual blocks ---------- */

export const StatBlock: React.FC<{ theme: Theme; v: Extract<SlideVisual, { type: 'stat' }>; still?: boolean; delay?: number; scale?: number }> = ({ theme, v, still = false, delay = 0, scale = 1 }) => {
  const { sp, lin } = useAnim(still);
  const p = sp(delay, 22);
  const num = parseFloat(v.value.replace(',', '.').replace(/[^\d.-]/g, ''));
  const suffix = v.value.replace(/^[\d\s.,-]+/, '');
  const prefix = v.value.match(/^[^\d-]*/)?.[0] ?? '';
  const shown = Number.isFinite(num) && !still ? Math.round(num * lin(delay, delay + 40) * 10) / 10 : null;
  const display = shown === null ? v.value : `${prefix}${Number.isInteger(num) ? Math.round(shown) : shown.toFixed(1).replace('.', ',')}${suffix.replace(prefix, '')}`;
  return (
    <div style={{ transform: `translateY(${(1 - p) * 40}px)`, opacity: p }}>
      <div style={{ fontFamily: theme.fontDisplay, fontWeight: 700, fontSize: 210 * scale, lineHeight: 0.95, letterSpacing: '-0.04em', color: theme.primary }}>{display}</div>
      <div style={{ marginTop: 18 * scale, fontFamily: theme.fontBody, fontSize: 40 * scale, color: theme.text, maxWidth: 820 * scale, lineHeight: 1.25 }}>{v.label}</div>
    </div>
  );
};

export const StepsBlock: React.FC<{ theme: Theme; v: Extract<SlideVisual, { type: 'steps' }>; still?: boolean; delay?: number; scale?: number }> = ({ theme, v, still = false, delay = 0, scale = 1 }) => {
  const { sp } = useAnim(still);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22 * scale, position: 'relative' }}>
      <div style={{ position: 'absolute', left: 31 * scale, top: 40 * scale, bottom: 40 * scale, width: 2, background: theme.border }} />
      {v.items.map((item, i) => {
        const p = sp(delay + i * 9);
        return (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 28 * scale, opacity: p, transform: `translateX(${(1 - p) * -60}px)` }}>
            <div style={{ width: 64 * scale, height: 64 * scale, flex: 'none', borderRadius: 18 * scale, background: i === v.items.length - 1 ? theme.primary : theme.surface2, border: `1px solid ${theme.border}`, display: 'grid', placeItems: 'center', fontFamily: theme.fontMono, fontSize: 26 * scale, color: i === v.items.length - 1 ? theme.primaryInk : theme.text, position: 'relative' }}>
              {String(i + 1).padStart(2, '0')}
            </div>
            <div style={{ flex: 1, padding: `${22 * scale}px ${28 * scale}px`, borderRadius: 22 * scale, background: alpha(theme.surface, 0.9), border: `1px solid ${theme.border}`, fontFamily: theme.fontBody, fontSize: 36 * scale, fontWeight: 500, color: theme.text }}>
              {item}
            </div>
          </div>
        );
      })}
    </div>
  );
};

export const ChartBlock: React.FC<{ theme: Theme; v: Extract<SlideVisual, { type: 'chart' }>; still?: boolean; delay?: number; width?: number; height?: number }> = ({ theme, v, still = false, delay = 0, width = 900, height = 520 }) => {
  const { lin, sp } = useAnim(still);
  const draw = lin(delay, delay + 45);
  const pad = 40;
  const max = Math.max(...v.points);
  const min = Math.min(0, ...v.points);
  const xs = v.points.map((_, i) => pad + (i * (width - pad * 2)) / (v.points.length - 1));
  const ys = v.points.map((p) => height - pad - ((p - min) / (max - min || 1)) * (height - pad * 2.4));
  const path = xs.map((x, i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${ys[i]!.toFixed(1)}`).join(' ');
  const area = `${path} L${xs[xs.length - 1]},${height - pad} L${xs[0]},${height - pad} Z`;
  const len = xs.reduce((acc, x, i) => (i ? acc + Math.hypot(x - xs[i - 1]!, ys[i]! - ys[i - 1]!) : 0), 0);
  const last = v.points.length - 1;
  const dot = sp(delay + 40);
  return (
    <div style={{ background: alpha(theme.surface, 0.92), border: `1px solid ${theme.border}`, borderRadius: 32, padding: 28, boxShadow: `0 40px 80px ${alpha('#000000', 0.35)}` }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <Mono theme={theme} size={22}>{v.label}</Mono>
        <div style={{ display: 'flex', gap: 8 }}>
          {[0, 1, 2].map((i) => <div key={i} style={{ width: 10, height: 10, borderRadius: 5, background: i === 0 ? theme.primary : theme.border }} />)}
        </div>
      </div>
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ display: 'block', maxWidth: '100%', height: 'auto' }}>
        <defs>
          <linearGradient id="area" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={theme.primary} stopOpacity={0.35} />
            <stop offset="100%" stopColor={theme.primary} stopOpacity={0} />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75].map((g) => (
          <line key={g} x1={pad} x2={width - pad} y1={pad + g * (height - pad * 2)} y2={pad + g * (height - pad * 2)} stroke={theme.border} strokeDasharray="4 8" />
        ))}
        <path d={area} fill="url(#area)" opacity={draw} />
        <path d={path} fill="none" stroke={theme.primary} strokeWidth={7} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={len} strokeDashoffset={len * (1 - draw)} />
        {xs.map((x, i) => (
          <circle key={i} cx={x} cy={ys[i]} r={i === last ? 14 * dot : 6} fill={i === last ? theme.primary : theme.surface2} stroke={i === last ? theme.bg : theme.primary} strokeWidth={i === last ? 5 : 3} opacity={draw >= i / last ? 1 : 0} />
        ))}
      </svg>
    </div>
  );
};

export const UiBlock: React.FC<{ theme: Theme; v: Extract<SlideVisual, { type: 'ui' }>; still?: boolean; delay?: number; scale?: number; cursor?: boolean }> = ({ theme, v, still = false, delay = 0, scale = 1, cursor = false }) => {
  const { sp, lin } = useAnim(still);
  const win = sp(delay, 20);
  const tone = (t?: string) => (t === 'good' ? theme.good : t === 'warn' ? theme.warn : t === 'bad' ? theme.bad : theme.text);
  const click = lin(delay + 50, delay + 62);
  const cursorX = still ? 0.8 : interpolateCursor(lin(delay + 20, delay + 50));
  return (
    <div style={{ position: 'relative', transform: `translateY(${(1 - win) * 80}px) scale(${0.94 + win * 0.06})`, opacity: win }}>
      <div style={{ borderRadius: 34 * scale, overflow: 'hidden', background: theme.surface, border: `1px solid ${theme.border}`, boxShadow: `0 50px 120px ${alpha('#000000', 0.45)}, inset 0 1px 0 ${alpha(theme.text, 0.06)}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 * scale, padding: `${20 * scale}px ${26 * scale}px`, borderBottom: `1px solid ${theme.border}`, background: theme.surface2 }}>
          {[theme.bad, theme.warn, theme.good].map((c, i) => <div key={i} style={{ width: 14 * scale, height: 14 * scale, borderRadius: 7 * scale, background: alpha(c, 0.8) }} />)}
          <div style={{ marginLeft: 12 * scale, fontFamily: theme.fontBody, fontSize: 28 * scale, fontWeight: 600, color: theme.text }}>{v.title}</div>
          <div style={{ marginLeft: 'auto', fontFamily: theme.fontMono, fontSize: 20 * scale, color: theme.muted }}>live</div>
          <div style={{ width: 10 * scale, height: 10 * scale, borderRadius: 5 * scale, background: theme.good, opacity: still ? 1 : 0.5 + 0.5 * Math.sin(lin(0, 30) * Math.PI * 4) }} />
        </div>
        <div style={{ padding: 26 * scale, display: 'flex', flexDirection: 'column', gap: 14 * scale }}>
          {v.rows.map((r, i) => {
            const p = sp(delay + 10 + i * 6);
            const highlight = !still && cursor && i === v.rows.length - 1 && click > 0;
            return (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 18 * scale, padding: `${20 * scale}px ${22 * scale}px`, borderRadius: 18 * scale, background: highlight ? alpha(theme.primary, 0.12) : alpha(theme.bg, 0.55), border: `1px solid ${highlight ? alpha(theme.primary, 0.6) : theme.border}`, opacity: p, transform: `translateX(${(1 - p) * 50}px)` }}>
                <div style={{ width: 12 * scale, height: 12 * scale, borderRadius: 3 * scale, background: tone(r.tone), transform: 'rotate(45deg)' }} />
                <div style={{ fontFamily: theme.fontBody, fontSize: 30 * scale, color: theme.text, flex: 1 }}>{r.label}</div>
                <div style={{ fontFamily: theme.fontMono, fontSize: 30 * scale, fontWeight: 600, color: tone(r.tone) }}>{r.value}</div>
              </div>
            );
          })}
          <div style={{ display: 'flex', gap: 14 * scale, marginTop: 8 * scale }}>
            <div style={{ flex: 1, height: 12 * scale, borderRadius: 6 * scale, background: theme.surface2, overflow: 'hidden' }}>
              <div style={{ width: `${lin(delay + 15, delay + 70) * 78}%`, height: '100%', background: `linear-gradient(90deg, ${theme.primary}, ${theme.accent})` }} />
            </div>
          </div>
        </div>
      </div>
      {cursor && !still ? (
        <svg width={56 * scale} height={56 * scale} viewBox="0 0 24 24" style={{ position: 'absolute', left: `${cursorX * 100}%`, top: `${40 + (1 - cursorX) * 30}%`, transform: `scale(${1 - click * 0.15})`, filter: `drop-shadow(0 6px 12px ${alpha('#000000', 0.5)})` }}>
          <path d="M4 2l16 9-7 2-3 7z" fill={theme.text} stroke={theme.bg} strokeWidth={1.4} strokeLinejoin="round" />
        </svg>
      ) : null}
    </div>
  );
};

function interpolateCursor(t: number) {
  // ease-in-out travel from right edge to the last row
  const e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
  return 0.95 - e * 0.25;
}

export const QuoteBlock: React.FC<{ theme: Theme; v: Extract<SlideVisual, { type: 'quote' }>; still?: boolean; delay?: number; scale?: number }> = ({ theme, v, still = false, delay = 0, scale = 1 }) => {
  const { sp } = useAnim(still);
  const p = sp(delay);
  return (
    <div style={{ opacity: p, transform: `translateY(${(1 - p) * 40}px)`, padding: 44 * scale, borderRadius: 32 * scale, background: alpha(theme.surface, 0.9), border: `1px solid ${theme.border}`, position: 'relative' }}>
      <div style={{ position: 'absolute', top: -40 * scale, left: 36 * scale, fontFamily: theme.fontDisplay, fontSize: 160 * scale, color: theme.primary, lineHeight: 1 }}>“</div>
      <div style={{ fontFamily: theme.fontBody, fontSize: 42 * scale, lineHeight: 1.35, color: theme.text, fontWeight: 500 }}>{v.text}</div>
      <Mono theme={theme} size={22 * scale} style={{ marginTop: 26 * scale }}>— {v.author}</Mono>
    </div>
  );
};

export const VisualBlock: React.FC<{ theme: Theme; v: SlideVisual; still?: boolean; delay?: number; scale?: number; cursor?: boolean; chartWidth?: number; chartHeight?: number }> = ({ v, ...rest }) => {
  switch (v.type) {
    case 'stat':
      return <StatBlock v={v} {...rest} />;
    case 'steps':
      return <StepsBlock v={v} {...rest} />;
    case 'chart':
      return <ChartBlock v={v} theme={rest.theme} still={rest.still} delay={rest.delay} width={rest.chartWidth} height={rest.chartHeight} />;
    case 'ui':
      return <UiBlock v={v} {...rest} />;
    case 'quote':
      return <QuoteBlock v={v} {...rest} />;
  }
};
