import fs from 'node:fs';
import path from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import { loadConfig, type AppConfig } from './config.ts';
import { Db, now } from './db.ts';
import { Vault, randomToken } from './crypto.ts';
import { EventLog } from './log.ts';
import { SettingsStore } from './settings.ts';
import { ContentRepo } from './content.ts';
import { Accounts } from './accounts.ts';
import { Publisher } from './publisher.ts';
import { Agent } from './agent.ts';
import { Scheduler } from './scheduler.ts';
import { registerAuth } from './routes/auth.ts';
import { registerRoutes } from './routes/api.ts';
import { seed } from './seed.ts';

export interface Services {
  cfg: AppConfig;
  db: Db;
  vault: Vault;
  log: EventLog;
  settings: SettingsStore;
  content: ContentRepo;
  accounts: Accounts;
  publisher: Publisher;
  agent: Agent;
  scheduler: Scheduler;
  setupToken: string | null;
}

export function createServices(cfgOverrides: Partial<AppConfig> = {}, fetchImpl: typeof fetch = fetch): Services {
  const cfg = loadConfig(cfgOverrides);
  fs.mkdirSync(cfg.mediaDir, { recursive: true });
  const db = new Db(path.join(cfg.dataDir, 'noro.db'));
  const vault = new Vault(cfg.dataDir, cfg.masterKey);
  const log = new EventLog(db, cfg.isTest);
  const settings = new SettingsStore(db);
  const content = new ContentRepo(db, cfg.mediaDir);
  const accounts = new Accounts(db, vault, log, cfg, fetchImpl);
  const publisher = new Publisher(db, content, accounts, settings, vault, log, cfg);
  const agent = new Agent(db, content, settings, accounts, publisher, vault, log, cfg.publicBaseUrl, fetchImpl);
  const scheduler = new Scheduler(db, publisher, agent, accounts, settings, log, cfg.backupDir, cfg.tickMs);
  seed(db, settings, cfg);
  const hasUser = db.get('SELECT id FROM users LIMIT 1');
  const setupToken = hasUser ? null : randomToken(9);
  return { cfg, db, vault, log, settings, content, accounts, publisher, agent, scheduler, setupToken };
}

export async function buildApp(services: Services): Promise<FastifyInstance> {
  const app = Fastify({
    logger: false,
    bodyLimit: 2 * 1024 * 1024,
    trustProxy: Boolean(services.cfg.publicBaseUrl),
  });

  app.addHook('onSend', async (_req, reply, payload) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Referrer-Policy', 'same-origin');
    reply.header('Content-Security-Policy', "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; font-src 'self' data:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
    return payload;
  });

  app.setErrorHandler((e, req, reply) => {
    const err = e as Error & { statusCode?: number; validation?: unknown };
    if (err.name === 'ZodError') return reply.status(400).send({ error: 'Неверные параметры запроса' });
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    if (status >= 500) services.log.error('http', `${req.method} ${req.url.split('?')[0]}: ${err.message}`);
    reply.status(status).send({ error: status >= 500 ? `Внутренняя ошибка: ${err.message}` : err.message });
  });

  app.get('/api/health', async () => ({ ok: true, time: now(), scheduler: services.scheduler.running }));

  registerAuth(app, services);
  registerRoutes(app, services);

  const dist = path.join(services.cfg.root, 'dist');
  if (fs.existsSync(dist)) {
    await app.register(fastifyStatic, { root: dist, prefix: '/', index: ['index.html'] });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/') || req.url.startsWith('/assets/') || req.method !== 'GET') return reply.status(404).send({ error: 'Не найдено' });
      return reply.type('text/html').sendFile('index.html');
    });
  }
  return app;
}
