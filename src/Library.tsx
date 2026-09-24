import { useEffect, useMemo, useState } from "react";
import { deleteBook, listBooks, markBookRead, markBookUnread } from "./db";
import { isInstalled, isIos, promptInstall, subscribeInstall } from "./install";
import { bookSize, formatSize, groupSeries, volumeLabel, type SeriesGroup } from "./series";
import type { BookSummary } from "./types";

type LibraryProps = {
  seriesKey: string | null;
  onOpenSeries: (key: string) => void;
  onBack: () => void;
  onOpen: (book: BookSummary) => void;
};

export function Library({ seriesKey, onOpenSeries, onBack, onOpen }: LibraryProps) {
  const [books, setBooks] = useState<BookSummary[]>([]);
  const [covers, setCovers] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(true);
  const [importing, setImporting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [installed, setInstalled] = useState(() => isInstalled());
  const [installHint, setInstallHint] = useState<string | null>(null);

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

  useEffect(() => subscribeInstall(() => setInstalled(isInstalled())), []);

  async function onInstall() {
    const outcome = await promptInstall();
    if (outcome === "accepted") {
      setInstalled(true);
      setInstallHint(null);
      return;
    }
    if (outcome === "dismissed") return;
    setInstallHint(
      isIos()
        ? "Dans Safari : Partager, puis « Sur l’écran d’accueil »."
        : "Ouvre le menu du navigateur, puis « Installer l’application ».",
    );
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
        if (group) onOpenSeries(group.key);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Import impossible.");
      await refresh();
    } finally {
      setImporting(null);
    }
  }

  async function onReadUpTo(book: BookSummary, volumes: BookSummary[]) {
    const index = volumes.findIndex((item) => item.id === book.id);
    const targets = index < 0 ? [book] : volumes.slice(0, index + 1);
    for (const item of targets) {
      if (!item.progress?.finished) await markBookRead(item.id);
    }
    await refresh();
  }

  async function onRead(book: BookSummary, read: boolean) {
    if (read) await markBookRead(book.id);
    else await markBookUnread(book.id);
    await refresh();
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
    onBack();
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
            <button className="icon-button" onClick={onBack} aria-label="Bibliothèque">
              ←
            </button>
          ) : null}
          {installed ? null : (
            <button className="button" type="button" onClick={() => void onInstall()}>
              Installer
            </button>
          )}
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

      {installHint ? <p className="banner">{installHint}</p> : null}
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
          onReadUpTo={(book) => void onReadUpTo(book, opened?.volumes ?? [])}
          onRead={(book, read) => void onRead(book, read)}
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
                <button className="book-open" onClick={() => onOpenSeries(group.key)}>
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

function DotsIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="6" cy="12" r="1.6" />
      <circle cx="12" cy="12" r="1.6" />
      <circle cx="18" cy="12" r="1.6" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 12.5 9.2 17 19 7" />
    </svg>
  );
}

function UpToIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 7h12M6 12h8M6 17h4" />
      <path d="m15 15 3 2-3 2" />
    </svg>
  );
}

function CircleIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="7" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 8h14M9 8V6h6v2M8 8l1 11h6l1-11" />
    </svg>
  );
}

function VolumeList({
  group,
  covers,
  onOpen,
  onRead,
  onReadUpTo,
  onDelete,
  onDeleteSeries,
}: {
  group: SeriesGroup;
  covers: Record<string, string>;
  onOpen: (book: BookSummary) => void;
  onReadUpTo: (book: BookSummary) => void;
  onRead: (book: BookSummary, read: boolean) => void;
  onDelete: (book: BookSummary) => void;
  onDeleteSeries: () => void;
}) {
  const [menu, setMenu] = useState<{ id: string; top: number; left: number; up: boolean } | null>(null);
  const opened = group.volumes.find((book) => book.id === menu?.id) ?? null;

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener("resize", close);
    return () => window.removeEventListener("resize", close);
  }, [menu]);

  return (
    <>
      <ul className="book-list volume-list">
        {group.volumes.map((book) => {
          const read = book.progress?.finished === true;
          const percent = read ? 100 : Math.round((book.progress?.percentage ?? 0) * 100);
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
                    {read ? " · Lu" : book.progress ? ` · ${percent}%` : " · Pas commencé"}
                  </small>
                  <span className="progress">
                    <span style={{ width: `${percent}%` }} />
                  </span>
                </span>
              </button>
              <button
                className="icon-button"
                aria-label="Options du chapitre"
                aria-expanded={menu?.id === book.id}
                onClick={(event) => {
                  const rect = event.currentTarget.getBoundingClientRect();
                  const openUp = rect.bottom + 168 > window.innerHeight;
                  setMenu((current) =>
                    current?.id === book.id
                      ? null
                      : { id: book.id, top: openUp ? rect.top - 6 : rect.bottom + 6, left: rect.right, up: openUp },
                  );
                }}
              >
                <DotsIcon />
              </button>
            </li>
          );
        })}
      </ul>
      {menu && opened ? (
        <>
          <button className="menu-backdrop" aria-label="Fermer le menu" onClick={() => setMenu(null)} />
          <div className={`volume-menu${menu.up ? " up" : ""}`} style={{ top: menu.top, left: menu.left }} role="menu">
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                onRead(opened, !opened.progress?.finished);
                setMenu(null);
              }}
            >
              {opened.progress?.finished ? <CircleIcon /> : <CheckIcon />}
              {opened.progress?.finished ? "Non lu" : "Déjà lu"}
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                onReadUpTo(opened);
                setMenu(null);
              }}
            >
              <UpToIcon />
              Déjà lu jusqu’ici
            </button>
            <button
              type="button"
              role="menuitem"
              className="danger"
              onClick={() => {
                setMenu(null);
                onDelete(opened);
              }}
            >
              <TrashIcon />
              Supprimer
            </button>
          </div>
        </>
      ) : null}
      <button className="text-button" onClick={onDeleteSeries}>
        Retirer ce roman
      </button>
    </>
  );
}
