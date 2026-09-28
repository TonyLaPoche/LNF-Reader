/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

declare module "piper-tts-web" {
  export class PiperWebEngine {
    constructor(options?: object);
    generate(text: string, voice: string, speaker?: number): Promise<{ file: Blob }>;
  }
  export class OnnxWebRuntime {
    constructor(options?: { basePath?: string; numThreads?: number });
  }
  export class PhonemizeWebRuntime {
    constructor(options?: { basePath?: string });
  }
  export class HuggingFaceVoiceProvider {
    constructor(options?: { provider?: { fetch(url: string): Promise<unknown>; destroy(): void } });
  }
}
