import fs from 'node:fs';
import path from 'node:path';
import type { Db } from './db.ts';
import type { EventLog } from './log.ts';

export interface BackupFile {
  name: string;
  bytes: number;
  createdAt: string;
}

/**
 * Consistent online snapshot of the database via VACUUM INTO.
 * Contains encrypted tokens but not master.key — a backup alone cannot reveal credentials.
 */
export function createBackup(db: Db, dir: string, log: EventLog, keep: number): BackupFile {
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const name = `noro-${stamp}.db`;
  const file = path.join(dir, name);
  db.raw.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  const files = listBackups(dir);
  for (const old of files.slice(keep)) fs.rmSync(path.join(dir, old.name), { force: true });
  const bytes = fs.statSync(file).size;
  log.info('backup', `Резервная копия создана: ${name} (${Math.round(bytes / 1024)} КБ)`);
  return { name, bytes, createdAt: new Date().toISOString() };
}

export function listBackups(dir: string): BackupFile[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => /^noro-[\dT-]+\.db$/.test(f))
    .map((name) => {
      const st = fs.statSync(path.join(dir, name));
      return { name, bytes: st.size, createdAt: st.mtime.toISOString() };
    })
    .sort((a, b) => b.name.localeCompare(a.name));
}

export function backupPath(dir: string, name: string): string | null {
  if (!/^noro-[\dT-]+\.db$/.test(name)) return null;
  const p = path.join(dir, name);
  return fs.existsSync(p) ? p : null;
}
