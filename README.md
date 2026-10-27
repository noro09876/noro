# NORO — портфолио систем автоматизации

Сайт-портфолио NORO с шестью работающими продуктами, которые можно проверить на демо-данных или на своих файлах без регистрации:

| Продукт | Адрес | Что делает |
|---|---|---|
| Lead Engine | `/products/lead-engine` | Импорт базы лидов, нормализация, дубли, скоринг A/B/C, сообщения, воронка |
| Support | `/products/support` | Ответы по базе знаний с источниками, честный «не знаю», обращения оператору |
| Content OS | `/products/content-os` | Из одного текста — черновики для 6 площадок, версии, календарь |
| Docs Intelligence | `/products/docs-intelligence` | Поля из счетов, актов, договоров (TXT/CSV/PDF), проверка реквизитов и сумм |
| Catalog Studio | `/products/catalog-studio` | Проверка и исправление товарных каталогов CSV/XLSX с предпросмотром и отменой |
| Business Intelligence | `/products/business-intelligence` | KPI, сравнение периодов, срезы, аномалии, HTML-отчёт |

Все вычисления выполняются в браузере. Файлы пользователя никуда не отправляются, данные хранятся в IndexedDB этого браузера и удаляются кнопкой «Сбросить». Внешний ИИ не обязателен: Support может формулировать ответы языковой моделью только если владелец сайта задал ключ на сервере и посетитель включил эту опцию.

## Быстрый старт

Нужен Node.js 20+ (проверено на 22).

```bash
npm ci
npm run dev            # http://localhost:5173
```

## Сборка и проверки

```bash
npm run build          # tsc + vite build + пререндер страниц, 404.html, sitemap, robots
npm run typecheck
npm run lint
npm test               # unit-тесты (vitest)
npm run check          # всё вместе: типы, линтер, unit-тесты, сборка
```

E2E и аудит (Playwright, Chromium):

```bash
VITE_SITE_URL=http://localhost:4300 npm run build
npx playwright install chromium   # если браузер ещё не установлен
npm run test:e2e
```

Тесты запускают `scripts/serve-dist.mjs` — локальный сервер, который ведёт себя как Netlify: отдаёт заголовки из `netlify.toml` (включая CSP), настоящий статус 404, сжатие brotli/gzip и отвечает на `/api/*` так, как будто секреты не настроены.

## Публикация на Netlify

1. Загрузите репозиторий на GitHub (или GitLab/Bitbucket).
2. В Netlify: **Add new site → Import an existing project**, выберите репозиторий. Настройки сборки подтянутся из `netlify.toml` (`npm run build`, папка `dist`, функции в `netlify/functions`, Node 22).
3. В **Site configuration → Environment variables** задайте переменные (см. ниже) и запустите повторный деплой.
4. Подключите свой домен в **Domain management** — HTTPS выпустится автоматически.

Без единой переменной сайт полностью работает: все шесть продуктов, демо-данные и собственные файлы. Не работает только отправка формы заявки — пользователь увидит честное сообщение и вариант связаться напрямую или скачать текст заявки.

### Переменные окружения

Публичные (попадают в код страницы, секретов здесь быть не должно):

| Переменная | Зачем |
|---|---|
| `VITE_SITE_URL` | Канонические адреса и sitemap. На Netlify можно не задавать — берётся `URL` |
| `VITE_CONTACT_EMAIL` | Почта для связи (по умолчанию `9norostudio9@gmail.com`), показывается в подвале и в форме заявки как запасной канал |
| `VITE_CONTACT_TELEGRAM` | Telegram без `@` (по умолчанию `Noro23`), тоже запасной канал |

Серверные (только для Netlify Functions, в браузер не попадают):

| Переменная | Зачем |
|---|---|
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | Доставка заявок в Telegram |
| `LEAD_WEBHOOK_URL` | Или/и доставка заявок вебхуком (CRM, Make, n8n) |
| `ANTHROPIC_API_KEY` | Необязательно: формулировка ответов Support языковой моделью |
| `AI_MODEL` | Необязательно: модель, по умолчанию `claude-opus-5-5` |

Как получить `TELEGRAM_CHAT_ID`: создайте бота через @BotFather, напишите ему любое сообщение и откройте `https://api.telegram.org/bot<TOKEN>/getUpdates` — в ответе будет `chat.id`.

## Структура

```
src/
  pages/            главная, страница продукта, контакты, политика, 404
  components/       дизайн-система: ui, app (рамка приложения), charts, site, home
  design/           токены, базовые стили, компоненты, стили сайта
  products/         шесть продуктов: logic/ (чистые функции + тесты) и ui/
  lib/              CSV/XLSX/PDF, валидаторы, хранилище, загрузки, текст
  server/           обработчики Netlify Functions (заявка, ИИ) + тесты
  shared/           модель формы заявки — общая для клиента и функции
netlify/functions/  тонкие обёртки над src/server
scripts/            пререндер, генерация демо-данных и OG-картинок, локальный сервер
e2e/                Playwright: сценарии продуктов, сайт, аудит
docs/               исследование рынка, архитектура, дизайн-система, итоговый отчёт
public/demo/        демо-файлы (вымышленные данные)
```

Подробнее: [docs/architecture.md](docs/architecture.md), [docs/design-system.md](docs/design-system.md), [docs/FINAL_REPORT.md](docs/FINAL_REPORT.md).

## Демо-данные

Все демо-файлы в `public/demo/` сгенерированы `npm run demo-data` и вымышлены: компании, люди, реквизиты (с корректными контрольными суммами, но не принадлежащие реальным организациям) и продажи.
