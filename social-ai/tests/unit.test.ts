import { describe, expect, it } from 'vitest';
import { redact } from '../server/log.ts';
import { hashPassword, verifyPassword, Vault } from '../server/crypto.ts';
import { checkText } from '../server/validate.ts';
import { compose, xLength } from '../server/platforms.ts';
import { fit, glueShortWords, wrap } from '../server/carousel/layout.ts';
import { buildSlideSvg, rasterize } from '../server/carousel/render.ts';
import { similarity, type Content } from '../server/content.ts';
import { localDay, zonedToUtc } from '../server/time.ts';
import { zip } from '../server/zip.ts';
import { extractJson, isLocalUrl } from '../server/ai/llm.ts';
import { tempDir } from './helpers.ts';

const base: Content = {
  id: 1, brandId: 1, topic: 'ИИ', title: 'Заголовок', body: 'Текст поста', summary: 'Кратко', cta: 'Подписывайтесь', hashtags: ['ИИ', 'NORO', 'a', 'b', 'c', 'd'],
  format: 'post', platforms: ['telegram'], slides: [], status: 'ready', source: 'manual', model: null, isDemo: false, generationCount: 0,
  review: null, contentHash: null, planItemId: null, archivedAt: null, createdAt: '', updatedAt: '',
};

describe('secrets', () => {
  it('redacts tokens in strings and keys', () => {
    const s = redact('POST https://api.telegram.org/bot123456789:AAFakeTokenForTestsOnly_abcdefghijk/sendMessage failed') as string;
    expect(s).not.toContain('AAFake');
    const o = redact({ accessToken: 'vk1.a.secretsecretsecretsecret', nested: { url: 'https://x/?access_token=abc123&v=1' }, ok: 'fine' }) as Record<string, unknown>;
    expect(JSON.stringify(o)).not.toContain('secretsecret');
    expect(JSON.stringify(o)).not.toContain('abc123');
    expect(o.ok).toBe('fine');
  });

  it('encrypts and decrypts with AES-GCM and detects tampering', () => {
    const v = new Vault(tempDir(), null);
    const blob = v.encrypt({ botToken: 'secret-value' });
    expect(blob).not.toContain('secret-value');
    expect(v.decrypt<{ botToken: string }>(blob)?.botToken).toBe('secret-value');
    const parts = blob.split('.');
    parts[3] = Buffer.from('tampered').toString('base64');
    expect(() => v.decrypt(parts.join('.'))).toThrow();
  });

  it('hashes passwords with scrypt', () => {
    const h = hashPassword('correct horse battery');
    expect(verifyPassword('correct horse battery', h)).toBe(true);
    expect(verifyPassword('wrong', h)).toBe(false);
  });
});

describe('text checks', () => {
  it('flags placeholders, mixed scripts, guarantees and banned words', () => {
    expect(checkText('')[0].level).toBe('error');
    expect(checkText('Ссылка: [вставьте ссылку]').some((i) => i.level === 'error')).toBe(true);
    expect(checkText('Этот прoцесс важен').some((i) => i.message.includes('латиницы'))).toBe(true); // latin "o"
    expect(checkText('Гарантированный доход каждый месяц').some((i) => i.level === 'error')).toBe(true);
    expect(checkText('Используйте конкурентX', ['конкурентx']).some((i) => i.message.includes('Запрещённое'))).toBe(true);
    expect(checkText('Исследование показало рост на 40%').some((i) => i.level === 'warning')).toBe(true);
    expect(checkText('Нормальный текст про автоматизацию, без проблем.').filter((i) => i.level === 'error')).toHaveLength(0);
  });
});

describe('platform composition', () => {
  it('splits long Telegram text into an album caption plus follow-up messages', () => {
    const long = { ...base, body: Array.from({ length: 30 }, (_, i) => `Абзац ${i} `.repeat(30)).join('\n\n') };
    const c = compose(long, 'telegram', true);
    expect(c.text.length).toBeLessThanOrEqual(1024);
    expect(c.followUps.length).toBeGreaterThan(1);
    expect(c.followUps.every((p) => p.length <= 4096)).toBe(true);
  });
  it('escapes HTML for Telegram', () => {
    expect(compose({ ...base, body: 'a < b & c' }, 'telegram', false).text).toContain('a &lt; b &amp; c');
  });
  it('keeps X posts within 280 weighted characters and max 2 hashtags', () => {
    const c = compose({ ...base, summary: 'Очень длинное описание '.repeat(30) }, 'x', false);
    expect(xLength(c.text)).toBeLessThanOrEqual(280);
    expect((c.text.match(/#/g) ?? []).length).toBe(2);
    expect(xLength('😀')).toBe(2);
    expect(xLength('https://example.com/very/long/path')).toBe(23);
  });
});

describe('carousel layout', () => {
  it('glues short prepositions to the next word', () => {
    expect(glueShortWords('ИИ-агент в отдел продаж')).toBe('ИИ-агент в отдел продаж');
  });
  it('wraps text within the width and breaks very long words', () => {
    const lines = wrap('Сверхдлинноесловобезпробеловкотороенеможетпоместитьсявстроку и обычный хвост', 'body', 40, 400);
    expect(lines.length).toBeGreaterThan(2);
  });
  it('shrinks font to fit and reports overflow when impossible', () => {
    const ok = fit('Короткий заголовок', 'display', { width: 888, height: 400 }, { max: 112, min: 60, lineHeight: 1.1 });
    expect(ok.overflow).toBe(false);
    expect(ok.size).toBe(112);
    const bad = fit('очень длинный текст '.repeat(80), 'body', { width: 888, height: 300 }, { max: 44, min: 30, lineHeight: 1.4 });
    expect(bad.overflow).toBe(true);
  });
  it('renders a slide to a JPEG of the requested size', () => {
    const r = buildSlideSvg({ title: 'Проверка рендера', text: 'Кириллица и латиница: AI, n8n' }, 1, 3, { brandName: 'NORO', handle: 'noro', accent: '#c9f45f', background: '#0b0c0d', topic: 'ИИ', showCounter: true }, 1080, 1350);
    expect(r.overflow).toBe(false);
    const img = rasterize(r.svg, 'jpeg');
    expect(img.width).toBe(1080);
    expect(img.height).toBe(1350);
    expect(img.data.subarray(0, 3).toString('hex')).toBe('ffd8ff');
  });
  it('escapes markup in slide text', () => {
    const r = buildSlideSvg({ title: '<script>&', text: '"x"' }, 0, 1, { brandName: 'N', handle: '', accent: 'red;"/>', background: '#000000', topic: '', showCounter: false }, 1080, 1080);
    expect(r.svg).not.toContain('<script>');
    expect(r.svg).toContain('#c9f45f'); // invalid colour replaced
  });
});

describe('misc', () => {
  it('detects near duplicates', () => {
    const a = 'Как выбрать первый процесс для автоматизации в малом бизнесе и не ошибиться';
    expect(similarity(a, a)).toBe(1);
    expect(similarity(a, `${a}!`)).toBeGreaterThan(0.9);
    expect(similarity(a, 'Совсем другой текст про программирование на TypeScript')).toBeLessThan(0.1);
  });
  it('converts wall-clock time in a timezone to UTC', () => {
    expect(zonedToUtc('2026-11-02', '10:00', 'Europe/Moscow').toISOString()).toBe('2026-11-02T07:00:00.000Z');
    expect(zonedToUtc('2026-03-29', '10:00', 'Europe/Berlin').toISOString()).toBe('2026-03-29T08:00:00.000Z'); // after DST switch
    expect(localDay(new Date('2026-11-01T22:30:00Z'), 'Europe/Moscow')).toBe('2026-11-02');
  });
  it('writes a valid zip', () => {
    const z = zip([{ name: 'a.txt', data: Buffer.from('hello') }]);
    expect(z.readUInt32LE(0)).toBe(0x04034b50);
    expect(z.readUInt32LE(z.length - 22)).toBe(0x06054b50);
  });
  it('extracts JSON from model output and recognises local URLs', () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJson('Вот ответ: {"a":2} — готово')).toEqual({ a: 2 });
    expect(isLocalUrl('http://127.0.0.1:11434')).toBe(true);
    expect(isLocalUrl('http://192.168.1.5:11434')).toBe(true);
    expect(isLocalUrl('https://api.openai.com/v1')).toBe(false);
  });
});

describe('typography', () => {
  it('attaches particles to the previous word', () => {
    expect(glueShortWords('Нужен ли вашему процессу агент?')).toBe('Нужен ли вашему процессу агент?');
  });
});
