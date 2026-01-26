"use client";

export type NarrationState = "idle" | "speaking" | "cooldown" | "muted" | "disabled";
export type NarrationPriority = "high" | "normal";

type NarrationRequest = {
  text: string;
  priority: NarrationPriority;
};

type NarrationServiceOptions = {
  minGapMs?: number;
  maxGapMs?: number;
  ttsEndpoint?: string;
  ttsTimeoutMs?: number;
  onStateChange?: (state: NarrationState) => void;
  onUtterance?: (text: string) => void;
};

const DEFAULT_MIN_GAP_MS = 25_000;
const DEFAULT_MAX_GAP_MS = 35_000;
const DEFAULT_TTS_ENDPOINT = "/api/narration/speak";
const DEFAULT_TTS_TIMEOUT_MS = 12_000;

function randomBetween(min: number, max: number): number {
  const safeMin = Math.min(min, max);
  const safeMax = Math.max(min, max);
  return Math.floor(Math.random() * (safeMax - safeMin + 1)) + safeMin;
}

export class NarrationService {
  private state: NarrationState = "disabled";
  private utterance: SpeechSynthesisUtterance | null = null;
  private audio: HTMLAudioElement | null = null;
  private audioUrl: string | null = null;
  private audioController: AbortController | null = null;
  private queue: NarrationRequest[] = [];
  private cooldownTimer: number | null = null;
  private minGapMs: number;
  private maxGapMs: number;
  private ttsEndpoint: string;
  private ttsTimeoutMs: number;
  private onStateChange?: (state: NarrationState) => void;
  private onUtterance?: (text: string) => void;
  private audioSupported: boolean;
  private fallbackSupported: boolean;
  private supported: boolean;
  private speakSessionId = 0;

  constructor(options: NarrationServiceOptions = {}) {
    this.minGapMs = options.minGapMs ?? DEFAULT_MIN_GAP_MS;
    this.maxGapMs = options.maxGapMs ?? DEFAULT_MAX_GAP_MS;
    this.ttsEndpoint = options.ttsEndpoint ?? DEFAULT_TTS_ENDPOINT;
    this.ttsTimeoutMs = options.ttsTimeoutMs ?? DEFAULT_TTS_TIMEOUT_MS;
    this.onStateChange = options.onStateChange;
    this.onUtterance = options.onUtterance;
    this.audioSupported = typeof window !== "undefined" && typeof Audio !== "undefined";
    this.fallbackSupported =
      typeof window !== "undefined" &&
      "speechSynthesis" in window &&
      typeof SpeechSynthesisUtterance !== "undefined";
    this.supported = this.audioSupported || this.fallbackSupported;
  }

  isSupported(): boolean {
    return this.supported;
  }

  getState(): NarrationState {
    return this.state;
  }

  enable(): void {
    if (!this.supported) {
      this.setState("disabled");
      return;
    }
    if (this.state === "disabled") {
      this.setState("idle");
      this.drainQueue();
    }
  }

  disable(): void {
    this.clearQueue();
    this.stopSpeech();
    this.clearCooldown();
    this.setState("disabled");
  }

  mute(): void {
    const wasSpeaking = this.state === "speaking";
    this.stopSpeech();
    this.setState("muted");
    if (wasSpeaking) {
      this.startCooldown(true);
      return;
    }
    if (this.cooldownTimer) return;
    this.drainQueue();
  }

  unmute(): void {
    if (!this.supported) {
      this.setState("disabled");
      return;
    }
    if (this.state === "muted") {
      if (this.cooldownTimer) {
        this.setState("cooldown");
        return;
      }
      this.setState("idle");
      this.drainQueue();
    }
  }

  speak(text: string, priority: NarrationPriority = "normal"): boolean {
    if (!this.supported) {
      this.setState("disabled");
      return false;
    }
    if (this.state === "disabled") return false;
    const trimmed = text.trim();
    if (!trimmed) return false;
    if (priority === "high") {
      this.queue = this.queue.filter((item) => item.priority === "high");
    }
    this.queue.push({ text: trimmed, priority });
    this.drainQueue();
    return true;
  }

  destroy(): void {
    this.clearQueue();
    this.stopSpeech();
    this.clearCooldown();
    this.onStateChange = undefined;
    this.onUtterance = undefined;
  }

  private setState(next: NarrationState): void {
    if (this.state === next) return;
    this.state = next;
    this.onStateChange?.(next);
  }

  private drainQueue(): void {
    if (this.state === "muted") {
      if (this.cooldownTimer) return;
    } else if (this.state !== "idle") {
      return;
    }
    const next = this.queue.shift();
    if (!next) return;
    if (this.state === "muted") {
      this.beginMutedSpeak(next.text);
      return;
    }
    this.beginSpeak(next.text);
  }

  private beginSpeak(text: string): void {
    if (!this.supported || typeof window === "undefined") return;
    const sessionId = this.beginSession();
    this.setState("speaking");
    this.onUtterance?.(text);
    if (!this.audioSupported) {
      if (!this.beginFallbackSpeak(text, sessionId)) {
        this.startCooldown();
      }
      return;
    }
    void this.fetchAndPlay(text, sessionId);
  }

  private beginMutedSpeak(text: string): void {
    this.onUtterance?.(text);
    this.startCooldown(true);
  }

  private beginFallbackSpeak(text: string, sessionId: number): boolean {
    if (!this.fallbackSupported || typeof window === "undefined") return false;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1;
    utterance.onend = () => {
      if (!this.isActiveSession(sessionId)) return;
      this.utterance = null;
      this.startCooldown();
    };
    utterance.onerror = () => {
      if (!this.isActiveSession(sessionId)) return;
      this.utterance = null;
      this.startCooldown();
    };
    this.utterance = utterance;
    try {
      window.speechSynthesis.speak(utterance);
      return true;
    } catch {
      this.utterance = null;
      return false;
    }
  }

  private async fetchAndPlay(text: string, sessionId: number): Promise<void> {
    if (typeof window === "undefined") return;
    this.abortAudioFetch();
    const controller = new AbortController();
    this.audioController = controller;
    const timeoutId =
      this.ttsTimeoutMs > 0
        ? window.setTimeout(() => controller.abort(), this.ttsTimeoutMs)
        : null;

    try {
      const res = await fetch(this.ttsEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
        signal: controller.signal,
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new Error(`Narration TTS failed (${res.status}). ${detail}`.trim());
      }
      const blob = await res.blob();
      if (!this.isActiveSession(sessionId)) return;
      this.playAudio(text, blob, sessionId);
    } catch {
      if (!this.isActiveSession(sessionId)) return;
      if (!this.beginFallbackSpeak(text, sessionId)) {
        this.startCooldown();
      }
    } finally {
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
      if (this.audioController === controller) {
        this.audioController = null;
      }
    }
  }

  private playAudio(text: string, blob: Blob, sessionId: number): void {
    if (!this.isActiveSession(sessionId) || typeof window === "undefined") return;
    this.clearAudio();
    const url = URL.createObjectURL(blob);
    this.audioUrl = url;
    const audio = new Audio(url);
    this.audio = audio;
    audio.onended = () => {
      if (!this.isActiveSession(sessionId)) return;
      this.clearAudio();
      this.startCooldown();
    };
    audio.onerror = () => {
      if (!this.isActiveSession(sessionId)) return;
      this.clearAudio();
      if (!this.beginFallbackSpeak(text, sessionId)) {
        this.startCooldown();
      }
    };
    const playPromise = audio.play();
    if (playPromise && typeof playPromise.catch === "function") {
      playPromise.catch(() => {
        if (!this.isActiveSession(sessionId)) return;
        this.clearAudio();
        if (!this.beginFallbackSpeak(text, sessionId)) {
          this.startCooldown();
        }
      });
    }
  }

  private beginSession(): number {
    this.speakSessionId += 1;
    return this.speakSessionId;
  }

  private isActiveSession(sessionId: number): boolean {
    return this.speakSessionId === sessionId;
  }

  private abortAudioFetch(): void {
    if (!this.audioController) return;
    this.audioController.abort();
    this.audioController = null;
  }

  private clearAudio(): void {
    if (this.audio) {
      this.audio.onended = null;
      this.audio.onerror = null;
      this.audio.pause();
      this.audio.src = "";
      this.audio = null;
    }
    if (this.audioUrl && typeof window !== "undefined") {
      URL.revokeObjectURL(this.audioUrl);
      this.audioUrl = null;
    }
  }

  private startCooldown(preserveState = false): void {
    this.clearCooldown();
    if (typeof window === "undefined") return;
    const gap = randomBetween(this.minGapMs, this.maxGapMs);
    if (!preserveState) {
      this.setState("cooldown");
    }
    this.cooldownTimer = window.setTimeout(() => {
      this.cooldownTimer = null;
      if (this.state === "disabled") return;
      if (this.state === "muted") {
        this.drainQueue();
        return;
      }
      this.setState("idle");
      this.drainQueue();
    }, gap);
  }

  private clearCooldown(): void {
    if (this.cooldownTimer === null || typeof window === "undefined") return;
    window.clearTimeout(this.cooldownTimer);
    this.cooldownTimer = null;
  }

  private clearQueue(): void {
    this.queue = [];
  }

  private stopSpeech(): void {
    this.speakSessionId += 1;
    this.abortAudioFetch();
    this.clearAudio();
    if (typeof window === "undefined") return;
    if (this.utterance) {
      this.utterance.onend = null;
      this.utterance.onerror = null;
      this.utterance = null;
    }
    if (this.fallbackSupported) {
      window.speechSynthesis.cancel();
    }
  }
}
