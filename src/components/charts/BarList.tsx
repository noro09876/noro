import './charts.css';

export interface BarItem {
  key: string;
  label: string;
  value: number;
  display: string;
  secondary?: string;
}

interface BarListProps {
  items: BarItem[];
  ariaLabel: string;
  onSelect?: (key: string) => void;
  activeKeys?: Set<string>;
  max?: number;
}

/** Horizontal ranked bars; rows become toggle buttons when onSelect is given (cross-filtering). */
export function BarList({ items, ariaLabel, onSelect, activeKeys, max }: BarListProps) {
  const top = max ?? Math.max(1, ...items.map((i) => Math.abs(i.value)));
  return (
    <ul className="barlist list-reset" aria-label={ariaLabel}>
      {items.map((item, i) => {
        const pct = Math.max(1.5, (Math.abs(item.value) / top) * 100);
        const content = (
          <>
            <span className="barlist__bar" style={{ width: `${pct}%`, animationDelay: `${i * 40}ms` }} aria-hidden />
            <span className="barlist__label" title={item.label}>
              {item.label}
            </span>
            <span className="barlist__value">
              {item.display}
              {item.secondary ? <small>{item.secondary}</small> : null}
            </span>
          </>
        );
        return (
          <li key={item.key}>
            {onSelect ? (
              <button type="button" className="barlist__row" aria-pressed={activeKeys?.has(item.key) ?? false} onClick={() => onSelect(item.key)}>
                {content}
              </button>
            ) : (
              <div className="barlist__row">{content}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
