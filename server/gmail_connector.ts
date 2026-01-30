import crypto from "crypto";
import {
  createConversationEvent,
  getPersonDetails,
  normalizeEmail,
  resolvePersonByIdentifier,
  type ConversationEvent,
  type ConversationEventDirection,
  type ConversationEventMetadata,
} from "./db.js";

export type GmailThreadSummary = {
  thread_id: string;
  subject: string;
  snippet: string;
  date: string | null;
  date_raw: string | null;
  url: string | null;
};

export type GmailSendPayload = {
  to: string;
  subject: string;
  body: string;
  person_id?: string;
};

export type GmailSendResult =
  | { ok: true; sent: true; event_id: string }
  | {
      ok: true;
      sent: false;
      needs_approval: true;
      draft_id: string;
      reason: string;
    }
  | {
      ok: true;
      sent: false;
      manual: true;
      reason: string;
      draft_url: string | null;
    }
  | { ok: false; error: string };

export type GmailThreadsResult =
  | { ok: true; threads: GmailThreadSummary[] }
  | { ok: false; status: number; error: string };

export type GmailSyncResult =
  | {
      ok: true;
      person_id: string;
      threads: GmailThreadSummary[];
      events_added: number;
      errors: string[];
    }
  | { ok: false; status: number; error: string };

type GmailDraft = {
  id: string;
  to: string;
  subject: string;
  body: string;
  person_id?: string;
  created_at: string;
  reason: string;
};

type McpToolResult =
  | { ok: true; content: string; raw: unknown }
  | { ok: false; error: string };

type GmailPageSnapshot = {
  text: string;
  html: string | null;
};

const GMAIL_HOST = "mail.google.com";
const DEFAULT_THREADS_LIMIT = 20;
const MAX_THREADS_LIMIT = 50;
const DEFAULT_MCP_TIMEOUT_MS = 30_000;

const pendingDrafts = new Map<string, GmailDraft>();
let mcpRequestId = 1;

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

function getChromeMcpUrl(): string | null {
  return (
    env("CONTROL_CENTER_CHROME_MCP_URL") ??
    env("CLAUDE_IN_CHROME_MCP_URL") ??
    env("CHROME_MCP_URL")
  );
}

function getChromeMcpTimeoutMs(): number {
  return Math.max(
    1_000,
    parseIntEnv("CONTROL_CENTER_CHROME_MCP_TIMEOUT_MS", DEFAULT_MCP_TIMEOUT_MS)
  );
}

async function callChromeTool(
  name: string,
  args: Record<string, unknown> = {}
): Promise<McpToolResult> {
  const url = getChromeMcpUrl();
  if (!url) {
    return {
      ok: false,
      error: "Chrome MCP server not configured. Set CONTROL_CENTER_CHROME_MCP_URL.",
    };
  }

  const payload = {
    jsonrpc: "2.0",
    id: mcpRequestId++,
    method: "tools/call",
    params: {
      name,
      arguments: args,
    },
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), getChromeMcpTimeoutMs());
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timeout);
    const message = err instanceof Error ? err.message : "Chrome MCP request failed.";
    return { ok: false, error: message };
  }
  clearTimeout(timeout);

  if (!response.ok) {
    return {
      ok: false,
      error: `Chrome MCP request failed with status ${response.status}.`,
    };
  }

  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Chrome MCP response was not JSON.",
    };
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {
      ok: false,
      error: "Chrome MCP response was invalid.",
    };
  }

  const record = parsed as Record<string, unknown>;
  if (record.error && typeof record.error === "object" && record.error) {
    const errorRecord = record.error as Record<string, unknown>;
    const message =
      typeof errorRecord.message === "string"
        ? errorRecord.message
        : "Chrome MCP returned an error.";
    return { ok: false, error: message };
  }

  const result = record.result ?? record;
  return {
    ok: true,
    raw: result,
    content: extractTextFromMcpResult(result),
  };
}

function extractTextFromMcpResult(result: unknown): string {
  const extracted = extractMcpContent(result);
  if (extracted.text) return extracted.text;
  if (typeof result === "string") return result;
  if (!result) return "";
  if (typeof result === "object") {
    try {
      return JSON.stringify(result);
    } catch {
      return "";
    }
  }
  return String(result);
}

function extractMcpContent(result: unknown): GmailPageSnapshot {
  const empty: GmailPageSnapshot = { text: "", html: null };
  if (!result) return empty;
  if (typeof result === "string") return { text: result, html: null };
  if (typeof result !== "object" || Array.isArray(result)) return empty;

  const record = result as Record<string, unknown>;
  const text = typeof record.text === "string" ? record.text : "";
  const html = typeof record.html === "string" ? record.html : null;

  const content = record.content;
  if (Array.isArray(content)) {
    const textParts: string[] = [];
    let htmlPart: string | null = html;
    for (const entry of content) {
      if (typeof entry === "string") {
        textParts.push(entry);
        continue;
      }
      if (!entry || typeof entry !== "object") continue;
      const item = entry as Record<string, unknown>;
      if (typeof item.text === "string") textParts.push(item.text);
      if (!htmlPart && typeof item.html === "string") htmlPart = item.html;
    }
    return {
      text: text || textParts.join("\n"),
      html: htmlPart,
    };
  }

  return { text, html };
}

function parseMaybeJson(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return null;
  try {
    const parsed = JSON.parse(trimmed);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function chromeNavigate(
  url: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const result = await callChromeTool("navigate", { url });
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readGmailPage(): Promise<
  | { ok: true; page: GmailPageSnapshot }
  | { ok: false; error: string }
> {
  const readResult = await callChromeTool("read_page");
  if (readResult.ok) {
    const snapshot = extractMcpContent(readResult.raw);
    if (snapshot.text || snapshot.html) {
      return { ok: true, page: snapshot };
    }
    const parsed = parseMaybeJson(readResult.content);
    if (parsed) {
      const text = typeof parsed.text === "string" ? parsed.text : "";
      const html = typeof parsed.html === "string" ? parsed.html : null;
      if (text || html) {
        return { ok: true, page: { text, html } };
      }
    }
  }

  const textResult = await callChromeTool("get_page_text");
  if (!textResult.ok) return { ok: false, error: textResult.error };
  return { ok: true, page: { text: textResult.content, html: null } };
}

async function waitForGmailReady(
  attempts = 10,
  delayMs = 750
): Promise<{ ok: true } | { ok: false; error: string }> {
  for (let i = 0; i < attempts; i += 1) {
    const pageResult = await readGmailPage();
    if (!pageResult.ok) {
      return { ok: false, error: pageResult.error };
    }
    const text = pageResult.page.text.toLowerCase();
    if (text.includes("sign in") && text.includes("gmail")) {
      return {
        ok: false,
        error: "Gmail is not signed in. Please log in to Gmail in Chrome.",
      };
    }
    if (pageResult.page.text.trim().length > 0 || pageResult.page.html) {
      return { ok: true };
    }
    await sleep(delayMs);
  }
  return {
    ok: false,
    error: "Gmail did not finish loading. Keep Gmail open and try again.",
  };
}

function parseGmailDate(dateRaw: string | null): string | null {
  if (!dateRaw) return null;
  const trimmed = dateRaw.trim();
  if (!trimmed) return null;
  const parsed = Date.parse(trimmed);
  if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
  return null;
}

function normalizeThreadSummary(summary: GmailThreadSummary): GmailThreadSummary {
  return {
    thread_id: summary.thread_id,
    subject: summary.subject,
    snippet: summary.snippet,
    date: summary.date,
    date_raw: summary.date_raw,
    url: summary.url,
  };
}

function buildThreadSearchUrl(email: string): string {
  const query = encodeURIComponent(`from:${email} OR to:${email}`);
  return `https://${GMAIL_HOST}/mail/u/0/#search/${query}`;
}

function buildComposeUrl(to: string, subject: string, body?: string): string {
  const params = new URLSearchParams({
    view: "cm",
    to,
    su: subject,
  });
  if (body && body.trim()) {
    params.set("body", body);
  }
  return `https://${GMAIL_HOST}/mail/u/0/?${params.toString()}`;
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function stripHtml(value: string): string {
  return decodeHtmlEntities(value.replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function extractAttribute(source: string, attr: string): string | null {
  const regex = new RegExp(`${attr}="([^"]+)"`, "i");
  const match = source.match(regex);
  return match?.[1] ?? null;
}

function extractClassText(source: string, className: string): string {
  const regex = new RegExp(
    `class="[^"]*\\b${className}\\b[^"]*"[^>]*>([\\s\\S]*?)<`,
    "i"
  );
  const match = source.match(regex);
  return match ? stripHtml(match[1]) : "";
}

function extractThreadUrl(source: string): string | null {
  const hrefMatch =
    source.match(/href="([^"]*#[^"]*)"/i) ||
    source.match(/href="([^"]+)"/i);
  if (!hrefMatch) return null;
  const href = hrefMatch[1];
  if (!href) return null;
  if (href.startsWith("http")) return href;
  if (href.startsWith("#")) {
    return `https://${GMAIL_HOST}/mail/u/0/${href}`;
  }
  if (href.startsWith("/")) {
    return `https://${GMAIL_HOST}${href}`;
  }
  return `https://${GMAIL_HOST}/mail/u/0/${href}`;
}

function parseThreadsFromHtml(html: string, limit: number): GmailThreadSummary[] {
  const threads: GmailThreadSummary[] = [];
  const rowRegex = /<tr[^>]*class="[^"]*\bzA\b[^"]*"[^>]*>[\s\S]*?<\/tr>/gi;
  const rows = html.match(rowRegex) ?? [];
  for (const row of rows) {
    const threadId =
      extractAttribute(row, "data-legacy-thread-id") ??
      extractAttribute(row, "data-thread-id") ??
      "";
    const subject =
      extractClassText(row, "bog") || extractClassText(row, "bqe");
    const snippet = extractClassText(row, "y2");
    const dateRaw =
      extractAttribute(row, "title") ??
      extractAttribute(row, "data-tooltip") ??
      null;
    const url = extractThreadUrl(row);
    const date = parseGmailDate(dateRaw);
    if (subject || snippet || threadId) {
      threads.push(
        normalizeThreadSummary({
          thread_id: threadId.trim(),
          subject: subject.trim(),
          snippet: snippet.trim(),
          date_raw: dateRaw?.trim() || null,
          date,
          url,
        })
      );
    }
    if (threads.length >= limit) break;
  }
  return threads;
}

const IGNORE_LINES = new Set([
  "compose",
  "inbox",
  "starred",
  "snoozed",
  "sent",
  "drafts",
  "more",
  "important",
  "scheduled",
  "all mail",
  "spam",
  "trash",
  "categories",
  "social",
  "promotions",
  "updates",
  "forums",
  "primary",
  "meet",
  "chat",
  "search mail",
  "settings",
  "help",
]);

function parseThreadsFromText(text: string, limit: number): GmailThreadSummary[] {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const threads: GmailThreadSummary[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < lines.length; i += 1) {
    if (threads.length >= limit) break;
    const line = lines[i];
    const normalized = line.toLowerCase();
    if (IGNORE_LINES.has(normalized)) continue;
    if (line.length < 3 || line.length > 140) continue;
    if (/^\d+$/.test(line)) continue;
    const snippetCandidate = lines[i + 1] ?? "";
    const snippet = snippetCandidate !== line ? snippetCandidate : "";
    const key = `${line}|${snippet}`;
    if (seen.has(key)) continue;
    seen.add(key);
    threads.push(
      normalizeThreadSummary({
        thread_id: "",
        subject: line,
        snippet,
        date_raw: null,
        date: null,
        url: null,
      })
    );
  }
  return threads;
}

async function fetchThreadsForEmail(
  email: string,
  limit: number
): Promise<GmailThreadsResult> {
  const normalized = normalizeEmail(email);
  if (!normalized) {
    return { ok: false, status: 400, error: "Invalid email address." };
  }
  const openResult = await chromeNavigate(buildThreadSearchUrl(normalized));
  if (!openResult.ok) {
    return { ok: false, status: 503, error: openResult.error };
  }
  const ready = await waitForGmailReady();
  if (!ready.ok) {
    return { ok: false, status: 503, error: ready.error };
  }

  const pageResult = await readGmailPage();
  if (!pageResult.ok) {
    return { ok: false, status: 500, error: pageResult.error };
  }

  const html = pageResult.page.html;
  const threads = html
    ? parseThreadsFromHtml(html, limit)
    : parseThreadsFromText(pageResult.page.text, limit);
  return { ok: true, threads };
}

function normalizeSendPayload(
  payload: unknown
): { ok: true; data: GmailSendPayload } | { ok: false; error: string } {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { ok: false, error: "Request body is required." };
  }
  const record = payload as Record<string, unknown>;
  const to = typeof record.to === "string" ? record.to.trim() : "";
  const subject = typeof record.subject === "string" ? record.subject.trim() : "";
  const body = typeof record.body === "string" ? record.body : "";
  const personId = typeof record.person_id === "string" ? record.person_id.trim() : "";
  if (!to) return { ok: false, error: "`to` is required." };
  if (!subject) return { ok: false, error: "`subject` is required." };
  if (!body.trim()) return { ok: false, error: "`body` is required." };
  return {
    ok: true,
    data: {
      to,
      subject,
      body,
      person_id: personId || undefined,
    },
  };
}

function resolvePersonForSend(payload: GmailSendPayload): {
  personId: string | null;
  hasProjectAssociation: boolean;
} {
  if (payload.person_id) {
    const person = getPersonDetails(payload.person_id);
    return {
      personId: person?.id ?? null,
      hasProjectAssociation: Boolean(person?.projects.length),
    };
  }
  const normalized = normalizeEmail(payload.to);
  if (!normalized) {
    return { personId: null, hasProjectAssociation: false };
  }
  const person = resolvePersonByIdentifier({ type: "email", normalizedValue: normalized });
  return {
    personId: person?.id ?? null,
    hasProjectAssociation: Boolean(person?.projects.length),
  };
}

function createDraft(
  payload: GmailSendPayload,
  reason: string,
  personIdOverride?: string | null
): GmailDraft {
  const draft: GmailDraft = {
    id: crypto.randomUUID(),
    to: payload.to,
    subject: payload.subject,
    body: payload.body,
    person_id: personIdOverride ?? payload.person_id,
    created_at: nowIso(),
    reason,
  };
  pendingDrafts.set(draft.id, draft);
  return draft;
}

async function maybeFillCompose(payload: GmailSendPayload): Promise<string | null> {
  const result = await callChromeTool("form_input", {
    label: "Message Body",
    value: payload.body,
  });
  if (!result.ok) return result.error;
  return null;
}

type ClickTarget = { x: number; y: number };

function parseClickTarget(raw: unknown): ClickTarget | null {
  if (!raw) return null;
  if (typeof raw === "string") {
    const match = raw.match(/(\d+(?:\.\d+)?)[^\d]+(\d+(?:\.\d+)?)/);
    if (match) {
      return { x: Number(match[1]), y: Number(match[2]) };
    }
    const parsed = parseMaybeJson(raw);
    if (parsed) return parseClickTarget(parsed);
    return null;
  }
  if (typeof raw !== "object" || Array.isArray(raw)) return null;

  const record = raw as Record<string, unknown>;
  const x = record.x;
  const y = record.y;
  if (typeof x === "number" && typeof y === "number") {
    return { x, y };
  }
  const center = record.center as Record<string, unknown> | undefined;
  if (center && typeof center.x === "number" && typeof center.y === "number") {
    return { x: center.x, y: center.y };
  }
  const bounds = record.boundingBox as Record<string, unknown> | undefined;
  if (
    bounds &&
    typeof bounds.x === "number" &&
    typeof bounds.y === "number" &&
    typeof bounds.width === "number" &&
    typeof bounds.height === "number"
  ) {
    return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
  }
  const matches = record.matches;
  if (Array.isArray(matches) && matches.length > 0) {
    return parseClickTarget(matches[0]);
  }
  return null;
}

async function clickSendButton(): Promise<{ ok: true } | { ok: false; error: string }> {
  const findResult = await callChromeTool("find", { query: "Send" });
  if (!findResult.ok) {
    return { ok: false, error: findResult.error };
  }
  const target = parseClickTarget(findResult.raw) ?? parseClickTarget(findResult.content);
  if (!target) {
    return { ok: false, error: "Send button not found." };
  }
  const clickResult = await callChromeTool("left_click", {
    x: target.x,
    y: target.y,
  });
  if (!clickResult.ok) {
    return { ok: false, error: clickResult.error };
  }
  return { ok: true };
}

async function fillAndSendCompose(
  payload: GmailSendPayload
): Promise<{ ok: true } | { ok: false; error: string }> {
  const composeUrl = buildComposeUrl(payload.to, payload.subject, payload.body);
  const openResult = await chromeNavigate(composeUrl);
  if (!openResult.ok) return { ok: false, error: openResult.error };
  const ready = await waitForGmailReady();
  if (!ready.ok) return { ok: false, error: ready.error };

  const inputError = await maybeFillCompose(payload);
  const sendResult = await clickSendButton();
  if (!sendResult.ok) {
    const suffix = inputError ? ` (Compose input failed: ${inputError})` : "";
    return { ok: false, error: `${sendResult.error}${suffix}` };
  }
  return { ok: true };
}

function buildEmailMetadata(thread?: GmailThreadSummary): ConversationEventMetadata {
  if (!thread) return {};
  return {
    thread_id: thread.thread_id,
    thread_url: thread.url,
    snippet: thread.snippet,
    date_raw: thread.date_raw,
  };
}

function recordEmailEvent(params: {
  personId: string;
  direction: ConversationEventDirection;
  subject: string;
  content: string;
  externalId: string | null;
  occurredAt: string;
  metadata: ConversationEventMetadata;
}): ConversationEvent | null {
  return createConversationEvent({
    person_id: params.personId,
    channel: "email",
    direction: params.direction,
    summary: params.subject,
    content: params.content,
    external_id: params.externalId,
    metadata: params.metadata,
    occurred_at: params.occurredAt,
  });
}

export async function sendGmail(payload: unknown): Promise<GmailSendResult> {
  const parsed = normalizeSendPayload(payload);
  if (!parsed.ok) return { ok: false, error: parsed.error };

  const approval = resolvePersonForSend(parsed.data);
  if (!approval.personId || !approval.hasProjectAssociation) {
    const draft = createDraft(parsed.data, "approval_required", approval.personId);
    return {
      ok: true,
      sent: false,
      needs_approval: true,
      draft_id: draft.id,
      reason: "Recipient not linked to an active project contact.",
    };
  }

  const sendResult = await fillAndSendCompose(parsed.data);
  if (!sendResult.ok) {
    return {
      ok: true,
      sent: false,
      manual: true,
      reason: `${sendResult.error} Open the draft URL in Gmail and click Send manually if needed.`,
      draft_url: buildComposeUrl(parsed.data.to, parsed.data.subject, parsed.data.body),
    };
  }

  const externalId = `gmail:outbound:${crypto.randomUUID()}`;
  const event = recordEmailEvent({
    personId: approval.personId,
    direction: "outbound",
    subject: parsed.data.subject,
    content: parsed.data.body,
    externalId,
    occurredAt: nowIso(),
    metadata: {},
  });
  return { ok: true, sent: true, event_id: event?.id ?? externalId };
}

export async function approveGmailDraft(draftId: string): Promise<GmailSendResult> {
  const draft = pendingDrafts.get(draftId);
  if (!draft) return { ok: false, error: "Draft not found." };

  const sendResult = await fillAndSendCompose(draft);
  if (!sendResult.ok) {
    return {
      ok: true,
      sent: false,
      manual: true,
      reason: `${sendResult.error} Open the draft URL in Gmail and click Send manually if needed.`,
      draft_url: buildComposeUrl(draft.to, draft.subject, draft.body),
    };
  }

  pendingDrafts.delete(draftId);
  if (!draft.person_id) {
    return { ok: true, sent: true, event_id: draftId };
  }
  const externalId = `gmail:outbound:${draftId}`;
  const event = recordEmailEvent({
    personId: draft.person_id,
    direction: "outbound",
    subject: draft.subject,
    content: draft.body,
    externalId,
    occurredAt: nowIso(),
    metadata: {},
  });
  return { ok: true, sent: true, event_id: event?.id ?? externalId };
}

export async function getGmailThreads(query: unknown): Promise<GmailThreadsResult> {
  if (!query || typeof query !== "object" || Array.isArray(query)) {
    return { ok: false, status: 400, error: "`email` query parameter is required." };
  }
  const record = query as Record<string, unknown>;
  const email = typeof record.email === "string" ? record.email.trim() : "";
  if (!email) {
    return { ok: false, status: 400, error: "`email` query parameter is required." };
  }
  const limitRaw =
    typeof record.limit === "string"
      ? Number.parseInt(record.limit, 10)
      : typeof record.limit === "number"
        ? record.limit
        : NaN;
  const limit = Number.isFinite(limitRaw)
    ? Math.max(1, Math.min(MAX_THREADS_LIMIT, Math.trunc(limitRaw)))
    : DEFAULT_THREADS_LIMIT;
  return fetchThreadsForEmail(email, limit);
}

export async function syncGmailHistory(payload: unknown): Promise<GmailSyncResult> {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { ok: false, status: 400, error: "`person_id` is required." };
  }
  const record = payload as Record<string, unknown>;
  const personId = typeof record.person_id === "string" ? record.person_id.trim() : "";
  if (!personId) {
    return { ok: false, status: 400, error: "`person_id` is required." };
  }
  const person = getPersonDetails(personId);
  if (!person) {
    return { ok: false, status: 404, error: "Person not found." };
  }

  const emails = person.identifiers
    .filter((identifier) => identifier.type === "email")
    .map((identifier) => identifier.value)
    .filter((value) => value.trim());
  if (!emails.length) {
    return {
      ok: false,
      status: 400,
      error: "Person has no email identifiers to sync.",
    };
  }

  const threads: GmailThreadSummary[] = [];
  const errors: string[] = [];
  for (const email of emails) {
    const result = await fetchThreadsForEmail(email, DEFAULT_THREADS_LIMIT);
    if (!result.ok) {
      errors.push(result.error);
      continue;
    }
    threads.push(...result.threads);
  }

  const deduped = new Map<string, GmailThreadSummary>();
  for (const thread of threads) {
    const key = thread.thread_id || `${thread.subject}:${thread.date_raw ?? ""}:${thread.snippet}`;
    if (!deduped.has(key)) {
      deduped.set(key, thread);
    }
  }

  let eventsAdded = 0;
  for (const thread of deduped.values()) {
    const externalId = thread.thread_id ? `gmail:${thread.thread_id}` : null;
    const event = recordEmailEvent({
      personId,
      direction: "bidirectional",
      subject: thread.subject || "Gmail thread",
      content: thread.snippet,
      externalId,
      occurredAt: thread.date ?? nowIso(),
      metadata: buildEmailMetadata(thread),
    });
    if (event) eventsAdded += 1;
  }

  return {
    ok: true,
    person_id: personId,
    threads: Array.from(deduped.values()),
    events_added: eventsAdded,
    errors,
  };
}
