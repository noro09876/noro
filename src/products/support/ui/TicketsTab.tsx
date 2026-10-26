import { useEffect, useMemo, useState } from 'react';
import { DataTable, type Column } from '../../../components/ui/DataTable';
import { EmptyState } from '../../../components/ui/Feedback';
import { Icon } from '../../../components/ui/Icon';
import { useToast } from '../../../components/ui/Toast';
import { downloadFile, stamp } from '../../../lib/download';
import { toCsv } from '../../../lib/csv';
import { fmtDateTime } from '../../../lib/format';
import { uid } from '../../../lib/id';
import { PRIORITY_LABELS, TICKET_STATUS_LABELS, type Priority, type Ticket, type TicketStatus } from '../logic/types';
import type { SetSupport, SupportState } from './state';

const PRIO_ORDER: Record<Priority, number> = { high: 0, medium: 1, low: 2 };

export function exportTicketsCsv(tickets: Ticket[]) {
  const headers = ['Создано', 'Вопрос', 'Тема', 'Приоритет', 'Причина', 'Статус', 'Ответ'];
  const rows = tickets.map((t) => ({
    Создано: fmtDateTime(t.createdAt),
    Вопрос: t.question,
    Тема: t.classification.category,
    Приоритет: PRIORITY_LABELS[t.classification.priority],
    Причина: t.reason,
    Статус: TICKET_STATUS_LABELS[t.status],
    Ответ: t.sentAnswer ?? '',
  }));
  downloadFile(`noro-support-tickets-${stamp()}.csv`, toCsv(headers, rows), 'text/csv;charset=utf-8');
}

interface Props {
  state: SupportState;
  setState: SetSupport;
  selectedId: string | null;
  setSelectedId: (id: string | null) => void;
}

export function TicketsTab({ state, setState, selectedId, setSelectedId }: Props) {
  const toast = useToast();
  const [filter, setFilter] = useState<TicketStatus | 'all'>('all');
  const rows = useMemo(
    () =>
      state.tickets
        .filter((t) => filter === 'all' || t.status === filter)
        .sort((a, b) => Number(a.status === 'resolved') - Number(b.status === 'resolved') || PRIO_ORDER[a.classification.priority] - PRIO_ORDER[b.classification.priority] || b.createdAt - a.createdAt),
    [state.tickets, filter],
  );
  const selected = state.tickets.find((t) => t.id === selectedId) ?? null;
  const [draft, setDraft] = useState(selected?.draft ?? '');
  useEffect(() => setDraft(selected?.draft ?? ''), [selected?.id, selected?.draft]);

  const update = (id: string, patch: Partial<Ticket>) =>
    setState((s) => ({ ...s, tickets: s.tickets.map((t) => (t.id === id ? { ...t, ...patch, updatedAt: Date.now() } : t)) }));

  const send = () => {
    if (!selected || !draft.trim()) return;
    const text = draft.trim();
    setState((s) => ({
      ...s,
      tickets: s.tickets.map((t) => (t.id === selected.id ? { ...t, draft: text, sentAnswer: text, status: 'resolved', updatedAt: Date.now() } : t)),
      conversations: s.conversations.map((c) =>
        c.id === selected.conversationId ? { ...c, messages: [...c.messages, { id: uid('m'), role: 'operator', text, at: Date.now() }] } : c,
      ),
    }));
    toast.success('Ответ добавлен в диалог, обращение закрыто');
  };

  const toArticle = () => {
    if (!selected || !draft.trim()) return;
    const id = uid('kb');
    const body = draft
      .split('\n')
      .filter((l) => l.trim() !== state.settings.greeting.trim() && l.trim() !== state.settings.signature.trim())
      .join('\n')
      .trim();
    setState((s) => ({
      ...s,
      articles: [{ id, title: selected.question.slice(0, 120), body, category: selected.classification.category, updatedAt: Date.now() }, ...s.articles],
    }));
    toast.success('Статья добавлена в базу знаний — на похожий вопрос система теперь ответит сама');
  };

  const columns: Column<Ticket>[] = [
    {
      key: 'prio',
      header: 'Приоритет',
      sortValue: (t) => PRIO_ORDER[t.classification.priority],
      render: (t) => (
        <span className={`badge ${t.classification.priority === 'high' ? 'badge--critical' : t.classification.priority === 'medium' ? 'badge--warning' : 'badge--outline'}`}>
          {PRIORITY_LABELS[t.classification.priority]}
        </span>
      ),
      width: 120,
    },
    { key: 'q', header: 'Вопрос', sortValue: (t) => t.question, render: (t) => <span className="nowrap" style={{ display: 'block', maxWidth: 340, overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.question}</span> },
    { key: 'cat', header: 'Тема', sortValue: (t) => t.classification.category, render: (t) => t.classification.category },
    { key: 'st', header: 'Статус', sortValue: (t) => t.status, render: (t) => <span className={`badge ${t.status === 'resolved' ? 'badge--good' : t.status === 'pending' ? 'badge--info' : 'badge--outline'}`}>{TICKET_STATUS_LABELS[t.status]}</span> },
    { key: 'at', header: 'Создано', sortValue: (t) => t.createdAt, render: (t) => <span className="mono dim">{fmtDateTime(t.createdAt)}</span> },
  ];

  if (state.tickets.length === 0) {
    return <EmptyState icon="inbox" title="Обращений пока нет" text="Они появляются, когда в базе нет ответа, клиент просит оператора, затронута стоп-тема или приоритет высокий. Спросите в чате, например, «Есть ли доставка дронами?»." />;
  }

  return (
    <div className="split split--side" style={{ alignItems: 'start' }}>
      <div style={{ display: 'grid', gap: 12, minWidth: 0 }}>
        <div className="toolbar">
          <div className="chip-row" role="group" aria-label="Фильтр по статусу">
            {(['all', 'open', 'pending', 'resolved'] as const).map((f) => (
              <button key={f} type="button" className={`chip${filter === f ? ' chip--active' : ''}`} aria-pressed={filter === f} onClick={() => setFilter(f)}>
                {f === 'all' ? 'Все' : TICKET_STATUS_LABELS[f]} · {f === 'all' ? state.tickets.length : state.tickets.filter((t) => t.status === f).length}
              </button>
            ))}
          </div>
          <span className="toolbar__spacer" />
          <button type="button" className="btn btn--outline btn--sm" onClick={() => exportTicketsCsv(state.tickets)} data-testid="export-tickets">
            <Icon name="download" /> CSV
          </button>
        </div>
        <DataTable<Ticket>
          caption="Обращения для оператора"
          rows={rows}
          columns={columns}
          rowKey={(t) => t.id}
          onRowClick={(t) => setSelectedId(t.id)}
          activeKey={selectedId}
          maxHeight={460}
          empty={<p className="dim" style={{ padding: 16 }}>Нет обращений с таким статусом.</p>}
        />
      </div>
      <aside className="panel" aria-label="Карточка обращения">
        {!selected ? (
          <EmptyState icon="inbox" title="Выберите обращение" text="Откройте строку, чтобы отредактировать ответ и сменить статус." />
        ) : (
          <div className="panel__body" style={{ display: 'grid', gap: 12 }} data-testid="ticket-card">
            <div>
              <div className="field__label">Вопрос клиента</div>
              <p style={{ whiteSpace: 'pre-wrap' }}>{selected.question}</p>
            </div>
            <dl className="kv">
              <dt>Причина</dt>
              <dd>{selected.reason}</dd>
              <dt>Тема</dt>
              <dd>
                {selected.classification.category} <span className="dim">({selected.classification.categoryReasons.join(', ')})</span>
              </dd>
              <dt>Приоритет</dt>
              <dd>
                {PRIORITY_LABELS[selected.classification.priority]} <span className="dim">— {selected.classification.priorityReasons.join('; ')}</span>
              </dd>
              <dt>Уверенность</dt>
              <dd className="mono">{Math.round(selected.confidence * 100)}%</dd>
            </dl>
            <label className="field">
              <span className="field__label">Статус</span>
              <select className="select" value={selected.status} onChange={(e) => update(selected.id, { status: e.target.value as TicketStatus })} data-testid="ticket-status">
                {(Object.keys(TICKET_STATUS_LABELS) as TicketStatus[]).map((s) => (
                  <option key={s} value={s}>
                    {TICKET_STATUS_LABELS[s]}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="field__label">Ответ клиенту</span>
              <textarea className="textarea" rows={8} value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={() => update(selected.id, { draft })} data-testid="ticket-draft" />
              <span className="field__hint">Черновик сохраняется при выходе из поля. Отправка добавляет ответ в диалог (в демо — без внешнего канала).</span>
            </label>
            <div className="btn-row">
              <button type="button" className="btn btn--primary btn--sm" onClick={send} disabled={!draft.trim()} data-testid="ticket-send">
                <Icon name="send" /> Ответить и закрыть
              </button>
              <button type="button" className="btn btn--outline btn--sm" onClick={toArticle} disabled={!draft.trim()}>
                <Icon name="book" /> В базу знаний
              </button>
            </div>
            {selected.sentAnswer ? <p className="dim" style={{ fontSize: 'var(--fs-xs)' }}>Ответ отправлен {fmtDateTime(selected.updatedAt)}.</p> : null}
          </div>
        )}
      </aside>
    </div>
  );
}
