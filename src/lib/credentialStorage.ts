import AsyncStorage from '@react-native-async-storage/async-storage';
import { isLegacySessionKey, migrateCredentials, type CredentialStore } from './credentialMigration';

// accountDeletion uses encodeURIComponent on the complete HTTP(S) backend URL.
const receiptPrefix = 'campusclutch:account-deletion:v1:';
const encodedBackendUrl = /^https?%3A%2F%2F(?:[\w.!~*'()-]|%[\da-f]{2})+$/i;

// Static web uses the Auth SDK's per-client memory storage. Discard tokens
// left by older releases the first time the browser loads the updated app.
export function sessionStorageForProject() {
  if (typeof window !== 'undefined') {
    try {
      const storage = window.localStorage;
      // Removing a key can change the browser's enumeration order.
      const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index));
      for (const key of keys) {
        if (!key) continue;
        if (isLegacySessionKey(key)) storage.removeItem(key);
        else if (key.startsWith(receiptPrefix) && encodedBackendUrl.test(key.slice(receiptPrefix.length))) {
          // Each namespace migrates independently. A failed write keeps the old
          // receipt for the next startup or an explicit read by its own project.
          void credentialStorage.getItem(key).catch(() => {});
        }
      }
    } catch (error) {
      // Browser storage may be disabled. Only ignore denial of access.
      if (!(error instanceof DOMException && error.name === 'SecurityError')) throw error;
    }
  }
  return undefined;
}

// A deletion receipt can be needed after sign-out or a browser restart.
// IndexedDB can store a non-extractable CryptoKey with the encrypted receipt.
type BrowserReceipt = { key: CryptoKey; iv: Uint8Array<ArrayBuffer>; ciphertext: ArrayBuffer };
async function receiptRecord(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest) {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const open = indexedDB.open('campusclutch-deletion-receipts', 1);
    open.onupgradeneeded = () => open.result.createObjectStore('receipts');
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error);
  });
  try {
    return await new Promise<BrowserReceipt | undefined>((resolve, reject) => {
      const tx = db.transaction('receipts', mode);
      const request = action(tx.objectStore('receipts'));
      tx.oncomplete = () => resolve(request.result);
      tx.onabort = () => reject(tx.error ?? new Error('Unable to save deletion status.'));
    });
  } finally { db.close(); }
}

const receipts = migrateCredentials({
  async getItem(name) {
    if (typeof indexedDB === 'undefined') return null;
    const entry = await receiptRecord('readonly', store => store.get(name));
    if (!entry) return null;
    const bytes = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: entry.iv,
      additionalData: new TextEncoder().encode(name) }, entry.key, entry.ciphertext);
    return new TextDecoder().decode(bytes);
  },
  async setItem(name, value) {
    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv,
      additionalData: new TextEncoder().encode(name) }, key, new TextEncoder().encode(value));
    await receiptRecord('readwrite', store => store.put({ key, iv, ciphertext }, name));
  },
  async removeItem(name) {
    await receiptRecord('readwrite', store => store.delete(name));
  },
}, AsyncStorage);

// Two tabs can open the same origin during an upgrade. Serialize migration
// with updates and removal so a delayed tab cannot restore a cleared receipt.
async function withReceiptLock<T>(name: string, operation: () => Promise<T>): Promise<T> {
  if (typeof navigator !== 'undefined' && navigator.locks) {
    return navigator.locks.request(name, operation);
  }
  return operation();
}

export const credentialStorage: CredentialStore = {
  getItem: name => withReceiptLock(name, () => receipts.getItem(name)),
  setItem: (name, value) => withReceiptLock(name, () => receipts.setItem(name, value)),
  removeItem: name => withReceiptLock(name, () => receipts.removeItem(name)),
};
