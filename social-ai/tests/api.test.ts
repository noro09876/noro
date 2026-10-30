import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp, type Services } from '../server/app.ts';
import { MockApis } from './mock-apis.ts';
import { servicesFor, TG_TOKEN, tempDir } from './helpers.ts';

let mock: MockApis;
let s: Services;
let app: FastifyInstance;
let cookie = '';
let csrf = '';

beforeAll(async () => {
  mock = await new MockApis().start();
  s = servicesFor(mock, tempDir());
  app = await buildApp(s);
});
afterAll(async () => {
  await app.close();
  s.db.close();
  await mock.stop();
});

const call = (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: unknown, withCsrf = true) =>
  app.inject({ method, url, payload: payload as object, remoteAddress: '127.0.0.1', headers: { cookie, ...(withCsrf && csrf ? { 'x-csrf-token': csrf } : {}) } });

describe('auth', () => {
  it('requires login for the API', async () => {
    expect((await call('GET', '/api/dashboard')).statusCode).toBe(401);
    expect((await call('GET', '/api/health')).statusCode).toBe(200);
  });

  it('first-run setup from a non-local address needs the console code', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/auth/setup', remoteAddress: '10.0.0.5', payload: { username: 'admin', password: 'longpassword1' } });
    expect(r.statusCode).toBe(403);
  });

  it('creates the admin locally, then refuses a second setup', async () => {
    const r = await call('POST', '/api/auth/setup', { username: 'admin', password: 'longpassword1' }, false);
    expect(r.statusCode).toBe(200);
    cookie = String(r.headers['set-cookie']).split(';')[0];
    expect(String(r.headers['set-cookie'])).toMatch(/HttpOnly/);
    const st = (await call('GET', '/api/auth/state')).json();
    expect(st.authenticated).toBe(true);
    csrf = st.csrf;
    expect((await call('POST', '/api/auth/setup', { username: 'x', password: 'longpassword1' })).statusCode).toBe(409);
  });

  it('rejects state-changing requests without the CSRF token', async () => {
    expect((await call('POST', '/api/demo', {}, false)).statusCode).toBe(403);
    expect((await call('POST', '/api/demo', {})).statusCode).toBe(200);
  });

  it('locks the account after repeated wrong passwords', async () => {
    for (let i = 0; i < 5; i++) await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'admin', password: 'wrong' } });
    const r = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'admin', password: 'longpassword1' } });
    expect(r.statusCode).toBe(429);
    s.db.run('UPDATE users SET locked_until = NULL, failed_logins = 0');
  });
});

describe('accounts and content API', () => {
  it('never returns secrets to the browser', async () => {
    const r = await call('POST', '/api/accounts', { platform: 'telegram', name: 'Канал', credentials: { botToken: TG_TOKEN }, config: { chatId: '@noro_test' } });
    expect(r.statusCode).toBe(200);
    const body = r.body;
    expect(body).not.toContain('AAFakeToken');
    expect(r.json().status).toBe('connected');
    expect(r.json().credentials.botToken).toEqual({ set: true, hint: '••••hijk' });
    const list = (await call('GET', '/api/accounts')).body;
    expect(list).not.toContain('AAFakeToken');
  });

  it('validates required fields when adding an account', async () => {
    const r = await call('POST', '/api/accounts', { platform: 'vk', name: 'VK', credentials: {}, config: {} });
    expect(r.statusCode).toBe(400);
    expect(r.json().error).toMatch(/обязательно/);
  });

  it('runs the content lifecycle: create → edit → approve → schedule → move → publish', async () => {
    const created = await call('POST', '/api/content', { topic: 'ИИ-агенты', title: 'Три вопроса перед запуском ИИ-агента', body: 'Прежде чем запускать агента, ответьте на три вопроса: какую задачу он решает, где берёт данные и кто проверяет результат.', format: 'post', platforms: ['telegram'] });
    expect(created.statusCode).toBe(200);
    const c = created.json();
    expect(c.status).toBe('draft');
    expect(c.media).toHaveLength(1);

    const edited = (await call('PUT', `/api/content/${c.id}`, { title: 'Три вопроса перед запуском ИИ-агента в компании' })).json();
    expect(edited.title).toMatch(/в компании/);

    const approved = await call('POST', `/api/content/${c.id}/approve`);
    expect(approved.json().status).toBe('ready');

    const accounts = (await call('GET', '/api/accounts')).json();
    const at = new Date(Date.now() + 3600e3).toISOString();
    const scheduled = (await call('POST', `/api/content/${c.id}/schedule`, { accountIds: [accounts[0].id], at })).json();
    expect(scheduled.status).toBe('scheduled');
    const pubId = scheduled.publications[0].id;

    const moved = await call('PUT', `/api/publications/${pubId}`, { at: new Date(Date.now() + 7200e3).toISOString() });
    expect(moved.statusCode).toBe(200);
    expect((await call('PUT', `/api/publications/${pubId}`, { at: new Date(Date.now() - 7200e3).toISOString() })).statusCode).toBe(400);

    const cal = (await call('GET', `/api/calendar?from=${encodeURIComponent(new Date().toISOString())}&to=${encodeURIComponent(new Date(Date.now() + 86400e3).toISOString())}`)).json();
    expect(cal.publications.some((p: { id: number }) => p.id === pubId)).toBe(true);

    const pub = (await call('POST', `/api/content/${c.id}/publish-now`, { accountIds: [accounts[0].id] })).json();
    expect(pub.results[0].status).toBe('published');
    expect((await call('PUT', `/api/content/${c.id}`, { title: 'x' })).statusCode).toBe(400);
  });

  it('refuses to approve material that fails checks and returns the reasons', async () => {
    const c = (await call('POST', '/api/content', { title: 'Тест', body: 'TODO дописать текст', format: 'post', platforms: ['telegram'] })).json();
    const r = await call('POST', `/api/content/${c.id}/approve`);
    expect(r.statusCode).toBe(422);
    expect(r.json().review.errors.join(' ')).toMatch(/заглушка/);
  });

  it('exports slides as a zip and archives/deletes content', async () => {
    const list = (await call('GET', '/api/content')).json();
    const demo = list.find((c: { isDemo: boolean; format: string }) => c.isDemo && c.format === 'carousel');
    const zip = await call('GET', `/api/content/${demo.id}/export.zip`);
    expect(zip.headers['content-type']).toBe('application/zip');
    expect(zip.rawPayload.readUInt32LE(0)).toBe(0x04034b50);
    expect((await call('POST', `/api/content/${demo.id}/archive`)).json().status).toBe('archived');
    expect((await call('GET', '/api/content')).json().some((c: { id: number }) => c.id === demo.id)).toBe(false);
    expect((await call('DELETE', `/api/content/${demo.id}`)).statusCode).toBe(200);
  });

  it('shows the agent, settings, analytics and backups', async () => {
    expect((await call('GET', '/api/agent')).json().settings.enabled).toBe(false);
    const st = await call('PUT', '/api/settings', { schedule: { timezone: 'Mars/Olympus' } });
    expect(st.statusCode).toBe(400);
    expect((await call('PUT', '/api/agent', { postsPerDay: 9 })).statusCode).toBe(400);
    const a = (await call('GET', '/api/analytics')).json();
    expect(a.rows.length).toBeGreaterThan(0);
    const b = (await call('POST', '/api/backups')).json();
    expect(b.name).toMatch(/^noro-.*\.db$/);
    expect((await call('GET', `/api/backups/${b.name}`)).statusCode).toBe(200);
    expect((await call('GET', '/api/backups/..%2Fnoro.db')).statusCode).toBe(404);
  });

  it('public media links require a valid signature', async () => {
    const m = s.db.get<{ id: number }>('SELECT id FROM media LIMIT 1')!;
    expect((await app.inject({ method: 'GET', url: `/m/${m.id}/${'a'.repeat(32)}.jpg` })).statusCode).toBe(404);
  });
});
