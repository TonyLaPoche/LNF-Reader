import ePub from "epubjs";
import { getBook, saveBook } from "./db";
import { openPdf } from "./pdf";
import type { BookFormat } from "./types";

export async function importBook(file: File): Promise<string> {
  const format = formatOf(file);
  if (!format) throw new Error("Seuls les fichiers .epub et .pdf sont acceptés.");
  const data = await file.arrayBuffer();
  const id = `${file.name}:${file.size}:${file.lastModified}`;
  const existing = await getBook(id);
  const meta =
    format === "epub" ? await readEpub(data, file.name) : await readPdf(data, file.name);

  await saveBook({
    id,
    format,
    title: meta.title,
    author: meta.author,
    fileName: file.name,
    addedAt: existing?.addedAt ?? Date.now(),
    data,
    cover: meta.cover ?? existing?.cover ?? null,
    progress: existing?.progress ?? null,
  });
  return id;
}

function formatOf(file: File): BookFormat | null {
  const name = file.name.toLowerCase();
  if (name.endsWith(".epub")) return "epub";
  if (name.endsWith(".pdf")) return "pdf";
  return null;
}

async function readEpub(data: ArrayBuffer, fileName: string) {
  const book = ePub(data.slice(0));
  try {
    await book.ready;
    const metadata = await book.loaded.metadata;
    let cover: Blob | null = null;
    try {
      const coverUrl = await book.coverUrl();
      if (coverUrl) cover = await fetch(coverUrl).then((response) => response.blob());
    } catch {
      cover = null;
    }
    return {
      title: metadata.title?.trim() || fileName.replace(/\.epub$/i, ""),
      author: metadata.creator?.trim() || "Auteur inconnu",
      cover,
    };
  } finally {
    book.destroy();
  }
}

async function readPdf(data: ArrayBuffer, fileName: string) {
  const pdf = await openPdf(data);
  let cover: Blob | null = null;
  try {
    const page = await pdf.getPage(1);
    const viewport = page.getViewport({ scale: 0.4 });
    const canvas = document.createElement("canvas");
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    const context = canvas.getContext("2d");
    if (context) {
        await page.render({ canvas, canvasContext: context, viewport }).promise;
      cover = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.8));
    }
  } catch {
    cover = null;
  }
  return {
    title: fileName.replace(/\.pdf$/i, ""),
    author: "PDF",
    cover,
  };
}
