import { execFile } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";

export type MacConnectorState = {
  status: "ready" | "degraded" | "unavailable";
  permissions: {
    full_disk_access: boolean;
    contacts: boolean;
    calendar: boolean;
  };
  rate_limit: {
    messages_per_minute: number;
    minimum_delay_ms: number;
    last_send_at: string | null;
    sends_this_minute: number;
  };
  last_error: string | null;
  updated_at: string;
};

export type MacActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; error: string };

export type MacMessage = {
  id: string;
  handle_id: string;
  text: string;
  is_from_me: boolean;
  date: string;
  service: "iMessage" | "SMS";
  chat_id: string | null;
};

export type MacContact = {
  name: string;
  phones: Array<{ label: string; value: string }>;
  emails: Array<{ label: string; value: string }>;
};

export type MacCalendarEvent = {
  title: string;
  start: string;
  end: string;
  location: string | null;
  notes: string | null;
  calendar: string;
};

type MacSendResult = {
  recipient: string;
  message: string;
  sent_at: string;
};

type MessageDateScale = "seconds" | "nanoseconds";

const APPLE_EPOCH_OFFSET_SECONDS = 978307200;
const DEFAULT_MESSAGES_PER_MINUTE = 10;
const DEFAULT_MIN_DELAY_MS = 1000;
const DEFAULT_MESSAGES_LIMIT = 50;
const MAX_MESSAGES_LIMIT = 200;
const DEFAULT_CALENDAR_DAYS = 7;
const MAX_CALENDAR_DAYS = 365;

const APPLE_SCRIPT_JSON_HELPERS = String.raw`
on replace_text(find_text, replace_text, subject_text)
  set AppleScript's text item delimiters to find_text
  set text_items to every text item of subject_text
  set AppleScript's text item delimiters to replace_text
  set subject_text to text_items as text
  set AppleScript's text item delimiters to ""
  return subject_text
end replace_text

on json_escape(value)
  set value to value as text
  set value to my replace_text("\\", "\\\\", value)
  set value to my replace_text("\"", "\\\"", value)
  set value to my replace_text(return, "\\r", value)
  set value to my replace_text(linefeed, "\\n", value)
  return value
end json_escape

on join_items(the_list, delimiter)
  set AppleScript's text item delimiters to delimiter
  set joined to the_list as text
  set AppleScript's text item delimiters to ""
  return joined
end join_items
`;

const messagesPerMinute = Math.max(
  1,
  parseIntEnv("CONTROL_CENTER_MAC_MESSAGES_PER_MINUTE", DEFAULT_MESSAGES_PER_MINUTE)
);
const minimumDelayMs = Math.max(
  0,
  parseIntEnv("CONTROL_CENTER_MAC_MESSAGES_MIN_DELAY_MS", DEFAULT_MIN_DELAY_MS)
);

let rateLimitWindowStartedAt = Date.now();

let state: MacConnectorState = {
  status: "unavailable",
  permissions: {
    full_disk_access: false,
    contacts: false,
    calendar: false,
  },
  rate_limit: {
    messages_per_minute: messagesPerMinute,
    minimum_delay_ms: minimumDelayMs,
    last_send_at: null,
    sends_this_minute: 0,
  },
  last_error: null,
  updated_at: nowIso(),
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

function normalizeString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function snapshotState(): MacConnectorState {
  return {
    ...state,
    permissions: { ...state.permissions },
    rate_limit: { ...state.rate_limit },
  };
}

function computeStatus(
  permissions: MacConnectorState["permissions"],
  lastError: string | null
): MacConnectorState["status"] {
  const values = Object.values(permissions);
  if (values.every(Boolean) && !lastError) return "ready";
  if (values.some(Boolean) || lastError) return "degraded";
  return "unavailable";
}

function updateState(params: {
  permissions?: Partial<MacConnectorState["permissions"]>;
  rateLimit?: Partial<MacConnectorState["rate_limit"]>;
  lastError?: string | null;
}): void {
  const permissions = params.permissions
    ? { ...state.permissions, ...params.permissions }
    : state.permissions;
  const rateLimit = params.rateLimit
    ? { ...state.rate_limit, ...params.rateLimit }
    : state.rate_limit;
  const lastError = params.lastError !== undefined ? params.lastError : state.last_error;
  state = {
    ...state,
    permissions,
    rate_limit: rateLimit,
    last_error: lastError,
    status: computeStatus(permissions, lastError),
    updated_at: nowIso(),
  };
}

function resetRateLimitWindow(now: number): void {
  if (now - rateLimitWindowStartedAt < 60_000) return;
  rateLimitWindowStartedAt = now;
  updateState({ rateLimit: { sends_this_minute: 0 } });
}

function checkRateLimit(now: number): MacActionResult<null> {
  resetRateLimitWindow(now);
  const lastSendAt = state.rate_limit.last_send_at
    ? Date.parse(state.rate_limit.last_send_at)
    : NaN;
  if (Number.isFinite(lastSendAt)) {
    const elapsed = now - lastSendAt;
    if (elapsed < state.rate_limit.minimum_delay_ms) {
      const retryAfterMs = state.rate_limit.minimum_delay_ms - elapsed;
      return {
        ok: false,
        status: 429,
        error: `Rate limit: wait ${Math.ceil(retryAfterMs)}ms before sending again.`,
      };
    }
  }
  if (state.rate_limit.sends_this_minute >= state.rate_limit.messages_per_minute) {
    return {
      ok: false,
      status: 429,
      error: `Rate limit: exceeded ${state.rate_limit.messages_per_minute} messages/minute.`,
    };
  }
  return { ok: true, data: null };
}

function recordSend(now: number): void {
  updateState({
    rateLimit: {
      last_send_at: new Date(now).toISOString(),
      sends_this_minute: state.rate_limit.sends_this_minute + 1,
    },
    lastError: null,
  });
}

function resolveChatDbPath(): string {
  return env("CONTROL_CENTER_MAC_CHAT_DB_PATH") ?? path.join(os.homedir(), "Library", "Messages", "chat.db");
}

function buildFullDiskAccessError(details?: string): string {
  const suffix = details ? ` (${details})` : "";
  return `Full Disk Access required to read chat.db${suffix}. Grant access in System Settings > Privacy & Security > Full Disk Access.`;
}

function mapFsAccessError(
  err: unknown,
  dbPath: string
): { status: number; error: string; permissionDenied: boolean } {
  const code =
    err && typeof err === "object" && "code" in err
      ? String((err as { code: unknown }).code)
      : "";
  if (code === "EACCES" || code === "EPERM") {
    return { status: 403, error: buildFullDiskAccessError(), permissionDenied: true };
  }
  if (code === "ENOENT") {
    return { status: 404, error: `Messages database not found at ${dbPath}.`, permissionDenied: false };
  }
  return {
    status: 500,
    error: `Unable to access ${dbPath}.`,
    permissionDenied: false,
  };
}

function mapChatDbError(err: unknown): { status: number; error: string; permissionDenied: boolean } {
  const message = err instanceof Error ? err.message : String(err);
  const normalized = message.toLowerCase();
  if (normalized.includes("permission") || normalized.includes("not permitted")) {
    return { status: 403, error: buildFullDiskAccessError(message), permissionDenied: true };
  }
  if (normalized.includes("no such table") || normalized.includes("no such column")) {
    return {
      status: 500,
      error:
        "chat.db schema mismatch; update the query or fall back to AppleScript read.",
      permissionDenied: false,
    };
  }
  if (
    normalized.includes("unable to open database file") ||
    (normalized.includes("sqlite") && normalized.includes("cantopen"))
  ) {
    return { status: 403, error: buildFullDiskAccessError(message), permissionDenied: true };
  }
  return { status: 500, error: message || "Failed to read chat.db.", permissionDenied: false };
}

function openChatDb(): { ok: true; db: Database.Database } | { ok: false; status: number; error: string; permissionDenied: boolean } {
  const dbPath = resolveChatDbPath();
  try {
    fs.accessSync(dbPath, fs.constants.R_OK);
  } catch (err) {
    const mapped = mapFsAccessError(err, dbPath);
    return { ok: false, status: mapped.status, error: mapped.error, permissionDenied: mapped.permissionDenied };
  }
  try {
    const db = new Database(dbPath, { readonly: true, fileMustExist: true });
    return { ok: true, db };
  } catch (err) {
    const mapped = mapChatDbError(err);
    return { ok: false, status: mapped.status, error: mapped.error, permissionDenied: mapped.permissionDenied };
  }
}

function resolveMessageDateScale(db: Database.Database): MessageDateScale {
  try {
    const row = db
      .prepare("SELECT date FROM message ORDER BY date DESC LIMIT 1")
      .get() as { date: number | null } | undefined;
    if (row && typeof row.date === "number" && row.date > 1_000_000_000_000) {
      return "nanoseconds";
    }
  } catch {
    return "seconds";
  }
  return "seconds";
}

function toAppleEpochValue(dateMs: number, scale: MessageDateScale): number {
  const unixSeconds = Math.floor(dateMs / 1000);
  const appleSeconds = unixSeconds - APPLE_EPOCH_OFFSET_SECONDS;
  return scale === "nanoseconds" ? appleSeconds * 1_000_000_000 : appleSeconds;
}

function appleDateToIso(value: number | null, scale: MessageDateScale): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return new Date(0).toISOString();
  }
  const seconds = scale === "nanoseconds" ? value / 1_000_000_000 : value;
  const unixSeconds = seconds + APPLE_EPOCH_OFFSET_SECONDS;
  return new Date(unixSeconds * 1000).toISOString();
}

function normalizeService(value: string | null): "iMessage" | "SMS" {
  if (value && value.toLowerCase().includes("sms")) return "SMS";
  return "iMessage";
}

function escapeAppleScriptString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
}

function normalizeRecipient(value: string): { ok: true; recipient: string } | { ok: false; error: string } {
  const trimmed = value.trim();
  if (!trimmed) {
    return { ok: false, error: "`recipient` is required." };
  }
  if (trimmed.includes("@")) {
    return { ok: true, recipient: trimmed };
  }
  const digits = trimmed.replace(/[^\d]/g, "");
  if (digits.length === 10 || (digits.length === 11 && digits.startsWith("1"))) {
    return { ok: true, recipient: digits };
  }
  return {
    ok: false,
    error: "`recipient` must be an email or a 10/11 digit phone number.",
  };
}

function parseMessagesQuery(query: unknown): { ok: true; handle: string; limit: number; since: number | null } | { ok: false; status: number; error: string } {
  if (!query || typeof query !== "object" || Array.isArray(query)) {
    return { ok: false, status: 400, error: "`handle` is required." };
  }
  const record = query as Record<string, unknown>;
  const handle = normalizeString(record.handle);
  if (!handle) return { ok: false, status: 400, error: "`handle` is required." };
  const limitRaw =
    typeof record.limit === "string"
      ? Number.parseInt(record.limit, 10)
      : typeof record.limit === "number"
        ? record.limit
        : NaN;
  const limit = Number.isFinite(limitRaw)
    ? Math.max(1, Math.min(MAX_MESSAGES_LIMIT, Math.trunc(limitRaw)))
    : DEFAULT_MESSAGES_LIMIT;
  const sinceRaw = typeof record.since === "string" ? record.since.trim() : "";
  if (!sinceRaw) {
    return { ok: true, handle, limit, since: null };
  }
  const sinceMs = Date.parse(sinceRaw);
  if (!Number.isFinite(sinceMs)) {
    return { ok: false, status: 400, error: "`since` must be an ISO timestamp." };
  }
  return { ok: true, handle, limit, since: sinceMs };
}

function mapAppleScriptError(
  message: string,
  permissionHint: string
): { status: number; error: string; permissionDenied: boolean } {
  const normalized = message.toLowerCase();
  if (
    normalized.includes("not authorized to send apple events") ||
    normalized.includes("not authorised to send apple events") ||
    normalized.includes("not authorized") ||
    normalized.includes("not authorised")
  ) {
    return {
      status: 403,
      error: `${permissionHint} ${message}`.trim(),
      permissionDenied: true,
    };
  }
  return { status: 500, error: message, permissionDenied: false };
}

function execAppleScript(
  script: string
): Promise<{ ok: true; stdout: string } | { ok: false; error: string }> {
  return new Promise((resolve) => {
    execFile(
      "osascript",
      ["-e", script],
      { maxBuffer: 5 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          const trimmed = stderr.trim() || error.message || "AppleScript execution failed.";
          resolve({ ok: false, error: trimmed });
          return;
        }
        resolve({ ok: true, stdout: stdout.trim() });
      }
    );
  });
}

function buildSendScript(recipient: string, message: string): string {
  const escapedRecipient = escapeAppleScriptString(recipient);
  const escapedMessage = escapeAppleScriptString(message);
  return `
tell application "Messages"
  set targetService to 1st account whose service type = iMessage
  set targetBuddy to participant "${escapedRecipient}" of targetService
  send "${escapedMessage}" to targetBuddy
end tell
`.trim();
}

function buildContactsScript(): string {
  return `
${APPLE_SCRIPT_JSON_HELPERS}
tell application "Contacts"
  set contact_items to {}
  repeat with p in people
    set contact_name to name of p as text
    set phone_items to {}
    repeat with ph in phones of p
      set phone_label to ""
      set phone_value to ""
      try
        set phone_label to label of ph as text
      end try
      try
        set phone_value to value of ph as text
      end try
      set phone_json to "{\"label\":\"" & my json_escape(phone_label) & "\",\"value\":\"" & my json_escape(phone_value) & "\"}"
      copy phone_json to end of phone_items
    end repeat
    set email_items to {}
    repeat with em in emails of p
      set email_label to ""
      set email_value to ""
      try
        set email_label to label of em as text
      end try
      try
        set email_value to value of em as text
      end try
      set email_json to "{\"label\":\"" & my json_escape(email_label) & "\",\"value\":\"" & my json_escape(email_value) & "\"}"
      copy email_json to end of email_items
    end repeat
    set phones_json to "[" & my join_items(phone_items, ",") & "]"
    set emails_json to "[" & my join_items(email_items, ",") & "]"
    set contact_json to "{\"name\":\"" & my json_escape(contact_name) & "\",\"phones\":" & phones_json & ",\"emails\":" & emails_json & "}"
    copy contact_json to end of contact_items
  end repeat
end tell
set output to "[" & my join_items(contact_items, ",") & "]"
return output
`.trim();
}

function buildCalendarScript(days: number): string {
  const safeDays = Math.max(1, Math.min(MAX_CALENDAR_DAYS, Math.trunc(days)));
  return `
${APPLE_SCRIPT_JSON_HELPERS}
set epoch_start to date "Thursday, January 1, 1970 at 12:00:00 AM"
set day_span to ${safeDays}
set startDate to current date
set endDate to startDate + (day_span * days)
set event_items to {}
tell application "Calendar"
  repeat with cal in calendars
    set cal_name to name of cal as text
    set cal_events to (events of cal whose start date >= startDate and start date <= endDate)
    repeat with evt in cal_events
      set event_title to summary of evt as text
      set event_start to (start date of evt) - epoch_start
      set event_end to (end date of evt) - epoch_start
      set event_location to ""
      try
        set event_location to location of evt as text
      end try
      set event_notes to ""
      try
        set event_notes to description of evt as text
      end try
      if event_location is "" then
        set location_json to "null"
      else
        set location_json to "\"" & my json_escape(event_location) & "\""
      end if
      if event_notes is "" then
        set notes_json to "null"
      else
        set notes_json to "\"" & my json_escape(event_notes) & "\""
      end if
      set event_json to "{\"title\":\"" & my json_escape(event_title) & "\",\"start\":" & event_start & ",\"end\":" & event_end & ",\"location\":" & location_json & ",\"notes\":" & notes_json & ",\"calendar\":\"" & my json_escape(cal_name) & "\"}"
      copy event_json to end of event_items
    end repeat
  end repeat
end tell
set output to "[" & my join_items(event_items, ",") & "]"
return output
`.trim();
}

function parseContactItems(value: unknown): Array<{ label: string; value: string }> {
  if (!Array.isArray(value)) return [];
  const items: Array<{ label: string; value: string }> = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const record = entry as Record<string, unknown>;
    const label = normalizeString(record.label) ?? "";
    const val = normalizeString(record.value) ?? "";
    if (!label && !val) continue;
    items.push({ label, value: val });
  }
  return items;
}

function parseContactsPayload(payload: unknown): MacContact[] {
  if (!Array.isArray(payload)) return [];
  const contacts: MacContact[] = [];
  for (const entry of payload) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const record = entry as Record<string, unknown>;
    const name = normalizeString(record.name) ?? "";
    const phones = parseContactItems(record.phones);
    const emails = parseContactItems(record.emails);
    contacts.push({ name, phones, emails });
  }
  return contacts;
}

function parseCalendarPayload(payload: unknown): MacCalendarEvent[] {
  if (!Array.isArray(payload)) return [];
  const events: MacCalendarEvent[] = [];
  for (const entry of payload) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const record = entry as Record<string, unknown>;
    const title = normalizeString(record.title) ?? "";
    const calendar = normalizeString(record.calendar) ?? "";
    const startRaw = typeof record.start === "number" ? record.start : Number(record.start);
    const endRaw = typeof record.end === "number" ? record.end : Number(record.end);
    if (!Number.isFinite(startRaw) || !Number.isFinite(endRaw)) continue;
    const start = new Date(startRaw * 1000).toISOString();
    const end = new Date(endRaw * 1000).toISOString();
    const location = normalizeString(record.location);
    const notes = normalizeString(record.notes);
    events.push({ title, start, end, location, notes, calendar });
  }
  return events;
}

async function checkContactsAccess(): Promise<{ ok: boolean; error?: string }> {
  const script = `
tell application "Contacts"
  return count of people
end tell
`.trim();
  const result = await execAppleScript(script);
  if (!result.ok) {
    const mapped = mapAppleScriptError(
      result.error,
      "Contacts permission required. Grant access in System Settings > Privacy & Security > Contacts."
    );
    return { ok: false, error: mapped.error };
  }
  return { ok: true };
}

async function checkCalendarAccess(): Promise<{ ok: boolean; error?: string }> {
  const script = `
tell application "Calendar"
  return count of calendars
end tell
`.trim();
  const result = await execAppleScript(script);
  if (!result.ok) {
    const mapped = mapAppleScriptError(
      result.error,
      "Calendar permission required. Grant access in System Settings > Privacy & Security > Calendars."
    );
    return { ok: false, error: mapped.error };
  }
  return { ok: true };
}

function checkFullDiskAccess(): { ok: boolean; error?: string } {
  const openResult = openChatDb();
  if (!openResult.ok) {
    return { ok: false, error: openResult.error };
  }
  try {
    openResult.db.prepare("SELECT name FROM sqlite_master LIMIT 1").get();
  } catch (err) {
    const mapped = mapChatDbError(err);
    openResult.db.close();
    return { ok: false, error: mapped.error };
  }
  openResult.db.close();
  return { ok: true };
}

export function getMacConnectorState(): MacConnectorState {
  return snapshotState();
}

export async function getMacStatus(): Promise<MacActionResult<MacConnectorState>> {
  const [fullDisk, contacts, calendar] = await Promise.all([
    Promise.resolve(checkFullDiskAccess()),
    checkContactsAccess(),
    checkCalendarAccess(),
  ]);
  const permissions = {
    full_disk_access: fullDisk.ok,
    contacts: contacts.ok,
    calendar: calendar.ok,
  };
  const errors = [fullDisk.error, contacts.error, calendar.error].filter(
    (entry): entry is string => Boolean(entry)
  );
  updateState({ permissions, lastError: errors[0] ?? null });
  return { ok: true, data: snapshotState() };
}

export async function sendMacMessage(payload: unknown): Promise<MacActionResult<MacSendResult>> {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { ok: false, status: 400, error: "Request body is required." };
  }
  const record = payload as Record<string, unknown>;
  const recipientRaw = normalizeString(record.recipient);
  const message = typeof record.message === "string" ? record.message : null;
  if (!recipientRaw) {
    return { ok: false, status: 400, error: "`recipient` is required." };
  }
  if (!message || !message.trim()) {
    return { ok: false, status: 400, error: "`message` is required." };
  }
  const recipientResult = normalizeRecipient(recipientRaw);
  if (!recipientResult.ok) {
    return { ok: false, status: 400, error: recipientResult.error };
  }

  const now = Date.now();
  const rateCheck = checkRateLimit(now);
  if (!rateCheck.ok) return rateCheck;

  const script = buildSendScript(recipientResult.recipient, message);
  const result = await execAppleScript(script);
  if (!result.ok) {
    const mapped = mapAppleScriptError(
      result.error,
      "Messages automation permission required. Grant access in System Settings > Privacy & Security > Automation."
    );
    updateState({ lastError: mapped.error });
    return { ok: false, status: mapped.status, error: mapped.error };
  }
  recordSend(now);
  return {
    ok: true,
    data: {
      recipient: recipientResult.recipient,
      message,
      sent_at: new Date(now).toISOString(),
    },
  };
}

export async function getMacRecentMessages(
  query: unknown
): Promise<MacActionResult<MacMessage[]>> {
  const parsed = parseMessagesQuery(query);
  if (!parsed.ok) return parsed;

  const openResult = openChatDb();
  if (!openResult.ok) {
    updateState({
      permissions: { full_disk_access: openResult.permissionDenied ? false : state.permissions.full_disk_access },
      lastError: openResult.error,
    });
    return { ok: false, status: openResult.status, error: openResult.error };
  }

  const db = openResult.db;
  let scale: MessageDateScale = "seconds";
  try {
    scale = resolveMessageDateScale(db);
    let queryText = `
      SELECT m.ROWID as id,
             m.text as text,
             m.is_from_me as is_from_me,
             m.date as date,
             m.service as service,
             h.id as handle_id,
             c.chat_identifier as chat_id
      FROM message m
      LEFT JOIN handle h ON m.handle_id = h.ROWID
      LEFT JOIN chat_message_join cmj ON m.ROWID = cmj.message_id
      LEFT JOIN chat c ON cmj.chat_id = c.ROWID
      WHERE h.id = ?
    `;
    const params: Array<string | number> = [parsed.handle];
    if (parsed.since !== null) {
      queryText += " AND m.date >= ?";
      params.push(toAppleEpochValue(parsed.since, scale));
    }
    queryText += " ORDER BY m.date DESC LIMIT ?";
    params.push(parsed.limit);

    const rows = db.prepare(queryText).all(...params) as Array<{
      id: number;
      text: string | null;
      is_from_me: number;
      date: number | null;
      service: string | null;
      handle_id: string | null;
      chat_id: string | null;
    }>;
    const messages = rows.map((row) => ({
      id: String(row.id),
      handle_id: row.handle_id ?? "",
      text: row.text ?? "",
      is_from_me: Boolean(row.is_from_me),
      date: appleDateToIso(row.date ?? 0, scale),
      service: normalizeService(row.service),
      chat_id: normalizeString(row.chat_id),
    }));
    updateState({ permissions: { full_disk_access: true }, lastError: null });
    return { ok: true, data: messages };
  } catch (err) {
    const mapped = mapChatDbError(err);
    updateState({
      permissions: { full_disk_access: mapped.permissionDenied ? false : state.permissions.full_disk_access },
      lastError: mapped.error,
    });
    return { ok: false, status: mapped.status, error: mapped.error };
  } finally {
    db.close();
  }
}

export async function getMacContacts(): Promise<MacActionResult<MacContact[]>> {
  const script = buildContactsScript();
  const result = await execAppleScript(script);
  if (!result.ok) {
    const mapped = mapAppleScriptError(
      result.error,
      "Contacts permission required. Grant access in System Settings > Privacy & Security > Contacts."
    );
    updateState({
      permissions: { contacts: mapped.permissionDenied ? false : state.permissions.contacts },
      lastError: mapped.error,
    });
    return { ok: false, status: mapped.status, error: mapped.error };
  }
  if (!result.stdout) {
    updateState({ lastError: "Contacts AppleScript returned empty output." });
    return { ok: false, status: 500, error: "Contacts AppleScript returned empty output." };
  }
  try {
    const parsed = JSON.parse(result.stdout) as unknown;
    const contacts = parseContactsPayload(parsed);
    updateState({ permissions: { contacts: true }, lastError: null });
    return { ok: true, data: contacts };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to parse contacts output.";
    updateState({ lastError: message });
    return { ok: false, status: 500, error: message };
  }
}

export async function getMacCalendarUpcoming(
  query: unknown
): Promise<MacActionResult<MacCalendarEvent[]>> {
  let days = DEFAULT_CALENDAR_DAYS;
  if (query && typeof query === "object" && !Array.isArray(query)) {
    const record = query as Record<string, unknown>;
    const raw =
      typeof record.days === "string"
        ? Number.parseInt(record.days, 10)
        : typeof record.days === "number"
          ? record.days
          : NaN;
    if (Number.isFinite(raw)) {
      days = Math.max(1, Math.min(MAX_CALENDAR_DAYS, Math.trunc(raw)));
    }
  }
  const script = buildCalendarScript(days);
  const result = await execAppleScript(script);
  if (!result.ok) {
    const mapped = mapAppleScriptError(
      result.error,
      "Calendar permission required. Grant access in System Settings > Privacy & Security > Calendars."
    );
    updateState({
      permissions: { calendar: mapped.permissionDenied ? false : state.permissions.calendar },
      lastError: mapped.error,
    });
    return { ok: false, status: mapped.status, error: mapped.error };
  }
  if (!result.stdout) {
    updateState({ lastError: "Calendar AppleScript returned empty output." });
    return { ok: false, status: 500, error: "Calendar AppleScript returned empty output." };
  }
  try {
    const parsed = JSON.parse(result.stdout) as unknown;
    const events = parseCalendarPayload(parsed);
    updateState({ permissions: { calendar: true }, lastError: null });
    return { ok: true, data: events };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to parse calendar output.";
    updateState({ lastError: message });
    return { ok: false, status: 500, error: message };
  }
}
