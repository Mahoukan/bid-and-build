import { z } from 'zod';
import { templateSchema, type GameTemplate } from '../../../shared/template.js';

const DATABASE = 'bid-and-build-local';
export const draftNameSchema = z.string().trim().min(1, 'Enter a draft name.').max(120);
const recordSchema = z.strictObject({
  id: z.string().uuid(), name: draftNameSchema, template: templateSchema,
  revision: z.number().int().positive(), updatedAt: z.number().int().nonnegative(),
});
export type DraftRecord = z.infer<typeof recordSchema>;
export type DraftSummary = Omit<DraftRecord, 'template'>;
const summarySchema = recordSchema.omit({ template: true });

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    let blocked = false;
    request.onupgradeneeded = () => {
      const db = request.result;
      db.createObjectStore('drafts', { keyPath: 'id' });
      db.createObjectStore('meta');
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => { blocked = true; reject(new Error('Close other Bid & Build tabs and try again. Local storage is waiting for an update.')); };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => db.close();
      if (blocked) db.close(); else resolve(db);
    };
  });
}

async function transaction<T>(mode: IDBTransactionMode, operation: (tx: IDBTransaction, result: (value: T) => void, fail: (error: Error) => void) => void): Promise<T> {
  const db = await openDatabase();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(['drafts', 'meta'], mode);
      let value: T;
      let failure: Error | undefined;
      const fail = (error: Error) => { failure = error; tx.abort(); };
      tx.oncomplete = () => resolve(value);
      tx.onabort = () => reject(failure ?? tx.error ?? new Error('Local storage write was interrupted.'));
      // Success is only reported after the entire transaction commits.
      try { operation(tx, (result) => { value = result; }, fail); } catch (error) { fail(error as Error); }
    });
  } finally { db.close(); }
}

export async function listDrafts(): Promise<DraftSummary[]> {
  return transaction('readonly', (tx, done, fail) => {
    const rows: DraftSummary[] = [];
    const cursor = tx.objectStore('drafts').openCursor();
    cursor.onsuccess = () => {
      if (!cursor.result) { done(rows.sort((a, b) => b.updatedAt - a.updatedAt)); return; }
      const row = cursor.result.value as DraftRecord;
      try { rows.push(summarySchema.parse({ id: row.id, name: row.name, revision: row.revision, updatedAt: row.updatedAt })); }
      catch { fail(new Error('A saved draft has invalid metadata. Its stored data has been left intact.')); return; }
      cursor.result.continue();
    };
  });
}

export async function loadDraft(id?: string): Promise<DraftRecord | null> {
  return transaction(id ? 'readwrite' : 'readonly', (tx, done, fail) => {
    const read = (key: string | undefined) => {
      if (!key) { done(null); return; }
      const request = tx.objectStore('drafts').get(key);
      request.onsuccess = () => {
        try {
          const record = request.result ? recordSchema.parse(request.result) : null;
          if (id && record) tx.objectStore('meta').put(id, 'lastDraft');
          done(record);
        }
        catch { fail(new Error('This saved draft could not be read. Its stored format is invalid.')); }
      };
    };
    if (id) read(id);
    else {
      const request = tx.objectStore('meta').get('lastDraft');
      request.onsuccess = () => read(request.result as string | undefined);
    }
  });
}

export async function saveDraft(input: { id: string; name: string; template: GameTemplate }, expectedRevision: number | null): Promise<DraftRecord> {
  const record = recordSchema.parse({ ...input, revision: (expectedRevision ?? 0) + 1, updatedAt: Date.now() });
  return transaction('readwrite', (tx, done, fail) => {
    const store = tx.objectStore('drafts');
    const request = store.get(record.id);
    request.onsuccess = () => {
      const current = request.result as DraftRecord | undefined;
      if ((current?.revision ?? null) !== expectedRevision) {
        fail(new Error('This draft changed in another tab or was deleted. Export your edits, then reload it, or use Save as copy.'));
        return;
      }
      store.put(record);
      tx.objectStore('meta').put(record.id, 'lastDraft');
      done(record);
    };
  });
}

export async function deleteDraft(id: string, expectedRevision: number): Promise<void> {
  return transaction('readwrite', (tx, done, fail) => {
    const store = tx.objectStore('drafts');
    const request = store.get(id);
    request.onsuccess = () => {
      const current = request.result as DraftRecord | undefined;
      if (current?.revision !== expectedRevision) { fail(new Error('This draft changed in another tab. Reload the draft list before deleting it.')); return; }
      store.delete(id);
      const last = tx.objectStore('meta').get('lastDraft');
      last.onsuccess = () => { if (last.result === id) tx.objectStore('meta').delete('lastDraft'); };
      done(undefined);
    };
  });
}

export function storageMessage(error: unknown): string {
  if (error instanceof DOMException && error.name === 'QuotaExceededError') return 'Browser storage is full. Nothing was saved. Export your edits, then remove unused drafts or free browser storage.';
  return error instanceof Error ? error.message : 'Browser storage is unavailable. Nothing was saved; you can still export your edits.';
}
