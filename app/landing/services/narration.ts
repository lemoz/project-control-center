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
  onStateChange?: (state: NarrationState) => void;
  onUtterance?: (text: string) => void;
};

const DEFAULT_MIN_GAP_MS = 25_000;
const DEFAULT_MAX_GAP_MS = 35_000;

function randomBetween(min: number, max: number): number {
  const safeMin = Math.min(min, max);
  const safeMax = Math.max(min, max);
  return Math.floor(Math.random() * (safeMax - safeMin + 1)) + safeMin;
}

export class NarrationService {
  private state: NarrationState = "disabled";
  private utterance: SpeechSynthesisUtterance | null = null;
  private queue: NarrationRequest[] = [];
  private cooldownTimer: number | null = null;
  private minGapMs: number;
  private maxGapMs: number;
  private onStateChange?: (state: NarrationState) => void;
  private onUtterance?: (text: string) => void;
  private supported: boolean;

  constructor(options: NarrationServiceOptions = {}) {
    this.minGapMs = options.minGapMs ?? DEFAULT_MIN_GAP_MS;
    this.maxGapMs = options.maxGapMs ?? DEFAULT_MAX_GAP_MS;
    this.onStateChange = options.onStateChange;
    this.onUtterance = options.onUtterance;
    this.supported =
      typeof window !== "undefined" &&
      "speechSynthesis" in window &&
      typeof SpeechSynthesisUtterance !== "undefined";
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
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1;
    utterance.onend = () => {
      this.utterance = null;
      this.startCooldown();
    };
    utterance.onerror = () => {
      this.utterance = null;
      this.startCooldown();
    };
    this.utterance = utterance;
    this.setState("speaking");
    this.onUtterance?.(text);
    try {
      window.speechSynthesis.speak(utterance);
    } catch {
      this.utterance = null;
      this.startCooldown();
    }
  }

  private beginMutedSpeak(text: string): void {
    this.onUtterance?.(text);
    this.startCooldown(true);
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
    if (typeof window === "undefined") return;
    if (this.utterance) {
      this.utterance.onend = null;
      this.utterance.onerror = null;
      this.utterance = null;
    }
    if (this.supported) {
      window.speechSynthesis.cancel();
    }
  }
}
