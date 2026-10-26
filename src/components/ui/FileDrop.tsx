import { useId, useRef, useState, type ReactNode } from 'react';
import { Icon } from './Icon';

interface FileDropProps {
  accept: string;
  hint: ReactNode;
  title?: string;
  onFile: (file: File) => void;
  busy?: boolean;
  multiple?: boolean;
  onFiles?: (files: File[]) => void;
  compact?: boolean;
  children?: ReactNode;
}

/** Drag-and-drop + button file input. Validation happens in the caller. */
export function FileDrop({ accept, hint, title = 'Перетащите файл сюда', onFile, busy, multiple, onFiles, compact, children }: FileDropProps) {
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const id = useId();

  const handle = (list: FileList | null) => {
    if (!list || list.length === 0) return;
    const files = [...list];
    if (multiple && onFiles) onFiles(files);
    else onFile(files[0]!);
  };

  return (
    <div
      className="dropzone"
      data-over={over}
      style={compact ? { padding: '18px 16px' } : undefined}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        handle(e.dataTransfer.files);
      }}
    >
      <div className="empty__icon" aria-hidden>
        {busy ? <span className="spinner" /> : <Icon name="upload" />}
      </div>
      <div className="dropzone__title">{busy ? 'Обрабатываем файл…' : title}</div>
      <div className="dropzone__hint">{hint}</div>
      <div className="btn-row" style={{ justifyContent: 'center' }}>
        <button type="button" className="btn btn--primary btn--sm" disabled={busy} onClick={() => input.current?.click()}>
          <Icon name="upload" /> Выбрать файл
        </button>
        {children}
      </div>
      <input
        ref={input}
        id={id}
        type="file"
        accept={accept}
        multiple={multiple}
        className="sr-only"
        tabIndex={-1}
        aria-label={title}
        disabled={busy}
        onChange={(e) => {
          handle(e.target.files);
          e.target.value = '';
        }}
      />
    </div>
  );
}
