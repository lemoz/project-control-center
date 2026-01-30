import crypto from "crypto";
import {
  countSmsMessagesSince,
  createProjectCommunication,
  createSmsConversation,
  createSmsMessage,
  getActiveSmsConversationByPhone,
  getPrimarySmsContact,
  getSmsContactByPhone,
  getSmsConversationById,
  listProjects,
  listSmsMessages,
  listStaleSmsConversations,
  updateSmsConversation,
  upsertSmsContact,
  type SmsContactRow,
  type SmsConversationRow,
  type SmsMessageRow,
} from "./db.js";
import {
  getSmsConversationTimeoutMinutes,
  getSmsMessageCostCents,
  getSmsMonthlyBudgetCents,
  getSmsRateLimitPerHour,
  getTwilioAccountSid,
  getTwilioAuthToken,
  getTwilioPhoneNumber,
  getTwilioVerifySignature,
} from "./config.js";

type SmsConfig = {
  accountSid: string | null;
  authToken: string | null;
  phoneNumber: string | null;
  rateLimitPerHour: number;
  monthlyBudgetCents: number;
  messageCostCents: number;
  conversationTimeoutMinutes: number;
  verifySignature: boolean;
};

export type SmsInboundResult = {
  conversation: SmsConversationRow;
  replyMessage: string | null;
  endReason: string | null;
  createdConversation: boolean;
  contact: SmsContactRow | null;
};

export type SmsSendResult =
  | { ok: true; messageSid: string | null; conversation: SmsConversationRow }
  | { ok: false; error: string };

const END_KEYWORDS = [
  "done",
  "thanks",
  "thank you",
  "thx",
  "appreciate it",
  "all set",
  "that's all",
  "that is all",
  "no further",
  "resolved",
  "finished",
  "wrap up",
  "goodbye",
  "bye",
];

const END_KEYWORD_MATCHERS = END_KEYWORDS.map((keyword) => {
  const escaped = keyword
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\s+/g, "\\s+");
  return {
    keyword,
    pattern: new RegExp(`\\b${escaped}\\b`, "i"),
    negatedPattern: new RegExp(
      `\\b(?:not|no|dont|don't|do not)\\s+${escaped}\\b`,
      "i"
    ),
  };
});

const IDENTIFY_PROMPT =
  "Which project should I route this to? Reply with the project id or name.";
const ACK_REPLY =
  "Got it. I will share this with the global agent.";
const DONE_REPLY =
  "Thanks. I am passing this along. Text again any time to start a new thread.";

function getSmsConfig(): SmsConfig {
  return {
    accountSid: getTwilioAccountSid(),
    authToken: getTwilioAuthToken(),
    phoneNumber: getTwilioPhoneNumber(),
    rateLimitPerHour: getSmsRateLimitPerHour(),
    monthlyBudgetCents: getSmsMonthlyBudgetCents(),
    messageCostCents: getSmsMessageCostCents(),
    conversationTimeoutMinutes: getSmsConversationTimeoutMinutes(),
    verifySignature: getTwilioVerifySignature(),
  };
}

export function normalizePhoneNumber(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  const cleaned = trimmed.replace(/[^\d+]/g, "");
  if (!cleaned) return "";
  return cleaned.startsWith("+") ? cleaned : `+${cleaned}`;
}

function normalizeBody(raw: string): string {
  if (!raw) return "";
  return raw.replace(/\s+/g, " ").trim();
}

function detectEndReason(body: string): string | null {
  const normalized = body.trim();
  if (!normalized) return null;
  for (const matcher of END_KEYWORD_MATCHERS) {
    if (matcher.negatedPattern.test(normalized)) continue;
    if (matcher.pattern.test(normalized)) return matcher.keyword;
  }
  return null;
}

function resolveProjectIdFromMessage(body: string): string | null {
  const trimmed = body.trim();
  if (!trimmed) return null;
  const match = trimmed.match(/^(?:project|proj|id)\s*[:=]\s*(.+)$/i);
  const candidate = (match ? match[1] : trimmed).trim();
  if (!candidate) return null;
  const normalized = candidate.toLowerCase();
  const projects = listProjects();
  const found = projects.find(
    (project) =>
      project.id.toLowerCase() === normalized ||
      project.name.toLowerCase() === normalized
  );
  return found?.id ?? null;
}

function shouldAllowSend(phoneNumber: string, now: Date): {
  ok: boolean;
  error?: string;
} {
  const config = getSmsConfig();
  if (config.rateLimitPerHour > 0) {
    const since = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
    const count = countSmsMessagesSince({ since, phone_number: phoneNumber });
    if (count >= config.rateLimitPerHour) {
      return { ok: false, error: "rate_limit" };
    }
  }

  if (config.monthlyBudgetCents > 0) {
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const count = countSmsMessagesSince({ since: monthStart.toISOString() });
    const estimatedSpend = count * config.messageCostCents;
    if (estimatedSpend >= config.monthlyBudgetCents) {
      return { ok: false, error: "budget_exceeded" };
    }
  }

  return { ok: true };
}

function buildTranscript(messages: SmsMessageRow[]): string {
  return messages
    .map((message) => {
      const role =
        message.role === "agent" ? "Agent" : message.role === "system" ? "System" : "User";
      return `${role}: ${message.body}`;
    })
    .join("\n");
}

function buildSummary(messages: SmsMessageRow[], contact: SmsContactRow | null): string {
  const lastUser = [...messages]
    .reverse()
    .find((message) => message.role === "user" || message.direction === "inbound");
  const snippet = lastUser ? lastUser.body.slice(0, 80).trim() : "SMS update";
  const label = contact?.label?.trim() || "SMS user";
  return `${label}: ${snippet || "SMS update"}`;
}

function buildPayload(params: {
  conversation: SmsConversationRow;
  contact: SmsContactRow | null;
  messages: SmsMessageRow[];
}): string {
  const payload = {
    channel: "sms",
    sms_conversation_id: params.conversation.id,
    phone_number: params.conversation.phone_number,
    user_id: params.conversation.user_id,
    contact_label: params.conversation.contact_label ?? params.contact?.label ?? null,
    project_id: params.conversation.project_id,
    status: params.conversation.status,
    started_at: params.conversation.started_at,
    ended_at: params.conversation.ended_at,
    ended_reason: params.conversation.ended_reason,
    messages: params.messages.map((message) => ({
      id: message.id,
      role: message.role,
      direction: message.direction,
      body: message.body,
      created_at: message.created_at,
    })),
  };
  return JSON.stringify(payload);
}

export function verifyTwilioSignature(params: {
  signature: string | null;
  url: string;
  body: Record<string, string>;
}): boolean {
  const config = getSmsConfig();
  if (!config.verifySignature) return true;
  if (!config.authToken || !params.signature) return false;
  const data = params.url + Object.keys(params.body).sort().map((key) => key + params.body[key]).join("");
  const digest = crypto.createHmac("sha1", config.authToken).update(data).digest("base64");
  const a = Buffer.from(digest);
  const b = Buffer.from(params.signature);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export async function handleIncomingSms(params: {
  from: string;
  to: string;
  body: string;
  messageSid?: string | null;
}): Promise<SmsInboundResult> {
  const config = getSmsConfig();
  const from = normalizePhoneNumber(params.from);
  const to = normalizePhoneNumber(params.to);
  if (!from) {
    throw new Error("missing sender phone number");
  }
  if (!to) {
    throw new Error("missing destination phone number");
  }
  if (!config.phoneNumber) {
    throw new Error("sms phone number not configured");
  }
  if (normalizePhoneNumber(config.phoneNumber) !== to) {
    throw new Error("message not sent to configured SMS number");
  }

  const now = new Date();
  const nowIso = now.toISOString();
  const timeoutMs = config.conversationTimeoutMinutes * 60 * 1000;

  let contact = getSmsContactByPhone(from);
  let conversation = getActiveSmsConversationByPhone(from);
  let createdConversation = false;

  if (conversation) {
    const lastMessageAt = Date.parse(conversation.last_message_at);
    if (Number.isFinite(lastMessageAt) && now.getTime() - lastMessageAt > timeoutMs) {
      await endSmsConversation({
        conversation,
        contact,
        reason: "timeout",
      });
      conversation = null;
    }
  }

  if (!conversation) {
    conversation = createSmsConversation({
      phone_number: from,
      user_id: contact?.user_id ?? null,
      contact_label: contact?.label ?? null,
      project_id: contact?.project_id ?? null,
    });
    createdConversation = true;
  }

  if (!conversation.project_id) {
    const resolvedProjectId = resolveProjectIdFromMessage(params.body);
    if (resolvedProjectId) {
      updateSmsConversation(conversation.id, { project_id: resolvedProjectId });
      conversation = { ...conversation, project_id: resolvedProjectId };
      if (!contact) {
        contact = upsertSmsContact({
          phone_number: from,
          label: from,
          project_id: resolvedProjectId,
        });
      } else if (!contact.project_id) {
        contact = upsertSmsContact({
          phone_number: from,
          project_id: resolvedProjectId,
        });
      }
    }
  }

  if (!conversation.contact_label && contact?.label) {
    updateSmsConversation(conversation.id, { contact_label: contact.label });
    conversation = { ...conversation, contact_label: contact.label };
  }
  if (!conversation.user_id && contact?.user_id) {
    updateSmsConversation(conversation.id, { user_id: contact.user_id });
    conversation = { ...conversation, user_id: contact.user_id };
  }
  if (!conversation.project_id && contact?.project_id) {
    updateSmsConversation(conversation.id, { project_id: contact.project_id });
    conversation = { ...conversation, project_id: contact.project_id };
  }

  const inboundBody = normalizeBody(params.body);
  createSmsMessage({
    conversation_id: conversation.id,
    direction: "inbound",
    role: "user",
    body: inboundBody,
    provider_message_id: params.messageSid ?? null,
    created_at: nowIso,
  });
  updateSmsConversation(conversation.id, { last_message_at: nowIso });

  const endReason = conversation.project_id ? detectEndReason(inboundBody) : null;
  if (endReason) {
    await endSmsConversation({
      conversation,
      contact,
      reason: endReason,
    });
  }

  const needsIdentification = !conversation.project_id;
  let replyMessage: string | null = null;
  if (endReason) {
    replyMessage = DONE_REPLY;
  } else if (needsIdentification) {
    replyMessage = IDENTIFY_PROMPT;
  } else {
    replyMessage = ACK_REPLY;
  }

  if (replyMessage) {
    const allow = shouldAllowSend(from, now);
    if (!allow.ok) {
      replyMessage = null;
    } else {
      createSmsMessage({
        conversation_id: conversation.id,
        direction: "outbound",
        role: "agent",
        body: replyMessage,
        provider_message_id: null,
        created_at: nowIso,
      });
      updateSmsConversation(conversation.id, { last_message_at: nowIso });
    }
  }

  return {
    conversation,
    replyMessage,
    endReason,
    createdConversation,
    contact,
  };
}

export async function sendSmsMessage(params: {
  phone_number: string;
  body: string;
  conversation_id?: string | null;
  project_id?: string | null;
  contact_label?: string | null;
  user_id?: string | null;
}): Promise<SmsSendResult> {
  const config = getSmsConfig();
  if (!config.accountSid || !config.authToken || !config.phoneNumber) {
    return { ok: false, error: "twilio_not_configured" };
  }
  const to = normalizePhoneNumber(params.phone_number);
  if (!to) return { ok: false, error: "missing_phone_number" };
  const body = normalizeBody(params.body);
  if (!body) return { ok: false, error: "missing_body" };

  const now = new Date();
  const allow = shouldAllowSend(to, now);
  if (!allow.ok) {
    return { ok: false, error: allow.error ?? "rate_limit" };
  }

  let conversation =
    params.conversation_id ? getSmsConversationById(params.conversation_id) : null;
  if (!conversation) {
    conversation = getActiveSmsConversationByPhone(to);
  }
  if (!conversation) {
    conversation = createSmsConversation({
      phone_number: to,
      user_id: params.user_id ?? null,
      contact_label: params.contact_label ?? null,
      project_id: params.project_id ?? null,
    });
  }

  if (!conversation.project_id && params.project_id) {
    updateSmsConversation(conversation.id, { project_id: params.project_id });
    conversation = { ...conversation, project_id: params.project_id };
  }

  let messageSid: string | null = null;
  try {
    messageSid = await sendTwilioMessage({
      to,
      body,
      from: config.phoneNumber,
      accountSid: config.accountSid,
      authToken: config.authToken,
    });
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "twilio_error",
    };
  }

  const createdAt = now.toISOString();
  createSmsMessage({
    conversation_id: conversation.id,
    direction: "outbound",
    role: "agent",
    body,
    provider_message_id: messageSid,
    created_at: createdAt,
  });
  updateSmsConversation(conversation.id, { last_message_at: createdAt });

  return { ok: true, messageSid, conversation };
}

async function sendTwilioMessage(params: {
  to: string;
  from: string;
  body: string;
  accountSid: string;
  authToken: string;
}): Promise<string | null> {
  const url = `https://api.twilio.com/2010-04-01/Accounts/${params.accountSid}/Messages.json`;
  const payload = new URLSearchParams({
    To: params.to,
    From: params.from,
    Body: params.body,
  });
  const auth = Buffer.from(`${params.accountSid}:${params.authToken}`).toString("base64");
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: payload.toString(),
  });
  const text = await response.text();
  let parsed: { sid?: string; message?: string } | null = null;
  try {
    parsed = text ? (JSON.parse(text) as { sid?: string; message?: string }) : null;
  } catch {
    parsed = null;
  }
  if (!response.ok) {
    const detail = parsed?.message ? ` ${parsed.message}` : "";
    throw new Error(`twilio_error_${response.status}${detail}`);
  }
  return parsed?.sid ?? null;
}

export async function endSmsConversation(params: {
  conversation: SmsConversationRow;
  contact: SmsContactRow | null;
  reason: string;
}): Promise<void> {
  if (params.conversation.status !== "active") return;
  const nowIso = new Date().toISOString();
  const projectId = params.conversation.project_id || params.contact?.project_id || null;

  const messages = listSmsMessages({ conversation_id: params.conversation.id });
  const conversationPatch: Parameters<typeof updateSmsConversation>[1] = {
    status: "ended",
    ended_at: nowIso,
    ended_reason: params.reason,
  };
  if (!params.conversation.project_id && projectId) {
    conversationPatch.project_id = projectId;
  }
  updateSmsConversation(params.conversation.id, conversationPatch);

  if (!projectId) {
    return;
  }

  const summary = buildSummary(messages, params.contact);
  const transcript = buildTranscript(messages);
  const payload = buildPayload({
    conversation: {
      ...params.conversation,
      project_id: projectId,
      ended_at: nowIso,
      ended_reason: params.reason,
      status: "ended",
    },
    contact: params.contact,
    messages,
  });
  const body = `SMS conversation (${params.conversation.phone_number})\n\n${transcript}`;

  createProjectCommunication({
    project_id: projectId,
    intent: "request",
    summary,
    body,
    payload,
    from_scope: "user",
    to_scope: "global",
  });
}

export function resolveSmsCommunicationPayload(payload: string | null): {
  conversationId: string;
  phoneNumber: string;
} | null {
  if (!payload) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const record = parsed as Record<string, unknown>;
  const conversationId =
    typeof record.sms_conversation_id === "string" ? record.sms_conversation_id : "";
  const phoneNumber =
    typeof record.phone_number === "string" ? record.phone_number : "";
  if (!conversationId || !phoneNumber) return null;
  return { conversationId, phoneNumber };
}

export function markSmsConversationProcessed(conversationId: string): void {
  const nowIso = new Date().toISOString();
  updateSmsConversation(conversationId, {
    status: "processed",
    processed_at: nowIso,
  });
}

export function sweepStaleSmsConversations(): {
  checked: number;
  ended: number;
} {
  const config = getSmsConfig();
  const cutoff = new Date(Date.now() - config.conversationTimeoutMinutes * 60 * 1000);
  const stale = listStaleSmsConversations({
    lastMessageBefore: cutoff.toISOString(),
    limit: 200,
  });
  let ended = 0;
  for (const conversation of stale) {
    const contact = getSmsContactByPhone(conversation.phone_number);
    void endSmsConversation({
      conversation,
      contact,
      reason: "timeout",
    });
    ended += 1;
  }
  return { checked: stale.length, ended };
}

export function getPrimarySmsRecipient(): SmsContactRow | null {
  return getPrimarySmsContact();
}
