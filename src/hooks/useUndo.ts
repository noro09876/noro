import { useCallback, useRef, useState } from 'react';

/** Snapshot-based undo/redo stack for reversible bulk operations. */
export function useUndo<T>(limit = 15) {
  const past = useRef<Array<{ label: string; snapshot: T }>>([]);
  const future = useRef<Array<{ label: string; snapshot: T }>>([]);
  const [, force] = useState(0);

  const push = useCallback(
    (label: string, snapshot: T) => {
      past.current = [...past.current.slice(-(limit - 1)), { label, snapshot }];
      future.current = [];
      force((n) => n + 1);
    },
    [limit],
  );

  const undo = useCallback((current: T): { label: string; snapshot: T } | null => {
    const last = past.current.pop();
    if (!last) return null;
    future.current.push({ label: last.label, snapshot: current });
    force((n) => n + 1);
    return last;
  }, []);

  const redo = useCallback((current: T): { label: string; snapshot: T } | null => {
    const next = future.current.pop();
    if (!next) return null;
    past.current.push({ label: next.label, snapshot: current });
    force((n) => n + 1);
    return next;
  }, []);

  const clear = useCallback(() => {
    past.current = [];
    future.current = [];
    force((n) => n + 1);
  }, []);

  return {
    push,
    undo,
    redo,
    clear,
    canUndo: past.current.length > 0,
    canRedo: future.current.length > 0,
    undoLabel: past.current.at(-1)?.label,
    redoLabel: future.current.at(-1)?.label,
  };
}
