import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { getBook, readProgress, updateProgress } from "./db";
import { openPdf } from "./pdf";
import { readPrefs, writeLastBook, writePrefs } from "./prefs";
import { trackVerticalSwipe } from "./swipe";
import type { ReaderPrefs } from "./types";

type PdfReaderProps = {
  bookId: string;
  onBack: () => void;
};

export function PdfReader({ bookId, onBack }: PdfReaderProps) {
  const frameRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pdfRef = useRef<PDFDocumentProxy | null>(null);
  const [title, setTitle] = useState("Lecture");
  const [page, setPage] = useState(1);
  const [pageCount, setPageCount] = useState(1);
  const [prefs, setPrefs] = useState<ReaderPrefs>(() => readPrefs());
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const pageRef = useRef(page);
  pageRef.current = page;

  useEffect(() => {
    writeLastBook(bookId, "pdf");
    let cancelled = false;

    async function open() {
      const record = await getBook(bookId);
      if (!record || cancelled) return;
      setTitle(record.title);
      const pdf = await openPdf(record.data);
      if (cancelled) {
        await pdf.destroy();
        return;
      }
      pdfRef.current = pdf;
      setPageCount(pdf.numPages);
      const saved = readProgress(bookId) ?? record.progress;
      const start = clampPage(saved?.page ?? 1, pdf.numPages);
      setPage(start);
      setReady(true);
    }

    void open().catch((cause: unknown) => {
      if (!cancelled) setError(cause instanceof Error ? cause.message : "Lecture impossible.");
    });

    return () => {
      cancelled = true;
      void pdfRef.current?.destroy();
      pdfRef.current = null;
    };
  }, [bookId]);

  useEffect(() => {
    const pdf = pdfRef.current;
    const canvas = canvasRef.current;
    const frame = frameRef.current;
    if (!pdf || !canvas || !frame || !ready) return;

    let cancelled = false;
    const context = canvas.getContext("2d");
    if (!context) return;

    async function paint() {
      if (!pdf || !canvas || !frame || !context) return;
      const pdfPage = await pdf.getPage(page);
      if (cancelled) return;
      const base = pdfPage.getViewport({ scale: 1 });
      const width = frame.clientWidth;
      const scale = (width / base.width) * (prefs.fontScale / 100);
      const viewport = pdfPage.getViewport({ scale });
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      canvas.style.width = `${Math.floor(viewport.width)}px`;
      canvas.style.height = `${Math.floor(viewport.height)}px`;
      await pdfPage.render({ canvas, canvasContext: context, viewport }).promise;
    }

    void paint().catch((cause: unknown) => {
      if (!cancelled) setError(cause instanceof Error ? cause.message : "Page illisible.");
    });

    const percentage = page / pdf.numPages;
    void updateProgress(bookId, {
      cfi: "",
      page,
      percentage,
      chapter: `Page ${page}`,
      updatedAt: Date.now(),
    });

    return () => {
      cancelled = true;
    };
  }, [bookId, page, prefs.fontScale, ready]);

  useEffect(() => {
    writePrefs(prefs);
  }, [prefs]);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame || !ready) return;
    return trackVerticalSwipe(
      frame,
      () => go(pageRef.current - 1),
      () => go(pageRef.current + 1),
      (direction) => {
        const fits = frame.scrollHeight <= frame.clientHeight + 4;
        if (fits) return true;
        if (direction === "next") {
          return frame.scrollTop + frame.clientHeight >= frame.scrollHeight - 8;
        }
        return frame.scrollTop <= 8;
      },
    );
  }, [ready]);

  function go(next: number) {
    const pdf = pdfRef.current;
    if (!pdf) return;
    setPage(clampPage(next, pdf.numPages));
  }

  const percentage = page / pageCount;

  return (
    <main className={`screen reader pdf-reader theme-${prefs.theme}`}>
      <header className="reader-bar">
        <button className="icon-button" onClick={onBack} aria-label="Bibliothèque">
          ←
        </button>
        <div className="reader-title">
          <strong>{title}</strong>
          <small>
            Page {page} / {pageCount}
          </small>
        </div>
      </header>

      <div
        className="stage pdf-stage"
        ref={frameRef}
        onClick={(event) => {
          const bounds = event.currentTarget.getBoundingClientRect();
          const x = event.clientX - bounds.left;
          if (x < bounds.width * 0.28) go(pageRef.current - 1);
          else if (x > bounds.width * 0.72) go(pageRef.current + 1);
        }}
      >
        <canvas ref={canvasRef} />
      </div>

      {!ready && !error ? <p className="reader-status">Ouverture du PDF…</p> : null}
      {error ? <p className="banner">{error}</p> : null}

      <footer className="reader-footer">
        <div className="pager">
          <button onClick={() => go(page - 1)}>Préc.</button>
          <span>{Math.round(percentage * 100)}%</span>
          <button onClick={() => go(page + 1)}>Suiv.</button>
        </div>
        <div className="tools">
          <button
            onClick={() =>
              setPrefs((current) => ({
                ...current,
                fontScale: Math.max(80, current.fontScale - 10),
              }))
            }
          >
            −
          </button>
          <button
            onClick={() =>
              setPrefs((current) => ({
                ...current,
                fontScale: Math.min(180, current.fontScale + 10),
              }))
            }
          >
            +
          </button>
        </div>
      </footer>
    </main>
  );
}

function clampPage(page: number, total: number): number {
  return Math.min(total, Math.max(1, page));
}
