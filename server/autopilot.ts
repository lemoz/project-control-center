import YAML from "yaml";
import {
  findProjectById,
  getAutopilotPolicy,
  getDb,
  getProjectVm,
  listEnabledAutopilotPolicies,
  updateAutopilotPolicy,
  type AutopilotPolicy,
  type AutopilotPolicyPatch,
  type ProjectRow,
  type RunRow,
} from "./db.js";
import { enqueueCodexRun } from "./runner_agent.js";
import { readWorkOrderMarkdown } from "./work_orders.js";

export type AutopilotCandidate = {
  id: string;
  title: string;
  priority: number;
  tags: string[];
  updated_at: string;
  depends_on: string[];
};

export type AutopilotActivity = {
  run_id: string;
  work_order_id: string;
  status: RunRow["status"];
  created_at: string;
};

export type AutopilotStatus = {
  state: "disabled" | "paused" | "running" | "idle";
  enabled: boolean;
  vm_ready: boolean;
  failure_count: number;
  stop_on_failure_count: number;
  active_run: {
    id: string;
    work_order_id: string;
    status: RunRow["status"];
    created_at: string;
  } | null;
  blocked_reason: string | null;
};

export type AutopilotSnapshot = {
  policy: AutopilotPolicy;
  status: AutopilotStatus;
  next_candidate: AutopilotCandidate | null;
  recent_activity: AutopilotActivity[];
};

export type AutopilotCandidatesResponse = {
  status: AutopilotStatus;
  candidates: AutopilotCandidate[];
  next_candidate: AutopilotCandidate | null;
};

const CHECK_INTERVAL_MS = 60_000;
const ACTIVE_STATUSES = new Set<RunRow["status"]>([
  "queued",
  "building",
  "waiting_for_input",
  "ai_review",
  "testing",
  "you_review",
]);
const FAILED_STATUSES = new Set<RunRow["status"]>([
  "failed",
  "baseline_failed",
  "merge_conflict",
  "canceled",
]);
const PASSED_STATUSES = new Set<RunRow["status"]>(["merged", "you_review"]);

let schedulerTimer: NodeJS.Timeout | null = null;
let inFlight = false;

type WorkOrderRow = {
  id: string;
  project_id: string;
  title: string;
  status: string;
  priority: number;
  tags: string;
  created_at: string;
  updated_at: string;
};

function parseTags(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
      .filter(Boolean);
  } catch {
    return [];
  }
}

function extractFrontmatter(markdown: string): Record<string, unknown> | null {
  const match = markdown.match(/^---\s*[\r\n]+([\s\S]*?)[\r\n]+---/);
  if (!match) return null;
  try {
    const parsed = YAML.parse(match[1]);
    if (!parsed || typeof parsed !== "object") return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function readWorkOrderDependsOn(repoPath: string, workOrderId: string): string[] | null {
  try {
    const markdown = readWorkOrderMarkdown(repoPath, workOrderId);
    const frontmatter = extractFrontmatter(markdown);
    if (!frontmatter) return null;
    const raw = frontmatter.depends_on;
    if (!Array.isArray(raw)) return [];
    return raw
      .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
      .filter(Boolean);
  } catch {
    return null;
  }
}

function listReadyWorkOrderRows(projectId: string): WorkOrderRow[] {
  const database = getDb();
  return database
    .prepare(
      `SELECT id, project_id, title, status, priority, tags, created_at, updated_at
       FROM work_orders
       WHERE project_id = ? AND status = 'ready'
       ORDER BY priority ASC, updated_at DESC`
    )
    .all(projectId) as WorkOrderRow[];
}

function loadWorkOrderStatusMap(projectId: string): Map<string, string> {
  const database = getDb();
  const rows = database
    .prepare("SELECT id, status FROM work_orders WHERE project_id = ?")
    .all(projectId) as Array<{ id: string; status: string }>;
  const map = new Map<string, string>();
  for (const row of rows) {
    map.set(row.id, row.status);
  }
  return map;
}

function matchesAllowedTags(tags: string[], allowedTags: string[] | null): boolean {
  if (!allowedTags || allowedTags.length === 0) return true;
  const allowed = new Set(allowedTags.map((tag) => tag.toLowerCase()));
  return tags.some((tag) => allowed.has(tag.toLowerCase()));
}

function dependenciesSatisfied(dependsOn: string[], statusMap: Map<string, string>): boolean {
  for (const depId of dependsOn) {
    const status = statusMap.get(depId);
    if (status !== "done") return false;
  }
  return true;
}

function isVmReady(projectId: string): boolean {
  const vm = getProjectVm(projectId);
  if (!vm) return false;
  return vm.status === "running" || vm.status === "stopped";
}

function findActiveRun(projectId: string): AutopilotStatus["active_run"] {
  const database = getDb();
  const statuses = Array.from(ACTIVE_STATUSES);
  const placeholders = statuses.map(() => "?").join(", ");
  const row = database
    .prepare(
      `SELECT id, work_order_id, status, created_at
       FROM runs
       WHERE project_id = ? AND status IN (${placeholders})
       ORDER BY created_at DESC
       LIMIT 1`
    )
    .get(projectId, ...statuses) as
    | { id: string; work_order_id: string; status: RunRow["status"]; created_at: string }
    | undefined;
  return row || null;
}

function countConsecutiveFailures(projectId: string, limit: number): number {
  const database = getDb();
  const rows = database
    .prepare(
      `SELECT status
       FROM runs
       WHERE project_id = ? AND triggered_by = 'autopilot'
       ORDER BY created_at DESC
       LIMIT ?`
    )
    .all(projectId, Math.max(1, limit)) as Array<{ status: RunRow["status"] }>;
  let count = 0;
  for (const row of rows) {
    if (ACTIVE_STATUSES.has(row.status)) continue;
    if (FAILED_STATUSES.has(row.status)) {
      count += 1;
      continue;
    }
    if (PASSED_STATUSES.has(row.status)) break;
    break;
  }
  return count;
}

function listAutopilotActivity(projectId: string, limit = 5): AutopilotActivity[] {
  const database = getDb();
  const rows = database
    .prepare(
      `SELECT id, work_order_id, status, created_at
       FROM runs
       WHERE project_id = ? AND triggered_by = 'autopilot'
       ORDER BY created_at DESC
       LIMIT ?`
    )
    .all(projectId, limit) as Array<{
    id: string;
    work_order_id: string;
    status: RunRow["status"];
    created_at: string;
  }>;
  return rows.map((row) => ({
    run_id: row.id,
    work_order_id: row.work_order_id,
    status: row.status,
    created_at: row.created_at,
  }));
}

function buildAutopilotStatus(project: ProjectRow, policy: AutopilotPolicy): AutopilotStatus {
  const vmReady = isVmReady(project.id);
  const activeRun = findActiveRun(project.id);
  const failureCount = countConsecutiveFailures(
    project.id,
    Math.max(policy.stop_on_failure_count, 5)
  );
  let state: AutopilotStatus["state"] = "idle";
  let blockedReason: string | null = null;

  if (!policy.enabled) {
    state = "disabled";
    blockedReason = "disabled";
  } else if (!vmReady) {
    state = "idle";
    blockedReason = "vm_not_ready";
  } else if (failureCount >= policy.stop_on_failure_count) {
    state = "paused";
    blockedReason = "failure_limit";
  } else if (activeRun) {
    state = "running";
    blockedReason = "active_run";
  }

  return {
    state,
    enabled: policy.enabled,
    vm_ready: vmReady,
    failure_count: failureCount,
    stop_on_failure_count: policy.stop_on_failure_count,
    active_run: activeRun,
    blocked_reason: blockedReason,
  };
}

function listCandidatesForProject(
  project: ProjectRow,
  policy: AutopilotPolicy
): AutopilotCandidate[] {
  const readyRows = listReadyWorkOrderRows(project.id);
  const statusMap = loadWorkOrderStatusMap(project.id);
  const candidates: AutopilotCandidate[] = [];

  for (const row of readyRows) {
    if (policy.min_priority !== null && row.priority > policy.min_priority) continue;
    const tags = parseTags(row.tags);
    if (!matchesAllowedTags(tags, policy.allowed_tags)) continue;
    const dependsOn = readWorkOrderDependsOn(project.path, row.id);
    if (dependsOn === null) continue;
    if (!dependenciesSatisfied(dependsOn, statusMap)) continue;
    candidates.push({
      id: row.id,
      title: row.title,
      priority: row.priority,
      tags,
      updated_at: row.updated_at,
      depends_on: dependsOn,
    });
  }

  return candidates.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    return b.updated_at.localeCompare(a.updated_at);
  });
}

export function getAutopilotSnapshot(projectId: string): AutopilotSnapshot | null {
  const project = findProjectById(projectId);
  if (!project) return null;
  const policy = getAutopilotPolicy(projectId);
  const status = buildAutopilotStatus(project, policy);
  const candidates = listCandidatesForProject(project, policy);
  return {
    policy,
    status,
    next_candidate: candidates[0] ?? null,
    recent_activity: listAutopilotActivity(project.id, 5),
  };
}

export function getAutopilotCandidates(projectId: string): AutopilotCandidatesResponse | null {
  const project = findProjectById(projectId);
  if (!project) return null;
  const policy = getAutopilotPolicy(projectId);
  const status = buildAutopilotStatus(project, policy);
  const candidates = listCandidatesForProject(project, policy);
  return {
    status,
    candidates,
    next_candidate: candidates[0] ?? null,
  };
}

export function parseAutopilotPolicyPatch(
  body: unknown
):
  | { ok: true; patch: AutopilotPolicyPatch }
  | { ok: false; error: string } {
  if (!body || typeof body !== "object") {
    return { ok: false, error: "request body required" };
  }
  const payload = body as Record<string, unknown>;
  const patch: AutopilotPolicyPatch = {};

  if ("enabled" in payload) {
    if (typeof payload.enabled !== "boolean") {
      return { ok: false, error: "`enabled` must be boolean" };
    }
    patch.enabled = payload.enabled;
  }

  if ("max_concurrent_runs" in payload) {
    const value = payload.max_concurrent_runs;
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return { ok: false, error: "`max_concurrent_runs` must be number" };
    }
    const normalized = Math.max(1, Math.trunc(value));
    patch.max_concurrent_runs = normalized;
  }

  if ("allowed_tags" in payload) {
    const value = payload.allowed_tags;
    if (value === null) {
      patch.allowed_tags = null;
    } else if (Array.isArray(value)) {
      const tags = value
        .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
        .filter(Boolean);
      patch.allowed_tags = tags.length ? tags : null;
    } else {
      return { ok: false, error: "`allowed_tags` must be string array or null" };
    }
  }

  if ("min_priority" in payload) {
    const value = payload.min_priority;
    if (value === null) {
      patch.min_priority = null;
    } else if (typeof value === "number" && Number.isFinite(value)) {
      patch.min_priority = Math.max(1, Math.min(5, Math.trunc(value)));
    } else {
      return { ok: false, error: "`min_priority` must be number or null" };
    }
  }

  if ("stop_on_failure_count" in payload) {
    const value = payload.stop_on_failure_count;
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return { ok: false, error: "`stop_on_failure_count` must be number" };
    }
    patch.stop_on_failure_count = Math.max(1, Math.trunc(value));
  }

  if ("schedule_cron" in payload) {
    const value = payload.schedule_cron;
    if (value === null) {
      patch.schedule_cron = null;
    } else if (typeof value === "string") {
      const trimmed = value.trim();
      patch.schedule_cron = trimmed ? trimmed : null;
    } else {
      return { ok: false, error: "`schedule_cron` must be string or null" };
    }
  }

  return { ok: true, patch };
}

export function updateAutopilotPolicyFromPatch(
  projectId: string,
  patch: AutopilotPolicyPatch
): AutopilotPolicy {
  return updateAutopilotPolicy(projectId, patch);
}

async function runAutopilotCycle(): Promise<void> {
  if (inFlight) return;
  inFlight = true;
  try {
    const policies = listEnabledAutopilotPolicies();
    for (const policy of policies) {
      const project = findProjectById(policy.project_id);
      if (!project) continue;
      const status = buildAutopilotStatus(project, policy);
      if (!status.enabled || status.blocked_reason) continue;
      const candidates = listCandidatesForProject(project, policy);
      const candidate = candidates[0];
      if (!candidate) continue;
      try {
        enqueueCodexRun(project.id, candidate.id, null, "autopilot");
      } catch {
        continue;
      }
    }
  } finally {
    inFlight = false;
  }
}

export function startAutopilotScheduler(): void {
  if (schedulerTimer) return;
  schedulerTimer = setInterval(() => {
    void runAutopilotCycle();
  }, CHECK_INTERVAL_MS);
  void runAutopilotCycle();
}
