import 'fake-indexeddb/auto';

// Minimal localStorage for storage tests in the node environment.
class MemoryStorage {
  private data = new Map<string, string>();
  get length() { return this.data.size; }
  clear() { this.data.clear(); }
  getItem(k: string) { return this.data.has(k) ? this.data.get(k)! : null; }
  key(i: number) { return [...this.data.keys()][i] ?? null; }
  removeItem(k: string) { this.data.delete(k); }
  setItem(k: string, v: string) { this.data.set(k, String(v)); }
}
if (!('localStorage' in globalThis)) {
  Object.defineProperty(globalThis, 'localStorage', { value: new MemoryStorage() });
}
