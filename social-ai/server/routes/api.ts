import fs from 'node:fs';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { Services } from '../app.ts';
import { json, now, parse } from '../db.ts';
import { FORMATS, PLATFORMS, type Platform, type SettingsPatch } from '../settings.ts';
import { INTEGRATIONS } from '../integrations/index.ts';
import { authorizeUrl, exchangeCode, pkcePair } from '../integrations/x.ts';
import { toPublication } from '../publisher.ts';
import { toBrand, type Content } from '../content.ts';
import { listModels } from '../ai/llm.ts';
import { backupPath, createBackup, listBackups } from '../backup.ts';
import { zip } from '../zip.ts';
import { randomToken } from '../crypto.ts';
import { isValidTimeZone } from '../time.ts';
import { DEMO_CONTENT } from '../demo.ts';
import { RULES } from '../platforms.ts';

const idParam = z.object({ id: z.coerce.number().int().positive() });
const slideSchema = z.object({ title: z.string().max(200), text: z.string().max(600).default('') });
const contentBody = z.object({
  topic: z.string().max(200).optional(),
  title: z.string().max(300).optional(),
  body: z.string().max(20000).optional(),
  summary: z.string().max(600).optional(),
  cta: z.string().max(500).optional(),
  hashtags: z.array(z.string().max(60)).max(30).optional(),
  format: z.enum(FORMATS).optional(),
  platforms: z.array(z.enum(PLATFORMS)).optional(),
  slides: z.array(slideSchema).max(10).optional(),
});

function bad(reply: FastifyReply, message: string, status = 400) {
  return reply.status(status).send({ error: message });
}

export function registerRoutes(app: FastifyInstance, s: Services) {
  const contentView = (c: Content) => ({
    ...c,
    media: s.content.media(c.id).map((m) => ({ ...m, url: `/api/media/${m.id}?v=${m.sha256.slice(0, 8)}` })),
    publications: s.publisher.forContent(c.id).map((p) => ({ ...p, account: s.accounts.get(p.accountId) ? { id: p.accountId, name: s.accounts.get(p.accountId)!.name, platform: s.accounts.get(p.accountId)!.platform } : null })),
  });

  // ---------------- dashboard ----------------
  app.get('/api/dashboard', async () => {
    const st = s.settings.get();
    const counts = Object.fromEntries(s.db.all<{ status: string; n: number }>('SELECT status, COUNT(*) AS n FROM content WHERE is_demo = 0 GROUP BY status').map((r) => [r.status, r.n]));
    const pubCounts = Object.fromEntries(s.db.all<{ status: string; n: number }>('SELECT status, COUNT(*) AS n FROM publications GROUP BY status').map((r) => [r.status, r.n]));
    const upcoming = s.db
      .all("SELECT p.*, c.title, c.format, c.is_demo, a.name AS account_name, a.platform FROM publications p JOIN content c ON c.id = p.content_id JOIN accounts a ON a.id = p.account_id WHERE p.status IN ('scheduled','retrying') ORDER BY COALESCE(p.next_attempt_at, p.scheduled_at) LIMIT 6")
      .map((r) => ({ ...toPublication(r), title: r.title, format: r.format, isDemo: Boolean(r.is_demo), accountName: r.account_name, platform: r.platform }));
    const errors = s.db.all("SELECT * FROM events WHERE level = 'error' ORDER BY id DESC LIMIT 6");
    const week = new Date(Date.now() - 7 * 86400e3).toISOString();
    const publishedWeek = s.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM publications WHERE status = 'published' AND published_at > ?", week)?.n ?? 0;
    const agentState = s.agent.state();
    const lastRun = s.db.get('SELECT * FROM agent_runs ORDER BY id DESC LIMIT 1');
    const metrics = s.db.get<{ views: number | null; likes: number | null; n: number }>(
      'SELECT SUM(views) AS views, SUM(likes) AS likes, COUNT(*) AS n FROM (SELECT m.* FROM metrics m WHERE m.id IN (SELECT MAX(id) FROM metrics GROUP BY publication_id))',
    );
    return {
      agent: { enabled: st.agent.enabled, paused: agentState.pausedReason, lastCycleAt: agentState.lastCycleAt, lastRun, provider: st.ai.provider, model: st.ai.model, generationsLeft: s.agent.generationsLeft() },
      scheduler: { running: s.scheduler.running, lastTickAt: s.scheduler.lastTickAt, lastTickError: s.scheduler.lastTickError },
      accounts: s.accounts.list().map((a) => ({ id: a.id, name: a.name, platform: a.platform, status: a.status, remoteName: a.remoteName, lastError: a.lastError })),
      content: counts,
      publications: pubCounts,
      publishedWeek,
      upcoming,
      errors,
      metrics: { views: metrics?.views ?? null, likes: metrics?.likes ?? null, tracked: metrics?.n ?? 0 },
      demoCount: s.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM content WHERE is_demo = 1')?.n ?? 0,
    };
  });

  // ---------------- brands & topics ----------------
  const brandBody = z.object({
    name: z.string().trim().min(1).max(80), handle: z.string().max(80).default(''), audience: z.string().max(500).default(''),
    voice: z.string().max(500).default(''), accent: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#c9f45f'),
    background: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#0b0c0d'), defaultHashtags: z.array(z.string()).max(30).default([]),
    defaultCta: z.string().max(300).default(''), bannedWords: z.array(z.string()).max(100).default([]),
  });
  app.get('/api/brands', async () => s.db.all('SELECT * FROM brands ORDER BY id').map((b) => ({ ...toBrand(b), topics: s.db.all('SELECT * FROM topics WHERE brand_id = ? ORDER BY id', b.id as number) })));
  app.post('/api/brands', async (req, reply) => {
    const b = brandBody.safeParse(req.body);
    if (!b.success) return bad(reply, 'Проверьте поля бренда (цвет — в формате #RRGGBB)');
    const id = s.db.insert('brands', {
      name: b.data.name, handle: b.data.handle, audience: b.data.audience, voice: b.data.voice, accent: b.data.accent, background: b.data.background,
      default_hashtags: json(b.data.defaultHashtags), default_cta: b.data.defaultCta, banned_words: json(b.data.bannedWords), is_default: 0, created_at: now(), updated_at: now(),
    });
    return toBrand(s.db.get('SELECT * FROM brands WHERE id = ?', id)!);
  });
  app.put('/api/brands/:id', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const b = brandBody.safeParse(req.body);
    if (!b.success) return bad(reply, 'Проверьте поля бренда (цвет — в формате #RRGGBB)');
    s.db.update('brands', id, {
      name: b.data.name, handle: b.data.handle, audience: b.data.audience, voice: b.data.voice, accent: b.data.accent, background: b.data.background,
      default_hashtags: json(b.data.defaultHashtags), default_cta: b.data.defaultCta, banned_words: json(b.data.bannedWords), updated_at: now(),
    });
    return toBrand(s.db.get('SELECT * FROM brands WHERE id = ?', id)!);
  });
  app.delete('/api/brands/:id', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    if ((s.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM brands')?.n ?? 0) <= 1) return bad(reply, 'Нельзя удалить последний бренд');
    s.db.run('DELETE FROM brands WHERE id = ?', id);
    return { ok: true };
  });
  const topicBody = z.object({ brandId: z.number().int(), name: z.string().trim().min(2).max(100), description: z.string().max(400).default(''), enabled: z.boolean().default(true), weight: z.number().int().min(1).max(5).default(1) });
  app.post('/api/topics', async (req, reply) => {
    const t = topicBody.safeParse(req.body);
    if (!t.success) return bad(reply, 'Название тематики — от 2 символов');
    const id = s.db.insert('topics', { brand_id: t.data.brandId, name: t.data.name, description: t.data.description, enabled: t.data.enabled ? 1 : 0, weight: t.data.weight, created_at: now() });
    return s.db.get('SELECT * FROM topics WHERE id = ?', id);
  });
  app.put('/api/topics/:id', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const t = topicBody.partial().safeParse(req.body);
    if (!t.success) return bad(reply, 'Неверные данные тематики');
    const v: Record<string, string | number> = {};
    if (t.data.name !== undefined) v.name = t.data.name;
    if (t.data.description !== undefined) v.description = t.data.description;
    if (t.data.enabled !== undefined) v.enabled = t.data.enabled ? 1 : 0;
    if (t.data.weight !== undefined) v.weight = t.data.weight;
    s.db.update('topics', id, v);
    return s.db.get('SELECT * FROM topics WHERE id = ?', id);
  });
  app.delete('/api/topics/:id', async (req) => {
    const { id } = idParam.parse(req.params);
    s.db.run('DELETE FROM topics WHERE id = ?', id);
    return { ok: true };
  });

  // ---------------- integrations & accounts ----------------
  app.get('/api/integrations', async () =>
    Object.values(INTEGRATIONS).map((i) => ({
      platform: i.platform, label: i.label, requirements: i.requirements, cost: i.cost, credentialFields: i.credentialFields,
      configFields: i.configFields, oauth: i.oauth, metricsNote: i.metricsNote, rules: RULES[i.platform],
    })),
  );
  app.get('/api/accounts', async () => s.accounts.list().map((a) => s.accounts.view(a)));
  const accountBody = z.object({
    brandId: z.number().int().optional(), platform: z.enum(PLATFORMS), name: z.string().trim().min(1).max(80),
    credentials: z.record(z.string(), z.string().max(4000)).default({}), config: z.record(z.string(), z.string().max(500)).default({}),
    settings: z.object({ enabled: z.boolean(), autoPublish: z.boolean(), maxPerDay: z.number().int().min(1).max(50), useHashtags: z.boolean() }).partial().optional(),
  });
  app.post('/api/accounts', async (req, reply) => {
    const b = accountBody.safeParse(req.body);
    if (!b.success) return bad(reply, 'Заполните название и обязательные поля');
    const integ = INTEGRATIONS[b.data.platform];
    const missing = [
      ...integ.credentialFields.filter((f) => f.required && !b.data.credentials[f.key]?.trim()),
      ...integ.configFields.filter((f) => f.required && !b.data.config[f.key]?.trim()),
    ];
    if (missing.length) return bad(reply, `Поле «${missing[0].label}» обязательно`);
    const a = s.accounts.create({ ...b.data, brandId: b.data.brandId ?? s.agent.brandId() });
    if (!integ.oauth) await s.accounts.check(a.id);
    return s.accounts.view(s.accounts.get(a.id)!);
  });
  app.put('/api/accounts/:id', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const b = accountBody.partial().safeParse(req.body);
    if (!b.success) return bad(reply, 'Неверные данные аккаунта');
    const a = s.accounts.update(id, { name: b.data.name, credentials: b.data.credentials, config: b.data.config, settings: b.data.settings });
    if (b.data.credentials && Object.values(b.data.credentials).some(Boolean) && !INTEGRATIONS[a.platform].oauth) await s.accounts.check(id);
    if (b.data.settings?.enabled === true && a.status === 'disabled') s.accounts.setStatus(id, 'pending', null);
    return s.accounts.view(s.accounts.get(id)!);
  });
  app.post('/api/accounts/:id/check', async (req) => {
    const { id } = idParam.parse(req.params);
    const r = await s.accounts.check(id);
    return { ...r, account: s.accounts.view(s.accounts.get(id)!) };
  });
  app.post('/api/accounts/:id/disconnect', async (req) => {
    const { id } = idParam.parse(req.params);
    s.accounts.disconnect(id);
    return s.accounts.view(s.accounts.get(id)!);
  });
  app.delete('/api/accounts/:id', async (req) => {
    const { id } = idParam.parse(req.params);
    s.accounts.remove(id);
    return { ok: true };
  });

  // X OAuth 2.0 (PKCE). The redirect URI must be registered in the X developer portal.
  const xRedirect = (host: string | undefined) => `${s.cfg.publicBaseUrl ?? `http://${host ?? `127.0.0.1:${s.cfg.port}`}`}/api/oauth/x/callback`;
  app.get('/api/accounts/:id/oauth/start', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const a = s.accounts.get(id);
    if (!a || a.platform !== 'x') return bad(reply, 'OAuth доступен только для X');
    const creds = s.accounts.credentials(id) ?? {};
    if (!creds.clientId) return bad(reply, 'Сначала укажите Client ID');
    const { verifier, challenge } = pkcePair();
    const state = randomToken(18);
    s.db.insert('oauth_states', { state, account_id: id, verifier: s.vault.encrypt(verifier), created_at: now() });
    return { url: authorizeUrl(creds.clientId, xRedirect(req.headers.host), state, challenge), redirectUri: xRedirect(req.headers.host) };
  });
  app.get('/api/oauth/x/callback', async (req, reply) => {
    const q = z.object({ state: z.string(), code: z.string().optional(), error: z.string().optional() }).safeParse(req.query);
    if (!q.success) return reply.redirect('/accounts?oauth=error');
    const row = s.db.get<{ account_id: number; verifier: string; created_at: string }>('SELECT * FROM oauth_states WHERE state = ?', q.data.state);
    s.db.run('DELETE FROM oauth_states WHERE state = ?', q.data.state);
    if (!row || Date.now() - Date.parse(row.created_at) > 15 * 60e3 || !q.data.code) {
      s.log.warn('accounts', `Авторизация X не завершена: ${q.data.error ?? 'истёк или неверный state'}`);
      return reply.redirect('/accounts?oauth=error');
    }
    const a = s.accounts.get(row.account_id)!;
    try {
      const ctx = s.accounts.ctx(a);
      const creds = await exchangeCode(ctx, q.data.code, s.vault.decrypt<string>(row.verifier)!, xRedirect(req.headers.host));
      s.accounts.saveCredentials(a.id, creds as unknown as Record<string, string>);
      await s.accounts.check(a.id);
      return reply.redirect('/accounts?oauth=ok');
    } catch (e) {
      s.accounts.setStatus(a.id, 'needs_auth', (e as Error).message);
      s.log.error('accounts', `Обмен кода X не удался: ${(e as Error).message}`, undefined, { accountId: a.id });
      return reply.redirect('/accounts?oauth=error');
    }
  });

  // ---------------- content ----------------
  app.get('/api/content', async (req) => {
    const q = z.object({ status: z.string().optional(), q: z.string().optional(), archived: z.string().optional() }).parse(req.query);
    const where: string[] = [];
    const params: string[] = [];
    if (q.status) {
      where.push('status = ?');
      params.push(q.status);
    } else if (q.archived !== '1') where.push("status != 'archived'");
    if (q.q) {
      where.push('(title LIKE ? OR body LIKE ? OR topic LIKE ?)');
      params.push(`%${q.q}%`, `%${q.q}%`, `%${q.q}%`);
    }
    const rows = s.db.all(`SELECT * FROM content ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY updated_at DESC LIMIT 300`, ...params);
    return rows.map((r) => {
      const c = s.content.get(r.id as number)!;
      const first = s.content.media(c.id)[0];
      const pubs = s.publisher.forContent(c.id);
      return { ...c, body: c.body.slice(0, 280), thumb: first ? `/api/media/${first.id}?v=${first.sha256.slice(0, 8)}` : null, slideCount: c.slides.length, publications: pubs.map((p) => ({ id: p.id, status: p.status, accountId: p.accountId, scheduledAt: p.scheduledAt })) };
    });
  });

  app.post('/api/content', async (req, reply) => {
    const b = contentBody.safeParse(req.body);
    if (!b.success) return bad(reply, 'Проверьте поля материала');
    const c = s.content.create({ brandId: s.agent.brandId(), ...b.data });
    s.agent.review(c.id);
    s.log.info('content', `Создан материал «${c.title || 'без названия'}»`, undefined, { contentId: c.id });
    return contentView(s.content.get(c.id)!);
  });

  app.post('/api/content/generate', async (req, reply) => {
    const b = z.object({ topic: z.string().min(2).max(200), angle: z.string().max(300).default(''), format: z.enum(FORMATS), platforms: z.array(z.enum(PLATFORMS)).default([]) }).safeParse(req.body);
    if (!b.success) return bad(reply, 'Укажите тематику и формат');
    try {
      const c = await s.agent.generate({ brandId: s.agent.brandId(), ...b.data, platforms: b.data.platforms.length ? b.data.platforms : s.settings.get().agent.platforms, manual: true });
      return contentView(c);
    } catch (e) {
      return bad(reply, (e as Error).message, 422);
    }
  });

  app.get('/api/content/:id', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const c = s.content.get(id);
    if (!c) return bad(reply, 'Материал не найден', 404);
    return contentView(c);
  });

  app.put('/api/content/:id', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const c = s.content.get(id);
    if (!c) return bad(reply, 'Материал не найден', 404);
    if (['published', 'partial'].includes(c.status)) return bad(reply, 'Опубликованный материал нельзя менять — создайте копию');
    if (s.publisher.forContent(id).some((p) => p.status === 'publishing')) return bad(reply, 'Материал публикуется прямо сейчас');
    const b = contentBody.safeParse(req.body);
    if (!b.success) return bad(reply, 'Проверьте поля материала');
    // Edits send an approved material back to draft so it is re-checked before going out.
    const status = c.status === 'scheduled' || c.status === 'ready' ? 'draft' : c.status;
    s.content.update(id, { ...b.data, status });
    if (status === 'draft') for (const p of s.publisher.forContent(id)) if (['scheduled', 'retrying'].includes(p.status)) s.publisher.cancel(p.id);
    s.agent.review(id);
    return contentView(s.content.get(id)!);
  });

  app.post('/api/content/:id/duplicate', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const c = s.content.get(id);
    if (!c) return bad(reply, 'Материал не найден', 404);
    const copy = s.content.create({ brandId: c.brandId, topic: c.topic, title: `${c.title} (копия)`, body: c.body, summary: c.summary, cta: c.cta, hashtags: c.hashtags, format: c.format, platforms: c.platforms, slides: c.slides });
    s.agent.review(copy.id);
    return contentView(s.content.get(copy.id)!);
  });

  app.post('/api/content/:id/render', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    if (!s.content.get(id)) return bad(reply, 'Материал не найден', 404);
    s.agent.review(id);
    return contentView(s.content.get(id)!);
  });

  app.post('/api/content/:id/regenerate', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const c = s.content.get(id);
    if (!c) return bad(reply, 'Материал не найден', 404);
    const b = z.object({ angle: z.string().max(300).optional(), format: z.enum(FORMATS).optional() }).parse(req.body ?? {});
    try {
      const out = await s.agent.generate({ brandId: c.brandId, topic: c.topic || 'ИИ и автоматизация', angle: b.angle ?? c.title, format: b.format ?? c.format, platforms: c.platforms, existingId: id, manual: true });
      return contentView(out);
    } catch (e) {
      return bad(reply, (e as Error).message, 422);
    }
  });

  app.post('/api/content/:id/approve', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const c = s.content.get(id);
    if (!c) return bad(reply, 'Материал не найден', 404);
    if (c.status !== 'draft' && c.status !== 'failed') return bad(reply, 'Материал уже подтверждён');
    const review = s.agent.review(id);
    if (review.errors.length) return reply.status(422).send({ error: 'Проверка не пройдена', review });
    s.content.update(id, { status: 'ready' });
    s.log.info('content', `Материал «${c.title}» подтверждён`, undefined, { contentId: id });
    return contentView(s.content.get(id)!);
  });

  app.post('/api/content/:id/unapprove', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const c = s.content.get(id);
    if (!c || c.status !== 'ready') return bad(reply, 'Вернуть в черновики можно только готовый материал');
    s.content.update(id, { status: 'draft' });
    return contentView(s.content.get(id)!);
  });

  const targetBody = z.object({ accountIds: z.array(z.number().int()).min(1), at: z.string().datetime({ offset: true }).optional() });
  app.post('/api/content/:id/schedule', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const b = targetBody.safeParse(req.body);
    if (!b.success || !b.data.at) return bad(reply, 'Выберите аккаунты и время');
    const at = new Date(b.data.at);
    if (at.getTime() < Date.now() - 60e3) return bad(reply, 'Время публикации уже прошло');
    try {
      s.publisher.schedule(id, b.data.accountIds, at);
    } catch (e) {
      return bad(reply, (e as Error).message, 409);
    }
    return contentView(s.content.get(id)!);
  });

  app.post('/api/content/:id/publish-now', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const b = targetBody.safeParse(req.body);
    if (!b.success) return bad(reply, 'Выберите аккаунты');
    let pubs;
    try {
      pubs = s.publisher.schedule(id, b.data.accountIds, new Date());
    } catch (e) {
      return bad(reply, (e as Error).message, 409);
    }
    const results = [];
    for (const p of pubs) results.push(await s.publisher.publishOne(p.id));
    return { results, content: contentView(s.content.get(id)!) };
  });

  app.post('/api/content/:id/archive', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const c = s.content.get(id);
    if (!c) return bad(reply, 'Материал не найден', 404);
    for (const p of s.publisher.forContent(id)) if (['scheduled', 'retrying'].includes(p.status)) s.publisher.cancel(p.id);
    s.content.update(id, { status: 'archived' });
    s.db.update('content', id, { archived_at: now() });
    return contentView(s.content.get(id)!);
  });
  app.post('/api/content/:id/restore', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const c = s.content.get(id);
    if (!c || c.status !== 'archived') return bad(reply, 'Материал не в архиве');
    const published = s.publisher.forContent(id).some((p) => p.status === 'published');
    s.content.update(id, { status: published ? 'published' : 'draft' });
    s.db.update('content', id, { archived_at: null });
    return contentView(s.content.get(id)!);
  });
  app.delete('/api/content/:id', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const c = s.content.get(id);
    if (!c) return bad(reply, 'Материал не найден', 404);
    if (s.publisher.forContent(id).some((p) => p.status === 'publishing')) return bad(reply, 'Материал публикуется прямо сейчас');
    for (const m of s.content.media(id)) fs.rmSync(s.content.mediaPath(m), { force: true });
    s.db.run('DELETE FROM content WHERE id = ?', id);
    s.db.run("UPDATE plan_items SET status = 'skipped', note = 'Материал удалён' WHERE content_id = ?", id);
    s.log.warn('content', `Материал «${c.title}» удалён`);
    return { ok: true };
  });

  app.get('/api/content/:id/export.zip', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const media = s.content.media(id);
    if (!media.length) return bad(reply, 'Нет изображений', 404);
    const data = zip(media.map((m) => ({ name: `slide-${String(m.idx + 1).padStart(2, '0')}.jpg`, data: fs.readFileSync(s.content.mediaPath(m)) })));
    reply.header('Content-Disposition', `attachment; filename="noro-${id}.zip"`).type('application/zip');
    return reply.send(data);
  });

  app.get('/api/media/:id', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const row = s.db.get<{ content_id: number }>('SELECT content_id FROM media WHERE id = ?', id);
    const m = row ? s.content.media(row.content_id).find((x) => x.id === id) : null;
    if (!m) return bad(reply, 'Файл не найден', 404);
    reply.header('Cache-Control', 'private, max-age=31536000, immutable').type(m.mime);
    return reply.send(fs.createReadStream(s.content.mediaPath(m)));
  });

  // Public, signed media links: Instagram downloads images from here.
  app.get('/m/:id/:file', async (req, reply) => {
    const p = z.object({ id: z.coerce.number().int(), file: z.string().regex(/^[A-Za-z0-9_-]{16,64}\.jpg$/) }).safeParse(req.params);
    if (!p.success) return reply.status(404).send('Not found');
    const m = s.publisher.verifyMediaSignature(p.data.id, p.data.file.replace(/\.jpg$/, ''));
    if (!m) return reply.status(404).send('Not found');
    reply.header('Cache-Control', 'public, max-age=86400').type(m.mime);
    return reply.send(fs.createReadStream(s.content.mediaPath(m)));
  });

  // ---------------- calendar & publications ----------------
  app.get('/api/calendar', async (req) => {
    const q = z.object({ from: z.string(), to: z.string() }).parse(req.query);
    const pubs = s.db
      .all(
        `SELECT p.*, c.title, c.format, c.is_demo, c.status AS content_status, a.name AS account_name, a.platform FROM publications p
         JOIN content c ON c.id = p.content_id JOIN accounts a ON a.id = p.account_id
         WHERE COALESCE(p.published_at, p.scheduled_at) BETWEEN ? AND ? AND p.status != 'cancelled' ORDER BY p.scheduled_at`, q.from, q.to,
      )
      .map((r) => ({ ...toPublication(r), title: r.title, format: r.format, isDemo: Boolean(r.is_demo), accountName: r.account_name, platform: r.platform }));
    const plan = s.agent.planItems(q.from).filter((p) => p.date <= q.to && p.status !== 'generated');
    return { publications: pubs, plan };
  });
  app.put('/api/publications/:id', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const b = z.object({ at: z.string().datetime({ offset: true }) }).safeParse(req.body);
    if (!b.success) return bad(reply, 'Укажите новое время');
    const at = new Date(b.data.at);
    if (at.getTime() < Date.now() - 60e3) return bad(reply, 'Нельзя перенести в прошлое');
    try {
      return s.publisher.reschedule(id, at);
    } catch (e) {
      return bad(reply, (e as Error).message, 409);
    }
  });
  app.post('/api/publications/:id/cancel', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    try {
      s.publisher.cancel(id);
      return s.publisher.get(id);
    } catch (e) {
      return bad(reply, (e as Error).message, 409);
    }
  });
  app.post('/api/publications/:id/retry', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const p = s.publisher.get(id);
    if (!p || !['failed', 'blocked'].includes(p.status)) return bad(reply, 'Повторить можно только неудачную публикацию');
    s.publisher.reschedule(id, new Date());
    return s.publisher.publishOne(id);
  });
  app.post('/api/publications/:id/resolve', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const b = z.object({ published: z.boolean(), url: z.string().url().optional() }).safeParse(req.body);
    if (!b.success) return bad(reply, 'Укажите результат проверки');
    try {
      s.publisher.resolveCheck(id, b.data.published, b.data.url);
      return s.publisher.get(id);
    } catch (e) {
      return bad(reply, (e as Error).message, 409);
    }
  });

  // ---------------- agent ----------------
  app.get('/api/agent', async () => {
    const st = s.settings.get();
    return {
      settings: st.agent,
      state: s.agent.state(),
      generationsLeft: s.agent.generationsLeft(),
      plan: s.agent.planItems(new Date(Date.now() - 2 * 86400e3).toISOString()),
      runs: s.db.all('SELECT * FROM agent_runs ORDER BY id DESC LIMIT 30'),
      history: s.db.all("SELECT * FROM events WHERE scope IN ('agent','publisher','scheduler','content') ORDER BY id DESC LIMIT 100"),
      ai: { provider: st.ai.provider, model: st.ai.model },
    };
  });
  app.put('/api/agent', async (req, reply) => {
    try {
      const next = s.settings.update({ agent: req.body as SettingsPatch['agent'] });
      s.log.info('agent', next.agent.enabled ? 'Настройки агента сохранены (агент включён)' : 'Настройки агента сохранены (агент выключен)');
      return next.agent;
    } catch (e) {
      return bad(reply, `Неверные настройки агента: ${(e as Error).message.slice(0, 300)}`);
    }
  });
  app.post('/api/agent/run', async () => s.agent.cycle(true));
  app.post('/api/agent/plan', async (_req, reply) => {
    try {
      return { created: (await s.agent.plan()).length };
    } catch (e) {
      return bad(reply, (e as Error).message);
    }
  });
  app.post('/api/agent/resume', async () => {
    s.agent.resume();
    return s.agent.state();
  });
  app.put('/api/plan/:id', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const b = z.object({ topic: z.string().min(2).max(200).optional(), angle: z.string().max(300).optional(), format: z.enum(FORMATS).optional(), date: z.string().datetime({ offset: true }).optional() }).safeParse(req.body);
    if (!b.success) return bad(reply, 'Неверные данные слота');
    const v: Record<string, string> = {};
    if (b.data.topic) v.topic = b.data.topic;
    if (b.data.angle !== undefined) v.angle = b.data.angle;
    if (b.data.format) v.format = b.data.format;
    if (b.data.date) v.date = new Date(b.data.date).toISOString();
    s.db.update('plan_items', id, v);
    return { ok: true };
  });
  app.delete('/api/plan/:id', async (req) => {
    const { id } = idParam.parse(req.params);
    s.db.update('plan_items', id, { status: 'skipped', note: 'Пропущено вручную' });
    return { ok: true };
  });

  // ---------------- analytics ----------------
  app.get('/api/analytics', async () => {
    const rows = s.db.all(
      `SELECT p.id, p.published_at, p.external_url, a.platform, a.name AS account_name, c.title, c.format, c.topic,
              m.views, m.reach, m.likes, m.comments, m.shares, m.saves, m.fetched_at
       FROM publications p JOIN accounts a ON a.id = p.account_id JOIN content c ON c.id = p.content_id
       LEFT JOIN metrics m ON m.id = (SELECT MAX(id) FROM metrics WHERE publication_id = p.id)
       WHERE p.status = 'published' ORDER BY p.published_at DESC LIMIT 500`,
    );
    const byPlatform: Record<string, { published: number; withMetrics: number; views: number; likes: number; comments: number; shares: number }> = {};
    for (const r of rows) {
      const k = r.platform as string;
      byPlatform[k] ??= { published: 0, withMetrics: 0, views: 0, likes: 0, comments: 0, shares: 0 };
      const b = byPlatform[k];
      b.published++;
      if (r.fetched_at) {
        b.withMetrics++;
        b.views += (r.views as number) ?? 0;
        b.likes += (r.likes as number) ?? 0;
        b.comments += (r.comments as number) ?? 0;
        b.shares += (r.shares as number) ?? 0;
      }
    }
    const notes = Object.fromEntries(Object.values(INTEGRATIONS).map((i) => [i.platform, i.metricsNote]));
    return { rows, byPlatform, notes };
  });
  app.post('/api/analytics/refresh', async () => ({ updated: await s.publisher.collectMetrics() }));

  // ---------------- events ----------------
  app.get('/api/events', async (req) => {
    const q = z.object({ level: z.string().optional(), scope: z.string().optional(), limit: z.coerce.number().int().min(1).max(500).default(200) }).parse(req.query);
    const where: string[] = [];
    const params: (string | number)[] = [];
    if (q.level) {
      where.push('level = ?');
      params.push(q.level);
    }
    if (q.scope) {
      where.push('scope = ?');
      params.push(q.scope);
    }
    return s.db.all(`SELECT * FROM events ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY id DESC LIMIT ?`, ...params, q.limit).map((e) => ({ ...e, data: parse(e.data, null) }));
  });

  // ---------------- settings ----------------
  app.get('/api/settings', async () => ({
    settings: s.settings.get(),
    aiKeySet: Boolean(s.settings.getSecret('ai.apiKey')),
    publicBaseUrl: s.cfg.publicBaseUrl,
    dataDir: s.cfg.dataDir,
    masterKeyFromEnv: Boolean(s.cfg.masterKey),
    backups: listBackups(s.cfg.backupDir),
  }));
  app.put('/api/settings', async (req, reply) => {
    const patch = req.body as SettingsPatch;
    if (patch.schedule?.timezone && !isValidTimeZone(patch.schedule.timezone)) return bad(reply, 'Неизвестный часовой пояс');
    try {
      const next = s.settings.update(patch);
      s.log.info('settings', 'Настройки сохранены', { sections: Object.keys(patch ?? {}) });
      return next;
    } catch (e) {
      return bad(reply, `Неверные настройки: ${(e as Error).message.slice(0, 300)}`);
    }
  });
  app.put('/api/settings/ai-key', async (req) => {
    const b = z.object({ key: z.string().max(500).nullable() }).parse(req.body);
    s.settings.setSecret('ai.apiKey', b.key ? s.vault.encrypt(b.key) : null);
    return { ok: true };
  });
  app.get('/api/settings/ai/models', async (_req, reply) => {
    const key = s.settings.getSecret('ai.apiKey');
    try {
      return { models: await listModels(s.settings.get().ai, key ? s.vault.decrypt<string>(key) : null) };
    } catch (e) {
      return bad(reply, (e as Error).message, 502);
    }
  });
  app.post('/api/settings/ai/test', async (_req, reply) => {
    try {
      const llm = s.agent.llm();
      if (!llm) return { ok: false, message: 'Модель не выбрана — работает офлайн-режим черновиков' };
      const started = Date.now();
      const r = (await llm.chatJson('Отвечай только JSON.', 'Верни {"ok": true, "word": "привет"}', { type: 'object', properties: { ok: { type: 'boolean' }, word: { type: 'string' } }, required: ['ok'] })) as { ok?: boolean };
      return { ok: r.ok === true, message: `Модель ответила за ${((Date.now() - started) / 1000).toFixed(1)} с` };
    } catch (e) {
      return bad(reply, (e as Error).message, 502);
    }
  });

  // ---------------- backups ----------------
  app.get('/api/backups', async () => listBackups(s.cfg.backupDir));
  app.post('/api/backups', async () => createBackup(s.db, s.cfg.backupDir, s.log, s.settings.get().backup.keep));
  app.get('/api/backups/:name', async (req, reply) => {
    const { name } = z.object({ name: z.string() }).parse(req.params);
    const p = backupPath(s.cfg.backupDir, name);
    if (!p) return bad(reply, 'Копия не найдена', 404);
    reply.header('Content-Disposition', `attachment; filename="${name}"`).type('application/octet-stream');
    return reply.send(fs.createReadStream(p));
  });

  // ---------------- demo data (always flagged) ----------------
  app.post('/api/demo', async () => {
    const brandId = s.agent.brandId();
    let n = 0;
    for (const d of DEMO_CONTENT) {
      const c = s.content.create({ brandId, ...d, isDemo: true, source: 'manual' });
      s.agent.review(c.id);
      n++;
    }
    s.log.info('content', `Загружены демонстрационные материалы: ${n}`);
    return { created: n };
  });
  app.delete('/api/demo', async () => {
    const ids = s.db.all<{ id: number }>('SELECT id FROM content WHERE is_demo = 1').map((r) => r.id);
    for (const id of ids) {
      for (const m of s.content.media(id)) fs.rmSync(s.content.mediaPath(m), { force: true });
      s.db.run('DELETE FROM content WHERE id = ?', id);
    }
    return { deleted: ids.length };
  });

  app.get('/api/platforms', async () => PLATFORMS.map((p: Platform) => ({ platform: p, label: RULES[p].label })));
}
