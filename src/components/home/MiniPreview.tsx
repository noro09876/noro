import type { ProductSlug } from '../../products/registry';
import { Icon } from '../ui/Icon';

/** Small decorative interface previews for product cards (aria-hidden). */
export function MiniPreview({ slug }: { slug: ProductSlug }) {
  switch (slug) {
    case 'lead-engine':
      return (
        <div className="mini" aria-hidden>
          <div className="mini__win">
            {[
              ['A·86', 'score--A', 'Коммерческий директор · Дистрибуция', 90],
              ['A·70', 'score--A', 'Основатель · E-commerce', 74],
              ['B·48', 'score--B', 'Руководитель продаж · Ритейл', 50],
              ['C·12', 'score--C', 'Стажёр · IT', 14],
            ].map(([s, c, t, w]) => (
              <div className="mini__row" key={String(s)}>
                <span className={`mini__pill ${c}`}>{s}</span>
                <span>{t}</span>
                <span className="mini__bar" style={{ width: Number(w) * 0.6, background: 'var(--accent)', opacity: 0.7 }} />
              </div>
            ))}
          </div>
        </div>
      );
    case 'support':
      return (
        <div className="mini" aria-hidden>
          <div className="mini__bubble mini__bubble--me">Можно вернуть товар через 10 дней?</div>
          <div className="mini__bubble">
            Да, вернуть товар надлежащего качества можно в течение 14 дней, если сохранены упаковка и чек.
            <div>
              <span className="mini__src">
                <Icon name="book" size={10} /> Возврат и обмен
              </span>
              <span className="mini__src">уверенность 0,82</span>
            </div>
          </div>
        </div>
      );
    case 'content-os':
      return (
        <div className="mini" aria-hidden>
          <div className="mini__cols">
            {['Telegram', 'VK', 'Shorts'].map((p, i) => (
              <div key={p} className="mini__win" style={{ padding: 8, display: 'grid', gap: 5 }}>
                <b style={{ color: 'var(--accent)', fontSize: 10 }}>{p}</b>
                <span className="mini__bar" style={{ width: '90%' }} />
                <span className="mini__bar" style={{ width: '70%' }} />
                <span className="mini__bar" style={{ width: i === 2 ? '40%' : '80%' }} />
                <span className="badge" style={{ height: 16, fontSize: 9, width: 'fit-content' }}>{['готово', 'проверка', 'черновик'][i]}</span>
              </div>
            ))}
          </div>
          <div className="mini__win" style={{ padding: 8, display: 'flex', gap: 4 }}>
            {Array.from({ length: 14 }, (_, i) => (
              <span key={i} style={{ flex: 1, height: 18, borderRadius: 3, background: [2, 5, 9, 12].includes(i) ? 'var(--accent)' : 'var(--surface-3)', opacity: [2, 5, 9, 12].includes(i) ? 0.85 : 1 }} />
            ))}
          </div>
        </div>
      );
    case 'docs-intelligence':
      return (
        <div className="mini" aria-hidden>
          <div className="mini__win" style={{ padding: 10, display: 'grid', gap: 4, fontFamily: 'var(--font-mono)', fontSize: 10 }}>
            <span>СЧЁТ НА ОПЛАТУ № <span className="mini__hl">418</span> от <span className="mini__hl">14.10.2026</span></span>
            <span>ИНН <span className="mini__hl">7708123450</span> КПП <span className="mini__hl">770801001</span></span>
            <span>Всего к оплате: <span className="mini__hl">124 800,00</span></span>
          </div>
          <div className="mini__win">
            {[
              ['ИНН', '✓ контрольная сумма', 'var(--good)'],
              ['Р/с + БИК', '✓ ключ счёта', 'var(--good)'],
              ['НДС 20%', '! расхождение', 'var(--warning)'],
            ].map(([k, v, c]) => (
              <div className="mini__row" key={k} style={{ gridTemplateColumns: '70px 1fr' }}>
                <span>{k}</span>
                <span style={{ color: c }}>{v}</span>
              </div>
            ))}
          </div>
        </div>
      );
    case 'catalog-studio':
      return (
        <div className="mini" aria-hidden>
          <div className="mini__win">
            {[
              ['Цена', '1 299,00 руб.', '1299.00'],
              ['Артикул', 'ark-01052', 'ARK-01052'],
              ['SEO', '—', 'Arkto Чайник — купить'],
            ].map(([k, a, b]) => (
              <div className="mini__row" key={k} style={{ gridTemplateColumns: '54px 1fr 1fr' }}>
                <span className="dim">{k}</span>
                <span style={{ textDecoration: 'line-through', color: 'var(--text-3)' }}>{a}</span>
                <span style={{ color: 'var(--good)' }}>{b}</span>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <span className="badge badge--warning">дубли: 4</span>
            <span className="badge badge--critical">EAN: 1</span>
            <span className="badge badge--good">исправлено: 27</span>
          </div>
        </div>
      );
    case 'business-intelligence':
      return (
        <div className="mini" aria-hidden>
          <div className="mini__cols">
            {[
              ['Выручка', '+12%'],
              ['Заказы', '+8%'],
              ['Ср. чек', '+4%'],
            ].map(([k, v]) => (
              <div key={k} className="mini__win" style={{ padding: 8 }}>
                <div className="dim" style={{ fontSize: 9 }}>{k}</div>
                <b style={{ fontFamily: 'var(--font-mono)', color: 'var(--good)' }}>{v}</b>
              </div>
            ))}
          </div>
          <div className="mini__win mini__chart">
            {[38, 42, 40, 47, 45, 52, 18, 50, 56, 54, 61, 66, 63, 70].map((h, i) => (
              <i key={i} style={{ height: `${h}%`, background: i === 6 ? 'var(--critical)' : undefined }} />
            ))}
          </div>
        </div>
      );
    default:
      return null;
  }
}
