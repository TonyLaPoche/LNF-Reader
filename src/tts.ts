const PREFS_KEY = "lnf:tts";
const DOWNLOADED_KEY = "lnf:kokoro-voices";
const MODEL_ID = "onnx-community/Kokoro-82M-v1.0-ONNX";

export const KOKORO_MODEL_SIZE = "environ 90 Mo";
export const KOKORO_NOTE =
  "Voix Kokoro, modèle open source (licence Apache 2.0). Ce n’est pas une voix humaine professionnelle. Elles lisent l’anglais : pour un livre en français, garde une voix du téléphone.";

export const OPEN_VOICES = [
  { id: "af_heart", name: "Heart", detail: "anglais, femme" },
  { id: "am_michael", name: "Michael", detail: "anglais, homme" },
  { id: "bf_emma", name: "Emma", detail: "anglais britannique, femme" },
  { id: "bm_george", name: "George", detail: "anglais britannique, homme" },
] as const;

export type OpenVoiceId = (typeof OPEN_VOICES)[number]["id"];
export type TtsEngine = "system" | "kokoro";
export type TtsPhase = "idle" | "loading" | "playing" | "paused";

export type TtsPrefs = {
  volume: number;
  rate: number;
  voiceURI: string;
  engine: TtsEngine;
  kokoroVoice: OpenVoiceId;
};

const DEFAULT_PREFS: TtsPrefs = {
  volume: 1,
  rate: 1,
  voiceURI: "",
  engine: "system",
  kokoroVoice: "af_heart",
};

type ProgressEvent = { status?: string; progress?: number; file?: string };
type KokoroModel = {
  stream: (
    text: string,
    options: { voice: string; speed: number },
  ) => AsyncGenerator<{ audio: { audio: Float32Array; sampling_rate: number } }>;
};

let modelPromise: Promise<KokoroModel> | null = null;

export function readTtsPrefs(): TtsPrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return { ...DEFAULT_PREFS };
    const parsed = JSON.parse(raw) as Partial<TtsPrefs>;
    const kokoroVoice = OPEN_VOICES.some((voice) => voice.id === parsed.kokoroVoice)
      ? (parsed.kokoroVoice as OpenVoiceId)
      : DEFAULT_PREFS.kokoroVoice;
    return {
      volume: clamp(parsed.volume, 0, 1, DEFAULT_PREFS.volume),
      rate: clamp(parsed.rate, 0.7, 1.6, DEFAULT_PREFS.rate),
      voiceURI: typeof parsed.voiceURI === "string" ? parsed.voiceURI : "",
      engine: parsed.engine === "kokoro" ? "kokoro" : "system",
      kokoroVoice,
    };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function writeTtsPrefs(prefs: TtsPrefs) {
  localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
}

export function downloadedVoices(): OpenVoiceId[] {
  try {
    const raw = localStorage.getItem(DOWNLOADED_KEY);
    const ids = raw ? (JSON.parse(raw) as string[]) : [];
    return OPEN_VOICES.map((voice) => voice.id).filter((id) => ids.includes(id));
  } catch {
    return [];
  }
}

function rememberVoice(id: OpenVoiceId) {
  const next = new Set(downloadedVoices());
  next.add(id);
  localStorage.setItem(DOWNLOADED_KEY, JSON.stringify([...next]));
}

export function voiceFileUrl(id: string) {
  return `https://huggingface.co/${MODEL_ID}/resolve/main/voices/${id}.bin`;
}

export function watchSystemVoices(onChange: (voices: SpeechSynthesisVoice[]) => void) {
  const synth = window.speechSynthesis;
  if (!synth) return () => {};
  const emit = () => onChange(synth.getVoices());
  emit();
  synth.addEventListener("voiceschanged", emit);
  return () => synth.removeEventListener("voiceschanged", emit);
}

export function preferredSystemVoice(voices: SpeechSynthesisVoice[], voiceURI: string) {
  const chosen = voices.find((voice) => voice.voiceURI === voiceURI);
  if (chosen) return chosen;
  return (
    voices.find((voice) => voice.lang.toLowerCase().startsWith("fr")) ??
    voices.find((voice) => voice.default) ??
    voices[0]
  );
}

export function loadKokoro(onProgress: (label: string) => void): Promise<KokoroModel> {
  modelPromise ??= createKokoro(onProgress).catch((error: unknown) => {
    modelPromise = null;
    throw error;
  });
  return modelPromise;
}

async function createKokoro(onProgress: (label: string) => void): Promise<KokoroModel> {
  onProgress("Téléchargement du modèle…");
  const { KokoroTTS } = await import("kokoro-js");
  const model = await KokoroTTS.from_pretrained(MODEL_ID, {
    dtype: "q8",
    device: "wasm",
    progress_callback: (event: ProgressEvent) => {
      if (event.status === "progress" && typeof event.progress === "number") {
        onProgress(`Téléchargement ${Math.round(event.progress)} %`);
      } else if (event.status === "initiate") {
        onProgress("Préparation du modèle…");
      }
    },
  });
  return model as unknown as KokoroModel;
}

export async function downloadOpenVoice(id: OpenVoiceId, onProgress: (label: string) => void) {
  await loadKokoro(onProgress);
  onProgress("Téléchargement de la voix…");
  const url = voiceFileUrl(id);
  const response = await fetch(url);
  if (!response.ok) throw new Error("Téléchargement de la voix impossible.");
  const buffer = await response.arrayBuffer();
  const cache = await caches.open("kokoro-voices");
  await cache.put(url, new Response(buffer));
  rememberVoice(id);
}

type PlayOptions = {
  text: string;
  prefs: TtsPrefs;
  onDone: () => void;
  onStatus: (label: string | null) => void;
};

class PageSpeech {
  phase: TtsPhase = "idle";
  private listeners = new Set<() => void>();
  private token = 0;
  private keepAlive = 0;
  private audio: AudioContext | null = null;
  private gain: GainNode | null = null;
  private sources: AudioBufferSourceNode[] = [];
  private spokenIndex = 0;
  private activeText = "";
  private resumePrefs: TtsPrefs | null = null;
  private resumeOnDone: (() => void) | null = null;
  private resumeOnStatus: ((label: string | null) => void) | null = null;
  private pendingFinish: (() => void) | null = null;

  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify() {
    for (const listener of this.listeners) listener();
  }

  stop() {
    this.token += 1;
    this.phase = "idle";
    this.clearSystem();
    this.stopSources();
    this.resumePrefs = null;
    this.pendingFinish = null;
    this.notify();
  }

  pause() {
    if (this.phase !== "playing") return;
    if (this.resumePrefs?.engine === "kokoro") void this.audio?.suspend();
    else window.speechSynthesis?.pause();
    this.phase = "paused";
    this.notify();
    window.setTimeout(() => {
      const synth = window.speechSynthesis;
      if (this.phase === "paused" && synth?.speaking && !synth.paused) synth.cancel();
    }, 250);
  }

  resume() {
    if (this.phase !== "paused" || !this.resumePrefs || !this.resumeOnDone || !this.resumeOnStatus) return;
    if (this.resumePrefs.engine === "kokoro" && this.audio) {
      void this.audio.resume();
      this.phase = "playing";
      this.notify();
      const finish = this.pendingFinish;
      this.pendingFinish = null;
      finish?.();
      return;
    }
    const synth = window.speechSynthesis;
    if (synth?.paused) {
      synth.resume();
      this.phase = "playing";
      this.notify();
      return;
    }
    const rest = this.activeText.slice(this.spokenIndex).trim();
    if (!rest) {
      this.phase = "idle";
      this.notify();
      this.resumeOnDone();
      return;
    }
    void this.play({
      text: rest,
      prefs: this.resumePrefs,
      onDone: this.resumeOnDone,
      onStatus: this.resumeOnStatus,
    });
  }

  setVolume(volume: number) {
    if (this.gain) this.gain.gain.value = volume;
  }

  async play({ text, prefs, onDone, onStatus }: PlayOptions) {
    this.stop();
    const token = this.token;
    this.activeText = text;
    this.spokenIndex = 0;
    this.resumePrefs = prefs;
    this.resumeOnDone = onDone;
    this.resumeOnStatus = onStatus;
    this.phase = "loading";
    this.notify();
    try {
      if (prefs.engine === "kokoro") await this.playKokoro(text, prefs, token, onDone, onStatus);
      else this.playSystem(text, prefs, token, onDone);
    } catch (error) {
      if (token !== this.token) return;
      this.phase = "idle";
      this.notify();
      onStatus(error instanceof Error ? error.message : "Lecture vocale impossible.");
    }
  }

  private playSystem(text: string, prefs: TtsPrefs, token: number, onDone: () => void) {
    const synth = window.speechSynthesis;
    if (!synth) throw new Error("Ce navigateur ne lit pas le texte à voix haute.");
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = prefs.rate;
    utterance.volume = prefs.volume;
    const voice = preferredSystemVoice(synth.getVoices(), prefs.voiceURI);
    if (voice) utterance.voice = voice;
    utterance.onboundary = (event) => {
      if (typeof event.charIndex === "number") this.spokenIndex = event.charIndex;
    };
    utterance.onend = () => {
      if (token !== this.token) return;
      this.clearSystem();
      this.phase = "idle";
      this.notify();
      onDone();
    };
    utterance.onerror = () => {
      if (token !== this.token || this.phase === "paused") return;
      this.clearSystem();
      this.phase = "idle";
      this.notify();
    };
    this.keepAlive = window.setInterval(() => {
      if (token !== this.token || this.phase !== "playing") return;
      if (synth.speaking && !synth.paused) synth.resume();
    }, 10000);
    synth.cancel();
    synth.speak(utterance);
    this.phase = "playing";
    this.notify();
  }

  private async playKokoro(
    text: string,
    prefs: TtsPrefs,
    token: number,
    onDone: () => void,
    onStatus: (label: string | null) => void,
  ) {
    const model = await loadKokoro(onStatus);
    if (token !== this.token) return;
    const context = this.ensureAudio();
    await context.resume();
    if (token !== this.token) return;
    if (this.gain) this.gain.gain.value = prefs.volume;
    let pending = 0;
    let generationDone = false;
    const maybeFinish = () => {
      if (token !== this.token || !generationDone || pending > 0) return;
      const finish = () => {
        if (token !== this.token) return;
        this.phase = "idle";
        this.notify();
        onDone();
      };
      if (this.phase === "paused") {
        this.pendingFinish = finish;
        return;
      }
      finish();
    };
    this.phase = "playing";
    this.notify();
    onStatus(null);
    let nextAt = context.currentTime;
    for await (const chunk of model.stream(text, { voice: prefs.kokoroVoice, speed: prefs.rate })) {
      if (token !== this.token) return;
      const samples = chunk.audio.audio;
      const buffer = context.createBuffer(1, samples.length, chunk.audio.sampling_rate);
      buffer.copyToChannel(samples, 0);
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(this.gain ?? context.destination);
      const start = Math.max(nextAt, context.currentTime + 0.05);
      source.start(start);
      nextAt = start + buffer.duration;
      pending += 1;
      this.sources.push(source);
      source.onended = () => {
        pending -= 1;
        this.sources = this.sources.filter((item) => item !== source);
        maybeFinish();
      };
    }
    generationDone = true;
    maybeFinish();
  }

  private ensureAudio() {
    if (!this.audio) {
      const context = new AudioContext();
      const gain = context.createGain();
      gain.connect(context.destination);
      this.audio = context;
      this.gain = gain;
    }
    return this.audio;
  }

  private clearSystem() {
    window.clearInterval(this.keepAlive);
    this.keepAlive = 0;
    window.speechSynthesis?.cancel();
  }

  private stopSources() {
    for (const source of this.sources) {
      try {
        source.onended = null;
        source.stop();
      } catch {
        /* already stopped */
      }
    }
    this.sources = [];
    if (this.audio?.state === "running") void this.audio.suspend();
  }
}

export const pageSpeech = new PageSpeech();

function clamp(value: unknown, min: number, max: number, fallback: number) {
  const number = typeof value === "number" ? value : fallback;
  if (Number.isNaN(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}
