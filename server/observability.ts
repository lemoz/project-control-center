import fs from "fs";
import { getGlobalBudget } from "./budgeting.js";
import {
  getDb,
  getRunById,
  updateRun,
  type RunFailureCategory,
  type RunRow,
} from "./db.js";
import { buildFailureContext, classifyRunFailure } from "./failure_analysis.js";

export type ActiveRunResponse = {
  id: string;
  work_order_id: string;
  status: string;
  phase: string;
  started_at: string | null;
  duration_seconds: number;
  current_activity: string;
};

export type RunTimelineEntry = {
  id: string;
  work_order_id: string;
  status: string;
  started_at: string | null;
  finished_at: string | null;
  outcome: "passed" | "failed" | "in_progress";
};

export type RunFailureBreakdownCategory = {
  category: RunFailureCategory;
  count: number;
  percent: number;
};

export type RunFailurePatternBreakdown = {
  category: RunFailureCategory;
  pattern: string;
  count: number;
  percent: number;
};

export type RunFailureBreakdownResponse = {
  total_runs: number;
  total_terminal: number;
  total_failed: number;
  success_rate: number;
  failure_rate: number;
  categories: RunFailureBreakdownCategory[];
  top_patterns: RunFailurePatternBreakdown[];
};

export type BudgetSummaryResponse = {
  monthly_budget: number;
  spent: number;
  remaining: number;
  daily_rate: number;
  runway_days: number;
  status: "healthy" | "warning" | "critical";
};

export type HeartbeatResponse = {
  active_runs: ActiveRunResponse[];
  last_activity_at: string | null;
  last_activity: string | null;
};

export type ObservabilityAlert = {
  id: string;
  type: string;
  severity: "warning" | "critical";
  message: string;
  created_at: string;
  acknowledged: boolean;
  run_id?: string;
  work_order_id?: string;
  waiting_since?: string;
};

const ACTIVE_STATUSES = new Set([
  "queued",
  "building",
  "waiting_for_input",
  "ai_review",
  "testing",
]);
const FAILED_STATUSES = new Set([
  "failed",
  "baseline_failed",
  "merge_conflict",
  "canceled",
]);
const PASSED_STATUSES = new Set(["merged", "you_review"]);

function nowIso(): string {
  return new Date().toISOString();
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

function parseIso(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function parseEscalationCreatedAt(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { created_at?: string };
    return typeof parsed?.created_at === "string" ? parsed.created_at : null;
  } catch {
    return null;
  }
}

function computeDurationSeconds(run: RunRow, nowMs: number): number {
  const startMs = parseIso(run.started_at) ?? parseIso(run.created_at) ?? null;
  if (!startMs) return 0;
  return Math.max(0, Math.floor((nowMs - startMs) / 1000));
}

function pickLastActivity(lineData: string[]): string {
  for (let i = lineData.length - 1; i >= 0; i -= 1) {
    const trimmed = lineData[i]?.trim();
    if (trimmed) return trimmed;
  }
  return "";
}

function tailLines(
  filePath: string,
  maxLines: number,
  maxBytes = 24_000
): { lines: string[]; has_more: boolean } {
  try {
    const stat = fs.statSync(filePath);
    const start = Math.max(0, stat.size - maxBytes);
    const fd = fs.openSync(filePath, "r");
    const buf = Buffer.alloc(stat.size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    fs.closeSync(fd);
    const text = buf.toString("utf8");
    let lines = text.split(/\r?\n/);
    if (lines.length && lines[lines.length - 1] === "") {
      lines = lines.slice(0, -1);
    }
    const hasMore = stat.size > maxBytes || lines.length > maxLines;
    return { lines: lines.slice(-maxLines), has_more: hasMore };
  } catch {
    return { lines: [], has_more: false };
  }
}

export function tailRunLog(
  runId: string,
  lineCount: number
): { lines: string[]; has_more: boolean } | null {
  const run = getRunById(runId);
  if (!run) return null;
  const safeLines = Math.max(1, Math.min(500, Math.trunc(lineCount)));
  return tailLines(run.log_path, safeLines);
}

export function listActiveRuns(
  limit = 20,
  options?: { includeActivity?: boolean }
): ActiveRunResponse[] {
  const database = getDb();
  const nowMs = Date.now();
  const statuses = Array.from(ACTIVE_STATUSES);
  const placeholders = statuses.map(() => "?").join(", ");
  const rows = database
    .prepare(
      `SELECT * FROM runs WHERE status IN (${placeholders}) ORDER BY created_at DESC LIMIT ?`
    )
    .all(...statuses, limit) as RunRow[];

  const includeActivity = options?.includeActivity !== false;
  return rows.map((run) => {
    const tail = includeActivity
      ? tailLines(run.log_path, 8)
      : { lines: [], has_more: false };
    return {
      id: run.id,
      work_order_id: run.work_order_id,
      status: run.status,
      phase: phaseForStatus(run.status),
      started_at: run.started_at,
      duration_seconds: computeDurationSeconds(run, nowMs),
      current_activity: includeActivity ? pickLastActivity(tail.lines) : "",
    };
  });
}

function outcomeForStatus(status: string): "passed" | "failed" | "in_progress" {
  if (PASSED_STATUSES.has(status)) return "passed";
  if (FAILED_STATUSES.has(status)) return "failed";
  return "in_progress";
}

function fetchLastActivityAt(): string | null {
  const database = getDb();
  const row = database
    .prepare(
      "SELECT MAX(COALESCE(finished_at, started_at, created_at)) AS last_activity FROM runs"
    )
    .get() as { last_activity?: string | null } | undefined;
  const value = row?.last_activity ?? null;
  if (typeof value === "string" && value.trim()) return value;
  return null;
}

function pickLastActivityMessage(activeRuns: ActiveRunResponse[]): string | null {
  for (const run of activeRuns) {
    if (run.current_activity) return run.current_activity;
  }
  return null;
}

export function getHeartbeatResponse(limit = 20): HeartbeatResponse {
  const active_runs = listActiveRuns(limit, { includeActivity: true });
  return {
    active_runs,
    last_activity_at: fetchLastActivityAt(),
    last_activity: pickLastActivityMessage(active_runs),
  };
}

export function listRunTimeline(hours = 24): RunTimelineEntry[] {
  const database = getDb();
  const safeHours = Math.max(1, Math.min(168, Math.trunc(hours)));
  const cutoff = new Date(Date.now() - safeHours * 60 * 60 * 1000).toISOString();
  const rows = database
    .prepare(
      `SELECT id, work_order_id, status, started_at, finished_at
       FROM runs
       WHERE created_at >= ?
       ORDER BY created_at DESC`
    )
    .all(cutoff) as Array<{
    id: string;
    work_order_id: string;
    status: string;
    started_at: string | null;
    finished_at: string | null;
  }>;

  return rows.map((run) => ({
    id: run.id,
    work_order_id: run.work_order_id,
    status: run.status,
    started_at: run.started_at,
    finished_at: run.finished_at,
    outcome: outcomeForStatus(run.status),
  }));
}

function toPercent(count: number, total: number): number {
  if (!Number.isFinite(count) || !Number.isFinite(total) || total <= 0) return 0;
  return Math.round((count / total) * 1000) / 10;
}

export function listRunFailureBreakdown(
  limit = 200,
  projectId?: string | null
): RunFailureBreakdownResponse {
  const database = getDb();
  const safeLimit = Math.max(10, Math.min(1000, Math.trunc(limit)));
  const rows = projectId
    ? (database
        .prepare("SELECT * FROM runs WHERE project_id = ? ORDER BY created_at DESC LIMIT ?")
        .all(projectId, safeLimit) as RunRow[])
    : (database
        .prepare("SELECT * FROM runs ORDER BY created_at DESC LIMIT ?")
        .all(safeLimit) as RunRow[]);

  const categoryCounts = new Map<RunFailureCategory, number>();
  const patternCounts = new Map<string, { category: RunFailureCategory; count: number }>();
  let totalFailed = 0;
  let totalPassed = 0;

  for (const run of rows) {
    if (PASSED_STATUSES.has(run.status)) {
      totalPassed += 1;
    }
    if (!FAILED_STATUSES.has(run.status)) continue;

    totalFailed += 1;
    let category = run.failure_category ?? null;
    let pattern = run.failure_reason ?? null;
    let detail = run.failure_detail ?? null;

    if (!category || !pattern) {
      const context = buildFailureContext(run);
      const classified = classifyRunFailure(context);
      if (classified) {
        category = classified.category;
        pattern = classified.pattern;
        detail = classified.detail;
        if (
          run.failure_category === null ||
          run.failure_reason === null ||
          run.failure_detail === null
        ) {
          updateRun(run.id, {
            failure_category: category,
            failure_reason: pattern,
            failure_detail: detail,
          });
        }
      }
    }

    const resolvedCategory = category ?? "unknown";
    const resolvedPattern = pattern ?? "unknown";
    categoryCounts.set(
      resolvedCategory,
      (categoryCounts.get(resolvedCategory) ?? 0) + 1
    );
    const existing = patternCounts.get(resolvedPattern);
    if (existing) {
      existing.count += 1;
    } else {
      patternCounts.set(resolvedPattern, { category: resolvedCategory, count: 1 });
    }
  }

  const totalRuns = rows.length;
  const totalTerminal = totalPassed + totalFailed;
  const categories = Array.from(categoryCounts.entries())
    .map(([category, count]) => ({
      category,
      count,
      percent: toPercent(count, totalFailed),
    }))
    .sort((a, b) => b.count - a.count);

  const topPatterns = Array.from(patternCounts.entries())
    .map(([pattern, entry]) => ({
      pattern,
      category: entry.category,
      count: entry.count,
      percent: toPercent(entry.count, totalFailed),
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  return {
    total_runs: totalRuns,
    total_terminal: totalTerminal,
    total_failed: totalFailed,
    success_rate: toPercent(totalPassed, totalTerminal),
    failure_rate: toPercent(totalFailed, totalTerminal),
    categories,
    top_patterns: topPatterns,
  };
}

function daysBetweenInclusive(start: string, end: string): number {
  const startMs = parseIso(start) ?? Date.now();
  const endMs = parseIso(end) ?? Date.now();
  const startDate = new Date(startMs);
  const endDate = new Date(endMs);
  const startUtc = Date.UTC(
    startDate.getUTCFullYear(),
    startDate.getUTCMonth(),
    startDate.getUTCDate()
  );
  const endUtc = Date.UTC(
    endDate.getUTCFullYear(),
    endDate.getUTCMonth(),
    endDate.getUTCDate()
  );
  const diffDays = Math.floor((endUtc - startUtc) / (24 * 60 * 60 * 1000));
  return Math.max(1, diffDays + 1);
}

function statusForBudget(remaining: number, budget: number): "healthy" | "warning" | "critical" {
  if (!Number.isFinite(budget) || budget <= 0) {
    return "healthy";
  }
  const ratio = remaining / budget;
  if (ratio <= 0) return "critical";
  if (ratio < 0.25) return "critical";
  if (ratio <= 0.5) return "warning";
  return "healthy";
}

export function getBudgetSummary(): BudgetSummaryResponse {
  const global = getGlobalBudget();
  const now = new Date();
  const daysElapsed = daysBetweenInclusive(global.current_period_start, now.toISOString());
  const daysRemaining = daysBetweenInclusive(now.toISOString(), global.current_period_end);
  const dailyRate = global.spent_usd / Math.max(1, daysElapsed);
  const remaining = global.remaining_usd;
  const runwayDays =
    dailyRate > 0 ? Math.max(0, remaining / dailyRate) : Math.max(0, daysRemaining);

  return {
    monthly_budget: global.monthly_budget_usd,
    spent: global.spent_usd,
    remaining,
    daily_rate: dailyRate,
    runway_days: runwayDays,
    status: statusForBudget(remaining, global.monthly_budget_usd),
  };
}

function formatAlertId(type: string, suffix?: string | null): string {
  if (!suffix) return type;
  return `${type}:${suffix}`;
}

export async function listObservabilityAlerts(
  projectId?: string | null
): Promise<ObservabilityAlert[]> {
  const alerts: ObservabilityAlert[] = [];
  const now = nowIso();

  const budget = getBudgetSummary();
  if (budget.monthly_budget > 0) {
    if (budget.remaining <= 0) {
      alerts.push({
        id: "budget_exhausted",
        type: "budget_exhausted",
        severity: "critical",
        message: "Budget exhausted",
        created_at: now,
        acknowledged: false,
      });
    } else if (budget.remaining / budget.monthly_budget <= 0.25) {
      alerts.push({
        id: "budget_warning",
        type: "budget_warning",
        severity: "warning",
        message: "Budget < 25% remaining",
        created_at: now,
        acknowledged: false,
      });
    }
  }

  const database = getDb();
  const escalationRows = database
    .prepare(
      `SELECT id, work_order_id, escalation, created_at, started_at
       FROM runs
       WHERE status = 'waiting_for_input'`
    )
    .all() as Array<
    Pick<RunRow, "id" | "work_order_id" | "escalation" | "created_at" | "started_at">
  >;
  const nowMs = Date.now();
  for (const run of escalationRows) {
    const waitingSince =
      parseEscalationCreatedAt(run.escalation) ?? run.started_at ?? run.created_at;
    const waitingMs = parseIso(waitingSince);
    if (!waitingMs) continue;
    const ageHours = (nowMs - waitingMs) / (1000 * 60 * 60);
    if (ageHours < 1) continue;
    alerts.push({
      id: formatAlertId("escalation_waiting", run.id),
      type: "escalation_waiting",
      severity: ageHours >= 12 ? "critical" : "warning",
      message: "Escalation awaiting input",
      created_at: now,
      acknowledged: false,
      run_id: run.id,
      work_order_id: run.work_order_id,
      waiting_since: waitingSince,
    });
  }

  const activeRuns = listActiveRuns(25, { includeActivity: false });
  const stuck = activeRuns.filter((run) => run.duration_seconds >= 30 * 60);
  if (stuck.length > 0) {
    alerts.push({
      id: formatAlertId("run_stuck", stuck[0]?.id),
      type: "run_stuck",
      severity: "warning",
      message: "Run stuck for 30+ minutes",
      created_at: now,
      acknowledged: false,
    });
  }

  const recent = database
    .prepare(
      "SELECT status FROM runs ORDER BY created_at DESC LIMIT 3"
    )
    .all() as Array<{ status: string }>;
  if (
    recent.length === 3 &&
    recent.every((row) => row.status === "baseline_failed")
  ) {
    alerts.push({
      id: "baseline_failures",
      type: "baseline_failures",
      severity: "warning",
      message: "3+ consecutive baseline failures",
      created_at: now,
      acknowledged: false,
    });
  }

  return alerts;
}
