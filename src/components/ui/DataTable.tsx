import { useMemo, useRef, useState, type ReactNode, type UIEvent } from 'react';
import { Icon } from './Icon';

export interface Column<T> {
  key: string;
  header: ReactNode;
  /** Plain text header for aria/sort labels when header is a node. */
  label?: string;
  render: (row: T, index: number) => ReactNode;
  sortValue?: (row: T) => string | number;
  num?: boolean;
  width?: number | string;
  cellClass?: (row: T) => string | undefined;
}

interface DataTableProps<T> {
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string;
  /** Selection is controlled by the parent when provided. */
  selected?: Set<string>;
  onSelectedChange?: (next: Set<string>) => void;
  onRowClick?: (row: T) => void;
  activeKey?: string | null;
  maxHeight?: number;
  rowHeight?: number;
  caption: string;
  compact?: boolean;
  empty?: ReactNode;
  initialSort?: { key: string; dir: 'asc' | 'desc' };
}

const OVERSCAN = 8;

/**
 * Table with sticky header, sorting, row selection and windowed rendering
 * (only visible rows hit the DOM) so tens of thousands of rows stay responsive.
 */
export function DataTable<T>({
  rows,
  columns,
  rowKey,
  selected,
  onSelectedChange,
  onRowClick,
  activeKey,
  maxHeight = 520,
  rowHeight = 41,
  caption,
  compact,
  empty,
  initialSort,
}: DataTableProps<T>) {
  const [sort, setSort] = useState<{ key: string; dir: 'asc' | 'desc' } | null>(initialSort ?? null);
  const [scrollTop, setScrollTop] = useState(0);
  const wrap = useRef<HTMLDivElement>(null);

  const sorted = useMemo(() => {
    if (!sort) return rows;
    const col = columns.find((c) => c.key === sort.key);
    if (!col?.sortValue) return rows;
    const get = col.sortValue;
    const dir = sort.dir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const va = get(a);
      const vb = get(b);
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir;
      return String(va).localeCompare(String(vb), 'ru', { numeric: true }) * dir;
    });
  }, [rows, columns, sort]);

  const virtual = sorted.length > 120;
  const viewport = maxHeight;
  const start = virtual ? Math.max(0, Math.floor(scrollTop / rowHeight) - OVERSCAN) : 0;
  const end = virtual ? Math.min(sorted.length, Math.ceil((scrollTop + viewport) / rowHeight) + OVERSCAN) : sorted.length;
  const visible = sorted.slice(start, end);
  const padTop = start * rowHeight;
  const padBottom = (sorted.length - end) * rowHeight;

  const selectable = Boolean(selected && onSelectedChange);
  const allKeys = useMemo(() => sorted.map(rowKey), [sorted, rowKey]);
  const allSelected = selectable && allKeys.length > 0 && allKeys.every((k) => selected!.has(k));
  const someSelected = selectable && !allSelected && allKeys.some((k) => selected!.has(k));

  const toggleAll = () => {
    if (!onSelectedChange) return;
    onSelectedChange(allSelected ? new Set() : new Set(allKeys));
  };
  const toggle = (k: string) => {
    if (!selected || !onSelectedChange) return;
    const next = new Set(selected);
    if (next.has(k)) next.delete(k);
    else next.add(k);
    onSelectedChange(next);
  };

  const colSpan = columns.length + (selectable ? 1 : 0);

  return (
    <div
      ref={wrap}
      className="table-wrap"
      style={{ maxHeight }}
      onScroll={virtual ? (e: UIEvent<HTMLDivElement>) => setScrollTop(e.currentTarget.scrollTop) : undefined}
      tabIndex={0}
      role="region"
      aria-label={caption}
    >
      <table className={`table${compact ? ' table--compact' : ''}`} aria-rowcount={sorted.length + 1}>
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            {selectable ? (
              <th style={{ width: 40 }}>
                <input
                  type="checkbox"
                  aria-label="Выбрать все строки"
                  checked={allSelected}
                  ref={(el) => {
                    if (el) el.indeterminate = someSelected;
                  }}
                  onChange={toggleAll}
                  style={{ accentColor: 'var(--accent)' }}
                />
              </th>
            ) : null}
            {columns.map((c) => {
              const active = sort?.key === c.key;
              return (
                <th
                  key={c.key}
                  className={c.num ? 'num' : undefined}
                  style={c.width ? { width: c.width } : undefined}
                  aria-sort={active ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                  scope="col"
                >
                  {c.sortValue ? (
                    <button
                      type="button"
                      className="th-sort"
                      onClick={() =>
                        setSort((s) => (s?.key === c.key ? (s.dir === 'desc' ? { key: c.key, dir: 'asc' } : null) : { key: c.key, dir: 'desc' }))
                      }
                      aria-label={`Сортировать по «${c.label ?? (typeof c.header === 'string' ? c.header : c.key)}»`}
                    >
                      {c.header}
                      <Icon name={active ? 'chevronDown' : 'sort'} size={12} style={active && sort!.dir === 'asc' ? { transform: 'rotate(180deg)' } : undefined} />
                    </button>
                  ) : (
                    c.header
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sorted.length === 0 ? (
            <tr>
              <td colSpan={colSpan} style={{ whiteSpace: 'normal', maxWidth: 'none' }}>
                {empty ?? <div className="empty">Нет строк для отображения</div>}
              </td>
            </tr>
          ) : null}
          {padTop > 0 ? (
            <tr aria-hidden style={{ height: padTop }}>
              <td colSpan={colSpan} style={{ padding: 0, border: 0 }} />
            </tr>
          ) : null}
          {visible.map((row, i) => {
            const k = rowKey(row);
            const isSel = selected?.has(k) ?? false;
            return (
              <tr
                key={k}
                aria-selected={isSel || activeKey === k}
                aria-rowindex={start + i + 2}
                style={{ height: rowHeight, cursor: onRowClick ? 'pointer' : undefined }}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                tabIndex={onRowClick ? 0 : undefined}
                onKeyDown={
                  onRowClick
                    ? (e) => {
                        if (e.key === 'Enter' && e.target === e.currentTarget) onRowClick(row);
                      }
                    : undefined
                }
              >
                {selectable ? (
                  <td onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" aria-label="Выбрать строку" checked={isSel} onChange={() => toggle(k)} style={{ accentColor: 'var(--accent)' }} />
                  </td>
                ) : null}
                {columns.map((c) => (
                  <td key={c.key} className={[c.num ? 'num' : '', c.cellClass?.(row) ?? ''].join(' ').trim() || undefined}>
                    {c.render(row, start + i)}
                  </td>
                ))}
              </tr>
            );
          })}
          {padBottom > 0 ? (
            <tr aria-hidden style={{ height: padBottom }}>
              <td colSpan={colSpan} style={{ padding: 0, border: 0 }} />
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}
