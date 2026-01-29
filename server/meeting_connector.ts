import { getSetting, setSetting } from "./db.js";

export type MeetingStatus = "joining" | "active" | "ended";

export type MeetingState = {
  status: MeetingStatus;
  url: string | null;
  bot_id: string | null;
  bot_name: string | null;
  started_at: string | null;
  ended_at: string | null;
  last_error: string | null;
  updated_at: string;
};

export type MeetingActionResult =
  | { ok: true; meeting: MeetingState }
  | { ok: false; status: number; error: string };

const MEETING_STATUS_KEY = "meeting_status_v1";
const DEFAULT_BOT_NAME = "PCC Agent";
const DEFAULT_AUDIO_FORMAT = "pcm_s16le";

type RecallConfig = {
  apiKey: string;
  authHeader: string;
  authPrefix: string | null;
  extraHeaders: Record<string, string>;
  createUrl: string;
  createBodyTemplate: string;
  leaveUrlTemplate: string | null;
  leaveMethod: string;
  leaveBodyTemplate: string | null;
  statusUrlTemplate: string | null;
  statusMethod: string;
};

type AudioConfig = {
  sampleRate: number;
  channels: number;
  sampleWidth: number;
  frameDurationMs: number;
  format: string;
};

function nowIso(): string {
  return new Date().toISOString();
}

function env(name: string): string | null {
  const raw = process.env[name];
  if (!raw) return null;
  const trimmed = raw.trim();
  return trimmed ? trimmed : null;
}

function parseIntEnv(name: string, fallback: number): number {
  const raw = env(name);
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseJsonHeaders(raw: string): { ok: true; headers: Record<string, string> } | { ok: false; error: string } {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { ok: false, error: "Recall headers JSON must be an object." };
    }
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === "string") {
        out[key] = value;
      }
    }
    return { ok: true, headers: out };
  } catch (err) {
    return {
      ok: false,
      error: `Recall headers JSON parse failed: ${
        err instanceof Error ? err.message : "invalid JSON"
      }`,
    };
  }
}

function normalizeStatus(value: unknown): MeetingStatus {
  if (value === "joining" || value === "active" || value === "ended") {
    return value;
  }
  return "ended";
}

function normalizeString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function normalizeMeetingState(value: unknown): MeetingState {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      status: "ended",
      url: null,
      bot_id: null,
      bot_name: null,
      started_at: null,
      ended_at: null,
      last_error: null,
      updated_at: nowIso(),
    };
  }
  const record = value as Record<string, unknown>;
  return {
    status: normalizeStatus(record.status),
    url: normalizeString(record.url),
    bot_id: normalizeString(record.bot_id),
    bot_name: normalizeString(record.bot_name),
    started_at: normalizeString(record.started_at),
    ended_at: normalizeString(record.ended_at),
    last_error: normalizeString(record.last_error),
    updated_at: normalizeString(record.updated_at) ?? nowIso(),
  };
}

export function getMeetingState(): MeetingState {
  const row = getSetting(MEETING_STATUS_KEY);
  if (!row) return normalizeMeetingState(null);
  try {
    const parsed: unknown = JSON.parse(row.value);
    return normalizeMeetingState(parsed);
  } catch {
    return normalizeMeetingState(null);
  }
}

function saveMeetingState(state: MeetingState): MeetingState {
  const normalized = normalizeMeetingState(state);
  setSetting(MEETING_STATUS_KEY, JSON.stringify(normalized));
  return normalized;
}

function updateMeetingState(patch: Partial<MeetingState>): MeetingState {
  const current = getMeetingState();
  const updated: MeetingState = {
    ...current,
    ...patch,
    status: patch.status ? normalizeStatus(patch.status) : current.status,
    url: patch.url === undefined ? current.url : patch.url,
    bot_id: patch.bot_id === undefined ? current.bot_id : patch.bot_id,
    bot_name: patch.bot_name === undefined ? current.bot_name : patch.bot_name,
    started_at: patch.started_at === undefined ? current.started_at : patch.started_at,
    ended_at: patch.ended_at === undefined ? current.ended_at : patch.ended_at,
    last_error: patch.last_error === undefined ? current.last_error : patch.last_error,
    updated_at: nowIso(),
  };
  return saveMeetingState(updated);
}

function isValidGoogleMeetUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:") return false;
    if (parsed.hostname !== "meet.google.com") return false;
    return parsed.pathname.length > 1;
  } catch {
    return false;
  }
}

function resolveAudioConfig(): AudioConfig {
  return {
    sampleRate: parseIntEnv("VOICE_AUDIO_SAMPLE_RATE", 16000),
    channels: parseIntEnv("VOICE_AUDIO_CHANNELS", 1),
    sampleWidth: parseIntEnv("VOICE_AUDIO_SAMPLE_WIDTH", 2),
    frameDurationMs: parseIntEnv("VOICE_AUDIO_FRAME_MS", 20),
    format: env("VOICE_AUDIO_FORMAT") ?? DEFAULT_AUDIO_FORMAT,
  };
}

function resolveMeetingAudioWsUrl(): string | null {
  const direct = env("CONTROL_CENTER_MEETING_AUDIO_WS_URL");
  if (direct) return direct;
  const fallback = env("VOICE_AGENT_WS_URL");
  if (fallback) return fallback;
  const host = env("VOICE_AGENT_HOST");
  const port = env("VOICE_AGENT_PORT");
  if (!host || !port) return null;
  return `ws://${host}:${port}`;
}

function resolveDefaultBotName(): string {
  return env("CONTROL_CENTER_MEETING_BOT_NAME_DEFAULT") ?? DEFAULT_BOT_NAME;
}

function resolveRecallConfig(): { ok: true; config: RecallConfig } | { ok: false; error: string } {
  const apiKey = env("CONTROL_CENTER_RECALL_API_KEY") ?? env("RECALL_API_KEY");
  if (!apiKey) {
    return { ok: false, error: "Recall API key not configured." };
  }
  const authHeader = env("CONTROL_CENTER_RECALL_API_HEADER");
  if (!authHeader) {
    return { ok: false, error: "Recall API auth header not configured." };
  }
  const createUrl = env("CONTROL_CENTER_RECALL_CREATE_URL");
  if (!createUrl) {
    return { ok: false, error: "Recall create URL not configured." };
  }
  const createBodyTemplate = env("CONTROL_CENTER_RECALL_CREATE_BODY");
  if (!createBodyTemplate) {
    return { ok: false, error: "Recall create body template not configured." };
  }
  let extraHeaders: Record<string, string> = {};
  const rawHeaders = env("CONTROL_CENTER_RECALL_HEADERS_JSON");
  if (rawHeaders) {
    const parsedHeaders = parseJsonHeaders(rawHeaders);
    if (!parsedHeaders.ok) {
      return { ok: false, error: parsedHeaders.error };
    }
    extraHeaders = parsedHeaders.headers;
  }
  return {
    ok: true,
    config: {
      apiKey,
      authHeader,
      authPrefix: env("CONTROL_CENTER_RECALL_API_PREFIX"),
      extraHeaders,
      createUrl,
      createBodyTemplate,
      leaveUrlTemplate: env("CONTROL_CENTER_RECALL_LEAVE_URL"),
      leaveMethod: (env("CONTROL_CENTER_RECALL_LEAVE_METHOD") ?? "POST").toUpperCase(),
      leaveBodyTemplate: env("CONTROL_CENTER_RECALL_LEAVE_BODY"),
      statusUrlTemplate: env("CONTROL_CENTER_RECALL_STATUS_URL"),
      statusMethod: (env("CONTROL_CENTER_RECALL_STATUS_METHOD") ?? "GET").toUpperCase(),
    },
  };
}

function buildRecallHeaders(config: RecallConfig): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  const authValue = config.authPrefix
    ? `${config.authPrefix} ${config.apiKey}`
    : config.apiKey;
  headers[config.authHeader] = authValue;
  for (const [key, value] of Object.entries(config.extraHeaders)) {
    headers[key] = value;
  }
  return headers;
}

function renderTemplate(template: string, values: Record<string, string>): string {
  let output = template;
  for (const [key, value] of Object.entries(values)) {
    output = output.replaceAll(`{${key}}`, value);
  }
  return output;
}

function parseTemplateJson(
  template: string,
  values: Record<string, string>
): { ok: true; body: unknown } | { ok: false; error: string } {
  const rendered = renderTemplate(template, values);
  try {
    const parsed = JSON.parse(rendered) as unknown;
    return { ok: true, body: parsed };
  } catch (err) {
    return {
      ok: false,
      error: `Recall template JSON parse failed: ${
        err instanceof Error ? err.message : "invalid JSON"
      }`,
    };
  }
}

function parseBotId(payload: unknown): string | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const record = payload as Record<string, unknown>;
  const direct =
    normalizeString(record.id) ??
    normalizeString(record.bot_id) ??
    normalizeString(record.botId);
  if (direct) return direct;
  const data = record.data;
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const nested = data as Record<string, unknown>;
    return (
      normalizeString(nested.id) ??
      normalizeString(nested.bot_id) ??
      normalizeString(nested.botId)
    );
  }
  const bot = record.bot;
  if (bot && typeof bot === "object" && !Array.isArray(bot)) {
    const nested = bot as Record<string, unknown>;
    return (
      normalizeString(nested.id) ??
      normalizeString(nested.bot_id) ??
      normalizeString(nested.botId)
    );
  }
  return null;
}

function parseRecallStatus(payload: unknown): MeetingStatus | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const record = payload as Record<string, unknown>;
  const candidates: unknown[] = [record];
  const data = record.data;
  if (data && typeof data === "object" && !Array.isArray(data)) {
    candidates.push(data);
  }
  const bot = record.bot;
  if (bot && typeof bot === "object" && !Array.isArray(bot)) {
    candidates.push(bot);
  }

  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) continue;
    const entry = candidate as Record<string, unknown>;
    const value = normalizeString(entry.status) ?? normalizeString(entry.state);
    if (!value) continue;
    const normalized = value.toLowerCase();
    if (normalized.includes("join")) return "joining";
    if (normalized.includes("active") || normalized.includes("connected")) return "active";
    if (
      normalized.includes("end") ||
      normalized.includes("disconnected") ||
      normalized.includes("failed")
    ) {
      return "ended";
    }
  }
  return null;
}

async function requestRecall(params: {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: unknown;
}): Promise<{ ok: true; payload: unknown } | { ok: false; status: number; error: string }> {
  let response: Response;
  try {
    response = await fetch(params.url, {
      method: params.method,
      headers: params.headers,
      body: params.body !== undefined ? JSON.stringify(params.body) : undefined,
    });
  } catch (err) {
    return {
      ok: false,
      status: 502,
      error: err instanceof Error ? err.message : "Recall request failed.",
    };
  }
  const text = await response.text().catch(() => "");
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text) as unknown;
    } catch {
      payload = text;
    }
  }
  if (!response.ok) {
    let message = `Recall request failed (${response.status}).`;
    if (payload && typeof payload === "object" && !Array.isArray(payload)) {
      const record = payload as Record<string, unknown>;
      const error =
        normalizeString(record.error) ?? normalizeString(record.message) ?? null;
      if (error) message = error;
    } else if (typeof payload === "string" && payload.trim()) {
      message = payload.trim();
    }
    return { ok: false, status: response.status, error: message };
  }
  return { ok: true, payload };
}

export async function joinMeeting(payload: unknown): Promise<MeetingActionResult> {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { ok: false, status: 400, error: "Request body is required." };
  }
  const record = payload as Record<string, unknown>;
  const url = normalizeString(record.url);
  const botName =
    normalizeString(record.bot_name) ??
    normalizeString(record.botName) ??
    null;
  if (!url) return { ok: false, status: 400, error: "`url` is required." };
  if (!isValidGoogleMeetUrl(url)) {
    return { ok: false, status: 400, error: "`url` must be a Google Meet URL." };
  }

  const existing = getMeetingState();
  if (existing.status === "joining" || existing.status === "active") {
    return { ok: false, status: 409, error: "Meeting already in progress." };
  }

  const audioWsUrl = resolveMeetingAudioWsUrl();
  if (!audioWsUrl) {
    return {
      ok: false,
      status: 500,
      error: "Meeting audio WebSocket URL not configured.",
    };
  }
  const recallConfigResult = resolveRecallConfig();
  if (!recallConfigResult.ok) {
    return { ok: false, status: 500, error: recallConfigResult.error };
  }
  const recallConfig = recallConfigResult.config;
  const audio = resolveAudioConfig();
  const resolvedBotName = botName ?? resolveDefaultBotName();
  const templateValues = {
    meeting_url: url,
    bot_name: resolvedBotName,
    audio_ws_url: audioWsUrl,
    audio_sample_rate: String(audio.sampleRate),
    audio_channels: String(audio.channels),
    audio_sample_width: String(audio.sampleWidth),
    audio_frame_ms: String(audio.frameDurationMs),
    audio_format: audio.format,
  };

  const bodyResult = parseTemplateJson(recallConfig.createBodyTemplate, templateValues);
  if (!bodyResult.ok) {
    return { ok: false, status: 500, error: bodyResult.error };
  }

  updateMeetingState({
    status: "joining",
    url,
    bot_name: resolvedBotName,
    bot_id: null,
    started_at: nowIso(),
    ended_at: null,
    last_error: null,
  });

  const recallResponse = await requestRecall({
    url: recallConfig.createUrl,
    method: "POST",
    headers: buildRecallHeaders(recallConfig),
    body: bodyResult.body,
  });

  if (!recallResponse.ok) {
    updateMeetingState({
      status: "ended",
      ended_at: nowIso(),
      last_error: recallResponse.error,
    });
    return {
      ok: false,
      status: recallResponse.status,
      error: recallResponse.error,
    };
  }

  const botId = parseBotId(recallResponse.payload);
  const recallStatus = parseRecallStatus(recallResponse.payload) ?? "active";
  const endedAt = recallStatus === "ended" ? nowIso() : null;
  const updated = updateMeetingState({
    status: recallStatus,
    bot_id: botId,
    ended_at: endedAt,
    last_error: null,
  });
  return { ok: true, meeting: updated };
}

export async function leaveMeeting(): Promise<MeetingActionResult> {
  const current = getMeetingState();
  if (current.status === "ended") {
    return { ok: true, meeting: current };
  }
  const recallConfigResult = resolveRecallConfig();
  if (!recallConfigResult.ok) {
    return { ok: false, status: 500, error: recallConfigResult.error };
  }
  const recallConfig = recallConfigResult.config;
  if (!recallConfig.leaveUrlTemplate) {
    return {
      ok: false,
      status: 500,
      error: "Recall leave URL not configured.",
    };
  }

  const templateValues = {
    meeting_url: current.url ?? "",
    bot_id: current.bot_id ?? "",
    bot_name: current.bot_name ?? "",
  };
  const url = renderTemplate(recallConfig.leaveUrlTemplate, templateValues);
  let body: unknown | undefined;
  if (recallConfig.leaveBodyTemplate) {
    const bodyResult = parseTemplateJson(
      recallConfig.leaveBodyTemplate,
      templateValues
    );
    if (!bodyResult.ok) {
      return { ok: false, status: 500, error: bodyResult.error };
    }
    body = bodyResult.body;
  }

  const recallResponse = await requestRecall({
    url,
    method: recallConfig.leaveMethod,
    headers: buildRecallHeaders(recallConfig),
    body,
  });
  if (!recallResponse.ok) {
    updateMeetingState({ last_error: recallResponse.error });
    return {
      ok: false,
      status: recallResponse.status,
      error: recallResponse.error,
    };
  }

  const updated = updateMeetingState({
    status: "ended",
    ended_at: nowIso(),
    last_error: null,
  });
  return { ok: true, meeting: updated };
}

export async function refreshMeetingStatus(): Promise<MeetingState> {
  const current = getMeetingState();
  if (!current.bot_id || current.status === "ended") return current;
  const recallConfigResult = resolveRecallConfig();
  if (!recallConfigResult.ok) return current;
  const recallConfig = recallConfigResult.config;
  if (!recallConfig.statusUrlTemplate) return current;

  const templateValues = {
    meeting_url: current.url ?? "",
    bot_id: current.bot_id ?? "",
    bot_name: current.bot_name ?? "",
  };
  const url = renderTemplate(recallConfig.statusUrlTemplate, templateValues);
  const recallResponse = await requestRecall({
    url,
    method: recallConfig.statusMethod,
    headers: buildRecallHeaders(recallConfig),
  });
  if (!recallResponse.ok) {
    return updateMeetingState({ last_error: recallResponse.error });
  }
  const recallStatus = parseRecallStatus(recallResponse.payload);
  if (!recallStatus || recallStatus === current.status) return current;
  return updateMeetingState({
    status: recallStatus,
    ended_at: recallStatus === "ended" ? nowIso() : current.ended_at,
    last_error: null,
  });
}
