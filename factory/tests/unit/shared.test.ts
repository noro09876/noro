import { describe, expect, it } from 'vitest';
import { DEFAULT_RULE, validateRule } from '../../shared/automation';
import { buildCues, timeWords, toSrt, toVtt } from '../../shared/captions';
import { PLATFORMS } from '../../shared/platforms';
import { adaptForPlatform, checksPassed, cleanTag, runChecks, smartTrim } from '../../shared/quality';
import { addDays, formatInTz, planDate, zonedToUtc } from '../../shared/time';
import { wordDiff } from '../../web/src/components/diff';

const brand = { name: 'Veltro', forbidden: ['гарантируем рост'], vocabulary: { preferred: [], avoid: ['дешёвый'] } };

describe('quality checks', () => {
  it('passes a complete post', () => {
    const r = runChecks({ kind: 'post', data: { headline: 'Заголовок', body: 'Текст поста', cta: 'Пишите', hashtags: [] }, brand, platforms: ['telegram'], assets: [] });
    expect(checksPassed(r)).toBe(true);
    expect(r.map((x) => x.code)).toContain('all_ok');
  });
  it('blocks forbidden brand phrases and avoid-words', () => {
    const r = runChecks({ kind: 'post', data: { headline: 'Мы гарантируем рост', body: 'Дешёвый сервис', cta: 'x' }, brand, platforms: ['telegram'], assets: [] });
    expect(checksPassed(r)).toBe(false);
    expect(r.find((x) => x.code === 'forbidden')?.message).toMatch(/гарантируем рост/);
  });
  it('blocks leftover placeholders', () => {
    const r = runChecks({ kind: 'post', data: { headline: 'a', body: 'Ссылка: [вставьте ссылку]', cta: 'b' }, brand, platforms: [], assets: [] });
    expect(r.some((x) => x.code === 'placeholder')).toBe(true);
  });
  it('requires rendered slides for a carousel', () => {
    const data = { title: 't', caption: 'c', slides: [{ title: 'a', body: '' }, { title: 'b', body: '' }] };
    const r = runChecks({ kind: 'carousel', data, brand, platforms: [], assets: [{ kind: 'image' }] });
    expect(r.some((x) => x.code === 'missing_slides')).toBe(true);
    const ok = runChecks({ kind: 'carousel', data, brand, platforms: [], assets: [{ kind: 'image' }, { kind: 'image' }] });
    expect(checksPassed(ok)).toBe(true);
  });
  it('enforces per-platform video duration limits', () => {
    const scenes = [1, 2, 3].map((i) => ({ id: `s${i}`, title: 't', voiceover: 'v', durationSec: 5 }));
    const max = PLATFORMS.youtube.limits.videoMaxSec!;
    const r = runChecks({ kind: 'video', data: { title: 'v', scenes }, brand, platforms: ['youtube'], assets: [{ kind: 'video', durationMs: (max + 10) * 1000 }, { kind: 'subtitle' }] });
    expect(r.some((x) => x.code === 'video_too_long' && x.platform === 'youtube')).toBe(true);
  });
});

describe('platform adaptation', () => {
  it('trims on word boundaries and never mid-word', () => {
    const t = smartTrim('один два три четыре пять шесть', 14);
    expect(t.truncated).toBe(true);
    expect(t.text.length).toBeLessThanOrEqual(14);
    expect(t.text).toMatch(/…$/);
    expect(t.text).toBe('один два три…');
  });
  it('cleans hashtags', () => {
    expect(cleanTag('##чистая маржа!')).toBe('#чистаямаржа');
  });
  it('respects platform text limits', () => {
    const body = 'Слово. '.repeat(10000);
    for (const p of ['telegram', 'vk', 'threads'] as const) {
      const a = adaptForPlatform(p, { headline: 'H', body, hashtags: ['a', 'b'] }, false);
      const limit = PLATFORMS[p].limits.textMax;
      if (limit) expect(a.text.length).toBeLessThanOrEqual(limit);
      expect(a.truncated).toBe(true);
    }
  });
  it('gives YouTube a title within the limit', () => {
    const a = adaptForPlatform('youtube', { headline: 'Очень длинный заголовок '.repeat(10), body: 'b' }, true);
    expect(a.title!.length).toBeLessThanOrEqual(PLATFORMS.youtube.limits.titleMax ?? 100);
  });
});

describe('captions', () => {
  it('distributes words inside the segment and keeps order', () => {
    const w = timeWords({ text: 'Привет, мир. Как дела?', startMs: 1000, durationMs: 2000 });
    expect(w).toHaveLength(4);
    expect(w[0]!.startMs).toBeGreaterThanOrEqual(1000);
    expect(w.at(-1)!.endMs).toBeLessThanOrEqual(3000);
    for (let i = 1; i < w.length; i++) expect(w[i]!.startMs).toBeGreaterThanOrEqual(w[i - 1]!.endMs - 1);
  });
  it('builds short cues and valid SRT/VTT', () => {
    const cues = buildCues([{ text: 'Продажи растут. А прибыли нет? Давайте разберёмся, куда уходит маржа по каждому артикулу.', startMs: 0, durationMs: 6000 }]);
    expect(cues.length).toBeGreaterThan(2);
    for (const c of cues) expect(c.text.length).toBeLessThanOrEqual(40);
    expect(toSrt(cues)).toMatch(/^1\n00:00:00,\d{3} --> 00:00:0\d,\d{3}\n/);
    expect(toVtt(cues).startsWith('WEBVTT\n\n')).toBe(true);
  });
});

describe('time zones', () => {
  it('converts Moscow wall-clock to UTC', () => {
    expect(zonedToUtc('2026-11-09', '10:00', 'Europe/Moscow').toISOString()).toBe('2026-11-09T07:00:00.000Z');
  });
  it('handles DST transitions (Berlin)', () => {
    expect(zonedToUtc('2026-07-01', '12:00', 'Europe/Berlin').toISOString()).toBe('2026-07-01T10:00:00.000Z');
    expect(zonedToUtc('2026-12-01', '12:00', 'Europe/Berlin').toISOString()).toBe('2026-12-01T11:00:00.000Z');
  });
  it('plans by day offset and formats back', () => {
    expect(addDays('2026-12-30', 3)).toBe('2027-01-02');
    const d = planDate('2026-11-09', 5, '19:00', 'Asia/Yekaterinburg');
    expect(formatInTz(d, 'Asia/Yekaterinburg')).toEqual({ date: '2026-11-14', time: '19:00' });
  });
});

describe('automation rule validation', () => {
  it('accepts the conservative default', () => {
    expect(validateRule(DEFAULT_RULE)).toEqual([]);
  });
  it('rejects mass generation without limits', () => {
    const bad = { ...DEFAULT_RULE, generate: { ...DEFAULT_RULE.generate, itemsPerRun: 50 }, limits: { ...DEFAULT_RULE.limits, maxRunsPerDay: 10, maxItemsPerDay: 100, pauseAfterFailures: 0 } };
    expect(validateRule(bad).length).toBeGreaterThanOrEqual(4);
  });
  it('blocks auto-scheduling many items without approval', () => {
    const r = { ...DEFAULT_RULE, approval: { required: false, approverIds: [] }, generate: { ...DEFAULT_RULE.generate, itemsPerRun: 15 } };
    expect(validateRule(r).join(' ')).toMatch(/Без согласования/);
  });
});

describe('version diff', () => {
  it('marks added and removed words', () => {
    const d = wordDiff('чистая маржа по артикулу', 'реальная маржа по каждому артикулу');
    expect(d.filter((p) => p.type === 'del').map((p) => p.text.trim())).toContain('чистая');
    expect(d.filter((p) => p.type === 'add').map((p) => p.text.trim()).join(' ')).toMatch(/реальная/);
    expect(d.filter((p) => p.type === 'same').map((p) => p.text).join('')).toMatch(/маржа по/);
  });
});
