export const TRANSLATION_NOTE =
  "Traduction par Transformers.js, une librairie open source. Ce n’est pas le travail d’un traducteur : le résultat n’est pas fiable à 100 %.";

export const MODEL_SIZE = "environ 80 Mo";

type ProgressEvent = {
  status?: string;
  progress?: number;
  file?: string;
};

type Translator = (text: string) => Promise<Array<{ translation_text: string }>>;

let translatorPromise: Promise<Translator> | null = null;

export function loadTranslator(onProgress: (label: string) => void): Promise<Translator> {
  translatorPromise ??= createTranslator(onProgress);
  return translatorPromise;
}

async function createTranslator(onProgress: (label: string) => void): Promise<Translator> {
  onProgress("Téléchargement du modèle…");
  const { pipeline, env } = await import("@huggingface/transformers");
  env.allowLocalModels = false;
  env.useBrowserCache = true;
  const model = await pipeline("translation", "Xenova/opus-mt-en-fr", {
    dtype: "q8",
    progress_callback: (event: ProgressEvent) => {
      if (event.status === "progress" && typeof event.progress === "number") {
        const file = event.file ? ` · ${event.file}` : "";
        onProgress(`Téléchargement ${Math.round(event.progress)} %${file}`);
      } else if (event.status === "initiate") {
        onProgress("Préparation du modèle…");
      }
    },
  });
  return async (text: string) => model(text) as Promise<Array<{ translation_text: string }>>;
}

export async function translateParagraphs(
  paragraphs: string[],
  onProgress: (label: string) => void,
  shouldStop: () => boolean,
): Promise<string[]> {
  const translator = await loadTranslator(onProgress);
  const translated: string[] = [];
  for (const [index, paragraph] of paragraphs.entries()) {
    if (shouldStop()) break;
    onProgress(`Traduction ${index + 1} / ${paragraphs.length}`);
    const parts = splitForModel(paragraph);
    const french: string[] = [];
    for (const part of parts) {
      if (shouldStop()) break;
      const output = await translator(part);
      french.push(output[0]?.translation_text?.trim() || part);
    }
    translated.push(french.join(" "));
  }
  return translated;
}

function splitForModel(text: string): string[] {
  if (text.length <= 420) return [text];
  const sentences = text.split(/(?<=[.!?])\s+/);
  const chunks: string[] = [];
  let current = "";
  for (const sentence of sentences) {
    const next = current ? `${current} ${sentence}` : sentence;
    if (next.length > 420 && current) {
      chunks.push(current);
      current = sentence;
    } else {
      current = next;
    }
  }
  if (current) chunks.push(current);
  return chunks.length > 0 ? chunks : [text];
}
