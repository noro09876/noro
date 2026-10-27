import React from 'react';
import {AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig, Easing} from 'remotion';
import {C, F} from '../theme';

export const clamp = {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'} as const;

/** Пружина от момента `at` (в секундах, локальное время сцены). */
export const useSpring = (at: number, cfg: {damping?: number; stiffness?: number; mass?: number} = {}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  return spring({frame: frame - Math.round(at * fps), fps, config: {damping: cfg.damping ?? 16, stiffness: cfg.stiffness ?? 140, mass: cfg.mass ?? 0.9}});
};

/** Линейный прогресс 0..1 между секундами a и b с easing. */
export const useProgress = (a: number, b: number, ease: (t: number) => number = Easing.bezier(0.65, 0, 0.35, 1)) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  return interpolate(frame / fps, [a, b], [0, 1], {...clamp, easing: ease});
};

export const useT = () => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  return frame / fps;
};

/** Фон: тёплый чёрный, сетка, дрейфующее световое пятно, виньетка. */
export const Bg: React.FC<{glow?: string; glowX?: number; glowY?: number; grid?: number}> = ({glow = C.accent, glowX = 0.5, glowY = 0.35, grid = 60}) => {
  const t = useT();
  const {width, height} = useVideoConfig();
  const gx = glowX * width + Math.sin(t * 0.35) * width * 0.06;
  const gy = glowY * height + Math.cos(t * 0.27) * height * 0.04;
  const off = (t * 6) % grid;
  return (
    <AbsoluteFill style={{background: C.bg, overflow: 'hidden'}}>
      <AbsoluteFill
        style={{
          backgroundImage: `linear-gradient(${C.line}55 1px, transparent 1px), linear-gradient(90deg, ${C.line}55 1px, transparent 1px)`,
          backgroundSize: `${grid}px ${grid}px`,
          backgroundPosition: `0 ${off}px`,
          maskImage: 'radial-gradient(ellipse 75% 65% at 50% 45%, black 20%, transparent 85%)',
          WebkitMaskImage: 'radial-gradient(ellipse 75% 65% at 50% 45%, black 20%, transparent 85%)',
        }}
      />
      <div
        style={{
          position: 'absolute', left: gx - width * 0.55, top: gy - width * 0.55, width: width * 1.1, height: width * 1.1,
          background: `radial-gradient(circle, ${glow}22 0%, ${glow}0A 35%, transparent 65%)`,
        }}
      />
      <AbsoluteFill style={{background: 'radial-gradient(ellipse at center, transparent 55%, #000000AA 100%)'}} />
    </AbsoluteFill>
  );
};

/** Окно приложения (условный интерфейс). */
export const Window: React.FC<{title?: string; w: number; h?: number; style?: React.CSSProperties; children?: React.ReactNode; accent?: string; scale?: number}> = ({title, w, h, style, children, accent, scale = 1}) => (
  <div
    style={{
      width: w, height: h, background: C.surface, borderRadius: 28 * scale, border: `${2 * scale}px solid ${accent ?? C.line}`,
      boxShadow: `0 ${40 * scale}px ${90 * scale}px #00000099, inset 0 1px 0 #ffffff10`, overflow: 'hidden', display: 'flex', flexDirection: 'column', ...style,
    }}
  >
    <div style={{height: 64 * scale, display: 'flex', alignItems: 'center', gap: 12 * scale, padding: `0 ${26 * scale}px`, borderBottom: `${2 * scale}px solid ${C.line}`, flexShrink: 0}}>
      {[C.danger, '#FFC23A', C.accent].map((c) => (
        <div key={c} style={{width: 16 * scale, height: 16 * scale, borderRadius: 99, background: c, opacity: 0.85}} />
      ))}
      {title && <div style={{marginLeft: 14 * scale, fontFamily: F.mono, fontWeight: 500, fontSize: 24 * scale, color: C.muted, letterSpacing: 0.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'}}>{title}</div>}
    </div>
    <div style={{flex: 1, position: 'relative'}}>{children}</div>
  </div>
);

export const Chip: React.FC<{children: React.ReactNode; color?: string; bg?: string; size?: number; style?: React.CSSProperties; mono?: boolean}> = ({children, color = C.text, bg = C.surface2, size = 26, style, mono = true}) => (
  <div
    style={{
      display: 'inline-flex', alignItems: 'center', gap: size * 0.35, padding: `${size * 0.3}px ${size * 0.6}px`, borderRadius: 999, background: bg, color,
      fontFamily: mono ? F.mono : F.body, fontWeight: mono ? 500 : 700, fontSize: size, lineHeight: 1, whiteSpace: 'nowrap', ...style,
    }}
  >
    {children}
  </div>
);

export const Avatar: React.FC<{letter: string; color?: string; size?: number}> = ({letter, color = C.info, size = 72}) => (
  <div
    style={{
      width: size, height: size, borderRadius: 999, background: `${color}26`, border: `2px solid ${color}88`, color, flexShrink: 0,
      display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: F.display, fontWeight: 800, fontSize: size * 0.4,
    }}
  >
    {letter}
  </div>
);

export type Lead = {name: string; src: string; msg: string; time: string; color?: string};

/** Карточка заявки. */
export const LeadCard: React.FC<{lead: Lead; w?: number; status?: React.ReactNode; style?: React.CSSProperties; dim?: number; border?: string; scale?: number}> = ({lead, w = 640, status, style, dim = 0, border, scale = 1}) => (
  <div
    style={{
      width: w, padding: 28 * scale, borderRadius: 26 * scale, background: C.surface, border: `${2 * scale}px solid ${border ?? C.line}`,
      boxShadow: `0 ${24 * scale}px ${60 * scale}px #00000080`, display: 'flex', gap: 22 * scale, alignItems: 'flex-start',
      filter: dim ? `grayscale(${dim}) brightness(${1 - dim * 0.45})` : undefined, ...style,
    }}
  >
    <Avatar letter={lead.name[0]} color={lead.color ?? C.info} size={74 * scale} />
    <div style={{flex: 1, minWidth: 0}}>
      <div style={{display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 * scale}}>
        <div style={{fontFamily: F.body, fontWeight: 800, fontSize: 32 * scale, color: C.text}}>{lead.name}</div>
        <div style={{fontFamily: F.mono, fontSize: 22 * scale, color: C.muted}}>{lead.time}</div>
      </div>
      <div style={{fontFamily: F.body, fontWeight: 500, fontSize: 27 * scale, color: C.muted, marginTop: 6 * scale, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'}}>{lead.msg}</div>
      <div style={{display: 'flex', gap: 10 * scale, marginTop: 14 * scale, alignItems: 'center'}}>
        <Chip size={21 * scale}>{lead.src}</Chip>
        {status}
      </div>
    </div>
  </div>
);

/** Кинетический заголовок: слова «выпрыгивают» снизу из маски с каскадом. */
export const KTitle: React.FC<{
  lines: string[]; at: number; size: number; color?: string; accentWords?: string[]; accent?: string; stagger?: number; align?: 'left' | 'center'; lh?: number; style?: React.CSSProperties; weight?: number; out?: number;
}> = ({lines, at, size, color = C.text, accentWords = [], accent = C.accent, stagger = 0.06, align = 'center', lh = 1.08, style, weight = 900, out}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  let k = 0;
  const outP = out === undefined ? 0 : interpolate(frame / fps, [out, out + 0.25], [0, 1], {...clamp, easing: Easing.in(Easing.cubic)});
  return (
    <div style={{textAlign: align, fontFamily: F.display, fontWeight: weight, fontSize: size, lineHeight: lh, letterSpacing: '-0.02em', textTransform: 'uppercase', color, ...style}}>
      {lines.map((line, li) => (
        <div key={li} style={{display: 'flex', flexWrap: 'wrap', justifyContent: align === 'center' ? 'center' : 'flex-start', columnGap: size * 0.28}}>
          {line.split(' ').map((w, wi) => {
            const i = k++;
            const s = spring({frame: frame - Math.round((at + i * stagger) * fps), fps, config: {damping: 15, stiffness: 150, mass: 0.8}});
            const isA = accentWords.includes(w.replace(/[.,!?:]/g, ''));
            return (
              <span key={wi} style={{display: 'inline-block', overflow: 'hidden', paddingBottom: size * 0.08, marginBottom: -size * 0.08}}>
                <span
                  style={{
                    display: 'inline-block', transform: `translateY(${(1 - s) * 125 + outP * -125}%) rotate(${(1 - s) * 6}deg)`, opacity: s < 0.02 ? 0 : 1,
                    color: isA ? accent : undefined,
                  }}
                >
                  {w}
                </span>
              </span>
            );
          })}
        </div>
      ))}
    </div>
  );
};

/** Лаймовая плашка-метка над сценой. */
export const Kicker: React.FC<{children: React.ReactNode; at: number; color?: string; size?: number; style?: React.CSSProperties}> = ({children, at, color = C.accent, size = 26, style}) => {
  const s = useSpring(at);
  return (
    <div style={{display: 'inline-flex', alignItems: 'center', gap: 14, opacity: s, transform: `translateY(${(1 - s) * 20}px)`, ...style}}>
      <div style={{width: size * 0.5, height: size * 0.5, borderRadius: 99, background: color, boxShadow: `0 0 ${size}px ${color}`}} />
      <div style={{fontFamily: F.mono, fontWeight: 700, fontSize: size, color, letterSpacing: '0.12em', textTransform: 'uppercase'}}>{children}</div>
    </div>
  );
};

/** Обёртка сцены: вход/выход с переходом (whip со смазом, zoom-провал, flash). */
export const SceneWrap: React.FC<{dur: number; enter?: 'whipUp' | 'whipLeft' | 'zoom' | 'none'; exit?: 'whipUp' | 'whipLeft' | 'zoom' | 'none'; children: React.ReactNode; drift?: number}> = ({dur, enter = 'whipUp', exit = 'whipUp', children, drift = 0.03}) => {
  const frame = useCurrentFrame();
  const {fps, width, height} = useVideoConfig();
  const t = frame / fps;
  const ein = interpolate(t, [0, 0.38], [0, 1], {...clamp, easing: Easing.bezier(0.16, 1, 0.3, 1)});
  const eout = interpolate(t, [dur - 0.3, dur], [0, 1], {...clamp, easing: Easing.bezier(0.7, 0, 0.84, 0)});
  let tx = 0, ty = 0, sc = 1 + drift * (t / Math.max(dur, 0.1)), blur = 0, op = 1;
  const mv = (type: string, p: number, dir: 1 | -1) => {
    if (type === 'whipUp') { ty += dir * p * height * 0.9; blur += p * 26; }
    if (type === 'whipLeft') { tx += dir * p * width * 0.9; blur += p * 26; }
    if (type === 'zoom') { sc *= dir === 1 ? 1 - p * 0.25 : 1 + p * 0.6; op *= 1 - p; blur += p * 14; }
  };
  mv(enter, 1 - ein, 1);
  mv(exit, eout, -1);
  return (
    <AbsoluteFill style={{transform: `translate(${tx}px, ${ty}px) scale(${sc})`, filter: blur > 0.3 ? `blur(${blur}px)` : undefined, opacity: op}}>
      {children}
    </AbsoluteFill>
  );
};

/** Вспышка на стыке сцен. */
export const Flash: React.FC<{at: number; color?: string; strength?: number}> = ({at, color = C.text, strength = 0.35}) => {
  const t = useT();
  const o = interpolate(t, [at - 0.04, at, at + 0.25], [0, strength, 0], clamp);
  return <AbsoluteFill style={{background: color, opacity: o, pointerEvents: 'none'}} />;
};

/** Простые иконки-пиктограммы (оригинальные, без логотипов). */
export const Icon: React.FC<{name: 'globe' | 'dm' | 'plane' | 'phone' | 'table' | 'clock' | 'bell' | 'user' | 'check' | 'bolt' | 'db' | 'spark' | 'doc' | 'chart' | 'eye' | 'flag'; size?: number; color?: string; stroke?: number}> = ({name, size = 48, color = C.text, stroke = 2.2}) => {
  const p = {fill: 'none', stroke: color, strokeWidth: stroke, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const};
  const d: Record<string, React.ReactNode> = {
    globe: (<><circle cx="12" cy="12" r="9" {...p} /><path d="M3 12h18M12 3c3 3.2 3 14.8 0 18M12 3c-3 3.2-3 14.8 0 18" {...p} /></>),
    dm: (<><rect x="3" y="4" width="18" height="13" rx="4" {...p} /><path d="M8 17l-2 4 5-4" {...p} /><path d="M8 10.5h8" {...p} /></>),
    plane: (<path d="M21 4L3 11l6 2 2 6 3-4 4 3 3-14zM9 13l9-6" {...p} />),
    phone: (<path d="M5 4h4l2 5-2.5 1.5a11 11 0 005 5L15 13l5 2v4a2 2 0 01-2 2A16 16 0 013 6a2 2 0 012-2z" {...p} />),
    table: (<><rect x="3" y="4" width="18" height="16" rx="2" {...p} /><path d="M3 9h18M3 14h18M9 4v16M15 4v16" {...p} /></>),
    clock: (<><circle cx="12" cy="12" r="9" {...p} /><path d="M12 7v5l3 2" {...p} /></>),
    bell: (<><path d="M6 16V11a6 6 0 0112 0v5l2 2H4l2-2z" {...p} /><path d="M10 20a2 2 0 004 0" {...p} /></>),
    user: (<><circle cx="12" cy="8" r="4" {...p} /><path d="M4 21a8 8 0 0116 0" {...p} /></>),
    check: (<path d="M4 12.5l5 5L20 6.5" {...p} />),
    bolt: (<path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z" {...p} />),
    db: (<><ellipse cx="12" cy="5.5" rx="8" ry="3" {...p} /><path d="M4 5.5v13c0 1.7 3.6 3 8 3s8-1.3 8-3v-13M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" {...p} /></>),
    spark: (<path d="M12 2l2.2 6.8L21 11l-6.8 2.2L12 20l-2.2-6.8L3 11l6.8-2.2L12 2z" {...p} />),
    doc: (<><path d="M6 2h8l5 5v15H6z" {...p} /><path d="M14 2v5h5M9 12h7M9 16h7" {...p} /></>),
    chart: (<><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" {...p} /></>),
    eye: (<><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z" {...p} /><circle cx="12" cy="12" r="3" {...p} /></>),
    flag: (<><path d="M5 21V4M5 4h12l-2 4 2 4H5" {...p} /></>),
  };
  return <svg width={size} height={size} viewBox="0 0 24 24">{d[name]}</svg>;
};

/** Анимированная линия-связь с бегущим «пакетом». */
export const FlowLine: React.FC<{x1: number; y1: number; x2: number; y2: number; at: number; dur?: number; color?: string; width?: number; packet?: boolean; curve?: number}> = ({x1, y1, x2, y2, at, dur = 0.5, color = C.accent, width = 4, packet = true, curve = 0}) => {
  const t = useT();
  const p = interpolate(t, [at, at + dur], [0, 1], {...clamp, easing: Easing.bezier(0.65, 0, 0.35, 1)});
  const mx = (x1 + x2) / 2 + curve * (y2 - y1) * 0.3, my = (y1 + y2) / 2 - curve * (x2 - x1) * 0.3;
  const path = `M${x1},${y1} Q${mx},${my} ${x2},${y2}`;
  const len = Math.hypot(x2 - x1, y2 - y1) * (1 + Math.abs(curve) * 0.2) + 1;
  const loop = ((t - at - dur) * 0.9) % 1;
  const q = (u: number) => {
    const a = (1 - u) * (1 - u), b = 2 * (1 - u) * u, c = u * u;
    return [a * x1 + b * mx + c * x2, a * y1 + b * my + c * y2];
  };
  const [px, py] = q(Math.max(0, loop));
  return (
    <svg style={{position: 'absolute', left: 0, top: 0, overflow: 'visible', pointerEvents: 'none'}} width={1} height={1}>
      <path d={path} stroke={`${color}40`} strokeWidth={width} fill="none" strokeDasharray={`${len}`} strokeDashoffset={len * (1 - p)} strokeLinecap="round" />
      <path d={path} stroke={color} strokeWidth={width} fill="none" strokeDasharray={`10 14`} strokeDashoffset={-t * 60} opacity={p >= 1 ? 0.55 : 0} strokeLinecap="round" />
      {packet && p >= 1 && <circle cx={px} cy={py} r={width * 2.4} fill={color} style={{filter: `drop-shadow(0 0 10px ${color})`}} />}
    </svg>
  );
};
