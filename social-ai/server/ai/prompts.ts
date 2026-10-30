import { z } from 'zod';
import type { Brand } from '../content.ts';
import type { Format, Settings } from '../settings.ts';

export const generatedSchema = z.object({
  title: z.string().min(3).max(140),
  hook: z.string().max(200).default(''),
  body: z.string().min(20),
  summary: z.string().max(400).default(''),
  cta: z.string().max(300).default(''),
  hashtags: z.array(z.string()).max(15).default([]),
  slides: z.array(z.object({ title: z.string().max(140), text: z.string().max(400).default('') })).default([]),
});
export type Generated = z.infer<typeof generatedSchema>;

/** JSON schema handed to Ollama's structured output. */
export const generatedJsonSchema = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    hook: { type: 'string' },
    body: { type: 'string' },
    summary: { type: 'string' },
    cta: { type: 'string' },
    hashtags: { type: 'array', items: { type: 'string' } },
    slides: { type: 'array', items: { type: 'object', properties: { title: { type: 'string' }, text: { type: 'string' } }, required: ['title', 'text'] } },
  },
  required: ['title', 'body', 'summary', 'cta', 'hashtags', 'slides'],
};

export const anglesJsonSchema = {
  type: 'object',
  properties: { items: { type: 'array', items: { type: 'object', properties: { n: { type: 'integer' }, angle: { type: 'string' } }, required: ['n', 'angle'] } } },
  required: ['items'],
};

const FORMAT_RULES: Record<Format, string> = {
  carousel: `Формат: карусель.
- slides: от 5 до {maxSlides} слайдов.
- Слайд 1 — сильная обложка: title до 60 символов (обещание пользы или острый вопрос), text — подзаголовок до 90 символов.
- Слайды 2…N-1 — по одной мысли: title до 45 символов, text до 160 символов, конкретно и по делу.
- Последний слайд — вывод или призыв: title до 50 символов, text до 120 символов.
- body — подпись к карусели, 400–900 символов: о чём карусель и зачем её листать.`,
  post: `Формат: пост.
- body — 600–1200 символов, короткие абзацы по 1–3 предложения, разделённые пустой строкой.
- slides — пустой массив.`,
  article: `Формат: статья.
- body — 2000–3500 символов: вступление, 3–5 разделов с подзаголовками отдельной строкой, вывод.
- slides — пустой массив.`,
};

export function systemPrompt(brand: Brand | null, s: Settings['agent']): string {
  return `Ты — главный редактор и автор контента бренда «${brand?.name ?? 'NORO'}».
Аудитория: ${brand?.audience || 'предприниматели, руководители и специалисты, которые внедряют ИИ и автоматизацию'}.
Голос бренда: ${brand?.voice || s.tone}.
Тон: ${s.tone}. Стиль: ${s.style}.

Жёсткие правила:
1. Пиши по-русски, грамотно, без канцелярита, без кликбейта и без эмодзи в начале каждой строки.
2. Не выдумывай исследования, статистику, проценты, цитаты, источники, названия компаний и их результаты. Если нужен пример — пиши «например» и описывай типовой сценарий без цифр.
3. Не обещай гарантированный результат, доход или экономию.
4. Давай конкретику: шаги, критерии, ошибки, чек-листы, примеры промптов или настроек.
5. Не используй заглушки вроде [вставьте ссылку] и не упоминай, что ты ИИ.
${s.constraints ? `6. Ограничения владельца: ${s.constraints}` : ''}

Отвечай строго одним JSON-объектом с полями: title, hook, body, summary, cta, hashtags, slides.
- summary — 1–2 предложения до 240 символов (для X и превью).
- cta — уместный призыв к действию или пустая строка.
- hashtags — 3–6 тегов без символа #, по-русски или общепринятые латиницей (AI, nocode).`;
}

export function contentPrompt(input: { topic: string; angle: string; format: Format; maxSlides: number; recentTitles: string[]; feedback?: string[] }): string {
  return `Тематика: ${input.topic}
Идея материала: ${input.angle || 'выбери сам практичный и полезный угол'}
${FORMAT_RULES[input.format].replace('{maxSlides}', String(input.maxSlides))}
${input.recentTitles.length ? `Недавние материалы (не повторяй их темы и заголовки):\n${input.recentTitles.slice(0, 15).map((t) => `- ${t}`).join('\n')}` : ''}
${input.feedback?.length ? `Предыдущая версия не прошла проверку. Исправь:\n${input.feedback.map((f) => `- ${f}`).join('\n')}` : ''}`;
}

export function anglesPrompt(slots: { n: number; topic: string; format: Format }[], recentTitles: string[], best: string[]): string {
  return `Составь контент-план. Для каждого слота придумай конкретную идею материала (одно предложение до 120 символов): что именно получит читатель.
Слоты:
${slots.map((s) => `${s.n}. тематика «${s.topic}», формат ${s.format}`).join('\n')}
${recentTitles.length ? `Уже было (не повторяй):\n${recentTitles.slice(0, 20).map((t) => `- ${t}`).join('\n')}` : ''}
${best.length ? `Лучше всего заходили материалы:\n${best.map((t) => `- ${t}`).join('\n')}` : ''}
Ответ: {"items":[{"n":1,"angle":"..."}, ...]}`;
}

/** Used when no model is configured: deterministic, honest angles that the user can edit. */
export const FALLBACK_ANGLES = [
  'Пошаговая инструкция: как начать с нуля',
  'Частые ошибки и как их избежать',
  'Чек-лист перед внедрением',
  'Разбор типового сценария применения',
  'Сравнение подходов: когда что выбирать',
  'Мифы и реальность',
  'Инструменты для старта: на что смотреть при выборе',
];
