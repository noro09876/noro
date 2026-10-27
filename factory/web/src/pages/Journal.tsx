import { useInfiniteQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api';
import { Badge, Button, Empty, fmtDate, Loading, Seg } from '../components/ui';
import { useWs, useWsApi } from '../session';
import type { AuditRow } from '../types';

export function JournalPage() {
  const { ws } = useWs();
  const u = useWsApi();
  const [level, setLevel] = useState<'all' | 'warn,error' | 'error'>('all');
  const q = useInfiniteQuery({
    queryKey: ['audit', ws.id, level],
    initialPageParam: '',
    queryFn: ({ pageParam }) => api.get<AuditRow[]>(u(`/audit?limit=60${level !== 'all' ? `&level=${level}` : ''}${pageParam ? `&before=${encodeURIComponent(pageParam)}` : ''}`)),
    getNextPageParam: (last) => (last.length === 60 ? last[last.length - 1]!.createdAt : undefined),
    refetchInterval: 10_000,
  });
  const rows = q.data?.pages.flat() ?? [];
  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>Журнал операций</h1>
          <p>Все действия людей и фоновых задач: генерации, рендеры, согласования, подключения, публикации, повторы и ошибки. Токены и ключи в журнал не попадают.</p>
        </div>
        <Seg value={level} onChange={setLevel} options={[{ value: 'all', label: 'Все' }, { value: 'warn,error', label: 'Предупреждения' }, { value: 'error', label: 'Ошибки' }]} />
      </div>
      {q.isLoading ? (
        <Loading />
      ) : rows.length === 0 ? (
        <div className="card"><Empty title="Записей нет" /></div>
      ) : (
        <div className="card table-wrap">
          <table className="table">
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="mono tiny dim nowrap">{fmtDate(r.createdAt)}</td>
                  <td><Badge tone={r.level === 'error' ? 'err' : r.level === 'warn' ? 'warn' : undefined}>{r.actorType === 'user' ? 'человек' : r.actorType === 'worker' ? 'фабрика' : 'система'}</Badge></td>
                  <td className="mono tiny muted nowrap">{r.action}</td>
                  <td className="small" style={{ color: r.level === 'error' ? 'var(--red)' : undefined }}>{r.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {q.hasNextPage && <Button onClick={() => q.fetchNextPage()} loading={q.isFetchingNextPage} style={{ alignSelf: 'center' }}>Показать ещё</Button>}
    </div>
  );
}
