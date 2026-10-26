import { Suspense } from 'react';
import { Link, useParams } from 'react-router';
import { AppErrorBoundary } from '../components/site/AppErrorBoundary';
import { LeadForm } from '../components/site/LeadForm';
import { Icon } from '../components/ui/Icon';
import { Spinner } from '../components/ui/Feedback';
import { PRODUCT_APPS } from '../products/apps';
import { getProduct, PRODUCTS } from '../products/registry';
import NotFoundPage from './NotFoundPage';

export default function ProductPage() {
  const { slug = '' } = useParams();
  const product = getProduct(slug);
  if (!product) return <NotFoundPage />;
  const App = PRODUCT_APPS[product.slug];

  return (
    <div data-product={product.slug}>
      <section className="phero">
        <div className="phero__glow" aria-hidden />
        <div className="container container--wide">
          <nav className="crumbs" aria-label="Хлебные крошки">
            <Link to="/">NORO</Link>
            <Icon name="chevronRight" size={12} />
            <Link to="/#products">Продукты</Link>
            <Icon name="chevronRight" size={12} />
            <span aria-current="page">{product.name}</span>
          </nav>
          <div className="phero__layout">
            <div className="reveal">
              <span className="eyebrow">{product.category} · демо-продукт</span>
              <h1 className="phero__title" style={{ marginTop: 14 }}>
                NORO <span>{product.name}</span>
              </h1>
              <p className="phero__tagline">{product.tagline}</p>
              <div className="chip-row" style={{ marginTop: 18 }} aria-label="Для кого">
                {product.audience.map((a) => (
                  <span key={a} className="badge badge--outline">
                    {a}
                  </span>
                ))}
              </div>
              <div className="hero__actions">
                <a href="#app" className="btn btn--primary btn--lg">
                  <Icon name="play" /> Открыть приложение
                </a>
                <a href="#order" className="btn btn--outline btn--lg">
                  Заказать подобную систему
                </a>
              </div>
            </div>
            <div className="phero__problem reveal reveal-2">
              <strong>Проблема</strong>
              <p>{product.problem}</p>
            </div>
          </div>
        </div>
      </section>

      <section className="container container--wide" aria-labelledby="scenario-title" style={{ paddingBottom: 28 }}>
        <h2 id="scenario-title" className="sr-only">
          Демонстрационный сценарий
        </h2>
        <ol className="scenario">
          {product.scenario.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ol>
      </section>

      <section id="app" className="container container--wide app-section" aria-label="Интерактивное приложение" style={{ scrollMarginTop: 'calc(var(--header-h) + 12px)' }}>
        <AppErrorBoundary product={product.slug}>
          <Suspense
            fallback={
              <div className="app" style={{ minHeight: 420, display: 'grid', placeItems: 'center' }}>
                <Spinner label="Загружаем приложение" />
              </div>
            }
          >
            {App ? <App /> : null}
          </Suspense>
        </AppErrorBoundary>
      </section>

      <section className="section section--line">
        <div className="container container--wide" style={{ display: 'grid', gap: 16 }}>
          <div className="section-head">
            <span className="eyebrow">Как это работает</span>
            <h2 className="section-title">Первое использование за пару минут</h2>
          </div>
          <div className="info-grid">
            <div className="info-card">
              <h3>
                <Icon name="list" /> Инструкция
              </h3>
              <ol>
                {product.howTo.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ol>
            </div>
            <div className="info-card">
              <h3>
                <Icon name="database" /> Требования к данным
              </h3>
              <ul>
                {product.data.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
              <h3 style={{ marginTop: 8 }}>
                <Icon name="alert" /> Ограничения демоверсии
              </h3>
              <ul>
                {product.limits.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
            </div>
          </div>

          <div className="caps" style={{ marginTop: 8 }}>
            <div className="caps__col">
              <h3>
                <span className="cap cap--live" aria-hidden /> Работает сейчас
              </h3>
              <ul>
                {product.live.map((s) => (
                  <li key={s}>
                    <Icon name="check" size={14} style={{ color: 'var(--good)' }} />
                    {s}
                  </li>
                ))}
              </ul>
            </div>
            <div className="caps__col">
              <h3>
                <span className="cap cap--connect" aria-hidden /> Требует подключения
              </h3>
              <ul>
                {product.connect.map((s) => (
                  <li key={s}>
                    <Icon name="plug" size={14} style={{ color: 'var(--warning)' }} />
                    {s}
                  </li>
                ))}
              </ul>
            </div>
            <div className="caps__col">
              <h3>
                <span className="cap cap--future" aria-hidden /> Возможное расширение
              </h3>
              <ul>
                {product.future.map((s) => (
                  <li key={s}>
                    <Icon name="plus" size={14} style={{ color: 'var(--text-3)' }} />
                    {s}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      <section className="section section--line" id="order" style={{ scrollMarginTop: 'var(--header-h)' }}>
        <div className="container container--wide order">
          <div className="order__aside">
            <span className="eyebrow">Индивидуальная версия</span>
            <h2 className="section-title">{product.orderLabel}</h2>
            <p className="muted">Демо показывает подход. В рабочей версии систему настраиваем под ваши данные, процессы и инструменты.</p>
            <ul className="order__points">
              {product.custom.map((c) => (
                <li key={c}>
                  <Icon name="checkCircle" />
                  {c}
                </li>
              ))}
            </ul>
            <div>
              <div className="field__label" style={{ marginBottom: 8 }}>
                Возможные интеграции
              </div>
              <div className="chip-row">
                {product.integrations.map((i) => (
                  <span key={i} className="integr__item" style={{ fontSize: 'var(--fs-xs)' }}>
                    {i}
                  </span>
                ))}
              </div>
              <p className="dim" style={{ fontSize: 'var(--fs-xs)', marginTop: 8 }}>
                Интеграции настраиваются в проекте: в демо они не активны.
              </p>
            </div>
          </div>
          <LeadForm product={product.slug} />
        </div>
      </section>

      <section className="section--tight section--line">
        <div className="container container--wide" style={{ display: 'grid', gap: 16 }}>
          <h2 style={{ fontSize: 'var(--fs-xl)' }}>Другие продукты NORO</h2>
          <div className="other-products">
            {PRODUCTS.filter((p) => p.slug !== product.slug).map((p) => (
              <Link key={p.slug} to={`/products/${p.slug}`} data-product={p.slug}>
                <span style={{ color: 'var(--accent)', display: 'inline-flex', gap: 8, alignItems: 'center', fontWeight: 600 }}>
                  <Icon name={p.icon} size={16} /> {p.name}
                </span>
                <small>{p.short}</small>
              </Link>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
