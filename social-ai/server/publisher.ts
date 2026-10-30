import type { Db, Row } from './db.ts';
import { now } from './db.ts';
import type { EventLog } from './log.ts';
import type { Accounts } from './accounts.ts';
import { statusForError } from './accounts.ts';
import type { ContentRepo, Media } from './content.ts';
import type { SettingsStore } from './settings.ts';
import type { Vault } from './crypto.ts';
import type { AppConfig } from './config.ts';
import { INTEGRATIONS } from './integrations/index.ts';
import { IntegrationError } from './integrations/types.ts';
import { compose, RULES } from './platforms.ts';
import { validateForPlatform } from './validate.ts';
import { localDay } from './time.ts';

export type PublicationStatus = 'scheduled' | 'publishing' | 'retrying' | 'published' | 'failed' | 'blocked' | 'needs_check' | 'cancelled';

export interface Publication {
  id: number;
  contentId: number;
  accountId: number;
  scheduledAt: string;
  status: PublicationStatus;
  attempts: number;
  nextAttemptAt: string | null;
  externalId: string | null;
  externalUrl: string | null;
  lastError: string | null;
  publishedAt: string | null;
}

export function toPublication(r: Row): Publication {
  return {
    id: r.id as number, contentId: r.content_id as number, accountId: r.account_id as number,
    scheduledAt: r.scheduled_at as string, status: r.status as PublicationStatus, attempts: r.attempts as number,
    nextAttemptAt: (r.next_attempt_at as string) ?? null, externalId: (r.external_id as string) ?? null,
    externalUrl: (r.external_url as string) ?? null, lastError: (r.last_error as string) ?? null, publishedAt: (r.published_at as string) ?? null,
  };
}

const BACKOFF_SEC = [60, 300, 900, 3600, 3 * 3600, 6 * 3600, 12 * 3600];
const LOCK_MS = 10 * 60 * 1000;

export class Publisher {
  private readonly db: Db;
  private readonly content: ContentRepo;
  private readonly accounts: Accounts;
  private readonly settings: SettingsStore;
  private readonly vault: Vault;
  private readonly log: EventLog;
  private readonly cfg: AppConfig;

  constructor(
    db: Db,
    content: ContentRepo,
    accounts: Accounts,
    settings: SettingsStore,
    vault: Vault,
    log: EventLog,
    cfg: AppConfig,
  ) {
    this.db = db;
    this.content = content;
    this.accounts = accounts;
    this.settings = settings;
    this.vault = vault;
    this.log = log;
    this.cfg = cfg;
  }

  get(id: number): Publication | null {
    const r = this.db.get('SELECT * FROM publications WHERE id = ?', id);
    return r ? toPublication(r) : null;
  }

  forContent(contentId: number): Publication[] {
    return this.db.all('SELECT * FROM publications WHERE content_id = ? ORDER BY id', contentId).map(toPublication);
  }

  publicMediaUrl(m: Media): string | null {
    if (!this.cfg.publicBaseUrl) return null;
    return `${this.cfg.publicBaseUrl}/m/${m.id}/${this.vault.sign(`media:${m.id}:${m.sha256}`)}.jpg`;
  }

  verifyMediaSignature(id: number, sig: string): Media | null {
    const m = this.content.media(this.db.get<{ content_id: number }>('SELECT content_id FROM media WHERE id = ?', id)?.content_id ?? -1).find((x) => x.id === id);
    if (!m) return null;
    return this.vault.sign(`media:${m.id}:${m.sha256}`) === sig ? m : null;
  }

  /**
   * Schedules a material to accounts. Re-scheduling an already published pair is refused —
   * that is the main guard against double posting.
   */
  schedule(contentId: number, accountIds: number[], at: Date): Publication[] {
    const c = this.content.get(contentId);
    if (!c) throw new Error('Материал не найден');
    if (c.status === 'draft' || c.status === 'archived') throw new Error('Сначала подтвердите материал (статус «Готов»)');
    if (!accountIds.length) throw new Error('Выберите хотя бы один аккаунт');
    const out: Publication[] = [];
    this.db.tx(() => {
      for (const accountId of accountIds) {
        const acc = this.accounts.get(accountId);
        if (!acc) throw new Error(`Аккаунт #${accountId} не найден`);
        const existing = this.db.get('SELECT * FROM publications WHERE content_id = ? AND account_id = ?', contentId, accountId);
        if (existing) {
          const p = toPublication(existing);
          if (p.status === 'published') throw new Error(`Уже опубликовано в «${acc.name}» — повторная публикация запрещена`);
          if (p.status === 'publishing') throw new Error(`Публикация в «${acc.name}» выполняется прямо сейчас`);
          if (p.status === 'needs_check') throw new Error(`Публикация в «${acc.name}» требует ручной проверки: возможно, пост уже вышел`);
          this.db.update('publications', p.id, { scheduled_at: at.toISOString(), status: 'scheduled', attempts: 0, next_attempt_at: null, last_error: null, updated_at: now() });
          out.push(this.get(p.id) as Publication);
        } else {
          const id = this.db.insert('publications', { content_id: contentId, account_id: accountId, scheduled_at: at.toISOString(), status: 'scheduled', created_at: now(), updated_at: now() });
          out.push(this.get(id) as Publication);
        }
      }
      if (c.status === 'ready' || c.status === 'failed') this.content.update(contentId, { status: 'scheduled' });
    });
    this.log.info('scheduler', `Запланировано: «${c.title}» на ${at.toISOString()}`, { accounts: accountIds }, { contentId });
    return out;
  }

  reschedule(id: number, at: Date): Publication {
    const p = this.get(id);
    if (!p) throw new Error('Публикация не найдена');
    if (!['scheduled', 'retrying', 'failed', 'blocked', 'cancelled'].includes(p.status)) throw new Error('Эту публикацию нельзя перенести');
    this.db.update('publications', id, { scheduled_at: at.toISOString(), status: 'scheduled', next_attempt_at: null, attempts: 0, updated_at: now() });
    this.refreshContentStatus(p.contentId);
    this.log.info('scheduler', `Публикация #${id} перенесена на ${at.toISOString()}`, undefined, { contentId: p.contentId, publicationId: id });
    return this.get(id) as Publication;
  }

  cancel(id: number) {
    const p = this.get(id);
    if (!p) throw new Error('Публикация не найдена');
    if (['published', 'publishing'].includes(p.status)) throw new Error('Опубликованное или публикуемое отменить нельзя');
    this.db.update('publications', id, { status: 'cancelled', updated_at: now() });
    this.refreshContentStatus(p.contentId);
  }

  /** Manual resolution of an ambiguous attempt after the user looked at the channel. */
  resolveCheck(id: number, published: boolean, url?: string) {
    const p = this.get(id);
    if (!p || p.status !== 'needs_check') throw new Error('Публикация не требует проверки');
    if (published) this.db.update('publications', id, { status: 'published', external_url: url ?? null, published_at: now(), last_error: null, updated_at: now() });
    else this.db.update('publications', id, { status: 'failed', updated_at: now() });
    this.refreshContentStatus(p.contentId);
    this.log.info('publisher', `Публикация #${id} отмечена вручную как ${published ? 'вышедшая' : 'не вышедшая'}`, undefined, { publicationId: id });
  }

  refreshContentStatus(contentId: number) {
    const c = this.content.get(contentId);
    if (!c || c.status === 'archived' || c.status === 'draft') return;
    const pubs = this.forContent(contentId).filter((p) => p.status !== 'cancelled');
    if (!pubs.length) {
      if (c.status !== 'ready') this.content.update(contentId, { status: 'ready' });
      return;
    }
    const published = pubs.filter((p) => p.status === 'published').length;
    const bad = pubs.filter((p) => ['failed', 'blocked', 'needs_check'].includes(p.status)).length;
    const pending = pubs.length - published - bad;
    let status: typeof c.status = 'scheduled';
    if (published === pubs.length) status = 'published';
    else if (published > 0 && pending === 0) status = 'partial';
    else if (bad === pubs.length) status = 'failed';
    else if (published > 0) status = 'partial';
    if (status !== c.status) this.content.update(contentId, { status });
  }

  /** After a crash, anything left in "publishing" is resolved here so it is never silently posted twice. */
  recoverStale() {
    const stale = this.db.all("SELECT p.*, a.platform FROM publications p JOIN accounts a ON a.id = p.account_id WHERE p.status = 'publishing' AND (p.locked_until IS NULL OR p.locked_until < ?)", now());
    for (const r of stale) {
      const p = toPublication(r);
      if (r.platform === 'vk') {
        // VK wall.post is idempotent via guid for an hour, so a retry is safe.
        this.db.update('publications', p.id, { status: 'retrying', next_attempt_at: now(), locked_until: null, last_error: 'Процесс был прерван, повтор безопасен (guid)', updated_at: now() });
      } else {
        this.db.update('publications', p.id, { status: 'needs_check', locked_until: null, last_error: 'Процесс был прерван во время публикации. Проверьте, вышел ли пост, и отметьте результат', updated_at: now() });
      }
      this.log.warn('publisher', `Восстановление после перезапуска: публикация #${p.id}`, undefined, { publicationId: p.id, contentId: p.contentId });
      this.refreshContentStatus(p.contentId);
    }
  }

  dueIds(limit = 5): number[] {
    return this.db
      .all<{ id: number }>("SELECT id FROM publications WHERE status IN ('scheduled','retrying') AND COALESCE(next_attempt_at, scheduled_at) <= ? ORDER BY COALESCE(next_attempt_at, scheduled_at) LIMIT ?", now(), limit)
      .map((r) => r.id);
  }

  private claim(id: number): boolean {
    const lock = new Date(Date.now() + LOCK_MS).toISOString();
    return this.db.run("UPDATE publications SET status = 'publishing', locked_until = ?, attempts = attempts + 1, updated_at = ? WHERE id = ? AND status IN ('scheduled','retrying')", lock, now(), id).changes === 1;
  }

  private finish(id: number, values: Record<string, string | number | null>) {
    this.db.update('publications', id, { ...values, locked_until: null, updated_at: now() });
  }

  async processDue(): Promise<number> {
    let n = 0;
    for (const id of this.dueIds()) {
      await this.publishOne(id);
      n++;
    }
    return n;
  }

  async publishOne(id: number): Promise<Publication> {
    if (!this.claim(id)) return this.get(id) as Publication;
    const p = this.get(id) as Publication;
    const refs = { publicationId: id, contentId: p.contentId, accountId: p.accountId };
    const settings = this.settings.get();
    const block = (reason: string, details?: unknown) => {
      this.finish(id, { status: 'blocked', last_error: reason });
      this.log.error('publisher', `Публикация остановлена: ${reason}`, details, refs);
      this.refreshContentStatus(p.contentId);
      return this.get(id) as Publication;
    };

    const content = this.content.get(p.contentId);
    const account = this.accounts.get(p.accountId);
    if (!content || !account) return block('Материал или аккаунт удалён');
    const integ = INTEGRATIONS[account.platform];
    if (!account.settings.enabled || account.status === 'disabled') return block(`Аккаунт «${account.name}» отключён`);
    if (account.status === 'pending' || account.status === 'error') await this.accounts.check(account.id);
    const fresh = this.accounts.get(account.id);
    if (!fresh || fresh.status !== 'connected') return block(`Аккаунт «${account.name}» не готов: ${fresh?.lastError ?? fresh?.status}`);

    const tz = settings.schedule.timezone;
    const today = localDay(new Date(), tz);
    const publishedToday = this.db
      .all<{ published_at: string }>("SELECT published_at FROM publications WHERE account_id = ? AND status = 'published' AND published_at > ?", account.id, new Date(Date.now() - 36 * 3600e3).toISOString())
      .filter((r) => localDay(new Date(r.published_at), tz) === today).length;
    const cap = Math.min(account.settings.maxPerDay, settings.limits.maxPostsPerDayPerAccount);
    if (publishedToday >= cap) return block(`Достигнут лимит ${cap} публикаций в день для «${account.name}»`);

    const media = this.content.media(content.id);
    const windowStart = new Date(Date.now() - settings.limits.duplicateWindowDays * 86400e3).toISOString();
    const published = this.db
      .all<{ content_id: number; content_hash: string | null; title: string; body: string; slides: string }>(
        "SELECT c.id AS content_id, c.content_hash, c.title, c.body, c.slides FROM publications p JOIN content c ON c.id = p.content_id WHERE p.account_id = ? AND p.status = 'published' AND p.published_at > ?",
        account.id, windowStart,
      )
      .map((r) => ({ contentId: r.content_id, hash: r.content_hash, text: [r.title, r.body, ...(JSON.parse(r.slides) as { title: string; text: string }[]).flatMap((s) => [s.title, s.text])].join('\n') }));
    const check = validateForPlatform({
      content, brand: this.content.brand(content.brandId), media, mediaPath: (m) => this.content.mediaPath(m),
      platform: account.platform, published, publicBaseUrl: this.cfg.publicBaseUrl,
    });
    if (check.errors.length) return block(check.errors.join('; '), check);

    const images = media.slice(0, RULES[account.platform].maxImages).map((m) => ({ path: this.content.mediaPath(m), url: this.publicMediaUrl(m), mime: m.mime, bytes: m.bytes }));
    const composed = compose(account.settings.useHashtags ? content : { ...content, hashtags: [] }, account.platform, images.length > 0);

    try {
      this.log.info('publisher', `Публикация в ${integ.label} «${account.name}» (попытка ${p.attempts})`, undefined, refs);
      const res = await integ.publish(this.accounts.ctx(fresh), { publicationId: id, ...composed, images });
      this.finish(id, { status: 'published', external_id: res.externalId, external_url: res.url, published_at: now(), last_error: res.warnings.join('; ') || null, next_attempt_at: null });
      this.log.info('publisher', `Опубликовано в ${integ.label}: ${res.url ?? res.externalId}`, { warnings: res.warnings }, refs);
    } catch (e) {
      const err = e instanceof IntegrationError ? e : new IntegrationError('transient', (e as Error).message ?? 'Неизвестная ошибка');
      const max = settings.limits.maxPublishAttempts;
      if (err.retryable && p.attempts < max) {
        const delay = Math.max(err.retryAfterSec ?? 0, BACKOFF_SEC[Math.min(p.attempts - 1, BACKOFF_SEC.length - 1)]);
        const next = new Date(Date.now() + delay * 1000).toISOString();
        this.finish(id, { status: 'retrying', next_attempt_at: next, last_error: err.message });
        this.log.warn('publisher', `Временная ошибка, повтор через ${Math.round(delay / 60)} мин: ${err.message}`, { attempt: p.attempts, max }, refs);
      } else {
        const status: PublicationStatus = err.kind === 'ambiguous' ? 'needs_check' : 'failed';
        const reason = err.retryable ? `${err.message} (исчерпано попыток: ${max})` : err.message;
        this.finish(id, { status, last_error: reason, next_attempt_at: null });
        this.log.error('publisher', `Публикация не удалась: ${reason}`, { kind: err.kind, code: err.code }, refs);
        if (['auth', 'permission', 'payment'].includes(err.kind)) this.accounts.setStatus(account.id, statusForError(err), err.message);
      }
    }
    this.refreshContentStatus(p.contentId);
    return this.get(id) as Publication;
  }

  async collectMetrics(): Promise<number> {
    const rows = this.db.all("SELECT * FROM publications WHERE status = 'published' AND external_id IS NOT NULL AND published_at > ?", new Date(Date.now() - 30 * 86400e3).toISOString()).map(toPublication);
    let n = 0;
    for (const p of rows) {
      const acc = this.accounts.get(p.accountId);
      if (!acc || acc.status !== 'connected') continue;
      try {
        const m = await INTEGRATIONS[acc.platform].metrics(this.accounts.ctx(acc), p.externalId as string);
        if (!m) continue;
        this.db.insert('metrics', { publication_id: p.id, fetched_at: now(), views: m.views, reach: m.reach, likes: m.likes, comments: m.comments, shares: m.shares, saves: m.saves });
        n++;
      } catch (e) {
        this.log.warn('analytics', `Статистика для публикации #${p.id} не получена: ${(e as Error).message}`, undefined, { publicationId: p.id });
      }
    }
    return n;
  }
}
