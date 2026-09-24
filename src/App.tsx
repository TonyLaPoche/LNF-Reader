import { useEffect, useState } from "react";
import { Library } from "./Library";
import { PdfReader } from "./PdfReader";
import { Reader } from "./Reader";
import { readLastBook, writeLastBook } from "./prefs";
import type { BookFormat, BookSummary } from "./types";

type Route =
  | { name: "library" }
  | { name: "series"; key: string }
  | { name: "reader"; id: string; format: BookFormat; seriesKey: string };

const libraryRoute: Route = { name: "library" };

export function App() {
  const [route, setRoute] = useState<Route>(libraryRoute);
  const lastBook = readLastBook();

  useEffect(() => {
    history.replaceState(libraryRoute, "");
    const onPop = (event: PopStateEvent) => {
      setRoute(isRoute(event.state) ? event.state : libraryRoute);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  function push(next: Route) {
    history.pushState(next, "");
    setRoute(next);
  }

  function openSeries(key: string) {
    push({ name: "series", key });
  }

  function openBook(book: Pick<BookSummary, "id" | "format" | "series">, seriesKey = book.series.toLowerCase()) {
    writeLastBook(book.id, book.format, seriesKey);
    if (route.name === "library" && seriesKey) history.pushState({ name: "series", key: seriesKey }, "");
    push({ name: "reader", id: book.id, format: book.format, seriesKey });
  }

  if (route.name === "reader" && route.format === "pdf") {
    return <PdfReader bookId={route.id} onBack={() => history.back()} />;
  }

  if (route.name === "reader") {
    return <Reader bookId={route.id} onBack={() => history.back()} />;
  }

  return (
    <>
      <Library
        seriesKey={route.name === "series" ? route.key : null}
        onOpenSeries={openSeries}
        onBack={() => history.back()}
        onOpen={(book) => openBook(book, route.name === "series" ? route.key : book.series.toLowerCase())}
      />
      {lastBook ? (
        <button className="resume" onClick={() => openBook(lastBook, lastBook.seriesKey)}>
          Reprendre la lecture
        </button>
      ) : null}
    </>
  );
}

function isRoute(value: unknown): value is Route {
  if (!value || typeof value !== "object") return false;
  const route = value as Partial<Route>;
  if (route.name === "library") return true;
  if (route.name === "series") return typeof route.key === "string";
  return route.name === "reader" && typeof route.id === "string" && (route.format === "epub" || route.format === "pdf");
}
