import { useEffect, useRef, useState } from "react";
import ePub, { type Book, type Rendition } from "epubjs";
import { getBook, readProgress, updateProgress } from "./db";
import { readPrefs, writeLastBook, writePrefs } from "./prefs";
import { trackVerticalSwipe } from "./swipe";
import type { ReaderPrefs } from "./types";

type TocItem = { label: string; href: string };

type ReaderProps = {
  bookId: string;
  onBack: () => void;
};

const READING = {
  "line-height": "1.7",
  "font-family": "Georgia, Iowan Old Style, Palatino, serif",
  padding: "0.2em 7% 1.4em",
};

const THEMES: Record<ReaderPrefs["theme"], { body: Record<string, string> }> = {
  papier: { body: { ...READING, background: "#f7f1e6", color: "#231c16" } },
  sepia: { body: { ...READING, background: "#f3e6d0", color: "#3a2a1a" } },
  nuit: { body: { ...READING, background: "#1b1916", color: "#ece6dc" } },
};

export function Reader({ bookId, onBack }: ReaderProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const gestureRef = useRef<HTMLDivElement>(null);
  const renditionRef = useRef<Rendition | null>(null);
  const bookRef = useRef<Book | null>(null);
  const [title, setTitle] = useState("Lecture");
  const [chapter, setChapter] = useState("");
  const [percentage, setPercentage] = useState(0);
  const [toc, setToc] = useState<TocItem[]>([]);
  const [tocOpen, setTocOpen] = useState(false);
  const [prefs, setPrefs] = useState<ReaderPrefs>(() => readPrefs());
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    writeLastBook(bookId, "epub");
    const stage = stageRef.current;
    if (!stage) return;

    let cancelled = false;
    let saveTimer = 0;

    async function open() {
      const record = await getBook(bookId);
      if (!record || cancelled || !stage) return;

      setTitle(record.title);
      const book = ePub(record.data.slice(0));
      bookRef.current = book;
      await book.ready;
      if (cancelled) return;

      const navigation = await book.loaded.navigation;
      const items = flattenToc(navigation.toc);
      setToc(items);

      const rect = stage.getBoundingClientRect();
      const rendition = book.renderTo(stage, {
        width: Math.floor(rect.width),
        height: Math.floor(rect.height),
        flow: "paginated",
        spread: "none",
        manager: "default",
      });
      renditionRef.current = rendition;
      applyLook(rendition, readPrefs());
      rendition.hooks.content.register((contents: { document: Document }) => {
        const style = contents.document.createElement("style");
        style.textContent =
          "html,body{overflow:hidden!important;height:100%!important;touch-action:none!important;overscroll-behavior:none!important;}";
        contents.document.head.appendChild(style);
      });

      const saved = readProgress(bookId) ?? record.progress;
      rendition.on("relocated", (location: Relocated) => {
        const start = location.start;
        const href = start?.href ?? "";
        const label = chapterLabel(items, href);
        const cfi = start?.cfi;
        if (!cfi) return;
        const nextPercentage = start.percentage || 0;
        setChapter(label);
        setPercentage(nextPercentage);
        window.clearTimeout(saveTimer);
        saveTimer = window.setTimeout(() => {
          void updateProgress(bookId, {
            cfi,
            page: 0,
            percentage: nextPercentage,
            chapter: label,
            updatedAt: Date.now(),
          });
        }, 250);
      });

      await rendition.display(saved?.cfi);
      if (!cancelled) setReady(true);

      void book.locations.generate(1600).then(() => {
        const current = rendition.currentLocation() as Relocated | undefined;
        const cfi = current?.start?.cfi;
        if (!cfi) return;
        const nextPercentage = book.locations.percentageFromCfi(cfi);
        setPercentage(nextPercentage);
      });
    }

    void open().catch((cause: unknown) => {
      if (!cancelled) {
        setError(cause instanceof Error ? cause.message : "Lecture impossible.");
      }
    });

    const onResize = () => {
      const rendition = renditionRef.current;
      const node = stageRef.current;
      if (!rendition || !node) return;
      const rect = node.getBoundingClientRect();
      rendition.resize(Math.floor(rect.width), Math.floor(rect.height));
    };
    window.addEventListener("resize", onResize);
    const gesture = gestureRef.current;
    const stopSwipe = gesture
      ? trackVerticalSwipe(
          gesture,
          () => void renditionRef.current?.prev(),
          () => void renditionRef.current?.next(),
        )
      : undefined;

    return () => {
      stopSwipe?.();
      cancelled = true;
      window.clearTimeout(saveTimer);
      window.removeEventListener("resize", onResize);
      renditionRef.current?.destroy();
      bookRef.current?.destroy();
      renditionRef.current = null;
      bookRef.current = null;
    };
  }, [bookId]);

  useEffect(() => {
    const rendition = renditionRef.current;
    if (rendition) applyLook(rendition, prefs);
    writePrefs(prefs);
  }, [prefs]);

  function turn(direction: "prev" | "next") {
    const rendition = renditionRef.current;
    if (!rendition) return;
    void (direction === "next" ? rendition.next() : rendition.prev());
  }

  return (
    <main className={`screen reader theme-${prefs.theme}`}>
      <header className="reader-bar">
        <button className="icon-button" onClick={onBack} aria-label="Bibliothèque">
          ←
        </button>
        <div className="reader-title">
          <strong>{title}</strong>
          <small>{chapter || "Ouverture…"}</small>
        </div>
        <button className="icon-button" onClick={() => setTocOpen(true)} aria-label="Chapitres">
          ≡
        </button>
      </header>

      <div className="stage-wrap">
        <div className="stage" ref={stageRef} />
        <div
          className="gesture-layer"
          ref={gestureRef}
          onClick={(event) => {
            const bounds = event.currentTarget.getBoundingClientRect();
            const x = event.clientX - bounds.left;
            if (x < bounds.width * 0.28) turn("prev");
            else if (x > bounds.width * 0.72) turn("next");
          }}
        />
      </div>

      {!ready && !error ? <p className="reader-status">Ouverture du roman…</p> : null}
      {error ? <p className="banner">{error}</p> : null}

      <footer className="reader-footer">
        <button type="button" onClick={() => turn("prev")} aria-label="Page précédente">
          ‹
        </button>
        <span>{Math.round(percentage * 100)}%</span>
        <button type="button" onClick={() => turn("next")} aria-label="Page suivante">
          ›
        </button>
        <button
          type="button"
          onClick={() =>
            setPrefs((current) => ({
              ...current,
              fontScale: Math.max(80, current.fontScale - 10),
            }))
          }
          aria-label="Réduire le texte"
        >
          A−
        </button>
        <button
          type="button"
          onClick={() =>
            setPrefs((current) => ({
              ...current,
              fontScale: Math.min(160, current.fontScale + 10),
            }))
          }
          aria-label="Agrandir le texte"
        >
          A+
        </button>
        {(["papier", "sepia", "nuit"] as const).map((theme) => (
          <button
            key={theme}
            type="button"
            className={prefs.theme === theme ? "active" : ""}
            onClick={() => setPrefs((current) => ({ ...current, theme }))}
          >
            {theme}
          </button>
        ))}
      </footer>

      {tocOpen ? (
        <div className="sheet" onClick={() => setTocOpen(false)}>
          <aside onClick={(event) => event.stopPropagation()}>
            <header>
              <h2>Chapitres</h2>
              <button className="icon-button" onClick={() => setTocOpen(false)} aria-label="Fermer">
                ×
              </button>
            </header>
            <ul>
              {toc.map((item) => (
                <li key={item.href}>
                  <button
                    onClick={() => {
                      void renditionRef.current?.display(item.href);
                      setTocOpen(false);
                    }}
                  >
                    {item.label}
                  </button>
                </li>
              ))}
            </ul>
          </aside>
        </div>
      ) : null}
    </main>
  );
}

type NavItem = { label: string; href: string; subitems?: NavItem[] };
type Relocated = {
  start?: { cfi?: string; href?: string; percentage?: number };
};

function flattenToc(items: NavItem[] | undefined, acc: TocItem[] = []): TocItem[] {
  for (const item of items ?? []) {
    const label = item.label?.replace(/\s+/g, " ").trim();
    if (label && item.href) acc.push({ label, href: item.href });
    if (item.subitems?.length) flattenToc(item.subitems, acc);
  }
  return acc;
}

function chapterLabel(items: TocItem[], href: string): string {
  const clean = href.split("#")[0];
  const match = [...items].reverse().find((item) => clean.endsWith(item.href.split("#")[0]));
  return match?.label ?? "";
}

function applyLook(rendition: Rendition, prefs: ReaderPrefs) {
  for (const [name, rules] of Object.entries(THEMES)) {
    rendition.themes.register(name, rules);
  }
  rendition.themes.select(prefs.theme);
  rendition.themes.fontSize(`${prefs.fontScale}%`);
  rendition.themes.override("line-height", "1.7");
}
