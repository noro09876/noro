import type { Db, Row } from './db.ts';
import { json, now, parse } from './db.ts';
import { mask, type Vault } from './crypto.ts';
import type { EventLog } from './log.ts';
import type { AppConfig } from './config.ts';
import type { Platform } from './settings.ts';
import { INTEGRATIONS } from './integrations/index.ts';
import { type Ctx, IntegrationError } from './integrations/types.ts';

export type AccountStatus = 'pending' | 'connected' | 'needs_auth' | 'no_permission' | 'payment_required' | 'error' | 'disabled';

export interface AccountSettings {
  enabled: boolean;
  /** Agent may schedule to this account automatically. */
  autoPublish: boolean;
  maxPerDay: number;
  useHashtags: boolean;
}

export interface Account {
  id: number;
  brandId: number;
  platform: Platform;
  name: string;
  status: AccountStatus;
  config: Record<string, string>;
  settings: AccountSettings;
  remoteName: string | null;
  lastCheckAt: string | null;
  lastError: string | null;
  createdAt: string;
}

export const DEFAULT_ACCOUNT_SETTINGS: AccountSettings = { enabled: true, autoPublish: true, maxPerDay: 3, useHashtags: true };

export function toAccount(r: Row): Account {
  return {
    id: r.id as number,
    brandId: r.brand_id as number,
    platform: r.platform as Platform,
    name: r.name as string,
    status: r.status as AccountStatus,
    config: parse(r.config, {}),
    settings: { ...DEFAULT_ACCOUNT_SETTINGS, ...parse<Partial<AccountSettings>>(r.settings, {}) },
    remoteName: (r.remote_name as string) ?? null,
    lastCheckAt: (r.last_check_at as string) ?? null,
    lastError: (r.last_error as string) ?? null,
    createdAt: r.created_at as string,
  };
}

export function statusForError(e: unknown): AccountStatus {
  if (e instanceof IntegrationError) {
    if (e.kind === 'auth') return 'needs_auth';
    if (e.kind === 'permission') return 'no_permission';
    if (e.kind === 'payment') return 'payment_required';
  }
  return 'error';
}

export class Accounts {
  private readonly db: Db;
  private readonly vault: Vault;
  private readonly log: EventLog;
  private readonly cfg: AppConfig;
  private readonly fetchImpl: typeof fetch;

  constructor(
    db: Db,
    vault: Vault,
    log: EventLog,
    cfg: AppConfig,
    fetchImpl: typeof fetch = fetch,
  ) {
    this.db = db;
    this.vault = vault;
    this.log = log;
    this.cfg = cfg;
    this.fetchImpl = fetchImpl;
  }

  list(): Account[] {
    return this.db.all('SELECT * FROM accounts ORDER BY id').map(toAccount);
  }

  get(id: number): Account | null {
    const r = this.db.get('SELECT * FROM accounts WHERE id = ?', id);
    return r ? toAccount(r) : null;
  }

  /** Public view: secrets are never returned, only whether they are set and their last 4 chars. */
  view(a: Account) {
    const integ = INTEGRATIONS[a.platform];
    const creds = this.credentials(a.id) ?? {};
    const credentials: Record<string, { set: boolean; hint: string }> = {};
    for (const f of integ.credentialFields) {
      const v = creds[f.key];
      credentials[f.key] = { set: Boolean(v), hint: f.secret ? mask(v) : (v ?? '') };
    }
    return { ...a, credentials, authorized: integ.oauth ? Boolean(creds.accessToken) : undefined };
  }

  credentials(id: number): Record<string, string> | null {
    const r = this.db.get<{ credentials_enc: string | null }>('SELECT credentials_enc FROM accounts WHERE id = ?', id);
    return this.vault.decrypt<Record<string, string>>(r?.credentials_enc);
  }

  create(input: { brandId: number; platform: Platform; name: string; credentials: Record<string, string>; config: Record<string, string>; settings?: Partial<AccountSettings> }): Account {
    const t = now();
    const integ = INTEGRATIONS[input.platform];
    const creds = pick(input.credentials, integ.credentialFields.map((f) => f.key));
    const id = this.db.insert('accounts', {
      brand_id: input.brandId,
      platform: input.platform,
      name: input.name,
      status: 'pending',
      credentials_enc: this.vault.encrypt(creds),
      config: json(pick(input.config, integ.configFields.map((f) => f.key))),
      settings: json({ ...DEFAULT_ACCOUNT_SETTINGS, ...input.settings }),
      created_at: t,
      updated_at: t,
    });
    this.log.info('accounts', `Добавлен аккаунт ${integ.label}: ${input.name}`, undefined, { accountId: id });
    return this.get(id) as Account;
  }

  update(id: number, patch: { name?: string; credentials?: Record<string, string>; config?: Record<string, string>; settings?: Partial<AccountSettings> }): Account {
    const a = this.get(id);
    if (!a) throw new Error('Аккаунт не найден');
    const integ = INTEGRATIONS[a.platform];
    const values: Record<string, string | null> = { updated_at: now() };
    if (patch.name) values.name = patch.name;
    if (patch.config) values.config = json({ ...a.config, ...pick(patch.config, integ.configFields.map((f) => f.key)) });
    if (patch.settings) values.settings = json({ ...a.settings, ...patch.settings });
    if (patch.credentials) {
      // Empty fields mean "keep the stored value", so the UI never has to receive secrets back.
      const cur = this.credentials(id) ?? {};
      const incoming = Object.fromEntries(Object.entries(pick(patch.credentials, integ.credentialFields.map((f) => f.key))).filter(([, v]) => v));
      values.credentials_enc = this.vault.encrypt({ ...cur, ...incoming });
      values.status = 'pending';
    }
    this.db.update('accounts', id, values);
    return this.get(id) as Account;
  }

  saveCredentials(id: number, creds: Record<string, string>) {
    this.db.update('accounts', id, { credentials_enc: this.vault.encrypt(creds), updated_at: now() });
  }

  setStatus(id: number, status: AccountStatus, error: string | null, remoteName?: string | null) {
    const values: Record<string, string | null> = { status, last_error: error, last_check_at: now(), updated_at: now() };
    if (remoteName !== undefined) values.remote_name = remoteName;
    this.db.update('accounts', id, values);
  }

  disconnect(id: number) {
    // Forget the credentials entirely; history of publications stays.
    this.db.update('accounts', id, { credentials_enc: this.vault.encrypt({}), status: 'disabled', updated_at: now() });
    this.db.run("UPDATE publications SET status = 'cancelled', last_error = 'Аккаунт отключён', updated_at = ? WHERE account_id = ? AND status IN ('scheduled','retrying')", now(), id);
    this.log.warn('accounts', 'Аккаунт отключён, ключи удалены', undefined, { accountId: id });
  }

  remove(id: number) {
    this.db.run('DELETE FROM accounts WHERE id = ?', id);
    this.log.warn('accounts', `Аккаунт #${id} удалён`);
  }

  ctx(a: Account): Ctx {
    return {
      credentials: this.credentials(a.id) ?? {},
      config: a.config,
      apiBase: this.cfg.apiBase[a.platform === 'instagram' ? 'instagram' : a.platform],
      saveCredentials: (c) => this.saveCredentials(a.id, c),
      fetch: this.fetchImpl,
    };
  }

  async check(id: number): Promise<{ ok: boolean; message: string }> {
    const a = this.get(id);
    if (!a) throw new Error('Аккаунт не найден');
    const integ = INTEGRATIONS[a.platform];
    if (a.status === 'disabled') return { ok: false, message: 'Аккаунт отключён' };
    try {
      const r = await integ.check(this.ctx(a));
      this.setStatus(id, r.ok ? 'connected' : 'no_permission', r.ok ? null : r.message, r.remoteName);
      this.log.write(r.ok ? 'info' : 'warn', 'accounts', `Проверка ${integ.label} «${a.name}»: ${r.message}`, r.details, { accountId: id });
      return { ok: r.ok, message: r.message };
    } catch (e) {
      const message = (e as Error).message;
      this.setStatus(id, statusForError(e), message);
      this.log.error('accounts', `Проверка ${integ.label} «${a.name}» не прошла: ${message}`, undefined, { accountId: id });
      return { ok: false, message };
    }
  }
}

function pick(obj: Record<string, string> | undefined, keys: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of keys) if (obj && typeof obj[k] === 'string') out[k] = obj[k].trim();
  return out;
}
