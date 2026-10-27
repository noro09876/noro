/**
 * Platform capability matrix.
 *
 * Single source of truth for what each social platform allows through its
 * official API. The UI, the adapters, the quality checks and docs/integrations.md
 * all read from here. Facts were checked against official documentation on
 * 2026-10-27 (links in `docs`), and every entry says honestly whether publishing
 * is automatic, gated by platform review, or manual-only.
 */

export const PLATFORM_IDS = [
  'telegram',
  'vk',
  'max',
  'instagram',
  'threads',
  'youtube',
  'tiktok',
  'dzen',
  'teletype',
  'vcru',
] as const;

export type PlatformId = (typeof PLATFORM_IDS)[number];

/** How publishing works for this platform. */
export type PublishMode =
  /** Official API publishes directly once the account is connected. */
  | 'api'
  /** Official API exists, but the platform must approve the app first (review / audit). */
  | 'api_review'
  /** No official publishing API: the factory prepares a package and reminds the user. */
  | 'manual';

export type MediaKind = 'text' | 'image' | 'carousel' | 'video';

export type AuthKind = 'bot_token' | 'oauth2' | 'none';

export interface PlatformSpec {
  id: PlatformId;
  name: string;
  short: string;
  /** Brand-neutral hue used only for chips in the UI. */
  hue: number;
  mode: PublishMode;
  auth: AuthKind;
  /** Media kinds the official API can publish. */
  apiMedia: MediaKind[];
  /** Media kinds the factory prepares (for manual platforms: what the package contains). */
  preparedMedia: MediaKind[];
  accountTypes: string;
  permissions: string[];
  review: string;
  limits: {
    textMax: number;
    /** Max caption for media posts if it differs from textMax. */
    captionMax?: number;
    titleMax?: number;
    carouselMin?: number;
    carouselMax?: number;
    videoMaxSec?: number;
    videoMaxMb?: number;
    imageMaxMb?: number;
    imageFormats?: string[];
    postsPerDay?: number;
    rate?: string;
  };
  status: string;
  analytics: string;
  hardLimits: string[];
  docs: { label: string; url: string }[];
  /** Recommended aspect for visuals on this platform. */
  aspect: '1:1' | '4:5' | '9:16' | '16:9';
}

export const PLATFORMS: Record<PlatformId, PlatformSpec> = {
  telegram: {
    id: 'telegram',
    name: 'Telegram',
    short: 'TG',
    hue: 200,
    mode: 'api',
    auth: 'bot_token',
    apiMedia: ['text', 'image', 'carousel', 'video'],
    preparedMedia: ['text', 'image', 'carousel', 'video'],
    accountTypes: 'Канал или группа, где ваш бот — администратор с правом публикации',
    permissions: ['Бот из @BotFather', 'Права администратора канала: «Публикация сообщений»'],
    review: 'Не требуется',
    limits: {
      textMax: 4096,
      captionMax: 1024,
      carouselMin: 2,
      carouselMax: 10,
      videoMaxMb: 50,
      imageMaxMb: 10,
      imageFormats: ['jpg', 'png', 'webp'],
      rate: 'Не больше ~20 сообщений в минуту в одну группу/канал',
    },
    status: 'Ответ sendMessage/sendPhoto/sendVideo/sendMediaGroup содержит message_id — публикация подтверждается сразу',
    analytics: 'Bot API не отдаёт просмотры постов канала. Доступно только число подписчиков (getChatMemberCount)',
    hardLimits: [
      'Загрузка файлов через облачный Bot API — до 50 МБ',
      'Подпись к медиа — до 1024 символов; длинный текст уходит отдельным сообщением',
      'Отложенную публикацию Telegram через Bot API не поддерживает — время соблюдает планировщик фабрики',
    ],
    docs: [{ label: 'Telegram Bot API', url: 'https://core.telegram.org/bots/api' }],
    aspect: '4:5',
  },
  vk: {
    id: 'vk',
    name: 'ВКонтакте',
    short: 'VK',
    hue: 214,
    mode: 'api',
    auth: 'oauth2',
    apiMedia: ['text', 'image', 'carousel', 'video'],
    preparedMedia: ['text', 'image', 'carousel', 'video'],
    accountTypes: 'Сообщество, где пользователь — администратор или редактор',
    permissions: ['wall', 'photos', 'video', 'groups', 'offline (через refresh token VK ID)'],
    review: 'Приложение VK ID (Web) с подтверждённым доменом; публичный доступ к методам не требует ревью',
    limits: {
      textMax: 15895,
      carouselMax: 10,
      videoMaxMb: 2048,
      imageMaxMb: 50,
      imageFormats: ['jpg', 'png', 'gif'],
      postsPerDay: 50,
      rate: '3 запроса в секунду на ключ пользователя; 50 записей в сутки на стене',
    },
    status: 'wall.post возвращает post_id — ссылка формируется как vk.com/wall-<group>_<post>',
    analytics: 'stats.getPostReach (охват, только для администраторов), wall.getById (лайки, репосты, просмотры)',
    hardLimits: [
      'Загрузка фото на стену сообщества требует ключа пользователя (ключ сообщества не подходит)',
      'Ключи VK ID живут ограниченное время — фабрика обновляет их refresh-токеном',
    ],
    docs: [
      { label: 'wall.post', url: 'https://dev.vk.com/ru/method/wall.post' },
      { label: 'VK ID OAuth 2.1', url: 'https://id.vk.com/about/business/go/docs/ru/vkid/latest/vk-id/connection/api-integration/api-description' },
    ],
    aspect: '4:5',
  },
  max: {
    id: 'max',
    name: 'MAX',
    short: 'MX',
    hue: 262,
    mode: 'api_review',
    auth: 'bot_token',
    apiMedia: ['text', 'image', 'video'],
    preparedMedia: ['text', 'image', 'carousel', 'video'],
    accountTypes: 'Канал или чат, куда добавлен бот организации',
    permissions: ['Токен бота (заголовок Authorization)', 'Бот — администратор канала'],
    review: 'С августа 2025 ботов создают только верифицированные юрлица РФ на платформе MAX для партнёров',
    limits: {
      textMax: 4000,
      videoMaxMb: 250,
      imageMaxMb: 50,
      imageFormats: ['jpg', 'png', 'gif', 'heic'],
      rate: 'Не больше 30 запросов в секунду',
    },
    status: 'POST /messages возвращает message.body.mid; при attachment.not.ready — повтор с паузой',
    analytics: 'Bot API не отдаёт статистику просмотров канала',
    hardLimits: [
      'Хост API — platform-api2.max.ru, токен только в заголовке',
      'Нужна верифицированная организация; ИП и физлица ботов создать не могут',
    ],
    docs: [
      { label: 'MAX Bot API', url: 'https://dev.max.ru/docs-api' },
      { label: 'Загрузка медиа', url: 'https://dev.max.ru/docs-api/methods/POST/uploads' },
    ],
    aspect: '4:5',
  },
  instagram: {
    id: 'instagram',
    name: 'Instagram',
    short: 'IG',
    hue: 330,
    mode: 'api_review',
    auth: 'oauth2',
    apiMedia: ['image', 'carousel', 'video'],
    preparedMedia: ['image', 'carousel', 'video'],
    accountTypes: 'Профессиональный аккаунт (бизнес или автор)',
    permissions: ['instagram_business_basic', 'instagram_business_content_publish'],
    review: 'Advanced Access через App Review в Meta; до одобрения — только тестировщики приложения',
    limits: {
      textMax: 2200,
      carouselMin: 2,
      carouselMax: 20,
      videoMaxSec: 900,
      imageFormats: ['jpg'],
      postsPerDay: 100,
      rate: '100 публикаций через API за скользящие 24 часа (карусель = 1)',
    },
    status: 'Контейнер → status_code FINISHED → media_publish; опрос раз в минуту не дольше 5 минут',
    analytics: 'Insights API: охват, просмотры, сохранения — требует instagram_business_manage_insights',
    hardLimits: [
      'Медиа должны лежать по публичному HTTPS-адресу: Meta скачивает их сама',
      'Изображения — только JPEG',
      'Текстовые посты без медиа не поддерживаются',
    ],
    docs: [{ label: 'Content Publishing', url: 'https://developers.facebook.com/docs/instagram-platform/content-publishing' }],
    aspect: '4:5',
  },
  threads: {
    id: 'threads',
    name: 'Threads',
    short: 'TH',
    hue: 0,
    mode: 'api_review',
    auth: 'oauth2',
    apiMedia: ['text', 'image', 'carousel', 'video'],
    preparedMedia: ['text', 'image', 'carousel', 'video'],
    accountTypes: 'Профиль Threads',
    permissions: ['threads_basic', 'threads_content_publish'],
    review: 'App Review в Meta для публичного доступа; до одобрения — тестировщики приложения',
    limits: {
      textMax: 500,
      carouselMin: 2,
      carouselMax: 20,
      videoMaxSec: 300,
      videoMaxMb: 1024,
      imageMaxMb: 8,
      imageFormats: ['jpg', 'png'],
      postsPerDay: 250,
      rate: '250 публикаций за 24 часа на профиль',
    },
    status: 'Контейнер → threads_publish → id; статус контейнера через ?fields=status',
    analytics: 'threads_manage_insights: просмотры, лайки, ответы, репосты',
    hardLimits: ['Медиа по публичному HTTPS-адресу', 'Текст — до 500 символов'],
    docs: [{ label: 'Threads API', url: 'https://developers.facebook.com/docs/threads/overview' }],
    aspect: '4:5',
  },
  youtube: {
    id: 'youtube',
    name: 'YouTube Shorts',
    short: 'YT',
    hue: 0,
    mode: 'api',
    auth: 'oauth2',
    apiMedia: ['video'],
    preparedMedia: ['video'],
    accountTypes: 'Канал YouTube (аккаунт Google)',
    permissions: ['https://www.googleapis.com/auth/youtube.upload', 'https://www.googleapis.com/auth/youtube.readonly'],
    review: 'Проект Google Cloud с экраном согласия OAuth; для внешних пользователей — верификация приложения Google',
    limits: {
      textMax: 5000,
      titleMax: 100,
      videoMaxSec: 180,
      rate: 'videos.insert — отдельная квота «Video Uploads», по умолчанию 100 вызовов в сутки',
    },
    status: 'videos.insert возвращает id и status.uploadStatus; обработку проверяем через videos.list',
    analytics: 'videos.list?part=statistics — просмотры, лайки, комментарии',
    hardLimits: [
      'Shorts определяется самим YouTube: вертикальное видео до 3 минут',
      'API не позволяет выбрать обложку Shorts',
    ],
    docs: [{ label: 'videos.insert', url: 'https://developers.google.com/youtube/v3/docs/videos/insert' }],
    aspect: '9:16',
  },
  tiktok: {
    id: 'tiktok',
    name: 'TikTok',
    short: 'TT',
    hue: 175,
    mode: 'api_review',
    auth: 'oauth2',
    apiMedia: ['video', 'carousel'],
    preparedMedia: ['video', 'carousel'],
    accountTypes: 'Аккаунт TikTok; до аудита приложения — только приватные аккаунты',
    permissions: ['user.info.basic', 'video.publish'],
    review: 'Аудит приложения TikTok. Без аудита все посты видны только автору (SELF_ONLY)',
    limits: {
      textMax: 2200,
      videoMaxSec: 600,
      rate: '6 запросов в минуту на токен пользователя; дневной лимит публикаций задаёт TikTok',
    },
    status: 'publish_id → /v2/post/publish/status/fetch/ до PUBLISH_COMPLETE',
    analytics: 'Display API: video.list (просмотры, лайки) — отдельный scope video.list',
    hardLimits: [
      'До аудита публикация возможна только в приватном режиме',
      'Перед публикацией нужно запросить creator_info и показать пользователю варианты приватности',
    ],
    docs: [
      { label: 'Content Posting API', url: 'https://developers.tiktok.com/doc/content-posting-api-get-started' },
      { label: 'Direct Post', url: 'https://developers.tiktok.com/doc/content-posting-api-reference-direct-post' },
    ],
    aspect: '9:16',
  },
  dzen: {
    id: 'dzen',
    name: 'Дзен',
    short: 'DZ',
    hue: 30,
    mode: 'manual',
    auth: 'none',
    apiMedia: [],
    preparedMedia: ['text', 'image', 'video'],
    accountTypes: 'Канал Дзена',
    permissions: [],
    review: 'Публичного API публикации нет',
    limits: { textMax: 100000, titleMax: 120 },
    status: 'Пользователь отмечает публикацию вручную и вставляет ссылку',
    analytics: 'Публичного API статистики нет — данные только в Студии Дзена',
    hardLimits: ['Публикация только через Студию Дзена', 'RSS-импорт доступен только сайтам с трафиком от 7000 дочитываний в неделю'],
    docs: [{ label: 'Дзен для авторов', url: 'https://dzen.ru/help/ru/' }],
    aspect: '16:9',
  },
  teletype: {
    id: 'teletype',
    name: 'Teletype',
    short: 'TY',
    hue: 45,
    mode: 'manual',
    auth: 'none',
    apiMedia: [],
    preparedMedia: ['text', 'image'],
    accountTypes: 'Блог Teletype',
    permissions: [],
    review: 'Публичного API публикации нет',
    limits: { textMax: 100000, titleMax: 120 },
    status: 'Пользователь отмечает публикацию вручную и вставляет ссылку',
    analytics: 'Публичного API статистики нет',
    hardLimits: ['Публикация только через редактор teletype.in'],
    docs: [{ label: 'teletype.in', url: 'https://teletype.in' }],
    aspect: '16:9',
  },
  vcru: {
    id: 'vcru',
    name: 'VC.ru',
    short: 'VC',
    hue: 350,
    mode: 'manual',
    auth: 'none',
    apiMedia: [],
    preparedMedia: ['text', 'image'],
    accountTypes: 'Профиль или блог компании на vc.ru',
    permissions: [],
    review: 'Официального документированного API публикации нет (неофициальная спецификация Osnova не обновлялась с 2022 г.)',
    limits: { textMax: 100000, titleMax: 120 },
    status: 'Пользователь отмечает публикацию вручную и вставляет ссылку',
    analytics: 'Публичного API статистики нет',
    hardLimits: ['Используем только ручную публикацию: неофициальный API может нарушать правила площадки'],
    docs: [{ label: 'vc.ru', url: 'https://vc.ru/about' }],
    aspect: '16:9',
  },
};

export const MODE_LABEL: Record<PublishMode, string> = {
  api: 'Автопубликация по API',
  api_review: 'API после одобрения платформы',
  manual: 'Ручная публикация (пакет материалов)',
};

export function isPlatformId(v: unknown): v is PlatformId {
  return typeof v === 'string' && (PLATFORM_IDS as readonly string[]).includes(v);
}

export function textLimitFor(platform: PlatformId, hasMedia: boolean): number {
  const l = PLATFORMS[platform].limits;
  return hasMedia && l.captionMax ? l.captionMax : l.textMax;
}
