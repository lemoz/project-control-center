import crypto from "crypto";
import {
  createProjectCommunication,
  findProjectByPath,
  listProjects,
  startGlobalShift,
  type ProjectRow,
} from "./db.js";
import {
  getGlobalAgentId,
  getGlobalAgentType,
  getSlackClientId,
  getSlackClientSecret,
  getSlackConversationTimeoutMinutes,
  getSlackRedirectUri,
  getSlackScopes,
  getSlackSigningSecret,
} from "./config.js";
import {
  createSlackConversation,
  createSlackOAuthState,
  consumeSlackOAuthState,
  findActiveSlackConversation,
  getSlackConversationById,
  getSlackInstallationByTeam,
  listSlackConversationMessages,
  listSlackInstallations,
  listStaleSlackConversations,
  recordSlackConversationMessage,
  updateSlackConversation,
  upsertSlackInstallation,
  type SlackConversationMessageRow,
  type SlackConversationRow,
  type SlackInstallationRow,
} from "./slack_db.js";

type SlackEnvelope = {
  type: string;
  challenge?: string;
  team_id?: string;
  event?: Record<string, unknown>;
};

type SlackEvent = {
  type: string;
  user?: string;
  text?: string;
  channel?: string;
  ts?: string;
  thread_ts?: string;
  channel_type?: string;
  bot_id?: string;
  bot_profile?: Record<string, unknown>;
  subtype?: string;
};

type SlackApiResponse = {
  ok: boolean;
  error?: string;
  [key: string]: unknown;
};

type SlackMessageSendResult = {
  ok: boolean;
  error?: string;
  slack_ts?: string;
  conversation?: SlackConversationRow;
  message?: SlackConversationMessageRow;
};

type SlackEventResult = {
  status: number;
  body: Record<string, unknown>;
};

type SlackSignatureVerification = {
  ok: boolean;
  error?: string;
};

const END_COMMANDS = ["/end", "end conversation", "end convo", "close conversation"];
const END_PHRASES = [
  "done",
  "thanks",
  "thank you",
  "thx",
  "that's all",
  "thats all",
  "all good",
  "nothing else",
  "no more",
];

function nowIso(): string {
  return new Date().toISOString();
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  return value as Record<string, unknown>;
}

function readString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function stripSlackMentions(value: string): string {
  return value.replace(/<@[A-Z0-9]+>/gi, "").replace(/\s+/g, " ").trim();
}

function slackTsToIso(value: string | undefined): string | null {
  if (!value) return null;
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed * 1000).toISOString();
}

function timingSafeEqualString(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function buildConversationSummary(messages: SlackConversationMessageRow[]): string {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message.role !== "user") continue;
    const content = message.content.trim();
    if (!content) continue;
    return content.length > 140 ? `${content.slice(0, 137)}...` : content;
  }
  return "Slack conversation";
}

function formatConversationBody(messages: SlackConversationMessageRow[]): string {
  return messages
    .map((message) => {
      const label =
        message.role === "assistant"
          ? "Assistant"
          : message.role === "system"
            ? "System"
            : "User";
      return `${label}: ${message.content}`;
    })
    .join("\n");
}

function resolveDefaultProjectId(): string | null {
  const byPath = findProjectByPath(process.cwd());
  if (byPath) return byPath.id;
  const projects = listProjects();
  return projects.length ? projects[0].id : null;
}

function detectProjectIdFromText(text: string): string | null {
  const normalized = normalizeText(text);
  if (!normalized) return null;
  const projects = listProjects();
  for (const project of projects) {
    const tokens = buildProjectTokens(project);
    for (const token of tokens) {
      if (!token) continue;
      if (normalized.includes(token)) return project.id;
    }
  }
  return null;
}

function buildProjectTokens(project: ProjectRow): string[] {
  const tokens = [
    project.id,
    project.name,
    project.path.split(/[\\/]/).filter(Boolean).pop() ?? "",
  ]
    .map((value) => normalizeText(value))
    .filter((value) => value.length > 2);
  return Array.from(new Set(tokens));
}

function classifyConversationEnd(text: string): "explicit" | "natural" | null {
  const normalized = normalizeText(text);
  if (!normalized) return null;
  if (END_COMMANDS.some((command) => normalized.includes(command))) {
    return "explicit";
  }
  if (
    END_PHRASES.some(
      (phrase) =>
        normalized === phrase ||
        normalized.startsWith(`${phrase} `) ||
        normalized.endsWith(` ${phrase}`)
    )
  ) {
    return "natural";
  }
  return null;
}

function inferIntent(messages: SlackConversationMessageRow[]): "request" | "message" {
  for (const message of messages) {
    if (message.role !== "user") continue;
    const content = message.content.toLowerCase();
    if (content.includes("?")) return "request";
    if (content.startsWith("can you") || content.startsWith("could you")) {
      return "request";
    }
    if (content.includes("please")) return "request";
  }
  return "message";
}

function resolveSlackInstallation(teamId: string | null): SlackInstallationRow | null {
  if (teamId) return getSlackInstallationByTeam(teamId);
  const installs = listSlackInstallations();
  if (installs.length === 1) return installs[0];
  return null;
}

async function callSlackApi(
  token: string,
  method: string,
  payload: Record<string, unknown>
): Promise<SlackApiResponse> {
  const res = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(payload),
  });
  const data = (await res.json().catch(() => null)) as SlackApiResponse | null;
  if (!data) return { ok: false, error: "invalid Slack response" };
  return data;
}

async function openSlackDm(token: string, userId: string): Promise<string | null> {
  const response = await callSlackApi(token, "conversations.open", { users: userId });
  if (!response.ok) return null;
  const channel = asRecord(response.channel);
  const channelId = readString(channel?.id);
  return channelId ?? null;
}

function isDirectMessageChannelId(channelId: string): boolean {
  return channelId.startsWith("D");
}

async function finalizeConversation(params: {
  conversation: SlackConversationRow;
  ended_at: string;
  reason: "explicit" | "natural" | "timeout";
}): Promise<void> {
  const messages = listSlackConversationMessages(params.conversation.id);
  const combinedText = messages.map((message) => message.content).join("\n");
  const detectedProjectId = detectProjectIdFromText(combinedText);
  const projectId =
    params.conversation.project_id ?? detectedProjectId ?? resolveDefaultProjectId();
  if (!projectId) {
    updateSlackConversation({
      id: params.conversation.id,
      status: "ended",
      ended_at: params.ended_at,
    });
    return;
  }

  const summary = buildConversationSummary(messages);
  const body = formatConversationBody(messages);
  const intent = inferIntent(messages);
  const payload = JSON.stringify({
    source: "slack",
    conversation_id: params.conversation.id,
    slack_team_id: params.conversation.slack_team_id,
    slack_channel_id: params.conversation.slack_channel_id,
    slack_user_id: params.conversation.slack_user_id,
    slack_thread_ts: params.conversation.slack_thread_ts,
    started_at: params.conversation.started_at,
    ended_at: params.ended_at,
    reason: params.reason,
    messages: messages.map((message) => ({
      role: message.role,
      content: message.content,
      created_at: message.created_at,
    })),
  });

  createProjectCommunication({
    project_id: projectId,
    intent,
    summary: `Slack conversation: ${summary}`,
    body,
    payload,
    from_scope: "user",
    to_scope: "global",
  });

  const shiftResult = startGlobalShift({
    agentType: getGlobalAgentType(),
    agentId: getGlobalAgentId(),
    timeoutMinutes: null,
  });

  updateSlackConversation({
    id: params.conversation.id,
    status: "processed",
    project_id: projectId,
    ended_at: params.ended_at,
    processed_at: nowIso(),
    global_shift_id: shiftResult.ok ? shiftResult.shift.id : null,
  });
}

async function processSlackMessageEvent(params: {
  envelope: SlackEnvelope;
  event: SlackEvent;
}): Promise<void> {
  if (params.event.bot_id || params.event.bot_profile) return;
  if (params.event.subtype) return;
  const teamId = params.envelope.team_id ?? null;
  if (!teamId) return;
  const channelId = readString(params.event.channel);
  const userId = readString(params.event.user);
  const rawText = readString(params.event.text) ?? "";
  const text = stripSlackMentions(rawText);
  if (!channelId || !userId || !text) return;

  const threadTsRaw =
    readString(params.event.thread_ts) ??
    (params.event.type === "app_mention" ? readString(params.event.ts) : null);
  const threadTs = threadTsRaw ?? null;

  const timeoutMinutes = getSlackConversationTimeoutMinutes();
  let conversation = findActiveSlackConversation({
    team_id: teamId,
    channel_id: channelId,
    user_id: userId,
    thread_ts: threadTs,
  });

  const isChannelMessage =
    params.event.type === "message" && params.event.channel_type !== "im";

  if (conversation) {
    const lastMs = Date.parse(conversation.last_message_at);
    if (Number.isFinite(lastMs)) {
      const isStale = Date.now() - lastMs > timeoutMinutes * 60_000;
      if (isStale) {
        await finalizeConversation({
          conversation,
          ended_at: nowIso(),
          reason: "timeout",
        });
        conversation = null;
      }
    }
  }

  if (isChannelMessage && !conversation) {
    return;
  }

  const startedAt = slackTsToIso(params.event.ts ?? "") ?? nowIso();
  const detectedProjectId = detectProjectIdFromText(text);
  const created = conversation
    ? null
    : createSlackConversation({
        team_id: teamId,
        channel_id: channelId,
        user_id: userId,
        thread_ts: threadTs,
        project_id: detectedProjectId,
        started_at: startedAt,
        last_message_at: startedAt,
      });
  if (created) conversation = created;
  if (!conversation) return;

  if (!conversation.project_id && detectedProjectId) {
    updateSlackConversation({
      id: conversation.id,
      project_id: detectedProjectId,
    });
  }

  const createdAt = slackTsToIso(params.event.ts ?? "") ?? nowIso();
  recordSlackConversationMessage({
    conversation_id: conversation.id,
    role: "user",
    content: text,
    slack_ts: params.event.ts ?? null,
    created_at: createdAt,
  });

  const endReason = classifyConversationEnd(text);
  if (endReason) {
    await sendSlackMessage({
      team_id: teamId,
      channel_id: channelId,
      user_id: userId,
      text: "Closing this conversation and passing context to the global agent.",
      thread_ts: threadTs,
      conversation_id: conversation.id,
      project_id: detectedProjectId ?? conversation.project_id ?? null,
    });
    await finalizeConversation({
      conversation,
      ended_at: nowIso(),
      reason: endReason,
    });
    return;
  }

  if (created) {
    await sendSlackMessage({
      team_id: teamId,
      channel_id: channelId,
      user_id: userId,
      text: "Got it. Share more details, or say \"done\" to wrap up.",
      thread_ts: threadTs,
      conversation_id: conversation.id,
      project_id: detectedProjectId ?? conversation.project_id ?? null,
    });
  }
}

export function buildSlackInstallUrl(): { ok: boolean; url?: string; error?: string } {
  const clientId = getSlackClientId();
  if (!clientId) {
    return { ok: false, error: "Slack client id not configured" };
  }
  const scopes = getSlackScopes();
  let state: string;
  try {
    state = createSlackOAuthState();
  } catch (err) {
    console.warn("[slack] failed to create OAuth state", err);
    return { ok: false, error: "Slack OAuth state unavailable" };
  }
  const params = new URLSearchParams();
  params.set("client_id", clientId);
  params.set("scope", scopes.join(","));
  params.set("state", state);
  const redirectUri = getSlackRedirectUri();
  if (redirectUri) params.set("redirect_uri", redirectUri);
  return { ok: true, url: `https://slack.com/oauth/v2/authorize?${params}` };
}

export async function exchangeSlackOAuthCode(
  code: string
): Promise<{ ok: boolean; installation?: SlackInstallationRow; error?: string }> {
  const clientId = getSlackClientId();
  const clientSecret = getSlackClientSecret();
  if (!clientId || !clientSecret) {
    return { ok: false, error: "Slack OAuth credentials not configured" };
  }
  const params = new URLSearchParams();
  params.set("client_id", clientId);
  params.set("client_secret", clientSecret);
  params.set("code", code);
  const redirectUri = getSlackRedirectUri();
  if (redirectUri) params.set("redirect_uri", redirectUri);

  const res = await fetch("https://slack.com/api/oauth.v2.access", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
  const data = (await res.json().catch(() => null)) as SlackApiResponse | null;
  if (!data || !data.ok) {
    return { ok: false, error: data?.error ?? "Slack OAuth failed" };
  }
  const team = asRecord(data.team);
  const teamId = readString(team?.id);
  const teamName = readString(team?.name);
  const botToken = readString(data.access_token);
  const botUserId = readString(data.bot_user_id);
  const scope = readString(data.scope);
  if (!teamId || !botToken) {
    return { ok: false, error: "Slack OAuth response missing team or token" };
  }
  const installation = upsertSlackInstallation({
    team_id: teamId,
    team_name: teamName ?? null,
    bot_user_id: botUserId ?? null,
    bot_token: botToken,
    scope: scope ?? null,
  });
  return { ok: true, installation };
}

export function verifySlackOAuthState(
  state: string
): { ok: boolean; error?: string } {
  return consumeSlackOAuthState(state);
}

export function verifySlackSignature(params: {
  rawBody: Buffer;
  timestamp: string | null;
  signature: string | null;
}): SlackSignatureVerification {
  const signingSecret = getSlackSigningSecret();
  if (!signingSecret) return { ok: false, error: "Slack signing secret not configured" };
  if (!params.timestamp || !params.signature) {
    return { ok: false, error: "missing Slack signature headers" };
  }
  const timestamp = Number(params.timestamp);
  if (!Number.isFinite(timestamp)) {
    return { ok: false, error: "invalid Slack timestamp" };
  }
  const ageSeconds = Math.abs(Date.now() / 1000 - timestamp);
  if (ageSeconds > 60 * 5) {
    return { ok: false, error: "Slack request timestamp out of range" };
  }
  const base = `v0:${params.timestamp}:${params.rawBody.toString("utf8")}`;
  const digest = crypto.createHmac("sha256", signingSecret).update(base).digest("hex");
  const expected = `v0=${digest}`;
  if (!timingSafeEqualString(expected, params.signature)) {
    return { ok: false, error: "invalid Slack signature" };
  }
  return { ok: true };
}

export async function handleSlackEventEnvelope(payload: unknown): Promise<SlackEventResult> {
  const envelope = asRecord(payload);
  if (!envelope) return { status: 400, body: { error: "invalid payload" } };
  const type = readString(envelope.type);
  if (!type) return { status: 400, body: { error: "missing event type" } };
  if (type === "url_verification") {
    const challenge = readString(envelope.challenge);
    if (!challenge) return { status: 400, body: { error: "missing challenge" } };
    return { status: 200, body: { challenge } };
  }
  if (type !== "event_callback") {
    return { status: 200, body: { ok: true } };
  }
  const event = asRecord(envelope.event);
  if (!event) return { status: 400, body: { error: "missing event payload" } };
  const eventType = readString(event.type);
  if (!eventType) return { status: 200, body: { ok: true } };
  if (eventType === "message" || eventType === "app_mention") {
    await processSlackMessageEvent({
      envelope: {
        type,
        challenge: readString(envelope.challenge) ?? undefined,
        team_id: readString(envelope.team_id) ?? undefined,
        event,
      },
      event: event as SlackEvent,
    });
  }
  return { status: 200, body: { ok: true } };
}

export async function sendSlackMessage(params: {
  team_id?: string | null;
  channel_id?: string | null;
  user_id: string;
  text: string;
  thread_ts?: string | null;
  project_id?: string | null;
  conversation_id?: string | null;
}): Promise<SlackMessageSendResult> {
  const conversation =
    params.conversation_id ? getSlackConversationById(params.conversation_id) : null;
  const teamId = params.team_id ?? conversation?.slack_team_id ?? null;
  const installation = resolveSlackInstallation(teamId);
  if (!installation) {
    return { ok: false, error: "Slack installation not found" };
  }
  const userId = params.user_id;
  if (!userId) return { ok: false, error: "Slack user id required" };

  let channelId = params.channel_id ?? conversation?.slack_channel_id ?? null;
  if (!channelId) {
    channelId = await openSlackDm(installation.bot_token, userId);
  }
  if (!channelId) {
    return { ok: false, error: "Slack channel not resolved" };
  }

  const threadTs = params.thread_ts ?? conversation?.slack_thread_ts ?? null;
  const response = await callSlackApi(installation.bot_token, "chat.postMessage", {
    channel: channelId,
    text: params.text,
    thread_ts: threadTs ?? undefined,
  });
  if (!response.ok) {
    return { ok: false, error: response.error ?? "Slack send failed" };
  }
  const slackTs = readString(response.ts) ?? null;

  let activeConversation = conversation;
  if (!activeConversation) {
    activeConversation =
      findActiveSlackConversation({
        team_id: installation.team_id,
        channel_id: channelId,
        user_id: userId,
        thread_ts: threadTs,
      }) ??
      createSlackConversation({
        team_id: installation.team_id,
        channel_id: channelId,
        user_id: userId,
        thread_ts: threadTs,
        project_id: params.project_id ?? null,
        started_at: nowIso(),
        last_message_at: nowIso(),
      });
  }

  if (
    activeConversation &&
    !threadTs &&
    slackTs &&
    !activeConversation.slack_thread_ts &&
    !isDirectMessageChannelId(channelId)
  ) {
    const updated = updateSlackConversation({
      id: activeConversation.id,
      slack_thread_ts: slackTs,
    });
    if (updated) {
      activeConversation = updated;
    }
  }

  const message = recordSlackConversationMessage({
    conversation_id: activeConversation.id,
    role: "assistant",
    content: params.text,
    slack_ts: slackTs,
    created_at: nowIso(),
  });

  return { ok: true, slack_ts: slackTs ?? undefined, conversation: activeConversation, message };
}

export async function expireSlackConversations(): Promise<number> {
  const timeoutMinutes = getSlackConversationTimeoutMinutes();
  const stale = listStaleSlackConversations(timeoutMinutes);
  for (const conversation of stale) {
    await finalizeConversation({
      conversation,
      ended_at: nowIso(),
      reason: "timeout",
    });
  }
  return stale.length;
}
