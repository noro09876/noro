import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { loadConfig } from './config.ts';
import { Db } from './db.ts';
import { EventLog } from './log.ts';
import { SettingsStore } from './settings.ts';
import { createBackup, listBackups } from './backup.ts';
import { hashPassword } from './crypto.ts';

const [cmd, arg] = process.argv.slice(2);
const cfg = loadConfig();
const dbFile = path.join(cfg.dataDir, 'noro.db');

if (cmd === 'backup') {
  const db = new Db(dbFile);
  const b = createBackup(db, cfg.backupDir, new EventLog(db), new SettingsStore(db).get().backup.keep);
  console.log(path.join(cfg.backupDir, b.name));
  db.close();
} else if (cmd === 'restore') {
  // Run with the server stopped. The current database is kept as noro.db.before-restore.
  const name = arg ?? listBackups(cfg.backupDir)[0]?.name;
  const src = name && (fs.existsSync(name) ? name : path.join(cfg.backupDir, name));
  if (!src || !fs.existsSync(src)) {
    console.error('Копия не найдена. Использование: npm run restore -- <файл>');
    process.exit(1);
  }
  if (fs.existsSync(dbFile)) fs.copyFileSync(dbFile, `${dbFile}.before-restore`);
  for (const ext of ['-wal', '-shm']) fs.rmSync(`${dbFile}${ext}`, { force: true });
  fs.copyFileSync(src, dbFile);
  console.log(`Восстановлено из ${src}. Предыдущая база: ${dbFile}.before-restore`);
} else if (cmd === 'reset-password') {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const username = (await rl.question('Логин администратора: ')).trim();
  const password = await rl.question('Новый пароль (от 10 символов): ');
  rl.close();
  if (password.length < 10) {
    console.error('Пароль слишком короткий');
    process.exit(1);
  }
  const db = new Db(dbFile);
  const user = db.get<{ id: number }>('SELECT id FROM users WHERE username = ?', username);
  if (user) db.update('users', user.id, { password_hash: hashPassword(password), failed_logins: 0, locked_until: null });
  else db.insert('users', { username, password_hash: hashPassword(password), created_at: new Date().toISOString() });
  db.run('DELETE FROM sessions');
  console.log('Пароль установлен, все сессии завершены');
  db.close();
} else {
  console.log('Команды: backup | restore [файл] | reset-password');
}
