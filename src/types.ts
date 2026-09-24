export type BookFormat = "epub" | "pdf";

export type ReadingProgress = {
  cfi: string;
  page: number;
  percentage: number;
  chapter: string;
  updatedAt: number;
};

export type BookRecord = {
  id: string;
  format: BookFormat;
  title: string;
  author: string;
  fileName: string;
  series: string;
  volume: number | null;
  sizeBytes: number;
  addedAt: number;
  data: ArrayBuffer;
  cover: Blob | null;
  progress: ReadingProgress | null;
};

export type BookSummary = Omit<BookRecord, "data">;

export type ReaderPrefs = {
  fontScale: number;
  theme: "papier" | "sepia" | "nuit";
};
