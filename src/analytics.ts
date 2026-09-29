import type { ReaderPrefs } from "./types";
import posthog from "posthog-js";

const POSTHOG_KEY = "phc_AxaMo4HXpE2mm9CeaXpV3cXwJWXmCbXDpXSwi9uQ4VeN";
const POSTHOG_HOST = "https://eu.i.posthog.com";

let ready = false;

export function startAnalytics() {
  posthog.init(POSTHOG_KEY, {
    api_host: POSTHOG_HOST,
    ui_host: "https://eu.posthog.com",
    defaults: "2026-05-30",
    capture_pageview: false,
    capture_pageleave: true,
  });
  ready = true;
  const nav = navigator as Navigator & { standalone?: boolean };
  const standalone = window.matchMedia("(display-mode: standalone)").matches || nav.standalone === true;
  posthog.register({ display_mode: standalone ? "standalone" : "browser" });
}

export function trackPageview(screen: string) {
  if (!ready) return;
  const base = new URL(import.meta.env.BASE_URL, window.location.origin);
  const path = base.pathname.replace(/\/$/, "");
  capture("$pageview", { $current_url: `${base.origin}${path}/${screen}` });
}

export function trackPwaInstalled() {
  if (!ready) return;
  try {
    posthog.register({ display_mode: "standalone" });
  } catch {
    // ignore
  }
  capture("pwa_installed");
}

export function trackBookImported(format: "epub" | "pdf") {
  capture("book_imported", { format });
}

export function trackLibrarySize(bookCount: number) {
  capture("library_snapshot", { book_count: bookCount });
}

export function trackImportFailed(reason: "format" | "read") {
  capture("import_failed", { reason });
}

export function trackReaderOpened(format: "epub" | "pdf") {
  let firstTime = false;
  try {
    firstTime = localStorage.getItem("lnf:reader-seen") !== "1";
    if (firstTime) localStorage.setItem("lnf:reader-seen", "1");
  } catch {
    firstTime = false;
  }
  capture("reader_opened", { format, first_time: firstTime });
}

export function trackReaderFailed(format: "epub" | "pdf") {
  capture("reader_failed", { format });
}

export function trackReadingSession(
  format: "epub" | "pdf",
  durationSeconds: number,
  pagesTurned: number,
  usedTts: boolean,
  usedTranslation: boolean,
  theme: ReaderPrefs["theme"],
) {
  const duration = Math.max(0, Math.round(durationSeconds));
  if (duration < 1 && pagesTurned < 1) return;
  capture("reading_session", {
    format,
    duration_seconds: duration,
    pages_turned: pagesTurned,
    used_tts: usedTts,
    used_translation: usedTranslation,
    theme,
  });
}

export function trackTtsStarted(engine: "system" | "kokoro" | "piper") {
  capture("tts_started", { engine });
}

export function trackTranslationStarted(scope: "chapter" | "book") {
  capture("translation_started", { scope });
}

function capture(event: string, properties?: Record<string, string | number | boolean>) {
  if (!ready) return;
  try {
    posthog.capture(event, properties);
  } catch {
    // A failed event must never interrupt reading or import.
  }
}
