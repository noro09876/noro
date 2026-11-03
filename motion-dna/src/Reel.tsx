// Reference renderer: draws a motion plan frame by frame. It contains no style
// decisions — everything comes from the plan (see pipeline/compile_plan.py).
import '@fontsource-variable/onest';
import '@fontsource-variable/unbounded';
import React, { useEffect, useState } from 'react';
import {
  AbsoluteFill, Audio, Img, continueRender, delayRender, interpolate, Easing, staticFile, useCurrentFrame,
} from 'remotion';
import type { Anim, Plan, TextLayer } from './plan';
import { IDENTITY, Props, combine, css, sample } from './tracks';

const useFonts = (plan: Plan) => {
  const [handle] = useState(() => delayRender('fonts'));
  useEffect(() => {
    const specs = new Set(plan.texts.map((t) => `${t.type.weight} 100px "${t.type.family}"`));
    Promise.all([...specs].map((s) => document.fonts.load(s, 'АБВ abc 0123')))
      .then(() => continueRender(handle))
      .catch(() => continueRender(handle));
  }, [handle, plan]);
};

// ---------- footage ----------
const ClipLayer: React.FC<{ clip: Plan['clips'][number]; frame: number; W: number; blur: number }> = ({ clip, frame, W, blur }) => {
  if (frame < clip.from || frame >= clip.to) return null;
  const scroll = interpolate(frame, [clip.from, clip.to], clip.scroll, {
    easing: Easing.bezier(0.37, 0, 0.63, 1), extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });
  const p = combine(...clip.fx.map((f) => sample(f.tracks, frame, f.start, f.dur, 'window')));
  return (
    <AbsoluteFill style={{ overflow: 'hidden' }}>
      <AbsoluteFill style={css(p, '%')}>
        <Img src={staticFile(clip.src)} style={{ width: W, position: 'absolute', top: 0, left: 0, transform: `translateY(${-scroll}px)`, filter: blur ? `blur(${blur}px)` : undefined }} />
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

// ---------- text ----------
const staggerOffset = (a: Anim, idx: number, n: number) => {
  const s = a.stagger;
  if (!s || typeof s.frames !== 'number') return 0;
  const i = s.order === 'reverse' ? n - 1 - idx : idx;
  return i * s.frames;
};

const formatNumber = (v: number, decimals: number) => {
  const s = v.toFixed(decimals).replace('.', ',');
  const [int, frac] = s.split(',');
  const grouped = int.length > 4 ? int.replace(/\B(?=(\d{3})+(?!\d))/g, ' ') : int;
  return frac ? `${grouped},${frac}` : grouped;
};

const TextBlock: React.FC<{ t: TextLayer; frame: number; plan: Plan }> = ({ t, frame, plan }) => {
  if (frame < t.from || frame >= t.to) return null;
  const { W, H } = { W: plan.width, H: plan.height };
  const pal = plan.palette;
  const delay = t.plate?.text_delay ?? 0;
  const enterBase = t.from + delay;
  const lines = Array.from({ length: t.lines }, (_, li) => t.words.filter((w) => w.line === li));
  const nWords = t.words.length;

  const levelProps = (level: string, idx: number, n: number, at: number, charOffset = 0): Props => {
    const parts: Props[] = [];
    if (t.enter.unit === level) {
      parts.push(sample(t.enter.tracks, frame, enterBase + at + charOffset, t.enter.dur, 'enter'));
    }
    if (t.exit && t.exit.unit === level) {
      const maxS = staggerOffset(t.exit, n - 1, n);
      parts.push(sample(t.exit.tracks, frame, (t.exit.start ?? t.to) - maxS + staggerOffset(t.exit, idx, n), t.exit.dur, 'after'));
    }
    return parts.length ? combine(...parts) : { ...IDENTITY };
  };

  const masked = (level: string) => (t.enter.unit === level && t.enter.mask) || (t.exit?.unit === level && t.exit.mask);
  const maskStyle: React.CSSProperties = { display: 'inline-block', overflow: 'hidden', padding: '0.12em 0.1em 0.16em', margin: '-0.12em -0.1em -0.16em', verticalAlign: 'top' };

  const block = levelProps('block', 0, 1, 0);
  const ty = t.type;
  const usePlate = !!t.plate;
  const shadow = !usePlate && plan.textShadow.blur ? `0 0 ${plan.textShadow.blur}px rgba(0,0,0,${plan.textShadow.opacity ?? 0.3})` : undefined;
  const align = t.box.align;
  const left = align === 'center' ? t.box.x * W - (t.box.w * W) / 2 : t.box.x * W;

  const plateEl = (key: string, idx: number) => {
    const pl = t.plate!;
    const st = (pl.start ?? t.from) + staggerOffset(pl, idx, t.lines);
    const p = combine(sample(pl.tracks, frame, st, pl.dur, 'enter'));
    const pad = pl.params.pad_x ?? 0.3;
    const sh = pl.params.shadow;
    return (
      <span key={key} style={{
        position: 'absolute', left: `-${pad}em`, right: `-${pad}em`, top: '0.02em', bottom: '-0.02em',
        background: pal.plate, borderRadius: `${pl.params.radius ?? 0}em`,
        boxShadow: sh ? `${sh}em ${sh}em 0 ${pal.shadow}` : undefined, zIndex: 0,
        ...css(p, 'em', pl.origin ?? 'center center'),
      }} />
    );
  };

  const wordEl = (w: TextLayer['words'][number], wIdxInLine: number, lineLen: number) => {
    const wp = levelProps('word', w.word, nWords, w.at);
    const em = t.emphasis.filter((e) => e.word === w.word);
    let color = ty.color;
    let text = w.text;
    const decor: React.ReactNode[] = [];
    const extra: Props[] = [];
    for (const e of em) {
      const st = e.start ?? t.from;
      if (e.draw === 'recolor') {
        const p = sample(e.tracks, frame, st, e.dur, 'after');
        extra.push(p);
        if ((p.accent ?? 0) > 0.5) color = pal.accent;
      } else if (e.draw === 'count') {
        const p = sample(e.tracks, frame, st, e.dur, 'enter');
        text = formatNumber((e.value ?? 0) * (p.count ?? 1), e.decimals ?? 0);
      } else {
        const p = combine(sample(e.tracks, frame, st, e.dur, 'enter'));
        if (frame >= st + 2 && e.draw === 'rect_behind') color = pal.accent_ink;
        const base: React.CSSProperties = { position: 'absolute', zIndex: -1, ...css(p, 'em', e.origin ?? 'left center') };
        if (e.draw === 'rect_behind') {
          const h = e.params.height ?? 0.6;
          decor.push(<span key={e.technique} style={{ ...base, left: '-0.1em', right: '-0.1em', top: `calc(50% - ${h / 2}em + ${e.params.offset_y ?? 0}em)`, height: `${h}em`, background: pal.accent, transform: `${base.transform} rotate(${e.params.tilt ?? 0}deg)` }} />);
        } else if (e.draw === 'line_under') {
          decor.push(<span key={e.technique} style={{ ...base, left: 0, right: 0, bottom: '0.02em', height: `${e.params.thickness ?? 0.08}em`, background: pal.accent }} />);
        } else if (e.draw === 'rect_outline') {
          const pad = e.params.pad ?? 0.15;
          decor.push(<span key={e.technique} style={{ ...base, inset: `-${pad}em`, border: `0.05em solid ${pal.accent}` }} />);
        }
      }
    }
    const p = combine(wp, ...extra);
    const charUnit = t.enter.unit === 'char';
    const content = charUnit
      ? [...text].map((ch, ci) => {
          const cp = levelProps('char', ci, text.length, w.at, ci * (typeof t.enter.stagger?.frames === 'number' ? t.enter.stagger.frames : 1));
          return <span key={ci} style={{ display: 'inline-block', ...css(cp, 'em') }}>{ch}</span>;
        })
      : text;
    const inner = (
      <span style={{ display: 'inline-block', position: 'relative', isolation: 'isolate', color, ...css(p, 'em', 'center 60%') }}>
        {decor}
        {content}
      </span>
    );
    return (
      <span key={w.word} style={{ display: 'inline-block', marginRight: wIdxInLine < lineLen - 1 ? '0.27em' : 0 }}>
        {masked('word') ? <span style={maskStyle}>{inner}</span> : inner}
      </span>
    );
  };

  return (
    <div style={{
      position: 'absolute', left, top: t.box.y * H, width: t.box.w * W,
      fontFamily: `"${ty.family}"`, fontWeight: ty.weight, fontSize: ty.size_px,
      lineHeight: ty.leading ?? 1.05, letterSpacing: `${(ty.tracking ?? 0) + (block.tracking ?? 0)}em`,
      textAlign: align, textShadow: shadow, fontFeatureSettings: '"tnum" 1',
      transform: `rotate(${t.rotate}deg)`, transformOrigin: 'left top',
    }}>
      <div style={{ ...css(block, 'em', align === 'center' ? 'center center' : 'left center'), position: 'relative', display: 'inline-block' }}>
        {usePlate && t.plate!.unit === 'block' ? plateEl('plate', 0) : null}
        {lines.map((ln, li) => {
          const lp = levelProps('line', li, t.lines, ln[0]?.at ?? 0);
          const lineInner = (
            <div style={{ position: 'relative', display: 'inline-block', letterSpacing: `${(ty.tracking ?? 0) + (lp.tracking ?? 0)}em`, ...css(lp, 'em', 'left center') }}>
              {usePlate && t.plate!.unit === 'line' ? plateEl(`plate${li}`, li) : null}
              <span style={{ position: 'relative', zIndex: 1 }}>{ln.map((w, i) => wordEl(w, i, ln.length))}</span>
            </div>
          );
          return (
            <div key={li} style={{ textAlign: align, marginTop: usePlate && li > 0 ? '0.16em' : 0 }}>
              {masked('line') ? <span style={maskStyle}>{lineInner}</span> : lineInner}
            </div>
          );
        })}
      </div>
    </div>
  );
};

// ---------- finish ----------
const Grain: React.FC<{ amount: number; frame: number }> = ({ amount, frame }) => (
  <AbsoluteFill style={{ opacity: amount, mixBlendMode: 'overlay', pointerEvents: 'none' }}>
    <svg width="100%" height="100%">
      <filter id="g">
        <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed={frame % 97} stitchTiles="stitch" />
        <feColorMatrix type="saturate" values="0" />
      </filter>
      <rect width="100%" height="100%" filter="url(#g)" />
    </svg>
  </AbsoluteFill>
);

export const Reel: React.FC<{ plan: Plan }> = ({ plan }) => {
  useFonts(plan);
  const frame = useCurrentFrame();
  const f = plan.finish;
  return (
    <AbsoluteFill style={{ background: plan.palette.base }}>
      {plan.clips.map((c) => <ClipLayer key={c.id} clip={c} frame={frame} W={plan.width} blur={f.footage_blur ?? 0} />)}
      {f.dim_footage ? <AbsoluteFill style={{ background: plan.palette.base, opacity: f.dim_footage }} /> : null}
      {f.vignette ? <AbsoluteFill style={{ background: `radial-gradient(ellipse at 50% 45%, transparent 45%, rgba(0,0,0,${f.vignette}) 100%)` }} /> : null}
      {plan.texts.map((t) => <TextBlock key={t.id} t={t} frame={frame} plan={plan} />)}
      {plan.overlays.map((o, i) => {
        const p = sample(o.tracks, frame, o.start, o.dur, 'window');
        return p.opacity ? <AbsoluteFill key={i} style={{ background: o.color, opacity: p.opacity }} /> : null;
      })}
      {f.grain ? <Grain amount={f.grain} frame={frame} /> : null}
      <Audio src={staticFile(plan.audio)} />
    </AbsoluteFill>
  );
};
