import { uid } from '../../../lib/id';
import type { Article } from './types';

/**
 * Splits a Markdown/plain-text file into articles by headings (#, ##).
 * A file without headings becomes one article named after the file.
 */
export function articlesFromText(text: string, fileName: string, category = 'Импорт'): Article[] {
  const clean = text.replace(/\r/g, '').replace(/^\uFEFF/, '');
  const lines = clean.split('\n');
  const out: Article[] = [];
  let title: string | null = null;
  let buf: string[] = [];
  const flush = () => {
    const body = buf.join('\n').trim();
    if (title && body) out.push({ id: uid(), title, body, category, updatedAt: Date.now() });
    else if (!title && body) out.push({ id: uid(), title: fileName.replace(/\.[^.]+$/, ''), body, category, updatedAt: Date.now() });
    buf = [];
  };
  for (const line of lines) {
    const m = /^#{1,2}\s+(.+?)\s*#*$/.exec(line);
    if (m) {
      flush();
      title = m[1]!.trim();
    } else buf.push(line.replace(/^#{3,6}\s+/, ''));
  }
  flush();
  return out.map((a) => ({ ...a, body: stripMarkdown(a.body) }));
}

function stripMarkdown(s: string): string {
  return s
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^\s*[-*+]\s+/gm, '— ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Validates a JSON export of the knowledge base. */
export function articlesFromJson(text: string): Article[] {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('Файл не является корректным JSON.');
  }
  const list = Array.isArray(data) ? data : (data as { articles?: unknown }).articles;
  if (!Array.isArray(list)) throw new Error('В JSON нет списка статей (ожидается массив или поле "articles").');
  const out: Article[] = [];
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    const title = typeof r.title === 'string' ? r.title.trim() : '';
    const body = typeof r.body === 'string' ? r.body.trim() : '';
    if (!title || !body) continue;
    out.push({
      id: typeof r.id === 'string' && r.id ? r.id : uid(),
      title: title.slice(0, 200),
      body: body.slice(0, 20000),
      category: typeof r.category === 'string' && r.category.trim() ? r.category.trim().slice(0, 60) : 'Импорт',
      updatedAt: typeof r.updatedAt === 'number' ? r.updatedAt : Date.now(),
    });
  }
  if (!out.length) throw new Error('В файле не найдено статей с заголовком и текстом.');
  return out;
}
