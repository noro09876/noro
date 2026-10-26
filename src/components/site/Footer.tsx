import { Link } from 'react-router';
import { SITE } from '../../config/site';
import { PRODUCTS } from '../../products/registry';
import { LogoMark } from './Logo';

export function Footer() {
  return (
    <footer className="footer">
      <div className="container container--wide">
        <div className="footer__grid">
          <div style={{ display: 'grid', gap: 14, alignContent: 'start' }}>
            <Link to="/" className="logo">
              <LogoMark /> NORO
            </Link>
            <p className="muted" style={{ fontSize: 'var(--fs-sm)', maxWidth: '40ch' }}>
              Разработка систем автоматизации: заявки, поддержка, документы, каталоги, контент и аналитика. Продукты на сайте — демонстрационные версии, которые мы адаптируем под задачи компании.
            </p>
          </div>
          <div>
            <div className="footer__title">Продукты</div>
            <ul>
              {PRODUCTS.map((p) => (
                <li key={p.slug}>
                  <Link to={`/products/${p.slug}`}>{p.name}</Link>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <div className="footer__title">Компания</div>
            <ul>
              <li><Link to="/#tasks">Какие задачи решаем</Link></li>
              <li><Link to="/#process">Процесс разработки</Link></li>
              <li><Link to="/#integrations">Интеграции</Link></li>
              <li><Link to="/#faq">Вопросы и ответы</Link></li>
              <li><Link to="/privacy">Данные и конфиденциальность</Link></li>
            </ul>
          </div>
          <div>
            <div className="footer__title">Связаться</div>
            <ul>
              <li><Link to="/contact">Форма заявки</Link></li>
              {SITE.contacts.telegram ? (
                <li>
                  <a href={`https://t.me/${SITE.contacts.telegram}`} rel="noopener noreferrer" target="_blank">
                    Telegram: @{SITE.contacts.telegram}
                  </a>
                </li>
              ) : null}
              {SITE.contacts.email ? (
                <li>
                  <a href={`mailto:${SITE.contacts.email}`}>{SITE.contacts.email}</a>
                </li>
              ) : null}
            </ul>
          </div>
        </div>
        <div className="footer__bottom">
          <span>© {new Date().getFullYear()} NORO</span>
          <span>Демо-данные на сайте вымышлены. Файлы, загруженные в демо, обрабатываются в вашем браузере.</span>
        </div>
      </div>
    </footer>
  );
}
