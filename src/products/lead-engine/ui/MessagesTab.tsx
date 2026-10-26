import { useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { Alert } from '../../../components/ui/Feedback';
import { Icon } from '../../../components/ui/Icon';
import { useToast } from '../../../components/ui/Toast';
import { toCsv } from '../../../lib/csv';
import { copyText, downloadFile, stamp } from '../../../lib/download';
import { countLabel } from '../../../lib/format';
import { uid } from '../../../lib/id';
import { PLACEHOLDERS, renderTemplate, type MessageTemplate } from '../logic/templates';
import type { Lead, ScoreResult, Tier } from '../logic/types';
import type { LeadState } from './LeadEngineApp';

interface Props {
  state: LeadState;
  setState: Dispatch<SetStateAction<LeadState>>;
  scores: Map<string, ScoreResult>;
  commitLeads: (label: string, next: Lead[], opts?: { toast?: string }) => void;
}

export function MessagesTab({ state, setState, scores, commitLeads }: Props) {
  const toast = useToast();
  const [tplId, setTplId] = useState(state.templates[0]?.id ?? '');
  const [target, setTarget] = useState<Tier | 'all'>('A');
  const [skipLost, setSkipLost] = useState(true);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const tpl = state.templates.find((t) => t.id === tplId) ?? state.templates[0];

  const updateTpl = (patch: Partial<MessageTemplate>) =>
    setState((s) => ({ ...s, templates: s.templates.map((t) => (t.id === tpl?.id ? { ...t, ...patch } : t)) }));

  const addTpl = () => {
    const t: MessageTemplate = { id: uid('t'), name: 'Новый шаблон', tier: 'any', body: 'Здравствуйте, {{имя|коллеги}}!\n\n' };
    setState((s) => ({ ...s, templates: [...s.templates, t] }));
    setTplId(t.id);
  };
  const removeTpl = () => {
    if (!tpl || state.templates.length <= 1) return;
    setState((s) => ({ ...s, templates: s.templates.filter((t) => t.id !== tpl.id) }));
    setTplId(state.templates.find((t) => t.id !== tpl.id)?.id ?? '');
  };

  const insert = (key: string) => {
    if (!tpl) return;
    const el = bodyRef.current;
    const token = `{{${key}}}`;
    const pos = el?.selectionStart ?? tpl.body.length;
    updateTpl({ body: tpl.body.slice(0, pos) + token + tpl.body.slice(el?.selectionEnd ?? pos) });
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(pos + token.length, pos + token.length);
    });
  };

  const recipients = useMemo(
    () =>
      state.leads
        .filter((l) => (target === 'all' ? true : scores.get(l.id)?.tier === target))
        .filter((l) => (skipLost ? l.status !== 'lost' && l.status !== 'won' : true))
        .sort((a, b) => (scores.get(b.id)?.score ?? 0) - (scores.get(a.id)?.score ?? 0)),
    [state.leads, scores, target, skipLost],
  );

  const messages = useMemo(() => (tpl ? recipients.map((l) => ({ lead: l, ...renderTemplate(tpl.body, l) })) : []), [recipients, tpl]);
  const withMissing = messages.filter((m) => m.missing.length > 0).length;
  const noContact = messages.filter((m) => !m.lead.fields.email && !m.lead.fields.phone).length;

  const exportCsv = () => {
    downloadFile(
      `noro-messages-${stamp()}.csv`,
      toCsv(
        ['Имя', 'Компания', 'Email', 'Телефон', 'Категория', 'Сообщение'],
        messages.map((m) => ({ 'Имя': m.lead.fields.name, 'Компания': m.lead.fields.company, 'Email': m.lead.fields.email, 'Телефон': m.lead.fields.phone, 'Категория': scores.get(m.lead.id)?.tier ?? '', 'Сообщение': m.text })),
      ),
      'text/csv;charset=utf-8',
    );
  };

  const markPrepared = () => {
    const ids = new Set(messages.map((m) => m.lead.id));
    const now = Date.now();
    commitLeads(
      'отметка о подготовке сообщений',
      state.leads.map((l) => (ids.has(l.id) ? { ...l, history: [...l.history, { at: now, type: 'message' as const, text: `Подготовлено сообщение по шаблону «${tpl?.name}»` }] } : l)),
      { toast: `Отмечено в истории: ${countLabel(ids.size, ['лид', 'лида', 'лидов'])}` },
    );
  };

  if (!tpl) return null;

  return (
    <div className="split split--side-l">
      <div className="panel" style={{ alignSelf: 'start' }}>
        <div className="panel__head">
          <span className="panel__title">Шаблон</span>
          <button type="button" className="btn btn--sm" onClick={addTpl}>
            <Icon name="plus" /> Новый
          </button>
        </div>
        <div className="panel__body" style={{ display: 'grid', gap: 10 }}>
          <label className="field">
            <span className="field__label">Выбор шаблона</span>
            <select className="select select--sm" value={tpl.id} onChange={(e) => setTplId(e.target.value)}>
              {state.templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field__label">Название</span>
            <input className="input input--sm" value={tpl.name} onChange={(e) => updateTpl({ name: e.target.value })} />
          </label>
          <label className="field">
            <span className="field__label">Текст</span>
            <textarea ref={bodyRef} className="textarea" style={{ minHeight: 190 }} value={tpl.body} onChange={(e) => updateTpl({ body: e.target.value })} data-testid="template-body" />
            <span className="field__hint">Подстановка: {'{{имя}}'}, запасное значение — {'{{имя|коллеги}}'}</span>
          </label>
          <div className="chip-row" aria-label="Вставить поле">
            {PLACEHOLDERS.map((p) => (
              <button key={p.key} type="button" className="chip" onClick={() => insert(p.key)} title={p.label}>
                +{p.key}
              </button>
            ))}
          </div>
          <button type="button" className="btn btn--ghost btn--sm" onClick={removeTpl} disabled={state.templates.length <= 1}>
            <Icon name="trash" /> Удалить шаблон
          </button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 12, alignContent: 'start', minWidth: 0 }}>
        <div className="toolbar">
          <span className="muted" style={{ fontSize: 'var(--fs-sm)' }}>Кому:</span>
          {(['A', 'B', 'C', 'all'] as const).map((t) => (
            <button key={t} type="button" className="chip" aria-pressed={target === t} onClick={() => setTarget(t)}>
              {t === 'all' ? 'Все' : `Категория ${t}`}
            </button>
          ))}
          <label className="check">
            <input type="checkbox" checked={skipLost} onChange={(e) => setSkipLost(e.target.checked)} /> Без закрытых
          </label>
          <div className="toolbar__spacer" />
          <button
            type="button"
            className="btn btn--sm"
            disabled={messages.length === 0}
            onClick={async () => {
              const ok = await copyText(messages.map((m) => `${m.lead.fields.name} <${m.lead.fields.email || m.lead.fields.phone}>\n${m.text}`).join('\n\n———\n\n'));
              if (ok) toast.success('Все сообщения скопированы');
              else toast.error('Не удалось скопировать');
            }}
          >
            <Icon name="copy" /> Копировать все
          </button>
          <button type="button" className="btn btn--sm" onClick={exportCsv} disabled={messages.length === 0} data-testid="export-messages">
            <Icon name="download" /> CSV
          </button>
          <button type="button" className="btn btn--primary btn--sm" onClick={markPrepared} disabled={messages.length === 0}>
            <Icon name="check" /> Отметить в истории
          </button>
        </div>
        <Alert kind="info">
          Сообщения подготавливаются для {countLabel(messages.length, ['получателя', 'получателей', 'получателей'])}, но не отправляются: почта и мессенджеры не подключены. {withMissing > 0 ? `У ${withMissing} не хватает данных для подстановки. ` : ''}
          {noContact > 0 ? `${noContact} без контактов.` : ''}
        </Alert>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 10 }}>
          {messages.slice(0, 30).map((m) => (
            <article key={m.lead.id} className="card" style={{ padding: 14, display: 'grid', gap: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', fontSize: 'var(--fs-xs)' }}>
                <strong>
                  {m.lead.fields.name || 'без имени'} · {m.lead.fields.company || '—'}
                </strong>
                <span className="mono dim" style={{ overflowWrap: 'anywhere' }}>{m.lead.fields.email || m.lead.fields.phone || 'нет контакта'}</span>
              </div>
              <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontSize: 'var(--fs-sm)' }}>{m.text}</p>
              {m.missing.length ? <span className="badge badge--warning">Нет данных: {m.missing.join(', ')}</span> : null}
            </article>
          ))}
          {messages.length > 30 ? <p className="dim" style={{ fontSize: 'var(--fs-xs)' }}>Показаны первые 30 из {messages.length}. В CSV попадут все.</p> : null}
        </div>
      </div>
    </div>
  );
}
