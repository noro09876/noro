import { Resvg } from '@resvg/resvg-js';
import jpeg from 'jpeg-js';
import { FONTS, type FontKey, fit, fontFiles, measure } from './layout.ts';

export interface Slide {
  title: string;
  text: string;
}

export interface SlideStyle {
  brandName: string;
  handle: string;
  accent: string;
  background: string;
  topic: string;
  showCounter: boolean;
}

export interface RenderedSlide {
  svg: string;
  warnings: string[];
  overflow: boolean;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const TEXT = '#f2f3f1';
const TEXT_2 = '#b9bfbb';
const TEXT_3 = '#7f8783';
const LINE = '#2a2f33';

function textBlock(lines: string[], x: number, y: number, size: number, lh: number, key: FontKey, fill: string): string {
  const f = FONTS[key];
  const tspans = lines.map((l, i) => `<tspan x="${x}" y="${(y + size + i * size * lh).toFixed(1)}">${esc(l)}</tspan>`).join('');
  return `<text font-family="${f.family}" font-weight="${f.weight}" font-size="${size}" fill="${fill}">${tspans}</text>`;
}

export function sanitizeColor(c: string, fallback: string): string {
  return /^#[0-9a-fA-F]{6}$/.test(c) ? c : fallback;
}

/**
 * Builds one slide as SVG. Kinds: first slide = cover, last slide (when there are 3+) = call to action, others = points.
 * Every text box is fitted with real font metrics; text that cannot fit at the minimum size is reported as overflow.
 */
export function buildSlideSvg(slide: Slide, index: number, total: number, style: SlideStyle, width: number, height: number): RenderedSlide {
  const accent = sanitizeColor(style.accent, '#c9f45f');
  const bg = sanitizeColor(style.background, '#0b0c0d');
  const pad = 96;
  const inner = width - pad * 2;
  const kind = index === 0 ? 'cover' : index === total - 1 && total >= 3 ? 'cta' : 'point';
  const warnings: string[] = [];
  const parts: string[] = [];
  let overflow = false;

  parts.push(`<rect width="${width}" height="${height}" fill="${bg}"/>`);
  // Header: brand name and counter.
  parts.push(textBlock([style.brandName.toUpperCase()], pad, 72, 26, 1, 'medium', TEXT_3));
  if (style.showCounter && total > 1) {
    const counter = `${String(index + 1).padStart(2, '0')} / ${String(total).padStart(2, '0')}`;
    const w = measure(counter, 'medium', 26);
    parts.push(textBlock([counter], width - pad - w, 72, 26, 1, 'medium', TEXT_3));
  }
  parts.push(`<rect x="${pad}" y="128" width="${inner}" height="2" fill="${LINE}"/>`);

  const footerY = height - 96;
  const contentTop = 200;
  const contentBottom = footerY - 80;

  if (kind === 'cover') {
    const label = style.topic ? style.topic.toUpperCase() : '';
    let y = contentTop + 40;
    if (label) {
      const l = fit(label, 'medium', { width: inner, height: 40, maxLines: 1 }, { max: 28, min: 20, lineHeight: 1.2 });
      parts.push(textBlock(l.lines, pad, y, l.size, 1.2, 'medium', accent));
      y += 80;
    }
    const bodyH = slide.text ? 260 : 0;
    const title = fit(slide.title, 'display', { width: inner, height: contentBottom - y - bodyH - 40, maxLines: 6 }, { max: 112, min: 60, lineHeight: 1.08 });
    if (title.overflow) { overflow = true; warnings.push('Заголовок обложки не помещается — сократите его'); }
    parts.push(textBlock(title.lines, pad, y, title.size, 1.08, 'display', TEXT));
    y += title.height + 48;
    parts.push(`<rect x="${pad}" y="${y}" width="120" height="8" fill="${accent}"/>`);
    y += 48;
    if (slide.text) {
      const sub = fit(slide.text, 'body', { width: inner, height: contentBottom - y }, { max: 42, min: 30, lineHeight: 1.35 });
      if (sub.overflow) { overflow = true; warnings.push('Подзаголовок обложки не помещается'); }
      parts.push(textBlock(sub.lines, pad, y, sub.size, 1.35, 'body', TEXT_2));
    }
    if (total > 1) {
      const swipe = 'Листайте  →';
      parts.push(textBlock([swipe], width - pad - measure(swipe, 'medium', 30), footerY - 30, 30, 1, 'medium', accent));
    }
  } else {
    let y = contentTop + 20;
    if (kind === 'point') {
      parts.push(textBlock([String(index).padStart(2, '0')], pad, y, 96, 1, 'display', accent));
      y += 150;
    } else {
      parts.push(`<rect x="${pad}" y="${y + 10}" width="120" height="8" fill="${accent}"/>`);
      y += 70;
    }
    const title = fit(slide.title, 'displaySemi', { width: inner, height: 330, maxLines: 4 }, { max: kind === 'cta' ? 84 : 70, min: 44, lineHeight: 1.12 });
    if (title.overflow) { overflow = true; warnings.push(`Слайд ${index + 1}: заголовок не помещается`); }
    parts.push(textBlock(title.lines, pad, y, title.size, 1.12, 'displaySemi', TEXT));
    y += title.height + 44;
    if (slide.text) {
      const body = fit(slide.text, 'body', { width: inner, height: contentBottom - y }, { max: 44, min: 30, lineHeight: 1.4 });
      if (body.overflow) { overflow = true; warnings.push(`Слайд ${index + 1}: текст не помещается — сократите до одной мысли`); }
      parts.push(textBlock(body.lines, pad, y, body.size, 1.4, 'body', TEXT_2));
    }
  }

  // Footer: handle.
  if (style.handle) {
    const handle = style.handle.startsWith('@') || style.handle.includes('.') ? style.handle : `@${style.handle}`;
    parts.push(textBlock([handle], pad, footerY - 30, 30, 1, 'medium', kind === 'cta' ? accent : TEXT_3));
  }

  if (!slide.title.trim()) { overflow = true; warnings.push(`Слайд ${index + 1}: пустой заголовок`); }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${parts.join('')}</svg>`;
  return { svg, warnings, overflow };
}

/** Rasterizes SVG with the bundled fonts only (system fonts are ignored so output is identical on every machine). */
export function rasterize(svg: string, format: 'jpeg' | 'png', quality = 92): { data: Buffer; width: number; height: number } {
  const r = new Resvg(svg, { font: { fontFiles, loadSystemFonts: false, defaultFontFamily: 'Inter' } });
  const img = r.render();
  if (format === 'png') return { data: Buffer.from(img.asPng()), width: img.width, height: img.height };
  const encoded = jpeg.encode({ data: Buffer.from(img.pixels), width: img.width, height: img.height }, quality);
  return { data: Buffer.from(encoded.data), width: img.width, height: img.height };
}
