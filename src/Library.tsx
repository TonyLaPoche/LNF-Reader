import { useEffect, useState } from "react";
import { deleteBook, listBooks } from "./db";
import type { BookSummary } from "./types";

type LibraryProps = {
  onOpen: (book: BookSummary) => void;
};

export function Library({ onOpen }: LibraryProps) {
  const [books, setBooks] = useState<BookSummary[]>([]);
  const [covers, setCovers] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setBusy(true);
    const next = await listBooks();
    setBooks(next);
    setCovers((current) => {
      for (const url of Object.values(current)) URL.revokeObjectURL(url);
      const urls: Record<string, string> = {};
      for (const book of next) {
        if (book.cover) urls[book.id] = URL.createObjectURL(book.cover);
      }
      return urls;
    });
    setBusy(false);
  }

  useEffect(() => {
    void refresh();
    return () => {
      setCovers((current) => {
        for (const url of Object.values(current)) URL.revokeObjectURL(url);
        return {};
      });
    };
  }, []);

  async function onImport(fileList: FileList | null) {
    if (!fileList?.length) return;
    setError(null);
    const { importBook } = await import("./importBook");
    try {
      let lastId = "";
      for (const file of fileList) {
        lastId = await importBook(file);
      }
      await refresh();
      if (fileList.length === 1) {
        const opened = (await listBooks()).find((book) => book.id === lastId);
        if (opened) onOpen(opened);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Import impossible.");
    }
  }

  async function onDelete(book: BookSummary) {
    const confirmed = window.confirm(`Retirer « ${book.title} » de la bibliothèque ?`);
    if (!confirmed) return;
    await deleteBook(book.id);
    await refresh();
  }

  return (
    <main className="screen library">
      <header className="topbar">
        <div>
          <p className="eyebrow">Light novels</p>
          <h1>Bibliothèque</h1>
        </div>
        <label className="button primary">
          Importer
          <input
            type="file"
            accept=".epub,.pdf,application/epub+zip,application/pdf"
            multiple
            hidden
            onChange={(event) => {
              void onImport(event.target.files);
              event.target.value = "";
            }}
          />
        </label>
      </header>

      {error ? <p className="banner">{error}</p> : null}

      {busy ? <p className="muted">Chargement…</p> : null}

      {!busy && books.length === 0 ? (
        <section className="empty">
          <p className="empty-mark">LN</p>
          <h2>Aucun roman pour l’instant</h2>
          <p>
            Importe un fichier .epub ou .pdf depuis tes téléchargements. La lecture reprend là
            où tu t’arrêtes, même hors ligne.
          </p>
        </section>
      ) : null}

      <ul className="book-list">
        {books.map((book) => {
          const percent = Math.round((book.progress?.percentage ?? 0) * 100);
          return (
            <li key={book.id} className="book-card">
              <button className="book-open" onClick={() => onOpen(book)}>
                <span className="cover">
                  {covers[book.id] ? (
                    <img src={covers[book.id]} alt="" />
                  ) : (
                    <span>{book.title.slice(0, 1)}</span>
                  )}
                </span>
                <span className="book-copy">
                  <strong>{book.title}</strong>
                  <span className="format">{book.format.toUpperCase()}</span>
                  <em>{book.author}</em>
                  <span className="progress">
                    <span style={{ width: `${percent}%` }} />
                  </span>
                  <small>
                    {book.progress
                      ? `${percent}% · ${book.progress.chapter || "En cours"}`
                      : "Pas encore commencé"}
                  </small>
                </span>
              </button>
              <button className="icon-button" onClick={() => void onDelete(book)} aria-label="Retirer">
                ×
              </button>
            </li>
          );
        })}
      </ul>
    </main>
  );
}
