import {
  type ConversationChannel,
  type ConversationEventInsert,
  type PersonDetails,
  getDb,
  getPeopleSyncStatus,
  getPersonDetails,
  insertConversationEvents,
  listPeopleForConversationSync,
  normalizeEmail,
  upsertPeopleSyncStatus,
  type ProjectCommunicationRow,
} from "./db.js";
import { getMacRecentMessages, type MacMessage } from "./mac_connector.js";

export type ConversationSyncResult = {
  person_id: string;
  channels_synced: ConversationChannel[];
  events_added: number;
  channel_results: Array<{ channel: ConversationChannel; events_added: number }>;
  errors: string[];
};

type ChannelSyncOutcome = {
  channel: ConversationChannel;
  events_added: number;
  last_synced_at: string | null;
  last_external_id: string | null;
  errors: string[];
  ok: boolean;
};

type MeetingCandidate = {
  meeting_id: string;
  kind: string | null;
  payload: Record<string, unknown>;
  communication: ProjectCommunicationRow;
  attendees: string[];
};

const SUPPORTED_CHANNELS: ConversationChannel[] = ["imessage", "meeting"];
const BACKGROUND_SYNC_INTERVAL_MS = 5 * 60 * 1000;
const BACKGROUND_SYNC_STAGGER_MS = 750;
const IMESSAGE_LOOKBACK_HOURS = 24;
const MEETING_LOOKBACK_HOURS = 24 * 30;
const MAX_IMESSAGE_LIMIT = 200;

let backgroundTimer: NodeJS.Timeout | null = null;
let backgroundRunning = false;

export function startConversationBackgroundSync(): void {
  if (backgroundTimer) return;
  const runCycle = async () => {
    if (backgroundRunning) return;
    backgroundRunning = true;
    try {
      const people = listPeopleForConversationSync();
      for (const person of people) {
        const result = await syncPersonConversations(person.id, { reason: "background" });
        if (result.errors.length) {
          // eslint-disable-next-line no-console
          console.warn("conversation sync errors", {
            person_id: person.id,
            errors: result.errors,
          });
        }
        await delay(BACKGROUND_SYNC_STAGGER_MS);
      }
    } finally {
      backgroundRunning = false;
    }
  };
  void runCycle();
  backgroundTimer = setInterval(() => {
    void runCycle();
  }, BACKGROUND_SYNC_INTERVAL_MS);
}

export async function syncPersonConversations(
  personId: string,
  options: { channels?: ConversationChannel[]; reason?: "background" | "on_demand" } = {}
): Promise<ConversationSyncResult> {
  const person = getPersonDetails(personId);
  if (!person) {
    return {
      person_id: personId,
      channels_synced: [],
      events_added: 0,
      channel_results: [],
      errors: ["person not found"],
    };
  }

  const channels = normalizeChannels(options.channels);
  const results: ChannelSyncOutcome[] = [];
  const errors: string[] = [];
  let eventsAdded = 0;

  if (channels.includes("imessage")) {
    const outcome = await syncIMessageChannel(person);
    results.push(outcome);
  }

  if (channels.includes("meeting")) {
    const outcome = await syncMeetingChannel(person);
    results.push(outcome);
  }

  for (const outcome of results) {
    if (outcome.ok && outcome.last_synced_at) {
      const existing = getPeopleSyncStatus(person.id, outcome.channel);
      upsertPeopleSyncStatus({
        person_id: person.id,
        channel: outcome.channel,
        last_synced_at: outcome.last_synced_at,
        last_external_id: outcome.last_external_id ?? existing?.last_external_id ?? null,
      });
    }
    eventsAdded += outcome.events_added;
    for (const error of outcome.errors) {
      errors.push(`${outcome.channel}: ${error}`);
    }
  }

  return {
    person_id: person.id,
    channels_synced: results.filter((outcome) => outcome.ok).map((outcome) => outcome.channel),
    events_added: eventsAdded,
    channel_results: results.map((outcome) => ({
      channel: outcome.channel,
      events_added: outcome.events_added,
    })),
    errors,
  };
}

function normalizeChannels(channels?: ConversationChannel[]): ConversationChannel[] {
  if (!channels || !channels.length) return [...SUPPORTED_CHANNELS];
  const seen = new Set<ConversationChannel>();
  const normalized: ConversationChannel[] = [];
  for (const channel of channels) {
    if (!SUPPORTED_CHANNELS.includes(channel)) continue;
    if (seen.has(channel)) continue;
    seen.add(channel);
    normalized.push(channel);
  }
  return normalized.length ? normalized : [...SUPPORTED_CHANNELS];
}

async function syncIMessageChannel(person: PersonDetails): Promise<ChannelSyncOutcome> {
  const handles = collectIMessageHandles(person);
  if (!handles.length) {
    return {
      channel: "imessage",
      events_added: 0,
      last_synced_at: null,
      last_external_id: null,
      errors: ["no iMessage identifiers found"],
      ok: false,
    };
  }

  const status = getPeopleSyncStatus(person.id, "imessage");
  const nowMs = Date.now();
  const since = resolveSince(status?.last_synced_at ?? null, IMESSAGE_LOOKBACK_HOURS, nowMs);
  const errors: string[] = [];
  const messages: MacMessage[] = [];

  for (const handle of handles) {
    const result = await getMacRecentMessages({
      handle,
      since,
      limit: MAX_IMESSAGE_LIMIT,
    });
    if (!result.ok) {
      errors.push(`${handle}: ${result.error}`);
      continue;
    }
    messages.push(...result.data);
  }

  if (!messages.length && errors.length === handles.length) {
    return {
      channel: "imessage",
      events_added: 0,
      last_synced_at: null,
      last_external_id: null,
      errors: errors.length ? errors : ["no messages found"],
      ok: false,
    };
  }

  const unique = new Map<string, MacMessage>();
  for (const message of messages) {
    if (!unique.has(message.id)) {
      unique.set(message.id, message);
    }
  }

  const nowIso = new Date(nowMs).toISOString();
  const events: ConversationEventInsert[] = [];
  for (const message of unique.values()) {
    events.push({
      person_id: person.id,
      channel: "imessage",
      direction: message.is_from_me ? "outbound" : "inbound",
      summary: summarizeContent(message.text),
      content: message.text,
      external_id: `imessage:${message.id}`,
      metadata: {
        service: message.service,
        handle_id: message.handle_id,
        chat_id: message.chat_id,
      },
      occurred_at: normalizeOccurredAt(message.date, nowIso),
      synced_at: nowIso,
    });
  }

  const inserted = insertConversationEvents(events);
  const latestMessage = selectLatestMessage(unique);
  const lastExternalId = latestMessage ? `imessage:${latestMessage.id}` : null;

  const allHandlesOk = errors.length === 0;
  return {
    channel: "imessage",
    events_added: inserted,
    last_synced_at: allHandlesOk ? nowIso : null,
    last_external_id: lastExternalId ?? status?.last_external_id ?? null,
    errors,
    ok: allHandlesOk,
  };
}

async function syncMeetingChannel(person: PersonDetails): Promise<ChannelSyncOutcome> {
  const personEmails = collectPersonEmails(person);
  if (!personEmails.length) {
    return {
      channel: "meeting",
      events_added: 0,
      last_synced_at: null,
      last_external_id: null,
      errors: ["no email identifiers found"],
      ok: false,
    };
  }

  const status = getPeopleSyncStatus(person.id, "meeting");
  const nowMs = Date.now();
  const since = resolveSince(status?.last_synced_at ?? null, MEETING_LOOKBACK_HOURS, nowMs);
  const communications = listMeetingCommunications({ since, limit: 500 });

  const candidates = new Map<string, MeetingCandidate>();
  for (const communication of communications) {
    const payload = parsePayload(communication.payload);
    if (!payload) continue;
    const meetingId = readString(payload.meeting_id);
    if (!meetingId) continue;

    const kind = readString(payload.kind);
    if (kind && kind !== "note" && kind !== "summary") {
      continue;
    }

    const attendees = extractAttendeeEmails(payload, communication.body);
    if (!attendees.length) {
      // eslint-disable-next-line no-console
      console.warn("meeting linkage skipped: no attendees found", {
        meeting_id: meetingId,
        communication_id: communication.id,
      });
      continue;
    }

    const matches = attendees.some((email) => personEmails.includes(email));
    if (!matches) continue;

    const candidate: MeetingCandidate = {
      meeting_id: meetingId,
      kind,
      payload,
      communication,
      attendees,
    };

    const existing = candidates.get(meetingId);
    if (!existing || isBetterMeetingCandidate(candidate, existing)) {
      candidates.set(meetingId, candidate);
    }
  }

  const nowIso = new Date(nowMs).toISOString();
  const events: ConversationEventInsert[] = [];
  for (const candidate of candidates.values()) {
    const occurredAt = resolveMeetingOccurredAt(candidate, nowIso);
    const summary =
      readString(candidate.payload.meeting_title) ?? candidate.communication.summary;
    const content = resolveMeetingContent(candidate);
    const metadata = buildMeetingMetadata(candidate);
    events.push({
      person_id: person.id,
      channel: "meeting",
      direction: "bidirectional",
      summary,
      content,
      external_id: `meeting:${candidate.meeting_id}:${person.id}`,
      metadata,
      occurred_at: occurredAt,
      synced_at: nowIso,
    });
  }

  const inserted = insertConversationEvents(events);
  const lastExternalId = selectLatestMeetingExternalId(events);

  return {
    channel: "meeting",
    events_added: inserted,
    last_synced_at: nowIso,
    last_external_id: lastExternalId ?? status?.last_external_id ?? null,
    errors: [],
    ok: true,
  };
}

function resolveSince(
  lastSyncedAt: string | null,
  lookbackHours: number,
  nowMs: number
): string {
  const lookbackMs = lookbackHours * 60 * 60 * 1000;
  const fallbackMs = nowMs - lookbackMs;
  if (!lastSyncedAt) return new Date(fallbackMs).toISOString();
  const lastMs = Date.parse(lastSyncedAt);
  if (!Number.isFinite(lastMs)) return new Date(fallbackMs).toISOString();
  return new Date(Math.max(lastMs, fallbackMs)).toISOString();
}

function collectIMessageHandles(person: PersonDetails): string[] {
  const handles = new Set<string>();
  for (const identifier of person.identifiers) {
    if (
      identifier.type !== "phone" &&
      identifier.type !== "email" &&
      identifier.type !== "imessage"
    ) {
      continue;
    }
    const normalized = identifier.normalized_value.trim();
    if (normalized) handles.add(normalized);
    const raw = identifier.value.trim();
    if (raw) handles.add(raw);
  }
  return Array.from(handles);
}

function collectPersonEmails(person: PersonDetails): string[] {
  const emails = new Set<string>();
  for (const identifier of person.identifiers) {
    if (identifier.type !== "email" && identifier.type !== "imessage") continue;
    if (identifier.normalized_value.includes("@")) {
      const normalized = normalizeEmail(identifier.normalized_value);
      if (normalized) emails.add(normalized);
    }
    if (identifier.value.includes("@")) {
      const raw = normalizeEmail(identifier.value);
      if (raw) emails.add(raw);
    }
  }
  return Array.from(emails);
}

function summarizeContent(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const line = trimmed.split(/\r?\n/)[0] ?? trimmed;
  if (line.length <= 140) return line;
  return `${line.slice(0, 137).trimEnd()}...`;
}

function normalizeOccurredAt(value: string, fallback: string): string {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return fallback;
  return new Date(parsed).toISOString();
}

function selectLatestMessage(messages: Map<string, MacMessage>): MacMessage | null {
  let latest: MacMessage | null = null;
  let latestMs = 0;
  for (const message of messages.values()) {
    const ms = Date.parse(message.date);
    if (!Number.isFinite(ms)) continue;
    if (!latest || ms > latestMs) {
      latest = message;
      latestMs = ms;
    }
  }
  return latest;
}

function listMeetingCommunications(params: {
  since: string | null;
  limit: number;
}): ProjectCommunicationRow[] {
  // Meeting notes/summaries are stored via project communications (escalations table).
  const database = getDb();
  const clauses = [
    "payload IS NOT NULL",
    "payload LIKE '%\"meeting_id\"%'",
    "intent IN ('message', 'status')",
  ];
  const values: Array<string | number> = [];
  if (params.since) {
    clauses.push("created_at >= ?");
    values.push(params.since);
  }
  const whereClause = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const limit =
    Number.isFinite(params.limit) && params.limit > 0 ? Math.min(1000, params.limit) : 500;
  const rows = database
    .prepare(
      `SELECT *
       FROM escalations
       ${whereClause}
       ORDER BY created_at DESC
       LIMIT ?`
    )
    .all(...values, limit) as ProjectCommunicationRow[];
  return rows;
}

function parsePayload(payload: string | null): Record<string, unknown> | null {
  if (!payload) return null;
  try {
    const parsed = JSON.parse(payload) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function readString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function readStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
      .filter(Boolean);
  }
  if (typeof value === "string") {
    return value
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
  }
  return [];
}

function extractAttendeeEmails(
  payload: Record<string, unknown>,
  body: string | null
): string[] {
  const candidates: string[] = [];
  const fields = [
    "attendees",
    "attendee_emails",
    "participant_emails",
    "participants",
    "emails",
  ];
  for (const field of fields) {
    const value = payload[field];
    if (Array.isArray(value)) {
      for (const entry of value) {
        if (typeof entry === "string") {
          candidates.push(entry);
        } else if (entry && typeof entry === "object") {
          const record = entry as Record<string, unknown>;
          const email = readString(record.email ?? record.address ?? record.value);
          if (email) candidates.push(email);
        }
      }
    } else {
      candidates.push(...readStringArray(value));
    }
  }

  if (typeof body === "string" && body.includes("@")) {
    const matches = body.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? [];
    candidates.push(...matches);
  }

  const normalized = new Set<string>();
  for (const candidate of candidates) {
    if (!candidate.includes("@")) continue;
    const email = normalizeEmail(candidate);
    if (email) normalized.add(email);
  }
  return Array.from(normalized);
}

function isBetterMeetingCandidate(next: MeetingCandidate, current: MeetingCandidate): boolean {
  if (current.kind !== "summary" && next.kind === "summary") return true;
  if (current.kind === "summary" && next.kind !== "summary") return false;
  const nextMs = resolveMeetingTimestamp(next);
  const currentMs = resolveMeetingTimestamp(current);
  return nextMs > currentMs;
}

function resolveMeetingTimestamp(candidate: MeetingCandidate): number {
  const recordedAt =
    readString(candidate.payload.recorded_at) ??
    readString(candidate.payload.note_timestamp) ??
    candidate.communication.created_at;
  const ms = Date.parse(recordedAt);
  return Number.isFinite(ms) ? ms : 0;
}

function resolveMeetingOccurredAt(candidate: MeetingCandidate, fallback: string): string {
  const started =
    readString(candidate.payload.meeting_started_at) ??
    readString(candidate.payload.meeting_ended_at);
  if (started) return normalizeOccurredAt(started, fallback);
  const recordedAt =
    readString(candidate.payload.recorded_at) ?? readString(candidate.payload.note_timestamp);
  if (recordedAt) return normalizeOccurredAt(recordedAt, fallback);
  return normalizeOccurredAt(candidate.communication.created_at, fallback);
}

function resolveMeetingContent(candidate: MeetingCandidate): string | null {
  const note = readString(candidate.payload.note);
  if (note) return note;
  const summary = readString(candidate.payload.summary);
  if (summary) return summary;
  const body = readString(candidate.communication.body);
  return body ?? null;
}

function buildMeetingMetadata(candidate: MeetingCandidate): Record<string, unknown> {
  const metadata: Record<string, unknown> = {
    ...candidate.payload,
    communication_id: candidate.communication.id,
    project_id: candidate.communication.project_id,
    intent: candidate.communication.intent,
    attendees: candidate.attendees,
  };
  delete metadata.note;
  delete metadata.summary;
  return metadata;
}

function selectLatestMeetingExternalId(events: ConversationEventInsert[]): string | null {
  let latestId: string | null = null;
  let latestMs = 0;
  for (const event of events) {
    if (!event.external_id) continue;
    const ms = Date.parse(event.occurred_at);
    if (!Number.isFinite(ms)) continue;
    if (!latestId || ms > latestMs) {
      latestId = event.external_id;
      latestMs = ms;
    }
  }
  return latestId;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
