import { PIPER_VOICES, synthesizePiper, type PiperVoiceId } from "./piper";

const PREFS_KEY = "lnf:tts";
const DOWNLOADED_KEY = "lnf:kokoro-voices";
const FAVORITES_KEY = "lnf:voice-favorites";
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
export type TtsEngine = "system" | "kokoro" | "piper";
export type TtsPhase = "idle" | "loading" | "playing" | "paused";

export type VoiceLang = "fr" | "en";

export type TtsPrefs = {
  volume: number;
  rate: number;
  voiceURI: string;
  voiceByLang: Record<VoiceLang, string>;
  engine: TtsEngine;
  kokoroVoice: OpenVoiceId;
  piperVoice: PiperVoiceId;
};

const DEFAULT_PREFS: TtsPrefs = {
  volume: 1,
  rate: 1,
  voiceURI: "",
  voiceByLang: { fr: "", en: "" },
  engine: "system",
  kokoroVoice: "af_heart",
  piperVoice: "fr_FR-siwis-medium",
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
    const voiceByLang = parsed.voiceByLang ?? DEFAULT_PREFS.voiceByLang;
    const piperMatch = PIPER_VOICES.find((voice) => voice.id === parsed.piperVoice);
    const piperVoice = piperMatch?.id ?? DEFAULT_PREFS.piperVoice;
    return {
      volume: clamp(parsed.volume, 0, 1, DEFAULT_PREFS.volume),
      rate: clamp(parsed.rate, 0.7, 1.6, DEFAULT_PREFS.rate),
      voiceURI: typeof parsed.voiceURI === "string" ? parsed.voiceURI : "",
      voiceByLang: {
        fr: typeof voiceByLang.fr === "string" ? voiceByLang.fr : "",
        en: typeof voiceByLang.en === "string" ? voiceByLang.en : "",
      },
      engine: parsed.engine === "kokoro" || parsed.engine === "piper" ? parsed.engine : "system",
      kokoroVoice,
      piperVoice,
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

export function spokenVoiceLang(bookLanguage: string, readingFrench: boolean): VoiceLang {
  if (readingFrench) return "fr";
  return bookLanguage.toLowerCase().startsWith("en") ? "en" : "fr";
}

export function voicesForLang(voices: SpeechSynthesisVoice[], lang: VoiceLang) {
  return voices.filter((voice) => voice.lang.toLowerCase().replace("_", "-").startsWith(lang));
}

export function readFavoriteVoices(): Record<VoiceLang, string[]> {
  try {
    const raw = localStorage.getItem(FAVORITES_KEY);
    const parsed = raw ? (JSON.parse(raw) as Partial<Record<VoiceLang, string[]>>) : {};
    return {
      fr: Array.isArray(parsed.fr) ? parsed.fr.filter((id) => typeof id === "string") : [],
      en: Array.isArray(parsed.en) ? parsed.en.filter((id) => typeof id === "string") : [],
    };
  } catch {
    return { fr: [], en: [] };
  }
}

export function toggleFavoriteVoice(lang: VoiceLang, voiceURI: string) {
  const current = readFavoriteVoices();
  const list = current[lang];
  current[lang] = list.includes(voiceURI) ? list.filter((id) => id !== voiceURI) : [...list, voiceURI];
  localStorage.setItem(FAVORITES_KEY, JSON.stringify(current));
  return current;
}

export function preferredSystemVoice(voices: SpeechSynthesisVoice[], voiceURI: string, lang: VoiceLang = "fr") {
  const pool = voicesForLang(voices, lang);
  const source = pool.length > 0 ? pool : voices;
  return source.find((voice) => voice.voiceURI === voiceURI) ?? source[0];
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
  lang: VoiceLang;
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
  private resumeLang: VoiceLang = "fr";
  private pendingFinish: (() => void) | null = null;
  private sourceRates = new Map<AudioBufferSourceNode, number>();
  private piperBuffers: AudioBuffer[] = [];
  private piperParts: string[] = [];
  private piperClock = 0;
  private piperScheduleRate = 1;
  private needsRestart = false;
  private pendingVoiceText: string | null = null;
  private systemRestart = 0;

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
    window.clearTimeout(this.systemRestart);
    this.resumePrefs = null;
    this.pendingFinish = null;
    this.needsRestart = false;
    this.pendingVoiceText = null;
    this.notify();
  }

  useVoice(prefs: TtsPrefs) {
    if (!this.resumePrefs || this.phase === "idle") return;
    if (voiceSignature(this.resumePrefs, this.resumeLang) === voiceSignature(prefs, this.resumeLang)) return;
    const text = this.pendingVoiceText || this.remainingText();
    this.pendingVoiceText = text;
    this.resumePrefs = { ...prefs, volume: this.resumePrefs.volume, rate: this.resumePrefs.rate };
    this.needsRestart = true;
    this.token += 1;
    this.clearSystem();
    this.piperBuffers = [];
    this.piperParts = [];
    this.haltSources();
    if (this.audio?.state === "running") void this.audio.suspend();
    if (this.phase === "paused") return;
    const snapshot = {
      text,
      prefs: this.resumePrefs,
      lang: this.resumeLang,
      onDone: this.resumeOnDone,
      onStatus: this.resumeOnStatus,
    };
    this.needsRestart = false;
    this.pendingVoiceText = null;
    queueMicrotask(() => {
      if (this.phase === "paused" || this.phase === "idle") return;
      if (!snapshot.text || !snapshot.onDone || !snapshot.onStatus) return;
      void this.play({
        text: snapshot.text,
        prefs: snapshot.prefs,
        lang: snapshot.lang,
        onDone: snapshot.onDone,
        onStatus: snapshot.onStatus,
      });
    });
  }

  pause() {
    if (this.phase !== "playing") return;
    if (this.resumePrefs?.engine === "piper" || this.resumePrefs?.engine === "kokoro") void this.audio?.suspend();
    else window.speechSynthesis?.pause();
    this.phase = "paused";
    this.notify();
    if (this.resumePrefs?.engine === "system") {
      window.setTimeout(() => {
        const synth = window.speechSynthesis;
        if (this.phase === "paused" && synth?.speaking && !synth.paused) synth.cancel();
      }, 250);
    }
  }

  resume() {
    if (this.phase !== "paused" || !this.resumePrefs || !this.resumeOnDone || !this.resumeOnStatus) return;
    if (this.needsRestart) {
      const text = this.pendingVoiceText || this.remainingText();
      const prefs = this.resumePrefs;
      const onDone = this.resumeOnDone;
      const onStatus = this.resumeOnStatus;
      const lang = this.resumeLang;
      this.needsRestart = false;
      this.pendingVoiceText = null;
      if (!text) {
        this.phase = "idle";
        this.notify();
        onDone();
        return;
      }
      void this.play({ text, prefs, lang, onDone, onStatus });
      return;
    }
    if (this.resumePrefs.engine === "piper" || (this.resumePrefs.engine === "kokoro" && this.audio)) {
      void this.audio?.resume();
      this.phase = "playing";
      this.notify();
      if (this.resumePrefs.engine === "kokoro") {
        const finish = this.pendingFinish;
        this.pendingFinish = null;
        finish?.();
      }
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
      lang: this.resumeLang,
      onDone: this.resumeOnDone,
      onStatus: this.resumeOnStatus,
    });
  }

  setVolume(volume: number) {
    if (this.resumePrefs) this.resumePrefs.volume = volume;
    if (this.gain) this.gain.gain.value = volume;
    this.restartSystemSoon();
  }

  setRate(rate: number) {
    if (this.resumePrefs) this.resumePrefs.rate = rate;
    if (
      this.resumePrefs?.engine === "piper" &&
      this.piperBuffers.length > 0 &&
      this.audio &&
      (this.phase === "playing" || this.phase === "paused")
    ) {
      const elapsed = Math.max(0, (this.audio.currentTime - this.piperClock) * this.piperScheduleRate);
      this.schedulePiper(rate, elapsed, this.token);
      return;
    }
    for (const [source, baked] of this.sourceRates) {
      try {
        source.playbackRate.value = rate / baked;
      } catch {
        /* source already finished */
      }
    }
    this.restartSystemSoon();
  }

  async play({ text, prefs, lang, onDone, onStatus }: PlayOptions) {
    this.stop();
    const token = this.token;
    this.activeText = text;
    this.spokenIndex = 0;
    this.resumePrefs = prefs;
    this.resumeLang = lang;
    this.resumeOnDone = onDone;
    this.resumeOnStatus = onStatus;
    this.phase = "loading";
    this.notify();
    try {
      const piperVoice = PIPER_VOICES.find((voice) => voice.id === prefs.piperVoice);
      if (prefs.engine === "piper" && piperVoice?.lang === lang) {
        this.unlockPiperAudio();
        await this.playPiper(text, prefs, token, onDone, onStatus);
      } else if (prefs.engine === "kokoro" && lang === "en") await this.playKokoro(text, prefs, token, onDone, onStatus);
      else this.playSystem(text, prefs, lang, token, onDone);
    } catch (error) {
      if (token !== this.token) return;
      this.phase = "idle";
      this.notify();
      onStatus(error instanceof Error ? error.message : "Lecture vocale impossible.");
    }
  }

  private unlockPiperAudio() {
    const context = this.ensureAudio();
    void context.resume();
    const audio = new Audio("data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=");
    void audio.play().catch(() => {});
  }

  private async playPiper(
    text: string,
    prefs: TtsPrefs,
    token: number,
    onDone: () => void,
    onStatus: (label: string | null) => void,
  ) {
    const parts = text.match(/[^.!?…]+[.!?…]+|[^.!?…]+$/g)?.map((part) => part.trim()).filter(Boolean) ?? [text];
    this.piperParts = parts;
    const context = this.ensureAudio();
    const buffers: AudioBuffer[] = [];
    for (const [index, part] of parts.entries()) {
      if (token !== this.token) return;
      const current = this.resumePrefs ?? prefs;
      onStatus(`Préparation ${index + 1} / ${parts.length}`);
      const blob = await synthesizePiper(part, current.piperVoice, 1, () => {});
      if (token !== this.token) return;
      const bytes = await blob.arrayBuffer();
      buffers.push(await context.decodeAudioData(bytes.slice(0)));
    }
    if (token !== this.token || buffers.length === 0) return;
    await context.resume();
    if (token !== this.token) return;
    onStatus(null);
    const rate = this.resumePrefs?.rate ?? prefs.rate;
    if (this.gain) this.gain.gain.value = this.resumePrefs?.volume ?? prefs.volume;
    this.piperBuffers = buffers;
    this.phase = "playing";
    this.notify();
    this.schedulePiper(rate, 0, token, onDone);
  }

  private schedulePiper(rate: number, offset: number, token: number, onDone?: () => void) {
    const context = this.audio;
    if (!context) return;
    this.haltSources();
    let skip = offset;
    let index = 0;
    while (index < this.piperBuffers.length) {
      const duration = this.piperBuffers[index].duration;
      if (duration <= 0) {
        index += 1;
        continue;
      }
      if (skip < duration - 0.02) break;
      skip -= duration;
      index += 1;
    }
    const finish = onDone ?? this.resumeOnDone;
    if (index >= this.piperBuffers.length) {
      this.piperBuffers = [];
      if (token !== this.token || !finish) return;
      this.phase = "idle";
      this.notify();
      finish();
      return;
    }
    const whenStart = context.currentTime + 0.03;
    this.piperScheduleRate = rate;
    this.piperClock = whenStart - offset / rate;
    let when = whenStart;
    let remaining = this.piperBuffers.length - index;
    for (let cursor = index; cursor < this.piperBuffers.length; cursor += 1) {
      const buffer = this.piperBuffers[cursor];
      const bufferOffset = cursor === index ? Math.max(0, skip) : 0;
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.playbackRate.value = rate;
      source.connect(this.gain ?? context.destination);
      source.start(when, bufferOffset);
      when += (buffer.duration - bufferOffset) / rate;
      this.sources.push(source);
      this.sourceRates.set(source, 1);
      source.onended = () => {
        remaining -= 1;
        this.sources = this.sources.filter((item) => item !== source);
        this.sourceRates.delete(source);
        if (remaining > 0 || token !== this.token) return;
        this.piperBuffers = [];
        this.phase = "idle";
        this.notify();
        finish?.();
      };
    }
  }

  private restartSystemSoon() {
    if (this.resumePrefs?.engine !== "system" || this.phase !== "playing") return;
    window.clearTimeout(this.systemRestart);
    this.systemRestart = window.setTimeout(() => this.restartSystemNow(), 160);
  }

  private restartSystemNow() {
    if (this.resumePrefs?.engine !== "system" || this.phase !== "playing" || !this.resumeOnDone) return;
    const rest = (this.activeText.slice(this.spokenIndex).trim() || this.activeText).trim();
    if (!rest) return;
    this.token += 1;
    this.clearSystem();
    this.activeText = rest;
    this.spokenIndex = 0;
    this.playSystem(rest, this.resumePrefs, this.resumeLang, this.token, this.resumeOnDone);
  }

  private playSystem(text: string, prefs: TtsPrefs, lang: VoiceLang, token: number, onDone: () => void) {
    const synth = window.speechSynthesis;
    if (!synth) throw new Error("Ce navigateur ne lit pas le texte à voix haute.");
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = lang === "fr" ? "fr-FR" : "en-US";
    utterance.rate = prefs.rate;
    utterance.volume = prefs.volume;
    const voice = preferredSystemVoice(synth.getVoices(), prefs.voiceByLang[lang] || prefs.voiceURI, lang);
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
    window.setTimeout(() => {
      if (token !== this.token) return;
      synth.speak(utterance);
    }, 50);
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
    const baked = this.resumePrefs?.rate ?? prefs.rate;
    let nextAt = context.currentTime;
    for await (const chunk of model.stream(text, { voice: prefs.kokoroVoice, speed: baked })) {
      if (token !== this.token) return;
      const samples = chunk.audio.audio;
      const buffer = context.createBuffer(1, samples.length, chunk.audio.sampling_rate);
      buffer.copyToChannel(samples, 0);
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.playbackRate.value = (this.resumePrefs?.rate ?? baked) / baked;
      source.connect(this.gain ?? context.destination);
      const start = Math.max(nextAt, context.currentTime + 0.05);
      source.start(start);
      nextAt = start + buffer.duration / source.playbackRate.value;
      pending += 1;
      this.sources.push(source);
      this.sourceRates.set(source, baked);
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

  private remainingText() {
    if (this.resumePrefs?.engine === "piper" && this.piperParts.length > 0 && this.piperBuffers.length > 0) {
      const rest = this.piperParts.slice(this.piperSentenceIndex()).join(" ").trim();
      if (rest) return rest;
    }
    const rest = this.activeText.slice(this.spokenIndex).trim();
    return rest || this.activeText.trim();
  }

  private piperSentenceIndex() {
    if (!this.audio || this.piperBuffers.length === 0) return 0;
    let skip = Math.max(0, (this.audio.currentTime - this.piperClock) * this.piperScheduleRate);
    let index = 0;
    while (index < this.piperBuffers.length && index < this.piperParts.length) {
      const duration = this.piperBuffers[index].duration;
      if (duration <= 0) {
        index += 1;
        continue;
      }
      if (skip < duration - 0.05) break;
      skip -= duration;
      index += 1;
    }
    return Math.min(index, Math.max(0, this.piperParts.length - 1));
  }

  private clearSystem() {
    window.clearInterval(this.keepAlive);
    this.keepAlive = 0;
    const synth = window.speechSynthesis;
    if (!synth) return;
    const wasPaused = synth.paused;
    synth.cancel();
    if (wasPaused) synth.resume();
  }

  private haltSources() {
    for (const source of this.sources) {
      try {
        source.onended = null;
        source.stop();
      } catch {
        /* already stopped */
      }
    }
    this.sources = [];
    this.sourceRates.clear();
  }

  private stopSources() {
    this.piperBuffers = [];
    this.piperParts = [];
    this.haltSources();
    if (this.audio?.state === "running") void this.audio.suspend();
  }
}

export const pageSpeech = new PageSpeech();

function voiceSignature(prefs: TtsPrefs, lang: VoiceLang) {
  return `${prefs.engine}|${prefs.piperVoice}|${prefs.kokoroVoice}|${prefs.voiceByLang[lang] || prefs.voiceURI}`;
}

function clamp(value: unknown, min: number, max: number, fallback: number) {
  const number = typeof value === "number" ? value : fallback;
  if (Number.isNaN(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}
