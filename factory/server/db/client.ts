import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { config } from '../config';
import * as schema from './schema';

export const sqlClient = postgres(config.databaseUrl, {
  max: Number(process.env.DB_POOL_MAX ?? 10),
  idle_timeout: 30,
  connect_timeout: 10,
  onnotice: () => {},
});

export const db = drizzle(sqlClient, { schema });
export type Db = typeof db;
export { schema };

export async function closeDb() {
  await sqlClient.end({ timeout: 5 });
}
