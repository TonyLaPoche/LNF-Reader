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
  posthog.capture("$pageview", { $current_url: `${base.origin}${path}/${screen}` });
}

export function trackPwaInstalled() {
  if (!ready) return;
  posthog.register({ display_mode: "standalone" });
  posthog.capture("pwa_installed");
}

export function trackBookImported(format: "epub" | "pdf") {
  if (!ready) return;
  posthog.capture("book_imported", { format });
}

export function trackLibrarySize(bookCount: number) {
  if (!ready) return;
  posthog.capture("library_snapshot", { book_count: bookCount });
}
