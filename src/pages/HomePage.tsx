import { Link } from 'react-router';
import { FlowDiagram } from '../components/home/FlowDiagram';
import { HeroConsole } from '../components/home/HeroConsole';
import { InView } from '../components/home/InView';
import { MiniPreview } from '../components/home/MiniPreview';
import { LeadForm } from '../components/site/LeadForm';
import { Icon, type IconName } from '../components/ui/Icon';
import { PRODUCTS, type ProductSlug } from '../products/registry';

const DEPARTMENTS: Array<{ slug: ProductSlug; topic: string; icon: IconName; title: string; tasks: string[]; cta: string }> = [
  { slug: 'lead-engine', topic: 'sales', icon: 'target', title: 'Продажи', tasks: ['Сбор заявок из форм, почты и таблиц', 'Очистка базы, поиск дублей', 'Приоритизация по правилам или модели', 'Персональные письма и задачи менеджерам'], cta: 'Автоматизировать продажи' },
  { slug: 'support', topic: 'support', icon: 'message', title: 'Поддержка', tasks: ['Ответы на типовые вопросы по базе знаний', 'Классификация и приоритет обращений', 'Передача оператору с контекстом', 'Отчёты по темам обращений'], cta: 'Разгрузить поддержку' },
  { slug: 'docs-intelligence', topic: 'docs', icon: 'fileText', title: 'Документы', tasks: ['Извлечение реквизитов из счетов и актов', 'Проверка ИНН, счетов, НДС и сумм', 'Реестры документов и сверка', 'Выгрузка в учётные системы'], cta: 'Автоматизировать документы' },
  { slug: 'catalog-studio', topic: 'catalog', icon: 'box', title: 'Каталоги', tasks: ['Приведение прайсов к единому формату', 'Проверка цен, артикулов, штрихкодов', 'Описания и SEO-заголовки по шаблонам', 'Подготовка выгрузок для площадок'], cta: 'Навести порядок в каталоге' },
  { slug: 'content-os', topic: 'content', icon: 'layers', title: 'Контент', tasks: ['Переупаковка материала под площадки', 'Тезисы, заголовки, сценарии роликов', 'Календарь и статусы публикаций', 'Единые правила тона и CTA'], cta: 'Наладить контент-процесс' },
  { slug: 'business-intelligence', topic: 'analytics', icon: 'chart', title: 'Аналитика', tasks: ['Сводные показатели из выгрузок', 'Сравнение периодов и разрезов', 'Поиск аномалий по правилам', 'Регулярные отчёты в мессенджер'], cta: 'Собрать отчётность' },
];

const PROCESS = [
  { title: 'Разбор задачи', text: 'Смотрим процесс, объёмы и данные. Определяем, что даст эффект первым.', out: 'карта процесса и список данных' },
  { title: 'Прототип на ваших данных', text: 'Собираем рабочую версию ключевого сценария на выгрузке из ваших систем.', out: 'проверяемый прототип' },
  { title: 'Разработка и интеграции', text: 'Подключаем CRM, учётные системы, каналы, модели. Пишем тесты.', out: 'рабочая система' },
  { title: 'Запуск', text: 'Переносим на вашу инфраструктуру или облако, обучаем сотрудников.', out: 'инструкции и доступы' },
  { title: 'Развитие', text: 'Отслеживаем качество, дорабатываем правила и добавляем сценарии.', out: 'план улучшений' },
];

const INTEGRATIONS: Array<{ title: string; items: string[] }> = [
  { title: 'CRM и продажи', items: ['amoCRM', 'Битрикс24', 'HubSpot', 'Google Sheets'] },
  { title: 'Учёт и документы', items: ['1С', 'МойСклад', 'Диадок', 'СБИС'] },
  { title: 'Каналы', items: ['Telegram', 'VK', 'Почта', 'Виджет сайта'] },
  { title: 'Площадки и данные', items: ['Ozon', 'Wildberries', 'Яндекс Метрика', 'PostgreSQL', 'ClickHouse', 'Языковые модели через API'] },
];

const FAQ: Array<{ q: string; a: string[] }> = [
  { q: 'Это готовые продукты или примеры?', a: ['Это демонстрационные версии, которые мы разработали, чтобы показать подход и качество работы. Они полностью работают на ваших файлах, но не подключены к внешним системам.', 'Для компании мы делаем индивидуальную версию: под её данные, процессы и инструменты.'] },
  { q: 'Сколько стоит разработка?', a: ['Стоимость зависит от объёма: количества сценариев, интеграций и требований к инфраструктуре. Поэтому в форме мы просим указать ориентировочный бюджет — так проще предложить подходящий первый этап.', 'Обычно начинаем с небольшого этапа, результат которого можно проверить на ваших данных.'] },
  { q: 'Где хранятся данные?', a: ['В демо — только в вашем браузере, файлы не уходят на сервер. В рабочей системе — там, где решите вы: в вашей инфраструктуре или в выбранном облаке. Это обсуждается до начала разработки.'] },
  { q: 'Вы используете ИИ? Какие модели?', a: ['Там, где это даёт пользу. Многие задачи надёжнее решаются правилами и проверками — например, контрольные суммы реквизитов. Языковые модели подключаем через серверную часть для формулировки ответов, разбора нестандартных документов и генерации текстов.', 'В демо модели отключены, и интерфейс прямо об этом говорит: ответы строятся локальными алгоритмами.'] },
  { q: 'Можно интегрировать с нашей CRM или 1С?', a: ['Да, если у системы есть API или выгрузка. На странице каждого продукта указано, какие интеграции типичны. Конкретный способ подключения определяем на этапе разбора задачи.'] },
  { q: 'Наша задача не похожа ни на один из продуктов', a: ['Шесть продуктов показывают направления. Чаще всего задача — комбинация: например, заявки из почты → проверка документов → запись в CRM → отчёт в Telegram. Опишите процесс в форме, и мы предложим решение.'] },
  { q: 'Что будет после запуска?', a: ['Условия поддержки и развития обсуждаются отдельно и фиксируются в договоре: исправление ошибок, доработка правил, новые сценарии.'] },
];

export function HomePage() {
  return (
    <>
      <section className="hero">
        <div className="hero__grid-bg" aria-hidden />
        <div className="hero__glow" aria-hidden />
        <div className="container container--wide hero__layout">
          <div>
            <span className="eyebrow reveal reveal-1">Разработка систем автоматизации</span>
            <h1 className="hero__title reveal reveal-2" style={{ marginTop: 18 }}>
              Системы, которые берут на себя <em>заявки, документы и данные</em>
            </h1>
            <p className="hero__lead reveal reveal-3">
              NORO разрабатывает инструменты для продаж, поддержки, документооборота, каталогов, контента и аналитики. Ниже — шесть работающих продуктов: загрузите свои данные и проверьте результат без регистрации.
            </p>
            <div className="hero__actions reveal reveal-4">
              <a href="#products" className="btn btn--signal btn--lg">
                <Icon name="play" /> Протестировать продукты
              </a>
              <Link to="/contact" className="btn btn--outline btn--lg">
                Обсудить задачу <Icon name="arrowRight" />
              </Link>
            </div>
            <div className="hero__facts reveal reveal-5">
              <span>
                <Icon name="check" size={16} /> Без регистрации
              </span>
              <span>
                <Icon name="lock" size={16} /> Файлы не покидают браузер
              </span>
              <span>
                <Icon name="eye" size={16} /> Видно, как посчитан каждый результат
              </span>
            </div>
          </div>
          <HeroConsole />
        </div>
      </section>

      <section className="section section--line" id="tasks" style={{ scrollMarginTop: 'var(--header-h)' }}>
        <div className="container container--wide">
          <InView className="section-head">
            <span className="eyebrow">Что передать автоматизации</span>
            <h2 className="section-title">Повторяющаяся работа с данными, которую можно описать правилами</h2>
            <p className="section-lead">Если сотрудник каждый день копирует, проверяет и сортирует одно и то же — это кандидат на автоматизацию. Вот направления, с которыми мы работаем.</p>
          </InView>
          <div className="dept-grid">
            {DEPARTMENTS.map((d, i) => (
              <InView key={d.slug} className="dept" delay={i * 60}>
                <div data-product={d.slug} style={{ display: 'grid', gap: 14, height: '100%' }}>
                  <div className="dept__head">
                    <span className="dept__icon">
                      <Icon name={d.icon} />
                    </span>
                    <h3 className="dept__title">{d.title}</h3>
                  </div>
                  <ul>
                    {d.tasks.map((t) => (
                      <li key={t}>{t}</li>
                    ))}
                  </ul>
                  <div className="btn-row" style={{ marginTop: 'auto', gap: 14 }}>
                    <Link className="dept__cta" to={`/contact?topic=${d.topic}&product=${d.slug}`}>
                      {d.cta} <Icon name="arrowRight" size={15} />
                    </Link>
                    <Link className="dept__cta" style={{ color: 'var(--text-2)', fontWeight: 500 }} to={`/products/${d.slug}`}>
                      Демо
                    </Link>
                  </div>
                </div>
              </InView>
            ))}
          </div>
        </div>
      </section>

      <section className="section section--line" id="products" style={{ scrollMarginTop: 'var(--header-h)' }}>
        <div className="container container--wide">
          <InView className="section-head">
            <span className="eyebrow">Шесть работающих продуктов</span>
            <h2 className="section-title">Откройте любой — и начните с демо-данных или своего файла</h2>
            <p className="section-lead">Каждый продукт — отдельное приложение со своей логикой, проверками и экспортом. Всё считается в браузере, а ограничения демо указаны прямо в интерфейсе.</p>
          </InView>
          <div className="product-grid">
            {PRODUCTS.map((p, i) => (
              <InView key={p.slug} delay={(i % 2) * 80}>
                <Link to={`/products/${p.slug}`} className="pcard" data-product={p.slug} aria-label={`NORO ${p.name} — ${p.short}. Открыть демо`}>
                  <div className="pcard__preview">
                    <MiniPreview slug={p.slug} />
                  </div>
                  <div className="pcard__body">
                    <div className="pcard__meta">
                      <span className="badge badge--accent">
                        <Icon name={p.icon} /> {p.category}
                      </span>
                      <span className="cap cap--live">работает в браузере</span>
                    </div>
                    <h3 className="pcard__name">{p.name}</h3>
                    <p className="pcard__text">{p.tagline}</p>
                    <span className="pcard__go">
                      Открыть демо <Icon name="arrowRight" size={16} />
                    </span>
                  </div>
                </Link>
              </InView>
            ))}
          </div>
        </div>
      </section>

      <section className="section section--line">
        <div className="container container--wide" style={{ display: 'grid', gap: 32 }}>
          <InView className="section-head" >
            <span className="eyebrow">Как устроена автоматизация</span>
            <h2 className="section-title">Данные приходят из разных мест — система приводит их в порядок и отправляет туда, где с ними работают</h2>
          </InView>
          <InView>
            <FlowDiagram />
          </InView>
          <div className="caps">
            <InView className="caps__col">
              <h3>
                <span className="cap cap--live" aria-hidden /> Работает сейчас
              </h3>
              <ul>
                <li><Icon name="check" size={14} style={{ color: 'var(--good)' }} />Импорт, проверки, расчёты и экспорт во всех шести продуктах</li>
                <li><Icon name="check" size={14} style={{ color: 'var(--good)' }} />Поиск по базе знаний и ответы с источниками</li>
                <li><Icon name="check" size={14} style={{ color: 'var(--good)' }} />Сохранение результатов в браузере</li>
              </ul>
            </InView>
            <InView className="caps__col" delay={80}>
              <h3>
                <span className="cap cap--connect" aria-hidden /> Требует подключения
              </h3>
              <ul>
                <li><Icon name="plug" size={14} style={{ color: 'var(--warning)' }} />CRM, 1С, маркетплейсы и каналы связи — по API</li>
                <li><Icon name="plug" size={14} style={{ color: 'var(--warning)' }} />Языковые модели — через серверную часть, без ключей в браузере</li>
                <li><Icon name="plug" size={14} style={{ color: 'var(--warning)' }} />OCR для сканов документов</li>
              </ul>
            </InView>
            <InView className="caps__col" delay={160}>
              <h3>
                <span className="cap cap--future" aria-hidden /> Возможное расширение
              </h3>
              <ul>
                <li><Icon name="plus" size={14} style={{ color: 'var(--text-3)' }} />Модели, обученные на вашей истории сделок</li>
                <li><Icon name="plus" size={14} style={{ color: 'var(--text-3)' }} />Прогнозы и когортная аналитика</li>
                <li><Icon name="plus" size={14} style={{ color: 'var(--text-3)' }} />Командная работа и права доступа</li>
              </ul>
            </InView>
          </div>
        </div>
      </section>

      <section className="section section--line" id="process" style={{ scrollMarginTop: 'var(--header-h)' }}>
        <div className="container container--wide">
          <InView className="section-head">
            <span className="eyebrow">Индивидуальная разработка</span>
            <h2 className="section-title">От разбора задачи до работающей системы</h2>
            <p className="section-lead">Каждый этап заканчивается результатом, который можно проверить. Решение о следующем этапе принимаете вы.</p>
          </InView>
          <ol className="process list-reset">
            {PROCESS.map((p, i) => (
              <InView key={p.title} as="li" className="process__step" delay={i * 70}>
                <span className="process__title">{p.title}</span>
                <span className="process__text">{p.text}</span>
                <span className="process__out">→ {p.out}</span>
              </InView>
            ))}
          </ol>
        </div>
      </section>

      <section className="section section--line" id="integrations" style={{ scrollMarginTop: 'var(--header-h)' }}>
        <div className="container container--wide">
          <InView className="section-head">
            <span className="eyebrow">Интеграции</span>
            <h2 className="section-title">Подключаемся к системам, в которых вы уже работаете</h2>
            <p className="section-lead">Подключение настраивается в проекте под ваши доступы и требования безопасности. В демо интеграции не активны.</p>
          </InView>
          <div className="integr">
            {INTEGRATIONS.map((g, i) => (
              <InView key={g.title} className="integr__group" delay={i * 60}>
                <span className="integr__title">{g.title}</span>
                <div className="integr__items">
                  {g.items.map((it) => (
                    <span key={it} className="integr__item">
                      {it}
                    </span>
                  ))}
                </div>
              </InView>
            ))}
          </div>
        </div>
      </section>

      <section className="section section--line" id="faq" style={{ scrollMarginTop: 'var(--header-h)' }}>
        <div className="container" style={{ maxWidth: 960 }}>
          <InView className="section-head">
            <span className="eyebrow">Вопросы</span>
            <h2 className="section-title">Что обычно спрашивают перед началом</h2>
          </InView>
          <div className="faq">
            {FAQ.map((f) => (
              <details key={f.q}>
                <summary>
                  {f.q}
                  <Icon name="plus" />
                </summary>
                <div className="faq__answer">
                  {f.a.map((p) => (
                    <p key={p}>{p}</p>
                  ))}
                </div>
              </details>
            ))}
          </div>
        </div>
      </section>

      <section className="section section--line" id="order" style={{ scrollMarginTop: 'var(--header-h)' }}>
        <div className="container container--wide order">
          <div className="order__aside">
            <span className="eyebrow">Заявка</span>
            <h2 className="section-title">Опишите процесс, который отнимает время</h2>
            <p className="muted">Ответим вопросами по задаче и предложим первый этап. Если задачу проще решить готовым сервисом — скажем об этом.</p>
            <ul className="order__points">
              <li><Icon name="checkCircle" /> Достаточно пары предложений о задаче</li>
              <li><Icon name="checkCircle" /> Можно приложить пример данных позже</li>
              <li><Icon name="checkCircle" /> Без обязательств и рассылок</li>
            </ul>
          </div>
          <LeadForm />
        </div>
      </section>

      <section className="section--tight">
        <div className="container container--wide">
          <div className="final-cta">
            <span className="eyebrow">Начните с проверки</span>
            <h2>Загрузите свою выгрузку в любой продукт — и посмотрите, что можно автоматизировать</h2>
            <div className="btn-row" style={{ justifyContent: 'center' }}>
              <a href="#products" className="btn btn--signal btn--lg">
                Выбрать продукт
              </a>
              <Link to="/contact" className="btn btn--outline btn--lg">
                Обсудить задачу
              </Link>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
