import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Services } from '../app.ts';
import { hashPassword, randomToken, sha256, verifyPassword } from '../crypto.ts';
import { now } from '../db.ts';

const COOKIE = 'noro_sid';
const MAX_FAILS = 5;
const LOCK_MIN = 15;

export interface SessionInfo {
  userId: number;
  username: string;
  csrf: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    session: SessionInfo | null;
  }
}

function readCookie(req: FastifyRequest, name: string): string | null {
  const header = req.headers.cookie ?? '';
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

function isLoopback(req: FastifyRequest) {
  const ip = req.socket.remoteAddress ?? '';
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}

export function registerAuth(app: FastifyInstance, s: Services) {
  const secure = Boolean(s.cfg.publicBaseUrl?.startsWith('https://'));

  const setCookie = (reply: FastifyReply, value: string, maxAgeSec: number) => {
    reply.header('Set-Cookie', `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${secure ? '; Secure' : ''}`);
  };

  const startSession = (reply: FastifyReply, userId: number) => {
    const sid = randomToken();
    const hours = s.settings.get().security.sessionHours;
    s.db.insert('sessions', { id: sha256(sid), user_id: userId, csrf: randomToken(18), created_at: now(), expires_at: new Date(Date.now() + hours * 3600e3).toISOString() });
    setCookie(reply, sid, hours * 3600);
  };

  app.decorateRequest('session', null);

  app.addHook('onRequest', async (req, reply) => {
    req.session = null;
    const sid = readCookie(req, COOKIE);
    if (sid) {
      const row = s.db.get<{ user_id: number; csrf: string; expires_at: string; username: string }>(
        'SELECT s.user_id, s.csrf, s.expires_at, u.username FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ?', sha256(sid),
      );
      if (row && row.expires_at > now()) req.session = { userId: row.user_id, username: row.username, csrf: row.csrf };
    }
    const url = req.url.split('?')[0];
    const open = url === '/api/health' || url.startsWith('/api/auth/') || url.startsWith('/m/') || !url.startsWith('/api/');
    if (open) return;
    if (!req.session) return reply.status(401).send({ error: 'Требуется вход' });
    // CSRF: every state-changing request must echo the session's token in a header.
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.headers['x-csrf-token'] !== req.session.csrf) {
      return reply.status(403).send({ error: 'Неверный CSRF-токен — обновите страницу' });
    }
  });

  app.get('/api/auth/state', async (req) => {
    const hasUser = Boolean(s.db.get('SELECT id FROM users LIMIT 1'));
    return {
      setupRequired: !hasUser,
      setupNeedsToken: !hasUser && !isLoopback(req),
      authenticated: Boolean(req.session),
      username: req.session?.username ?? null,
      csrf: req.session?.csrf ?? null,
    };
  });

  const credsSchema = z.object({ username: z.string().trim().min(3).max(40), password: z.string().min(10).max(200), setupToken: z.string().optional() });

  app.post('/api/auth/setup', async (req, reply) => {
    if (s.db.get('SELECT id FROM users LIMIT 1')) return reply.status(409).send({ error: 'Администратор уже создан' });
    const body = credsSchema.safeParse(req.body);
    if (!body.success) return reply.status(400).send({ error: 'Логин от 3 символов, пароль от 10 символов' });
    // From a non-local address the one-time token printed in the server console is required.
    if (!isLoopback(req) && body.data.setupToken !== s.setupToken) return reply.status(403).send({ error: 'Неверный код первичной настройки (он выведен в консоли сервера)' });
    const id = s.db.insert('users', { username: body.data.username, password_hash: hashPassword(body.data.password), created_at: now() });
    s.setupToken = null;
    s.log.info('auth', `Создан администратор ${body.data.username}`);
    startSession(reply, id);
    return { ok: true };
  });

  app.post('/api/auth/login', async (req, reply) => {
    const body = z.object({ username: z.string(), password: z.string() }).safeParse(req.body);
    if (!body.success) return reply.status(400).send({ error: 'Введите логин и пароль' });
    const user = s.db.get<{ id: number; password_hash: string; failed_logins: number; locked_until: string | null }>('SELECT * FROM users WHERE username = ?', body.data.username.trim());
    if (user?.locked_until && user.locked_until > now()) return reply.status(429).send({ error: `Слишком много попыток. Повторите через ${LOCK_MIN} минут` });
    if (!user || !verifyPassword(body.data.password, user.password_hash)) {
      if (user) {
        const fails = user.failed_logins + 1;
        s.db.update('users', user.id, { failed_logins: fails >= MAX_FAILS ? 0 : fails, locked_until: fails >= MAX_FAILS ? new Date(Date.now() + LOCK_MIN * 60e3).toISOString() : null });
      }
      s.log.warn('auth', 'Неудачная попытка входа');
      return reply.status(401).send({ error: 'Неверный логин или пароль' });
    }
    s.db.update('users', user.id, { failed_logins: 0, locked_until: null });
    startSession(reply, user.id);
    return { ok: true };
  });

  app.post('/api/auth/logout', async (req, reply) => {
    const sid = readCookie(req, COOKIE);
    if (sid) s.db.run('DELETE FROM sessions WHERE id = ?', sha256(sid));
    setCookie(reply, '', 0);
    return { ok: true };
  });

  app.post('/api/auth/password', async (req, reply) => {
    if (!req.session) return reply.status(401).send({ error: 'Требуется вход' });
    if (req.headers['x-csrf-token'] !== req.session.csrf) return reply.status(403).send({ error: 'Неверный CSRF-токен' });
    const body = z.object({ current: z.string(), next: z.string().min(10).max(200) }).safeParse(req.body);
    if (!body.success) return reply.status(400).send({ error: 'Новый пароль — от 10 символов' });
    const user = s.db.get<{ password_hash: string }>('SELECT password_hash FROM users WHERE id = ?', req.session.userId);
    if (!user || !verifyPassword(body.data.current, user.password_hash)) return reply.status(400).send({ error: 'Текущий пароль неверен' });
    s.db.update('users', req.session.userId, { password_hash: hashPassword(body.data.next) });
    s.db.run('DELETE FROM sessions WHERE user_id = ?', req.session.userId);
    startSession(reply, req.session.userId);
    s.log.info('auth', 'Пароль изменён, остальные сессии завершены');
    return { ok: true };
  });
}
