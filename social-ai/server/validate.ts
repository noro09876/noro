import fs from 'node:fs';
import type { Brand, Content, Media } from './content.ts';
import { similarity } from './content.ts';
import { compose, RULES, xLength } from './platforms.ts';
import type { Platform } from './settings.ts';

export interface TextIssue {
  level: 'error' | 'warning';
  message: string;
}

const PLACEHOLDERS = /lorem ipsum|\bTODO\b|\bTBD\b|\{\{|\}\}|\[(вставьте|ссылка|название|имя|link|insert)[^\]]*\]|<\s*(вставьте|ссылка)|XX+%|\bN\/A\b/i;
const CLAIMS = /(исследовани[ея]\s+(показал|доказал)|по данным\s+\p{L}+|согласно\s+(исследованию|отчёту|отчету|данным)|учёные|ученые\s+доказали|\d+[.,]?\d*\s?%|в\s+\d+\s+раз)/iu;
const GUARANTEES = /гарантированн\p{L}*\s+(доход|прибыл|результат)|без\s+риска|100\s?%\s+(результат|гарант)/iu;

/** Heuristic text checks. They catch typical generation defects, not every spelling mistake. */
export function checkText(text: string, bannedWords: string[] = []): TextIssue[] {
  const issues: TextIssue[] = [];
  const t = text ?? '';
  if (!t.trim()) return [{ level: 'error', message: 'Пустой текст' }];
  if (PLACEHOLDERS.test(t)) issues.push({ level: 'error', message: 'В тексте остался шаблон-заглушка (TODO, [вставьте…], {{…}} и т. п.)' });
  const mixed = t.match(/\b(?=\p{L}*[а-яё])(?=\p{L}*[a-z])\p{L}+\b/giu);
  const realMixed = (mixed ?? []).filter((w) => /[а-яё][a-z]|[a-z][а-яё]/i.test(w));
  if (realMixed.length) issues.push({ level: 'error', message: `Смешение латиницы и кириллицы в словах: ${realMixed.slice(0, 3).join(', ')}` });
  const repeated = t.match(/(?<![\p{L}\p{N}])(\p{L}{2,})\s+\1(?![\p{L}\p{N}])/giu);
  if (repeated) issues.push({ level: 'warning', message: `Повтор слова подряд: «${repeated[0]}»` });
  if (/[!?.,]{4,}|,,|\.\.(?!\.)/.test(t)) issues.push({ level: 'warning', message: 'Подозрительная пунктуация (повторы знаков)' });
  if (/\s[,.:;!?](?!\d)/.test(t.replace(/\s—\s/g, ' '))) issues.push({ level: 'warning', message: 'Пробел перед знаком препинания' });
  const opens = (t.match(/«/g) ?? []).length;
  const closes = (t.match(/»/g) ?? []).length;
  if (opens !== closes) issues.push({ level: 'warning', message: 'Непарные кавычки «»' });
  if ((t.match(/\(/g) ?? []).length !== (t.match(/\)/g) ?? []).length) issues.push({ level: 'warning', message: 'Непарные скобки' });
  if (CLAIMS.test(t)) issues.push({ level: 'warning', message: 'Есть цифры или ссылки на исследования — проверьте, что источник реален' });
  if (GUARANTEES.test(t)) issues.push({ level: 'error', message: 'Обещание гарантированного результата запрещено правилами бренда и площадок' });
  for (const w of bannedWords) {
    if (w.trim() && t.toLowerCase().includes(w.trim().toLowerCase())) issues.push({ level: 'error', message: `Запрещённое слово: «${w.trim()}»` });
  }
  const letters = t.replace(/[^\p{L}]/gu, '');
  if (letters.length > 40 && letters === letters.toUpperCase()) issues.push({ level: 'warning', message: 'Текст набран капслоком' });
  return issues;
}

export interface ValidationInput {
  content: Content;
  brand: Brand | null;
  media: Media[];
  mediaPath: (m: Media) => string;
  platform: Platform;
  /** Already published texts (same account or brand) inside the duplicate window. */
  published: { contentId: number; hash: string | null; text: string }[];
  publicBaseUrl: string | null;
}

export interface ValidationResult {
  errors: string[];
  warnings: string[];
}

/** Full pre-publish check. Any error blocks the publication and is written to the log. */
export function validateForPlatform(v: ValidationInput): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const { content: c, platform } = v;
  const rules = RULES[platform];

  if (c.status === 'archived') errors.push('Материал в архиве');
  if (c.status === 'draft') errors.push('Материал — черновик: подтвердите его перед публикацией');
  if (!c.title.trim() && !c.body.trim()) errors.push('Нет ни заголовка, ни текста');

  const fullText = [c.title, c.body, c.cta, ...c.slides.flatMap((s) => [s.title, s.text])].join('\n');
  for (const issue of checkText(fullText, v.brand?.bannedWords ?? [])) (issue.level === 'error' ? errors : warnings).push(issue.message);

  if (c.format === 'carousel') {
    if (c.slides.length < 2) errors.push('В карусели должно быть минимум 2 слайда');
    if (c.slides.length > rules.maxImages && platform !== 'x') errors.push(`${rules.label}: не больше ${rules.maxImages} слайдов`);
    c.slides.forEach((s, i) => {
      if (!s.title.trim()) errors.push(`Слайд ${i + 1}: пустой заголовок`);
    });
    if (v.media.length !== c.slides.length) errors.push('Изображения слайдов не созданы или устарели — пересоберите карусель');
  }

  const images = v.media;
  if (rules.requiresImage && !images.length) errors.push(`${rules.label}: публикация без изображения невозможна`);
  for (const m of images) {
    if (!rules.imageMimes.includes(m.mime)) errors.push(`${rules.label}: формат ${m.mime} не поддерживается`);
    if (m.bytes > rules.maxImageBytes) errors.push(`${rules.label}: файл ${m.idx + 1} больше ${Math.round(rules.maxImageBytes / 1048576)} МБ`);
    const ratio = m.width / m.height;
    if (ratio < rules.aspect[0] - 0.01 || ratio > rules.aspect[1] + 0.01) errors.push(`${rules.label}: недопустимые пропорции изображения ${m.width}×${m.height}`);
    let exists = false;
    try {
      exists = fs.statSync(v.mediaPath(m)).size === m.bytes;
    } catch {
      exists = false;
    }
    if (!exists) errors.push(`Файл изображения ${m.idx + 1} отсутствует или повреждён`);
  }
  if (new Set(images.map((m) => m.width / m.height)).size > 1) warnings.push('Изображения разных пропорций — площадка может их обрезать');

  const composed = compose(c, platform, images.length > 0);
  if (platform === 'x') {
    if (xLength(composed.text) > rules.maxText) errors.push('X: текст длиннее 280 символов');
    if (images.length > rules.maxImages) warnings.push('X: будут отправлены только первые 4 изображения');
  } else if (!composed.text.trim() && !composed.followUps.length) {
    errors.push('Пустой текст публикации');
  } else if (composed.text.length > (images.length ? rules.maxCaption : rules.maxText)) {
    errors.push(`${rules.label}: текст длиннее ${images.length ? rules.maxCaption : rules.maxText} символов`);
  }
  if (c.hashtags.length > rules.maxHashtags) warnings.push(`${rules.label}: будут использованы только первые ${rules.maxHashtags} хештегов`);
  if (platform === 'instagram') {
    if (!v.publicBaseUrl || !v.publicBaseUrl.startsWith('https://')) {
      errors.push('Instagram загружает изображения по публичной HTTPS-ссылке: задайте NORO_PUBLIC_URL');
    }
  }

  for (const p of v.published) {
    if (p.contentId === c.id) continue;
    if (p.hash && p.hash === c.contentHash) {
      errors.push(`Повтор: такой же материал уже опубликован (#${p.contentId})`);
      break;
    }
    if (similarity(p.text, fullText) > 0.6) {
      errors.push(`Почти дословный повтор опубликованного материала #${p.contentId}`);
      break;
    }
  }
  return { errors: [...new Set(errors)], warnings: [...new Set(warnings)] };
}
