import http from 'node:http';
import type { AddressInfo } from 'node:net';

export interface MockRequest {
  method: string;
  path: string;
  query: URLSearchParams;
  body: string;
  headers: http.IncomingHttpHeaders;
}

export type MockResponse = { status?: number; json?: unknown; text?: string; hang?: boolean; destroy?: boolean; headers?: Record<string, string> };
export type Handler = (req: MockRequest) => MockResponse | undefined;

/**
 * One local HTTP server that imitates the official APIs (Telegram Bot API, VK API, Instagram Graph API, X API v2, Ollama).
 * Default handlers return realistic success responses; tests override behaviour per path with `on`.
 */
export class MockApis {
  server: http.Server;
  base = '';
  calls: MockRequest[] = [];
  private overrides: { match: (r: MockRequest) => boolean; handler: Handler; times: number }[] = [];
  private seq = 1000;

  constructor() {
    this.server = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        const url = new URL(req.url ?? '/', 'http://x');
        const r: MockRequest = { method: req.method ?? 'GET', path: url.pathname, query: url.searchParams, body: Buffer.concat(chunks).toString('utf8'), headers: req.headers };
        this.calls.push(r);
        const ov = this.overrides.find((o) => o.times !== 0 && o.match(r));
        let out: MockResponse | undefined;
        if (ov) {
          if (ov.times > 0) ov.times--;
          out = ov.handler(r);
        }
        out ??= this.defaults(r);
        if (out.hang) return;
        if (out.destroy) return req.socket.destroy();
        res.writeHead(out.status ?? 200, { 'content-type': 'application/json', ...out.headers });
        res.end(out.text ?? JSON.stringify(out.json ?? {}));
      });
    });
  }

  async start() {
    await new Promise<void>((r) => this.server.listen(0, '127.0.0.1', r));
    this.base = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
    return this;
  }

  async stop() {
    this.server.closeAllConnections();
    await new Promise<void>((r) => this.server.close(() => r()));
  }

  /** Overrides responses for requests whose path contains `fragment`. times = -1 means forever. */
  on(fragment: string | ((r: MockRequest) => boolean), handler: Handler, times = -1) {
    const match = typeof fragment === 'string' ? (r: MockRequest) => r.path.includes(fragment) : fragment;
    this.overrides.unshift({ match, handler, times });
  }

  reset() {
    this.overrides = [];
    this.calls = [];
  }

  count(fragment: string) {
    return this.calls.filter((c) => c.path.includes(fragment)).length;
  }

  ollamaAnswer: (body: Record<string, unknown>) => unknown = () => ({});

  private defaults(r: MockRequest): MockResponse {
    const p = r.path;
    // ---- Telegram ----
    if (p.startsWith('/tg/bot')) {
      const method = p.split('/').pop();
      if (method === 'getMe') return { json: { ok: true, result: { id: 42, username: 'noro_test_bot', is_bot: true } } };
      if (method === 'getChat') return { json: { ok: true, result: { id: -1001, title: 'NORO Test', type: 'channel', username: 'noro_test' } } };
      if (method === 'getChatMember') return { json: { ok: true, result: { status: 'administrator', can_post_messages: true } } };
      if (method === 'sendMediaGroup') return { json: { ok: true, result: [{ message_id: ++this.seq, chat: { id: -1001, username: 'noro_test' } }, { message_id: ++this.seq, chat: { id: -1001 } }] } };
      return { json: { ok: true, result: { message_id: ++this.seq, chat: { id: -1001, username: 'noro_test' } } } };
    }
    // ---- VK ----
    if (p.startsWith('/vk/')) {
      const method = p.slice(4);
      if (method === 'users.get') return { json: { response: [{ id: 1, first_name: 'Тест', last_name: 'Админ' }] } };
      if (method === 'groups.getById') return { json: { response: { groups: [{ id: 777, name: 'NORO VK', is_admin: 1, admin_level: 3 }] } } };
      if (method === 'photos.getWallUploadServer') return { json: { response: { upload_url: `${this.base}/vk-upload` } } };
      if (method === 'photos.saveWallPhoto') return { json: { response: [{ id: ++this.seq, owner_id: -777 }] } };
      if (method === 'wall.post') return { json: { response: { post_id: ++this.seq } } };
      if (method === 'wall.getById') return { json: { response: { items: [{ views: { count: 120 }, likes: { count: 7 }, comments: { count: 2 }, reposts: { count: 1 } }] } } };
    }
    if (p === '/vk-upload') return { json: { server: 1, photo: '[{"photo":"abc"}]', hash: 'h' } };
    // ---- Instagram ----
    if (p.startsWith('/ig/')) {
      const rest = p.slice(4);
      if (rest === 'me') return { json: { user_id: '1789', username: 'noro.ig', account_type: 'BUSINESS', id: '1789' } };
      if (rest.endsWith('/content_publishing_limit')) return { json: { data: [{ quota_usage: 1, config: { quota_total: 100 } }] } };
      if (rest.endsWith('/media') && r.method === 'POST') return { json: { id: `c${++this.seq}` } };
      if (rest.endsWith('/media_publish')) return { json: { id: `m${++this.seq}` } };
      if (rest.endsWith('/insights')) return { json: { data: [{ name: 'reach', values: [{ value: 300 }] }, { name: 'likes', values: [{ value: 12 }] }, { name: 'views', values: [{ value: 450 }] }] } };
      if (r.query.get('fields')?.includes('status_code')) return { json: { status_code: 'FINISHED' } };
      if (r.query.get('fields') === 'permalink') return { json: { permalink: 'https://www.instagram.com/p/TEST/' } };
    }
    // ---- X ----
    if (p.startsWith('/x/')) {
      if (p === '/x/2/users/me') return { json: { data: { id: '9', username: 'noro_x', name: 'NORO' } } };
      if (p === '/x/2/media/upload') return { json: { data: { id: `${++this.seq}` } } };
      if (p === '/x/2/tweets') return { status: 201, json: { data: { id: `${++this.seq}`, text: 'ok' } } };
      if (p === '/x/2/oauth2/token') return { json: { access_token: 'xat-new', refresh_token: 'xrt-new', expires_in: 7200 } };
    }
    // ---- Ollama ----
    if (p === '/ollama/api/tags') return { json: { models: [{ name: 'qwen2.5:7b', size: 4_700_000_000 }] } };
    if (p === '/ollama/api/chat') {
      const body = JSON.parse(r.body) as Record<string, unknown>;
      return { json: { message: { role: 'assistant', content: JSON.stringify(this.ollamaAnswer(body)) }, done: true } };
    }
    return { status: 404, json: { error: `mock: no route ${p}` } };
  }
}

const VARIANTS = [
  {
    title: 'Пять признаков, что отделу продаж пора подключить ИИ-ассистента',
    body: 'Менеджеры тратят время на рутину, а заявки ждут ответа. Разбираем признаки, по которым видно, что ассистент снимет часть нагрузки, и как проверить это за неделю.',
    slides: [
      { title: 'Отделу продаж нужен ИИ-ассистент?', text: 'Пять признаков, которые легко проверить самостоятельно' },
      { title: 'Ответ на заявку дольше часа', text: 'Клиент успевает написать конкурентам, пока менеджер разбирает почту.' },
      { title: 'Одинаковые вопросы', text: 'Половина переписки — цены, сроки и условия доставки.' },
      { title: 'CRM заполняется вручную', text: 'Менеджеры переносят данные из мессенджеров копированием.' },
      { title: 'Нет единых скриптов', text: 'Каждый отвечает по-своему, и качество сложно контролировать.' },
      { title: 'Проверьте за неделю', text: 'Запустите ассистента на одном канале и сравните скорость ответа.' },
    ],
  },
  {
    title: 'No-code связка для заявок с сайта: от формы до таблицы и уведомления',
    body: 'Без программиста можно собрать цепочку, которая принимает заявку, сохраняет её в таблицу и сообщает менеджеру. Показываем шаги и подводные камни.',
    slides: [
      { title: 'Заявки с сайта без программиста', text: 'Собираем рабочую цепочку на no-code инструментах' },
      { title: 'Форма отправляет вебхук', text: 'Большинство конструкторов сайтов умеют это из коробки.' },
      { title: 'Сценарий принимает данные', text: 'n8n или похожий инструмент разбирает поля заявки.' },
      { title: 'Запись в таблицу', text: 'Каждая заявка становится строкой с датой и источником.' },
      { title: 'Уведомление менеджеру', text: 'Сообщение в Telegram с кнопкой перехода в таблицу.' },
      { title: 'Проверьте ошибки', text: 'Настройте оповещение, если сценарий упал.' },
    ],
  },
];

/** A well-formed model answer for a carousel. Variants differ enough not to trigger the duplicate check. */
export function carouselAnswer(n = 1) {
  if (n <= VARIANTS.length) {
    return { ...VARIANTS[n - 1], hook: '', summary: VARIANTS[n - 1].body.slice(0, 200), cta: 'Сохраните, чтобы не потерять.', hashtags: ['автоматизация', 'NORO'] };
  }
  return {
    title: `Как выбрать первый процесс для автоматизации №${n}`,
    hook: 'Короткий чек-лист без лишней теории',
    body: 'Автоматизацию проще начинать с одного понятного процесса. В карусели — признаки, по которым его можно найти, и шаги, чтобы проверить идею без больших вложений.\n\nСохраните, чтобы вернуться к списку, когда будете выбирать задачу.',
    summary: 'Признаки процесса, который стоит автоматизировать первым, и шаги для проверки идеи.',
    cta: 'Напишите в комментариях, какой процесс отнимает у вас больше всего времени.',
    hashtags: ['автоматизация', 'бизнес', 'NORO'],
    slides: [
      { title: `С чего начать автоматизацию ${n}`, text: 'Признаки процесса, который стоит автоматизировать первым' },
      { title: 'Задача повторяется', text: 'Одна и та же работа встречается каждый день или каждую неделю.' },
      { title: 'Правила понятны', text: 'Сотрудник может объяснить порядок действий за пару минут.' },
      { title: 'Есть цифровые данные', text: 'Заявки, таблицы, письма уже лежат в сервисах, а не на бумаге.' },
      { title: 'Ошибка не критична', text: 'Сбой можно заметить и исправить без серьёзных последствий.' },
      { title: 'Начните с малого', text: 'Автоматизируйте один шаг и оцените результат через две недели.' },
    ],
  };
}

export function anglesAnswer(body: Record<string, unknown>) {
  const prompt = ((body.messages as { content: string }[])[1].content.match(/^\d+\./gm) ?? []).length;
  return { items: Array.from({ length: prompt }, (_, i) => ({ n: i + 1, angle: `Идея ${i + 1}: практический разбор` })) };
}
