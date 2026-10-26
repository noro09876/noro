import { useState } from 'react';
import { Modal } from '../../../components/ui/Modal';
import { Icon } from '../../../components/ui/Icon';
import { useToast } from '../../../components/ui/Toast';
import { copyText } from '../../../lib/download';
import { fmtDateTime } from '../../../lib/format';
import { renderTemplate, type MessageTemplate } from '../logic/templates';
import { FIELD_LABELS, LEAD_FIELDS, STATUSES, STATUS_LABELS, type Issue, type Lead, type LeadField, type LeadStatus, type ScoreResult } from '../logic/types';

interface Props {
  lead: Lead;
  score?: ScoreResult;
  issues: Issue[];
  templates: MessageTemplate[];
  onClose: () => void;
  onSave: (lead: Lead, label: string) => void;
}

export function LeadCard({ lead, score, issues, templates, onClose, onSave }: Props) {
  const toast = useToast();
  const [fields, setFields] = useState(lead.fields);
  const [status, setStatus] = useState<LeadStatus>(lead.status);
  const [nextAction, setNextAction] = useState(lead.nextAction);
  const [dueDate, setDueDate] = useState(lead.dueDate);
  const [note, setNote] = useState('');
  const [tplId, setTplId] = useState(templates.find((t) => t.tier === score?.tier)?.id ?? templates[0]?.id ?? '');

  const tpl = templates.find((t) => t.id === tplId);
  const message = tpl ? renderTemplate(tpl.body, { ...lead, fields }) : null;

  const save = () => {
    const now = Date.now();
    const history = [...lead.history];
    const changed = LEAD_FIELDS.filter((f) => fields[f] !== lead.fields[f]);
    if (changed.length) history.push({ at: now, type: 'edit', text: `Изменены поля: ${changed.map((f) => FIELD_LABELS[f]).join(', ')}` });
    if (status !== lead.status) history.push({ at: now, type: 'status', text: `Статус: ${STATUS_LABELS[lead.status]} → ${STATUS_LABELS[status]}` });
    if (nextAction !== lead.nextAction || dueDate !== lead.dueDate) history.push({ at: now, type: 'task', text: `Следующее действие: ${nextAction || '—'}${dueDate ? ` до ${dueDate.split('-').reverse().join('.')}` : ''}` });
    if (note.trim()) history.push({ at: now, type: 'note', text: `Заметка: ${note.trim()}` });
    if (history.length === lead.history.length) {
      onClose();
      return;
    }
    onSave({ ...lead, fields, status, nextAction, dueDate, history }, 'Карточка лида сохранена');
    setNote('');
    onClose();
  };

  const set = (f: LeadField, v: string) => setFields((x) => ({ ...x, [f]: v }));

  return (
    <Modal
      open
      wide
      title={lead.fields.name || lead.fields.company || 'Лид без имени'}
      description={[lead.fields.title, lead.fields.company].filter(Boolean).join(' · ') || undefined}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            Закрыть
          </button>
          <button type="button" className="btn btn--primary" onClick={save} data-testid="lead-save">
            <Icon name="check" /> Сохранить
          </button>
        </>
      }
    >
      <div className="split" style={{ alignItems: 'start' }}>
        <div style={{ display: 'grid', gap: 12 }}>
          <div className="split" style={{ gap: 10 }}>
            <label className="field">
              <span className="field__label">Статус</span>
              <select className="select" value={status} onChange={(e) => setStatus(e.target.value as LeadStatus)} data-testid="lead-status">
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABELS[s]}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="field__label">Срок</span>
              <input className="input" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </label>
          </div>
          <label className="field">
            <span className="field__label">Следующее действие</span>
            <input className="input" value={nextAction} onChange={(e) => setNextAction(e.target.value)} placeholder="Например: отправить КП" />
          </label>
          <label className="field">
            <span className="field__label">Добавить заметку</span>
            <textarea className="textarea" style={{ minHeight: 64 }} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Попадёт в историю лида" />
          </label>
          <details>
            <summary style={{ cursor: 'pointer', fontSize: 'var(--fs-sm)', fontWeight: 600 }}>Данные контакта</summary>
            <div style={{ display: 'grid', gap: 8, marginTop: 10 }}>
              {LEAD_FIELDS.filter((f) => f !== 'notes').map((f) => (
                <label key={f} className="field">
                  <span className="field__label" style={{ fontSize: 'var(--fs-xs)' }}>
                    {FIELD_LABELS[f]}
                    {issues.some((i) => i.field === f) ? <span style={{ color: 'var(--warning)' }}> · {issues.find((i) => i.field === f)!.message}</span> : null}
                  </span>
                  <input className="input input--sm" value={fields[f]} onChange={(e) => set(f, e.target.value)} aria-invalid={issues.some((i) => i.field === f)} />
                </label>
              ))}
              {Object.keys(lead.extra).length ? (
                <dl className="kv" style={{ marginTop: 6 }}>
                  {Object.entries(lead.extra).map(([k, v]) => (
                    <div key={k} style={{ display: 'contents' }}>
                      <dt>{k}</dt>
                      <dd>{v}</dd>
                    </div>
                  ))}
                </dl>
              ) : null}
            </div>
          </details>
        </div>

        <div style={{ display: 'grid', gap: 14 }}>
          <div className="panel">
            <div className="panel__head">
              <span className="panel__title">Оценка</span>
              {score ? (
                <span className={`score-pill score--${score.tier}`}>
                  {score.tier}·{score.score}
                </span>
              ) : null}
            </div>
            <div className="panel__body">
              {score && score.factors.length ? (
                <div className="factor-list">
                  {score.factors.map((f) => (
                    <div key={f.ruleId} className={`factor ${f.points > 0 ? 'factor--pos' : 'factor--neg'}`}>
                      <span>{f.label}</span>
                      <b>
                        {f.points > 0 ? '+' : ''}
                        {f.points}
                      </b>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="muted" style={{ fontSize: 'var(--fs-sm)' }}>
                  Ни одно правило не сработало. Проверьте данные или правила скоринга.
                </p>
              )}
            </div>
          </div>

          <div className="panel">
            <div className="panel__head">
              <span className="panel__title">Сообщение</span>
              <select className="select select--sm" style={{ width: 'auto' }} value={tplId} onChange={(e) => setTplId(e.target.value)} aria-label="Шаблон сообщения">
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="panel__body" style={{ display: 'grid', gap: 8 }}>
              <div className="code-block" style={{ fontFamily: 'var(--font-sans)', fontSize: 'var(--fs-sm)', color: 'var(--text)' }}>
                {message?.text}
              </div>
              {message?.missing.length ? <div className="field__hint">Нет данных для: {message.missing.join(', ')}</div> : null}
              <button
                type="button"
                className="btn btn--sm"
                onClick={async () => {
                  if (message && (await copyText(message.text))) toast.success('Сообщение скопировано');
                  else toast.error('Не удалось скопировать — выделите текст вручную');
                }}
              >
                <Icon name="copy" /> Копировать
              </button>
            </div>
          </div>

          <div>
            <div className="panel__title" style={{ marginBottom: 8 }}>
              <Icon name="history" size={15} /> История
            </div>
            <ol className="timeline list-reset">
              {[...lead.history].reverse().slice(0, 12).map((h, i) => (
                <li key={`${h.at}-${i}`}>
                  <div>
                    <time dateTime={new Date(h.at).toISOString()}>{fmtDateTime(h.at)}</time>
                    {h.text}
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </div>
    </Modal>
  );
}
