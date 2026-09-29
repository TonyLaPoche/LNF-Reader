import { useEffect, useRef, useState } from "react";
import ePub, { EpubCFI, type Book, type Rendition } from "epubjs";
import { trackReaderFailed, trackReaderOpened, trackReadingSession, trackTranslationStarted, trackTtsStarted } from "./analytics";
import { getBook, readProgress, updateProgress } from "./db";
import { isMobileOs } from "./install";
import { PIPER_NOTE, PIPER_VOICES, downloadPiperVoice, downloadedPiperVoices, type PiperVoiceId } from "./piper";
import { readPrefs, writeLastBook, writePrefs } from "./prefs";
import {
  KOKORO_MODEL_SIZE,
  KOKORO_NOTE,
  OPEN_VOICES,
  downloadOpenVoice,
  downloadedVoices,
  pageSpeech,
  readFavoriteVoices,
  readTtsPrefs,
  spokenVoiceLang,
  toggleFavoriteVoice,
  voicesForLang,
  watchSystemVoices,
  writeTtsPrefs,
  type OpenVoiceId,
  type TtsPrefs,
  type VoiceLang,
} from "./tts";
import { isEnglishLanguage, readChapterParagraphs, spineHrefs } from "./chapterText";
import { applyImageView, trackpadSwipe, trackVerticalSwipe, trackZoomPan, type ImageView } from "./swipe";
import { MODEL_SIZE, TRANSLATION_NOTE, translateParagraphs } from "./translate";
import { readTranslation, translationId, writeTranslation } from "./translationStore";
import type { ReaderPrefs } from "./types";
import orbitron700 from "./assets/fonts/orbitron-700.woff2?url";
import rajdhani500 from "./assets/fonts/rajdhani-500.woff2?url";

type TocItem = { label: string; href: string };

type ReaderProps = {
  bookId: string;
  onBack: () => void;
};

const THEME_OPTIONS: Array<{ id: ReaderPrefs["theme"]; label: string }> = [
  { id: "papier", label: "papier" },
  { id: "sepia", label: "sepia" },
  { id: "nuit", label: "nuit" },
  { id: "cyber", label: "Cyber" },
];

const LOOKS: Record<
  ReaderPrefs["theme"],
  { background: string; color: string; heading: string; link: string; font: string; headingFont: string }
> = {
  papier: {
    background: "#f7f1e6",
    color: "#231c16",
    heading: "#231c16",
    link: "#8a4b2a",
    font: "Georgia, Iowan Old Style, Palatino, serif",
    headingFont: "Georgia, Iowan Old Style, Palatino, serif",
  },
  sepia: {
    background: "#f3e6d0",
    color: "#3a2a1a",
    heading: "#3a2a1a",
    link: "#8a4b2a",
    font: "Georgia, Iowan Old Style, Palatino, serif",
    headingFont: "Georgia, Iowan Old Style, Palatino, serif",
  },
  nuit: {
    background: "#1b1916",
    color: "#ece6dc",
    heading: "#ece6dc",
    link: "#e8a87c",
    font: "Georgia, Iowan Old Style, Palatino, serif",
    headingFont: "Georgia, Iowan Old Style, Palatino, serif",
  },
  cyber: {
    background: "#07060f",
    color: "#c8fff6",
    heading: "#fcee0a",
    link: "#22e7ff",
    font: '"LNF Rajdhani", "Segoe UI", sans-serif',
    headingFont: '"LNF Orbitron", "LNF Rajdhani", sans-serif',
  },
};

export function Reader({ bookId, onBack }: ReaderProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const gestureRef = useRef<HTMLDivElement>(null);
  const renditionRef = useRef<Rendition | null>(null);
  const themeRef = useRef<ReaderPrefs["theme"]>(readPrefs().theme);
  const bookRef = useRef<Book | null>(null);
  const [title, setTitle] = useState("Lecture");
  const [chapter, setChapter] = useState("");
  const [percentage, setPercentage] = useState(0);
  const [toc, setToc] = useState<TocItem[]>([]);
  const [tocOpen, setTocOpen] = useState(false);
  const [prefs, setPrefs] = useState<ReaderPrefs>(() => readPrefs());
  themeRef.current = prefs.theme;

  function savePrefs(next: ReaderPrefs) {
    writePrefs(next);
    setPrefs(next);
  }
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
  const keepGoingRef = useRef(false);
  const armSpeakRef = useRef(false);
  const speakRef = useRef<() => void>(() => {});
  const cfiRef = useRef("");
  const bookLangRef = useRef("fr");
  const sessionRef = useRef(beginSession());
  const [bookLang, setBookLang] = useState("fr");
  const [favorites, setFavorites] = useState(readFavoriteVoices);
  const [showAllVoices, setShowAllVoices] = useState(false);
  const [tts, setTts] = useState<TtsPrefs>(() => readTtsPrefs());
  const [speechPhase, setSpeechPhase] = useState(pageSpeech.phase);
  const [systemVoices, setSystemVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [ttsHint, setTtsHint] = useState<string | null>(null);
  const [savedVoices, setSavedVoices] = useState<OpenVoiceId[]>(() => downloadedVoices());
  const [piperSaved, setPiperSaved] = useState<PiperVoiceId[]>(() => downloadedPiperVoices());
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const mobileOs = isMobileOs();

  useEffect(() => {
    writeLastBook(bookId, "epub");
    const stage = stageRef.current;
    if (!stage) return;

    let cancelled = false;
    let saveTimer = 0;
    sessionRef.current = beginSession();
    trackReaderOpened("epub");
    const imageZoom = { value: { scale: 1, x: 0, y: 0 } satisfies ImageView };

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
      const language = (metadata.language ?? "fr").toLowerCase();
      bookLangRef.current = language;
      setBookLang(language);
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
      rendition.hooks.content.register((contents: { document?: Document }) => {
        paintLook(contents.document, themeRef.current);
      });
      applyLook(rendition, readPrefs());

      const saved = readProgress(bookId) ?? record.progress;
      rendition.on("relocated", (location: Relocated) => {
        const start = location.start;
        const href = start?.href ?? "";
        const label = chapterLabel(items, href);
        const cfi = start?.cfi;
        if (!cfi) return;
        if (sessionRef.current.seenLocation) sessionRef.current.pages += 1;
        else sessionRef.current.seenLocation = true;
        cfiRef.current = cfi;
        const nextPercentage = start.percentage || 0;
        setChapter(label);
        setPercentage(nextPercentage);
        hrefRef.current = href.split("#")[0];
        if (stage && !viewIsImage(rendition)) {
          imageZoom.value = { scale: 1, x: 0, y: 0 };
          applyImageView(stage, imageZoom.value);
        }
        if (frenchModeRef.current) {
          void readTranslation(bookId, href).then((saved) => {
            setFrench(saved?.paragraphs ?? null);
          });
        }
        if (armSpeakRef.current) {
          armSpeakRef.current = false;
          speakRef.current();
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
        trackReaderFailed("epub");
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
    const stopSwipe = gesture
      ? trackVerticalSwipe(gesture, turnPrev, turnNext, () => true, () => imageZoom.value.scale <= 1.02)
      : undefined;
    const stopTrackpad = gesture ? trackpadSwipe(gesture, turnPrev, turnNext) : undefined;
    const stopZoom = gesture
      ? trackZoomPan(
          gesture,
          () => imageZoom.value,
          (view) => {
            imageZoom.value = view;
            const stageNode = stageRef.current;
            if (stageNode) applyImageView(stageNode, view);
          },
          () => {
            const stageNode = stageRef.current;
            const wrap = stageNode?.parentElement;
            return {
              width: stageNode?.clientWidth ?? 1,
              height: stageNode?.clientHeight ?? 1,
              viewWidth: wrap?.clientWidth ?? 1,
              viewHeight: wrap?.clientHeight ?? 1,
            };
          },
          () => viewIsImage(renditionRef.current) || imageZoom.value.scale > 1.02,
        )
      : undefined;

    return () => {
      const session = sessionRef.current;
      trackReadingSession(
        "epub",
        (Date.now() - session.started) / 1000,
        session.pages,
        session.tts,
        session.translation,
        mainTheme(session),
      );
      stopJobRef.current = true;
      keepGoingRef.current = false;
      pageSpeech.stop();
      stopSwipe?.();
      stopTrackpad?.();
      stopZoom?.();
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
    const session = sessionRef.current;
    if (session.theme !== prefs.theme) accountTheme(session, prefs.theme);
    writePrefs(prefs);
    const rendition = renditionRef.current;
    if (rendition) applyLook(rendition, prefs);
    const id = requestAnimationFrame(() => {
      const node = stageRef.current;
      if (!rendition || !node) return;
      const rect = node.getBoundingClientRect();
      rendition.resize(Math.floor(rect.width), Math.floor(rect.height));
    });
    return () => cancelAnimationFrame(id);
  }, [prefs]);

  useEffect(() => {
    const id = requestAnimationFrame(() => {
      const rendition = renditionRef.current;
      const node = stageRef.current;
      if (!rendition || !node) return;
      const rect = node.getBoundingClientRect();
      rendition.resize(Math.floor(rect.width), Math.floor(rect.height));
    });
    return () => cancelAnimationFrame(id);
  }, [settingsOpen]);

  function turn(direction: "prev" | "next") {
    const wasSpeaking = pageSpeech.phase === "playing" || pageSpeech.phase === "loading";
    const wasPaused = pageSpeech.phase === "paused";
    if (wasSpeaking || wasPaused) pageSpeech.stop();
    if (wasPaused) keepGoingRef.current = false;
    if (wasSpeaking) armSpeakRef.current = true;
    playPageTurn(stageRef.current?.parentElement ?? null, direction);
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

  useEffect(() => pageSpeech.subscribe(() => setSpeechPhase(pageSpeech.phase)), []);
  useEffect(() => watchSystemVoices(setSystemVoices), []);

  function updateTts(patch: Partial<TtsPrefs>) {
    const voiceChanged =
      patch.engine !== undefined ||
      patch.voiceURI !== undefined ||
      patch.voiceByLang !== undefined ||
      patch.piperVoice !== undefined ||
      patch.kokoroVoice !== undefined;
    setTts((current) => {
      const next = { ...current, ...patch };
      writeTtsPrefs(next);
      if (patch.volume !== undefined) pageSpeech.setVolume(patch.volume);
      if (patch.rate !== undefined) pageSpeech.setRate(patch.rate);
      if (voiceChanged) pageSpeech.useVoice(next);
      return next;
    });
  }

  function speakCurrent() {
    const text = currentPageText(renditionRef.current, frenchModeRef.current ? translationRef.current : null);
    if (!text) {
      keepGoingRef.current = false;
      pageSpeech.stop();
      setTtsHint("Cette page n’a pas de texte à lire.");
      return;
    }
    setTtsHint(null);
    const before = cfiRef.current;
    void pageSpeech.play({
      text,
      prefs: readTtsPrefs(),
      lang: spokenVoiceLang(bookLangRef.current, frenchModeRef.current),
      onStatus: setTtsHint,
      onDone: () => {
        if (!keepGoingRef.current) return;
        armSpeakRef.current = true;
        turnRef.current("next");
        window.setTimeout(() => {
          if (cfiRef.current === before) {
            keepGoingRef.current = false;
            armSpeakRef.current = false;
            pageSpeech.stop();
          }
        }, 1500);
      },
    });
  }
  speakRef.current = speakCurrent;

  function toggleSpeech() {
    if (pageSpeech.phase === "loading") {
      keepGoingRef.current = false;
      pageSpeech.stop();
      return;
    }
    if (pageSpeech.phase === "playing") {
      pageSpeech.pause();
      return;
    }
    if (pageSpeech.phase === "paused") {
      keepGoingRef.current = true;
      pageSpeech.resume();
      return;
    }
    keepGoingRef.current = true;
    sessionRef.current.tts = true;
    trackTtsStarted(readTtsPrefs().engine);
    speakCurrent();
  }

  async function fetchVoice(id: OpenVoiceId) {
    setDownloadingId(id);
    try {
      await downloadOpenVoice(id, setTtsHint);
      setSavedVoices(downloadedVoices());
      updateTts({ engine: "kokoro", kokoroVoice: id });
      setTtsHint(null);
    } catch (cause) {
      setTtsHint(cause instanceof Error ? cause.message : "Téléchargement impossible.");
    } finally {
      setDownloadingId(null);
    }
  }

  async function fetchPiper(id: PiperVoiceId) {
    setDownloadingId(id);
    try {
      await downloadPiperVoice(id, setTtsHint);
      setPiperSaved(downloadedPiperVoices());
      updateTts({ engine: "piper", piperVoice: id });
      setTtsHint(null);
    } catch (cause) {
      setTtsHint(cause instanceof Error ? cause.message : "Téléchargement impossible.");
    } finally {
      setDownloadingId(null);
    }
  }

  function chooseVoice(lang: VoiceLang, voiceURI: string) {
    updateTts({
      engine: "system",
      voiceURI,
      voiceByLang: { ...tts.voiceByLang, [lang]: voiceURI },
    });
  }

  const spoken = spokenVoiceLang(bookLang, french !== null);
  const matchingVoices = voicesForLang(systemVoices, spoken);
  const systemFavoriteIds = favorites[spoken].filter((id) => matchingVoices.some((voice) => voice.voiceURI === id));
  const piperFavoriteIds = favorites[spoken].filter((id) =>
    PIPER_VOICES.some((voice) => voice.lang === spoken && id === `piper:${voice.id}`),
  );
  const hasFavorites = systemFavoriteIds.length + piperFavoriteIds.length > 0;
  const listedVoices =
    hasFavorites && !showAllVoices
      ? matchingVoices.filter((voice) => systemFavoriteIds.includes(voice.voiceURI))
      : matchingVoices;
  const listedPiper = PIPER_VOICES.filter((voice) => voice.lang === spoken).filter(
    (voice) => !hasFavorites || showAllVoices || piperFavoriteIds.length === 0 || piperFavoriteIds.includes(`piper:${voice.id}`),
  );
  const selectedVoice = tts.voiceByLang[spoken] || tts.voiceURI;
  const spokenLabel = spoken === "fr" ? "Voix françaises" : "Voix anglaises";

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
    sessionRef.current.translation = true;
    trackTranslationStarted("chapter");
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
    sessionRef.current.translation = true;
    trackTranslationStarted("book");
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
      sessionRef.current.translation = true;
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
        <button className="icon-button" onClick={onBack} aria-label="Chapitres">
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

      {settingsOpen ? (
        <div className="reader-settings">
          <div className="setting-line">
            <span>Texte</span>
            <button
              type="button"
              onClick={() => savePrefs({ ...prefs, fontScale: Math.max(80, prefs.fontScale - 10) })}
              aria-label="Réduire le texte"
            >
              A−
            </button>
            <button
              type="button"
              onClick={() => savePrefs({ ...prefs, fontScale: Math.min(160, prefs.fontScale + 10) })}
              aria-label="Agrandir le texte"
            >
              A+
            </button>
          </div>
          <div className="setting-line">
            <span>Mode</span>
            {THEME_OPTIONS.map((theme) => (
              <button
                key={theme.id}
                type="button"
                className={prefs.theme === theme.id ? "active" : ""}
                onClick={() => savePrefs({ ...prefs, theme: theme.id })}
              >
                {theme.label}
              </button>
            ))}
          </div>
          <div className="tts-bar">
            <button
              type="button"
              onClick={toggleSpeech}
              aria-label={speechPhase === "playing" ? "Pause" : speechPhase === "paused" ? "Reprendre" : "Lire la page"}
            >
              {speechPhase === "playing" ? "❚❚" : speechPhase === "loading" ? "…" : "▶"}
            </button>
            <label className="tts-volume">
              <span>{Math.round(tts.volume * 100)} %</span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={tts.volume}
                aria-label="Volume"
                onPointerDown={(event) => event.stopPropagation()}
                onChange={(event) => updateTts({ volume: Number(event.target.value) })}
              />
            </label>
            <button type="button" onClick={() => setVoiceOpen(true)} aria-label="Options de voix">
              Voix
            </button>
          </div>
          {ttsHint ? <small className="tts-hint">{ttsHint}</small> : null}
        </div>
      ) : null}

      <footer className="reader-footer">
        <div className="footer-cluster">
          <button type="button" onClick={() => turn("prev")} aria-label="Page précédente">
            ‹
          </button>
          <span>{Math.round(percentage * 100)}%</span>
          <button type="button" onClick={() => turn("next")} aria-label="Page suivante">
            ›
          </button>
        </div>
        <div className="footer-cluster">
          {speechPhase !== "idle" && !settingsOpen ? (
            <button
              type="button"
              onClick={toggleSpeech}
              aria-label={speechPhase === "playing" ? "Pause" : speechPhase === "paused" ? "Reprendre" : "Lire la page"}
            >
              {speechPhase === "playing" ? "❚❚" : speechPhase === "loading" ? "…" : "▶"}
            </button>
          ) : null}
          <button
            type="button"
            className={settingsOpen ? "active" : ""}
            aria-expanded={settingsOpen}
            aria-label="Réglages"
            onClick={() => setSettingsOpen((open) => !open)}
          >
            Réglages
          </button>
        </div>
      </footer>

      {voiceOpen ? (
        <div className="sheet" onClick={() => setVoiceOpen(false)}>
          <aside onClick={(event) => event.stopPropagation()}>
            <header>
              <h2>Voix</h2>
              <button className="icon-button" onClick={() => setVoiceOpen(false)} aria-label="Fermer">
                ×
              </button>
            </header>
            <div className="sheet-body">
              <label className="voice-field">
                <span>Vitesse {tts.rate.toLocaleString("fr-FR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}×</span>
                <input
                  type="range"
                  min={0.7}
                  max={1.6}
                  step={0.1}
                  value={tts.rate}
                  aria-label="Vitesse"
                  onPointerDown={(event) => event.stopPropagation()}
                  onChange={(event) => updateTts({ rate: Number(event.target.value) })}
                />
              </label>
              <div className="voice-field">
                <span>{spokenLabel}</span>
                {matchingVoices.length === 0 ? (
                  <p className="muted">Aucune voix {spoken === "fr" ? "française" : "anglaise"} sur cet appareil.</p>
                ) : listedVoices.length > 0 ? (
                  <ul className="voice-list">
                    {listedVoices.map((voice) => {
                      const favorite = systemFavoriteIds.includes(voice.voiceURI);
                      const active = tts.engine === "system" && selectedVoice === voice.voiceURI;
                      return (
                        <li key={voice.voiceURI}>
                          <button
                            type="button"
                            className="star"
                            aria-label={favorite ? "Retirer des favoris" : "Ajouter aux favoris"}
                            onClick={() => setFavorites(toggleFavoriteVoice(spoken, voice.voiceURI))}
                          >
                            {favorite ? "★" : "☆"}
                          </button>
                          <button
                            type="button"
                            className={active ? "active" : ""}
                            onClick={() => chooseVoice(spoken, voice.voiceURI)}
                          >
                            {voice.name}
                            <small>{voice.lang}</small>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                ) : null}
                {hasFavorites ? (
                  <button type="button" className="text-button" onClick={() => setShowAllVoices((current) => !current)}>
                    {showAllVoices ? "Favoris seulement" : `Toutes les voix ${spoken === "fr" ? "françaises" : "anglaises"}`}
                  </button>
                ) : (
                  <p className="muted">Marque une étoile pour ne garder que tes voix.</p>
                )}
              </div>
              <section className="open-voices">
                <h3>Pack Piper</h3>
                <p className="muted">{PIPER_NOTE}</p>
                {listedPiper.map((voice) => {
                  const ready = piperSaved.includes(voice.id);
                  const active = tts.engine === "piper" && tts.piperVoice === voice.id;
                  const favorite = piperFavoriteIds.includes(`piper:${voice.id}`);
                  return (
                    <div className="voice-row" key={voice.id}>
                      <button
                        type="button"
                        className="star"
                        aria-label={favorite ? "Retirer des favoris" : "Ajouter aux favoris"}
                        onClick={() => setFavorites(toggleFavoriteVoice(spoken, `piper:${voice.id}`))}
                      >
                        {favorite ? "★" : "☆"}
                      </button>
                      <div>
                        <strong>{voice.name}</strong>
                        <small>
                          {voice.detail} · {voice.size}
                        </small>
                      </div>
                      {ready ? (
                        <button type="button" className={active ? "active" : ""} onClick={() => updateTts({ engine: "piper", piperVoice: voice.id })}>
                          {active ? "Utilisée" : "Utiliser"}
                        </button>
                      ) : (
                        <button type="button" disabled={downloadingId !== null} onClick={() => void fetchPiper(voice.id)}>
                          {downloadingId === voice.id ? "…" : "Télécharger"}
                        </button>
                      )}
                    </div>
                  );
                })}
              </section>
              {mobileOs && spoken === "en" ? (
                <section className="open-voices">
                  <h3>Voix open source</h3>
                  <p className="muted">{KOKORO_NOTE}</p>
                  <p className="muted">
                    Le modèle pèse {KOKORO_MODEL_SIZE} et n’est téléchargé qu’une fois. Chaque voix ajoute environ 0,5 Mo, puis reste sur cet appareil.
                  </p>
                  {OPEN_VOICES.map((voice) => {
                    const ready = savedVoices.includes(voice.id);
                    const active = tts.engine === "kokoro" && tts.kokoroVoice === voice.id;
                    return (
                      <div className="voice-row" key={voice.id}>
                        <div>
                          <strong>{voice.name}</strong>
                          <small>{voice.detail}</small>
                        </div>
                        {ready ? (
                          <button type="button" className={active ? "active" : ""} onClick={() => updateTts({ engine: "kokoro", kokoroVoice: voice.id })}>
                            {active ? "Utilisée" : "Utiliser"}
                          </button>
                        ) : (
                          <button type="button" disabled={downloadingId !== null} onClick={() => void fetchVoice(voice.id)}>
                            {downloadingId === voice.id ? "…" : "Télécharger"}
                          </button>
                        )}
                      </div>
                    );
                  })}
                </section>
              ) : null}
            </div>
          </aside>
        </div>
      ) : null}

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
        <div className="sheet toc-sheet" onClick={() => setTocOpen(false)}>
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

function playPageTurn(node: HTMLElement | null, direction: "prev" | "next") {
  if (!node) return;
  node.classList.remove("turn-next", "turn-prev");
  void node.offsetWidth;
  node.classList.add(direction === "next" ? "turn-next" : "turn-prev");
}

function currentPageText(rendition: Rendition | null, article: HTMLElement | null): string {
  if (article) return visibleArticleText(article);
  return visibleEpubText(rendition);
}

function visibleArticleText(article: HTMLElement): string {
  const box = article.getBoundingClientRect();
  const parts: string[] = [];
  for (const node of article.querySelectorAll("p:not(.translation-note)")) {
    const rect = node.getBoundingClientRect();
    if (rect.bottom > box.top + 8 && rect.top < box.bottom - 8) parts.push(node.textContent ?? "");
  }
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

function visibleEpubText(rendition: Rendition | null): string {
  const location = rendition?.currentLocation() as { start?: { cfi?: string }; end?: { cfi?: string } } | undefined;
  const contents = (rendition as { getContents?: () => Array<{ document?: Document }> } | null)?.getContents?.() ?? [];
  const doc = contents[0]?.document;
  const startCfi = location?.start?.cfi;
  const endCfi = location?.end?.cfi;
  if (!doc || !startCfi || !endCfi) return "";
  const start = new EpubCFI(startCfi).toRange(doc);
  const end = new EpubCFI(endCfi).toRange(doc);
  if (!start || !end) return "";
  try {
    const range = doc.createRange();
    range.setStart(start.startContainer, start.startOffset);
    range.setEnd(end.endContainer, end.endOffset);
    return range.toString().replace(/\s+/g, " ").trim();
  } catch {
    return "";
  }
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

function beginSession() {
  const theme = readPrefs().theme;
  return {
    started: Date.now(),
    pages: 0,
    seenLocation: false,
    tts: false,
    translation: false,
    theme,
    themeSince: Date.now(),
    themeMs: { papier: 0, sepia: 0, nuit: 0, cyber: 0 } as Record<ReaderPrefs["theme"], number>,
  };
}

function accountTheme(session: ReturnType<typeof beginSession>, theme: ReaderPrefs["theme"]) {
  const now = Date.now();
  session.themeMs[session.theme] += Math.max(0, now - session.themeSince);
  session.theme = theme;
  session.themeSince = now;
}

function mainTheme(session: ReturnType<typeof beginSession>): ReaderPrefs["theme"] {
  accountTheme(session, session.theme);
  let best: ReaderPrefs["theme"] = session.theme;
  let max = -1;
  for (const name of ["papier", "sepia", "nuit", "cyber"] as const) {
    if (session.themeMs[name] > max) {
      max = session.themeMs[name];
      best = name;
    }
  }
  return best;
}

function applyLook(rendition: Rendition, prefs: ReaderPrefs) {
  const contents =
    (rendition as unknown as { getContents?: () => Array<{ document?: Document }> }).getContents?.() ?? [];
  for (const content of contents) paintLook(content.document, prefs.theme);
  rendition.themes.fontSize(`${prefs.fontScale}%`);
}

function paintLook(doc: Document | undefined, theme: ReaderPrefs["theme"]) {
  if (!doc?.head) return;
  for (const name of ["default", "papier", "sepia", "nuit", "cyber"]) {
    doc.getElementById(`epubjs-inserted-css-${name}`)?.remove();
  }
  let style = doc.getElementById("lnf-look");
  if (!style) {
    style = doc.createElement("style");
    style.id = "lnf-look";
    doc.head.appendChild(style);
  }
  const look = LOOKS[theme];
  const faces = theme === "cyber" ? cyberFaces() : "";
  style.textContent = `
    ${faces}
    html, body {
      background: ${look.background} !important;
      color: ${look.color} !important;
      line-height: 1.65 !important;
      font-family: ${look.font} !important;
      font-weight: ${theme === "cyber" ? 500 : 400} !important;
      letter-spacing: ${theme === "cyber" ? "0.03em" : "0"} !important;
    }
    p, li, div, span, blockquote, td, figcaption, dd, dt {
      color: ${look.color} !important;
      font-family: ${look.font} !important;
      font-weight: ${theme === "cyber" ? 500 : 400} !important;
      letter-spacing: ${theme === "cyber" ? "0.03em" : "0"} !important;
    }
    h1, h2, h3, h4, h5, h6 {
      color: ${look.heading} !important;
      font-family: ${look.headingFont} !important;
      font-weight: ${theme === "cyber" ? 700 : 600} !important;
      letter-spacing: ${theme === "cyber" ? "0.08em" : "0"} !important;
      text-shadow: ${theme === "cyber" ? "0 0 16px rgba(252, 238, 10, 0.45)" : "none"};
    }
    a, a:link, a:visited { color: ${look.link} !important; }
    ::selection { background: ${look.heading}; color: ${look.background}; }
  `;
}

function cyberFaces(): string {
  const file = (href: string) => new URL(href, window.location.origin).href;
  return `
    @font-face {
      font-family: "LNF Orbitron";
      src: url("${file(orbitron700)}") format("woff2");
      font-weight: 700;
      font-style: normal;
      font-display: swap;
    }
    @font-face {
      font-family: "LNF Rajdhani";
      src: url("${file(rajdhani500)}") format("woff2");
      font-weight: 500;
      font-style: normal;
      font-display: swap;
    }
  `;
}
