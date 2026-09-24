import type { BookFormat, ReaderPrefs } from "./types";

const PREFS_KEY = "lnf:prefs";
const LAST_BOOK_KEY = "lnf:last-book";

const DEFAULT_PREFS: ReaderPrefs = {
  fontScale: 100,
  theme: "papier",
};

export function readPrefs(): ReaderPrefs {
  const raw = localStorage.getItem(PREFS_KEY);
  if (!raw) return DEFAULT_PREFS;
  try {
    return { ...DEFAULT_PREFS, ...(JSON.parse(raw) as Partial<ReaderPrefs>) };
  } catch {
    return DEFAULT_PREFS;
  }
}

export function writePrefs(prefs: ReaderPrefs): void {
  localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
}

export function readLastBook(): { id: string; format: BookFormat } | null {
  const raw = localStorage.getItem(LAST_BOOK_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { id?: string; format?: BookFormat };
    if (!parsed.id || (parsed.format !== "epub" && parsed.format !== "pdf")) return null;
    return { id: parsed.id, format: parsed.format };
  } catch {
    return null;
  }
}

export function writeLastBook(id: string, format: BookFormat): void {
  localStorage.setItem(LAST_BOOK_KEY, JSON.stringify({ id, format }));
}
