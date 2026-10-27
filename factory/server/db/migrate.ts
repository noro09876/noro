import path from 'node:path';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { ROOT } from '../config';
import { closeDb, db } from './client';

export async function runMigrations() {
  await migrate(db, { migrationsFolder: path.join(ROOT, 'server/db/migrations') });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runMigrations()
    .then(() => {
      console.log('Миграции применены');
      return closeDb();
    })
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
