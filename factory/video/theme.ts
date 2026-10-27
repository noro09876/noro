import type { BrandVisual } from '../shared/types';

export interface Theme {
  bg: string;
  surface: string;
  surface2: string;
  border: string;
  text: string;
  muted: string;
  primary: string;
  primaryInk: string;
  accent: string;
  good: string;
  warn: string;
  bad: string;
  fontDisplay: string;
  fontBody: string;
  fontMono: string;
  brandName: string;
}

function hex(h: string): [number, number, number] {
  const m = h.replace('#', '');
  return [parseInt(m.slice(0, 2), 16), parseInt(m.slice(2, 4), 16), parseInt(m.slice(4, 6), 16)];
}
const toHex = (c: number[]) => '#' + c.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');

/** Linear mix of two hex colours, t ∈ [0,1]. */
export function mix(a: string, b: string, t: number): string {
  const A = hex(a);
  const B = hex(b);
  return toHex(A.map((v, i) => v + (B[i]! - v) * t));
}

export function alpha(c: string, a: number): string {
  const [r, g, b] = hex(c);
  return `rgba(${r},${g},${b},${a})`;
}

function luminance(c: string) {
  const [r, g, b] = hex(c).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

const FONT_STACK: Record<string, string> = {
  Unbounded: "'Unbounded Variable', 'Onest Variable', sans-serif",
  Onest: "'Onest Variable', sans-serif",
  'JetBrains Mono': "'JetBrains Mono', monospace",
};

export function themeFrom(visual: BrandVisual, brandName: string): Theme {
  const { background, text, primary, accent } = visual.colors;
  return {
    bg: background,
    surface: mix(background, text, 0.06),
    surface2: mix(background, text, 0.11),
    border: mix(background, text, 0.16),
    text,
    muted: mix(text, background, 0.42),
    primary,
    primaryInk: luminance(primary) > 0.45 ? '#0b0c0d' : '#ffffff',
    accent,
    good: '#4fd18b',
    warn: '#f2b84b',
    bad: '#ff6b6b',
    fontDisplay: FONT_STACK[visual.fonts.display] ?? FONT_STACK.Unbounded!,
    fontBody: FONT_STACK[visual.fonts.body] ?? FONT_STACK.Onest!,
    fontMono: FONT_STACK['JetBrains Mono']!,
    brandName,
  };
}

export const NORO_VISUAL: BrandVisual = {
  colors: { primary: '#c9f45f', accent: '#6cb4ff', background: '#0a0b0c', text: '#eef0ee' },
  fonts: { display: 'Unbounded', body: 'Onest' },
  style: 'Графитовые поверхности, точная сетка, моно-подписи, один сигнальный цвет',
};
