import { useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import { Alert, EmptyState } from '../../../components/ui/Feedback';
import { Icon } from '../../../components/ui/Icon';
import { countLabel } from '../../../lib/format';
import { findDuplicateGroups, mergeAllDuplicates, mergeGroup } from '../logic/dedupe';
import { countIssues, ISSUE_LABELS } from '../logic/issues';
import { normalizeLeadFields } from '../logic/normalize';
import { FIELD_LABELS, type Issue, type IssueKind, type Lead } from '../logic/types';
import type { LeadState } from './LeadEngineApp';

interface Props {
  state: LeadState;
  setState: Dispatch<SetStateAction<LeadState>>;
  issues: Issue[];
  commitLeads: (label: string, next: Lead[], opts?: { toast?: string }) => void;
  goToLeads: () => void;
}

const ORDER: IssueKind[] = ['no_contact', 'invalid_email', 'invalid_phone', 'free_email', 'missing_name', 'missing_company', 'unnormalized'];

export function QualityTab({ state, setState, issues, commitLeads }: Props) {
  const [kind, setKind] = useState<IssueKind | null>(null);
  const counts = countIssues(issues);
  const groups = useMemo(() => findDuplicateGroups(state.leads, state.dedupe), [state.leads, state.dedupe]);
  const byId = useMemo(() => new Map(state.leads.map((l) => [l.id, l])), [state.leads]);
  const dupExtra = groups.reduce((n, g) => n + g.ids.length - 1, 0);

  const normalizePreview = useMemo(() => {
    let leads = 0;
    let fields = 0;
    for (const l of state.leads) {
      const r = normalizeLeadFields(l.fields);
      if (r.changed.length) {
        leads++;
        fields += r.changed.length;
      }
    }
    return { leads, fields };
  }, [state.leads]);

  const normalizeAll = () => {
    const now = Date.now();
    const next = state.leads.map((l) => {
      const r = normalizeLeadFields(l.fields);
      if (!r.changed.length) return l;
      return { ...l, fields: r.fields, history: [...l.history, { at: now, type: 'normalize' as const, text: `Нормализованы: ${r.changed.map((f) => FIELD_LABELS[f]).join(', ')}` }] };
    });
    commitLeads('нормализация', next, { toast: `Нормализовано полей: ${normalizePreview.fields} в ${countLabel(normalizePreview.leads, ['записи', 'записях', 'записях'])}` });
  };

  const mergeAll = () => {
    const next = mergeAllDuplicates(state.leads, groups);
    commitLeads('объединение дублей', next, { toast: `Объединено групп: ${groups.length}, удалено повторов: ${dupExtra}` });
  };

  const mergeOne = (ids: string[]) => {
    const merged = mergeGroup(ids.map((id) => byId.get(id)!).filter(Boolean));
    const drop = new Set(ids.filter((id) => id !== merged.id));
    commitLeads('объединение группы', state.leads.filter((l) => !drop.has(l.id)).map((l) => (l.id === merged.id ? merged : l)), { toast: 'Группа объединена' });
  };

  const list = kind ? issues.filter((i) => i.kind === kind) : [];

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div className="issue-grid">
        <button type="button" className={`issue-card${dupExtra === 0 ? ' issue-card--zero' : ''}`} onClick={() => document.getElementById('le-dupes')?.scrollIntoView({ behavior: 'smooth' })}>
          <span className="issue-card__count">{dupExtra}</span>
          <span className="issue-card__label">Повторов в {countLabel(groups.length, ['группе', 'группах', 'группах'])}</span>
        </button>
        {ORDER.map((k) => (
          <button key={k} type="button" className={`issue-card${counts[k] === 0 ? ' issue-card--zero' : ''}`} aria-pressed={kind === k} onClick={() => setKind(kind === k ? null : k)} disabled={counts[k] === 0}>
            <span className="issue-card__count">{counts[k]}</span>
            <span className="issue-card__label">{ISSUE_LABELS[k]}</span>
          </button>
        ))}
      </div>

      {kind ? (
        <div className="panel">
          <div className="panel__head">
            <span className="panel__title">{ISSUE_LABELS[kind]}</span>
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => setKind(null)}>
              Скрыть
            </button>
          </div>
          <div className="table-wrap" style={{ maxHeight: 280 }}>
            <table className="table table--compact">
              <caption className="sr-only">Записи с проблемой</caption>
              <thead>
                <tr>
                  <th>Запись</th>
                  <th>Проблема</th>
                </tr>
              </thead>
              <tbody>
                {list.map((i) => {
                  const l = byId.get(i.leadId);
                  return (
                    <tr key={`${i.leadId}-${i.kind}-${i.field ?? ''}`}>
                      <td>{l ? `${l.fields.name || 'без имени'} · ${l.fields.company || '—'}` : i.leadId}</td>
                      <td style={{ whiteSpace: 'normal' }}>{i.message}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="table-foot">Исправить вручную можно в карточке лида на вкладке «Лиды» (фильтр «С проблемами»).</div>
        </div>
      ) : null}

      <div className="split">
        <div className="panel">
          <div className="panel__head">
            <span className="panel__title">
              <Icon name="wand" size={15} /> Нормализация
            </span>
            <button type="button" className="btn btn--primary btn--sm" onClick={normalizeAll} disabled={normalizePreview.fields === 0} data-testid="normalize-all">
              Нормализовать
            </button>
          </div>
          <div className="panel__body" style={{ display: 'grid', gap: 8, fontSize: 'var(--fs-sm)' }}>
            {normalizePreview.fields > 0 ? (
              <p>
                Будет исправлено полей: <b>{normalizePreview.fields}</b> в {countLabel(normalizePreview.leads, ['записи', 'записях', 'записях'])}.
              </p>
            ) : (
              <Alert kind="good">Все поля уже в едином формате.</Alert>
            )}
            <ul className="muted" style={{ paddingLeft: 18, display: 'grid', gap: 2 }}>
              <li>Email — нижний регистр, без «mailto:»</li>
              <li>Телефоны — формат +7 XXX XXX-XX-XX (8… и 9… приводятся к +7)</li>
              <li>Имена и города — «иванова мария» → «Иванова Мария»</li>
              <li>Сайты — только домен; кавычки в названиях — «ёлочки»</li>
            </ul>
            <p className="dim" style={{ fontSize: 'var(--fs-xs)' }}>Телефоны, которые нельзя распознать, не изменяются. Действие можно отменить.</p>
          </div>
        </div>

        <div className="panel">
          <div className="panel__head">
            <span className="panel__title">
              <Icon name="merge" size={15} /> Правила поиска дублей
            </span>
          </div>
          <div className="panel__body" style={{ display: 'grid', gap: 10 }}>
            {(
              [
                ['email', 'Совпадает email (без учёта регистра)'],
                ['phone', 'Совпадает телефон (в любом формате)'],
                ['companyAndName', 'Совпадают компания и имя (без ООО/АО)'],
              ] as const
            ).map(([k, label]) => (
              <label key={k} className="check">
                <input type="checkbox" checked={state.dedupe[k]} onChange={(e) => setState((s) => ({ ...s, dedupe: { ...s.dedupe, [k]: e.target.checked } }))} />
                {label}
              </label>
            ))}
            <p className="dim" style={{ fontSize: 'var(--fs-xs)' }}>
              При объединении остаётся самая полная запись, пустые поля дополняются из остальных, заметки и история сохраняются.
            </p>
          </div>
        </div>
      </div>

      <div className="panel" id="le-dupes">
        <div className="panel__head">
          <span className="panel__title">Найденные дубли · {groups.length}</span>
          <button type="button" className="btn btn--primary btn--sm" onClick={mergeAll} disabled={groups.length === 0} data-testid="merge-all">
            Объединить все
          </button>
        </div>
        <div className="panel__body" style={{ display: 'grid', gap: 10 }}>
          {groups.length === 0 ? (
            <EmptyState icon="checkCircle" title="Дубликатов не найдено" text="По выбранным правилам все записи уникальны." />
          ) : (
            groups.slice(0, 50).map((g) => (
              <div key={g.ids.join()} className="card" style={{ padding: 12, display: 'grid', gap: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  <span className="badge badge--warning" style={{ whiteSpace: 'normal' }}>{g.reasons.join(', ')}</span>
                  <button type="button" className="btn btn--sm" onClick={() => mergeOne(g.ids)}>
                    Объединить {g.ids.length}
                  </button>
                </div>
                <ul className="list-reset" style={{ display: 'grid', gap: 4, fontSize: 'var(--fs-xs)' }}>
                  {g.ids.map((id) => {
                    const l = byId.get(id);
                    return l ? (
                      <li key={id} className="mono" style={{ overflowWrap: 'anywhere' }}>
                        {l.fields.name || '—'} · {l.fields.company || '—'} · {l.fields.email || '—'} · {l.fields.phone || '—'}
                      </li>
                    ) : null;
                  })}
                </ul>
              </div>
            ))
          )}
          {groups.length > 50 ? <p className="dim">Показаны первые 50 групп из {groups.length}. «Объединить все» обработает все группы.</p> : null}
        </div>
      </div>
    </div>
  );
}
