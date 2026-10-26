import { BarList } from '../../../components/charts/BarList';
import { EmptyState } from '../../../components/ui/Feedback';
import { Icon } from '../../../components/ui/Icon';
import { fmtInt } from '../../../lib/format';
import { computeStats } from '../logic/stats';
import { PRIORITY_LABELS, type Priority } from '../logic/types';
import type { SupportState } from './state';

export function StatsTab({ state, onCreateArticle }: { state: SupportState; onCreateArticle: (title: string) => void }) {
  const st = computeStats(state.conversations, state.tickets);
  if (st.questions === 0) return <EmptyState icon="chart" title="Статистика появится после первых вопросов" text="Задайте несколько вопросов в чате — здесь будет видно долю автоответов, темы и вопросы без ответа." />;
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div className="stat-grid">
        <div className="stat">
          <div className="stat__label">Вопросов</div>
          <div className="stat__value">{fmtInt(st.questions)}</div>
          <div className="stat__meta">{fmtInt(state.conversations.length)} диалогов</div>
        </div>
        <div className="stat">
          <div className="stat__label">Ответ по базе</div>
          <div className="stat__value" data-testid="auto-share">{Math.round(st.autoShare * 100)}%</div>
          <div className="stat__meta">{fmtInt(st.answered)} без оператора</div>
        </div>
        <div className="stat">
          <div className="stat__label">Нет данных в базе</div>
          <div className="stat__value">{fmtInt(st.insufficient)}</div>
          <div className="stat__meta">эскалаций: {fmtInt(st.escalated)}, стоп-тем: {fmtInt(st.blocked)}</div>
        </div>
        <div className="stat">
          <div className="stat__label">Открытые обращения</div>
          <div className="stat__value">{fmtInt(st.ticketsOpen)}</div>
          <div className="stat__meta">решено: {fmtInt(st.ticketsResolved)}</div>
        </div>
      </div>
      <div className="split">
        <div className="panel">
          <div className="panel__head">
            <h3 className="panel__title">Темы обращений</h3>
          </div>
          <div className="panel__body">
            <BarList ariaLabel="Темы обращений" items={st.byCategory.map((c) => ({ key: c.label, label: c.label, value: c.value, display: fmtInt(c.value) }))} />
          </div>
        </div>
        <div className="panel">
          <div className="panel__head">
            <h3 className="panel__title">Приоритеты</h3>
          </div>
          <div className="panel__body">
            <BarList
              ariaLabel="Приоритеты"
              items={(['high', 'medium', 'low'] as Priority[]).map((p) => ({ key: p, label: PRIORITY_LABELS[p], value: st.byPriority[p], display: fmtInt(st.byPriority[p]) }))}
            />
          </div>
        </div>
        <div className="panel">
          <div className="panel__head">
            <h3 className="panel__title">Самые используемые статьи</h3>
          </div>
          <div className="panel__body">
            {st.topSources.length ? (
              <BarList ariaLabel="Используемые статьи" items={st.topSources.map((c) => ({ key: c.label, label: c.label, value: c.value, display: fmtInt(c.value) }))} />
            ) : (
              <p className="dim">Пока нет ответов по базе.</p>
            )}
          </div>
        </div>
        <div className="panel">
          <div className="panel__head">
            <h3 className="panel__title">Вопросы без ответа в базе</h3>
          </div>
          <div className="panel__body">
            {st.unanswered.length ? (
              <ul className="list-reset" style={{ display: 'grid', gap: 8 }}>
                {st.unanswered.map((q) => (
                  <li key={q} style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'space-between', fontSize: 'var(--fs-sm)' }}>
                    <span>{q}</span>
                    <button type="button" className="btn btn--ghost btn--sm nowrap" onClick={() => onCreateArticle(q)}>
                      <Icon name="plus" /> Статья
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="dim">Все вопросы закрыты базой знаний.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
