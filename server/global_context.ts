import { getActiveShift, getProjectVm, type ProjectRow, type RunRow } from "./db.js";
import { syncAndListRepoSummaries } from "./projects_catalog.js";
import { getRunsForProject } from "./runner_agent.js";
import { buildShiftContext } from "./shift_context.js";

type EscalationInput = {
  key: string;
  label: string;
};

type EscalationRecord = {
  what_i_tried: string;
  what_i_need: string;
  inputs: EscalationInput[];
  created_at: string;
  resolved_at?: string;
};

type EscalationSummary = {
  id: string;
  type: string;
  summary: string;
  waiting_since: string;
};

export type GlobalProjectSummary = {
  id: string;
  name: string;
  status: ProjectRow["status"];
  health: "healthy" | "stalled" | "failing" | "blocked";
  active_shift: { id: string; started_at: string; agent_id: string | null } | null;
  escalations: Array<{ id: string; type: string; summary: string }>;
  work_orders: { ready: number; building: number; blocked: number };
  recent_runs: Array<{ id: string; wo_id: string; status: string; outcome: string | null }>;
  last_activity: string | null;
};

export type EscalationQueueItem = {
  project_id: string;
  escalation_id: string;
  type: string;
  priority: number;
  waiting_since: string;
};

export type GlobalContextResponse = {
  projects: GlobalProjectSummary[];
  escalation_queue: EscalationQueueItem[];
  resources: {
    vms_running: number;
    vms_available: number;
    budget_used_today: number;
  };
  assembled_at: string;
};

const RUN_FAILURE_STATUSES = new Set<RunRow["status"]>([
  "baseline_failed",
  "failed",
  "merge_conflict",
  "canceled",
]);

function parseEscalationRecord(raw: string | null): EscalationRecord | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const record = parsed as Record<string, unknown>;
  const whatTried =
    typeof record.what_i_tried === "string" ? record.what_i_tried.trim() : "";
  const whatNeed =
    typeof record.what_i_need === "string" ? record.what_i_need.trim() : "";
  const inputsRaw = Array.isArray(record.inputs) ? record.inputs : [];
  const inputs = inputsRaw
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const input = entry as Record<string, unknown>;
      const key = typeof input.key === "string" ? input.key.trim() : "";
      const label = typeof input.label === "string" ? input.label.trim() : "";
      if (!key || !label) return null;
      return { key, label };
    })
    .filter((entry): entry is EscalationInput => Boolean(entry));
  const createdAt =
    typeof record.created_at === "string" ? record.created_at.trim() : "";
  if (!whatTried || !whatNeed || inputs.length === 0 || !createdAt) return null;
  const resolvedAt =
    typeof record.resolved_at === "string" ? record.resolved_at.trim() : "";
  return {
    what_i_tried: whatTried,
    what_i_need: whatNeed,
    inputs,
    created_at: createdAt,
    resolved_at: resolvedAt || undefined,
  };
}

function resolveRunOutcome(run: RunRow): "merged" | "approved" | "failed" | null {
  if (run.status === "merged") return "merged";
  if (run.status === "you_review") {
    return run.merge_status === "merged" ? "merged" : "approved";
  }
  if (RUN_FAILURE_STATUSES.has(run.status)) return "failed";
  return null;
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

function resolveHealth(params: {
  projectStatus: ProjectRow["status"];
  hasEscalation: boolean;
  hasFailures: boolean;
  hasReadyWork: boolean;
  hasActiveShiftOrRun: boolean;
}): GlobalProjectSummary["health"] {
  if (params.projectStatus === "blocked" || params.hasEscalation) return "blocked";
  if (params.projectStatus === "parked") return "stalled";
  if (params.hasFailures) return "failing";
  if (params.hasReadyWork && !params.hasActiveShiftOrRun) return "stalled";
  return "healthy";
}

function summarizeEscalation(run: RunRow): EscalationSummary | null {
  const record = parseEscalationRecord(run.escalation);
  if (!record || record.resolved_at) return null;
  const summary = record.what_i_need || record.what_i_tried;
  if (!summary) return null;
  return {
    id: run.id,
    type: "run_input",
    summary,
    waiting_since: record.created_at,
  };
}

function parseBudgetUsedToday(): number {
  const raw = process.env.CONTROL_CENTER_BUDGET_USED_TODAY;
  if (!raw) return 0;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function buildGlobalContextResponse(): GlobalContextResponse {
  const summaries = syncAndListRepoSummaries();
  const projects: Array<{
    summary: GlobalProjectSummary;
    attentionNeeded: boolean;
    sortPriority: number;
  }> = [];
  const escalationQueue: EscalationQueueItem[] = [];

  let vmsRunning = 0;
  let vmsAvailable = 0;

  for (const project of summaries) {
    const context = buildShiftContext(project.id, { runHistoryLimit: 5, activeRunScanLimit: 50 });
    if (!context) continue;
    const priority = project.priority;
    const runs = getRunsForProject(project.id, 50);
    const runsById = new Map(runs.map((run) => [run.id, run]));
    const activeShift = getActiveShift(project.id);
    const escalations = runs
      .map((run) => summarizeEscalation(run))
      .filter((entry): entry is EscalationSummary => Boolean(entry));
    const hasEscalation = escalations.length > 0;
    const hasFailures = runs.some((run) => RUN_FAILURE_STATUSES.has(run.status));
    const hasActiveShiftOrRun = Boolean(activeShift) || context.active_runs.length > 0;
    const health = resolveHealth({
      projectStatus: project.status,
      hasEscalation,
      hasFailures,
      hasReadyWork: context.work_orders.summary.ready > 0,
      hasActiveShiftOrRun,
    });
    const attentionNeeded =
      hasEscalation || (health !== "healthy" && project.status !== "parked");
    const lastActivity = selectLatestTimestamp([
      activeShift?.started_at,
      context.last_handoff?.created_at,
      context.last_human_interaction?.timestamp,
      context.recent_runs[0]?.created_at,
    ]);

    const projectSummary: GlobalProjectSummary = {
      id: context.project.id,
      name: context.project.name,
      status: project.status,
      health,
      active_shift: activeShift
        ? { id: activeShift.id, started_at: activeShift.started_at, agent_id: activeShift.agent_id }
        : null,
      escalations: escalations.map((entry) => ({
        id: entry.id,
        type: entry.type,
        summary: entry.summary,
      })),
      work_orders: {
        ready: context.work_orders.summary.ready,
        building: context.work_orders.summary.in_progress,
        blocked: context.work_orders.blocked.length,
      },
      recent_runs: context.recent_runs.map((run) => {
        const fullRun = runsById.get(run.id);
        return {
          id: run.id,
          wo_id: run.work_order_id,
          status: run.status,
          outcome: fullRun ? resolveRunOutcome(fullRun) : null,
        };
      }),
      last_activity: lastActivity,
    };

    projects.push({
      summary: projectSummary,
      attentionNeeded,
      sortPriority: priority,
    });

    for (const escalation of escalations) {
      escalationQueue.push({
        project_id: context.project.id,
        escalation_id: escalation.id,
        type: escalation.type,
        priority,
        waiting_since: escalation.waiting_since,
      });
    }

    const vm = getProjectVm(project.id);
    if (vm?.status === "running") vmsRunning += 1;
    if (vm?.status === "stopped") vmsAvailable += 1;
  }

  projects.sort((a, b) => {
    if (a.attentionNeeded !== b.attentionNeeded) {
      return a.attentionNeeded ? -1 : 1;
    }
    if (a.sortPriority !== b.sortPriority) {
      return a.sortPriority - b.sortPriority;
    }
    return a.summary.name.localeCompare(b.summary.name);
  });

  escalationQueue.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    return a.waiting_since.localeCompare(b.waiting_since);
  });

  return {
    projects: projects.map((entry) => entry.summary),
    escalation_queue: escalationQueue,
    resources: {
      vms_running: vmsRunning,
      vms_available: vmsAvailable,
      budget_used_today: parseBudgetUsedToday(),
    },
    assembled_at: new Date().toISOString(),
  };
}
