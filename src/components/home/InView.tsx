import type { ReactNode } from 'react';
import { useInView } from '../../hooks/useInView';

export function InView({ children, className = '', delay = 0, as: Tag = 'div' }: { children: ReactNode; className?: string; delay?: number; as?: 'div' | 'section' | 'li' }) {
  const [ref, visible] = useInView<HTMLDivElement>();
  return (
    <Tag ref={ref as never} className={`in-view ${className}`} data-visible={visible} style={{ transitionDelay: `${delay}ms` }}>
      {children}
    </Tag>
  );
}
