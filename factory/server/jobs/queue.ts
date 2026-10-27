import { PgBoss } from 'pg-boss';
import { config } from '../config';
import { logger } from '../lib/logger';

/**
 * Background jobs run on pg-boss: the queue lives in the same PostgreSQL as the data,
 * so no extra service (Redis) is needed, jobs survive restarts, and enqueueing can
 * happen next to the data it refers to.
 */

export const Q = {
  strategy: 'campaign-strategy',
  generate: 'item-generate',
  design: 'item-design',
  video: 'item-video',
  publish: 'post-publish',
  tick: 'scheduler-tick',
  metrics: 'metrics-collect',
  refresh: 'accounts-refresh',
  cleanup: 'maintenance-cleanup',
} as const;
export type QueueName = (typeof Q)[keyof typeof Q];

let boss: PgBoss | null = null;
let starting: Promise<PgBoss> | null = null;

export async function getBoss(): Promise<PgBoss> {
  if (boss) return boss;
  if (!starting) {
    starting = (async () => {
      const b = new PgBoss({ connectionString: config.databaseUrl, schema: 'pgboss' });
      b.on('error', (err) => logger.error({ err }, 'pg-boss error'));
      await b.start();
      for (const name of Object.values(Q)) {
        await b.createQueue(name).catch(() => undefined);
      }
      boss = b;
      return b;
    })();
  }
  return starting;
}

export interface EnqueueOpts {
  singletonKey?: string;
  startAfter?: Date | number;
  retryLimit?: number;
  expireInSeconds?: number;
}

const DEFAULTS: Record<QueueName, EnqueueOpts> = {
  [Q.strategy]: { retryLimit: 2, expireInSeconds: 600 },
  [Q.generate]: { retryLimit: 2, expireInSeconds: 600 },
  [Q.design]: { retryLimit: 1, expireInSeconds: 900 },
  [Q.video]: { retryLimit: 1, expireInSeconds: 3600 },
  // Publishing retries are driven by the post record (attempts/nextAttemptAt), never by the queue,
  // so a lost acknowledgement can't turn into a second post.
  [Q.publish]: { retryLimit: 0, expireInSeconds: 900 },
  [Q.tick]: { retryLimit: 0, expireInSeconds: 120 },
  [Q.metrics]: { retryLimit: 0, expireInSeconds: 900 },
  [Q.refresh]: { retryLimit: 0, expireInSeconds: 300 },
  [Q.cleanup]: { retryLimit: 0, expireInSeconds: 900 },
};

export async function enqueue(name: QueueName, data: Record<string, unknown>, opts: EnqueueOpts = {}) {
  const b = await getBoss();
  const o = { ...DEFAULTS[name], ...opts };
  return b.send(name, data, { ...o, retryBackoff: true, retryDelay: 15 });
}

export async function stopBoss() {
  if (!boss) return;
  const b = boss;
  boss = null;
  starting = null;
  // Graceful: stop fetching, wait for active jobs up to the timeout.
  await b.stop({ graceful: true, timeout: 30_000 });
}
