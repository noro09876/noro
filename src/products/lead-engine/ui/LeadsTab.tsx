import { useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import { DataTable, type Column } from '../../../components/ui/DataTable';
import { EmptyState } from '../../../components/ui/Feedback';
import { Icon } from '../../../components/ui/Icon';
import { useToast } from '../../../components/ui/Toast';
import { toCsv } from '../../../lib/csv';
import { downloadFile, stamp } from '../../../lib/download';
import { countLabel } from '../../../lib/format';
import { searchLeads } from '../logic/lead';
import { renderTemplate } from '../logic/templates';
import { FIELD_LABELS, LEAD_FIELDS, STATUSES, STATUS_LABELS, type Issue, type Lead, type LeadStatus, type ScoreResult, type Tier } from '../logic/types';
import type { LeadState } from './LeadEngineApp';
import { LeadCard } from './LeadCard';

interface Props {
  state: LeadState;
  setState: Dispatch<SetStateAction<LeadState>>;
  scores: Map<string, ScoreResult>;
  issues: Issue[];
  commitLeads: (label: string, next: Lead[], opts?: { toast?: string }) => void;
}

export function exportLeadsCsv(leads: Lead[], state: LeadState, scores: Map<string, ScoreResult>, name = 'leads') {
  const headers = ['Рейтинг', 'Категория', 'Факторы', ...LEAD_FIELDS.map((f) => FIELD_LABELS[f]), 'Статус', 'Следующее действие', 'Срок', 'Сообщение'];
  const rows = leads.map((l) => {
    const s = scores.get(l.id);
    const tpl = state.templates.find((t) => t.tier === s?.tier) ?? state.templates[0];
    const row: Record<string, string> = {
      'Рейтинг': String(s?.score ?? ''),
      'Категория': s?.tier ?? '',
      'Факторы': s?.factors.map((f) => `${f.label} (${f.points > 0 ? '+' : ''}${f.points})`).join('; ') ?? '',
      'Статус': STATUS_LABELS[l.status],
      'Следующее действие': l.nextAction,
      'Срок': l.dueDate,
      'Сообщение': tpl ? renderTemplate(tpl.body, l).text : '',
    };
    for (const f of LEAD_FIELDS) row[FIELD_LABELS[f]] = l.fields[f];
    return row;
  });
  downloadFile(`noro-${name}-${stamp()}.csv`, toCsv(headers, rows), 'text/csv;charset=utf-8');
}

export function LeadsTab({ state, setState, scores, issues, commitLeads }: Props) {
  const toast = useToast();
  const [query, setQuery] = useState('');
  const [tier, setTier] = useState<Tier | 'all'>('all');
  const [status, setStatus] = useState<LeadStatus | 'all'>('all');
  const [onlyIssues, setOnlyIssues] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [openId, setOpenId] = useState<string | null>(null);
  const [bulkStatus, setBulkStatus] = useState<LeadStatus>('in_progress');
  const [bulkAction, setBulkAction] = useState('');

  const issueIds = useMemo(() => new Set(issues.filter((i) => i.kind !== 'unnormalized').map((i) => i.leadId)), [issues]);

  const filtered = useMemo(() => {
    let list = searchLeads(state.leads, query);
    if (tier !== 'all') list = list.filter((l) => scores.get(l.id)?.tier === tier);
    if (status !== 'all') list = list.filter((l) => l.status === status);
    if (onlyIssues) list = list.filter((l) => issueIds.has(l.id));
    return list;
  }, [state.leads, query, tier, status, onlyIssues, scores, issueIds]);

  const columns: Column<Lead>[] = [
    {
      key: 'score',
      header: 'Рейтинг',
      width: 92,
      sortValue: (l) => scores.get(l.id)?.score ?? 0,
      render: (l) => {
        const s = scores.get(l.id);
        return s ? (
          <span className={`score-pill score--${s.tier}`} title={`Категория ${s.tier}`}>
            {s.tier}·{s.score}
          </span>
        ) : null;
      },
    },
    {
      key: 'name',
      header: 'Имя',
      sortValue: (l) => l.fields.name,
      render: (l) => (
        <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
          {l.fields.name || <span className="dim">без имени</span>}
          {issueIds.has(l.id) ? <Icon name="alert" size={13} style={{ color: 'var(--warning)' }} aria-label="Есть проблемы с данными" /> : null}
          {l.mergedCount > 0 ? <span className="badge badge--info">+{l.mergedCount}</span> : null}
        </span>
      ),
    },
    { key: 'company', header: 'Компания', sortValue: (l) => l.fields.company, render: (l) => l.fields.company || <span className="dim">—</span> },
    { key: 'title', header: 'Должность', sortValue: (l) => l.fields.title, render: (l) => l.fields.title || <span className="dim">—</span> },
    { key: 'contact', header: 'Контакт', render: (l) => <span className="mono" style={{ fontSize: '0.76rem' }}>{l.fields.email || l.fields.phone || '—'}</span> },
    { key: 'industry', header: 'Отрасль', sortValue: (l) => l.fields.industry, render: (l) => l.fields.industry || <span className="dim">—</span> },
    { key: 'status', header: 'Статус', sortValue: (l) => STATUSES.indexOf(l.status), render: (l) => <span className={`badge ${l.status === 'won' ? 'badge--good' : l.status === 'lost' ? 'badge--critical' : l.status === 'new' ? 'badge--outline' : 'badge--info'}`}>{STATUS_LABELS[l.status]}</span> },
    { key: 'next', header: 'Следующее действие', render: (l) => (l.nextAction ? `${l.nextAction}${l.dueDate ? ` · ${l.dueDate.split('-').reverse().join('.')}` : ''}` : <span className="dim">—</span>) },
  ];

  const selectedLeads = state.leads.filter((l) => selected.has(l.id));

  const applyBulkStatus = () => {
    const now = Date.now();
    const next = state.leads.map((l) =>
      selected.has(l.id) && l.status !== bulkStatus
        ? { ...l, status: bulkStatus, history: [...l.history, { at: now, type: 'status' as const, text: `Статус: ${STATUS_LABELS[l.status]} → ${STATUS_LABELS[bulkStatus]} (массово)` }] }
        : l,
    );
    commitLeads('массовая смена статуса', next, { toast: `Статус «${STATUS_LABELS[bulkStatus]}» установлен: ${countLabel(selected.size, ['лид', 'лида', 'лидов'])}` });
  };

  const applyBulkAction = () => {
    if (!bulkAction.trim()) return;
    const now = Date.now();
    const next = state.leads.map((l) => (selected.has(l.id) ? { ...l, nextAction: bulkAction.trim(), history: [...l.history, { at: now, type: 'task' as const, text: `Задача: ${bulkAction.trim()}` }] } : l));
    commitLeads('массовое назначение задачи', next, { toast: `Задача назначена: ${countLabel(selected.size, ['лид', 'лида', 'лидов'])}` });
    setBulkAction('');
  };

  const deleteSelected = () => {
    const n = selected.size;
    commitLeads('удаление лидов', state.leads.filter((l) => !selected.has(l.id)), { toast: `Удалено: ${countLabel(n, ['лид', 'лида', 'лидов'])}` });
    setSelected(new Set());
  };

  const openLead = state.leads.find((l) => l.id === openId) ?? null;

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div className="toolbar">
        <div className="search">
          <Icon name="search" />
          <input className="input input--sm" type="search" placeholder="Поиск по базе: имя, компания, город…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Поиск лидов" />
        </div>
        <select className="select select--sm" style={{ width: 'auto' }} value={tier} onChange={(e) => setTier(e.target.value as Tier | 'all')} aria-label="Фильтр по категории">
          <option value="all">Все категории</option>
          <option value="A">Категория A</option>
          <option value="B">Категория B</option>
          <option value="C">Категория C</option>
        </select>
        <select className="select select--sm" style={{ width: 'auto' }} value={status} onChange={(e) => setStatus(e.target.value as LeadStatus | 'all')} aria-label="Фильтр по статусу">
          <option value="all">Все статусы</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS[s]}
            </option>
          ))}
        </select>
        <label className="check">
          <input type="checkbox" checked={onlyIssues} onChange={(e) => setOnlyIssues(e.target.checked)} /> С проблемами
        </label>
        <div className="toolbar__spacer" />
        <button type="button" className="btn btn--sm" onClick={() => exportLeadsCsv(filtered, state, scores, 'leads')} disabled={filtered.length === 0} data-testid="export-leads">
          <Icon name="download" /> Экспорт CSV ({filtered.length})
        </button>
      </div>

      <div className="panel">
        <DataTable
          rows={filtered}
          columns={columns}
          rowKey={(l) => l.id}
          selected={selected}
          onSelectedChange={setSelected}
          onRowClick={(l) => setOpenId(l.id)}
          caption="Список лидов"
          initialSort={{ key: 'score', dir: 'desc' }}
          empty={<EmptyState icon="search" title="Ничего не найдено" text="Измените запрос или сбросьте фильтры." />}
        />
        <div className="table-foot">
          <span>
            Показано {filtered.length.toLocaleString('ru-RU')} из {state.leads.length.toLocaleString('ru-RU')}. Нажмите на строку, чтобы открыть карточку.
          </span>
        </div>
      </div>

      {selected.size > 0 ? (
        <div className="sticky-actions" role="region" aria-label="Массовые действия">
          <strong style={{ fontSize: 'var(--fs-sm)' }}>Выбрано: {selected.size}</strong>
          <select className="select select--sm" style={{ width: 'auto' }} value={bulkStatus} onChange={(e) => setBulkStatus(e.target.value as LeadStatus)} aria-label="Новый статус">
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
          </select>
          <button type="button" className="btn btn--sm" onClick={applyBulkStatus}>
            Сменить статус
          </button>
          <input className="input input--sm" style={{ width: 200 }} placeholder="Задача, например «Позвонить»" value={bulkAction} onChange={(e) => setBulkAction(e.target.value)} aria-label="Следующее действие для выбранных" />
          <button type="button" className="btn btn--sm" onClick={applyBulkAction} disabled={!bulkAction.trim()}>
            Назначить
          </button>
          <button type="button" className="btn btn--sm" onClick={() => exportLeadsCsv(selectedLeads, state, scores, 'selected')}>
            <Icon name="download" /> Экспорт
          </button>
          <button type="button" className="btn btn--danger btn--sm" onClick={deleteSelected}>
            <Icon name="trash" /> Удалить
          </button>
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => setSelected(new Set())}>
            Снять выбор
          </button>
        </div>
      ) : null}

      {openLead ? (
        <LeadCard
          lead={openLead}
          score={scores.get(openLead.id)}
          issues={issues.filter((i) => i.leadId === openLead.id)}
          templates={state.templates}
          onClose={() => setOpenId(null)}
          onSave={(updated, label) => {
            setState((s) => ({ ...s, leads: s.leads.map((l) => (l.id === updated.id ? updated : l)) }));
            toast.success(label);
          }}
        />
      ) : null}
    </div>
  );
}
