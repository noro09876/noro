import fs from 'node:fs';
import path from 'node:path';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import { ROOT, config } from '../config';
import { AppError, ExternalError } from '../lib/errors';
import { logger, scrub } from '../lib/logger';
import { loadUser } from './context';
import { authRoutes } from './routes/auth';
import { contentRoutes } from './routes/content';
import { fileRoutes } from './routes/files';
import { publishingRoutes } from './routes/publishing';

const CSP = [
  "default-src 'self'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    loggerInstance: logger as unknown as FastifyBaseLogger,
    trustProxy: true,
    bodyLimit: 2 * 1024 * 1024,
    requestTimeout: 120_000,
  });

  await app.register(cookie, { secret: config.sessionSecret });
  await app.register(rateLimit, { max: 600, timeWindow: '1 minute', allowList: (req) => req.url.startsWith('/assets/') });

  app.decorateRequest('user', null);
  app.decorateRequest('ws', null);
  app.decorateRequest('role', null);

  app.addHook('onRequest', async (req, reply) => {
    reply.header('x-content-type-options', 'nosniff');
    reply.header('referrer-policy', 'same-origin');
    reply.header('x-frame-options', 'DENY');
    reply.header('content-security-policy', CSP);
    if (!req.url.startsWith('/api/')) return;
    // CSRF: state-changing API calls must carry a custom header, which a cross-site form or
    // image can't set and a cross-origin script can't send without a CORS preflight (no CORS here).
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers['x-requested-with'] !== 'noro') {
      throw new AppError(403, 'csrf', 'Запрос отклонён: отсутствует заголовок защиты от CSRF');
    }
    req.user = await loadUser(req);
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof AppError) return reply.code(err.status).send({ error: { code: err.code, message: err.message, details: err.details } });
    if (err instanceof ExternalError) {
      return reply.code(err.httpStatus === 429 ? 429 : 502).send({ error: { code: err.code, message: err.message, service: err.service, retryable: err.retryable } });
    }
    const e = err as { statusCode?: number; validation?: unknown; message: string };
    if (e.statusCode === 429) return reply.code(429).send({ error: { code: 'rate_limited', message: 'Слишком много запросов. Подождите минуту.' } });
    if (e.statusCode && e.statusCode < 500) return reply.code(e.statusCode).send({ error: { code: 'bad_request', message: scrub(e.message) } });
    req.log.error({ err }, 'unhandled error');
    return reply.code(500).send({ error: { code: 'internal', message: 'Внутренняя ошибка сервера. Подробности — в журнале сервера.' } });
  });

  await app.register(authRoutes);
  await app.register(contentRoutes);
  await app.register(publishingRoutes);
  await app.register(fileRoutes);

  app.get('/api/health', async () => ({ ok: true }));

  // Built web app (npm run build). In development Vite serves it and proxies /api.
  const webDir = path.join(ROOT, 'dist/web');
  if (fs.existsSync(path.join(webDir, 'index.html'))) {
    await app.register(fastifyStatic, { root: webDir, wildcard: false, index: false, maxAge: '1h' });
    const index = fs.readFileSync(path.join(webDir, 'index.html'));
    app.setNotFoundHandler((req, reply) => {
      if (req.method !== 'GET' || req.url.startsWith('/api/') || req.url.startsWith('/media/')) return reply.code(404).send({ error: { code: 'not_found', message: 'Не найдено' } });
      return reply.type('text/html').header('cache-control', 'no-cache').send(index);
    });
  }
  return app;
}
