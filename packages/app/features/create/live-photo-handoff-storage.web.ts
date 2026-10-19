import type { SavedHandoff } from './live-photo-handoff-draft';
import { registerUserDataReset } from '../../lib/utils/storage';

const DATABASE = 'dvnt-live-photo-draft';
const STORE = 'drafts';
const RETAIN_MS = 24 * 60 * 60 * 1000;
let generation = 0;
function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('This browser cannot safely save your draft. The app has not been opened.'));
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'ownerId' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('Draft storage is unavailable. The app has not been opened.'));
    request.onblocked = () => reject(new Error('Close older DVNT tabs and retry saving your draft.'));
  });
}
export async function saveHandoffDraft(saved: SavedHandoff): Promise<void> {
  const current = generation;
  const db = await openDatabase();
  try {
    if (current !== generation) throw new Error('Account changed. Please start again.');
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      const existing = store.get(saved.ownerId);
      existing.onsuccess = () => {
        if (existing.result && existing.result.draftId !== saved.draftId) { tx.abort(); return; }
        store.put(saved);
      };
      tx.oncomplete = () => current === generation ? resolve() : reject(new Error('Account changed. Please start again.'));
      tx.onabort = tx.onerror = () => reject(new Error('Could not save your draft. Storage may be full or unavailable. The app has not been opened.'));
    });
  } finally { db.close(); }
}
export async function loadHandoffDraft(ownerId: string): Promise<SavedHandoff | null> {
  const db = await openDatabase();
  try {
    const result = await new Promise<SavedHandoff | undefined>((resolve, reject) => {
      const request = db.transaction(STORE).objectStore(STORE).get(ownerId);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    if (!result || result.ownerId !== ownerId) return null;
    if (Date.now() - result.savedAt > RETAIN_MS) { await deleteHandoffDraft(ownerId, result.draftId); return null; }
    return result;
  } finally { db.close(); }
}
export async function deleteHandoffDraft(ownerId?: string, draftId?: string): Promise<void> {
  const db = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      if (ownerId) {
        const existing = store.get(ownerId);
        existing.onsuccess = () => {
          if (existing.result && existing.result.draftId !== draftId) { tx.abort(); return; }
          store.delete(ownerId);
        };
      } else store.clear();
      tx.oncomplete = () => resolve();
      tx.onabort = tx.onerror = () => reject(tx.error);
    });
  } finally { db.close(); }
}
registerUserDataReset(() => {
  generation += 1;
  if (typeof indexedDB !== 'undefined') void deleteHandoffDraft().catch(() => {});
});
