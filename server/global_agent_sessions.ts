import crypto from "crypto";
import { createChatMessage, ensureChatThread } from "./chat_db.js";
import {
  getGlobalAgentSessionCheckInDecisions,
  getGlobalAgentSessionCheckInMinutes,
  getGlobalAgentSessionMaxDurationMinutes,
  getGlobalAgentSessionMaxIterations,
} from "./config.js";
import { getDb } from "./db.js";
import { runGlobalAgentShift } from "./global_agent.js";
import type { GlobalDecisionSessionContext } from "./prompts/global_decision.js";

export type GlobalAgentSessionState =
  | "onboarding"
  | "briefing"
  | "autonomous"
  | "debrief"
  | "ended";

export type OnboardingRubricItem = {
  id: string;
  label: string;
  done: boolean;
  optional?: boolean;
};

export type IntegrationsConfigured = {
  github: boolean;
  slack: boolean;
  linear: boolean;
};

export type SessionConstraints = {
  max_budget_usd?: number;
  max_duration_minutes?: number;
  max_iterations?: number;
  do_not_touch?: string[];
};

export type GlobalAgentSession = {
  id: string;
  chat_thread_id: string | null;
  state: GlobalAgentSessionState;
  onboarding_rubric: OnboardingRubricItem[];
  integrations_configured: IntegrationsConfigured;
  goals: string[];
  priority_projects: string[];
  constraints: SessionConstraints;
  briefing_summary: string | null;
  briefing_confirmed_at: string | null;
  autonomous_started_at: string | null;
  paused_at: string | null;
  iteration_count: number;
  decisions_count: number;
  actions_count: number;
  last_check_in_at: string | null;
  ended_at: string | null;
  created_at: string;
  updated_at: string;
};

export type GlobalAgentSessionEventType =
  | "onboarding_step"
  | "briefing_confirmed"
  | "check_in"
  | "guidance"
  | "alert"
  | "paused"
  | "resumed"
  | "completion";

export type GlobalAgentSessionEvent = {
  id: string;
  session_id: string;
  type: GlobalAgentSessionEventType;
  payload: Record<string, unknown> | null;
  created_at: string;
};

type GlobalAgentSessionRow = {
  id: string;
  chat_thread_id: string | null;
  state: GlobalAgentSessionState;
  onboarding_rubric: string | null;
  integrations_configured: string | null;
  goals: string | null;
  priority_projects: string | null;
  constraints: string | null;
  briefing_summary: string | null;
  briefing_confirmed_at: string | null;
  autonomous_started_at: string | null;
  paused_at: string | null;
  iteration_count: number;
  decisions_count: number;
  actions_count: number;
  last_check_in_at: string | null;
  ended_at: string | null;
  created_at: string;
  updated_at: string;
};

type GlobalAgentSessionEventRow = {
  id: string;
  session_id: string;
  type: GlobalAgentSessionEventType;
  payload: string | null;
  created_at: string;
};

type SessionDetailsPatch = {
  onboarding_rubric?: OnboardingRubricItem[];
  integrations_configured?: IntegrationsConfigured;
  goals?: string[];
  priority_projects?: string[];
  constraints?: SessionConstraints;
  briefing_summary?: string | null;
};

const DEFAULT_ONBOARDING_RUBRIC: OnboardingRubricItem[] = [
  {
    id: "projects_discovered",
    label: "Projects discovered and cataloged",
    done: false,
  },
  {
    id: "success_criteria_defined",
    label: "Success criteria defined (.control.yml)",
    done: false,
  },
  {
    id: "github_configured",
    label: "GitHub integration configured (optional)",
    done: false,
    optional: true,
  },
  {
    id: "slack_configured",
    label: "Slack notifications configured (optional)",
    done: false,
    optional: true,
  },
  {
    id: "linear_configured",
    label: "Linear sync configured (optional)",
    done: false,
    optional: true,
  },
  {
    id: "budget_limits_set",
    label: "Budget limits set",
    done: false,
  },
  {
    id: "preferences_captured",
    label: "User preferences captured",
    done: false,
  },
];

const DEFAULT_CONSTRAINTS: SessionConstraints = {};
const DEFAULT_INTEGRATIONS: IntegrationsConfigured = {
  github: false,
  slack: false,
  linear: false,
};

const DEFAULT_MAX_ITERATIONS = 6;
const DEFAULT_MAX_DURATION_MINUTES = 120;
const DEFAULT_CHECKIN_MINUTES = 25;
const DEFAULT_CHECKIN_DECISIONS = 5;

const SESSION_STATE_TRANSITIONS: Record<GlobalAgentSessionState, GlobalAgentSessionState[]> = {
  onboarding: ["briefing"],
  briefing: ["autonomous", "ended"],
  autonomous: ["briefing", "debrief"],
  debrief: ["ended", "briefing"],
  ended: [],
};

const ACTIVE_SESSION_LOOPS = new Set<string>();

function nowIso(): string {
  return new Date().toISOString();
}

function parseStringArray(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((entry) => String(entry).trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function normalizeStringArrayInput(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((entry) => String(entry).trim()).filter(Boolean);
}

function normalizeRubricItems(raw: unknown): OnboardingRubricItem[] {
  if (!Array.isArray(raw)) return [];
  const items: OnboardingRubricItem[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    const id = typeof record.id === "string" ? record.id.trim() : "";
    const label = typeof record.label === "string" ? record.label.trim() : "";
    if (!id || !label) continue;
    const done = Boolean(record.done);
    const optional = record.optional === true;
    items.push(optional ? { id, label, done, optional } : { id, label, done });
  }
  return items;
}

function mergeRubricDefaults(items: OnboardingRubricItem[]): OnboardingRubricItem[] {
  if (!items.length) return DEFAULT_ONBOARDING_RUBRIC.slice();
  const byId = new Map(items.map((item) => [item.id, item]));
  return DEFAULT_ONBOARDING_RUBRIC.map((item) => {
    const existing = byId.get(item.id);
    if (!existing) return item;
    return existing.optional ? { ...item, done: existing.done, optional: true } : { ...item, done: existing.done };
  });
}

function parseRubric(raw: string | null): OnboardingRubricItem[] {
  if (!raw) return DEFAULT_ONBOARDING_RUBRIC.slice();
  try {
    const parsed = JSON.parse(raw) as unknown;
    const normalized = normalizeRubricItems(parsed);
    return mergeRubricDefaults(normalized);
  } catch {
    return DEFAULT_ONBOARDING_RUBRIC.slice();
  }
}

function normalizeIntegrations(raw: unknown): IntegrationsConfigured {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_INTEGRATIONS };
  const record = raw as Record<string, unknown>;
  return {
    github: Boolean(record.github),
    slack: Boolean(record.slack),
    linear: Boolean(record.linear),
  };
}

function parseIntegrations(raw: string | null): IntegrationsConfigured {
  if (!raw) return { ...DEFAULT_INTEGRATIONS };
  try {
    const parsed = JSON.parse(raw) as unknown;
    return normalizeIntegrations(parsed);
  } catch {
    return { ...DEFAULT_INTEGRATIONS };
  }
}

function normalizeConstraints(raw: unknown): SessionConstraints {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_CONSTRAINTS };
  const record = raw as Record<string, unknown>;
  const constraints: SessionConstraints = {};
  const maxBudget =
    typeof record.max_budget_usd === "number" && Number.isFinite(record.max_budget_usd)
      ? record.max_budget_usd
      : null;
  if (maxBudget !== null && maxBudget >= 0) constraints.max_budget_usd = maxBudget;
  const maxDuration =
    typeof record.max_duration_minutes === "number" &&
    Number.isFinite(record.max_duration_minutes)
      ? Math.trunc(record.max_duration_minutes)
      : null;
  if (maxDuration !== null && maxDuration > 0) {
    constraints.max_duration_minutes = maxDuration;
  }
  const maxIterations =
    typeof record.max_iterations === "number" && Number.isFinite(record.max_iterations)
      ? Math.trunc(record.max_iterations)
      : null;
  if (maxIterations !== null && maxIterations > 0) {
    constraints.max_iterations = maxIterations;
  }
  const doNotTouch = Array.isArray(record.do_not_touch)
    ? record.do_not_touch.map((entry) => String(entry).trim()).filter(Boolean)
    : [];
  if (doNotTouch.length) constraints.do_not_touch = doNotTouch;
  return constraints;
}

function parseConstraints(raw: string | null): SessionConstraints {
  if (!raw) return { ...DEFAULT_CONSTRAINTS };
  try {
    const parsed = JSON.parse(raw) as unknown;
    return normalizeConstraints(parsed);
  } catch {
    return { ...DEFAULT_CONSTRAINTS };
  }
}

function toSession(row: GlobalAgentSessionRow): GlobalAgentSession {
  return {
    id: row.id,
    chat_thread_id: row.chat_thread_id,
    state: row.state,
    onboarding_rubric: parseRubric(row.onboarding_rubric),
    integrations_configured: parseIntegrations(row.integrations_configured),
    goals: parseStringArray(row.goals),
    priority_projects: parseStringArray(row.priority_projects),
    constraints: parseConstraints(row.constraints),
    briefing_summary: row.briefing_summary,
    briefing_confirmed_at: row.briefing_confirmed_at,
    autonomous_started_at: row.autonomous_started_at,
    paused_at: row.paused_at,
    iteration_count: row.iteration_count ?? 0,
    decisions_count: row.decisions_count ?? 0,
    actions_count: row.actions_count ?? 0,
    last_check_in_at: row.last_check_in_at,
    ended_at: row.ended_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function toSessionEvent(row: GlobalAgentSessionEventRow): GlobalAgentSessionEvent {
  let payload: Record<string, unknown> | null = null;
  if (row.payload) {
    try {
      const parsed = JSON.parse(row.payload) as unknown;
      if (parsed && typeof parsed === "object") {
        payload = parsed as Record<string, unknown>;
      }
    } catch {
      payload = null;
    }
  }
  return {
    id: row.id,
    session_id: row.session_id,
    type: row.type,
    payload,
    created_at: row.created_at,
  };
}

function updateSessionRow(
  sessionId: string,
  patch: Partial<GlobalAgentSessionRow>
): GlobalAgentSession | null {
  const db = getDb();
  const fields: Array<keyof GlobalAgentSessionRow> = [
    "state",
    "onboarding_rubric",
    "integrations_configured",
    "goals",
    "priority_projects",
    "constraints",
    "briefing_summary",
    "briefing_confirmed_at",
    "autonomous_started_at",
    "paused_at",
    "iteration_count",
    "decisions_count",
    "actions_count",
    "last_check_in_at",
    "ended_at",
    "updated_at",
  ];
  const sets = fields
    .filter((field) => patch[field] !== undefined)
    .map((field) => `${field} = @${field}`);
  if (!sets.length) return getGlobalAgentSessionById(sessionId);
  db.prepare(`UPDATE global_agent_sessions SET ${sets.join(", ")} WHERE id = @id`).run({
    id: sessionId,
    ...patch,
  });
  const row = db
    .prepare("SELECT * FROM global_agent_sessions WHERE id = ? LIMIT 1")
    .get(sessionId) as GlobalAgentSessionRow | undefined;
  return row ? toSession(row) : null;
}

function createSessionEvent(params: {
  sessionId: string;
  type: GlobalAgentSessionEventType;
  payload?: Record<string, unknown> | null;
  touchCheckIn?: boolean;
}): GlobalAgentSessionEvent {
  const db = getDb();
  const id = crypto.randomUUID();
  const createdAt = nowIso();
  const payload =
    params.payload === undefined ? null : params.payload ? JSON.stringify(params.payload) : null;
  db.prepare(
    `INSERT INTO global_agent_session_events (id, session_id, type, payload, created_at)
     VALUES (@id, @session_id, @type, @payload, @created_at)`
  ).run({
    id,
    session_id: params.sessionId,
    type: params.type,
    payload,
    created_at: createdAt,
  });
  if (params.touchCheckIn) {
    updateSessionRow(params.sessionId, { last_check_in_at: createdAt, updated_at: createdAt });
  }
  const row = db
    .prepare("SELECT * FROM global_agent_session_events WHERE id = ? LIMIT 1")
    .get(id) as GlobalAgentSessionEventRow | undefined;
  if (!row) {
    return {
      id,
      session_id: params.sessionId,
      type: params.type,
      payload: params.payload ?? null,
      created_at: createdAt,
    };
  }
  return toSessionEvent(row);
}

function checkRubricComplete(items: OnboardingRubricItem[]): boolean {
  return items.every((item) => item.done || item.optional);
}

function resolveMaxIterations(constraints: SessionConstraints): number {
  const raw = constraints.max_iterations;
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) {
    return Math.trunc(raw);
  }
  const envValue = getGlobalAgentSessionMaxIterations();
  if (envValue) return envValue;
  return DEFAULT_MAX_ITERATIONS;
}

function resolveMaxDurationMinutes(constraints: SessionConstraints): number {
  const raw = constraints.max_duration_minutes;
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) {
    return Math.trunc(raw);
  }
  const envValue = getGlobalAgentSessionMaxDurationMinutes();
  if (envValue) return envValue;
  return DEFAULT_MAX_DURATION_MINUTES;
}

function resolveCheckInMinutes(): number {
  const envValue = getGlobalAgentSessionCheckInMinutes();
  if (envValue) return envValue;
  return DEFAULT_CHECKIN_MINUTES;
}

function resolveCheckInDecisions(): number {
  const envValue = getGlobalAgentSessionCheckInDecisions();
  if (envValue) return envValue;
  return DEFAULT_CHECKIN_DECISIONS;
}

function buildBriefingSummary(session: GlobalAgentSession): string {
  const lines: string[] = [];
  if (session.goals.length) {
    lines.push(`Goals: ${session.goals.join("; ")}`);
  }
  if (session.priority_projects.length) {
    lines.push(`Priority projects: ${session.priority_projects.join(", ")}`);
  }
  const constraints = session.constraints;
  const constraintParts: string[] = [];
  if (constraints.max_iterations) {
    constraintParts.push(`max iterations ${constraints.max_iterations}`);
  }
  if (constraints.max_duration_minutes) {
    constraintParts.push(`max duration ${constraints.max_duration_minutes}m`);
  }
  if (constraints.max_budget_usd !== undefined) {
    constraintParts.push(`max budget $${constraints.max_budget_usd}`);
  }
  if (constraints.do_not_touch && constraints.do_not_touch.length) {
    constraintParts.push(`do not touch ${constraints.do_not_touch.join(", ")}`);
  }
  if (constraintParts.length) {
    lines.push(`Constraints: ${constraintParts.join(" | ")}`);
  }
  if (!lines.length) return "Briefing captured. Ready to start autonomous execution.";
  return lines.join("\n");
}

function buildSessionContext(session: GlobalAgentSession): GlobalDecisionSessionContext {
  return {
    session_id: session.id,
    iteration_index: session.iteration_count,
    goals: session.goals,
    priority_projects: session.priority_projects,
    constraints: session.constraints,
    briefing_summary: session.briefing_summary ?? "",
  };
}

function buildStatsPayload(session: GlobalAgentSession): Record<string, unknown> {
  return {
    iteration_count: session.iteration_count,
    decisions_count: session.decisions_count,
    actions_count: session.actions_count,
    last_check_in_at: session.last_check_in_at,
    paused_at: session.paused_at,
  };
}

function shouldTriggerCheckIn(params: {
  session: GlobalAgentSession;
  now: Date;
}): { triggers: string[] } {
  const triggers: string[] = ["event"];
  const checkInMinutes = resolveCheckInMinutes();
  const lastCheck = params.session.last_check_in_at ?? params.session.autonomous_started_at;
  if (lastCheck) {
    const lastMs = Date.parse(lastCheck);
    if (Number.isFinite(lastMs)) {
      const diffMinutes = (params.now.getTime() - lastMs) / 60_000;
      if (diffMinutes >= checkInMinutes) triggers.push("time");
    }
  }
  const decisionThreshold = resolveCheckInDecisions();
  if (
    decisionThreshold > 0 &&
    params.session.decisions_count > 0 &&
    params.session.decisions_count % decisionThreshold === 0
  ) {
    triggers.push("threshold");
  }
  return { triggers };
}

function buildDebriefSummary(params: {
  session: GlobalAgentSession;
  reason: string;
  lastUpdate?: string | null;
}): string {
  const lines: string[] = [];
  lines.push(`Debrief: ${params.reason}`);
  if (params.session.goals.length) {
    lines.push(`Goals: ${params.session.goals.join("; ")}`);
  }
  lines.push(
    `Iterations: ${params.session.iteration_count}, decisions: ${params.session.decisions_count}, actions: ${params.session.actions_count}`
  );
  if (params.lastUpdate) {
    lines.push(`Latest update: ${params.lastUpdate}`);
  }
  return lines.join("\n");
}

export function getGlobalAgentSessionById(sessionId: string): GlobalAgentSession | null {
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM global_agent_sessions WHERE id = ? LIMIT 1")
    .get(sessionId) as GlobalAgentSessionRow | undefined;
  return row ? toSession(row) : null;
}

export function getActiveGlobalAgentSession(): GlobalAgentSession | null {
  const db = getDb();
  const row = db
    .prepare(
      "SELECT * FROM global_agent_sessions WHERE state != 'ended' ORDER BY created_at DESC LIMIT 1"
    )
    .get() as GlobalAgentSessionRow | undefined;
  return row ? toSession(row) : null;
}

export function listGlobalAgentSessionEvents(params: {
  sessionId: string;
  limit?: number;
}): GlobalAgentSessionEvent[] {
  const db = getDb();
  const limit =
    typeof params.limit === "number" && Number.isFinite(params.limit)
      ? Math.max(1, Math.min(200, Math.trunc(params.limit)))
      : 50;
  const rows = db
    .prepare(
      `SELECT *
       FROM global_agent_session_events
       WHERE session_id = ?
       ORDER BY created_at DESC
       LIMIT ?`
    )
    .all(params.sessionId, limit) as GlobalAgentSessionEventRow[];
  return rows.map((row) => toSessionEvent(row));
}

export function createGlobalAgentSession(): {
  ok: true;
  session: GlobalAgentSession;
} | {
  ok: false;
  error: string;
  activeSession?: GlobalAgentSession;
} {
  const active = getActiveGlobalAgentSession();
  if (active) {
    return { ok: false, error: "session already active", activeSession: active };
  }
  const db = getDb();
  const thread = ensureChatThread({ scope: "global" });
  const lastSessionRow = db
    .prepare("SELECT * FROM global_agent_sessions ORDER BY created_at DESC LIMIT 1")
    .get() as GlobalAgentSessionRow | undefined;
  const lastSession = lastSessionRow ? toSession(lastSessionRow) : null;
  const coldStart = !lastSession;
  const state: GlobalAgentSessionState = coldStart ? "onboarding" : "briefing";
  const id = crypto.randomUUID();
  const now = nowIso();
  const integrations = lastSession?.integrations_configured ?? { ...DEFAULT_INTEGRATIONS };
  const rubric = mergeRubricDefaults(
    lastSession?.onboarding_rubric ?? DEFAULT_ONBOARDING_RUBRIC.slice()
  ).map((item) => {
    if (item.id === "github_configured") return { ...item, done: integrations.github };
    if (item.id === "slack_configured") return { ...item, done: integrations.slack };
    if (item.id === "linear_configured") return { ...item, done: integrations.linear };
    return item;
  });
  const row: GlobalAgentSessionRow = {
    id,
    chat_thread_id: thread.id,
    state,
    onboarding_rubric: JSON.stringify(rubric),
    integrations_configured: JSON.stringify(integrations),
    goals: JSON.stringify(lastSession?.goals ?? []),
    priority_projects: JSON.stringify(lastSession?.priority_projects ?? []),
    constraints: JSON.stringify(lastSession?.constraints ?? DEFAULT_CONSTRAINTS),
    briefing_summary: lastSession?.briefing_summary ?? null,
    briefing_confirmed_at: null,
    autonomous_started_at: null,
    paused_at: null,
    iteration_count: 0,
    decisions_count: 0,
    actions_count: 0,
    last_check_in_at: null,
    ended_at: null,
    created_at: now,
    updated_at: now,
  };
  db.prepare(
    `INSERT INTO global_agent_sessions
      (id, chat_thread_id, state, onboarding_rubric, integrations_configured, goals, priority_projects, constraints, briefing_summary, briefing_confirmed_at, autonomous_started_at, paused_at, iteration_count, decisions_count, actions_count, last_check_in_at, ended_at, created_at, updated_at)
     VALUES
      (@id, @chat_thread_id, @state, @onboarding_rubric, @integrations_configured, @goals, @priority_projects, @constraints, @briefing_summary, @briefing_confirmed_at, @autonomous_started_at, @paused_at, @iteration_count, @decisions_count, @actions_count, @last_check_in_at, @ended_at, @created_at, @updated_at)`
  ).run(row);
  return { ok: true, session: toSession(row) };
}

export function updateGlobalAgentSessionDetails(
  sessionId: string,
  input: unknown
): { ok: true; session: GlobalAgentSession } | { ok: false; error: string } {
  if (!input || typeof input !== "object") {
    return { ok: false, error: "patch must be an object" };
  }
  const record = input as Record<string, unknown>;
  const patch: SessionDetailsPatch = {};

  if ("onboarding_rubric" in record) {
    if (!Array.isArray(record.onboarding_rubric)) {
      return { ok: false, error: "onboarding_rubric must be an array" };
    }
    patch.onboarding_rubric = mergeRubricDefaults(
      normalizeRubricItems(record.onboarding_rubric)
    );
  }

  if ("integrations_configured" in record) {
    patch.integrations_configured = normalizeIntegrations(record.integrations_configured);
  }

  if ("goals" in record) {
    patch.goals = normalizeStringArrayInput(record.goals);
  }

  if ("priority_projects" in record) {
    patch.priority_projects = normalizeStringArrayInput(record.priority_projects);
  }

  if ("constraints" in record) {
    if (
      !record.constraints ||
      typeof record.constraints !== "object" ||
      Array.isArray(record.constraints)
    ) {
      return { ok: false, error: "constraints must be an object" };
    }
    patch.constraints = normalizeConstraints(record.constraints);
  }

  if ("briefing_summary" in record) {
    if (record.briefing_summary === null) {
      patch.briefing_summary = null;
    } else if (typeof record.briefing_summary === "string") {
      patch.briefing_summary = record.briefing_summary.trim();
    } else {
      return { ok: false, error: "briefing_summary must be a string or null" };
    }
  }

  if (!Object.keys(patch).length) {
    return { ok: false, error: "no valid fields to update" };
  }

  const now = nowIso();
  const update: Partial<GlobalAgentSessionRow> = {
    updated_at: now,
  };
  if (patch.onboarding_rubric !== undefined) {
    update.onboarding_rubric = JSON.stringify(patch.onboarding_rubric);
  }
  if (patch.integrations_configured !== undefined) {
    update.integrations_configured = JSON.stringify(patch.integrations_configured);
  }
  if (patch.goals !== undefined) update.goals = JSON.stringify(patch.goals);
  if (patch.priority_projects !== undefined) {
    update.priority_projects = JSON.stringify(patch.priority_projects);
  }
  if (patch.constraints !== undefined) {
    update.constraints = JSON.stringify(patch.constraints);
  }
  if (patch.briefing_summary !== undefined) {
    update.briefing_summary = patch.briefing_summary;
  }

  const updated = updateSessionRow(sessionId, update);
  if (!updated) {
    return { ok: false, error: "session not found" };
  }

  if (patch.integrations_configured) {
    const rubric = mergeRubricDefaults(updated.onboarding_rubric).map((item) => {
      if (item.id === "github_configured") {
        return { ...item, done: patch.integrations_configured?.github ?? item.done };
      }
      if (item.id === "slack_configured") {
        return { ...item, done: patch.integrations_configured?.slack ?? item.done };
      }
      if (item.id === "linear_configured") {
        return { ...item, done: patch.integrations_configured?.linear ?? item.done };
      }
      return item;
    });
    const synced = updateSessionRow(sessionId, {
      onboarding_rubric: JSON.stringify(rubric),
      updated_at: nowIso(),
    });
    return { ok: true, session: synced ?? updated };
  }

  return { ok: true, session: updated };
}

export function completeGlobalAgentOnboarding(
  sessionId: string
): { ok: true; session: GlobalAgentSession } | { ok: false; error: string } {
  const session = getGlobalAgentSessionById(sessionId);
  if (!session) return { ok: false, error: "session not found" };
  if (session.state !== "onboarding") {
    return { ok: false, error: "session not in onboarding" };
  }
  if (!checkRubricComplete(session.onboarding_rubric)) {
    return { ok: false, error: "onboarding rubric incomplete" };
  }
  const now = nowIso();
  const updated = updateSessionRow(sessionId, { state: "briefing", updated_at: now });
  if (!updated) return { ok: false, error: "failed to update session" };
  createSessionEvent({
    sessionId,
    type: "onboarding_step",
    payload: { status: "completed" },
  });
  return { ok: true, session: updated };
}

export function pauseGlobalAgentSession(
  sessionId: string,
  reason: string
): { ok: true; session: GlobalAgentSession } | { ok: false; error: string } {
  const session = getGlobalAgentSessionById(sessionId);
  if (!session) return { ok: false, error: "session not found" };
  if (session.state !== "autonomous") {
    return { ok: false, error: "session not autonomous" };
  }
  const now = nowIso();
  const updated = updateSessionRow(sessionId, {
    state: "briefing",
    paused_at: now,
    updated_at: now,
  });
  if (!updated) return { ok: false, error: "failed to pause session" };
  createSessionEvent({
    sessionId,
    type: "paused",
    payload: { reason },
  });
  return { ok: true, session: updated };
}

export function startGlobalAgentSessionAutonomous(params: {
  sessionId: string;
  resume?: boolean;
}): { ok: true; session: GlobalAgentSession } | { ok: false; error: string } {
  const session = getGlobalAgentSessionById(params.sessionId);
  if (!session) return { ok: false, error: "session not found" };
  if (session.state !== "briefing") {
    return { ok: false, error: "session not in briefing" };
  }
  const now = nowIso();
  const isResume = params.resume === true || Boolean(session.paused_at);
  const summary =
    session.briefing_summary && session.briefing_summary.trim()
      ? session.briefing_summary.trim()
      : buildBriefingSummary(session);
  const updated = updateSessionRow(params.sessionId, {
    state: "autonomous",
    briefing_summary: summary,
    briefing_confirmed_at: session.briefing_confirmed_at ?? now,
    autonomous_started_at: session.autonomous_started_at ?? now,
    paused_at: null,
    updated_at: now,
  });
  if (!updated) return { ok: false, error: "failed to start session" };
  createSessionEvent({
    sessionId: params.sessionId,
    type: isResume ? "resumed" : "briefing_confirmed",
    payload: { summary },
  });
  void startSessionLoop(params.sessionId);
  return { ok: true, session: updated };
}

export function stopGlobalAgentSession(
  sessionId: string,
  reason: string
): { ok: true; session: GlobalAgentSession; summary: string } | { ok: false; error: string } {
  const session = getGlobalAgentSessionById(sessionId);
  if (!session) return { ok: false, error: "session not found" };
  if (session.state !== "autonomous" && session.state !== "briefing") {
    return { ok: false, error: "session not active" };
  }
  const now = nowIso();
  const updated = updateSessionRow(sessionId, {
    state: "debrief",
    updated_at: now,
  });
  if (!updated) return { ok: false, error: "failed to stop session" };
  const events = listGlobalAgentSessionEvents({ sessionId, limit: 5 });
  const lastUpdate = events.find((event) => event.type === "check_in")?.payload?.message as
    | string
    | undefined;
  const summary = buildDebriefSummary({
    session: updated,
    reason,
    lastUpdate: lastUpdate ?? null,
  });
  createSessionEvent({
    sessionId,
    type: "completion",
    payload: { summary, reason, stats: buildStatsPayload(updated) },
    touchCheckIn: true,
  });
  if (updated.chat_thread_id) {
    createChatMessage({
      threadId: updated.chat_thread_id,
      role: "assistant",
      content: summary,
    });
  }
  return { ok: true, session: updated, summary };
}

export function endGlobalAgentSession(
  sessionId: string
): { ok: true; session: GlobalAgentSession } | { ok: false; error: string } {
  const session = getGlobalAgentSessionById(sessionId);
  if (!session) return { ok: false, error: "session not found" };
  if (session.state !== "debrief") {
    return { ok: false, error: "session not in debrief" };
  }
  const now = nowIso();
  const updated = updateSessionRow(sessionId, {
    state: "ended",
    ended_at: now,
    updated_at: now,
  });
  if (!updated) return { ok: false, error: "failed to end session" };
  return { ok: true, session: updated };
}

export function pauseAutonomousSessionForUserMessage(): void {
  const session = getActiveGlobalAgentSession();
  if (!session || session.state !== "autonomous") return;
  pauseGlobalAgentSession(session.id, "user_interruption");
}

/**
 * Recover an autonomous session whose loop died (e.g. after server restart).
 * Call from server startup to resume any session stuck in "autonomous" state.
 */
export function recoverAutonomousSessionLoop(): void {
  const session = getActiveGlobalAgentSession();
  if (!session || session.state !== "autonomous") return;
  if (ACTIVE_SESSION_LOOPS.has(session.id)) return;
  // eslint-disable-next-line no-console
  console.log(`Recovering autonomous session loop for ${session.id}`);
  void startSessionLoop(session.id);
}

async function startSessionLoop(sessionId: string): Promise<void> {
  if (ACTIVE_SESSION_LOOPS.has(sessionId)) return;
  ACTIVE_SESSION_LOOPS.add(sessionId);
  try {
    await runSessionLoop(sessionId);
  } finally {
    ACTIVE_SESSION_LOOPS.delete(sessionId);
  }
}

async function runSessionLoop(sessionId: string): Promise<void> {
  while (true) {
    const session = getGlobalAgentSessionById(sessionId);
    if (!session || session.state !== "autonomous") return;

    const now = new Date();
    const maxIterations = resolveMaxIterations(session.constraints);
    const maxDurationMinutes = resolveMaxDurationMinutes(session.constraints);
    if (session.iteration_count >= maxIterations) {
      stopGlobalAgentSession(sessionId, "Reached max iterations");
      return;
    }
    if (session.autonomous_started_at) {
      const startedAt = Date.parse(session.autonomous_started_at);
      if (Number.isFinite(startedAt)) {
        const elapsedMinutes = (now.getTime() - startedAt) / 60_000;
        if (elapsedMinutes >= maxDurationMinutes) {
          stopGlobalAgentSession(sessionId, "Reached max duration");
          return;
        }
      }
    }

    const sessionContext = buildSessionContext(session);
    const shiftResult = await runGlobalAgentShift({
      session: sessionContext,
    });

    if (!shiftResult.ok) {
      createSessionEvent({
        sessionId,
        type: "alert",
        payload: { reason: shiftResult.error },
        touchCheckIn: true,
      });
      pauseGlobalAgentSession(sessionId, "shift_failed");
      return;
    }

    const decisionsDelta = shiftResult.actions.length;
    const actionsDelta = shiftResult.actions.filter((action) => action.ok).length;
    const updated = updateSessionRow(sessionId, {
      iteration_count: session.iteration_count + 1,
      decisions_count: session.decisions_count + decisionsDelta,
      actions_count: session.actions_count + actionsDelta,
      updated_at: nowIso(),
    });
    if (!updated) return;

    const guidanceNeeded = shiftResult.actions.some((action) => !action.ok);
    if (guidanceNeeded) {
      createSessionEvent({
        sessionId,
        type: "guidance",
        payload: {
          message: "Guidance needed on the last shift actions.",
          actions: shiftResult.actions,
        },
        touchCheckIn: true,
      });
      if (updated.chat_thread_id) {
        createChatMessage({
          threadId: updated.chat_thread_id,
          role: "assistant",
          content: "Guidance needed before continuing autonomous mode. Resume or stop?",
          needsUserInput: true,
        });
      }
      pauseGlobalAgentSession(sessionId, "guidance_needed");
      return;
    }

    const actionSummary = shiftResult.actions.map((action) => action.detail).join("; ");
    const checkIn = shouldTriggerCheckIn({ session: updated, now });
    createSessionEvent({
      sessionId,
      type: "check_in",
      payload: {
        message: actionSummary || "Iteration completed.",
        actions: shiftResult.actions,
        triggers: checkIn.triggers,
        stats: buildStatsPayload(updated),
        shift_id: shiftResult.shift.id,
      },
      touchCheckIn: true,
    });
  }
}
