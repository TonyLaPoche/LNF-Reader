import type { BookSummary } from "./types";

export type ReleaseInfo = {
  series: string;
  subtitle: string;
  volume: number | null;
  volumeLabel: string;
};

export type SeriesGroup = {
  key: string;
  title: string;
  subtitle: string;
  volumes: BookSummary[];
  latest: BookSummary;
};

const VOLUME_PATTERN = /(?:^|[\s._-])(?:vol(?:ume)?|tome)\.?\s*(\d+(?:\.\d+)?)/i;

export function parseRelease(fileName: string): ReleaseInfo {
  const base = fileName.replace(/\.(epub|pdf)$/i, "").trim();
  const underscore = base.indexOf("_");
  const head = (underscore === -1 ? base : base.slice(0, underscore)).trim();
  const tail = (underscore === -1 ? base : base.slice(underscore + 1)).trim();
  const source = underscore === -1 ? base : tail;
  const match = source.match(VOLUME_PATTERN) ?? base.match(VOLUME_PATTERN);
  const volume = match ? Number(match[1]) : null;
  const subtitle = source
    .replace(VOLUME_PATTERN, " ")
    .replace(/[._]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const series = (underscore === -1 ? source.replace(VOLUME_PATTERN, " ") : head)
    .replace(/[._]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return {
    series: series || base,
    subtitle: subtitle && subtitle.toLowerCase() !== series.toLowerCase() ? subtitle : "",
    volume: Number.isFinite(volume) ? volume : null,
    volumeLabel: volume == null ? "Volume unique" : `Vol. ${formatVolume(volume)}`,
  };
}

export function bookSize(book: Pick<BookSummary, "id" | "sizeBytes">): number {
  if (book.sizeBytes && book.sizeBytes > 0) return book.sizeBytes;
  const parts = book.id.split(":");
  const size = Number(parts.at(-2));
  return Number.isFinite(size) ? size : 0;
}

export function formatSize(bytes: number): string {
  if (bytes <= 0) return "";
  const mb = bytes / (1024 * 1024);
  return `${mb >= 10 ? mb.toFixed(1) : mb.toFixed(2)} MB`;
}

export function groupSeries(books: BookSummary[]): SeriesGroup[] {
  const groups = new Map<string, SeriesGroup>();

  for (const book of books) {
    const info = parseRelease(book.fileName || book.title);
    const key = info.series.toLowerCase();
    const current = groups.get(key);
    if (!current) {
      groups.set(key, {
        key,
        title: info.series,
        subtitle: info.subtitle,
        volumes: [book],
        latest: book,
      });
      continue;
    }
    current.volumes.push(book);
    if (!current.subtitle && info.subtitle) current.subtitle = info.subtitle;
    const currentTime = current.latest.progress?.updatedAt ?? current.latest.addedAt;
    const nextTime = book.progress?.updatedAt ?? book.addedAt;
    if (nextTime > currentTime) current.latest = book;
  }

  for (const group of groups.values()) {
    group.volumes.sort((a, b) => volumeOf(a) - volumeOf(b) || a.fileName.localeCompare(b.fileName));
  }

  return [...groups.values()].sort((a, b) => {
    const aTime = a.latest.progress?.updatedAt ?? a.latest.addedAt;
    const bTime = b.latest.progress?.updatedAt ?? b.latest.addedAt;
    return bTime - aTime;
  });
}

export function volumeOf(book: Pick<BookSummary, "fileName" | "title" | "volume">): number {
  if (typeof book.volume === "number") return book.volume;
  return parseRelease(book.fileName || book.title).volume ?? Number.MAX_SAFE_INTEGER;
}

export function volumeLabel(book: Pick<BookSummary, "fileName" | "title" | "volume">): string {
  const parsed = parseRelease(book.fileName || book.title);
  if (typeof book.volume === "number") return `Vol. ${formatVolume(book.volume)}`;
  return parsed.volumeLabel;
}

function formatVolume(volume: number): string {
  return Number.isInteger(volume) ? String(volume) : String(volume);
}
