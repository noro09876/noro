// Generic keyframe interpreter: the only "motion logic" a renderer needs.
import { Easing } from 'remotion';
import type { Track } from './plan';

export type Props = Record<string, number>;

export const IDENTITY: Props = {
  opacity: 1, x: 0, y: 0, scale: 1, scaleX: 1, scaleY: 1, rotate: 0, skewX: 0, blur: 0,
  clipT: 0, clipR: 0, clipB: 0, clipL: 0, tracking: 0, count: 1, accent: 0,
};

const MULT = new Set(['opacity', 'scale', 'scaleX', 'scaleY', 'count']);
const MAX = new Set(['clipT', 'clipR', 'clipB', 'clipL', 'accent']);

export function evalTrack(tr: Track, t: number): number {
  const k = tr.keys;
  if (t <= k[0][0]) return k[0][1];
  if (t >= k[k.length - 1][0]) return k[k.length - 1][1];
  for (let i = 0; i < k.length - 1; i++) {
    const [t0, v0] = k[i];
    const [t1, v1] = k[i + 1];
    if (t >= t0 && t <= t1) {
      if (tr.ease === 'hold') return v0;
      const p = (t - t0) / (t1 - t0 || 1);
      const [a, b, c, d] = tr.ease;
      return v0 + (v1 - v0) * Easing.bezier(a, b, c, d)(p);
    }
  }
  return k[k.length - 1][1];
}

/**
 * mode "enter": before start -> first key, after end -> last key (element holds).
 * mode "window": only between start and start+dur, identity outside (camera, fx).
 * mode "after": identity before start, holds the last key after (exits, recolor).
 */
export function sample(tracks: Track[] | undefined, frame: number, start: number, dur: number, mode: "enter" | "window" | "after"): Props {
  const out: Props = {};
  if (!tracks) return out;
  if (mode === 'window' && (frame < start || frame >= start + dur)) return out;
  if (mode === "after" && frame < start) return out;
  const t = dur <= 1 ? (frame >= start ? 1 : 0) : (frame - start) / dur;
  for (const tr of tracks) out[tr.prop] = evalTrack(tr, Math.max(0, Math.min(1, t)));
  return out;
}

export function combine(...ps: Props[]): Props {
  const out: Props = { ...IDENTITY };
  for (const p of ps) {
    for (const [k, v] of Object.entries(p)) {
      if (MULT.has(k) && k !== 'count') out[k] *= v;
      else if (MAX.has(k)) out[k] = Math.max(out[k], v);
      else if (k === 'count') out[k] = v;
      else out[k] = (out[k] ?? 0) + v;
    }
  }
  return out;
}

/** CSS for a combined props set. Translation unit: "em" for text, "%" for layers. */
export function css(p: Props, unit: 'em' | '%', origin = 'center center'): React.CSSProperties {
  const tf = `translate(${p.x}${unit}, ${p.y}${unit}) rotate(${p.rotate}deg) skewX(${p.skewX}deg) scale(${p.scale * p.scaleX}, ${p.scale * p.scaleY})`;
  const clip = p.clipT || p.clipR || p.clipB || p.clipL;
  return {
    opacity: p.opacity,
    transform: tf,
    transformOrigin: origin,
    filter: p.blur > 0.05 ? `blur(${p.blur}px)` : undefined,
    clipPath: clip ? `inset(${p.clipT}% ${p.clipR}% ${p.clipB}% ${p.clipL}%)` : undefined,
  };
}
