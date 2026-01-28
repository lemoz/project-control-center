import { listWorkOrders } from "./work_orders.js";
import type { ProjectLifecycleStatus, ProjectRow, RunRow } from "./db.js";

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const WINDOW_DAYS = 30;
const FAILURE_STATUSES = new Set<RunRow["status"]>([
  "baseline_failed",
  "failed",
  "merge_conflict",
  "canceled",
]);

export type ProjectLifecycleMetrics = {
  failure_rate_30d: number;
  wo_completion_rate_30d: number | null;
  avg_wos_per_week_30d: number;
  days_since_last_wo: number | null;
  days_since_last_activity: number | null;
};

export type ProjectLifecycleSuggestion = {
  to: ProjectLifecycleStatus;
  reason: string;
};

export type ProjectLifecycleSummary = {
  status: ProjectLifecycleStatus;
  suggestion: ProjectLifecycleSuggestion | null;
  metrics: ProjectLifecycleMetrics;
};

function parseTimestamp(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function diffDays(nowMs: number, thenMs: number): number {
  if (thenMs > nowMs) return 0;
  return Math.floor((nowMs - thenMs) / MS_PER_DAY);
}

function maxTimestamp(values: Array<string | null | undefined>): number | null {
  let best: number | null = null;
  for (const value of values) {
    const parsed = parseTimestamp(value);
    if (parsed === null) continue;
    if (best === null || parsed > best) best = parsed;
  }
  return best;
}

export function buildProjectLifecycleSummary(params: {
  project: Pick<ProjectRow, "path" | "lifecycle_status">;
  runs?: RunRow[];
  now?: Date;
}): ProjectLifecycleSummary {
  const now = params.now ?? new Date();
  const nowMs = now.getTime();
  const windowStartMs = nowMs - WINDOW_DAYS * MS_PER_DAY;
  const runs = params.runs ?? [];
  const runsInWindow = runs.filter((run) => {
    const createdAt = parseTimestamp(run.created_at);
    return createdAt !== null && createdAt >= windowStartMs;
  });
  const failureCount = runsInWindow.filter((run) => FAILURE_STATUSES.has(run.status)).length;
  const failureRate = runsInWindow.length > 0 ? failureCount / runsInWindow.length : 0;

  const workOrders = listWorkOrders(params.project.path);
  const wosInWindow = workOrders.filter((wo) => {
    const updatedAt = parseTimestamp(wo.updated_at);
    return updatedAt !== null && updatedAt >= windowStartMs;
  });
  const doneInWindow = wosInWindow.filter((wo) => wo.status === "done").length;
  const woCompletionRate = wosInWindow.length > 0 ? doneInWindow / wosInWindow.length : null;
  const avgWosPerWeek = wosInWindow.length / (WINDOW_DAYS / 7);
  const lastWoUpdate = maxTimestamp(workOrders.map((wo) => wo.updated_at));
  const lastRun = maxTimestamp(runs.map((run) => run.created_at));
  let lastActivity = lastWoUpdate;
  if (lastRun !== null) {
    lastActivity = lastActivity === null ? lastRun : Math.max(lastActivity, lastRun);
  }

  const daysSinceLastWO = lastWoUpdate !== null ? diffDays(nowMs, lastWoUpdate) : null;
  const daysSinceLastActivity =
    lastActivity !== null ? diffDays(nowMs, lastActivity) : null;

  let suggestion: ProjectLifecycleSuggestion | null = null;
  if (
    params.project.lifecycle_status === "active" &&
    failureRate < 0.1 &&
    woCompletionRate !== null &&
    woCompletionRate > 0.9 &&
    avgWosPerWeek < 2
  ) {
    suggestion = { to: "stable", reason: "Consistently healthy, low activity" };
  } else if (
    params.project.lifecycle_status === "stable" &&
    daysSinceLastWO !== null &&
    daysSinceLastWO > 30
  ) {
    suggestion = { to: "maintenance", reason: "No WOs in 30 days" };
  } else if (
    params.project.lifecycle_status === "maintenance" &&
    daysSinceLastActivity !== null &&
    daysSinceLastActivity > 90
  ) {
    suggestion = { to: "archived", reason: "No activity in 90 days" };
  }

  return {
    status: params.project.lifecycle_status,
    suggestion,
    metrics: {
      failure_rate_30d: failureRate,
      wo_completion_rate_30d: woCompletionRate,
      avg_wos_per_week_30d: avgWosPerWeek,
      days_since_last_wo: daysSinceLastWO,
      days_since_last_activity: daysSinceLastActivity,
    },
  };
}
