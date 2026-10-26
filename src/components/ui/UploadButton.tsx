import { useRef, type ReactNode } from 'react';
import { Icon } from './Icon';

/** Keyboard-accessible button that opens a file picker. */
export function UploadButton({ accept, onFile, children = 'Свои данные', className = 'btn btn--outline btn--sm', disabled }: { accept: string; onFile: (f: File) => void; children?: ReactNode; className?: string; disabled?: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <button type="button" className={className} onClick={() => ref.current?.click()} disabled={disabled}>
        <Icon name="upload" /> {children}
      </button>
      <input
        ref={ref}
        type="file"
        accept={accept}
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = '';
        }}
      />
    </>
  );
}
