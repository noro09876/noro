import { useState } from 'react';
import { Link } from 'react-router';
import { get } from '../api';
import type { EventRow } from '../types';
import { Empty, ErrorBox, fmtDateTime, Icon, Loading, useLoad } from '../ui';

const SCOPES = ['', 'agent', 'publisher', 'scheduler', 'accounts', 'content', 'analytics', 'backup', 'auth', 'settings', 'http'];

export function Journal() {
  const [level, setLevel] = useState('');
  const [scope, setScope] = useState('');
  const { data, error, loading, reload } = useLoad(() => get<EventRow[]>(`/api/events?level=${level}&scope=${scope}&limit=300`), [level, scope]);
  return (
    <div className="page">
      <div className="row">
        <div className="seg" role="group" aria-label="Уровень">
          {[['', 'Все'], ['error', 'Ошибки'], ['warn', 'Предупреждения'], ['info', 'Информация']].map(([v, l]) => <button key={v} aria-pressed={level === v} onClick={() => setLevel(v)}>{l}</button>)}
        </div>
        <select className="select" style={{ width: 180 }} value={scope} onChange={(e) => setScope(e.target.value)} aria-label="Модуль">
          {SCOPES.map((s) => <option key={s} value={s}>{s || 'Все модули'}</option>)}
        </select>
        <div className="spacer" />
        <button className="btn btn-sm" onClick={reload}><Icon name="refresh" />Обновить</button>
      </div>
      <p className="muted" style={{ margin: 0, fontSize: 12 }}>Журнал хранится 90 дней. Токены и пароли автоматически скрываются ещё до записи.</p>
      {error && <ErrorBox error={error} retry={reload} />}
      <section className="card">
        {loading && !data ? <Loading /> : data?.length ? data.map((e) => (
          <div key={e.id} className="log-line">
            <span className="mono muted">{fmtDateTime(e.ts, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
            <span className={`mono lvl-${e.level}`}>{e.scope}</span>
            <span className="msg">{e.content_id ? <Link to={`/content/${e.content_id}`}>{e.message}</Link> : e.message}</span>
          </div>
        )) : <Empty icon="log" title="Записей нет" />}
      </section>
    </div>
  );
}
