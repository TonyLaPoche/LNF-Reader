import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy } from "pdfjs-dist";
import workerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";

GlobalWorkerOptions.workerSrc = workerSrc;

export function openPdf(data: ArrayBuffer): Promise<PDFDocumentProxy> {
  return getDocument({ data: data.slice(0) }).promise;
}
