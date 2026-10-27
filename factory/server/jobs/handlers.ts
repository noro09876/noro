import type { Job } from 'pg-boss';
import { logger } from '../lib/logger';
import { runDesign, runGenerate, runStrategy, runVideo } from '../pipeline/run';
import { refreshExpiring } from '../services/accounts';
import { runDueRules } from '../services/automation';
import { cleanup, collectMetrics } from '../services/maintenance';
import { enqueueDue } from '../services/posts';
import { publishPost, recoverStuck } from '../services/publisher';
import { getBoss, Q, type QueueName } from './queue';

type Handler = (data: Record<string, unknown>) => Promise<unknown>;

const HANDLERS: Record<QueueName, Handler> = {
  [Q.strategy]: (d) => runStrategy(String(d.campaignId)),
  [Q.generate]: (d) => runGenerate(String(d.itemId), { instruction: d.instruction as string | undefined, target: d.target as string | undefined, userId: d.userId as string | undefined }),
  [Q.design]: (d) => runDesign(String(d.itemId), String(d.versionId)),
  [Q.video]: (d) => runVideo(String(d.itemId), String(d.versionId), { withoutVoice: !!d.withoutVoice }),
  [Q.publish]: (d) => publishPost(String(d.postId)),
  [Q.tick]: async () => {
    await recoverStuck();
    await enqueueDue();
    await runDueRules();
  },
  [Q.metrics]: () => collectMetrics(),
  [Q.refresh]: () => refreshExpiring(),
  [Q.cleanup]: () => cleanup(),
};

/** Heavy jobs get a single slot each so a render doesn't starve publishing. */
const CONCURRENCY: Partial<Record<QueueName, number>> = { [Q.video]: 1, [Q.design]: 1, [Q.generate]: 3, [Q.publish]: 2 };

export async function startWorkers() {
  const boss = await getBoss();
  for (const [name, fn] of Object.entries(HANDLERS) as [QueueName, Handler][]) {
    await boss.work<Record<string, unknown>>(name, { batchSize: 1, localConcurrency: CONCURRENCY[name] ?? 1 }, async (jobs: Job<Record<string, unknown>>[]) => {
      for (const job of jobs) {
        const t = Date.now();
        try {
          await fn(job.data ?? {});
          logger.debug({ queue: name, job: job.id, ms: Date.now() - t }, 'job done');
        } catch (err) {
          logger.error({ queue: name, job: job.id, err }, 'job failed');
          throw err;
        }
      }
    });
  }
  // Cron jobs (pg-boss keeps one schedule per name across all workers).
  await boss.schedule(Q.tick, '* * * * *');
  await boss.schedule(Q.metrics, '17 */6 * * *');
  await boss.schedule(Q.refresh, '41 3 * * *');
  await boss.schedule(Q.cleanup, '23 4 * * *');
  logger.info('workers started');
}
