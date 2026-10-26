import { Link } from 'react-router';
import { Icon } from '../components/ui/Icon';
import { PRODUCTS } from '../products/registry';

export default function NotFoundPage() {
  return (
    <section className="section">
      <div className="container" style={{ display: 'grid', gap: 20, justifyItems: 'start', maxWidth: 820 }}>
        <span className="eyebrow">Ошибка 404</span>
        <h1 className="section-title">Такой страницы нет</h1>
        <p className="muted">Возможно, ссылка устарела или в адресе опечатка. Вот куда можно перейти:</p>
        <div className="btn-row">
          <Link to="/" className="btn btn--signal">
            <Icon name="arrowLeft" /> На главную
          </Link>
          <Link to="/contact" className="btn btn--outline">
            Обсудить задачу
          </Link>
        </div>
        <ul className="list-reset" style={{ display: 'grid', gap: 8, marginTop: 10 }}>
          {PRODUCTS.map((p) => (
            <li key={p.slug}>
              <Link to={`/products/${p.slug}`}>NORO {p.name}</Link> <span className="dim">— {p.short.toLowerCase()}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
