import type { Book } from "epubjs";

type SpineSection = {
  href: string;
  load: (loader: (path: string) => Promise<object>) => Promise<Document>;
  unload: () => void;
  document?: Document;
};

export async function readChapterParagraphs(book: Book, href: string): Promise<string[]> {
  const section = book.spine.get(href) as unknown as SpineSection | null;
  if (!section) return [];
  await section.load(book.load.bind(book));
  const body = section.document?.body;
  const fromParagraphs = [...(body?.querySelectorAll("p, h1, h2, h3, li") ?? [])]
    .map((node) => node.textContent?.replace(/\s+/g, " ").trim() ?? "")
    .filter((text) => text.length > 1);
  const fallback =
    body?.innerText
      ?.split(/\n+/)
      .map((line) => line.replace(/\s+/g, " ").trim())
      .filter((line) => line.length > 1) ?? [];
  section.unload();
  return fromParagraphs.length > 0 ? fromParagraphs : fallback;
}

export function spineHrefs(book: Book): string[] {
  const items = (book.spine as unknown as { items?: SpineSection[] }).items ?? [];
  return items.map((item) => item.href).filter(Boolean);
}

export function isEnglishLanguage(language: string | undefined): boolean {
  return (language ?? "").toLowerCase().startsWith("en");
}
