import { useState } from 'react';
import { Modal } from '../ui/Modal';
import { Alert } from '../ui/Feedback';

export interface MappingField<K extends string> {
  key: K;
  label: string;
  required?: boolean;
  hint?: string;
}

interface MappingDialogProps<K extends string> {
  open: boolean;
  fileName: string;
  headers: string[];
  sample: Record<string, string>[];
  fields: MappingField<K>[];
  initial: Record<K, string>;
  warnings?: string[];
  rowCount: number;
  onCancel: () => void;
  onConfirm: (mapping: Record<K, string>) => void;
}

/** Lets the user confirm or correct auto-detected column mapping before import. */
export function MappingDialog<K extends string>({ open, fileName, headers, sample, fields, initial, warnings = [], rowCount, onCancel, onConfirm }: MappingDialogProps<K>) {
  const [mapping, setMapping] = useState<Record<K, string>>(initial);
  const missingRequired = fields.filter((f) => f.required && !mapping[f.key]);
  const detected = fields.filter((f) => mapping[f.key]).length;

  return (
    <Modal
      open={open}
      wide
      title="Сопоставление колонок"
      description={`${fileName} · строк: ${rowCount.toLocaleString('ru-RU')} · распознано полей: ${detected} из ${fields.length}`}
      onClose={onCancel}
      footer={
        <>
          <button type="button" className="btn btn--ghost" onClick={onCancel}>
            Отмена
          </button>
          <button type="button" className="btn btn--primary" disabled={missingRequired.length > 0} onClick={() => onConfirm(mapping)} data-testid="mapping-confirm">
            Импортировать
          </button>
        </>
      }
    >
      <div style={{ display: 'grid', gap: 14 }}>
        {warnings.map((w) => (
          <Alert key={w} kind="warning">
            {w}
          </Alert>
        ))}
        {missingRequired.length > 0 ? (
          <Alert kind="critical" title="Не хватает обязательных колонок">
            Выберите колонки для: {missingRequired.map((f) => f.label).join(', ')}.
          </Alert>
        ) : null}
        <div className="mapping">
          {fields.map((f) => {
            const h = mapping[f.key];
            const samples = h ? sample.map((r) => r[h]).filter(Boolean).slice(0, 3).join(' · ') : '';
            return (
              <div className="mapping__row" key={f.key}>
                <label htmlFor={`map-${f.key}`}>
                  {f.label}
                  {f.required ? <span style={{ color: 'var(--critical)' }}> *</span> : null}
                  {f.hint ? <div className="field__hint">{f.hint}</div> : null}
                </label>
                <select id={`map-${f.key}`} className="select select--sm" value={h} onChange={(e) => setMapping((m) => ({ ...m, [f.key]: e.target.value }))}>
                  <option value="">— не использовать —</option>
                  {headers.map((hd) => (
                    <option key={hd} value={hd}>
                      {hd}
                    </option>
                  ))}
                </select>
                <div className="mapping__sample" title={samples}>
                  {samples || (h ? 'нет значений в первых строках' : '')}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </Modal>
  );
}
