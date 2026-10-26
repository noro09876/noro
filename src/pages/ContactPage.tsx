import { useSearchParams } from 'react-router';
import { LeadForm } from '../components/site/LeadForm';
import { Icon } from '../components/ui/Icon';
import { SITE } from '../config/site';
import { getProduct, type ProductSlug } from '../products/registry';

const TOPICS: Record<string, string> = {
  sales: 'Автоматизация продаж: обработка и квалификация заявок, интеграция с CRM.',
  support: 'Автоматизация поддержки: ответы по базе знаний, маршрутизация обращений.',
  docs: 'Автоматизация документов: извлечение реквизитов и проверка счетов, актов, договоров.',
  catalog: 'Работа с каталогом: очистка прайсов, подготовка карточек, выгрузка на площадки.',
  content: 'Контент-процесс: подготовка материалов для нескольких площадок.',
  analytics: 'Аналитика: сводная отчётность по продажам из наших систем.',
};

export default function ContactPage() {
  const [params] = useSearchParams();
  const product = getProduct(params.get('product') ?? '')?.slug ?? '';
  const topic = TOPICS[params.get('topic') ?? ''] ?? '';

  return (
    <section className="section">
      <div className="container container--wide order">
        <div className="order__aside">
          <span className="eyebrow">Заявка</span>
          <h1 className="section-title" style={{ fontSize: 'var(--fs-3xl)' }}>
            Расскажите, что нужно автоматизировать
          </h1>
          <p className="muted">Достаточно пары предложений: какой процесс, какие данные и системы уже есть. Ответим вопросами и предложением, с чего начать.</p>
          <ul className="order__points">
            <li>
              <Icon name="checkCircle" /> Сначала разбираем задачу и данные — без обязательств
            </li>
            <li>
              <Icon name="checkCircle" /> Предлагаем первый этап, который можно проверить на ваших данных
            </li>
            <li>
              <Icon name="checkCircle" /> Честно говорим, если задачу лучше решить готовым сервисом
            </li>
          </ul>
          {SITE.contacts.telegram || SITE.contacts.email ? (
            <div className="btn-row">
              {SITE.contacts.telegram ? (
                <a className="btn btn--outline btn--sm" href={`https://t.me/${SITE.contacts.telegram}`} target="_blank" rel="noopener noreferrer">
                  <Icon name="send" /> @{SITE.contacts.telegram}
                </a>
              ) : null}
              {SITE.contacts.email ? (
                <a className="btn btn--outline btn--sm" href={`mailto:${SITE.contacts.email}`}>
                  <Icon name="mail" /> {SITE.contacts.email}
                </a>
              ) : null}
            </div>
          ) : null}
        </div>
        <LeadForm product={product as ProductSlug | ''} topic={topic} />
      </div>
    </section>
  );
}
