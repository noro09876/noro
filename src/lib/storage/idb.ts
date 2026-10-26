/**
 * Tiny promise wrapper over IndexedDB (one key-value store).
 * Used for large local datasets; falls back to in-memory storage when
 * IndexedDB is unavailable (private mode in some browsers).
 */
const DB_NAME = 'noro';
const STORE = 'kv';
const VERSION = 1;

let dbPromise: Promise<IDBDatabase> | null = null;
const memory = new Map<string, unknown>();
let useMemory = false;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB недоступен'));
      return;
    }
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('Не удалось открыть IndexedDB'));
    req.onblocked = () => reject(new Error('IndexedDB заблокирована другой вкладкой'));
  });
  dbPromise.catch(() => {
    useMemory = true;
  });
  return dbPromise;
}

async function withStore<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('Ошибка IndexedDB'));
  });
}

export async function idbGet<T>(key: string): Promise<T | undefined> {
  if (useMemory) return memory.get(key) as T | undefined;
  try {
    return (await withStore<T>('readonly', (s) => s.get(key) as IDBRequest<T>)) ?? undefined;
  } catch {
    useMemory = true;
    return memory.get(key) as T | undefined;
  }
}

export async function idbSet<T>(key: string, value: T): Promise<void> {
  if (useMemory) {
    memory.set(key, value);
    return;
  }
  try {
    await withStore('readwrite', (s) => s.put(value, key));
  } catch (e) {
    if (e instanceof DOMException && e.name === 'QuotaExceededError') {
      throw new Error('Недостаточно места в хранилище браузера. Очистите старые данные или уменьшите файл.');
    }
    useMemory = true;
    memory.set(key, value);
  }
}

export async function idbDel(key: string): Promise<void> {
  memory.delete(key);
  if (useMemory) return;
  try {
    await withStore('readwrite', (s) => s.delete(key));
  } catch {
    /* ignore */
  }
}

export async function idbKeys(prefix = ''): Promise<string[]> {
  if (useMemory) return [...memory.keys()].filter((k) => k.startsWith(prefix));
  try {
    const keys = await withStore<IDBValidKey[]>('readonly', (s) => s.getAllKeys());
    return keys.map(String).filter((k) => k.startsWith(prefix));
  } catch {
    return [...memory.keys()].filter((k) => k.startsWith(prefix));
  }
}

export function isPersistent(): boolean {
  return !useMemory;
}

/** test helper */
export function __resetIdbForTests(): void {
  dbPromise = null;
  useMemory = false;
  memory.clear();
}
