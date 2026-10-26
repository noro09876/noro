import { useEffect, useId, useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router';
import { hasContactChannel, SITE } from '../../config/site';
import { copyText, downloadFile } from '../../lib/download';
import { fetchWithTimeout } from '../../lib/net';
import { readLocal, removeLocal, writeLocal } from '../../lib/storage/local';
import { PRODUCTS, type ProductSlug } from '../../products/registry';
import { Alert } from '../ui/Feedback';
import { Icon } from '../ui/Icon';
import { useToast } from '../ui/Toast';
import { buildLeadMessage, validateLead, BUDGETS, type LeadFormData } from './leadForm.logic';

const EMPTY: LeadFormData = { name: '', contact: '', company: '', task: '', result: '', budget: '', extra: '', product: '', consent: false, website: '' };

type Phase = { kind: 'idle' } | { kind: 'sending' } | { kind: 'sent' } | { kind: 'fallback'; reason: string };

interface Props {
  product?: ProductSlug | '';
  topic?: string;
  compact?: boolean;
}

/**
 * Order form. Sends to the /api/lead Netlify Function. If delivery is not
 * configured or the network fails, it never pretends success: it shows a
 * ready-to-send message with copy / download / contact-channel options.
 */
export function LeadForm({ product = '', topic = '' }: Props) {
  const toast = useToast();
  const id = useId();
  const [data, setData] = useState<LeadFormData>(() => ({ ...EMPTY, ...readLocal<Partial<LeadFormData>>('lead-form:draft', {}), product: product || readLocal<Partial<LeadFormData>>('lead-form:draft', {}).product || '', website: '' }));
  const [errors, setErrors] = useState<Partial<Record<keyof LeadFormData, string>>>({});
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });

  useEffect(() => {
    if (product) setData((d) => ({ ...d, product }));
  }, [product]);

  useEffect(() => {
    if (topic) setData((d) => (d.task ? d : { ...d, task: topic }));
  }, [topic]);

  useEffect(() => {
    if (phase.kind === 'sent') return;
    const { consent: _c, website: _w, ...draft } = data;
    writeLocal('lead-form:draft', draft);
  }, [data, phase.kind]);

  const set = <K extends keyof LeadFormData>(k: K, v: LeadFormData[K]) => {
    setData((d) => ({ ...d, [k]: v }));
    if (errors[k]) setErrors((e) => ({ ...e, [k]: undefined }));
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const errs = validateLead(data);
    setErrors(errs);
    if (Object.keys(errs).length > 0) {
      const first = Object.keys(errs)[0];
      document.getElementById(`${id}-${first}`)?.focus();
      return;
    }
    if (data.website) {
      // honeypot filled — silently stop
      setPhase({ kind: 'sent' });
      return;
    }
    setPhase({ kind: 'sending' });
    try {
      const res = await fetchWithTimeout(SITE.leadEndpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...data, page: window.location.pathname }) }, 12000);
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (res.ok && body.ok) {
        setPhase({ kind: 'sent' });
        removeLocal('lead-form:draft');
        return;
      }
      setPhase({ kind: 'fallback', reason: res.status === 503 || res.status === 404 ? 'Автоматическая отправка заявок на этом сайте ещё не настроена.' : body.error ?? `Сервер ответил ошибкой ${res.status}.` });
    } catch {
      setPhase({ kind: 'fallback', reason: 'Не удалось связаться с сервером (нет сети или сервис недоступен).' });
    }
  };

  const message = buildLeadMessage(data);

  if (phase.kind === 'sent') {
    return (
      <div className="success-panel" role="status" data-testid="lead-sent">
        <Icon name="checkCircle" size={28} style={{ color: 'var(--good)' }} />
        <h3 style={{ fontSize: 'var(--fs-xl)' }}>Заявка отправлена</h3>
        <p className="muted">Сервер подтвердил получение. Мы изучим задачу и ответим по указанному контакту: {data.contact}.</p>
        <button type="button" className="btn btn--outline" onClick={() => { setData({ ...EMPTY, product: data.product }); setPhase({ kind: 'idle' }); }}>
          Отправить ещё одну заявку
        </button>
      </div>
    );
  }

  return (
    <form className="form" onSubmit={submit} noValidate aria-describedby={`${id}-legal`} data-testid="lead-form">
      {phase.kind === 'fallback' ? (
        <div style={{ display: 'grid', gap: 12 }} data-testid="lead-fallback">
          <Alert kind="warning" title="Заявка не отправлена автоматически">
            {phase.reason} Ваши данные не потеряны — отправьте готовое сообщение удобным способом.
          </Alert>
          <pre className="code-block" style={{ maxHeight: 220, overflow: 'auto' }}>{message}</pre>
          <div className="btn-row">
            <button type="button" className="btn btn--primary btn--sm" onClick={async () => ((await copyText(message)) ? toast.success('Текст заявки скопирован') : toast.error('Не удалось скопировать — выделите текст вручную'))}>
              <Icon name="copy" /> Скопировать текст
            </button>
            {SITE.contacts.telegram ? (
              <a className="btn btn--sm" href={`https://t.me/${SITE.contacts.telegram}`} target="_blank" rel="noopener noreferrer">
                <Icon name="send" /> Открыть Telegram
              </a>
            ) : null}
            {SITE.contacts.email ? (
              <a className="btn btn--sm" href={`mailto:${SITE.contacts.email}?subject=${encodeURIComponent('Заявка NORO')}&body=${encodeURIComponent(message.slice(0, 1800))}`}>
                <Icon name="mail" /> Письмом
              </a>
            ) : null}
            <button type="button" className="btn btn--sm" onClick={() => downloadFile('noro-zayavka.txt', message)}>
              <Icon name="download" /> Скачать .txt
            </button>
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => setPhase({ kind: 'idle' })}>
              Изменить заявку
            </button>
          </div>
          {!hasContactChannel ? <p className="dim" style={{ fontSize: 'var(--fs-xs)' }}>Контактные каналы владельца сайта пока не указаны в настройках.</p> : null}
        </div>
      ) : null}

      <div className="form__row">
        <Field id={`${id}-name`} label="Как к вам обращаться" required error={errors.name}>
          <input id={`${id}-name`} className="input" autoComplete="name" value={data.name} onChange={(e) => set('name', e.target.value)} aria-invalid={Boolean(errors.name)} maxLength={120} />
        </Field>
        <Field id={`${id}-contact`} label="Контакт для ответа" required hint="Telegram, телефон или email" error={errors.contact}>
          <input id={`${id}-contact`} className="input" autoComplete="email" value={data.contact} onChange={(e) => set('contact', e.target.value)} aria-invalid={Boolean(errors.contact)} placeholder="@username, +7… или почта" maxLength={160} />
        </Field>
      </div>
      <div className="form__row">
        <Field id={`${id}-company`} label="Компания или сфера">
          <input id={`${id}-company`} className="input" autoComplete="organization" value={data.company} onChange={(e) => set('company', e.target.value)} placeholder="Например: интернет-магазин электроники" maxLength={160} />
        </Field>
        <Field id={`${id}-product`} label="Какой продукт ближе к задаче">
          <select id={`${id}-product`} className="select" value={data.product} onChange={(e) => set('product', e.target.value as ProductSlug | '')}>
            <option value="">Пока не знаю / другое</option>
            {PRODUCTS.map((p) => (
              <option key={p.slug} value={p.slug}>
                {p.name} — {p.short.toLowerCase()}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Field id={`${id}-task`} label="Что нужно автоматизировать" required hint="Какой процесс, сколько операций в день/месяц, какие системы уже используются" error={errors.task}>
        <textarea id={`${id}-task`} className="textarea" value={data.task} onChange={(e) => set('task', e.target.value)} aria-invalid={Boolean(errors.task)} maxLength={3000} />
      </Field>
      <Field id={`${id}-result`} label="Какой результат нужен">
        <input id={`${id}-result`} className="input" value={data.result} onChange={(e) => set('result', e.target.value)} placeholder="Например: заявки сразу в CRM с приоритетом" maxLength={500} />
      </Field>
      <fieldset style={{ border: 0, padding: 0, margin: 0, display: 'grid', gap: 8 }}>
        <legend className="field__label" style={{ marginBottom: 8 }}>Ориентировочный бюджет</legend>
        <div className="budget-options">
          {BUDGETS.map((b) => (
            <label key={b}>
              <input type="radio" name={`${id}-budget`} value={b} checked={data.budget === b} onChange={() => set('budget', b)} />
              <span>{b}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <Field id={`${id}-extra`} label="Дополнительно">
        <textarea id={`${id}-extra`} className="textarea" style={{ minHeight: 72 }} value={data.extra} onChange={(e) => set('extra', e.target.value)} placeholder="Сроки, ограничения по данным, ссылки" maxLength={2000} />
      </Field>
      <div aria-hidden style={{ position: 'absolute', left: '-10000px', width: 1, height: 1, overflow: 'hidden' }}>
        <label>
          Сайт
          <input tabIndex={-1} autoComplete="off" value={data.website} onChange={(e) => set('website', e.target.value)} />
        </label>
      </div>
      <label className="check" style={{ alignItems: 'flex-start' }}>
        <input id={`${id}-consent`} type="checkbox" checked={data.consent} onChange={(e) => set('consent', e.target.checked)} aria-invalid={Boolean(errors.consent)} style={{ marginTop: 3 }} />
        <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-2)' }}>
          Согласен(на) на обработку указанных данных для ответа на заявку. <Link to="/privacy">Подробнее о данных</Link>
        </span>
      </label>
      {errors.consent ? <span className="field__error"><Icon name="alertCircle" size={13} /> {errors.consent}</span> : null}
      <div className="btn-row">
        <button type="submit" className="btn btn--signal btn--lg" disabled={phase.kind === 'sending'} data-testid="lead-submit">
          {phase.kind === 'sending' ? <span className="spinner" aria-hidden /> : <Icon name="send" />}
          {phase.kind === 'sending' ? 'Отправляем…' : 'Отправить заявку'}
        </button>
      </div>
      <p id={`${id}-legal`} className="form__legal">
        Черновик заявки сохраняется в этом браузере, пока вы её не отправите. Мы не используем данные формы для рассылок.
      </p>
    </form>
  );
}

function Field({ id, label, required, hint, error, children }: { id: string; label: string; required?: boolean; hint?: string; error?: string; children: ReactNode }) {
  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>
        {label}
        {required ? <span style={{ color: 'var(--critical)' }} aria-hidden> *</span> : null}
        {required ? <span className="sr-only"> (обязательно)</span> : null}
      </label>
      {children}
      {error ? (
        <span className="field__error" role="alert">
          <Icon name="alertCircle" size={13} /> {error}
        </span>
      ) : hint ? (
        <span className="field__hint">{hint}</span>
      ) : null}
    </div>
  );
}
