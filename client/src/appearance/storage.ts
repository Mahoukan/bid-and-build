import { appearanceSchema, defaults, type Appearance } from './model.js';
import { newLocalId } from '../builder/model.js';

export const APPEARANCE_KEY = 'bid-build.appearance.v1';
const DATABASE = 'bid-build-appearance';
export type SavedAppearance = { preferences: Appearance; background: Blob | null; serialized: string | null };
export function readSettings(): { preferences: Appearance; serialized: string | null; error: string } {
  let serialized: string | null = null;
  try {
    serialized = localStorage.getItem(APPEARANCE_KEY);
    return { preferences: serialized ? appearanceSchema.parse(JSON.parse(serialized)) : { ...defaults }, serialized, error: '' };
  } catch { return { preferences: { ...defaults }, serialized, error: 'Saved appearance could not be read. Defaults are shown; existing browser data is untouched.' }; }
}
export function storageError(error: unknown) {
  if (error instanceof DOMException && error.name === 'QuotaExceededError') return 'Browser storage is full. Appearance was not saved. Remove the background or free some space, then try again.';
  if (error instanceof DOMException && ['SecurityError', 'InvalidStateError'].includes(error.name)) return 'Browser storage is unavailable. Allow site storage and try again. Your saved appearance was not changed.';
  return error instanceof Error ? error.message : 'Appearance could not be saved. Allow browser storage and try again.';
}
async function database() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1); let blocked = false;
    request.onupgradeneeded = () => request.result.createObjectStore('images');
    request.onerror = () => reject(new Error('Background storage is unavailable. Allow browser storage and try again.'));
    request.onblocked = () => { blocked = true; reject(new Error('Background storage is blocked. Close other Bid & Build tabs and retry.')); };
    request.onsuccess = () => { request.result.onversionchange = () => request.result.close(); if (blocked) request.result.close(); else resolve(request.result); };
  });
}
async function imageTransaction<T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await database();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction('images', mode); let result: T;
      tx.oncomplete = () => resolve(result); tx.onabort = () => reject(tx.error ?? new Error('Background storage was interrupted. Nothing was saved.'));
      try { const request = operation(tx.objectStore('images')); request.onsuccess = () => { result = request.result; }; } catch (error) { tx.abort(); reject(error); }
    });
  } finally { db.close(); }
}
export async function readBackground(id: string | null): Promise<Blob | null> {
  if (!id) return null;
  const value: unknown = await imageTransaction('readonly', (store) => store.get(id));
  if (!(value instanceof Blob) || value.type !== 'image/png' || value.size === 0 || value.size > 1024 * 1024) throw new Error('Saved background is missing or invalid. Choose a replacement or remove it.');
  return value;
}
export async function saveAppearance(preferences: Appearance, background: Blob | null, previous: SavedAppearance): Promise<SavedAppearance & { cleanupFailed: boolean }> {
  const next = appearanceSchema.parse(preferences);
  const check = () => { if (localStorage.getItem(APPEARANCE_KEY) !== previous.serialized) throw new Error('Appearance changed in another tab. Close this panel and reopen it before saving.'); };
  check();
  let added: string | null = null;
  try {
    if (background !== previous.background || (!background && next.backgroundId !== previous.preferences.backgroundId)) {
      next.backgroundId = background ? newLocalId() : null;
      if (background) {
        if (background.type !== 'image/png' || background.size > 1024 * 1024 || background.size === 0) throw new Error('Choose a valid background image.');
        added = next.backgroundId;
        await imageTransaction('readwrite', (store) => store.put(background, next.backgroundId!));
      }
    } else next.backgroundId = previous.preferences.backgroundId;
    // Commit the small pointer only after the image transaction completes.
    // Failed localStorage writes leave the old preferences and image usable.
    check();
    const serialized = JSON.stringify(next); localStorage.setItem(APPEARANCE_KEY, serialized);
    // Remove only the previous committed image. Never sweep another tab's
    // staged upload. Storage events make other tabs reload the current pointer.
    let cleanupFailed = false;
    const oldId = previous.preferences.backgroundId;
    if (oldId && oldId !== next.backgroundId) {
      try { await imageTransaction('readwrite', (store) => store.delete(oldId)); } catch { cleanupFailed = true; }
    }
    return { preferences: next, background, serialized, cleanupFailed };
  } catch (error) {
    if (added) await imageTransaction('readwrite', (store) => store.delete(added!)).catch(() => {});
    throw error;
  }
}
export async function resetAppearance(previous: SavedAppearance) {
  const saved = await saveAppearance({ ...defaults }, null, previous);
  return { saved, cleanupFailed: saved.cleanupFailed };
}
