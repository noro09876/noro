import React from 'react';
import { AbsoluteFill, Audio, interpolate, Sequence, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import type { CaptionCue } from '../shared/captions';
import type { BrandVisual, Scene } from '../shared/types';
import { Backdrop, BrandChip, Mono, StepsBlock, useAnim, VisualBlock } from './components/visuals';
import { FontGate } from './fonts';
import { alpha, themeFrom, type Theme } from './theme';

export interface PromoProps {
  brandName: string;
  visual: BrandVisual;
  scenes: Scene[];
  /** Exact per-scene timing from the voiceover. */
  timeline: { sceneId: string; fromMs: number; durationMs: number }[];
  voiceoverUrl?: string;
  musicUrl?: string;
  captions: CaptionCue[];
  showCaptions: boolean;
  label?: string;
  aspect: '9:16' | '1:1' | '16:9';
  [key: string]: unknown;
}

export const FPS = 30;
export const msToFrames = (ms: number) => Math.round((ms / 1000) * FPS);

export function promoDuration(p: Pick<PromoProps, 'timeline'>): number {
  const end = p.timeline.reduce((m, t) => Math.max(m, t.fromMs + t.durationMs), 0);
  return Math.max(FPS, msToFrames(end + 400));
}

export const Promo: React.FC<PromoProps> = (p) => {
  const theme = themeFrom(p.visual, p.brandName);
  const { width, height } = useVideoConfig();
  const vertical = height > width;
  const scale = vertical ? width / 1080 : Math.min(width / 1920, height / 1080) * 1.0;
  const byId = new Map(p.scenes.map((s) => [s.id, s]));

  return (
    <FontGate>
      <AbsoluteFill style={{ background: theme.bg, fontFamily: theme.fontBody, color: theme.text }}>
        <Backdrop theme={theme} />
        {p.timeline.map((t, i) => {
          const scene = byId.get(t.sceneId);
          if (!scene) return null;
          const from = msToFrames(t.fromMs);
          const dur = Math.max(1, msToFrames(t.durationMs));
          return (
            <Sequence key={t.sceneId} from={from} durationInFrames={dur} name={`${i + 1}. ${scene.kind}`}>
              <SceneFrame theme={theme} scene={scene} index={i} total={p.timeline.length} duration={dur} scale={scale} vertical={vertical} />
            </Sequence>
          );
        })}
        <Chrome theme={theme} timeline={p.timeline} label={p.label} scale={scale} />
        {p.showCaptions ? <Captions theme={theme} cues={p.captions} scale={scale} vertical={vertical} /> : null}
        {p.voiceoverUrl ? <Audio src={p.voiceoverUrl} /> : null}
        {p.musicUrl ? <Audio src={p.musicUrl} volume={0.12} /> : null}
      </AbsoluteFill>
    </FontGate>
  );
};

/* ---------- Persistent chrome: brand, progress ---------- */

const Chrome: React.FC<{ theme: Theme; timeline: PromoProps['timeline']; label?: string; scale: number }> = ({ theme, timeline, label, scale }) => {
  const frame = useCurrentFrame();
  const ms = (frame / FPS) * 1000;
  return (
    <AbsoluteFill style={{ padding: `${150 * scale}px ${72 * scale}px 0`, pointerEvents: 'none' }}>
      <div style={{ display: 'flex', gap: 8 * scale }}>
        {timeline.map((t) => {
          const p = Math.max(0, Math.min(1, (ms - t.fromMs) / t.durationMs));
          return (
            <div key={t.sceneId} style={{ flex: t.durationMs, height: 6 * scale, borderRadius: 3 * scale, background: alpha(theme.text, 0.14), overflow: 'hidden' }}>
              <div style={{ width: `${p * 100}%`, height: '100%', background: theme.primary }} />
            </div>
          );
        })}
      </div>
      <div style={{ marginTop: 28 * scale, display: 'flex', alignItems: 'center', justifyContent: 'space-between', transform: `scale(${scale})`, transformOrigin: 'left top' }}>
        <BrandChip theme={theme} label={label} />
      </div>
    </AbsoluteFill>
  );
};

/* ---------- Captions with word highlight ---------- */

const Captions: React.FC<{ theme: Theme; cues: CaptionCue[]; scale: number; vertical: boolean }> = ({ theme, cues, scale, vertical }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const ms = (frame / fps) * 1000;
  const cue = cues.find((c) => ms >= c.startMs && ms <= c.endMs + 120);
  if (!cue) return null;
  const enter = spring({ frame: frame - msToFrames(cue.startMs), fps, config: { damping: 20, mass: 0.6 } });
  return (
    <AbsoluteFill style={{ justifyContent: 'flex-end', alignItems: 'center', paddingBottom: (vertical ? 400 : 90) * scale, pointerEvents: 'none' }}>
      <div
        style={{
          maxWidth: (vertical ? 900 : 1500) * scale,
          padding: `${18 * scale}px ${30 * scale}px`,
          borderRadius: 22 * scale,
          background: alpha(theme.bg, 0.86),
          border: `1px solid ${alpha(theme.text, 0.1)}`,
          textAlign: 'center',
          fontFamily: theme.fontBody,
          fontWeight: 650,
          fontSize: 50 * scale,
          lineHeight: 1.22,
          transform: `translateY(${(1 - enter) * 16}px) scale(${0.96 + enter * 0.04})`,
          opacity: enter,
        }}
      >
        {cue.words.map((w, i) => {
          const active = ms >= w.startMs;
          return (
            <span key={i} style={{ color: active ? theme.text : alpha(theme.text, 0.38), transition: 'none' }}>
              {i ? ' ' : ''}
              {ms >= w.startMs && ms <= w.endMs ? <span style={{ color: theme.primary }}>{w.text}</span> : w.text}
            </span>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

/* ---------- Scenes ---------- */

interface SceneCtx {
  theme: Theme;
  scene: Scene;
  index: number;
  total: number;
  duration: number;
  scale: number;
  vertical: boolean;
}

const SceneFrame: React.FC<SceneCtx> = (ctx) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { scene, duration } = ctx;
  const enter = spring({ frame, fps, config: { damping: 200 }, durationInFrames: 14 });
  const exit = interpolate(frame, [duration - 8, duration], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const kind = scene.transition ?? (ctx.index % 3 === 0 ? 'wipe' : ctx.index % 3 === 1 ? 'slide' : 'zoom');

  let style: React.CSSProperties = {};
  if (kind === 'slide') style = { transform: `translateX(${(1 - enter) * 160 - exit * 120}px)`, opacity: Math.min(enter, 1 - exit) };
  if (kind === 'fade') style = { opacity: Math.min(enter, 1 - exit) };
  if (kind === 'zoom') style = { transform: `scale(${0.92 + enter * 0.08 + exit * 0.06})`, opacity: Math.min(enter, 1 - exit) };
  if (kind === 'wipe') style = { clipPath: `inset(0 ${(1 - enter) * 100}% 0 0)`, opacity: 1 - exit };

  const pad = { top: (ctx.vertical ? 330 : 190) * ctx.scale, side: (ctx.vertical ? 72 : 120) * ctx.scale, bottom: (ctx.vertical ? 560 : 220) * ctx.scale };

  return (
    <AbsoluteFill style={{ ...style, padding: `${pad.top}px ${pad.side}px ${pad.bottom}px` }}>
      {kind === 'wipe' && enter < 1 ? (
        <div style={{ position: 'absolute', top: 0, bottom: 0, left: `${enter * 100}%`, width: 10 * ctx.scale, background: ctx.theme.primary, boxShadow: `0 0 60px ${ctx.theme.primary}` }} />
      ) : null}
      <SceneBody {...ctx} />
    </AbsoluteFill>
  );
};

const Title: React.FC<{ ctx: SceneCtx; size?: number; delay?: number; align?: 'left' | 'center' }> = ({ ctx, size = 88, delay = 0, align = 'left' }) => {
  const { sp } = useAnim(false);
  const words = ctx.scene.title.split(' ');
  return (
    <div style={{ fontFamily: ctx.theme.fontDisplay, fontWeight: 650, fontSize: size * ctx.scale * (ctx.scene.title.length > 42 ? 0.82 : 1), lineHeight: 1.05, letterSpacing: '-0.035em', textAlign: align, textWrap: 'balance' }}>
      {words.map((w, i) => {
        const p = sp(delay + i * 3, 16, 0.6);
        return (
          <span key={i} style={{ display: 'inline-block', overflow: 'hidden', verticalAlign: 'top', paddingBottom: '0.08em' }}>
            <span style={{ display: 'inline-block', transform: `translateY(${(1 - p) * 110}%)`, opacity: p }}>{w}&nbsp;</span>
          </span>
        );
      })}
    </div>
  );
};

const Sub: React.FC<{ ctx: SceneCtx; delay?: number; size?: number; align?: 'left' | 'center' }> = ({ ctx, delay = 12, size = 40, align = 'left' }) => {
  const { sp } = useAnim(false);
  const p = sp(delay);
  if (!ctx.scene.text) return null;
  return <div style={{ fontSize: size * ctx.scale, lineHeight: 1.38, color: alpha(ctx.theme.text, 0.78), opacity: p, transform: `translateY(${(1 - p) * 20}px)`, textAlign: align, textWrap: 'pretty' }}>{ctx.scene.text}</div>;
};

const Kicker: React.FC<{ ctx: SceneCtx; children: React.ReactNode }> = ({ ctx, children }) => {
  const { lin } = useAnim(false);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 16 * ctx.scale, opacity: lin(0, 10) }}>
      <div style={{ width: 48 * ctx.scale * lin(0, 14), height: 4 * ctx.scale, background: ctx.theme.primary }} />
      <Mono theme={ctx.theme} size={26 * ctx.scale} color={ctx.theme.primary}>
        {children}
      </Mono>
    </div>
  );
};

const SceneBody: React.FC<SceneCtx> = (ctx) => {
  const { scene, theme, scale } = ctx;
  const { sp, lin, frame } = useAnim(false);
  const num = `${String(ctx.index + 1).padStart(2, '0')} / ${String(ctx.total).padStart(2, '0')}`;
  const col: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 36 * scale, height: '100%' };

  switch (scene.kind) {
    case 'hook': {
      const bar = lin(10, 30);
      return (
        <div style={{ ...col, justifyContent: 'center' }}>
          <Kicker ctx={ctx}>{num}</Kicker>
          <Title ctx={ctx} size={112} />
          <div style={{ height: 10 * scale, width: `${bar * 62}%`, background: `linear-gradient(90deg, ${theme.primary}, ${theme.accent})`, borderRadius: 5 * scale }} />
          <Sub ctx={ctx} delay={16} size={44} />
        </div>
      );
    }
    case 'problem': {
      const items = scene.visual?.type === 'steps' ? scene.visual.items : (scene.text ?? '').split(/[·;•]/).map((s) => s.trim()).filter(Boolean).slice(0, 4);
      const strike = lin(48, 64);
      return (
        <div style={col}>
          <Kicker ctx={ctx}>проблема</Kicker>
          <Title ctx={ctx} size={84} />
          <div style={{ position: 'relative', flex: 1, marginTop: 20 * scale }}>
            {items.map((it, i) => {
              const p = sp(10 + i * 7, 12, 0.9);
              const rot = [-4, 3, -2, 5][i % 4]!;
              return (
                <div
                  key={i}
                  style={{
                    position: 'absolute',
                    left: `${[0, 12, 4, 16][i % 4]}%`,
                    top: `${i * 23}%`,
                    width: '78%',
                    padding: `${26 * scale}px ${30 * scale}px`,
                    borderRadius: 24 * scale,
                    background: theme.surface,
                    border: `1px solid ${theme.border}`,
                    boxShadow: `0 24px 50px ${alpha('#000000', 0.4)}`,
                    transform: `translateY(${(1 - p) * -300}px) rotate(${rot * p}deg)`,
                    opacity: p,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 20 * scale,
                  }}
                >
                  <div style={{ width: 18 * scale, height: 18 * scale, borderRadius: 9 * scale, background: theme.bad, flex: 'none' }} />
                  <div style={{ fontSize: 36 * scale, fontWeight: 500, position: 'relative' }}>
                    {it}
                    <div style={{ position: 'absolute', left: 0, top: '52%', height: 4 * scale, width: `${strike * 100}%`, background: theme.bad }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      );
    }
    case 'ui':
    case 'feature': {
      const v = scene.visual ?? { type: 'ui' as const, title: theme.brandName, rows: [{ label: scene.title, value: '✓', tone: 'good' as const }, { label: scene.text ?? '', value: '…' }] };
      return (
        <div style={col}>
          <Kicker ctx={ctx}>{scene.kind === 'ui' ? 'интерфейс' : 'возможность'}</Kicker>
          <Title ctx={ctx} size={78} />
          <Sub ctx={ctx} />
          <div style={{ flex: 1, display: 'flex', alignItems: 'center' }}>
            <div style={{ width: '100%', transform: `perspective(1600px) rotateX(${(1 - sp(6)) * 14}deg) translateY(${Math.sin(frame / 25) * 6}px)` }}>
              <VisualBlock theme={theme} v={v} delay={8} scale={scale} cursor={scene.kind === 'ui'} chartWidth={Math.round(936 * scale)} chartHeight={Math.round(520 * scale)} />
            </div>
          </div>
        </div>
      );
    }
    case 'chart': {
      const v = scene.visual?.type === 'chart' ? scene.visual : { type: 'chart' as const, points: [2, 3, 3.5, 5, 6.2, 8], label: scene.title };
      return (
        <div style={col}>
          <Kicker ctx={ctx}>данные</Kicker>
          <Title ctx={ctx} size={78} />
          <Sub ctx={ctx} />
          <div style={{ flex: 1, display: 'flex', alignItems: 'center' }}>
            <VisualBlock theme={theme} v={v} delay={10} chartWidth={Math.round(880 * scale)} chartHeight={Math.round(560 * scale)} />
          </div>
        </div>
      );
    }
    case 'stat': {
      const v = scene.visual?.type === 'stat' ? scene.visual : { type: 'stat' as const, value: '×2', label: scene.text ?? '' };
      const ring = lin(4, 44);
      const r = 230 * scale;
      return (
        <div style={{ ...col, justifyContent: 'center' }}>
          <Kicker ctx={ctx}>результат</Kicker>
          <div style={{ position: 'relative', display: 'grid', placeItems: 'center', height: r * 2.3 }}>
            <svg width={r * 2.2} height={r * 2.2} style={{ position: 'absolute' }}>
              <circle cx={r * 1.1} cy={r * 1.1} r={r} fill="none" stroke={theme.border} strokeWidth={14 * scale} />
              <circle cx={r * 1.1} cy={r * 1.1} r={r} fill="none" stroke={theme.primary} strokeWidth={14 * scale} strokeLinecap="round" strokeDasharray={2 * Math.PI * r} strokeDashoffset={2 * Math.PI * r * (1 - ring * 0.82)} transform={`rotate(-90 ${r * 1.1} ${r * 1.1})`} />
            </svg>
            <div style={{ textAlign: 'center' }}>
              <VisualBlock theme={theme} v={{ ...v, label: '' }} delay={6} scale={scale * 0.9} />
            </div>
          </div>
          <Title ctx={ctx} size={70} delay={14} align="center" />
          <Sub ctx={ctx} delay={20} align="center" />
        </div>
      );
    }
    case 'steps': {
      const v = scene.visual?.type === 'steps' ? scene.visual : { type: 'steps' as const, items: (scene.text ?? '').split(/[·;•]/).map((s) => s.trim()).filter(Boolean).slice(0, 5) };
      return (
        <div style={col}>
          <Kicker ctx={ctx}>как это работает</Kicker>
          <Title ctx={ctx} size={78} />
          <div style={{ flex: 1, display: 'flex', alignItems: 'center' }}>
            <div style={{ width: '100%' }}>{v.items.length >= 2 ? <StepsBlock theme={theme} v={v} delay={10} scale={scale} /> : <Sub ctx={ctx} />}</div>
          </div>
        </div>
      );
    }
    case 'cta': {
      const pulse = 1 + Math.sin(frame / 6) * 0.025 * lin(20, 30);
      const btn = sp(16);
      return (
        <div style={{ ...col, justifyContent: 'center', alignItems: 'center', textAlign: 'center' }}>
          <div style={{ transform: `scale(${sp(0, 12) * 1.0}) rotate(${(1 - sp(0, 12)) * -30}deg)`, width: 150 * scale, height: 150 * scale, borderRadius: 42 * scale, background: theme.primary, display: 'grid', placeItems: 'center', boxShadow: `0 0 120px ${alpha(theme.primary, 0.45)}` }}>
            <div style={{ width: 52 * scale, height: 52 * scale, borderRadius: 12 * scale, background: theme.primaryInk, transform: 'rotate(45deg)' }} />
          </div>
          <Title ctx={ctx} size={90} delay={6} align="center" />
          <div style={{ transform: `scale(${btn * pulse})`, opacity: btn, padding: `${30 * scale}px ${56 * scale}px`, borderRadius: 999, background: theme.text, color: theme.bg, fontFamily: theme.fontDisplay, fontWeight: 600, fontSize: 40 * scale }}>
            {scene.text || 'Попробовать'}
          </div>
        </div>
      );
    }
  }
};
