import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

export type Row = Record<string, unknown>;

const MIGRATIONS: string[] = [
  `
  CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL);

  CREATE TABLE users (
    id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL, failed_logins INTEGER NOT NULL DEFAULT 0, locked_until TEXT
  );
  CREATE TABLE sessions (
    id TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    csrf TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL
  );

  CREATE TABLE brands (
    id INTEGER PRIMARY KEY, name TEXT NOT NULL, handle TEXT NOT NULL DEFAULT '',
    audience TEXT NOT NULL DEFAULT '', voice TEXT NOT NULL DEFAULT '',
    accent TEXT NOT NULL DEFAULT '#c9f45f', background TEXT NOT NULL DEFAULT '#0b0c0d',
    default_hashtags TEXT NOT NULL DEFAULT '[]', default_cta TEXT NOT NULL DEFAULT '',
    banned_words TEXT NOT NULL DEFAULT '[]', is_default INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE TABLE topics (
    id INTEGER PRIMARY KEY, brand_id INTEGER NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
    name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', enabled INTEGER NOT NULL DEFAULT 1,
    weight INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL
  );

  CREATE TABLE accounts (
    id INTEGER PRIMARY KEY, brand_id INTEGER NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
    platform TEXT NOT NULL, name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    credentials_enc TEXT, config TEXT NOT NULL DEFAULT '{}', settings TEXT NOT NULL DEFAULT '{}',
    remote_name TEXT, last_check_at TEXT, last_error TEXT,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );

  CREATE TABLE plan_items (
    id INTEGER PRIMARY KEY, brand_id INTEGER NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
    date TEXT NOT NULL, topic TEXT NOT NULL, angle TEXT NOT NULL DEFAULT '', format TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'planned', content_id INTEGER, attempts INTEGER NOT NULL DEFAULT 0,
    note TEXT, created_at TEXT NOT NULL
  );

  CREATE TABLE content (
    id INTEGER PRIMARY KEY, brand_id INTEGER NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
    topic TEXT NOT NULL DEFAULT '', title TEXT NOT NULL DEFAULT '', body TEXT NOT NULL DEFAULT '',
    summary TEXT NOT NULL DEFAULT '', cta TEXT NOT NULL DEFAULT '', hashtags TEXT NOT NULL DEFAULT '[]',
    format TEXT NOT NULL DEFAULT 'post', platforms TEXT NOT NULL DEFAULT '[]', slides TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'draft', source TEXT NOT NULL DEFAULT 'manual', model TEXT,
    is_demo INTEGER NOT NULL DEFAULT 0, generation_count INTEGER NOT NULL DEFAULT 0,
    review TEXT, content_hash TEXT, plan_item_id INTEGER,
    archived_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE INDEX content_status ON content(status);

  CREATE TABLE media (
    id INTEGER PRIMARY KEY, content_id INTEGER NOT NULL REFERENCES content(id) ON DELETE CASCADE,
    idx INTEGER NOT NULL, kind TEXT NOT NULL, file TEXT NOT NULL, width INTEGER NOT NULL,
    height INTEGER NOT NULL, mime TEXT NOT NULL, bytes INTEGER NOT NULL, sha256 TEXT NOT NULL,
    variant TEXT NOT NULL, created_at TEXT NOT NULL
  );

  CREATE TABLE publications (
    id INTEGER PRIMARY KEY, content_id INTEGER NOT NULL REFERENCES content(id) ON DELETE CASCADE,
    account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    scheduled_at TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'scheduled',
    attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at TEXT, locked_until TEXT,
    external_id TEXT, external_url TEXT, last_error TEXT, published_at TEXT,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    UNIQUE (content_id, account_id)
  );
  CREATE INDEX publications_due ON publications(status, scheduled_at);

  CREATE TABLE metrics (
    id INTEGER PRIMARY KEY, publication_id INTEGER NOT NULL REFERENCES publications(id) ON DELETE CASCADE,
    fetched_at TEXT NOT NULL, views INTEGER, reach INTEGER, likes INTEGER, comments INTEGER,
    shares INTEGER, saves INTEGER
  );

  CREATE TABLE events (
    id INTEGER PRIMARY KEY, ts TEXT NOT NULL, level TEXT NOT NULL, scope TEXT NOT NULL,
    message TEXT NOT NULL, data TEXT, content_id INTEGER, account_id INTEGER, publication_id INTEGER
  );
  CREATE INDEX events_ts ON events(ts);

  CREATE TABLE agent_runs (
    id INTEGER PRIMARY KEY, kind TEXT NOT NULL, started_at TEXT NOT NULL, finished_at TEXT,
    status TEXT NOT NULL DEFAULT 'running', summary TEXT, error TEXT
  );

  CREATE TABLE usage (day TEXT NOT NULL, kind TEXT NOT NULL, count INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(day, kind));

  CREATE TABLE oauth_states (state TEXT PRIMARY KEY, account_id INTEGER NOT NULL, verifier TEXT NOT NULL, created_at TEXT NOT NULL);
  `,
];

export class Db {
  readonly raw: DatabaseSync;

  constructor(file: string) {
    if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
    this.raw = new DatabaseSync(file);
    this.raw.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
    this.migrate();
  }

  private migrate() {
    this.raw.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)');
    const row = this.raw.prepare('SELECT version FROM schema_version').get() as { version: number } | undefined;
    let version = row?.version ?? 0;
    if (!row) this.raw.prepare('INSERT INTO schema_version VALUES (0)').run();
    while (version < MIGRATIONS.length) {
      this.tx(() => {
        this.raw.exec(MIGRATIONS[version]);
        this.raw.prepare('UPDATE schema_version SET version = ?').run(version + 1);
      });
      version++;
    }
  }

  all<T = Row>(sql: string, ...params: SQLInputValue[]): T[] {
    return this.raw.prepare(sql).all(...params) as T[];
  }
  get<T = Row>(sql: string, ...params: SQLInputValue[]): T | undefined {
    return this.raw.prepare(sql).get(...params) as T | undefined;
  }
  run(sql: string, ...params: SQLInputValue[]) {
    const r = this.raw.prepare(sql).run(...params);
    return { changes: Number(r.changes), lastId: Number(r.lastInsertRowid) };
  }

  /** Inserts a row from an object; returns the new id. */
  insert(table: string, values: Record<string, SQLInputValue>): number {
    const keys = Object.keys(values);
    const sql = `INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`;
    return this.run(sql, ...keys.map((k) => values[k])).lastId;
  }

  update(table: string, id: number, values: Record<string, SQLInputValue>) {
    const keys = Object.keys(values);
    if (!keys.length) return 0;
    const sql = `UPDATE ${table} SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`;
    return this.run(sql, ...keys.map((k) => values[k]), id).changes;
  }

  tx<T>(fn: () => T): T {
    this.raw.exec('BEGIN IMMEDIATE');
    try {
      const out = fn();
      this.raw.exec('COMMIT');
      return out;
    } catch (e) {
      this.raw.exec('ROLLBACK');
      throw e;
    }
  }

  close() {
    this.raw.close();
  }
}

export const now = () => new Date().toISOString();
export const json = (v: unknown) => JSON.stringify(v ?? null);
export function parse<T>(s: unknown, fallback: T): T {
  if (typeof s !== 'string' || !s) return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}
