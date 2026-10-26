import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router';
import { PRODUCTS } from '../../products/registry';
import { Icon } from '../ui/Icon';
import { LogoMark } from './Logo';

export function Header() {
  const [scrolled, setScrolled] = useState(false);
  const [mobile, setMobile] = useState(false);
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const location = useLocation();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    setMobile(false);
    setMenu(false);
  }, [location.pathname, location.hash]);

  useEffect(() => {
    if (!menu) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenu(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMenu(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [menu]);

  useEffect(() => {
    document.body.style.overflow = mobile ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [mobile]);

  return (
    <header className="header" data-scrolled={scrolled || mobile}>
      <div className="container container--wide header__inner">
        <Link to="/" className="logo" aria-label="NORO — на главную">
          <LogoMark />
          NORO
        </Link>
        <nav className="nav" aria-label="Основная навигация">
          <div className="products-menu" ref={menuRef}>
            <button type="button" className="nav__link" aria-expanded={menu} aria-controls="products-menu" onClick={() => setMenu((m) => !m)}>
              Продукты <Icon name="chevronDown" size={14} />
            </button>
            {menu ? (
              <div className="products-menu__panel" id="products-menu">
                {PRODUCTS.map((p) => (
                  <Link key={p.slug} to={`/products/${p.slug}`} className="products-menu__item" data-product={p.slug}>
                    <span className="products-menu__icon">
                      <Icon name={p.icon} size={17} />
                    </span>
                    <span>
                      <span className="products-menu__name">{p.name}</span>
                      <br />
                      <span className="products-menu__desc">{p.short}</span>
                    </span>
                  </Link>
                ))}
              </div>
            ) : null}
          </div>
          <Link to="/#tasks">Задачи</Link>
          <Link to="/#process">Как работаем</Link>
          <Link to="/#integrations">Интеграции</Link>
          <Link to="/#faq">Вопросы</Link>
        </nav>
        <div className="header__cta">
          <Link to="/#products" className="btn btn--ghost btn--sm">
            Попробовать демо
          </Link>
          <Link to="/contact" className="btn btn--signal btn--sm">
            Обсудить задачу
          </Link>
          <button type="button" className="btn btn--ghost btn--icon menu-btn" aria-label={mobile ? 'Закрыть меню' : 'Открыть меню'} aria-expanded={mobile} aria-controls="mobile-nav" onClick={() => setMobile((m) => !m)}>
            <Icon name={mobile ? 'x' : 'menu'} />
          </button>
        </div>
      </div>
      {mobile ? (
        <nav className="mobile-nav" id="mobile-nav" aria-label="Мобильная навигация">
          {PRODUCTS.map((p) => (
            <Link key={p.slug} to={`/products/${p.slug}`} data-product={p.slug}>
              <span className="products-menu__icon">
                <Icon name={p.icon} size={17} />
              </span>
              <span>
                NORO {p.name}
                <br />
                <small className="dim">{p.short}</small>
              </span>
            </Link>
          ))}
          <Link to="/#tasks">Какие задачи автоматизируем</Link>
          <Link to="/#process">Как работаем</Link>
          <Link to="/#faq">Вопросы</Link>
          <NavLink to="/contact">Обсудить задачу</NavLink>
        </nav>
      ) : null}
    </header>
  );
}
