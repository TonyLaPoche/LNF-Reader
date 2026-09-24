import { useEffect, useRef, useState } from "react";
import ePub, { type Book, type Rendition } from "epubjs";
import { getBook, readProgress, updateProgress } from "./db";
import { readPrefs, writeLastBook, writePrefs } from "./prefs";
import { isEnglishLanguage, readChapterParagraphs, spineHrefs } from "./chapterText";
import { trackpadSwipe, trackPinch, trackVerticalSwipe } from "./swipe";
import { MODEL_SIZE, TRANSLATION_NOTE, translateParagraphs } from "./translate";
import { readTranslation, translationId, writeTranslation } from "./translationStore";
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
  const [english, setEnglish] = useState(false);
  const [offerOpen, setOfferOpen] = useState(false);
  const [job, setJob] = useState<string | null>(null);
  const [french, setFrench] = useState<string[] | null>(null);
  const turnRef = useRef<(direction: "prev" | "next") => void>(() => {});
  const frenchModeRef = useRef(false);
  const hrefRef = useRef("");
  const spineRef = useRef<string[]>([]);
  const stopJobRef = useRef(false);
  const translationRef = useRef<HTMLElement>(null);

  useEffect(() => {
    writeLastBook(bookId, "epub");
    const stage = stageRef.current;
    if (!stage) return;

    let cancelled = false;
    let saveTimer = 0;
    const imageZoom = { value: 1 };

    async function open() {
      const record = await getBook(bookId);
      if (!record || cancelled || !stage) return;

      setTitle(record.title);
      const book = ePub(record.data.slice(0));
      bookRef.current = book;
      await book.ready;
      if (cancelled) return;

      const navigation = await book.loaded.navigation;
      const metadata = await book.loaded.metadata;
      const items = flattenToc(navigation.toc);
      spineRef.current = spineHrefs(book);
      setToc(items);
      setEnglish(isEnglishLanguage(metadata.language));

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
        hrefRef.current = href.split("#")[0];
        if (stage && !viewIsImage(rendition)) {
          imageZoom.value = 1;
          stage.style.zoom = "";
          stage.parentElement?.style.setProperty("overflow", "hidden");
        }
        if (frenchModeRef.current) {
          void readTranslation(bookId, href).then((saved) => {
            setFrench(saved?.paragraphs ?? null);
          });
        }
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
      const box = stage.getBoundingClientRect();
      rendition.resize(Math.max(1, Math.floor(box.width)), Math.max(1, Math.floor(box.height)));
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
    const turnPrev = () => turnRef.current("prev");
    const turnNext = () => turnRef.current("next");
    const stopSwipe = gesture ? trackVerticalSwipe(gesture, turnPrev, turnNext) : undefined;
    const stopTrackpad = gesture ? trackpadSwipe(gesture, turnPrev, turnNext) : undefined;
    const stopPinch = gesture
      ? trackPinch(
          gesture,
          (ratio, done) => {
            const stageNode = stageRef.current;
            if (!stageNode) return;
            const nextZoom = Math.min(4, Math.max(1, imageZoom.value * ratio));
            stageNode.style.zoom = String(done ? nextZoom : imageZoom.value * ratio);
            if (stageNode.parentElement) {
              stageNode.parentElement.style.overflow = nextZoom > 1.02 ? "auto" : "hidden";
            }
            if (done) imageZoom.value = nextZoom;
          },
          () => viewIsImage(renditionRef.current),
        )
      : undefined;

    return () => {
      stopJobRef.current = true;
      stopSwipe?.();
      stopTrackpad?.();
      stopPinch?.();
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
    if (frenchModeRef.current) {
      const hrefs = spineRef.current;
      const current = hrefRef.current;
      const index = hrefs.findIndex((href) => current.endsWith(href) || href.endsWith(current));
      const nextHref = hrefs[index + (direction === "next" ? 1 : -1)];
      if (nextHref) void rendition.display(nextHref);
      return;
    }
    void (direction === "next" ? rendition.next() : rendition.prev());
  }
  turnRef.current = turn;

  useEffect(() => {
    const node = translationRef.current;
    if (!node || !french) return;
    const stopSwipe = trackVerticalSwipe(node, () => turnRef.current("prev"), () => turnRef.current("next"), () => false);
    const stopTrackpad = trackpadSwipe(node, () => turnRef.current("prev"), () => turnRef.current("next"));
    return () => {
      stopSwipe();
      stopTrackpad();
    };
  }, [french]);

  async function translateHref(href: string) {
    const book = bookRef.current;
    if (!book) return;
    const paragraphs = await readChapterParagraphs(book, href);
    if (paragraphs.length === 0 || stopJobRef.current) return;
    const translated = await translateParagraphs(paragraphs, setJob, () => stopJobRef.current);
    if (stopJobRef.current || translated.length === 0) return;
    await writeTranslation({
      id: translationId(bookId, href),
      bookId,
      href: href.split("#")[0],
      paragraphs: translated,
      updatedAt: Date.now(),
    });
    if (hrefRef.current.endsWith(href) || href.endsWith(hrefRef.current)) {
      frenchModeRef.current = true;
      setFrench(translated);
    }
  }

  async function translateCurrent() {
    const href = hrefRef.current || spineRef.current[0];
    if (!href) return;
    stopJobRef.current = false;
    setOfferOpen(false);
    setJob("Préparation…");
    try {
      await translateHref(href);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Traduction impossible.");
    } finally {
      setJob(null);
    }
  }

  async function translateBook() {
    const hrefs = spineRef.current;
    stopJobRef.current = false;
    setOfferOpen(false);
    try {
      for (const [index, href] of hrefs.entries()) {
        if (stopJobRef.current) break;
        const existing = await readTranslation(bookId, href);
        if (existing) continue;
        setJob(`Chapitre ${index + 1} / ${hrefs.length}`);
        await translateHref(href);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Traduction impossible.");
    } finally {
      setJob(null);
    }
  }

  function showFrench() {
    const href = hrefRef.current;
    if (!href) return;
    void readTranslation(bookId, href).then((saved) => {
      if (!saved) {
        setOfferOpen(true);
        return;
      }
      frenchModeRef.current = true;
      setFrench(saved.paragraphs);
      setOfferOpen(false);
    });
  }

  function showOriginal() {
    frenchModeRef.current = false;
    setFrench(null);
    setOfferOpen(false);
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
        {english ? (
          <button className="icon-button" onClick={() => setOfferOpen(true)} aria-label="Traduire en français">
            FR
          </button>
        ) : null}
        <button className="icon-button" onClick={() => setTocOpen(true)} aria-label="Chapitres">
          ≡
        </button>
      </header>

      <div className="stage-wrap">
        <div className="stage" ref={stageRef} />
        {french ? (
          <article className="translation" ref={translationRef}>
            <p className="translation-note">{TRANSLATION_NOTE}</p>
            {french.map((paragraph, index) => (
              <p key={index}>{paragraph}</p>
            ))}
          </article>
        ) : null}
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
      {job ? <p className="banner">{job}</p> : null}
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

      {offerOpen ? (
        <div className="sheet" onClick={() => setOfferOpen(false)}>
          <aside className="offer" onClick={(event) => event.stopPropagation()}>
            <header>
              <h2>Traduire</h2>
              <button className="icon-button" onClick={() => setOfferOpen(false)} aria-label="Fermer">
                ×
              </button>
            </header>
            <p>{TRANSLATION_NOTE}</p>
            <p className="muted">Le modèle anglais → français pèse {MODEL_SIZE}. Il n’est téléchargé que si tu lances une traduction, puis il reste sur cet appareil.</p>
            <div className="offer-actions">
              <button type="button" className="button primary" onClick={() => void translateCurrent()}>
                Ce chapitre
              </button>
              <button type="button" className="button" onClick={() => void translateBook()}>
                Tout le livre
              </button>
              <button type="button" className="button" onClick={showFrench}>
                Lire le français déjà traduit
              </button>
              {french ? (
                <button type="button" className="button" onClick={showOriginal}>
                  Revenir à l’original
                </button>
              ) : null}
            </div>
          </aside>
        </div>
      ) : null}

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

function viewIsImage(rendition: Rendition | null): boolean {
  const contents = (rendition as { getContents?: () => Array<{ document?: Document }> } | null)?.getContents?.() ?? [];
  return contents.some((content) => {
    const body = content.document?.body;
    if (!body) return false;
    const text = body.innerText?.replace(/\s+/g, "") ?? "";
    const images = [...body.querySelectorAll("img, svg")];
    const large = images.some((image) => image.getBoundingClientRect().height > 180);
    return large && text.length < 240;
  });
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
