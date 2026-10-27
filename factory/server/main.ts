import { config } from './config';
import { closeDb } from './db/client';
import { runMigrations } from './db/migrate';
import { buildApp } from './http/app';
import { startWorkers } from './jobs/handlers';
import { getBoss, stopBoss } from './jobs/queue';
import { logger } from './lib/logger';

await runMigrations();
const app = await buildApp();
await getBoss();
if (config.inlineWorker) await startWorkers();
await app.listen({ port: config.port, host: config.host });
logger.info(`NORO Content Factory: ${config.publicUrl} (worker ${config.inlineWorker ? 'inline' : 'separate'})`);

let stopping = false;
async function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  logger.info({ signal }, 'shutting down');
  const force = setTimeout(() => process.exit(1), 40_000);
  force.unref();
  await app.close(); // stop accepting requests, finish in-flight ones
  await stopBoss(); // let running jobs finish (30 s)
  await closeDb();
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
