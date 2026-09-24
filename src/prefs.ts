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

export function readLastBook(): { id: string; format: BookFormat; seriesKey: string; series: string } | null {
  const raw = localStorage.getItem(LAST_BOOK_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { id?: string; format?: BookFormat; seriesKey?: string };
    if (!parsed.id || (parsed.format !== "epub" && parsed.format !== "pdf")) return null;
    const seriesKey = parsed.seriesKey ?? "";
    return { id: parsed.id, format: parsed.format, seriesKey, series: seriesKey };
  } catch {
    return null;
  }
}

export function writeLastBook(id: string, format: BookFormat, seriesKey?: string): void {
  const previous = readLastBook();
  const kept = seriesKey ?? (previous?.id === id ? previous.seriesKey : "");
  localStorage.setItem(LAST_BOOK_KEY, JSON.stringify({ id, format, seriesKey: kept }));
}
