import React from 'react';
import { AbsoluteFill, useVideoConfig } from 'remotion';
import type { BrandVisual, Slide, SlideVisual } from '../../shared/types';
import { Backdrop, BrandChip, Mono, VisualBlock } from '../components/visuals';
import { FontGate } from '../fonts';
import { alpha, themeFrom } from '../theme';

export interface SlideProps {
  brandName: string;
  visual: BrandVisual;
  slide: Slide;
  index: number;
  total: number;
  /** Small label in the corner: campaign or rubric. */
  label?: string;
  aspect: '4:5' | '1:1' | '9:16';
  /** Optional AI-generated background image (absolute URL). */
  backgroundUrl?: string;
  [key: string]: unknown;
}

export const SlideStill: React.FC<SlideProps> = ({ brandName, visual, slide, index, total, label, backgroundUrl }) => {
  const theme = themeFrom(visual, brandName);
  const { width, height } = useVideoConfig();
  const cover = index === 0;
  const scale = Math.min(width / 1080, height / 1350);
  const pad = 84 * scale;
  return (
    <FontGate>
      <AbsoluteFill style={{ fontFamily: theme.fontBody, color: theme.text }}>
        <Backdrop theme={theme} still variant={index} />
        {backgroundUrl ? (
          <AbsoluteFill>
            <img src={backgroundUrl} style={{ width: '100%', height: '100%', objectFit: 'cover', opacity: 0.35 }} />
            <AbsoluteFill style={{ background: `linear-gradient(180deg, ${alpha(theme.bg, 0.3)}, ${alpha(theme.bg, 0.95)})` }} />
          </AbsoluteFill>
        ) : null}
        <AbsoluteFill style={{ padding: pad, display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <BrandChip theme={theme} label={label} />
            <Mono theme={theme} size={26 * scale}>
              {String(index + 1).padStart(2, '0')} / {String(total).padStart(2, '0')}
            </Mono>
          </div>

          <div style={{ marginTop: (cover ? 120 : 76) * scale, display: 'flex', flexDirection: 'column', gap: 28 * scale }}>
            {slide.kicker ? (
              <Mono theme={theme} size={26 * scale} color={theme.primary}>
                {slide.kicker}
              </Mono>
            ) : null}
            <div
              style={{
                fontFamily: theme.fontDisplay,
                fontWeight: 650,
                fontSize: (cover ? 92 : 70) * scale * fitTitle(slide.title, cover),
                lineHeight: 1.04,
                letterSpacing: '-0.035em',
                textWrap: 'balance',
              }}
            >
              {slide.title}
            </div>
            {slide.body ? (
              <div style={{ fontSize: (cover ? 38 : 36) * scale, lineHeight: 1.42, color: alpha(theme.text, 0.82), maxWidth: 860 * scale, textWrap: 'pretty' }}>{slide.body}</div>
            ) : null}
          </div>

          <div style={{ flex: 1, display: 'flex', alignItems: 'flex-end', marginTop: 40 * scale }}>
            {slide.visual ? (
              <div style={{ width: '100%' }}>
                <VisualBlock theme={theme} v={slide.visual} still scale={scale * visualScale(slide.visual)} chartWidth={Math.round(856 * scale)} chartHeight={Math.round(380 * scale)} />
              </div>
            ) : null}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10 * scale, marginTop: 48 * scale }}>
            {Array.from({ length: total }).map((_, i) => (
              <div key={i} style={{ height: 8 * scale, width: (i === index ? 56 : 16) * scale, borderRadius: 4 * scale, background: i === index ? theme.primary : theme.border }} />
            ))}
            <div style={{ marginLeft: 'auto' }}>
              {index < total - 1 ? (
                <Mono theme={theme} size={24 * scale}>
                  листайте →
                </Mono>
              ) : (
                <Mono theme={theme} size={24 * scale} color={theme.primary}>
                  сохраните пост
                </Mono>
              )}
            </div>
          </div>
        </AbsoluteFill>
      </AbsoluteFill>
    </FontGate>
  );
};

function fitTitle(t: string, cover: boolean) {
  const n = t.length;
  if (cover) return n > 60 ? 0.72 : n > 40 ? 0.85 : 1;
  return n > 70 ? 0.78 : n > 48 ? 0.9 : 1;
}

function visualScale(v: SlideVisual) {
  if (v.type === 'stat') return 0.85;
  if (v.type === 'ui') return 0.95;
  return 1;
}

export interface GraphicProps {
  brandName: string;
  visual: BrandVisual;
  headline: string;
  subline: string;
  block: SlideVisual;
  label?: string;
  aspect: '4:5' | '1:1' | '16:9' | '9:16';
  backgroundUrl?: string;
  [key: string]: unknown;
}

export const GraphicStill: React.FC<GraphicProps> = ({ brandName, visual, headline, subline, block, label, backgroundUrl }) => {
  const theme = themeFrom(visual, brandName);
  const { width, height } = useVideoConfig();
  const landscape = width > height;
  const scale = landscape ? height / 1080 : Math.min(width / 1080, height / 1350);
  const pad = 84 * scale;
  return (
    <FontGate>
      <AbsoluteFill style={{ fontFamily: theme.fontBody, color: theme.text }}>
        <Backdrop theme={theme} still variant={headline.length} />
        {backgroundUrl ? (
          <AbsoluteFill>
            <img src={backgroundUrl} style={{ width: '100%', height: '100%', objectFit: 'cover', opacity: 0.4 }} />
            <AbsoluteFill style={{ background: `linear-gradient(${landscape ? 90 : 180}deg, ${alpha(theme.bg, 0.95)} 20%, ${alpha(theme.bg, 0.4)})` }} />
          </AbsoluteFill>
        ) : null}
        <AbsoluteFill style={{ padding: pad, display: 'flex', flexDirection: landscape ? 'row' : 'column', gap: 60 * scale }}>
          <div style={{ flex: landscape ? '0 0 46%' : 'none', display: 'flex', flexDirection: 'column', gap: 30 * scale, justifyContent: landscape ? 'center' : 'flex-start' }}>
            <BrandChip theme={theme} label={label} />
            <div style={{ fontFamily: theme.fontDisplay, fontWeight: 650, fontSize: 84 * scale * (headline.length > 50 ? 0.8 : 1), lineHeight: 1.04, letterSpacing: '-0.035em', marginTop: 30 * scale, textWrap: 'balance' }}>{headline}</div>
            {subline ? <div style={{ fontSize: 38 * scale, lineHeight: 1.4, color: alpha(theme.text, 0.8), textWrap: 'pretty' }}>{subline}</div> : null}
          </div>
          <div style={{ flex: 1, display: 'flex', alignItems: landscape ? 'center' : 'flex-end' }}>
            <div style={{ width: '100%' }}>
              <VisualBlock theme={theme} v={block} still scale={scale * visualScale(block)} chartWidth={Math.round((landscape ? 880 : 856) * scale)} chartHeight={Math.round((landscape ? 520 : 420) * scale)} />
            </div>
          </div>
        </AbsoluteFill>
      </AbsoluteFill>
    </FontGate>
  );
};
