import { closeDb } from './db/client';
import { startWorkers } from './jobs/handlers';
import { stopBoss } from './jobs/queue';
import { logger } from './lib/logger';

/** Standalone worker process (INLINE_WORKER=0 on the API side). */
await startWorkers();

let stopping = false;
async function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  logger.info({ signal }, 'worker shutting down');
  await stopBoss();
  await closeDb();
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
