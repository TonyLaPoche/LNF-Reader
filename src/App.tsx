import { useState } from "react";
import { Library } from "./Library";
import { PdfReader } from "./PdfReader";
import { Reader } from "./Reader";
import { readLastBook } from "./prefs";
import type { BookFormat, BookSummary } from "./types";

export function App() {
  const [opened, setOpened] = useState<{ id: string; format: BookFormat } | null>(null);
  const lastBook = readLastBook();

  function openBook(book: Pick<BookSummary, "id" | "format">) {
    setOpened({ id: book.id, format: book.format });
  }

  if (opened?.format === "pdf") {
    return <PdfReader bookId={opened.id} onBack={() => setOpened(null)} />;
  }

  if (opened) {
    return <Reader bookId={opened.id} onBack={() => setOpened(null)} />;
  }

  return (
    <>
      <Library onOpen={openBook} />
      {lastBook ? (
        <button className="resume" onClick={() => setOpened(lastBook)}>
          Reprendre la lecture
        </button>
      ) : null}
    </>
  );
}
