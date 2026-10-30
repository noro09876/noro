import { request } from './http.ts';
import { type Ctx, type Integration, IntegrationError } from './types.ts';

interface GraphError {
  error?: { message: string; code: number; error_subcode?: number; is_transient?: boolean };
}

function classify(status: number, body: GraphError | null): IntegrationError {
  const e = body?.error;
  const msg = e?.message ?? `HTTP ${status}`;
  const code = e?.code ?? status;
  if (code === 190 || status === 401) return new IntegrationError('auth', `Instagram: токен недействителен или истёк (${msg})`, { code });
  if ([4, 17, 32, 613].includes(code) || status === 429) return new IntegrationError('rate_limit', `Instagram: превышен лимит запросов (${msg})`, { retryAfterSec: 900, code });
  if (code === 9 || e?.error_subcode === 2207042) return new IntegrationError('rate_limit', 'Instagram: достигнут лимит публикаций за 24 часа', { retryAfterSec: 3600, code });
  if ([10, 200, 3, 100].includes(code) && /permission|not authorized|does not have/i.test(msg)) {
    return new IntegrationError('permission', `Instagram: нет разрешения на публикацию (${msg})`, { code });
  }
  if (e?.is_transient || status >= 500 || code === 2) return new IntegrationError('transient', `Instagram: временная ошибка (${msg})`, { code });
  return new IntegrationError('invalid', `Instagram: ${msg}`, { code });
}

async function graph<T>(ctx: Ctx, method: 'GET' | 'POST', pathname: string, params: Record<string, string> = {}, commit = false): Promise<T> {
  const qs = new URLSearchParams({ ...params, access_token: ctx.credentials.accessToken });
  const url = method === 'GET' ? `${ctx.apiBase}/${pathname}?${qs}` : `${ctx.apiBase}/${pathname}`;
  const res = await request(url, {
    method,
    headers: method === 'POST' ? { 'content-type': 'application/x-www-form-urlencoded' } : undefined,
    body: method === 'POST' ? qs : undefined,
    commit,
    timeoutMs: 60000,
    fetch: ctx.fetch,
  });
  const data = res.data as (T & GraphError) | null;
  if (res.status !== 200 || data?.error) throw classify(res.status, data);
  return data as T;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitReady(ctx: Ctx, containerId: string) {
  const delays = Number(ctx.config.pollMs ?? 0) > 0 ? Array(10).fill(Number(ctx.config.pollMs)) : [2000, 3000, 5000, 10000, 15000, 30000, 60000];
  for (const d of delays) {
    const s = await graph<{ status_code?: string; status?: string }>(ctx, 'GET', containerId, { fields: 'status_code,status' });
    if (s.status_code === 'FINISHED') return;
    if (s.status_code === 'ERROR' || s.status_code === 'EXPIRED') throw new IntegrationError('invalid', `Instagram отклонил медиа: ${s.status ?? s.status_code}`);
    await sleep(d);
  }
  throw new IntegrationError('transient', 'Instagram: медиа не обработано вовремя, попытка будет повторена');
}

async function igUserId(ctx: Ctx): Promise<string> {
  if (ctx.config.igUserId) return ctx.config.igUserId;
  const me = await graph<{ user_id?: string; id: string }>(ctx, 'GET', 'me', { fields: 'user_id,username' });
  return me.user_id ?? me.id;
}

export const instagram: Integration = {
  platform: 'instagram',
  label: 'Instagram',
  cost: 'API бесплатен, но нужен профессиональный аккаунт, приложение Meta и публичный HTTPS-адрес для картинок',
  requirements: [
    'Аккаунт Instagram должен быть профессиональным (Business или Creator).',
    'Создайте приложение на developers.facebook.com с продуктом «Instagram API with Instagram Login» и разрешениями instagram_business_basic и instagram_business_content_publish.',
    'Пока приложение не прошло проверку Meta, публиковать можно только в аккаунты, добавленные в роли приложения (тестировщики).',
    'Сгенерируйте долгоживущий токен пользователя Instagram и вставьте его сюда.',
    'Instagram скачивает изображения сам по ссылке, поэтому NORO должен быть доступен из интернета по HTTPS (NORO_PUBLIC_URL), например через бесплатный Cloudflare Tunnel.',
    'Лимит Meta — до 100 публикаций через API за 24 часа на аккаунт; только JPEG; в карусели до 10 изображений.',
  ],
  metricsNote: 'Охват, лайки, комментарии, сохранения и репосты — из Insights API (доступно для профессиональных аккаунтов).',
  oauth: false,
  credentialFields: [
    { key: 'accessToken', label: 'Токен доступа Instagram', secret: true, required: true, placeholder: 'IGAA…', help: 'Долгоживущий токен (60 дней) — обновите до истечения' },
  ],
  configFields: [
    { key: 'igUserId', label: 'ID аккаунта Instagram (необязательно)', secret: false, required: false, placeholder: 'определится автоматически' },
  ],

  async check(ctx) {
    const me = await graph<{ user_id?: string; id: string; username?: string; account_type?: string }>(ctx, 'GET', 'me', { fields: 'user_id,username,account_type' });
    const id = ctx.config.igUserId || me.user_id || me.id;
    const professional = !me.account_type || ['BUSINESS', 'MEDIA_CREATOR'].includes(me.account_type);
    let quota = '';
    try {
      const lim = await graph<{ data?: { quota_usage?: number; config?: { quota_total?: number } }[] }>(ctx, 'GET', `${id}/content_publishing_limit`, { fields: 'quota_usage,config' });
      const q = lim.data?.[0];
      if (q) quota = `, использовано ${q.quota_usage ?? 0} из ${q.config?.quota_total ?? '?'} публикаций за 24 ч`;
    } catch (e) {
      quota = `, лимит не получен: ${(e as Error).message}`;
    }
    return {
      ok: professional,
      remoteName: me.username ? `@${me.username}` : id,
      message: professional ? `Аккаунт доступен${quota}` : 'Аккаунт не профессиональный — переключите его на Business или Creator',
      details: { accountType: me.account_type ?? null, igUserId: id },
    };
  },

  async publish(ctx, post) {
    if (!post.images.length) throw new IntegrationError('invalid', 'Instagram: нужна хотя бы одна картинка');
    if (post.images.some((i) => !i.url?.startsWith('https://'))) {
      throw new IntegrationError('unavailable', 'Instagram: изображения недоступны по публичной HTTPS-ссылке (задайте NORO_PUBLIC_URL)');
    }
    const ig = await igUserId(ctx);
    let creationId: string;
    if (post.images.length === 1) {
      const c = await graph<{ id: string }>(ctx, 'POST', `${ig}/media`, { image_url: post.images[0].url as string, caption: post.text });
      creationId = c.id;
    } else {
      const children: string[] = [];
      for (const img of post.images.slice(0, 10)) {
        const c = await graph<{ id: string }>(ctx, 'POST', `${ig}/media`, { image_url: img.url as string, is_carousel_item: 'true' });
        children.push(c.id);
      }
      for (const id of children) await waitReady(ctx, id);
      const c = await graph<{ id: string }>(ctx, 'POST', `${ig}/media`, { media_type: 'CAROUSEL', children: children.join(','), caption: post.text });
      creationId = c.id;
    }
    await waitReady(ctx, creationId);
    const published = await graph<{ id: string }>(ctx, 'POST', `${ig}/media_publish`, { creation_id: creationId }, true);
    let url: string | null = null;
    const warnings: string[] = [];
    try {
      url = (await graph<{ permalink?: string }>(ctx, 'GET', published.id, { fields: 'permalink' })).permalink ?? null;
    } catch {
      warnings.push('Ссылка на пост не получена');
    }
    return { externalId: published.id, url, warnings };
  },

  async metrics(ctx, externalId) {
    const res = await graph<{ data?: { name: string; values?: { value: number }[]; total_value?: { value: number } }[] }>(
      ctx, 'GET', `${externalId}/insights`, { metric: 'reach,likes,comments,shares,saved,views' },
    );
    const get = (n: string) => {
      const m = res.data?.find((d) => d.name === n);
      return m?.total_value?.value ?? m?.values?.[0]?.value ?? null;
    };
    return { views: get('views'), reach: get('reach'), likes: get('likes'), comments: get('comments'), shares: get('shares'), saves: get('saved') };
  },
};
