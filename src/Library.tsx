import { useEffect, useMemo, useState } from "react";
import { deleteBook, listBooks } from "./db";
import { bookSize, formatSize, groupSeries, volumeLabel, type SeriesGroup } from "./series";
import type { BookSummary } from "./types";

type LibraryProps = {
  onOpen: (book: BookSummary) => void;
};

export function Library({ onOpen }: LibraryProps) {
  const [books, setBooks] = useState<BookSummary[]>([]);
  const [covers, setCovers] = useState<Record<string, string>>({});
  const [seriesKey, setSeriesKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [importing, setImporting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const series = useMemo(() => groupSeries(books), [books]);
  const opened = series.find((group) => group.key === seriesKey) ?? null;

  async function refresh() {
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
    const files = [...fileList];
    const { importBook } = await import("./importBook");
    let lastId = "";
    try {
      for (const [index, file] of files.entries()) {
        setImporting(`${index + 1} / ${files.length} · ${file.name}`);
        lastId = await importBook(file);
      }
      await refresh();
      const imported = (await listBooks()).find((book) => book.id === lastId);
      if (imported) {
        const group = groupSeries([imported])[0];
        setSeriesKey(group?.key ?? null);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Import impossible.");
      await refresh();
    } finally {
      setImporting(null);
    }
  }

  async function onDelete(book: BookSummary) {
    const confirmed = window.confirm(`Retirer « ${volumeLabel(book)} » ?`);
    if (!confirmed) return;
    await deleteBook(book.id);
    await refresh();
  }

  async function onDeleteSeries(group: SeriesGroup) {
    const confirmed = window.confirm(`Retirer les ${group.volumes.length} volumes de « ${group.title} » ?`);
    if (!confirmed) return;
    for (const book of group.volumes) await deleteBook(book.id);
    setSeriesKey(null);
    await refresh();
  }

  return (
    <main className="screen library">
      <header className="topbar">
        <div>
          <p className="eyebrow">Light novels</p>
          <h1>{opened ? opened.title : "Bibliothèque"}</h1>
          {opened?.subtitle ? <p className="muted series-sub">{opened.subtitle}</p> : null}
        </div>
        <div className="top-actions">
          {opened ? (
            <button className="icon-button" onClick={() => setSeriesKey(null)} aria-label="Bibliothèque">
              ←
            </button>
          ) : null}
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
        </div>
      </header>

      {importing ? <p className="banner">Import {importing}</p> : null}
      {error ? <p className="banner">{error}</p> : null}
      {busy ? <p className="muted">Chargement…</p> : null}

      {!busy && books.length === 0 ? (
        <section className="empty">
          <p className="empty-mark">LN</p>
          <h2>Aucun roman pour l’instant</h2>
          <p>
            Sélectionne plusieurs volumes d’un coup. Ils sont regroupés par roman, dans l’ordre
            des tomes.
          </p>
        </section>
      ) : null}

      {opened ? (
        <VolumeList
          group={opened}
          covers={covers}
          onOpen={onOpen}
          onDelete={(book) => void onDelete(book)}
          onDeleteSeries={() => void onDeleteSeries(opened)}
        />
      ) : (
        <ul className="book-list">
          {series.map((group) => {
            const coverBook = group.volumes.find((book) => covers[book.id]) ?? group.volumes[0];
            const started = group.volumes.filter((book) => book.progress).length;
            const current = [...group.volumes].reverse().find((book) => book.progress);
            return (
              <li key={group.key} className="book-card">
                <button className="book-open" onClick={() => setSeriesKey(group.key)}>
                  <span className="cover">
                    {coverBook && covers[coverBook.id] ? (
                      <img src={covers[coverBook.id]} alt="" />
                    ) : (
                      <span>{group.title.slice(0, 1)}</span>
                    )}
                  </span>
                  <span className="book-copy">
                    <strong>{group.title}</strong>
                    {group.subtitle ? <em>{group.subtitle}</em> : null}
                    <small>
                      {group.volumes.length} volume{group.volumes.length > 1 ? "s" : ""}
                      {current ? ` · ${volumeLabel(current)} en cours` : ""}
                      {started ? ` · ${started} commencé${started > 1 ? "s" : ""}` : ""}
                    </small>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}

function VolumeList({
  group,
  covers,
  onOpen,
  onDelete,
  onDeleteSeries,
}: {
  group: SeriesGroup;
  covers: Record<string, string>;
  onOpen: (book: BookSummary) => void;
  onDelete: (book: BookSummary) => void;
  onDeleteSeries: () => void;
}) {
  return (
    <>
      <ul className="book-list volume-list">
        {group.volumes.map((book) => {
          const percent = Math.round((book.progress?.percentage ?? 0) * 100);
          const size = formatSize(bookSize(book));
          return (
            <li key={book.id} className="book-card volume-card">
              <button className="book-open" onClick={() => onOpen(book)}>
                {covers[book.id] ? (
                  <span className="cover cover-sm">
                    <img src={covers[book.id]} alt="" />
                  </span>
                ) : (
                  <span className="file-mark">{book.format.toUpperCase()}</span>
                )}
                <span className="book-copy">
                  <strong>{volumeLabel(book)}</strong>
                  <em>{book.fileName}</em>
                  <small>
                    {size}
                    {book.progress ? ` · ${percent}%` : " · Pas commencé"}
                  </small>
                  <span className="progress">
                    <span style={{ width: `${percent}%` }} />
                  </span>
                </span>
              </button>
              <button className="icon-button" onClick={() => onDelete(book)} aria-label="Retirer le volume">
                ×
              </button>
            </li>
          );
        })}
      </ul>
      <button className="text-button" onClick={onDeleteSeries}>
        Retirer ce roman
      </button>
    </>
  );
}
