import crypto from "crypto";
import { execFile, spawn } from "child_process";
import fs from "fs";
import path from "path";
import { promisify } from "util";
import {
  findProjectById,
  getDb,
  getRunById,
  listEscalations,
  listProjects,
  type ProjectRow,
  type RunRow,
} from "./db.js";
import {
  extractTokenUsageFromClaudeResponse,
  parseCodexTokenUsageFromLog,
  recordCostEntry,
  type TokenUsage,
} from "./cost_tracking.js";
import { listChatThreads } from "./chat_db.js";
import { resolveUtilitySettings } from "./settings.js";
import { listWorkOrders, type WorkOrder } from "./work_orders.js";
import {
  buildNarrationPrompt,
  type NarrationPromptInput,
  type NarrationRunContext,
  type NarrationBlockedWorkOrder,
  type NarrationChange,
  type NarrationChatThreadSummary,
  type NarrationCompletion,
  type NarrationDecision,
  type NarrationEscalation,
  type NarrationProjectSummary,
} from "./prompts/narration.js";

const execFileAsync = promisify(execFile);

const DEFAULT_CODEX_MODEL = "gpt-5.2-codex";
const CLAUDE_NARRATION_MODEL = "claude-3-5-sonnet-20241022";
const CODEX_TIMEOUT_MS = 20_000;
const CLAUDE_TIMEOUT_MS = 20_000;
const RATE_LIMIT_MS = 30_000;
const MAX_EVENTS = 6;
const MAX_ACTIVE_RUNS = 6;
const MAX_RECENT_NARRATIONS = 6;
const MAX_NARRATION_CHARS = 600;
const CHANGE_WINDOW_MS = 24 * 60 * 60 * 1000;
const TOPIC_COOLDOWN_MS = 30 * 60 * 1000;
const MAX_CHAT_THREADS = 4;
const MAX_CHAT_DECISIONS = 6;
const MAX_COMPLETIONS = 6;
const MAX_PENDING_ESCALATIONS = 6;
const MAX_BLOCKED_WOS = 6;
const MAX_CHANGES = 8;
const REPORTED_TOPIC_LIMIT = 10;
const ACTIVE_RUN_STATUSES = ["queued", "building", "waiting_for_input", "ai_review", "testing"];
const IN_PROGRESS_WO_STATUSES = new Set(["building", "ai_review", "you_review"]);
const CHANGE_CATEGORY_ORDER = {
  escalation: 0,
  completion: 1,
  status: 2,
  decision: 3,
  progress: 4,
  chat: 5,
} as const;

let lastNarrationAt = 0;
let lastNarrationRecordedAt = 0;
let narrationInFlight = false;
const recentNarrationCache: string[] = [];
const reportedTopicCache = new Map<string, { summary: string; reportedAt: number }>();
const workOrderStatusCache = new Map<string, WorkOrderStatusSnapshot>();
let workOrderStatusTransitions: WorkOrderStatusTransition[] = [];
let workOrderStatusCachePrimed = false;

export type NarrationEventType =
  | "run_started"
  | "phase_change"
  | "run_completed"
  | "escalation"
  | "periodic";

export type NarrationEventInput = {
  type: NarrationEventType;
  runId?: string | null;
  workOrderId?: string | null;
  phase?: string | null;
  status?: string | null;
  escalationSummary?: string | null;
  activeCount?: number | null;
};

export type NarrationRequest = {
  primaryEvent: NarrationEventInput;
  events: NarrationEventInput[];
  activeRunIds: string[];
  recentNarrations: string[];
};

export type NarrationResult =
  | { ok: true; text: string; provider: string; model: string }
  | { ok: false; status: number; error: string; retryAfterMs?: number };

type RunContext = NarrationRunContext & { projectId: string; projectPath: string };
type ChangeCategory = keyof typeof CHANGE_CATEGORY_ORDER;

type ChangeCandidate = {
  topic: string;
  summary: string;
  priority: NarrationChange["priority"];
  category: ChangeCategory;
  timestamp: number;
};

type WorkOrderRow = {
  project_id: string;
  id: string;
  title: string;
  status: string;
  updated_at: string;
};

type RunEscalationRow = {
  id: string;
  project_id: string;
  work_order_id: string;
  escalation: string | null;
  created_at: string;
};

type WorkOrderStatusChange = {
  workOrderId: string;
  title: string;
  status: string;
  updatedAt: string;
  projectName: string | null;
  timestamp: number;
};

type WorkOrderStatusSnapshot = {
  status: string;
  updatedAt: string | null;
  timestamp: number | null;
};

type WorkOrderStatusTransition = WorkOrderStatusChange;

type DecisionRow = {
  id: string;
  action_type: string;
  action_payload_json: string | null;
  applied_at: string;
  scope: string;
  project_id: string | null;
  work_order_id: string | null;
  name: string | null;
};

const EVENT_TYPE_SET: Set<NarrationEventType> = new Set([
  "run_started",
  "phase_change",
  "run_completed",
  "escalation",
  "periodic",
]);

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

function codexCommand(cliPath?: string): string {
  return cliPath?.trim() || process.env.CONTROL_CENTER_CODEX_PATH || "codex";
}

function claudeCommand(cliPath?: string): string {
  return cliPath?.trim() || process.env.CONTROL_CENTER_CLAUDE_PATH || "claude";
}

function writeCodexLog(logPath: string, stdout: string, stderr: string): void {
  const lines = [stdout, stderr].filter(Boolean).join("\n").trimEnd();
  if (!lines) return;
  fs.writeFileSync(logPath, `${lines}\n`, "utf8");
}

function extractClaudeText(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record.text === "string") return record.text;
  const content = record.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const item of content) {
      if (typeof item === "string") {
        parts.push(item);
        continue;
      }
      if (item && typeof item === "object") {
        const text = (item as Record<string, unknown>).text;
        if (typeof text === "string") parts.push(text);
      }
    }
    const combined = parts.join("");
    return combined.trim() ? combined : null;
  }
  return null;
}

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function clampText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 3)).trimEnd()}...`;
}

function clampSentences(text: string, maxSentences = 2): string {
  const matches = text.match(/[^.!?]+[.!?]*/g);
  if (!matches) return text;
  const limited = matches.slice(0, maxSentences).join(" ").trim();
  return limited || text;
}

function normalizeNarrationOutput(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  let cleaned = trimmed;
  const quoted =
    (cleaned.startsWith("\"") && cleaned.endsWith("\"")) ||
    (cleaned.startsWith("'") && cleaned.endsWith("'"));
  if (quoted) {
    cleaned = cleaned.slice(1, -1).trim();
  }
  cleaned = cleaned.replace(/\s+/g, " ").trim();
  const withSentences = clampSentences(cleaned, 4);
  const clamped = clampText(withSentences, MAX_NARRATION_CHARS);
  return clamped.trim() ? clamped : null;
}

function isRedundant(text: string, recent: string[]): boolean {
  const normalized = normalizeText(text);
  if (!normalized) return true;
  for (const entry of recent) {
    const prior = normalizeText(entry);
    if (!prior) continue;
    if (normalized === prior) return true;
    if (normalized.length >= 40 && (normalized.includes(prior) || prior.includes(normalized))) {
      return true;
    }
  }
  return false;
}

function readString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function readNumber(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value;
}

function readBoolean(value: unknown): boolean | null {
  if (typeof value !== "boolean") return null;
  return value;
}

function readStringArray(value: unknown, limit: number): string[] {
  if (!Array.isArray(value)) return [];
  const items: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") continue;
    const trimmed = entry.trim();
    if (!trimmed) continue;
    items.push(trimmed);
    if (items.length >= limit) break;
  }
  return items;
}

function parseIsoTimestamp(value: string | null): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseWorkOrderTimestamp(value: string | null): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const parsed = Date.parse(`${trimmed}T23:59:59Z`);
    return Number.isFinite(parsed) ? parsed : null;
  }
  const parsed = Date.parse(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function selectLatestTimestamp(values: Array<string | null | undefined>): string | null {
  let bestValue: string | null = null;
  let bestMs = -Infinity;

  for (const value of values) {
    if (typeof value !== "string" || value.length === 0) continue;
    const ms = Date.parse(value);
    if (!Number.isFinite(ms)) continue;
    if (ms > bestMs) {
      bestMs = ms;
      bestValue = value;
    }
  }

  if (bestValue) return bestValue;
  for (const value of values) {
    if (typeof value === "string" && value.length > 0) return value;
  }
  return null;
}

function limitList<T>(items: T[], limit: number): { items: T[]; omitted: number } {
  if (items.length <= limit) return { items: items.slice(), omitted: 0 };
  return { items: items.slice(0, limit), omitted: items.length - limit };
}

function buildInClause(ids: string[]): string {
  return ids.map(() => "?").join(", ");
}

function pruneReportedTopics(now: number): void {
  for (const [topic, entry] of reportedTopicCache.entries()) {
    if (now - entry.reportedAt > TOPIC_COOLDOWN_MS) {
      reportedTopicCache.delete(topic);
    }
  }
}

function pruneWorkOrderStatusTransitions(now: number): void {
  if (workOrderStatusTransitions.length === 0) return;
  const cutoff = now - CHANGE_WINDOW_MS;
  workOrderStatusTransitions = workOrderStatusTransitions.filter(
    (entry) => entry.timestamp >= cutoff
  );
}

function isTopicRecentlyReported(topic: string, now: number): boolean {
  pruneReportedTopics(now);
  const entry = reportedTopicCache.get(topic);
  if (!entry) return false;
  return now - entry.reportedAt <= TOPIC_COOLDOWN_MS;
}

function listReportedTopicSummaries(now: number, limit: number): string[] {
  pruneReportedTopics(now);
  return Array.from(reportedTopicCache.values())
    .slice()
    .sort((a, b) => b.reportedAt - a.reportedAt)
    .slice(0, limit)
    .map((entry) => entry.summary);
}

function recordReportedTopics(changes: NarrationChange[], now: number): void {
  if (!changes.length) return;
  pruneReportedTopics(now);
  for (const change of changes) {
    reportedTopicCache.set(change.topic, { summary: change.summary, reportedAt: now });
  }
}

function normalizeEvent(raw: unknown): NarrationEventInput | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const type = readString(record.type);
  if (!type || !EVENT_TYPE_SET.has(type as NarrationEventType)) return null;
  return {
    type: type as NarrationEventType,
    runId: readString(record.runId),
    workOrderId: readString(record.workOrderId),
    phase: readString(record.phase),
    status: readString(record.status),
    escalationSummary: readString(record.escalationSummary),
    activeCount: readNumber(record.activeCount),
  };
}

function normalizeRequest(raw: unknown): NarrationRequest | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const eventsRaw = Array.isArray(record.events) ? record.events : [];
  const events = eventsRaw
    .map((event) => normalizeEvent(event))
    .filter((event): event is NarrationEventInput => Boolean(event))
    .slice(0, MAX_EVENTS);
  if (!events.length) return null;

  const primaryRaw =
    record.primaryEvent ?? record.primary_event ?? record.primary ?? events[0];
  const primaryEvent = normalizeEvent(primaryRaw) ?? events[0];

  const activeRunIds = readStringArray(
    record.activeRunIds ?? record.active_run_ids ?? [],
    MAX_ACTIVE_RUNS
  );
  const recentNarrations = readStringArray(
    record.recentNarrations ?? record.recent_narrations ?? [],
    MAX_RECENT_NARRATIONS
  );

  return {
    primaryEvent,
    events,
    activeRunIds,
    recentNarrations,
  };
}

function formatPhase(phase?: string | null): string {
  switch (phase) {
    case "queued":
      return "queued";
    case "builder":
      return "building";
    case "blocked":
      return "waiting for input";
    case "review":
      return "in review";
    case "tests":
      return "running tests";
    case "ready_for_review":
      return "ready for review";
    default:
      return "in progress";
  }
}

function formatStatus(status?: string | null): string {
  switch (status) {
    case "merged":
      return "merged";
    case "you_review":
      return "ready for review";
    case "baseline_failed":
      return "baseline failed";
    case "merge_conflict":
      return "merge conflict";
    case "failed":
      return "failed";
    case "canceled":
      return "canceled";
    case "superseded":
      return "superseded";
    default:
      return status ?? "complete";
  }
}

function phaseForStatus(status: string): string {
  switch (status) {
    case "queued":
      return "queued";
    case "building":
      return "builder";
    case "waiting_for_input":
      return "blocked";
    case "ai_review":
      return "review";
    case "testing":
      return "tests";
    case "you_review":
      return "ready_for_review";
    default:
      return "unknown";
  }
}

function extractEscalationSummary(payload: Record<string, unknown>): string | null {
  const summary =
    typeof payload.summary === "string" ? payload.summary.trim() : "";
  const need =
    typeof payload.what_i_need === "string" ? payload.what_i_need.trim() : "";
  const tried =
    typeof payload.what_i_tried === "string" ? payload.what_i_tried.trim() : "";
  return summary || need || tried || null;
}

function parseEscalationSummary(raw: string | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (typeof parsed === "string") {
      return parsed.trim() || null;
    }
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return extractEscalationSummary(parsed as Record<string, unknown>);
    }
  } catch {
    return trimmed;
  }
  return trimmed;
}

function parseEscalationRecord(raw: string | null): { summary: string; created_at: string | null } | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (typeof parsed === "string") {
      const summary = parsed.trim();
      return summary ? { summary, created_at: null } : null;
    }
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const record = parsed as Record<string, unknown>;
      const summary = extractEscalationSummary(record);
      if (!summary) return null;
      const createdAt =
        typeof record.created_at === "string" ? record.created_at.trim() : "";
      return { summary, created_at: createdAt || null };
    }
  } catch {
    return { summary: trimmed, created_at: null };
  }
  return { summary: trimmed, created_at: null };
}

function resolveWorkOrderMap(projectId: string): Map<string, WorkOrder> {
  const project = findProjectById(projectId);
  if (!project) return new Map();
  const workOrders = listWorkOrders(project.path);
  return new Map(workOrders.map((workOrder) => [workOrder.id, workOrder]));
}

function resolveBlockedDependencies(
  workOrder: WorkOrder | null,
  workOrderMap: Map<string, WorkOrder>
): string[] {
  if (!workOrder || !workOrder.depends_on.length) return [];
  const blocked: string[] = [];
  for (const dep of workOrder.depends_on) {
    if (dep.includes(":")) continue;
    const depWorkOrder = workOrderMap.get(dep);
    if (depWorkOrder && depWorkOrder.status !== "done") {
      blocked.push(dep);
    }
  }
  return blocked;
}

function buildRunContext(run: RunRow, workOrderMap: Map<string, WorkOrder>): RunContext | null {
  const project = findProjectById(run.project_id);
  if (!project) return null;
  const workOrder = workOrderMap.get(run.work_order_id) ?? null;
  const escalationSummary = parseEscalationSummary(run.escalation);
  const blockedDependencies = resolveBlockedDependencies(workOrder, workOrderMap);
  const iteration = Math.max(1, run.iteration || 0, run.builder_iteration || 0);

  return {
    runId: run.id,
    workOrderId: run.work_order_id,
    workOrderTitle: workOrder?.title ?? null,
    workOrderGoal: workOrder?.goal ?? null,
    workOrderDependsOn: workOrder?.depends_on ?? [],
    blockedDependencies,
    status: run.status,
    phase: phaseForStatus(run.status),
    iteration,
    builderIteration: Math.max(1, run.builder_iteration || 0),
    escalationSummary,
    projectId: project.id,
    projectPath: project.path,
  };
}

function describeEvent(event: NarrationEventInput, runMap: Map<string, RunContext>): string {
  const run = event.runId ? runMap.get(event.runId) : null;
  const label =
    run?.workOrderTitle?.trim() ||
    run?.workOrderId ||
    event.workOrderId ||
    "work order";

  switch (event.type) {
    case "run_started":
      return `Run started for ${label}.`;
    case "phase_change":
      return `Phase shifted to ${formatPhase(event.phase)} for ${label}.`;
    case "run_completed":
      return `Run completed for ${label} (${formatStatus(event.status)}).`;
    case "escalation": {
      const summary = event.escalationSummary?.trim();
      return summary
        ? `Waiting for input on ${label}. ${summary}`
        : `Waiting for input on ${label}.`;
    }
    case "periodic": {
      const count = event.activeCount ?? 0;
      const plural = count === 1 ? "run is" : "runs are";
      return `${count} ${plural} active.`;
    }
    default:
      return "Work is in progress.";
  }
}

function stripProjectData(run: RunContext): NarrationRunContext {
  const { projectId: _projectId, projectPath: _projectPath, ...rest } = run;
  return rest;
}

function formatWorkOrderLabel(id: string, title?: string | null): string {
  const cleanTitle = title?.trim();
  return cleanTitle ? `${cleanTitle} (${id})` : id;
}

function formatChatThreadChangeLabel(thread: NarrationChatThreadSummary): string {
  if (thread.scope === "global") return "Global chat";
  if (thread.scope === "project") {
    return thread.projectName ? `Project chat (${thread.projectName})` : "Project chat";
  }
  if (thread.workOrderId) return `Work order chat (${thread.workOrderId})`;
  return "Work order chat";
}

function formatEscalationChangeSummary(escalation: NarrationEscalation): string {
  const label = escalation.workOrderId
    ? formatWorkOrderLabel(escalation.workOrderId, null)
    : escalation.projectName ?? "Project escalation";
  return `${label}: ${escalation.summary}`;
}

function buildActiveProjectSummaries(projects: ProjectRow[]): NarrationProjectSummary[] {
  const activeProjects = projects.filter((project) => project.status !== "parked");
  if (!activeProjects.length) return [];
  const projectIds = activeProjects.map((project) => project.id);
  const projectIdSet = new Set(projectIds);
  const database = getDb();

  const countsByProject = new Map<
    string,
    { ready: number; in_progress: number; blocked: number }
  >();
  for (const project of activeProjects) {
    countsByProject.set(project.id, { ready: 0, in_progress: 0, blocked: 0 });
  }

  const woRows = database
    .prepare(
      `SELECT project_id, status, COUNT(1) as count
       FROM work_orders
       WHERE project_id IN (${buildInClause(projectIds)})
       GROUP BY project_id, status`
    )
    .all(...projectIds) as Array<{ project_id: string; status: string; count: number }>;
  for (const row of woRows) {
    const counts =
      countsByProject.get(row.project_id) ?? { ready: 0, in_progress: 0, blocked: 0 };
    if (row.status === "ready") counts.ready += row.count;
    if (row.status === "blocked") counts.blocked += row.count;
    if (IN_PROGRESS_WO_STATUSES.has(row.status)) counts.in_progress += row.count;
    countsByProject.set(row.project_id, counts);
  }

  const runRows = database
    .prepare(
      `SELECT project_id, COUNT(1) as count
       FROM runs
       WHERE status IN (${ACTIVE_RUN_STATUSES.map(() => "?").join(", ")})
         AND project_id IN (${buildInClause(projectIds)})
       GROUP BY project_id`
    )
    .all(...ACTIVE_RUN_STATUSES, ...projectIds) as Array<{
    project_id: string;
    count: number;
  }>;
  const runCounts = new Map<string, number>();
  for (const row of runRows) {
    runCounts.set(row.project_id, row.count);
  }

  const escalationCounts = new Map<string, number>();
  const runEscalations = database
    .prepare(
      `SELECT project_id
       FROM runs
       WHERE status = 'waiting_for_input'
         AND project_id IN (${buildInClause(projectIds)})`
    )
    .all(...projectIds) as Array<{ project_id: string }>;
  for (const row of runEscalations) {
    escalationCounts.set(row.project_id, (escalationCounts.get(row.project_id) ?? 0) + 1);
  }
  const routingEscalations = listEscalations({
    statuses: ["escalated_to_user"],
    order: "asc",
    limit: 200,
  });
  for (const escalation of routingEscalations) {
    if (!projectIdSet.has(escalation.project_id)) continue;
    escalationCounts.set(
      escalation.project_id,
      (escalationCounts.get(escalation.project_id) ?? 0) + 1
    );
  }

  return activeProjects.map((project) => {
    const counts = countsByProject.get(project.id) ?? {
      ready: 0,
      in_progress: 0,
      blocked: 0,
    };
    return {
      id: project.id,
      name: project.name,
      status: project.status,
      work_orders: counts,
      active_runs: runCounts.get(project.id) ?? 0,
      pending_escalations: escalationCounts.get(project.id) ?? 0,
    };
  });
}

function listRecentCompletions(sinceMs: number, now: number): NarrationCompletion[] {
  pruneWorkOrderStatusTransitions(now);
  const items: Array<{ item: NarrationCompletion; timestamp: number }> = [];
  for (const change of workOrderStatusTransitions) {
    if (change.status !== "done") continue;
    if (change.timestamp < sinceMs) continue;
    items.push({
      item: {
        workOrderId: change.workOrderId,
        title: change.title,
        projectName: change.projectName,
        completedAt: change.updatedAt,
      },
      timestamp: change.timestamp,
    });
  }
  items.sort((a, b) => b.timestamp - a.timestamp);
  return items.map((entry) => entry.item);
}

function listBlockedWorkOrders(
  projectMap: Map<string, ProjectRow>
): NarrationBlockedWorkOrder[] {
  const database = getDb();
  const rows = database
    .prepare(
      "SELECT project_id, id, title, status, updated_at FROM work_orders WHERE status = 'blocked' ORDER BY updated_at DESC LIMIT ?"
    )
    .all(MAX_BLOCKED_WOS * 4) as WorkOrderRow[];
  return rows.map((row) => ({
    workOrderId: row.id,
    title: row.title,
    projectName: projectMap.get(row.project_id)?.name ?? null,
  }));
}

function listWorkOrderStatusChanges(
  projectMap: Map<string, ProjectRow>,
  sinceMs: number,
  now: number
): WorkOrderStatusChange[] {
  pruneWorkOrderStatusTransitions(now);
  const database = getDb();
  const rows = database
    .prepare("SELECT project_id, id, title, status, updated_at FROM work_orders")
    .all() as WorkOrderRow[];
  const changes: WorkOrderStatusChange[] = [];
  const isFirstPass = !workOrderStatusCachePrimed;
  if (!workOrderStatusCachePrimed) {
    workOrderStatusCachePrimed = true;
  }
  for (const row of rows) {
    const timestamp = parseWorkOrderTimestamp(row.updated_at);
    const cacheKey = `${row.project_id}:${row.id}`;
    const previous = workOrderStatusCache.get(cacheKey);
    const snapshot: WorkOrderStatusSnapshot = {
      status: row.status,
      updatedAt: row.updated_at,
      timestamp,
    };
    if (!previous) {
      workOrderStatusCache.set(cacheKey, snapshot);
      if (!isFirstPass || timestamp === null) continue;
      const seeded: WorkOrderStatusChange = {
        workOrderId: row.id,
        title: row.title,
        status: row.status,
        updatedAt: row.updated_at,
        projectName: projectMap.get(row.project_id)?.name ?? null,
        timestamp,
      };
      if (timestamp >= now - CHANGE_WINDOW_MS) {
        workOrderStatusTransitions.push(seeded);
      }
      if (row.status !== "done" && row.status !== "backlog" && timestamp >= sinceMs) {
        changes.push(seeded);
      }
      continue;
    }
    if (previous.status === row.status) {
      workOrderStatusCache.set(cacheKey, snapshot);
      continue;
    }
    if (timestamp === null) {
      workOrderStatusCache.set(cacheKey, snapshot);
      continue;
    }
    const change: WorkOrderStatusChange = {
      workOrderId: row.id,
      title: row.title,
      status: row.status,
      updatedAt: row.updated_at,
      projectName: projectMap.get(row.project_id)?.name ?? null,
      timestamp,
    };
    if (timestamp >= now - CHANGE_WINDOW_MS) {
      workOrderStatusTransitions.push(change);
    }
    if (row.status !== "done" && row.status !== "backlog" && timestamp >= sinceMs) {
      changes.push(change);
    }
    workOrderStatusCache.set(cacheKey, snapshot);
  }
  return changes;
}

function listPendingEscalations(
  projectMap: Map<string, ProjectRow>
): NarrationEscalation[] {
  const database = getDb();
  const items: Array<{ item: NarrationEscalation; timestamp: number }> = [];

  const runRows = database
    .prepare(
      "SELECT id, project_id, work_order_id, escalation, created_at FROM runs WHERE status = 'waiting_for_input' ORDER BY created_at DESC LIMIT ?"
    )
    .all(MAX_PENDING_ESCALATIONS * 6) as RunEscalationRow[];
  for (const row of runRows) {
    const record = parseEscalationRecord(row.escalation);
    const summary = record?.summary ?? parseEscalationSummary(row.escalation);
    if (!summary) continue;
    const waitingSince = record?.created_at ?? row.created_at;
    const timestamp =
      parseIsoTimestamp(record?.created_at ?? null) ??
      parseIsoTimestamp(row.created_at) ??
      0;
    const projectName = projectMap.get(row.project_id)?.name ?? null;
    items.push({
      item: {
        id: row.id,
        type: "run_input",
        summary,
        projectName,
        workOrderId: row.work_order_id,
        waitingSince,
      },
      timestamp,
    });
  }

  const routingEscalations = listEscalations({
    statuses: ["escalated_to_user"],
    order: "asc",
    limit: 200,
  });
  for (const escalation of routingEscalations) {
    const summary = escalation.summary.trim();
    if (!summary) continue;
    const runWorkOrderId = escalation.run_id
      ? getRunById(escalation.run_id)?.work_order_id ?? null
      : null;
    const projectName = projectMap.get(escalation.project_id)?.name ?? null;
    const timestamp = parseIsoTimestamp(escalation.created_at) ?? 0;
    items.push({
      item: {
        id: escalation.id,
        type: escalation.type,
        summary,
        projectName,
        workOrderId: runWorkOrderId,
        waitingSince: escalation.created_at,
      },
      timestamp,
    });
  }

  items.sort((a, b) => a.timestamp - b.timestamp);
  return items.map((entry) => entry.item);
}

function listRecentChatThreads(
  projectMap: Map<string, ProjectRow>
): NarrationChatThreadSummary[] {
  const threads = listChatThreads({ includeArchived: false, limit: 200 });
  const summaries = threads.map((thread) => {
    const lastActivityAt = selectLatestTimestamp([
      thread.last_message_at,
      thread.last_run_at,
      thread.updated_at,
    ]);
    return {
      id: thread.id,
      scope: thread.scope,
      name: thread.name || null,
      summary: thread.summary || null,
      lastActivityAt,
      projectName: thread.project_id ? projectMap.get(thread.project_id)?.name ?? null : null,
      workOrderId: thread.work_order_id,
    };
  });
  summaries.sort((a, b) => {
    const aMs = parseIsoTimestamp(a.lastActivityAt ?? null) ?? 0;
    const bMs = parseIsoTimestamp(b.lastActivityAt ?? null) ?? 0;
    return bMs - aMs;
  });
  return summaries;
}

function summarizeChatAction(
  actionType: string,
  payload: Record<string, unknown> | null
): string | null {
  switch (actionType) {
    case "work_order_set_status": {
      const workOrderId = readString(payload?.workOrderId);
      const status = readString(payload?.status);
      if (workOrderId && status) return `Set ${workOrderId} to ${status}`;
      if (workOrderId) return `Updated ${workOrderId} status`;
      return "Updated work order status";
    }
    case "work_order_start_run": {
      const workOrderId = readString(payload?.workOrderId);
      return workOrderId ? `Started run for ${workOrderId}` : "Started work order run";
    }
    case "work_order_create": {
      const title = readString(payload?.title);
      return title ? `Created work order "${title}"` : "Created work order";
    }
    case "work_order_update": {
      const workOrderId = readString(payload?.workOrderId);
      return workOrderId ? `Updated ${workOrderId}` : "Updated work order";
    }
    case "project_set_star": {
      const projectId = readString(payload?.projectId);
      const starred = readBoolean(payload?.starred);
      if (projectId && starred === true) return `Starred project ${projectId}`;
      if (projectId && starred === false) return `Unstarred project ${projectId}`;
      return "Updated project star";
    }
    case "project_set_hidden": {
      const projectId = readString(payload?.projectId);
      const hidden = readBoolean(payload?.hidden);
      if (projectId && hidden === true) return `Hidden project ${projectId}`;
      if (projectId && hidden === false) return `Unhid project ${projectId}`;
      return "Updated project visibility";
    }
    case "project_set_success": {
      const projectId = readString(payload?.projectId);
      return projectId ? `Updated success criteria for ${projectId}` : "Updated success criteria";
    }
    case "repos_rescan":
      return "Rescanned repositories";
    case "worktree_merge":
      return "Merged chat worktree";
    default:
      return actionType ? `Applied ${actionType}` : null;
  }
}

function listRecentDecisions(
  projectMap: Map<string, ProjectRow>,
  sinceMs: number
): NarrationDecision[] {
  const database = getDb();
  const sinceIso = new Date(sinceMs).toISOString();
  const rows = database
    .prepare(
      `SELECT cal.id, cal.action_type, cal.action_payload_json, cal.applied_at,
              t.scope, t.project_id, t.work_order_id, t.name
       FROM chat_action_ledger cal
       JOIN chat_threads t ON t.id = cal.thread_id
       WHERE cal.applied_at >= ?
       ORDER BY cal.applied_at DESC
       LIMIT ?`
    )
    .all(sinceIso, MAX_CHAT_DECISIONS * 6) as DecisionRow[];
  const items: Array<{ item: NarrationDecision; timestamp: number }> = [];
  for (const row of rows) {
    let payload: Record<string, unknown> | null = null;
    if (row.action_payload_json) {
      try {
        const parsed = JSON.parse(row.action_payload_json) as unknown;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          payload = parsed as Record<string, unknown>;
        }
      } catch {
        payload = null;
      }
    }
    const summary = summarizeChatAction(row.action_type, payload);
    if (!summary) continue;
    const projectName = row.project_id ? projectMap.get(row.project_id)?.name ?? null : null;
    const workOrderId =
      readString(payload?.workOrderId) ?? row.work_order_id ?? null;
    const timestamp = parseIsoTimestamp(row.applied_at) ?? 0;
    items.push({
      item: {
        id: row.id,
        summary,
        createdAt: row.applied_at,
        projectName,
        workOrderId,
      },
      timestamp,
    });
  }
  items.sort((a, b) => b.timestamp - a.timestamp);
  return items.map((entry) => entry.item);
}

function priorityWeight(priority: NarrationChange["priority"]): number {
  if (priority === "high") return 3;
  if (priority === "medium") return 2;
  return 1;
}

function buildChangeCandidates(params: {
  events: NarrationEventInput[];
  runMap: Map<string, RunContext>;
  pendingEscalations: NarrationEscalation[];
  recentCompletions: NarrationCompletion[];
  recentDecisions: NarrationDecision[];
  recentChatThreads: NarrationChatThreadSummary[];
  workOrderStatusChanges: WorkOrderStatusChange[];
  sinceMs: number;
  now: number;
}): ChangeCandidate[] {
  const candidates: ChangeCandidate[] = [];

  for (const event of params.events) {
    if (event.type === "periodic") continue;
    const summary = describeEvent(event, params.runMap);
    if (!summary) continue;
    const baseId = event.runId ?? event.workOrderId ?? "work";
    const topicParts = [event.type, baseId, event.phase ?? "", event.status ?? ""]
      .filter(Boolean)
      .join(":");
    const topic = `event:${topicParts}`;
    let priority: NarrationChange["priority"] = "low";
    let category: ChangeCategory = "progress";
    if (event.type === "escalation") {
      priority = "high";
      category = "escalation";
    } else if (event.type === "run_completed") {
      priority = "high";
      category = "completion";
    } else if (event.type === "run_started") {
      priority = "medium";
      category = "progress";
    } else if (event.type === "phase_change") {
      priority = "low";
      category = "progress";
    }
    candidates.push({
      topic,
      summary,
      priority,
      category,
      timestamp: params.now,
    });
  }

  for (const completion of params.recentCompletions) {
    const timestamp = parseWorkOrderTimestamp(completion.completedAt) ?? 0;
    if (timestamp < params.sinceMs) continue;
    const label = formatWorkOrderLabel(completion.workOrderId, completion.title);
    const summary = completion.projectName
      ? `${label} completed (${completion.projectName}).`
      : `${label} completed.`;
    candidates.push({
      topic: `wo_done:${completion.workOrderId}`,
      summary,
      priority: "high",
      category: "completion",
      timestamp,
    });
  }

  for (const escalation of params.pendingEscalations) {
    const timestamp = parseIsoTimestamp(escalation.waitingSince) ?? 0;
    if (timestamp < params.sinceMs) continue;
    const summary = `Escalation waiting: ${formatEscalationChangeSummary(escalation)}`;
    candidates.push({
      topic: `escalation:${escalation.id}`,
      summary,
      priority: "high",
      category: "escalation",
      timestamp,
    });
  }

  for (const change of params.workOrderStatusChanges) {
    if (change.timestamp < params.sinceMs) continue;
    const label = formatWorkOrderLabel(change.workOrderId, change.title);
    const summary = change.projectName
      ? `${label} is now ${change.status} (${change.projectName}).`
      : `${label} is now ${change.status}.`;
    candidates.push({
      topic: `wo_status:${change.workOrderId}:${change.status}`,
      summary,
      priority: "medium",
      category: "status",
      timestamp: change.timestamp,
    });
  }

  for (const decision of params.recentDecisions) {
    const timestamp = parseIsoTimestamp(decision.createdAt) ?? 0;
    if (timestamp < params.sinceMs) continue;
    const summary = decision.projectName
      ? `Decision: ${decision.summary} (${decision.projectName}).`
      : `Decision: ${decision.summary}.`;
    candidates.push({
      topic: `decision:${decision.id}`,
      summary,
      priority: "medium",
      category: "decision",
      timestamp,
    });
  }

  for (const thread of params.recentChatThreads) {
    const timestamp = parseIsoTimestamp(thread.lastActivityAt ?? null) ?? 0;
    if (timestamp < params.sinceMs) continue;
    const label = formatChatThreadChangeLabel(thread);
    const summary = `Chat update: ${label}.`;
    candidates.push({
      topic: `chat_thread:${thread.id}`,
      summary,
      priority: "low",
      category: "chat",
      timestamp,
    });
  }

  return candidates;
}

function selectChanges(
  candidates: ChangeCandidate[],
  now: number
): { items: NarrationChange[]; omitted: number } {
  const byTopic = new Map<string, ChangeCandidate>();
  for (const change of candidates) {
    if (isTopicRecentlyReported(change.topic, now)) continue;
    const existing = byTopic.get(change.topic);
    if (!existing) {
      byTopic.set(change.topic, change);
      continue;
    }
    const existingWeight = priorityWeight(existing.priority);
    const nextWeight = priorityWeight(change.priority);
    if (nextWeight > existingWeight) {
      byTopic.set(change.topic, change);
      continue;
    }
    if (nextWeight === existingWeight && change.timestamp > existing.timestamp) {
      byTopic.set(change.topic, change);
    }
  }

  const sorted = Array.from(byTopic.values()).sort((a, b) => {
    const priorityDiff = priorityWeight(b.priority) - priorityWeight(a.priority);
    if (priorityDiff !== 0) return priorityDiff;
    const categoryDiff = CHANGE_CATEGORY_ORDER[a.category] - CHANGE_CATEGORY_ORDER[b.category];
    if (categoryDiff !== 0) return categoryDiff;
    return b.timestamp - a.timestamp;
  });

  const limited = limitList(sorted, MAX_CHANGES);
  return {
    items: limited.items.map((entry) => ({
      topic: entry.topic,
      summary: entry.summary,
      priority: entry.priority,
    })),
    omitted: limited.omitted,
  };
}

async function runCodexPrompt(params: {
  prompt: string;
  projectPath: string;
  model: string;
  cliPath?: string;
}): Promise<{ text: string; usage: TokenUsage | null }> {
  const baseDir = path.join(params.projectPath, ".system", "utility");
  ensureDir(baseDir);
  const id = crypto.randomUUID();
  const outputPath = path.join(baseDir, `narration-${id}.output.txt`);
  const logPath = path.join(baseDir, `narration-${id}.codex.jsonl`);
  const args = [
    "--ask-for-approval",
    "never",
    "exec",
    "--json",
    "--model",
    params.model,
    "--sandbox",
    "read-only",
    "--output-last-message",
    outputPath,
    "--color",
    "never",
    "-",
  ];

  const child = spawn(codexCommand(params.cliPath), args, {
    cwd: params.projectPath,
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env },
  });

  let stdout = "";
  let stderr = "";
  let timedOut = false;

  child.stdout?.on("data", (buf) => {
    stdout += buf.toString("utf8");
  });
  child.stderr?.on("data", (buf) => {
    stderr += buf.toString("utf8");
  });
  child.stdin?.write(params.prompt);
  child.stdin?.end();

  const timeoutId = setTimeout(() => {
    timedOut = true;
    child.kill("SIGTERM");
  }, CODEX_TIMEOUT_MS);

  let exitCode: number;
  try {
    exitCode = await new Promise((resolve, reject) => {
      child.on("close", (code) => resolve(code ?? 1));
      child.on("error", (err) => reject(err));
    });
  } catch (err) {
    clearTimeout(timeoutId);
    writeCodexLog(logPath, stdout, stderr);
    throw err instanceof Error ? err : new Error(String(err));
  }
  clearTimeout(timeoutId);

  writeCodexLog(logPath, stdout, stderr);
  if (timedOut) throw new Error("codex exec timed out");
  if (exitCode !== 0) throw new Error(`codex exec failed (exit ${exitCode})`);

  const output = fs.readFileSync(outputPath, "utf8").trim();
  if (!output) throw new Error("Codex CLI returned empty output");
  const usage = parseCodexTokenUsageFromLog(logPath);
  return { text: output, usage };
}

async function runClaudePrompt(params: {
  prompt: string;
  projectPath: string;
  model: string;
  cliPath?: string;
}): Promise<{ text: string; usage: TokenUsage | null }> {
  const result = await execFileAsync(
    claudeCommand(params.cliPath),
    ["-p", params.prompt, "--model", params.model, "--output-format", "json"],
    {
      cwd: params.projectPath,
      timeout: CLAUDE_TIMEOUT_MS,
      maxBuffer: 5 * 1024 * 1024,
    }
  );
  const stdout = typeof result.stdout === "string" ? result.stdout.trim() : "";
  if (!stdout) throw new Error("Claude CLI returned empty output");
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout) as unknown;
  } catch {
    return { text: stdout, usage: null };
  }
  const usage = extractTokenUsageFromClaudeResponse(parsed);
  const text = extractClaudeText(parsed) ?? stdout;
  return { text, usage };
}

export async function generateNarration(raw: unknown): Promise<NarrationResult> {
  const request = normalizeRequest(raw);
  if (!request) {
    return { ok: false, status: 400, error: "invalid narration request" };
  }

  const now = Date.now();
  if (narrationInFlight) {
    return { ok: false, status: 429, error: "narration in flight" };
  }
  const sinceLast = now - lastNarrationAt;
  if (sinceLast < RATE_LIMIT_MS) {
    return {
      ok: false,
      status: 429,
      error: "rate limited",
      retryAfterMs: RATE_LIMIT_MS - sinceLast,
    };
  }

  const runIds = new Set<string>(request.activeRunIds);
  for (const event of request.events) {
    if (event.runId) runIds.add(event.runId);
  }

  const runContextMap = new Map<string, RunContext>();
  const workOrderMaps = new Map<string, Map<string, WorkOrder>>();
  for (const runId of runIds) {
    const run = getRunById(runId);
    if (!run) continue;
    if (!workOrderMaps.has(run.project_id)) {
      workOrderMaps.set(run.project_id, resolveWorkOrderMap(run.project_id));
    }
    const workOrderMap = workOrderMaps.get(run.project_id) ?? new Map();
    const context = buildRunContext(run, workOrderMap);
    if (context) {
      runContextMap.set(runId, context);
    }
  }

  const runContexts = Array.from(runContextMap.values());
  const promptNarrations =
    request.recentNarrations.length > 0 ? request.recentNarrations : recentNarrationCache;
  const projects = listProjects();
  const projectMap = new Map(projects.map((project) => [project.id, project]));
  const activeProjects = buildActiveProjectSummaries(projects);
  const pendingEscalationsAll = listPendingEscalations(projectMap);
  const pendingEscalations = limitList(pendingEscalationsAll, MAX_PENDING_ESCALATIONS);
  const blockedWorkOrdersAll = listBlockedWorkOrders(projectMap);
  const blockedWorkOrders = limitList(blockedWorkOrdersAll, MAX_BLOCKED_WOS);
  const recentChatThreadsAll = listRecentChatThreads(projectMap);
  const recentChatThreads = limitList(recentChatThreadsAll, MAX_CHAT_THREADS);
  const recentDecisionsAll = listRecentDecisions(projectMap, now - CHANGE_WINDOW_MS);
  const recentDecisions = limitList(recentDecisionsAll, MAX_CHAT_DECISIONS);

  const changeWindowStart = lastNarrationRecordedAt > 0
    ? lastNarrationRecordedAt
    : now - CHANGE_WINDOW_MS;
  const workOrderStatusChanges = listWorkOrderStatusChanges(
    projectMap,
    changeWindowStart,
    now
  );
  const recentCompletionsAll = listRecentCompletions(now - CHANGE_WINDOW_MS, now);
  const recentCompletions = limitList(recentCompletionsAll, MAX_COMPLETIONS);
  const changeCandidates = buildChangeCandidates({
    events: request.events,
    runMap: runContextMap,
    pendingEscalations: pendingEscalationsAll,
    recentCompletions: recentCompletionsAll,
    recentDecisions: recentDecisionsAll,
    recentChatThreads: recentChatThreadsAll,
    workOrderStatusChanges,
    sinceMs: changeWindowStart,
    now,
  });
  const selectedChanges = selectChanges(changeCandidates, now);
  const reportedTopics = listReportedTopicSummaries(now, REPORTED_TOPIC_LIMIT);
  const promptInput: NarrationPromptInput = {
    activeRuns: runContexts.slice(0, MAX_ACTIVE_RUNS).map(stripProjectData),
    activeProjects,
    recentCompletions: recentCompletions.items,
    recentChatThreads: recentChatThreads.items,
    recentDecisions: recentDecisions.items,
    pendingEscalations: pendingEscalations.items,
    blockedWorkOrders: blockedWorkOrders.items,
    changesSinceLastNarration: selectedChanges.items,
    lastNarrationAt:
      lastNarrationRecordedAt > 0
        ? new Date(lastNarrationRecordedAt).toISOString()
        : null,
    recentlyReportedTopics: reportedTopics,
    recentNarrations: promptNarrations,
    omitted: {
      completions: recentCompletions.omitted,
      chatThreads: recentChatThreads.omitted,
      decisions: recentDecisions.omitted,
      escalations: pendingEscalations.omitted,
      blockedWorkOrders: blockedWorkOrders.omitted,
      changes: selectedChanges.omitted,
    },
  };

  const prompt = buildNarrationPrompt(promptInput);
  const focusRun =
    (request.primaryEvent.runId && runContextMap.get(request.primaryEvent.runId)) ||
    runContexts[0] ||
    null;
  const projectPath = focusRun?.projectPath ?? process.cwd();
  const projectId = focusRun?.projectId ?? null;
  const runId = focusRun?.runId ?? null;

  const settings = resolveUtilitySettings().effective;
  let model =
    settings.provider === "codex"
      ? settings.model.trim() || DEFAULT_CODEX_MODEL
      : settings.model.trim() || CLAUDE_NARRATION_MODEL;
  let usage: TokenUsage | null = null;

  narrationInFlight = true;
  lastNarrationAt = now;
  try {
    let text = "";
    if (settings.provider === "codex") {
      const result = await runCodexPrompt({
        prompt,
        projectPath,
        model,
        cliPath: settings.cliPath,
      });
      usage = result.usage;
      text = result.text;
    } else {
      const result = await runClaudePrompt({
        prompt,
        projectPath,
        model,
        cliPath: settings.cliPath,
      });
      usage = result.usage;
      text = result.text;
    }

    const normalized = normalizeNarrationOutput(text);
    if (!normalized) {
      return { ok: false, status: 502, error: "empty narration" };
    }

    const recent = [...request.recentNarrations, ...recentNarrationCache];
    if (isRedundant(normalized, recent)) {
      return { ok: false, status: 409, error: "duplicate narration" };
    }

    recentNarrationCache.push(normalized);
    while (recentNarrationCache.length > MAX_RECENT_NARRATIONS) {
      recentNarrationCache.shift();
    }

    const recordedAt = Date.now();
    recordReportedTopics(selectedChanges.items, recordedAt);
    lastNarrationRecordedAt = recordedAt;

    if (projectId) {
      recordCostEntry({
        projectId,
        runId,
        category: "other",
        model,
        usage,
        description: "narration generation",
      });
    }

    return {
      ok: true,
      text: normalized,
      provider: settings.provider,
      model,
    };
  } catch (err) {
    return {
      ok: false,
      status: 502,
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    narrationInFlight = false;
  }
}
