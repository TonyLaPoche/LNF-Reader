import type { BookRecord, BookSummary, ReadingProgress } from "./types";

const DB_NAME = "lnf-reader";
const STORE = "books";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function run<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const request = fn(tx.objectStore(STORE));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
        tx.oncomplete = () => db.close();
        tx.onerror = () => reject(tx.error);
      }),
  );
}

export function listBooks(): Promise<BookSummary[]> {
  return run<BookRecord[]>("readonly", (store) => store.getAll()).then((books) =>
    books
      .map(({ data: _data, ...summary }) => summary)
      .sort((a, b) => {
        const aTime = a.progress?.updatedAt ?? a.addedAt;
        const bTime = b.progress?.updatedAt ?? b.addedAt;
        return bTime - aTime;
      }),
  );
}

export function getBook(id: string): Promise<BookRecord | undefined> {
  return run<BookRecord | undefined>("readonly", (store) => store.get(id));
}

export function saveBook(book: BookRecord): Promise<IDBValidKey> {
  return run("readwrite", (store) => store.put(book));
}

export function deleteBook(id: string): Promise<undefined> {
  localStorage.removeItem(progressKey(id));
  return run("readwrite", (store) => store.delete(id));
}

export function progressKey(id: string): string {
  return `lnf:progress:${id}`;
}

export function readProgress(id: string): ReadingProgress | null {
  const raw = localStorage.getItem(progressKey(id));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ReadingProgress;
  } catch {
    return null;
  }
}

export function writeProgress(id: string, progress: ReadingProgress): void {
  localStorage.setItem(progressKey(id), JSON.stringify(progress));
}

export async function updateProgress(id: string, progress: ReadingProgress): Promise<void> {
  writeProgress(id, progress);
  const book = await getBook(id);
  if (!book) return;
  book.progress = progress;
  await saveBook(book);
}
