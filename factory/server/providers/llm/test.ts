import type { PlanEntry } from '../../../shared/types';
import type { LlmProvider } from '../types';

/**
 * Deterministic TEST provider. Exists so the whole pipeline (queues, versions, rendering,
 * publishing) can be exercised in automated tests and local demos without a paid key.
 * Every string it produces starts with «[ТЕСТ]» and versions are stored with source=test,
 * so its output can never be mistaken for model output. Disabled unless ALLOW_TEST_PROVIDERS=1.
 */
const T = (s: string) => (s.startsWith("[ТЕСТ]") ? s : `[ТЕСТ] ${s}`);

export const testLlm: LlmProvider = {
  info: {
    id: 'test',
    kind: 'llm',
    name: 'Тестовый провайдер (не ИИ)',
    setup: 'Детерминированная заглушка для автотестов. Тексты помечены «[ТЕСТ]» и не являются результатом модели.',
    defaultModel: 'deterministic-v1',
    needsKey: false,
    testOnly: true,
    fields: [],
  },
  async check() {
    return 'Тестовый провайдер активен (не ИИ)';
  },
  async generate(_rt, req) {
    const c = (req.context ?? {}) as Record<string, any>;
    const topic: string = c.topic ?? c.brief?.task ?? 'тема';
    let data: unknown;
    switch (req.schemaName) {
      case 'strategy': {
        const brief = c.brief;
        const plan: PlanEntry[] = [];
        const kinds = brief.formats as string[];
        const total = Math.min(brief.frequency * brief.weeks, 12);
        for (let i = 0; i < total; i++) {
          plan.push({
            day: Math.floor((i * 7) / brief.frequency),
            time: i % 2 ? '18:00' : '10:00',
            kind: kinds[i % kinds.length] as PlanEntry['kind'],
            pillar: i % 2 ? 'Продукт' : 'Экспертиза',
            topic: T(`Материал ${i + 1}: ${String(brief.task).slice(0, 60)}`),
            angle: T('Угол подачи для проверки конвейера'),
            platforms: brief.platforms,
          });
        }
        data = {
          strategy: {
            summary: T(`Стратегия для задачи «${String(brief.task).slice(0, 80)}»`),
            positioning: T('Позиционирование'),
            pillars: [
              { name: 'Экспертиза', description: T('Рубрика экспертизы') },
              { name: 'Продукт', description: T('Рубрика продукта') },
            ],
            keyMessages: [T('Ключевое сообщение 1'), T('Ключевое сообщение 2')],
            audienceInsights: [T('Инсайт 1'), T('Инсайт 2')],
            tone: T('Тон коммуникации'),
            kpis: [T('KPI')],
          },
          plan,
        };
        break;
      }
      case 'post':
        data = { headline: T(topic).slice(0, 120), body: T(`Текст поста по теме «${topic}». Этот текст создан тестовым провайдером для проверки конвейера.`), cta: T('Призыв к действию'), hashtags: ['тест', 'noro'] };
        break;
      case 'carousel':
        data = {
          title: T(topic).slice(0, 110),
          caption: T(`Подпись к карусели «${topic}»`),
          hashtags: ['тест'],
          slides: [
            { kicker: 'ТЕСТ', title: T('Слайд 1'), body: T('Описание'), visual: { type: 'stat', value: '42%', label: 'тестовое значение' } },
            { title: T('Слайд 2'), body: T('Описание'), visual: { type: 'steps', items: ['Шаг 1', 'Шаг 2', 'Шаг 3'] } },
            { title: T('Слайд 3'), body: T('Описание') },
          ],
        };
        break;
      case 'graphic':
        data = { headline: T(topic).slice(0, 80), subline: T('Подзаголовок'), caption: T(`Подпись к графике «${topic}»`), visual: { type: 'chart', points: [3, 5, 4, 7, 9], label: 'тест' } };
        break;
      case 'video_script':
        data = {
          title: T(topic).slice(0, 90),
          hook: T('Хук'),
          caption: T(`Описание ролика «${topic}»`),
          hashtags: ['тест'],
          scenes: [
            { id: 's1', kind: 'hook', title: 'Тестовый ролик', voiceover: 'Это тестовая озвучка первой сцены.', durationSec: 2.5 },
            { id: 's2', kind: 'ui', title: 'Интерфейс', voiceover: 'Вторая сцена показывает интерфейс.', durationSec: 3, visual: { type: 'ui', title: 'Тест', rows: [{ label: 'Строка', value: '1' }, { label: 'Строка', value: '2', tone: 'good' }] } },
            { id: 's3', kind: 'cta', title: 'Конец теста', voiceover: 'Конец тестового ролика.', durationSec: 2.5 },
          ],
        };
        break;
      default:
        throw new Error(`Unknown schema ${req.schemaName}`);
    }
    return { data: req.schema.parse(data), model: 'test/deterministic-v1', usage: {} };
  },
};
