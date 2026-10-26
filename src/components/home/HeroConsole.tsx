import { useEffect, useMemo, useState } from 'react';
import { prefersReducedMotion } from '../../hooks/useInView';
import { isValidAccount, isValidInn, parsePrice, isValidBarcode } from '../../lib/validators';
import { normalizeLeadFields } from '../../products/lead-engine/logic/normalize';
import { emptyFields } from '../../products/lead-engine/logic/lead';
import { DEFAULT_SCORING, ruleScorer } from '../../products/lead-engine/logic/scoring';
import { Icon } from '../ui/Icon';

/**
 * The hero visual runs the same production logic the products use on a few
 * sample rows: what you see is computed, not a canned animation.
 */
type Scene = {
  key: string;
  tab: string;
  rawLabel: string;
  raw: Array<{ text: string; bad?: boolean }>;
  stages: [string, string, string];
  out: Array<{ badge: string; badgeClass: string; title: string; sub: string; right: string }>;
  note: string;
};

function leadScene(): Scene {
  const rows = [
    { name: 'иванова мария', title: 'Коммерческий директор', email: 'M.IVANOVA@SEVERTRADE.EXAMPLE', phone: '8 (923) 280 72 70', industry: 'Дистрибуция', companySize: '51-200', source: 'Рекомендация', company: 'ООО "Северный Трейд"' },
    { name: 'Олег Титов', title: 'Менеджер по закупкам', email: 'oleg.t@gmail.com', phone: '', industry: 'Ритейл', companySize: '11-50', source: 'Сайт', company: 'Городской Маркет' },
    { name: 'ПЕТРОВ ГЛЕБ', title: 'Стажер', email: 'g.petrov@bytesys.example', phone: '9001112233', industry: 'IT', companySize: '25', source: 'Холодная база', company: 'Байт Систем' },
  ];
  const out = rows.map((r) => {
    const n = normalizeLeadFields({ ...emptyFields(), ...r });
    const s = ruleScorer.score({ id: '', fields: n.fields, extra: {}, status: 'new', nextAction: '', dueDate: '', history: [], mergedCount: 0 }, DEFAULT_SCORING);
    return {
      badge: `${s.tier}·${s.score}`,
      badgeClass: `score--${s.tier}`,
      title: `${n.fields.name} · ${n.fields.company}`,
      sub: s.factors.slice(0, 2).map((f) => `${f.label} ${f.points > 0 ? '+' : ''}${f.points}`).join(' · ') || 'нет совпадений с правилами',
      right: n.fields.phone || n.fields.email,
    };
  });
  return {
    key: 'leads',
    tab: 'leads.csv',
    rawLabel: 'Входящие заявки',
    raw: rows.map((r) => ({ text: `${r.name}; ${r.email || '—'}; ${r.phone || '—'}; ${r.title}`, bad: r.name === r.name.toLowerCase() || r.name === r.name.toUpperCase() || !r.phone })),
    stages: ['Проверка контактов', 'Нормализация', 'Скоринг по правилам'],
    out,
    note: 'Lead Engine: рейтинг и факторы посчитаны правилами по умолчанию',
  };
}

function docsScene(): Scene {
  const inn = '7708123450';
  const badInn = '6315123478';
  const acc = '40702810200000041871';
  const bik = '044525999';
  return {
    key: 'docs',
    tab: 'invoice-418.pdf',
    rawLabel: 'Текст документа',
    raw: [{ text: 'СЧЁТ НА ОПЛАТУ № 418 от 14.10.2026' }, { text: `ИНН ${inn} КПП 770801001` }, { text: `БИК ${bik}  Р/с ${acc}` }, { text: `Заказчик ИНН ${badInn}`, bad: true }],
    stages: ['Извлечение текста', 'Поиск полей', 'Проверка реквизитов'],
    out: [
      { badge: isValidInn(inn) ? 'OK' : 'ERR', badgeClass: isValidInn(inn) ? 'score--A' : 'score--C', title: `ИНН поставщика ${inn}`, sub: 'контрольная сумма ИНН', right: 'поле 3/15' },
      { badge: isValidAccount(acc, bik) ? 'OK' : 'ERR', badgeClass: isValidAccount(acc, bik) ? 'score--A' : 'score--C', title: `Р/с …${acc.slice(-6)} + БИК ${bik}`, sub: 'ключ счёта по БИК', right: 'поле 7/15' },
      { badge: isValidInn(badInn) ? 'OK' : 'ERR', badgeClass: isValidInn(badInn) ? 'score--A' : 'score--B', title: `ИНН заказчика ${badInn}`, sub: isValidInn(badInn) ? 'контрольная сумма верна' : 'контрольная сумма не сходится', right: 'на проверку' },
    ],
    note: 'Docs Intelligence: проверки по контрольным суммам ИНН и счёта',
  };
}

function catalogScene(): Scene {
  const prices = ['1 299,00 руб.', '3.490,50', 'договорная'];
  const ean = ['4610000079198', '4600000000001'] as const;
  return {
    key: 'catalog',
    tab: 'price.xlsx',
    rawLabel: 'Прайс поставщика',
    raw: [{ text: `ARK-01002; Чайник Arkto; ${prices[0]}` }, { text: `VEL-01064; Тостер Velmo; ${prices[1]}` }, { text: `NOR-01011; Блендер Nordia; ${prices[2]}`, bad: true }, { text: `EAN ${ean[1]}`, bad: true }],
    stages: ['Распознавание колонок', 'Проверки', 'Правила исправления'],
    out: [
      ...prices.map((p) => {
        const v = parsePrice(p);
        return { badge: Number.isFinite(v) ? 'FIX' : 'ERR', badgeClass: Number.isFinite(v) ? 'score--A' : 'score--B', title: `«${p}» → ${Number.isFinite(v) ? v.toFixed(2) : 'не цена'}`, sub: 'нормализация цены', right: 'Цена' };
      }),
      { badge: isValidBarcode(ean[1]) ? 'OK' : 'ERR', badgeClass: isValidBarcode(ean[1]) ? 'score--A' : 'score--B', title: `EAN-13 ${ean[1]}`, sub: 'контрольная цифра не совпадает', right: 'Штрихкод' },
    ].slice(0, 3),
    note: 'Catalog Studio: тот же парсер цен, что и в продукте',
  };
}

export function HeroConsole() {
  const scenes = useMemo(() => [leadScene(), docsScene(), catalogScene()], []);
  const [idx, setIdx] = useState(0);
  const [step, setStep] = useState(0);
  const [paused, setPaused] = useState(false);
  const reduced = typeof window !== 'undefined' && prefersReducedMotion();
  const scene = scenes[idx]!;

  useEffect(() => {
    if (reduced) {
      setStep(4);
      return;
    }
    if (paused) return;
    const t = window.setTimeout(() => {
      if (step < 4) setStep(step + 1);
      else {
        setIdx((i) => (i + 1) % scenes.length);
        setStep(0);
      }
    }, step === 4 ? 4200 : 650);
    return () => window.clearTimeout(t);
  }, [step, paused, reduced, scenes.length]);

  return (
    <div className="console reveal reveal-3" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)} onFocus={() => setPaused(true)} onBlur={() => setPaused(false)}>
      <div className="console__bar">
        <div className="console__dots" aria-hidden>
          <i />
          <i />
          <i />
        </div>
        <div className="console__tabs" role="tablist" aria-label="Примеры обработки">
          {scenes.map((s, i) => (
            <button
              key={s.key}
              type="button"
              role="tab"
              aria-selected={i === idx}
              className="console__tab"
              onClick={() => {
                setIdx(i);
                setStep(reduced ? 4 : 0);
              }}
            >
              {s.tab}
            </button>
          ))}
        </div>
      </div>
      <div className="console__body" aria-live="off">
        <div className="console__label">
          <span>{scene.rawLabel}</span>
          <span>вход</span>
        </div>
        <div className="console__raw">
          {scene.raw.map((r) => (
            <div key={r.text} className={r.bad ? 'bad' : undefined}>
              {r.text}
            </div>
          ))}
        </div>
        <div className="flow-line" aria-hidden />
        <div className="console__stages">
          {scene.stages.map((s, i) => (
            <div key={s} className="console__stage" data-state={step > i + 1 ? 'done' : step === i + 1 ? 'active' : 'idle'}>
              {step > i + 1 ? <Icon name="check" size={13} /> : step === i + 1 ? <span className="spinner" style={{ width: 12, height: 12, borderWidth: 1.5 }} aria-hidden /> : <Icon name="dot" size={13} />}
              <span>{s}</span>
            </div>
          ))}
        </div>
        <div className="console__label">
          <span>Результат</span>
          <span>выход</span>
        </div>
        <div className="console__out">
          {step >= 4
            ? scene.out.map((o, i) => (
                <div key={o.title} className="console__row" style={{ animationDelay: `${i * 90}ms` }}>
                  <span className={`score-pill ${o.badgeClass}`}>{o.badge}</span>
                  <div>
                    <strong>{o.title}</strong>
                    <small>{o.sub}</small>
                  </div>
                  <span className="mono dim" style={{ fontSize: '0.68rem' }}>
                    {o.right}
                  </span>
                </div>
              ))
            : [0, 1, 2].map((i) => <div key={i} className="skeleton" style={{ height: 50, borderRadius: 10 }} />)}
        </div>
        <div className="console__note">{scene.note}</div>
      </div>
    </div>
  );
}
