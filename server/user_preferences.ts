import {
  LAST_ESCALATION_AT_KEY,
  getDb,
  getSetting,
  listUserInteractions,
  setSetting,
} from "./db.js";

export type QuietHours = { start: string; end: string };
export type ExplicitPreferences = {
  quiet_hours: QuietHours;
  priority_projects: string[];
  escalation_batch_minutes: number;
};
export type PreferencePatterns = {
  typical_active_hours: QuietHours | null;
  avg_response_time_minutes: number | null;
  preferred_review_time: string | null;
};
export type UserPreferences = ExplicitPreferences & PreferencePatterns;

const SETTINGS_KEY = "global_preferences";
const DEFAULT_QUIET_HOURS: QuietHours = { start: "22:00", end: "08:00" };
const DEFAULT_ESCALATION_BATCH_MINUTES = 60;
const DEFAULT_REVIEW_WINDOW_MINUTES = 60;
const ACTIVE_WINDOW_HOURS = 8;
const INTERACTION_WINDOW_DAYS = 30;
const INTERACTION_SAMPLE_LIMIT = 200;
const MIN_INTERACTIONS = 4;
const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

function defaultExplicitPreferences(): ExplicitPreferences {
  return {
    quiet_hours: DEFAULT_QUIET_HOURS,
    priority_projects: [],
    escalation_batch_minutes: DEFAULT_ESCALATION_BATCH_MINUTES,
  };
}

function isValidTimeString(value: string): boolean {
  return TIME_PATTERN.test(value);
}

function normalizeQuietHours(value: unknown, fallback: QuietHours): QuietHours {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fallback;
  const record = value as Record<string, unknown>;
  const startRaw = typeof record.start === "string" ? record.start.trim() : "";
  const endRaw = typeof record.end === "string" ? record.end.trim() : "";
  if (!isValidTimeString(startRaw) || !isValidTimeString(endRaw)) return fallback;
  return { start: startRaw, end: endRaw };
}

function normalizePriorityProjects(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return fallback;
  const normalized = value
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter((entry) => entry.length > 0);
  return Array.from(new Set(normalized));
}

function normalizeBatchMinutes(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  const rounded = Math.trunc(value);
  return Math.max(0, Math.min(1440, rounded));
}

function normalizeExplicitPreferences(value: unknown): ExplicitPreferences {
  const base = defaultExplicitPreferences();
  if (!value || typeof value !== "object" || Array.isArray(value)) return base;
  const record = value as Record<string, unknown>;
  return {
    quiet_hours: normalizeQuietHours(record.quiet_hours, base.quiet_hours),
    priority_projects: normalizePriorityProjects(
      record.priority_projects,
      base.priority_projects
    ),
    escalation_batch_minutes: normalizeBatchMinutes(
      record.escalation_batch_minutes,
      base.escalation_batch_minutes
    ),
  };
}

export function parsePreferencesPatch(input: unknown):
  | { ok: true; patch: Partial<ExplicitPreferences> }
  | { ok: false; error: string } {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, error: "body must be an object" };
  }
  const record = input as Record<string, unknown>;
  const patch: Partial<ExplicitPreferences> = {};

  if ("quiet_hours" in record) {
    const quiet = record.quiet_hours;
    if (!quiet || typeof quiet !== "object" || Array.isArray(quiet)) {
      return { ok: false, error: "quiet_hours must be an object" };
    }
    const quietRecord = quiet as Record<string, unknown>;
    const startRaw =
      typeof quietRecord.start === "string" ? quietRecord.start.trim() : "";
    const endRaw =
      typeof quietRecord.end === "string" ? quietRecord.end.trim() : "";
    if (!isValidTimeString(startRaw) || !isValidTimeString(endRaw)) {
      return { ok: false, error: "quiet_hours must use HH:MM 24h format" };
    }
    patch.quiet_hours = { start: startRaw, end: endRaw };
  }

  if ("priority_projects" in record) {
    const raw = record.priority_projects;
    if (!Array.isArray(raw)) {
      return { ok: false, error: "priority_projects must be an array" };
    }
    const normalized = raw
      .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
      .filter((entry) => entry.length > 0);
    patch.priority_projects = Array.from(new Set(normalized));
  }

  if ("escalation_batch_minutes" in record) {
    const raw = record.escalation_batch_minutes;
    if (typeof raw !== "number" || !Number.isFinite(raw)) {
      return { ok: false, error: "escalation_batch_minutes must be a number" };
    }
    const rounded = Math.trunc(raw);
    if (rounded < 0 || rounded > 1440) {
      return { ok: false, error: "escalation_batch_minutes out of range" };
    }
    patch.escalation_batch_minutes = rounded;
  }

  return { ok: true, patch };
}

export function getExplicitPreferences(): ExplicitPreferences {
  const row = getSetting(SETTINGS_KEY);
  if (!row) return defaultExplicitPreferences();
  try {
    const parsed: unknown = JSON.parse(row.value);
    return normalizeExplicitPreferences(parsed);
  } catch {
    return defaultExplicitPreferences();
  }
}

export function updateExplicitPreferences(
  patch: Partial<ExplicitPreferences>
): ExplicitPreferences {
  const current = getExplicitPreferences();
  const merged: ExplicitPreferences = {
    quiet_hours: patch.quiet_hours ?? current.quiet_hours,
    priority_projects: patch.priority_projects ?? current.priority_projects,
    escalation_batch_minutes:
      patch.escalation_batch_minutes ?? current.escalation_batch_minutes,
  };
  const normalized = normalizeExplicitPreferences(merged);
  setSetting(SETTINGS_KEY, JSON.stringify(normalized));
  return normalized;
}

function parseTimestamp(value: string | null): Date | null {
  if (!value) return null;
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms);
}

function formatHour(hour: number): string {
  const normalized = ((hour % 24) + 24) % 24;
  return `${String(normalized).padStart(2, "0")}:00`;
}

function computeTypicalActiveHours(events: Array<{ created_at: string }>): QuietHours | null {
  if (events.length < MIN_INTERACTIONS) return null;
  const counts = Array.from({ length: 24 }, () => 0);
  let total = 0;
  for (const event of events) {
    const parsed = parseTimestamp(event.created_at);
    if (!parsed) continue;
    counts[parsed.getHours()] += 1;
    total += 1;
  }
  if (total < MIN_INTERACTIONS) return null;
  const window = Math.max(1, Math.min(24, ACTIVE_WINDOW_HOURS));
  let bestStart = 0;
  let bestTotal = -1;
  for (let start = 0; start < 24; start += 1) {
    let sum = 0;
    for (let offset = 0; offset < window; offset += 1) {
      sum += counts[(start + offset) % 24];
    }
    if (sum > bestTotal) {
      bestTotal = sum;
      bestStart = start;
    }
  }
  return {
    start: formatHour(bestStart),
    end: formatHour(bestStart + window),
  };
}

function computePreferredReviewTime(): string | null {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT finished_at, created_at
       FROM runs
       WHERE status = 'merged'
       ORDER BY COALESCE(finished_at, created_at) DESC
       LIMIT 200`
    )
    .all() as Array<{ finished_at: string | null; created_at: string }>;
  if (!rows.length) return null;
  const counts = Array.from({ length: 24 }, () => 0);
  for (const row of rows) {
    const parsed = parseTimestamp(row.finished_at ?? row.created_at);
    if (!parsed) continue;
    counts[parsed.getHours()] += 1;
  }
  let bestHour = -1;
  let bestCount = 0;
  for (let hour = 0; hour < 24; hour += 1) {
    if (counts[hour] > bestCount) {
      bestCount = counts[hour];
      bestHour = hour;
    }
  }
  if (bestHour < 0 || bestCount === 0) return null;
  return formatHour(bestHour);
}

type EscalationRecord = { created_at?: unknown; resolved_at?: unknown };

function parseRunEscalation(raw: string): { createdAt: string; resolvedAt: string } | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const record = parsed as EscalationRecord;
  const createdAt = typeof record.created_at === "string" ? record.created_at : "";
  const resolvedAt = typeof record.resolved_at === "string" ? record.resolved_at : "";
  if (!createdAt || !resolvedAt) return null;
  return { createdAt, resolvedAt };
}

function diffMinutes(start: string, end: string): number | null {
  const startMs = Date.parse(start);
  const endMs = Date.parse(end);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return null;
  const diff = (endMs - startMs) / 60000;
  if (!Number.isFinite(diff) || diff < 0) return null;
  return diff;
}

function computeAverageResponseMinutes(): number | null {
  const db = getDb();
  const durations: number[] = [];

  const runRows = db
    .prepare(
      `SELECT escalation
       FROM runs
       WHERE escalation IS NOT NULL
       ORDER BY created_at DESC
       LIMIT 200`
    )
    .all() as Array<{ escalation: string | null }>;

  for (const row of runRows) {
    if (!row.escalation) continue;
    const record = parseRunEscalation(row.escalation);
    if (!record) continue;
    const minutes = diffMinutes(record.createdAt, record.resolvedAt);
    if (minutes === null) continue;
    durations.push(minutes);
  }

  const escalationRows = db
    .prepare(
      `SELECT created_at, resolved_at
       FROM escalations
       WHERE resolved_at IS NOT NULL
       ORDER BY resolved_at DESC
       LIMIT 200`
    )
    .all() as Array<{ created_at: string; resolved_at: string }>;

  for (const row of escalationRows) {
    const minutes = diffMinutes(row.created_at, row.resolved_at);
    if (minutes === null) continue;
    durations.push(minutes);
  }

  if (durations.length === 0) return null;
  const average = durations.reduce((sum, value) => sum + value, 0) / durations.length;
  return Math.round(average);
}

export function getPreferencePatterns(): PreferencePatterns {
  const now = new Date();
  const since = new Date(now.getTime() - INTERACTION_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const events = listUserInteractions({
    since: since.toISOString(),
    limit: INTERACTION_SAMPLE_LIMIT,
  });
  return {
    typical_active_hours: computeTypicalActiveHours(events),
    avg_response_time_minutes: computeAverageResponseMinutes(),
    preferred_review_time: computePreferredReviewTime(),
  };
}

export function getUserPreferences(): UserPreferences {
  const explicit = getExplicitPreferences();
  const patterns = getPreferencePatterns();
  return {
    ...explicit,
    ...patterns,
  };
}

export function isWithinQuietHours(quietHours: QuietHours, now: Date): boolean {
  const start = timeToMinutes(quietHours.start);
  const end = timeToMinutes(quietHours.end);
  if (start === null || end === null || start === end) return false;
  const current = now.getHours() * 60 + now.getMinutes();
  if (start < end) {
    return current >= start && current < end;
  }
  return current >= start || current < end;
}

export function minutesUntilQuietEnd(quietHours: QuietHours, now: Date): number {
  if (!isWithinQuietHours(quietHours, now)) return 0;
  const start = timeToMinutes(quietHours.start);
  const end = timeToMinutes(quietHours.end);
  if (start === null || end === null) return 0;
  const current = now.getHours() * 60 + now.getMinutes();
  if (start < end) {
    return Math.max(0, end - current);
  }
  if (current >= start) {
    return Math.max(0, 1440 - current + end);
  }
  return Math.max(0, end - current);
}

function timeToMinutes(value: string): number | null {
  if (!isValidTimeString(value)) return null;
  const [hours, minutes] = value.split(":").map((part) => Number(part));
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  return hours * 60 + minutes;
}

export function getPreferredReviewDeferral(params: {
  preferredReviewTime: string | null;
  now?: Date;
  windowMinutes?: number;
}): { reason: "preferred_review_time"; retry_after_minutes: number } | null {
  const preferred = params.preferredReviewTime;
  if (!preferred) return null;
  const preferredMinutes = timeToMinutes(preferred);
  if (preferredMinutes === null) return null;

  const now = params.now ?? new Date();
  const windowMinutes =
    typeof params.windowMinutes === "number" && Number.isFinite(params.windowMinutes)
      ? Math.max(1, Math.min(1440, Math.trunc(params.windowMinutes)))
      : DEFAULT_REVIEW_WINDOW_MINUTES;
  if (windowMinutes >= 1440) return null;

  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const windowEnd = (preferredMinutes + windowMinutes) % 1440;
  const wraps = preferredMinutes + windowMinutes >= 1440;
  const within = wraps
    ? currentMinutes >= preferredMinutes || currentMinutes < windowEnd
    : currentMinutes >= preferredMinutes && currentMinutes < windowEnd;
  if (within) return null;

  const minutesUntil =
    currentMinutes < preferredMinutes
      ? preferredMinutes - currentMinutes
      : 1440 - currentMinutes + preferredMinutes;

  return {
    reason: "preferred_review_time",
    retry_after_minutes: Math.max(1, minutesUntil),
  };
}

export function getLastGlobalReportAt(): string | null {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT m.created_at AS created_at
       FROM chat_messages m
       JOIN chat_threads t ON t.id = m.thread_id
       WHERE t.scope = 'global'
         AND m.role = 'assistant'
         AND m.needs_user_input = 1
       ORDER BY m.created_at DESC
       LIMIT 1`
    )
    .get() as { created_at: string } | undefined;
  return row?.created_at ?? null;
}

export function getLastEscalationAt(): string | null {
  const stored = getSetting(LAST_ESCALATION_AT_KEY);
  if (stored?.value) {
    const parsed = Date.parse(stored.value);
    if (Number.isFinite(parsed)) return stored.value;
  }
  const db = getDb();
  const row = db
    .prepare(
      `SELECT created_at
       FROM escalations
       WHERE status = 'escalated_to_user'
       ORDER BY created_at DESC
       LIMIT 1`
    )
    .get() as { created_at: string } | undefined;
  return row?.created_at ?? null;
}

export function getEscalationDeferral(params: {
  preferences: ExplicitPreferences;
  lastEscalationAt: string | null;
  now?: Date;
}): { reason: "quiet_hours" | "batch_window"; retry_after_minutes: number } | null {
  const now = params.now ?? new Date();
  if (isWithinQuietHours(params.preferences.quiet_hours, now)) {
    const wait = minutesUntilQuietEnd(params.preferences.quiet_hours, now);
    return { reason: "quiet_hours", retry_after_minutes: Math.max(1, wait) };
  }
  const batchMinutes = params.preferences.escalation_batch_minutes;
  if (batchMinutes <= 0) return null;
  if (!params.lastEscalationAt) return null;
  const lastMs = Date.parse(params.lastEscalationAt);
  if (!Number.isFinite(lastMs)) return null;
  const diffMinutes = (now.getTime() - lastMs) / 60000;
  if (diffMinutes < batchMinutes) {
    return {
      reason: "batch_window",
      retry_after_minutes: Math.max(1, Math.ceil(batchMinutes - diffMinutes)),
    };
  }
  return null;
}
