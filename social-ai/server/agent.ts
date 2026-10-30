import type { Db } from './db.ts';
import { json, now, parse } from './db.ts';
import type { EventLog } from './log.ts';
import type { ContentRepo, Content } from './content.ts';
import { cleanHashtags } from './content.ts';
import type { SettingsStore, Format, Platform } from './settings.ts';
import type { Accounts } from './accounts.ts';
import type { Publisher } from './publisher.ts';
import { createLlm, type Llm, LlmError } from './ai/llm.ts';
import { anglesJsonSchema, anglesPrompt, contentPrompt, FALLBACK_ANGLES, generatedJsonSchema, generatedSchema, systemPrompt, type Generated } from './ai/prompts.ts';
import { validateForPlatform } from './validate.ts';
import { RULES } from './platforms.ts';
import { addDays, localDay, zonedToUtc } from './time.ts';
import type { Vault } from './crypto.ts';

export interface PlanItem {
  id: number;
  brandId: number;
  date: string;
  topic: string;
  angle: string;
  format: Format;
  status: 'planned' | 'generating' | 'generated' | 'skipped';
  contentId: number | null;
  attempts: number;
  note: string | null;
}

interface AgentState {
  consecutiveFailures: number;
  pausedReason: string | null;
  lastCycleAt: string | null;
}

const MAX_REGENERATIONS = 5;
const CYCLE_MIN_INTERVAL_MS = 60_000;

export class Agent {
  private running = false;

  private readonly db: Db;
  private readonly content: ContentRepo;
  private readonly settings: SettingsStore;
  private readonly accounts: Accounts;
  private readonly publisher: Publisher;
  private readonly vault: Vault;
  private readonly log: EventLog;
  private readonly publicBaseUrl: string | null;
  private readonly fetchImpl: typeof fetch;

  constructor(
    db: Db,
    content: ContentRepo,
    settings: SettingsStore,
    accounts: Accounts,
    publisher: Publisher,
    vault: Vault,
    log: EventLog,
    publicBaseUrl: string | null,
    fetchImpl: typeof fetch = fetch,
  ) {
    this.db = db;
    this.content = content;
    this.settings = settings;
    this.accounts = accounts;
    this.publisher = publisher;
    this.vault = vault;
    this.log = log;
    this.publicBaseUrl = publicBaseUrl;
    this.fetchImpl = fetchImpl;
  }

  state(): AgentState {
    const r = this.db.get<{ value: string }>("SELECT value FROM settings WHERE key = 'state:agent'");
    return { consecutiveFailures: 0, pausedReason: null, lastCycleAt: null, ...parse<Partial<AgentState>>(r?.value, {}) };
  }

  private setState(patch: Partial<AgentState>) {
    const next = { ...this.state(), ...patch };
    this.db.run("INSERT INTO settings (key, value, updated_at) VALUES ('state:agent', ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at", json(next), now());
  }

  llm(): Llm | null {
    const s = this.settings.get().ai;
    const keyBlob = this.settings.getSecret('ai.apiKey');
    return createLlm(s, keyBlob ? this.vault.decrypt<string>(keyBlob) : null, this.fetchImpl);
  }

  // ---------- limits ----------

  private usageToday(kind: string, tz: string): number {
    return this.db.get<{ count: number }>('SELECT count FROM usage WHERE day = ? AND kind = ?', localDay(new Date(), tz), kind)?.count ?? 0;
  }

  private bumpUsage(kind: string, tz: string) {
    this.db.run('INSERT INTO usage (day, kind, count) VALUES (?, ?, 1) ON CONFLICT(day, kind) DO UPDATE SET count = count + 1', localDay(new Date(), tz), kind);
  }

  generationsLeft(): number {
    const s = this.settings.get();
    return Math.max(0, s.agent.maxGenerationsPerDay - this.usageToday('generation', s.schedule.timezone));
  }

  // ---------- brand & topics ----------

  brandId(): number {
    const s = this.settings.get();
    if (s.agent.brandId && this.content.brand(s.agent.brandId)) return s.agent.brandId;
    const r = this.db.get<{ id: number }>('SELECT id FROM brands ORDER BY is_default DESC, id LIMIT 1');
    if (!r) throw new Error('Создайте бренд в настройках');
    return r.id;
  }

  topics(brandId: number): { name: string; description: string; weight: number }[] {
    return this.db.all<{ name: string; description: string; weight: number }>('SELECT name, description, weight FROM topics WHERE brand_id = ? AND enabled = 1 ORDER BY id', brandId);
  }

  private recentTitles(brandId: number): string[] {
    return this.db.all<{ title: string }>("SELECT title FROM content WHERE brand_id = ? AND title != '' AND is_demo = 0 ORDER BY id DESC LIMIT 30", brandId).map((r) => r.title);
  }

  private bestTitles(brandId: number): string[] {
    return this.db
      .all<{ title: string }>(
        `SELECT c.title, MAX(COALESCE(m.views,0) + 10*COALESCE(m.likes,0) + 20*COALESCE(m.shares,0)) AS score
         FROM metrics m JOIN publications p ON p.id = m.publication_id JOIN content c ON c.id = p.content_id
         WHERE c.brand_id = ? GROUP BY c.id ORDER BY score DESC LIMIT 5`, brandId,
      )
      .map((r) => r.title);
  }

  // ---------- planning ----------

  planItems(fromIso?: string): PlanItem[] {
    return this.db
      .all('SELECT * FROM plan_items WHERE date >= ? ORDER BY date', fromIso ?? new Date(Date.now() - 86400e3).toISOString())
      .map((r) => ({
        id: r.id as number, brandId: r.brand_id as number, date: r.date as string, topic: r.topic as string, angle: r.angle as string,
        format: r.format as Format, status: r.status as PlanItem['status'], contentId: (r.content_id as number) ?? null,
        attempts: r.attempts as number, note: (r.note as string) ?? null,
      }));
  }

  /** Creates missing plan slots for the next planDays days. Topic and format rotate so neighbours differ. */
  async plan(): Promise<PlanItem[]> {
    const s = this.settings.get();
    const brandId = this.brandId();
    const topics = this.topics(brandId);
    if (!topics.length) throw new Error('Не выбрано ни одной тематики');
    const tz = s.schedule.timezone;
    const today = localDay(new Date(), tz);
    const times = [...s.agent.postTimes].sort().slice(0, s.agent.postsPerDay);

    // Weighted topic sequence, continuing after the topics used most recently.
    const weighted = topics.flatMap((t) => Array(Math.max(1, Math.min(5, t.weight))).fill(t.name) as string[]);
    const recent = this.db.all<{ topic: string; format: string }>('SELECT topic, format FROM plan_items WHERE brand_id = ? ORDER BY date DESC LIMIT 12', brandId);
    let ti = recent.length ? (weighted.lastIndexOf(recent[0].topic) + 1) % weighted.length : 0;
    let fi = recent.length ? (s.agent.formats.indexOf(recent[0].format as Format) + 1) % s.agent.formats.length : 0;

    const slots: { date: string; topic: string; format: Format }[] = [];
    for (let d = 0; d < s.agent.planDays; d++) {
      const day = addDays(today, d);
      for (const t of times) {
        const at = zonedToUtc(day, t, tz);
        if (at.getTime() < Date.now() + 30 * 60e3) continue;
        const exists = this.db.get('SELECT id FROM plan_items WHERE brand_id = ? AND date = ?', brandId, at.toISOString());
        if (exists) continue;
        let topic = weighted[ti % weighted.length];
        if (slots.length && slots[slots.length - 1].topic === topic && topics.length > 1) topic = weighted[++ti % weighted.length];
        slots.push({ date: at.toISOString(), topic, format: s.agent.formats[fi % s.agent.formats.length] });
        ti++;
        fi++;
      }
    }
    if (!slots.length) return [];

    let angles: string[] = slots.map((_, i) => FALLBACK_ANGLES[(i + recent.length) % FALLBACK_ANGLES.length]);
    let llm: Llm | null = null;
    try {
      llm = this.llm();
    } catch (e) {
      this.log.warn('agent', `Модель недоступна для плана: ${(e as Error).message}`);
    }
    if (llm && this.generationsLeft() > 0) {
      try {
        const brand = this.content.brand(brandId);
        const res = (await llm.chatJson(systemPrompt(brand, s.agent), anglesPrompt(slots.map((sl, i) => ({ n: i + 1, ...sl })), this.recentTitles(brandId), this.bestTitles(brandId)), anglesJsonSchema)) as { items?: { n: number; angle: string }[] };
        this.bumpUsage('generation', tz);
        for (const it of res.items ?? []) if (it.n >= 1 && it.n <= slots.length && it.angle?.trim()) angles[it.n - 1] = it.angle.trim().slice(0, 200);
      } catch (e) {
        this.log.warn('agent', `Идеи для плана не получены от модели, использованы шаблонные: ${(e as Error).message}`);
        angles = angles.slice();
      }
    }
    const created: number[] = [];
    this.db.tx(() => {
      slots.forEach((sl, i) => created.push(this.db.insert('plan_items', { brand_id: brandId, date: sl.date, topic: sl.topic, angle: angles[i], format: sl.format, status: 'planned', created_at: now() })));
    });
    this.log.info('agent', `Контент-план дополнен: ${created.length} слотов`, { slots: slots.length });
    return this.planItems().filter((p) => created.includes(p.id));
  }

  // ---------- generation ----------

  /** Calls the model once and validates the shape. Throws on failure; counts toward the daily limit. */
  private async callModel(llm: Llm, brandId: number, topic: string, angle: string, format: Format, feedback?: string[]): Promise<Generated> {
    const s = this.settings.get();
    if (this.generationsLeft() <= 0) throw new LlmError(`Достигнут дневной лимит генераций (${s.agent.maxGenerationsPerDay})`);
    this.bumpUsage('generation', s.schedule.timezone);
    const raw = await llm.chatJson(
      systemPrompt(this.content.brand(brandId), s.agent),
      contentPrompt({ topic, angle, format, maxSlides: s.images.maxSlides, recentTitles: this.recentTitles(brandId), feedback }),
      generatedJsonSchema,
    );
    const parsed = generatedSchema.safeParse(raw);
    if (!parsed.success) throw new LlmError(`Ответ модели не соответствует формату: ${parsed.error.issues.slice(0, 3).map((i) => i.path.join('.') + ' ' + i.message).join('; ')}`);
    const g = parsed.data;
    if (format === 'carousel' && g.slides.length < 3) throw new LlmError('Модель вернула слишком мало слайдов для карусели');
    if (format === 'carousel') g.slides = g.slides.slice(0, s.images.maxSlides);
    else g.slides = [];
    return g;
  }

  private offlineDraft(topic: string, angle: string, format: Format): Generated {
    const title = `${angle} — ${topic}`;
    return {
      title,
      hook: '',
      body: 'TODO: текст не сгенерирован — языковая модель не подключена. Напишите текст вручную или подключите Ollama в настройках.',
      summary: '',
      cta: '',
      hashtags: [],
      slides: format === 'carousel'
        ? [{ title, text: '' }, { title: 'TODO: первая мысль', text: '' }, { title: 'TODO: вторая мысль', text: '' }, { title: 'Итог', text: '' }]
        : [],
    };
  }

  private applyGenerated(g: Generated, format: Format): Partial<Content> {
    const slides = format === 'carousel' ? g.slides.map((sl, i) => (i === 0 && !sl.text && g.hook ? { ...sl, text: g.hook } : sl)) : [];
    return { title: g.title.trim(), body: g.body.trim(), summary: g.summary.trim() || g.hook.trim(), cta: g.cta.trim(), hashtags: cleanHashtags(g.hashtags), slides };
  }

  private targetAccounts(brandId: number, platforms: Platform[]) {
    return this.accounts.list().filter((a) => a.brandId === brandId && platforms.includes(a.platform) && a.settings.enabled && a.status !== 'disabled');
  }

  /** Renders images and runs the platform checks for every target; stores the result on the material. */
  review(contentId: number): { errors: string[]; warnings: string[] } {
    const s = this.settings.get();
    const c = this.content.get(contentId) as Content;
    const r = this.content.renderMedia(contentId, s.images);
    const errors: string[] = r.overflow ? r.warnings : [];
    const warnings: string[] = r.overflow ? [] : r.warnings;
    const platforms: Platform[] = c.platforms.length ? c.platforms : s.agent.platforms;
    const fresh = this.content.get(contentId) as Content;
    for (const platform of platforms) {
      const res = validateForPlatform({
        content: { ...fresh, status: 'ready' }, brand: this.content.brand(c.brandId), media: r.media, mediaPath: (m) => this.content.mediaPath(m),
        platform, published: [], publicBaseUrl: this.publicBaseUrl,
      });
      const label = RULES[platform].label;
      errors.push(...res.errors.map((e) => (e.startsWith(label) ? e : `${label}: ${e}`)));
      warnings.push(...res.warnings.map((w) => (w.startsWith(label) ? w : `${label}: ${w}`)));
    }
    const review = { checkedAt: now(), errors: [...new Set(errors)], warnings: [...new Set(warnings)] };
    this.content.update(contentId, { review });
    return review;
  }

  /** Generates (or regenerates) one material. Used by the agent and by the "Повторить генерацию" button. */
  async generate(opts: { brandId: number; topic: string; angle: string; format: Format; platforms: Platform[]; planItemId?: number | null; existingId?: number; manual?: boolean }): Promise<Content> {
    let llm: Llm | null = null;
    try {
      llm = this.llm();
    } catch (e) {
      if (opts.manual) throw e;
      this.log.warn('agent', (e as Error).message);
    }
    if (opts.existingId) {
      const cur = this.content.get(opts.existingId);
      if (!cur) throw new Error('Материал не найден');
      if (cur.generationCount >= MAX_REGENERATIONS) throw new Error(`Лимит повторных генераций для материала (${MAX_REGENERATIONS}) исчерпан — отредактируйте вручную`);
      if (['scheduled', 'published', 'partial'].includes(cur.status)) throw new Error('Нельзя перегенерировать запланированный или опубликованный материал');
    }

    let g: Generated;
    let model: string | null = null;
    if (!llm) {
      g = this.offlineDraft(opts.topic, opts.angle, opts.format);
    } else {
      g = await this.callModel(llm, opts.brandId, opts.topic, opts.angle, opts.format);
      model = `${llm.id}:${llm.model}`;
    }

    let c: Content;
    if (opts.existingId) {
      const cur = this.content.get(opts.existingId) as Content;
      c = this.content.update(opts.existingId, { ...this.applyGenerated(g, opts.format), format: opts.format, model, status: 'draft', generationCount: cur.generationCount + 1 });
    } else {
      c = this.content.create({ brandId: opts.brandId, topic: opts.topic, format: opts.format, platforms: opts.platforms, source: 'agent', model, planItemId: opts.planItemId ?? null, ...this.applyGenerated(g, opts.format) });
    }

    let review = this.review(c.id);
    // One automatic fix-up round with the validator's feedback — never more, so errors cannot loop.
    if (llm && review.errors.length && this.generationsLeft() > 0) {
      try {
        const fixed = await this.callModel(llm, opts.brandId, opts.topic, opts.angle, opts.format, review.errors);
        c = this.content.update(c.id, { ...this.applyGenerated(fixed, opts.format), generationCount: (this.content.get(c.id) as Content).generationCount + 1 });
        review = this.review(c.id);
      } catch (e) {
        this.log.warn('agent', `Исправление не удалось: ${(e as Error).message}`, undefined, { contentId: c.id });
      }
    }
    this.log.info('agent', `${opts.existingId ? 'Перегенерирован' : 'Создан'} материал «${c.title}» (${opts.format}${model ? `, ${model}` : ', без модели'}) — ошибок: ${review.errors.length}`, review, { contentId: c.id });
    return this.content.get(c.id) as Content;
  }

  // ---------- cycle ----------

  /**
   * One agent cycle: extend the plan, generate due items, approve and schedule what passes checks.
   * Guarded by: single-flight lock, minimum interval, daily generation limit, per-item attempt limit,
   * and a circuit breaker that pauses the agent after repeated failures.
   */
  async cycle(force = false): Promise<{ ran: boolean; summary: string }> {
    const s = this.settings.get();
    if (!s.agent.enabled && !force) return { ran: false, summary: 'Агент выключен' };
    const st = this.state();
    if (st.pausedReason && !force) return { ran: false, summary: `Агент приостановлен: ${st.pausedReason}` };
    if (this.running) return { ran: false, summary: 'Цикл уже выполняется' };
    if (!force && st.lastCycleAt && Date.now() - Date.parse(st.lastCycleAt) < CYCLE_MIN_INTERVAL_MS) return { ran: false, summary: 'Слишком рано' };
    this.running = true;
    this.setState({ lastCycleAt: now() });
    const runId = this.db.insert('agent_runs', { kind: 'cycle', started_at: now(), status: 'running' });
    const notes: string[] = [];
    try {
      const planned = await this.plan();
      if (planned.length) notes.push(`план +${planned.length}`);

      const brandId = this.brandId();
      const horizon = new Date(Date.now() + s.agent.leadHours * 3600e3).toISOString();
      const due = this.db.all<{ id: number }>("SELECT id FROM plan_items WHERE brand_id = ? AND status = 'planned' AND date <= ? AND date > ? ORDER BY date LIMIT 2", brandId, horizon, now());
      for (const { id } of due) {
        const item = this.planItems('0').find((p) => p.id === id) as PlanItem;
        if (item.attempts >= s.agent.maxAttemptsPerItem) {
          this.db.update('plan_items', id, { status: 'skipped', note: 'Исчерпаны попытки генерации' });
          continue;
        }
        if (this.generationsLeft() <= 0) {
          notes.push('дневной лимит генераций исчерпан');
          break;
        }
        this.db.update('plan_items', id, { status: 'generating', attempts: item.attempts + 1 });
        try {
          const c = await this.generate({ brandId, topic: item.topic, angle: item.angle, format: item.format, platforms: s.agent.platforms, planItemId: id });
          this.db.update('plan_items', id, { status: 'generated', content_id: c.id, note: null });
          notes.push(`создан #${c.id}`);
          this.setState({ consecutiveFailures: 0 });
          this.autoApprove(c, item);
        } catch (e) {
          const msg = (e as Error).message;
          this.db.update('plan_items', id, { status: 'planned', note: msg });
          const fails = this.state().consecutiveFailures + 1;
          this.setState({ consecutiveFailures: fails });
          this.log.error('agent', `Генерация не удалась: ${msg}`, { planItem: id, consecutiveFailures: fails });
          if (fails >= s.agent.maxConsecutiveFailures) {
            this.setState({ pausedReason: `${fails} ошибок подряд: ${msg}` });
            this.log.error('agent', 'Агент приостановлен после серии ошибок. Исправьте причину и возобновите работу.');
            break;
          }
        }
      }
      const summary = notes.join(', ') || 'нет задач';
      this.db.update('agent_runs', runId, { finished_at: now(), status: 'ok', summary });
      return { ran: true, summary };
    } catch (e) {
      const msg = (e as Error).message;
      this.db.update('agent_runs', runId, { finished_at: now(), status: 'error', error: msg });
      this.log.error('agent', `Цикл агента завершился ошибкой: ${msg}`);
      return { ran: true, summary: msg };
    } finally {
      this.running = false;
    }
  }

  private autoApprove(c: Content, item: PlanItem) {
    const s = this.settings.get();
    const fresh = this.content.get(c.id) as Content;
    if (!s.agent.autoApprove) {
      this.log.info('agent', `«${fresh.title}» ждёт подтверждения (автоодобрение выключено)`, undefined, { contentId: c.id });
      return;
    }
    if (!fresh.model) return; // offline drafts are never auto-approved
    if (fresh.review?.errors.length) {
      this.log.warn('agent', `«${fresh.title}» не одобрен автоматически: ${fresh.review.errors.join('; ')}`, undefined, { contentId: c.id });
      return;
    }
    const targets = this.targetAccounts(fresh.brandId, fresh.platforms).filter((a) => a.settings.autoPublish && a.status === 'connected');
    this.content.update(c.id, { status: 'ready' });
    if (!targets.length) {
      this.log.warn('agent', `«${fresh.title}» готов, но нет подключённых аккаунтов с автопубликацией`, undefined, { contentId: c.id });
      return;
    }
    const at = new Date(Math.max(Date.parse(item.date), Date.now() + 60e3));
    this.publisher.schedule(c.id, targets.map((a) => a.id), at);
  }

  resume() {
    this.setState({ pausedReason: null, consecutiveFailures: 0 });
    this.log.info('agent', 'Агент возобновлён');
  }
}
