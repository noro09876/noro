import { useEffect, useRef, useState } from 'react';
import { readLocal, writeLocal } from '../lib/storage/local';

/** useState mirrored into localStorage (small settings only). */
export function usePersistentState<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => readLocal<T>(key, initial));
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    writeLocal(key, value);
  }, [key, value]);
  return [value, setValue] as const;
}
