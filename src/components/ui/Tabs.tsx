import { useId, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

export interface TabItem<K extends string> {
  key: K;
  label: string;
  icon?: IconName;
  count?: number | string;
}

interface TabsProps<K extends string> {
  items: TabItem<K>[];
  value: K;
  onChange: (key: K) => void;
  label: string;
  idBase?: string;
}

/** WAI-ARIA tabs with arrow-key navigation. Panels use tabPanelProps(). */
export function Tabs<K extends string>({ items, value, onChange, label, idBase }: TabsProps<K>) {
  const auto = useId();
  const base = idBase ?? auto;
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const idx = items.findIndex((i) => i.key === value);
    let next = -1;
    if (e.key === 'ArrowRight') next = (idx + 1) % items.length;
    else if (e.key === 'ArrowLeft') next = (idx - 1 + items.length) % items.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = items.length - 1;
    if (next >= 0) {
      e.preventDefault();
      onChange(items[next]!.key);
      refs.current[next]?.focus();
    }
  };

  return (
    <div className="tabs" role="tablist" aria-label={label} onKeyDown={onKey}>
      {items.map((item, i) => (
        <button
          key={item.key}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="button"
          role="tab"
          id={`${base}-tab-${item.key}`}
          aria-selected={item.key === value}
          aria-controls={`${base}-panel-${item.key}`}
          tabIndex={item.key === value ? 0 : -1}
          className="tab"
          onClick={() => onChange(item.key)}
        >
          {item.icon ? <Icon name={item.icon} size={15} /> : null}
          {item.label}
          {item.count !== undefined ? <span className="tab__count">{item.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

export function TabPanel({ base, tabKey, children, className }: { base: string; tabKey: string; children: ReactNode; className?: string }) {
  return (
    <div role="tabpanel" id={`${base}-panel-${tabKey}`} aria-labelledby={`${base}-tab-${tabKey}`} className={className} tabIndex={0} style={{ outline: 'none' }}>
      {children}
    </div>
  );
}
