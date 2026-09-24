export type ChapterTranslation = {
  id: string;
  bookId: string;
  href: string;
  paragraphs: string[];
  updatedAt: number;
};

const DB_NAME = "lnf-translations";
const STORE = "chapters";

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

export function translationId(bookId: string, href: string): string {
  return `${bookId}::${href.split("#")[0]}`;
}

export async function readTranslation(bookId: string, href: string): Promise<ChapterTranslation | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE, "readonly").objectStore(STORE).get(translationId(bookId, href));
    request.onsuccess = () => resolve((request.result as ChapterTranslation | undefined) ?? null);
    request.onerror = () => reject(request.error);
  });
}

export async function writeTranslation(entry: ChapterTranslation): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const request = db.transaction(STORE, "readwrite").objectStore(STORE).put(entry);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}
