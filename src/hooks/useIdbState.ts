import { useCallback, useEffect, useRef, useState } from 'react';
import { idbGet, idbSet } from '../lib/storage/idb';

/** Synchronous safety copy for edits made right before the page unloads. */
const SAFETY_PREFIX = 'noro:unsaved:';
const SAFETY_MAX_CHARS = 3_000_000;

function readSafetyCopy<T>(key: string): T | undefined {
  try {
    const raw = localStorage.getItem(SAFETY_PREFIX + key);
    return raw == null ? undefined : (JSON.parse(raw) as T);
  } catch {
    return undefined;
  }
}

function dropSafetyCopy(key: string) {
  try {
    localStorage.removeItem(SAFETY_PREFIX + key);
  } catch {
    /* storage unavailable */
  }
}

/**
 * State persisted in IndexedDB (for datasets). Loads asynchronously; writes are
 * debounced. `loaded` is false until the stored value (if any) is read.
 *
 * IndexedDB writes started while the page unloads are often aborted, so on
 * `pagehide` an unsaved value is also copied to localStorage synchronously
 * (when small enough) and picked up on the next load.
 */
export function useIdbState<T>(key: string, initial: T, delay = 400) {
  const [value, setValue] = useState<T>(initial);
  const [loaded, setLoaded] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const skipNextSave = useRef(true);
  const pending = useRef<{ value: T } | null>(null);

  useEffect(() => {
    let alive = true;
    const unsaved = readSafetyCopy<T>(key);
    idbGet<T>(key)
      .then((v) => {
        if (!alive) return;
        if (unsaved !== undefined) {
          // newer than IndexedDB: restore it and persist properly
          setValue(unsaved);
          skipNextSave.current = false;
        } else if (v !== undefined) setValue(v);
      })
      .finally(() => {
        if (alive) setLoaded(true);
      });
    return () => {
      alive = false;
    };
  }, [key]);

  const write = useCallback(
    (v: T) =>
      idbSet(key, v)
        .then(() => {
          setSaveError(null);
          if (!pending.current) dropSafetyCopy(key);
        })
        .catch((e: unknown) => setSaveError(e instanceof Error ? e.message : 'Не удалось сохранить данные')),
    [key],
  );

  const flush = useCallback(() => {
    window.clearTimeout(timer.current);
    const p = pending.current;
    if (!p) return;
    pending.current = null;
    void write(p.value);
  }, [write]);

  useEffect(() => {
    if (!loaded) return;
    if (skipNextSave.current) {
      skipNextSave.current = false;
      return;
    }
    pending.current = { value };
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(flush, delay);
  }, [value, loaded, delay, flush]);

  useEffect(() => {
    const onHide = () => {
      const p = pending.current;
      if (p) {
        try {
          const json = JSON.stringify(p.value);
          if (json.length <= SAFETY_MAX_CHARS) localStorage.setItem(SAFETY_PREFIX + key, json);
        } catch {
          /* quota or storage disabled: IndexedDB write below is best effort */
        }
      }
      flush();
    };
    // restored from the back/forward cache: IndexedDB already has the data
    const onShow = (e: PageTransitionEvent) => {
      if (e.persisted && !pending.current) dropSafetyCopy(key);
    };
    window.addEventListener('pagehide', onHide);
    window.addEventListener('pageshow', onShow);
    return () => {
      window.removeEventListener('pagehide', onHide);
      window.removeEventListener('pageshow', onShow);
      flush();
    };
  }, [flush, key]);

  const reset = useCallback((v: T) => setValue(v), []);
  return { value, setValue, loaded, saveError, reset };
}
