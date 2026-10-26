import { uid } from '../../../lib/id';
import { headingFrom } from './analyze';
import type { Analysis, ContentItem, PlatformId, Project, Tone } from './types';
import { PLATFORMS } from './types';

/**
 * Template-based draft builder. It rearranges the theses extracted from the
 * source into platform formats; it does not invent facts or rewrite meaning.
 */

const pick = <T,>(list: T[], variant: number, offset = 0): T => list[(variant + offset) % list.length]!;

const OPENERS: Record<Tone, string[]> = {
  friendly: ['Давайте честно:', 'Короткая мысль на сегодня.', 'Разберёмся без сложных слов.'],
  expert: ['Разбор по существу.', 'Коротко о главном.', 'Важный момент, который часто упускают.'],
  bold: ['Неудобная правда.', 'Скажу прямо.', 'Вот что никто не говорит вслух.'],
  formal: ['Ключевые положения.', 'Краткое изложение материала.', 'Основные выводы.'],
};

const EMAIL_CTA: Record<Tone, string[]> = {
  friendly: ['Ответьте на это письмо, если хотите обсудить — мы читаем все ответы.'],
  expert: ['Если хотите разобрать вашу ситуацию — просто ответьте на это письмо.'],
  bold: ['Проверьте это у себя на этой неделе. Ответьте на письмо, что получилось.'],
  formal: ['По вопросам вы можете ответить на это письмо.'],
};

function shorten(s: string, max: number): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1);
  return `${cut.slice(0, cut.lastIndexOf(' ') > 20 ? cut.lastIndexOf(' ') : cut.length).replace(/[\s,:;—–-]+$/, '')}…`;
}

const BULLET: Record<Tone, string> = { friendly: '👉', expert: '—', bold: '⚡', formal: '•' };

function hashtags(keywords: string[], n = 3): string {
  return keywords
    .slice(0, n)
    .map((k) => '#' + k.replace(/[^\p{L}\p{N}]/gu, ''))
    .join(' ');
}

function list(items: string[], tone: Tone): string {
  return items.map((t) => `${BULLET[tone]} ${t}`).join('\n');
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

interface Ctx {
  a: Analysis;
  tone: Tone;
  v: number;
  topic: string;
  audience: string;
}

const builders: Record<PlatformId, (c: Ctx) => { title: string; body: string }> = {
  telegram: ({ a, tone, v }) => {
    const title = pick(a.headlines, v);
    const theses = a.theses.slice(0, 4);
    return {
      title,
      body: [`**${title}**`, pick(OPENERS[tone], v), list(theses, tone), pick(a.ctas, v), hashtags(a.keywords)].filter(Boolean).join('\n\n'),
    };
  },
  vk: ({ a, tone, v, audience }) => {
    const title = pick(a.headlines, v, 1);
    return {
      title,
      body: [
        title,
        audience ? `Для кого: ${audience}.` : '',
        a.theses[0] ?? '',
        'Главное:',
        list(a.theses.slice(1, 5), tone),
        a.facts[0] && !a.theses.includes(a.facts[0]) ? `Цифра для размышления: ${a.facts[0]}` : '',
        a.questions[0] ? `${a.questions[0]} Поделитесь мнением в комментариях.` : pick(a.ctas, v, 1),
        hashtags(a.keywords, 4),
      ]
        .filter(Boolean)
        .join('\n\n'),
    };
  },
  dzen: ({ a, v, topic }) => {
    const title = pick(a.headlines, v, 2);
    // each thesis becomes a section; the body is the paragraph it came from
    const sections = a.theses.map((t, i) => {
      const para = a.paragraphs.find((p) => p.includes(t) || p.includes(t.slice(1))) ?? t;
      return `## ${i + 1}. ${headingFrom(t)}\n\n${para}`;
    });
    return {
      title,
      body: [
        `# ${title}`,
        a.description,
        `В этой статье — ${a.theses.length} ключевых мыслей${topic ? ` по теме «${topic}»` : ''}.`,
        ...sections,
        a.facts.length ? `## Цифры и примеры\n\n${a.facts.map((f) => `— ${f}`).join('\n')}` : '',
        `## Вывод\n\n${a.conclusion || a.theses.at(-1) || ''}\n\n${pick(a.ctas, v, 2)}`,
      ]
        .filter(Boolean)
        .join('\n\n'),
    };
  },
  email: ({ a, tone, v }) => {
    const fits = a.headlines.filter((h) => h.length <= 60);
    const subject = fits.length ? pick(fits, v, 3) : shorten(pick(a.headlines, v, 3), 60);
    const hello = tone === 'formal' ? 'Здравствуйте!' : tone === 'bold' ? 'Привет.' : 'Здравствуйте!';
    return {
      title: subject,
      body: [
        `Тема: ${subject}`,
        `Прехедер: ${a.description.slice(0, 90)}`,
        '---',
        hello,
        a.theses[0] ?? '',
        'Коротко:',
        list(a.theses.slice(1, 4), tone),
        pick(EMAIL_CTA[tone], v),
        tone === 'formal' ? 'С уважением,\nкоманда' : 'До связи!',
      ]
        .filter(Boolean)
        .join('\n\n'),
    };
  },
  youtube: ({ a, v }) => {
    const title = pick(a.headlines, v, 4).slice(0, 100);
    const chapters = ['00:00 Вступление', ...a.theses.slice(0, 5).map((t, i) => `0${i + 1}:00 ${headingFrom(t)}`), `0${Math.min(a.theses.length, 5) + 1}:00 Итоги`];
    return {
      title,
      body: [
        `Название: ${title}`,
        'Структура ролика:',
        `1. Крючок (0–15 сек): ${a.questions[0] ?? title}`,
        ...a.theses.slice(0, 5).map((t, i) => `${i + 2}. ${t}`),
        `${Math.min(a.theses.length, 5) + 2}. Итог и призыв: ${pick(a.ctas, v)}`,
        'Описание:',
        a.description,
        'Таймкоды (уточните после монтажа):',
        chapters.join('\n'),
        hashtags(a.keywords, 3),
      ]
        .filter(Boolean)
        .join('\n\n'),
    };
  },
  shorts: ({ a, v }) => {
    const hook = a.questions[0] ?? pick(a.headlines, v, 1);
    const points = a.theses.slice(0, 3);
    return {
      title: `Shorts: ${pick(a.headlines, v, 5)}`,
      body: [
        `[0–3 сек] Крючок в кадре: «${hook}»`,
        ...points.map((p, i) => `[${4 + i * 15}–${18 + i * 15} сек] ${p}`),
        `[${4 + points.length * 15}–${Math.min(60, 10 + points.length * 15)} сек] Призыв: ${pick(a.ctas, v)}`,
        `Текст на экране: ${a.keywords.slice(0, 3).join(' · ')}`,
      ].join('\n'),
    };
  },
};

export function buildDraft(platform: PlatformId, p: Pick<Project, 'tone' | 'variant' | 'topic' | 'audience'>, a: Analysis): { title: string; body: string } {
  return builders[platform]({ a, tone: p.tone, v: p.variant, topic: p.topic, audience: p.audience });
}

/**
 * Rebuilds drafts. Items the user edited by hand are kept as they are unless
 * `overwriteEdited` is set; their text is preserved in version history either way.
 */
export function buildItems(p: Project, a: Analysis, overwriteEdited = false): ContentItem[] {
  const now = Date.now();
  return p.platforms.map((platform) => {
    const prev = p.items.find((i) => i.platform === platform);
    const draft = buildDraft(platform, p, a);
    if (prev && prev.edited && !overwriteEdited) return prev;
    const versions = prev ? [...prev.versions, { at: now, title: prev.title, body: prev.body, label: 'До пересборки' }].slice(-20) : [];
    return {
      id: prev?.id ?? uid('ci'),
      platform,
      title: draft.title,
      body: draft.body,
      status: prev?.status ?? 'draft',
      date: prev?.date ?? addDays(p.startDate, PLATFORMS[platform].offsetDays),
      versions,
      edited: false,
    };
  });
}

export function lengthState(platform: PlatformId, body: string): { len: number; level: 'ok' | 'short' | 'long' | 'over'; hint: string } {
  const spec = PLATFORMS[platform];
  const len = body.length;
  if (len > spec.maxChars) return { len, level: 'over', hint: `Превышен лимит площадки: ${spec.maxChars.toLocaleString('ru-RU')} символов` };
  if (len > spec.recommended[1]) return { len, level: 'long', hint: `Длиннее рекомендованного (до ${spec.recommended[1].toLocaleString('ru-RU')})` };
  if (len < spec.recommended[0]) return { len, level: 'short', hint: `Короче рекомендованного (от ${spec.recommended[0].toLocaleString('ru-RU')})` };
  return { len, level: 'ok', hint: 'Длина в рекомендованном диапазоне' };
}

export function projectToMarkdown(p: Project): string {
  const out = [`# ${p.name}`, '', `Тема: ${p.topic || '—'}  `, `Аудитория: ${p.audience || '—'}  `, `Старт: ${p.startDate}`, ''];
  if (p.analysis) {
    out.push('## Тезисы', '', ...p.analysis.theses.map((t) => `- ${t}`), '', '## Ключевые слова', '', p.analysis.keywords.join(', '), '');
    out.push('## Заголовки', '', ...p.analysis.headlines.map((h) => `- ${h}`), '');
  }
  for (const i of p.items) {
    out.push(`## ${PLATFORMS[i.platform].label} — ${i.date}`, '', `**${i.title}**`, '', i.body, '');
  }
  return out.join('\n');
}

export { addDays };
