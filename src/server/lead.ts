import { buildLeadMessage, validateLead, type LeadFormData } from '../shared/lead';

/** Server-side order-form handler. Pure so it can be unit-tested without Netlify. */
export interface LeadEnv {
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_CHAT_ID?: string;
  LEAD_WEBHOOK_URL?: string;
}

type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

const MAX_BODY = 16_000;

export function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

export function isLeadConfigured(env: LeadEnv): boolean {
  return Boolean((env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID) || env.LEAD_WEBHOOK_URL);
}

export async function handleLead(req: Request, env: LeadEnv, fetchFn: FetchFn = fetch): Promise<Response> {
  if (req.method !== 'POST') return json(405, { ok: false, error: 'Метод не поддерживается' });
  const raw = await req.text();
  if (raw.length > MAX_BODY) return json(413, { ok: false, error: 'Слишком большая заявка' });

  let data: Partial<LeadFormData>;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
    data = parsed as Partial<LeadFormData>;
  } catch {
    return json(400, { ok: false, error: 'Некорректный формат заявки' });
  }

  // Honeypot: pretend success so bots learn nothing, but deliver nothing.
  if (typeof data.website === 'string' && data.website.trim()) return json(200, { ok: true });

  const errors = validateLead(data);
  if (Object.keys(errors).length) return json(422, { ok: false, error: 'Проверьте поля формы', fields: errors });

  if (!isLeadConfigured(env)) {
    return json(503, { ok: false, error: 'Отправка заявок на сервере не настроена' });
  }

  const text = buildLeadMessage(data);
  const deliveries: Promise<boolean>[] = [];
  if (env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID) {
    deliveries.push(
      fetchFn(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text, disable_web_page_preview: true }),
        signal: AbortSignal.timeout(8000),
      }).then((r) => r.ok, () => false),
    );
  }
  if (env.LEAD_WEBHOOK_URL) {
    deliveries.push(
      fetchFn(env.LEAD_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ source: 'noro-site', text, lead: { ...data, website: undefined } }),
        signal: AbortSignal.timeout(8000),
      }).then((r) => r.ok, () => false),
    );
  }
  const results = await Promise.all(deliveries);
  // At least one channel must accept the lead; otherwise the client shows the fallback contacts.
  if (!results.some(Boolean)) return json(502, { ok: false, error: 'Не удалось доставить заявку' });
  return json(200, { ok: true });
}
