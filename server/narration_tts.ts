import crypto from "crypto";
import {
  getElevenLabsApiKey,
  getElevenLabsNarrationModelId,
  getElevenLabsNarrationVoiceId,
} from "./config.js";

const MAX_TTS_CHARS = 600;
const AUDIO_CACHE_TTL_MS = 60 * 60 * 1000;
const AUDIO_CACHE_MAX_ENTRIES = 48;
const DEFAULT_MODEL_ID = "eleven_turbo_v2";

type NarrationAudioSuccess = {
  ok: true;
  audio: Buffer;
  contentType: string;
  cached: boolean;
};

type NarrationAudioFailure = {
  ok: false;
  status: number;
  error: string;
  retryAfterMs?: number;
};

export type NarrationAudioResult = NarrationAudioSuccess | NarrationAudioFailure;

type NarrationSpeakPayload = {
  text?: unknown;
};

type AudioCacheEntry = {
  audio: Buffer;
  contentType: string;
  createdAt: number;
};

class NarrationTtsError extends Error {
  status: number;
  retryAfterMs?: number;

  constructor(message: string, status: number, retryAfterMs?: number) {
    super(message);
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

const audioCache = new Map<string, AudioCacheEntry>();
const inFlight = new Map<string, Promise<AudioCacheEntry>>();

function readText(payload: unknown): string | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const { text } = payload as NarrationSpeakPayload;
  if (typeof text !== "string") return null;
  const trimmed = text.trim();
  return trimmed ? trimmed : null;
}

function getVoiceId(): string | null {
  return getElevenLabsNarrationVoiceId();
}

function getApiKey(): string | null {
  return getElevenLabsApiKey();
}

function getModelId(): string {
  return getElevenLabsNarrationModelId() ?? DEFAULT_MODEL_ID;
}

function hashCacheKey(text: string, voiceId: string, modelId: string): string {
  return crypto
    .createHash("sha256")
    .update(`${modelId}:${voiceId}:${text}`)
    .digest("hex");
}

function getCachedAudio(key: string): AudioCacheEntry | null {
  const cached = audioCache.get(key);
  if (!cached) return null;
  if (Date.now() - cached.createdAt > AUDIO_CACHE_TTL_MS) {
    audioCache.delete(key);
    return null;
  }
  audioCache.delete(key);
  audioCache.set(key, cached);
  return cached;
}

function setCachedAudio(key: string, entry: AudioCacheEntry): void {
  if (audioCache.has(key)) {
    audioCache.delete(key);
  }
  audioCache.set(key, entry);
  if (audioCache.size <= AUDIO_CACHE_MAX_ENTRIES) return;
  const oldestKey = audioCache.keys().next().value;
  if (typeof oldestKey === "string") {
    audioCache.delete(oldestKey);
  }
}

function toErrorResult(err: unknown): NarrationAudioFailure {
  if (err instanceof NarrationTtsError) {
    return {
      ok: false,
      status: err.status,
      error: err.message,
      retryAfterMs: err.retryAfterMs,
    };
  }
  return {
    ok: false,
    status: 502,
    error: err instanceof Error ? err.message : "Failed to generate narration audio.",
  };
}

async function requestNarrationAudio(
  text: string,
  voiceId: string,
  modelId: string,
  apiKey: string
): Promise<AudioCacheEntry> {
  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}`,
    {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({ text, model_id: modelId }),
    }
  );

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    const retryAfter = response.headers.get("retry-after");
    const retrySeconds = retryAfter ? Number.parseFloat(retryAfter) : Number.NaN;
    const retryAfterMs =
      Number.isFinite(retrySeconds) && retrySeconds > 0 ? retrySeconds * 1000 : undefined;
    throw new NarrationTtsError(
      `ElevenLabs TTS failed (${response.status}). ${detail}`.trim(),
      response.status,
      retryAfterMs
    );
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  if (!buffer.length) {
    throw new NarrationTtsError("ElevenLabs TTS returned empty audio.", 502);
  }

  return {
    audio: buffer,
    contentType: response.headers.get("content-type") ?? "audio/mpeg",
    createdAt: Date.now(),
  };
}

export async function generateNarrationAudio(
  payload: unknown
): Promise<NarrationAudioResult> {
  const text = readText(payload);
  if (!text) {
    return { ok: false, status: 400, error: "`text` is required" };
  }
  if (text.length > MAX_TTS_CHARS) {
    return {
      ok: false,
      status: 413,
      error: `Narration text exceeds ${MAX_TTS_CHARS} characters.`,
    };
  }

  const voiceId = getVoiceId();
  if (!voiceId) {
    return {
      ok: false,
      status: 500,
      error: "ElevenLabs narration voice ID not configured.",
    };
  }

  const apiKey = getApiKey();
  if (!apiKey) {
    return { ok: false, status: 500, error: "ElevenLabs API key not configured." };
  }

  const modelId = getModelId();
  const cacheKey = hashCacheKey(text, voiceId, modelId);
  const cached = getCachedAudio(cacheKey);
  if (cached) {
    return {
      ok: true,
      audio: cached.audio,
      contentType: cached.contentType,
      cached: true,
    };
  }

  const inFlightRequest = inFlight.get(cacheKey);
  if (inFlightRequest) {
    try {
      const entry = await inFlightRequest;
      return {
        ok: true,
        audio: entry.audio,
        contentType: entry.contentType,
        cached: true,
      };
    } catch (err) {
      return toErrorResult(err);
    }
  }

  const request = requestNarrationAudio(text, voiceId, modelId, apiKey)
    .then((entry) => {
      setCachedAudio(cacheKey, entry);
      return entry;
    })
    .finally(() => {
      inFlight.delete(cacheKey);
    });

  inFlight.set(cacheKey, request);

  try {
    const entry = await request;
    return {
      ok: true,
      audio: entry.audio,
      contentType: entry.contentType,
      cached: false,
    };
  } catch (err) {
    return toErrorResult(err);
  }
}
