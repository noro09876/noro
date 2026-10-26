import { useMemo, useState } from 'react';
import { DataTable, type Column } from '../../../components/ui/DataTable';
import { Icon } from '../../../components/ui/Icon';
import { Modal } from '../../../components/ui/Modal';
import { countLabel } from '../../../lib/format';
import { CATALOG_FIELDS, FIELD_LABELS, ISSUE_META, type CatalogField, type Issue, type IssueKind, type Product } from '../logic/types';

interface Props {
  rows: Product[];
  issues: Issue[];
  mapped: Set<CatalogField>;
  kindFilter: IssueKind | null;
  setKindFilter: (k: IssueKind | null) => void;
  commit: (label: string, next: Product[], toast?: string) => void;
}

const SHOWN: CatalogField[] = ['sku', 'name', 'brand', 'category', 'price', 'oldPrice', 'stock', 'barcode'];

export function ProductsTab({ rows, issues, mapped, kindFilter, setKindFilter, commit }: Props) {
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [edit, setEdit] = useState<Product | null>(null);
  const [bulkField, setBulkField] = useState<CatalogField>('category');
  const [bulkValue, setBulkValue] = useState('');

  const byRow = useMemo(() => {
    const m = new Map<string, Issue[]>();
    for (const i of issues) m.set(i.rowId, [...(m.get(i.rowId) ?? []), i]);
    return m;
  }, [issues]);
  const cellIssue = useMemo(() => {
    const m = new Map<string, Issue>();
    for (const i of issues) {
      const k = `${i.rowId}:${i.field}`;
      const prev = m.get(k);
      if (!prev || (prev.severity !== 'error' && i.severity === 'error')) m.set(k, i);
    }
    return m;
  }, [issues]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const kindRows = kindFilter ? new Set(issues.filter((i) => i.kind === kindFilter).map((i) => i.rowId)) : null;
    return rows.filter((r) => (!kindRows || kindRows.has(r.id)) && (!needle || CATALOG_FIELDS.some((f) => (r.v[f] ?? '').toLowerCase().includes(needle))));
  }, [rows, q, kindFilter, issues]);

  const fields = SHOWN.filter((f) => mapped.has(f) || rows.some((r) => r.v[f]));
  const columns: Column<Product>[] = [
    {
      key: 'st',
      header: '',
      label: 'Проблемы',
      width: 36,
      sortValue: (r) => (byRow.get(r.id) ?? []).filter((i) => i.severity !== 'info').length,
      render: (r) => {
        const list = (byRow.get(r.id) ?? []).filter((i) => i.severity !== 'info');
        if (!list.length) return null;
        const err = list.some((i) => i.severity === 'error');
        return <Icon name={err ? 'alertCircle' : 'alert'} size={15} style={{ color: err ? 'var(--critical)' : 'var(--warning)' }} title={list.map((i) => ISSUE_META[i.kind].label).join(', ')} />;
      },
    },
    ...fields.map<Column<Product>>((f) => ({
      key: f,
      header: FIELD_LABELS[f],
      num: f === 'price' || f === 'oldPrice' || f === 'stock',
      sortValue: (r) => r.v[f] ?? '',
      cellClass: (r) => {
        const i = cellIssue.get(`${r.id}:${f}`);
        return i && i.severity !== 'info' ? (i.severity === 'error' ? 'cell-error' : 'cell-issue') : undefined;
      },
      render: (r) => {
        const val = r.v[f] ?? '';
        const i = cellIssue.get(`${r.id}:${f}`);
        return (
          <span className={f === 'name' ? 'cs-name' : 'nowrap'} title={i ? `${ISSUE_META[i.kind].label}: ${i.message}` : val}>
            {val || <span className="dim">—</span>}
          </span>
        );
      },
    })),
  ];

  const selectedCount = selected.size;
  const applyBulk = () => {
    const next = rows.map((r) => (selected.has(r.id) ? { ...r, v: { ...r.v, [bulkField]: bulkValue } } : r));
    commit('массовая правка', next, `«${FIELD_LABELS[bulkField]}» изменено у ${countLabel(selectedCount, ['товара', 'товаров', 'товаров'])}`);
  };
  const removeSelected = () => {
    commit('удаление строк', rows.filter((r) => !selected.has(r.id)), `Удалено: ${countLabel(selectedCount, ['строка', 'строки', 'строк'])}`);
    setSelected(new Set());
  };

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div className="toolbar">
        <label className="search" style={{ flex: '1 1 220px' }}>
          <Icon name="search" size={14} />
          <span className="sr-only">Поиск по товарам</span>
          <input className="input input--sm" type="search" aria-label="Поиск товаров" placeholder="Артикул, название, бренд…" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        {kindFilter ? (
          <button type="button" className="chip chip--active" onClick={() => setKindFilter(null)} aria-label={`Сбросить фильтр «${ISSUE_META[kindFilter].label}»`}>
            {ISSUE_META[kindFilter].label} <Icon name="x" size={12} />
          </button>
        ) : null}
        <span className="dim" style={{ fontSize: 'var(--fs-xs)' }}>
          Показано {filtered.length.toLocaleString('ru-RU')} из {rows.length.toLocaleString('ru-RU')}
        </span>
      </div>
      {selectedCount ? (
        <div className="sticky-actions" data-testid="bulk-bar">
          <b style={{ fontSize: 'var(--fs-sm)' }}>Выбрано: {selectedCount}</b>
          <label className="sr-only" htmlFor="bulk-field">
            Поле
          </label>
          <select id="bulk-field" className="select" style={{ height: 32, width: 'auto' }} value={bulkField} onChange={(e) => setBulkField(e.target.value as CatalogField)}>
            {CATALOG_FIELDS.map((f) => (
              <option key={f} value={f}>
                {FIELD_LABELS[f]}
              </option>
            ))}
          </select>
          <label className="sr-only" htmlFor="bulk-value">
            Новое значение
          </label>
          <input id="bulk-value" className="input input--sm" style={{ width: 180 }} placeholder="новое значение" value={bulkValue} onChange={(e) => setBulkValue(e.target.value)} />
          <button type="button" className="btn btn--primary btn--sm" onClick={applyBulk} data-testid="bulk-apply">
            Применить
          </button>
          <button type="button" className="btn btn--ghost btn--sm" onClick={removeSelected}>
            <Icon name="trash" /> Удалить строки
          </button>
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => setSelected(new Set())}>
            Снять выбор
          </button>
        </div>
      ) : null}
      <DataTable<Product>
        caption="Товары каталога"
        rows={filtered}
        columns={columns}
        rowKey={(r) => r.id}
        selected={selected}
        onSelectedChange={setSelected}
        onRowClick={(r) => setEdit(r)}
        compact
        maxHeight={540}
        empty={<p className="dim" style={{ padding: 16 }}>Ничего не найдено.</p>}
      />
      {edit ? <EditModal product={edit} issues={byRow.get(edit.id) ?? []} onClose={() => setEdit(null)} onSave={(p) => { commit('правка товара', rows.map((r) => (r.id === p.id ? p : r)), 'Товар сохранён'); setEdit(null); }} /> : null}
    </div>
  );
}

function EditModal({ product, issues, onClose, onSave }: { product: Product; issues: Issue[]; onClose: () => void; onSave: (p: Product) => void }) {
  const [v, setV] = useState(product.v);
  return (
    <Modal
      open
      wide
      title={product.v.name || product.v.sku || 'Товар'}
      description={product.v.sku ? `Артикул ${product.v.sku}` : undefined}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            Отмена
          </button>
          <button type="button" className="btn btn--primary" onClick={() => onSave({ ...product, v })} data-testid="product-save">
            <Icon name="check" /> Сохранить
          </button>
        </>
      }
    >
      {issues.length ? (
        <ul className="list-reset" style={{ display: 'grid', gap: 4, marginBottom: 12 }}>
          {issues.map((i, n) => (
            <li key={n} className={`chk chk--${i.severity === 'error' ? 'error' : i.severity === 'warning' ? 'warning' : 'ok'}`}>
              {FIELD_LABELS[i.field]}: {ISSUE_META[i.kind].label} — {i.message}
            </li>
          ))}
        </ul>
      ) : null}
      <div className="split" style={{ gap: 10 }}>
        {CATALOG_FIELDS.map((f) => (
          <label key={f} className="field" style={f === 'description' ? { gridColumn: '1 / -1' } : undefined}>
            <span className="field__label">{FIELD_LABELS[f]}</span>
            {f === 'description' ? (
              <textarea className="textarea" rows={4} value={v[f] ?? ''} onChange={(e) => setV({ ...v, [f]: e.target.value })} />
            ) : (
              <input className="input" value={v[f] ?? ''} onChange={(e) => setV({ ...v, [f]: e.target.value })} data-testid={`product-${f}`} />
            )}
          </label>
        ))}
      </div>
    </Modal>
  );
}
