import { idbDel, idbKeys } from './idb';
import { localKeys, removeLocal } from './local';

export * from './idb';
export * from './local';

/** Removes all locally stored data for a product (prefix like 'lead-engine'). */
export async function clearProductData(product: string): Promise<void> {
  for (const k of [...localKeys(product), ...localKeys(`unsaved:${product}`)]) removeLocal(k);
  for (const k of await idbKeys(product)) await idbDel(k);
}

/** Removes every NORO record from this browser. */
export async function clearAllData(): Promise<void> {
  for (const k of localKeys('')) removeLocal(k);
  for (const k of await idbKeys('')) await idbDel(k);
}
