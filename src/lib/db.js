import { openDB } from 'idb';

export const DB_NAME = 'ce-money-tracker-pro';
export const DB_VERSION = 1;
export const STORES = ['wallets', 'categories', 'transactions', 'budgets', 'slips', 'notifications', 'meta'];

export const dbPromise = Promise.resolve()
  .then(() =>
    openDB(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion) {
        if (oldVersion < 1) {
          db.createObjectStore('wallets', { keyPath: 'id' });
          db.createObjectStore('categories', { keyPath: 'id' });
          const tx = db.createObjectStore('transactions', { keyPath: 'id' });
          tx.createIndex('date', 'date');
          tx.createIndex('walletId', 'walletId');
          tx.createIndex('categoryId', 'categoryId');
          db.createObjectStore('budgets', { keyPath: 'id' });
          db.createObjectStore('slips', { keyPath: 'id' });
          db.createObjectStore('notifications', { keyPath: 'id' });
          db.createObjectStore('meta', { keyPath: 'key' });
        }
      },
    }),
  )
  .catch(() => null);

export async function getAll(store) {
  const db = await dbPromise;
  return db ? db.getAll(store) : [];
}
export async function put(store, value) {
  const db = await dbPromise;
  if (db) await db.put(store, value);
  return value;
}
export async function get(store, key) {
  const db = await dbPromise;
  return db ? db.get(store, key) : null;
}
export async function getMeta(key, fallback) {
  const row = await get('meta', key);
  return row ? row.value : fallback;
}
export async function setMeta(key, value) {
  return put('meta', { key, value });
}

export function uid() {
  try {
    if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  } catch {
    /* ignore */
  }
  return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

export async function requestPersistence() {
  try {
    if (navigator.storage?.persist) await navigator.storage.persist();
  } catch {
    /* ignore */
  }
}
