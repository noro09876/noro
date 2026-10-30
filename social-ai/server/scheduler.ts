import type { Agent } from './agent.ts';
import type { Accounts } from './accounts.ts';
import type { Publisher } from './publisher.ts';
import type { SettingsStore } from './settings.ts';
import type { EventLog } from './log.ts';
import type { Db } from './db.ts';
import { json, now, parse } from './db.ts';
import { createBackup } from './backup.ts';
import { localDay, localHour } from './time.ts';

interface SchedState {
  lastHealthAt: string | null;
  lastMetricsAt: string | null;
  lastBackupDay: string | null;
  lastCleanupAt: string | null;
}

const HEALTH_EVERY_MS = 6 * 3600e3;
const METRICS_EVERY_MS = 6 * 3600e3;

/**
 * Background loop. All state lives in SQLite, so after a restart it simply continues:
 * due publications are picked up, interrupted ones are recovered, the agent resumes its plan.
 */
export class Scheduler {
  private timer: NodeJS.Timeout | null = null;
  private busy = false;
  lastTickAt: string | null = null;
  lastTickError: string | null = null;

  private readonly db: Db;
  private readonly publisher: Publisher;
  private readonly agent: Agent;
  private readonly accounts: Accounts;
  private readonly settings: SettingsStore;
  private readonly log: EventLog;
  private readonly backupDir: string;
  private readonly tickMs: number;

  constructor(
    db: Db,
    publisher: Publisher,
    agent: Agent,
    accounts: Accounts,
    settings: SettingsStore,
    log: EventLog,
    backupDir: string,
    tickMs: number,
  ) {
    this.db = db;
    this.publisher = publisher;
    this.agent = agent;
    this.accounts = accounts;
    this.settings = settings;
    this.log = log;
    this.backupDir = backupDir;
    this.tickMs = tickMs;
  }

  private state(): SchedState {
    const r = this.db.get<{ value: string }>("SELECT value FROM settings WHERE key = 'state:scheduler'");
    return { lastHealthAt: null, lastMetricsAt: null, lastBackupDay: null, lastCleanupAt: null, ...parse<Partial<SchedState>>(r?.value, {}) };
  }
  private setState(p: Partial<SchedState>) {
    this.db.run("INSERT INTO settings (key, value, updated_at) VALUES ('state:scheduler', ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at", json({ ...this.state(), ...p }), now());
  }

  start() {
    this.publisher.recoverStale();
    this.log.info('scheduler', 'Планировщик запущен');
    const loop = async () => {
      await this.tick();
      this.timer = setTimeout(loop, this.tickMs);
    };
    this.timer = setTimeout(loop, 1000);
  }

  stop() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  get running() {
    return this.timer !== null;
  }

  async tick() {
    if (this.busy) return;
    this.busy = true;
    try {
      this.publisher.recoverStale();
      await this.publisher.processDue();
      await this.agent.cycle();
      await this.periodic();
      this.lastTickError = null;
    } catch (e) {
      this.lastTickError = (e as Error).message;
      this.log.error('scheduler', `Ошибка такта планировщика: ${this.lastTickError}`);
    } finally {
      this.lastTickAt = now();
      this.busy = false;
    }
  }

  private async periodic() {
    const st = this.state();
    const s = this.settings.get();
    const t = Date.now();
    if (!st.lastHealthAt || t - Date.parse(st.lastHealthAt) > HEALTH_EVERY_MS) {
      this.setState({ lastHealthAt: now() });
      for (const a of this.accounts.list()) if (a.status !== 'disabled' && a.settings.enabled) await this.accounts.check(a.id);
    }
    if (!st.lastMetricsAt || t - Date.parse(st.lastMetricsAt) > METRICS_EVERY_MS) {
      this.setState({ lastMetricsAt: now() });
      await this.publisher.collectMetrics();
    }
    const tz = s.schedule.timezone;
    const today = localDay(new Date(), tz);
    if (s.backup.enabled && st.lastBackupDay !== today && localHour(new Date(), tz) >= s.backup.hourLocal) {
      this.setState({ lastBackupDay: today });
      createBackup(this.db, this.backupDir, this.log, s.backup.keep);
    }
    if (!st.lastCleanupAt || t - Date.parse(st.lastCleanupAt) > 86400e3) {
      this.setState({ lastCleanupAt: now() });
      this.db.run('DELETE FROM events WHERE ts < ?', new Date(t - 90 * 86400e3).toISOString());
      this.db.run('DELETE FROM sessions WHERE expires_at < ?', now());
      this.db.run('DELETE FROM oauth_states WHERE created_at < ?', new Date(t - 3600e3).toISOString());
    }
  }
}
