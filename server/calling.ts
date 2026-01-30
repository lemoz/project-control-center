import crypto from "crypto";
import { execFile } from "child_process";
import {
  createConversationEvent,
  getPersonDetails,
  normalizeEmail,
  normalizePhone,
  type PersonDetails,
} from "./db.js";

export type CallType = "audio" | "video" | "phone";
export type CallProposalStatus = "pending" | "confirmed" | "cancelled" | "expired";

export type CallProposal = {
  id: string;
  person_id: string;
  person_name: string;
  identifier: string;
  type: CallType;
  reason: string | null;
  status: CallProposalStatus;
  created_at: string;
  expires_at: string;
};

export type CallActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; error: string };

const PROPOSAL_TTL_MS = 30 * 60 * 1000;
const proposals = new Map<string, CallProposal>();

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function normalizeReason(value: unknown): string | null {
  const reason = normalizeString(value);
  return reason ? reason : null;
}

function normalizeCallType(value: unknown): CallType | null {
  if (value === "audio" || value === "video" || value === "phone") return value;
  return null;
}

function escapeAppleScriptString(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, "\\\"")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t");
}

function pruneExpired(now: number): void {
  for (const proposal of proposals.values()) {
    if (proposal.status !== "pending") continue;
    const expiresAt = Date.parse(proposal.expires_at);
    if (Number.isFinite(expiresAt) && expiresAt <= now) {
      proposal.status = "expired";
    }
  }
}

function getProposal(id: string): CallProposal | null {
  const proposal = proposals.get(id);
  if (!proposal) return null;
  pruneExpired(Date.now());
  return proposal;
}

function collectIdentifiers(person: PersonDetails): { emails: string[]; phones: string[] } {
  const emails: string[] = [];
  const phones: string[] = [];
  const seenEmail = new Set<string>();
  const seenPhone = new Set<string>();

  const addEmail = (value: string | null) => {
    if (!value || seenEmail.has(value)) return;
    seenEmail.add(value);
    emails.push(value);
  };

  const addPhone = (value: string | null) => {
    if (!value || seenPhone.has(value)) return;
    seenPhone.add(value);
    phones.push(value);
  };

  for (const identifier of person.identifiers) {
    if (identifier.type === "email") {
      addEmail(identifier.normalized_value || identifier.value);
      continue;
    }
    if (identifier.type === "phone") {
      addPhone(identifier.normalized_value || identifier.value);
      continue;
    }
    const emailCandidate =
      normalizeEmail(identifier.value) || normalizeEmail(identifier.normalized_value);
    const phoneCandidate =
      normalizePhone(identifier.value) || normalizePhone(identifier.normalized_value);
    addEmail(emailCandidate);
    addPhone(phoneCandidate);
  }

  return { emails, phones };
}

function resolveIdentifier(person: PersonDetails, callType: CallType): string | null {
  const { emails, phones } = collectIdentifiers(person);
  if (callType === "phone") {
    return phones[0] ?? null;
  }
  if (emails.length > 0) return emails[0];
  if (phones.length > 0) return phones[0];
  return null;
}

function buildCallUrl(callType: CallType, identifier: string): string {
  const trimmed = identifier.trim().replace(/\s+/g, "");
  if (callType === "audio") return `facetime-audio://${trimmed}`;
  if (callType === "video") return `facetime://${trimmed}`;
  return `tel://${trimmed}`;
}

function execAppleScript(
  script: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  return new Promise((resolve) => {
    execFile(
      "osascript",
      ["-e", script],
      { maxBuffer: 1024 * 1024, timeout: 20_000 },
      (error, _stdout, stderr) => {
        if (error) {
          const message = stderr.trim() || error.message || "AppleScript failed.";
          resolve({ ok: false, error: message });
          return;
        }
        resolve({ ok: true });
      }
    );
  });
}

function openUrl(url: string): Promise<{ ok: true } | { ok: false; error: string }> {
  return new Promise((resolve) => {
    execFile("open", [url], { timeout: 20_000 }, (error, _stdout, stderr) => {
      if (error) {
        const message = stderr.trim() || error.message || "Failed to open URL.";
        resolve({ ok: false, error: message });
        return;
      }
      resolve({ ok: true });
    });
  });
}

async function openFaceTimeUrl(url: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const escapedUrl = escapeAppleScriptString(url);
  const script = `
tell application "FaceTime"
  activate
end tell
open location "${escapedUrl}"
`.trim();
  const appleResult = await execAppleScript(script);
  if (appleResult.ok) return appleResult;
  const fallback = await openUrl(url);
  if (fallback.ok) return fallback;
  return {
    ok: false,
    error: `AppleScript failed: ${appleResult.error}; open failed: ${fallback.error}`,
  };
}

function buildCallSummary(callType: CallType): string {
  if (callType === "phone") return "Phone call";
  if (callType === "audio") return "FaceTime audio call";
  return "FaceTime video call";
}

async function initiateCall(
  proposal: CallProposal
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const url = buildCallUrl(proposal.type, proposal.identifier);
  if (proposal.type === "phone") {
    const result = await openUrl(url);
    if (!result.ok) {
      return { ok: false, status: 500, error: result.error };
    }
    return { ok: true };
  }
  const result = await openFaceTimeUrl(url);
  if (!result.ok) {
    return { ok: false, status: 500, error: result.error };
  }
  return { ok: true };
}

function buildProposal(person: PersonDetails, callType: CallType, identifier: string, reason: string | null): CallProposal {
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    person_id: person.id,
    person_name: person.name,
    identifier,
    type: callType,
    reason,
    status: "pending",
    created_at: new Date(now).toISOString(),
    expires_at: new Date(now + PROPOSAL_TTL_MS).toISOString(),
  };
}

export async function proposeCall(
  payload: unknown
): Promise<CallActionResult<{ needs_approval: true; call_details: CallProposal }>> {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { ok: false, status: 400, error: "Request body is required." };
  }
  const record = payload as Record<string, unknown>;
  const personId = normalizeString(record.person_id);
  const callType = normalizeCallType(record.type);
  if (!personId) {
    return { ok: false, status: 400, error: "`person_id` is required." };
  }
  if (!callType) {
    return {
      ok: false,
      status: 400,
      error: "`type` must be one of audio, video, or phone.",
    };
  }

  const person = getPersonDetails(personId);
  if (!person) {
    return { ok: false, status: 404, error: "Person not found." };
  }

  const identifier = resolveIdentifier(person, callType);
  if (!identifier) {
    const message =
      callType === "phone"
        ? "Person has no phone number for a phone call."
        : "Person has no FaceTime identifier (email or phone).";
    return { ok: false, status: 400, error: message };
  }

  pruneExpired(Date.now());
  const proposal = buildProposal(person, callType, identifier, normalizeReason(record.reason));
  proposals.set(proposal.id, proposal);

  return { ok: true, data: { needs_approval: true, call_details: proposal } };
}

export function listPendingCalls(): CallProposal[] {
  pruneExpired(Date.now());
  return Array.from(proposals.values())
    .filter((proposal) => proposal.status === "pending")
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
}

export function cancelCall(
  id: string
): CallActionResult<{ cancelled: true; call_details: CallProposal }> {
  const proposal = getProposal(id);
  if (!proposal) {
    return { ok: false, status: 404, error: "Call proposal not found." };
  }
  if (proposal.status === "expired") {
    return { ok: false, status: 410, error: "Call proposal expired." };
  }
  if (proposal.status !== "pending") {
    return {
      ok: false,
      status: 409,
      error: `Call proposal already ${proposal.status}.`,
    };
  }
  proposal.status = "cancelled";
  return { ok: true, data: { cancelled: true, call_details: proposal } };
}

export async function confirmCall(
  id: string
): Promise<CallActionResult<{ initiated: true; event_id: string; call_details: CallProposal }>> {
  const proposal = getProposal(id);
  if (!proposal) {
    return { ok: false, status: 404, error: "Call proposal not found." };
  }
  if (proposal.status === "expired") {
    return { ok: false, status: 410, error: "Call proposal expired." };
  }
  if (proposal.status !== "pending") {
    return {
      ok: false,
      status: 409,
      error: `Call proposal already ${proposal.status}.`,
    };
  }

  const callResult = await initiateCall(proposal);
  if (!callResult.ok) {
    return { ok: false, status: callResult.status, error: callResult.error };
  }

  proposal.status = "confirmed";
  const now = nowIso();
  const event = createConversationEvent({
    person_id: proposal.person_id,
    channel: "call",
    direction: "outbound",
    summary: buildCallSummary(proposal.type),
    content: null,
    external_id: `call:${proposal.id}`,
    metadata: {
      call_type: proposal.type,
      duration: null,
      identifier: proposal.identifier,
    },
    occurred_at: now,
    synced_at: now,
  });

  return { ok: true, data: { initiated: true, event_id: event.id, call_details: proposal } };
}
