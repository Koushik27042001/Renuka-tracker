import type { VisitInput } from '@renuka/shared';
import { api, ApiError, post, type Employee } from './api';

export type QueuedDraft = {
  owner: string;
  key: string;
  expiresAt: number;
  input: VisitInput;
  failure?: string;
};
const ttl = 12 * 60 * 60 * 1000;
function open() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('renuka-employee-drafts', 1);
    request.onupgradeneeded = () =>
      request.result
        .createObjectStore('drafts', { keyPath: ['owner', 'key'] })
        .createIndex('owner', 'owner');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}
async function storage<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>) {
  const db = await open();
  return new Promise<T>((resolve, reject) => {
    const transaction = db.transaction('drafts', mode);
    const request = run(transaction.objectStore('drafts'));
    transaction.oncomplete = () => {
      db.close();
      resolve(request.result);
    };
    transaction.onabort = () => {
      db.close();
      reject(transaction.error);
    };
  });
}
export async function enqueue(owner: string, input: VisitInput, key: string) {
  await storage('readwrite', (store) =>
    store.put({ owner, input, key, expiresAt: Date.now() + ttl }),
  );
}
export async function removeDraft(owner: string, key: string) {
  await storage('readwrite', (store) => store.delete([owner, key]));
}
export async function queued(owner: string): Promise<QueuedDraft[]> {
  const drafts: QueuedDraft[] = await storage('readonly', (store) =>
    store.index('owner').getAll(owner),
  );
  const expired = drafts.filter((row) => row.expiresAt <= Date.now());
  await Promise.all(expired.map((row) => removeDraft(owner, row.key)));
  return drafts.filter((row) => row.expiresAt > Date.now());
}
export async function syncDrafts(employee: Employee, isCurrent: () => boolean) {
  for (const row of await queued(employee.id)) {
    if (!isCurrent()) break;
    if (row.failure) continue;
    try {
      await api('/visits', post({ ...row.input, key: row.key }));
      await removeDraft(employee.id, row.key);
    } catch (error) {
      if (
        !(error instanceof ApiError) ||
        error.status === 0 ||
        error.status === 401 ||
        error.status === 429 ||
        error.status >= 500
      )
        throw error;
      await storage('readwrite', (store) => store.put({ ...row, failure: error.message }));
    }
  }
}
