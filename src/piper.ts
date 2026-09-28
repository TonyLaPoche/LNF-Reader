const DOWNLOADED_KEY = "lnf:piper-voices";
const CACHE_NAME = "piper-voices";
const VOICE_BASE = "https://huggingface.co/rhasspy/piper-voices/resolve/main/";

export const PIPER_NOTE =
  "Voix du projet open source Piper (GitHub, rhasspy/piper). Chaque fichier se télécharge une fois et reste sur cet appareil. Ce n’est pas une voix de studio.";

export const PIPER_VOICES = [
  { id: "fr_FR-siwis-medium", name: "Siwis", lang: "fr", detail: "français, femme", size: "63 Mo" },
  { id: "fr_FR-tom-medium", name: "Tom", lang: "fr", detail: "français, homme", size: "64 Mo" },
  { id: "en_US-lessac-high", name: "Lessac", lang: "en", detail: "anglais, femme", size: "114 Mo" },
  { id: "en_US-ryan-high", name: "Ryan", lang: "en", detail: "anglais, homme", size: "121 Mo" },
] as const;

export type PiperVoiceId = (typeof PIPER_VOICES)[number]["id"];

type VoiceJson = {
  inference?: { noise_scale: number; length_scale: number; noise_w: number };
};

type PiperModule = {
  PiperWebEngine: new (options?: object) => {
    generate: (text: string, voice: string, speaker?: number) => Promise<{ file: Blob }>;
  };
  OnnxWebRuntime: new (options?: { basePath?: string; numThreads?: number }) => object;
  PhonemizeWebRuntime: new (options?: { basePath?: string }) => object;
  HuggingFaceVoiceProvider: new (options?: { provider?: VoiceProvider }) => object;
};

type VoiceProvider = {
  fetch: (url: string) => Promise<unknown>;
  destroy: () => void;
};

const blobUrls = new Map<string, string>();
let speakRate = 1;
let enginePromise: Promise<PiperModule["PiperWebEngine"]["prototype"]> | null = null;

export function downloadedPiperVoices(): PiperVoiceId[] {
  try {
    const raw = localStorage.getItem(DOWNLOADED_KEY);
    const ids = raw ? (JSON.parse(raw) as string[]) : [];
    return PIPER_VOICES.map((voice) => voice.id).filter((id) => ids.includes(id));
  } catch {
    return [];
  }
}

function rememberVoice(id: PiperVoiceId) {
  const next = new Set(downloadedPiperVoices());
  next.add(id);
  localStorage.setItem(DOWNLOADED_KEY, JSON.stringify([...next]));
}

export function piperVoiceFiles(id: string) {
  const parts = id.split("-");
  const folder = `${parts[0].split("_")[0]}/${parts.join("/")}/${id}`;
  return [`${VOICE_BASE}${folder}.onnx.json`, `${VOICE_BASE}${folder}.onnx`];
}

export async function downloadPiperVoice(id: PiperVoiceId, onProgress: (label: string) => void) {
  const [configUrl, modelUrl] = piperVoiceFiles(id);
  onProgress("Téléchargement de la voix…");
  await cachedFetch(configUrl, onProgress);
  await cachedFetch(modelUrl, onProgress);
  rememberVoice(id);
}

export async function synthesizePiper(text: string, voiceId: string, rate: number, onProgress: (label: string) => void) {
  speakRate = rate;
  onProgress("Préparation de la voix…");
  const engine = await loadEngine();
  const result = await engine.generate(text, voiceId, 0);
  return result.file;
}

async function loadEngine() {
  enginePromise ??= createEngine().catch((error: unknown) => {
    enginePromise = null;
    throw error;
  });
  return enginePromise;
}

async function createEngine() {
  const piper = (await import("piper-tts-web")) as PiperModule;
  const base = import.meta.env.BASE_URL;
  return new piper.PiperWebEngine({
    onnxRuntime: new piper.OnnxWebRuntime({ basePath: `${base}onnx/`, numThreads: 1 }),
    phonemizeRuntime: new piper.PhonemizeWebRuntime({ basePath: `${base}piper/` }),
    voiceProvider: new piper.HuggingFaceVoiceProvider({ provider: cacheProvider }),
  });
}

const cacheProvider: VoiceProvider = {
  destroy() {},
  async fetch(url: string) {
    if (!url.endsWith(".json")) {
      const existing = blobUrls.get(url);
      if (existing) return existing;
    }
    const response = await cachedFetch(url, () => {});
    if (url.endsWith(".json")) {
      const config = (await response.json()) as VoiceJson;
      if (config.inference) config.inference.length_scale = 1 / speakRate;
      return config;
    }
    const objectUrl = URL.createObjectURL(await response.blob());
    blobUrls.set(url, objectUrl);
    return objectUrl;
  },
};

async function cachedFetch(url: string, onProgress: (label: string) => void) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(url);
  if (cached) return cached;
  const response = await fetch(url);
  if (!response.ok || !response.body) throw new Error("Téléchargement de la voix impossible.");
  const total = Number(response.headers.get("content-length")) || 0;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const step = await reader.read();
    if (step.done) break;
    chunks.push(step.value);
    received += step.value.byteLength;
    if (total > 0) onProgress(`Téléchargement ${Math.round((received / total) * 100)} %`);
  }
  const blob = new Blob(chunks as BlobPart[]);
  const stored = new Response(blob, { headers: response.headers });
  await cache.put(url, stored.clone());
  return stored;
}
