import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";
import {
  findProjectById,
  getDb,
  getProjectVm,
  listRunsByProject,
  type ProjectVmRow,
  type RunRow,
} from "./db.js";
import { getGlobalBudget, getProjectBudget, type BudgetStatus } from "./budgeting.js";
import { getConstitutionForProject, selectRelevantConstitutionSections } from "./constitution.js";
import { getProjectCostHistory, getProjectCostSummary } from "./cost_tracking.js";
import { resolveRunnerSettingsForRepo } from "./settings.js";
import { readControlMetadata, type ControlSuccessMetric } from "./sidecar.js";
import { listWorkOrders, type WorkOrder, type WorkOrderStatus } from "./work_orders.js";

type SuccessMetric = {
  name: string;
  target: string | number;
  current: string | number | null;
};

export type WorkOrderSummary = {
  id: string;
  title: string;
  priority: number;
  tags: string[];
  depends_on: string[];
  deps_satisfied: boolean;
};

type HandoffDecision = {
  decision: string;
  rationale: string;
};

type LastHumanInteractionType =
  | "manual_run"
  | "review"
  | "escalation_response"
  | "status_update";

type LastHumanInteractionBase = {
  timestamp: string;
  type: LastHumanInteractionType;
};

type LastHumanInteraction = LastHumanInteractionBase & {
  seconds_since: number | null;
};

export type ShiftContext = {
  project: {
    id: string;
    name: string;
    path: string;
    type: "prototype" | "long_term";
    stage: string;
    status: string;
  };
  goals: {
    success_criteria: string;
    success_metrics: SuccessMetric[];
  };
  work_orders: {
    summary: {
      ready: number;
      backlog: number;
      done: number;
      in_progress: number;
    };
    ready: WorkOrderSummary[];
    backlog: WorkOrderSummary[];
    recent_done: WorkOrderSummary[];
    blocked: WorkOrderSummary[];
  };
  recent_runs: Array<{
    id: string;
    work_order_id: string;
    status: string;
    error: string | null;
    created_at: string;
  }>;
  constitution: {
    content: string;
    sections: string[];
  } | null;
  last_handoff: {
    created_at: string;
    summary: string;
    work_completed: string[];
    recommendations: string[];
    blockers: string[];
    next_priorities: string[];
    decisions_made: HandoffDecision[];
  } | null;
  git: {
    branch: string;
    uncommitted_changes: boolean;
    files_changed: number;
    ahead_behind: { ahead: number; behind: number } | null;
  };
  active_runs: Array<{
    id: string;
    work_order_id: string;
    started_at: string;
    status: string;
  }>;
  last_human_interaction: LastHumanInteraction | null;
  environment: {
    vm: {
      provisioned: boolean;
      host: string | null;
      status: "running" | "stopped" | "unknown";
    } | null;
    env_vars_available: string[];
    runner_ready: boolean;
  };
  economy: {
    budget_allocation_usd: number;
    budget_remaining_usd: number;
    budget_status: BudgetStatus;
    burn_rate_daily_usd: number;
    runway_days: number;
    period_days_remaining: number;
    daily_drip_usd: number;
    avg_cost_per_run_usd: number;
    avg_cost_per_wo_completed_usd: number;
    spent_this_period_usd: number;
    runs_this_period: number;
    wos_completed_this_period: number;
  };
  assembled_at: string;
};

type ShiftContextOptions = {
  runHistoryLimit?: number;
  activeRunScanLimit?: number;
};

const DEFAULT_RUN_HISTORY_LIMIT = 10;
const DEFAULT_ACTIVE_RUN_SCAN_LIMIT = 100;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const TERMINAL_RUN_STATUSES = new Set<RunRow["status"]>([
  "merged",
  "failed",
  "canceled",
  "baseline_failed",
  "superseded",
]);

export function buildShiftContext(
  projectId: string,
  options: ShiftContextOptions = {}
): ShiftContext | null {
  const project = findProjectById(projectId);
  if (!project) return null;

  const meta = readControlMetadata(project.path);
  const successCriteria = meta?.success_criteria ?? project.success_criteria ?? "";
  const successMetrics =
    meta?.success_metrics ?? safeParseSuccessMetrics(project.success_metrics);

  const workOrders = listWorkOrders(project.path);
  const workOrderState = buildWorkOrderState(workOrders);

  const now = new Date();
  const runHistoryLimit = options.runHistoryLimit ?? DEFAULT_RUN_HISTORY_LIMIT;
  const activeRunScanLimit = options.activeRunScanLimit ?? DEFAULT_ACTIVE_RUN_SCAN_LIMIT;
  const runs = listRunsByProject(project.id, Math.max(runHistoryLimit, activeRunScanLimit));
  const recentRuns = runs.slice(0, runHistoryLimit).map((run) => ({
    id: run.id,
    work_order_id: run.work_order_id,
    status: run.status,
    error: run.error,
    created_at: run.created_at,
  }));
  const activeRuns = runs
    .filter((run) => !TERMINAL_RUN_STATUSES.has(run.status))
    .map((run) => ({
      id: run.id,
      work_order_id: run.work_order_id,
      started_at: run.started_at ?? run.created_at,
      status: run.status,
    }));

  const constitution = buildConstitutionContext(project.path);
  const lastHandoff = readLastHandoff(project.id);
  const lastHumanInteraction = withInteractionAge(
    readLastHumanInteraction(project.id, runs),
    now
  );
  const gitState = buildGitState(project.path);
  const vmState = buildVmState(getProjectVm(project.id));
  const economy = buildEconomyContext({
    projectId: project.id,
    workOrders,
    now,
  });

  return {
    project: {
      id: project.id,
      name: project.name,
      path: project.path,
      type: project.type,
      stage: project.stage,
      status: project.status,
    },
    goals: {
      success_criteria: successCriteria,
      success_metrics: normalizeSuccessMetrics(successMetrics),
    },
    work_orders: workOrderState,
    recent_runs: recentRuns,
    constitution,
    last_handoff: lastHandoff,
    git: gitState,
    active_runs: activeRuns,
    last_human_interaction: lastHumanInteraction,
    environment: {
      vm: vmState,
      env_vars_available: listEnvVarNames(),
      runner_ready: isRunnerReady(project.path),
    },
    economy,
    assembled_at: now.toISOString(),
  };
}

function normalizeSuccessMetrics(metrics: SuccessMetric[] | ControlSuccessMetric[]): SuccessMetric[] {
  if (!Array.isArray(metrics)) return [];
  return metrics.map((metric) => ({
    name: metric.name,
    target: metric.target,
    current: "current" in metric ? metric.current ?? null : null,
  }));
}

function safeParseSuccessMetrics(value: string | null | undefined): SuccessMetric[] {
  if (typeof value !== "string" || value.length === 0) return [];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((entry) => normalizeSuccessMetric(entry))
      .filter((entry): entry is SuccessMetric => Boolean(entry));
  } catch {
    return [];
  }
}

function normalizeSuccessMetric(value: unknown): SuccessMetric | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record.name !== "string" || !record.name.trim()) return null;
  const target = record.target;
  if (!(typeof target === "number" || typeof target === "string")) return null;
  const currentRaw = record.current;
  const current =
    currentRaw === null ||
    currentRaw === undefined ||
    typeof currentRaw === "number" ||
    typeof currentRaw === "string"
      ? (currentRaw ?? null)
      : null;
  return { name: record.name, target, current };
}

function buildWorkOrderState(workOrders: WorkOrder[]): ShiftContext["work_orders"] {
  const byId = new Map(workOrders.map((wo) => [wo.id, wo]));

  const depsSatisfied = (wo: WorkOrder): boolean => {
    if (!wo.depends_on.length) return true;
    return wo.depends_on.every((depId) => byId.get(depId)?.status === "done");
  };

  const toSummary = (wo: WorkOrder): WorkOrderSummary => ({
    id: wo.id,
    title: wo.title,
    priority: wo.priority,
    tags: wo.tags,
    depends_on: wo.depends_on,
    deps_satisfied: depsSatisfied(wo),
  });

  const summary = {
    ready: 0,
    backlog: 0,
    done: 0,
    in_progress: 0,
  };

  for (const wo of workOrders) {
    if (wo.status === "ready" && depsSatisfied(wo)) summary.ready += 1;
    else if (wo.status === "backlog") summary.backlog += 1;
    else if (wo.status === "done") summary.done += 1;
    else if (isInProgressStatus(wo.status)) summary.in_progress += 1;
  }

  const ready = workOrders
    .filter((wo) => wo.status === "ready" && depsSatisfied(wo))
    .map(toSummary);
  const backlog = workOrders.filter((wo) => wo.status === "backlog").map(toSummary);
  const recent_done = workOrders
    .filter((wo) => wo.status === "done")
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
    .slice(0, 5)
    .map(toSummary);
  const blocked = workOrders
    .filter((wo) => {
      if (wo.status === "done") return false;
      if (wo.status === "blocked") return true;
      return wo.depends_on.length > 0 && !depsSatisfied(wo);
    })
    .map(toSummary);

  return { summary, ready, backlog, recent_done, blocked };
}

function isInProgressStatus(status: WorkOrderStatus): boolean {
  return status === "building" || status === "ai_review" || status === "you_review";
}

function buildEconomyContext(params: {
  projectId: string;
  workOrders: WorkOrder[];
  now: Date;
}): ShiftContext["economy"] {
  const empty: ShiftContext["economy"] = {
    budget_allocation_usd: 0,
    budget_remaining_usd: 0,
    budget_status: "exhausted",
    burn_rate_daily_usd: 0,
    runway_days: 0,
    period_days_remaining: 1,
    daily_drip_usd: 0,
    avg_cost_per_run_usd: 0,
    avg_cost_per_wo_completed_usd: 0,
    spent_this_period_usd: 0,
    runs_this_period: 0,
    wos_completed_this_period: 0,
  };

  try {
    const globalBudget = getGlobalBudget();
    const projectBudget = getProjectBudget(params.projectId);
    const periodEnd = new Date(globalBudget.current_period_end);
    const periodStart = new Date(globalBudget.current_period_start);
    const periodDaysRemaining = Number.isFinite(periodEnd.getTime())
      ? Math.max(1, diffDaysInclusive(params.now, periodEnd))
      : 1;

    const costSummary = getProjectCostSummary({
      projectId: params.projectId,
      period: "month",
    });
    const costHistory = getProjectCostHistory(params.projectId, 7);
    const burnRateDaily = averageDailyCost(costHistory.daily);
    const remainingBudget = projectBudget.remaining_usd;
    const remainingForRunway = Math.max(0, remainingBudget);
    const runwayDays =
      remainingForRunway <= 0
        ? 0
        : burnRateDaily > 0
          ? remainingForRunway / burnRateDaily
          : periodDaysRemaining;

    const wosCompleted = countWosCompletedInPeriod(
      params.workOrders,
      periodStart,
      periodEnd
    );
    const avgCostPerWo =
      wosCompleted > 0 ? projectBudget.spent_usd / wosCompleted : 0;

    return {
      budget_allocation_usd: projectBudget.monthly_allocation_usd,
      budget_remaining_usd: projectBudget.remaining_usd,
      budget_status: projectBudget.budget_status,
      burn_rate_daily_usd: burnRateDaily,
      runway_days: runwayDays,
      period_days_remaining: periodDaysRemaining,
      daily_drip_usd: projectBudget.daily_drip_usd,
      avg_cost_per_run_usd: costSummary.avg_cost_per_run,
      avg_cost_per_wo_completed_usd: avgCostPerWo,
      spent_this_period_usd: projectBudget.spent_usd,
      runs_this_period: costSummary.run_count,
      wos_completed_this_period: wosCompleted,
    };
  } catch {
    return empty;
  }
}

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function diffDaysInclusive(start: Date, end: Date): number {
  const startDay = startOfUtcDay(start);
  const endDay = startOfUtcDay(end);
  const diff = Math.floor((endDay.getTime() - startDay.getTime()) / MS_PER_DAY);
  return Math.max(0, diff + 1);
}

function averageDailyCost(daily: Array<{ total_cost_usd: number }>): number {
  if (!daily.length) return 0;
  const total = daily.reduce((sum, entry) => sum + (entry.total_cost_usd ?? 0), 0);
  return total / daily.length;
}

function countWosCompletedInPeriod(
  workOrders: WorkOrder[],
  periodStart: Date,
  periodEnd: Date
): number {
  const startMs = Date.parse(periodStart.toISOString());
  const endMs = Date.parse(periodEnd.toISOString());
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return 0;
  return workOrders.filter((wo) => {
    if (wo.status !== "done") return false;
    const updatedMs = Date.parse(wo.updated_at);
    if (!Number.isFinite(updatedMs)) return false;
    return updatedMs >= startMs && updatedMs <= endMs;
  }).length;
}

function buildConstitutionContext(repoPath: string): ShiftContext["constitution"] {
  const content = getConstitutionForProject(repoPath).trim();
  if (!content) return null;
  const selection = selectRelevantConstitutionSections({
    constitution: content,
    context: "chat",
  });
  return { content: selection.content, sections: selection.sectionTitles };
}

function readLastHandoff(projectId: string): ShiftContext["last_handoff"] {
  const db = getDb();
  try {
    const table = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'shift_handoffs' LIMIT 1"
      )
      .get() as { name: string } | undefined;
    if (!table) return null;
    const row = db
      .prepare(
        `SELECT created_at, summary, work_completed, recommendations, blockers, next_priorities, decisions_made
         FROM shift_handoffs
         WHERE project_id = ?
         ORDER BY created_at DESC
         LIMIT 1`
      )
      .get(projectId) as
      | {
          created_at: string;
          summary: string;
          work_completed: string | null;
          recommendations: string | null;
          blockers: string | null;
          next_priorities: string | null;
          decisions_made: string | null;
        }
      | undefined;
    if (!row) return null;
    return {
      created_at: row.created_at,
      summary: row.summary,
      work_completed: parseJsonStringArray(row.work_completed),
      recommendations: parseJsonStringArray(row.recommendations),
      blockers: parseJsonStringArray(row.blockers),
      next_priorities: parseJsonStringArray(row.next_priorities),
      decisions_made: parseJsonDecisionArray(row.decisions_made),
    };
  } catch {
    return null;
  }
}

function parseJsonStringArray(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((entry) => String(entry)).filter((entry) => entry.trim().length > 0);
  } catch {
    return [];
  }
}

function parseJsonDecisionArray(value: string | null): HandoffDecision[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    const decisions: HandoffDecision[] = [];
    for (const entry of parsed) {
      if (!entry || typeof entry !== "object") continue;
      const record = entry as Record<string, unknown>;
      const decision = typeof record.decision === "string" ? record.decision.trim() : "";
      const rationale = typeof record.rationale === "string" ? record.rationale.trim() : "";
      if (!decision || !rationale) continue;
      decisions.push({ decision, rationale });
    }
    return decisions;
  } catch {
    return [];
  }
}

function readLastHumanInteraction(
  projectId: string,
  runs: RunRow[] = []
): LastHumanInteractionBase | null {
  const db = getDb();
  let messageRow: { timestamp: string } | undefined;
  let actionRow: { timestamp: string; action_type: string } | undefined;

  try {
    messageRow = db
      .prepare(
        `SELECT m.created_at AS timestamp
         FROM chat_messages m
         JOIN chat_threads t ON t.id = m.thread_id
         WHERE m.role = 'user' AND t.project_id = ?
         ORDER BY m.created_at DESC
         LIMIT 1`
      )
      .get(projectId) as { timestamp: string } | undefined;
  } catch {
    messageRow = undefined;
  }

  try {
    actionRow = db
      .prepare(
        `SELECT cal.applied_at AS timestamp, cal.action_type AS action_type
         FROM chat_action_ledger cal
         JOIN chat_threads t ON t.id = cal.thread_id
         WHERE t.project_id = ?
         ORDER BY cal.applied_at DESC
         LIMIT 1`
      )
      .get(projectId) as { timestamp: string; action_type: string } | undefined;
  } catch {
    actionRow = undefined;
  }

  const candidates: LastHumanInteractionBase[] = [];

  if (messageRow?.timestamp) {
    candidates.push({ timestamp: messageRow.timestamp, type: "status_update" });
  }

  if (actionRow?.timestamp) {
    const type = actionRow.action_type === "work_order_start_run" ? "manual_run" : "status_update";
    candidates.push({ timestamp: actionRow.timestamp, type });
  }

  const runReview = latestRunReview(runs);
  if (runReview) candidates.push(runReview);

  const escalationResponse = latestEscalationResponse(runs);
  if (escalationResponse) candidates.push(escalationResponse);

  if (candidates.length === 0) return null;

  return candidates.reduce<LastHumanInteractionBase | null>((latest, entry) => {
    if (!latest) return entry;
    return entry && entry.timestamp > latest.timestamp ? entry : latest;
  }, null);
}

function latestRunReview(runs: RunRow[]): LastHumanInteractionBase | null {
  let latest: LastHumanInteractionBase | null = null;
  for (const run of runs) {
    if (run.status !== "merged") continue;
    const timestamp = run.finished_at ?? run.created_at;
    if (!timestamp) continue;
    const candidate: LastHumanInteractionBase = { timestamp, type: "review" };
    if (!latest || candidate.timestamp > latest.timestamp) latest = candidate;
  }
  return latest;
}

function latestEscalationResponse(runs: RunRow[]): LastHumanInteractionBase | null {
  let latest: LastHumanInteractionBase | null = null;
  for (const run of runs) {
    const resolvedAt = parseEscalationResolvedAt(run.escalation);
    if (!resolvedAt) continue;
    const candidate: LastHumanInteractionBase = {
      timestamp: resolvedAt,
      type: "escalation_response",
    };
    if (!latest || candidate.timestamp > latest.timestamp) latest = candidate;
  }
  return latest;
}

function parseEscalationResolvedAt(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { resolved_at?: unknown };
    if (typeof parsed?.resolved_at !== "string" || !parsed.resolved_at.trim()) return null;
    return parsed.resolved_at;
  } catch {
    return null;
  }
}

function withInteractionAge(
  interaction: LastHumanInteractionBase | null,
  now: Date
): LastHumanInteraction | null {
  if (!interaction) return null;
  return {
    ...interaction,
    seconds_since: secondsSince(interaction.timestamp, now),
  };
}

function secondsSince(timestamp: string, now: Date): number | null {
  const parsed = Date.parse(timestamp);
  if (!Number.isFinite(parsed)) return null;
  const diffMs = now.getTime() - parsed;
  if (!Number.isFinite(diffMs)) return null;
  return Math.max(0, Math.floor(diffMs / 1000));
}

function buildGitState(repoPath: string): ShiftContext["git"] {
  const fallback = {
    branch: "unknown",
    uncommitted_changes: false,
    files_changed: 0,
    ahead_behind: null,
  };

  if (!fs.existsSync(repoPath)) return fallback;
  const gitDir = path.join(repoPath, ".git");
  if (!fs.existsSync(gitDir)) return fallback;

  const branchResult = runGit(repoPath, ["rev-parse", "--abbrev-ref", "HEAD"]);
  const branch = branchResult.ok ? branchResult.stdout.trim() || "unknown" : "unknown";

  const statusResult = runGit(repoPath, ["status", "--porcelain"]);
  const statusLines = statusResult.ok
    ? statusResult.stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
    : [];
  const files_changed = statusLines.length;

  const aheadBehind = (() => {
    const upstreamResult = runGit(repoPath, ["rev-list", "--left-right", "--count", "@{upstream}...HEAD"]);
    if (!upstreamResult.ok) return null;
    const parts = upstreamResult.stdout.trim().split(/\s+/);
    if (parts.length < 2) return null;
    const behind = Number(parts[0]);
    const ahead = Number(parts[1]);
    if (!Number.isFinite(ahead) || !Number.isFinite(behind)) return null;
    return { ahead, behind };
  })();

  return {
    branch,
    uncommitted_changes: files_changed > 0,
    files_changed,
    ahead_behind: aheadBehind,
  };
}

function runGit(repoPath: string, args: string[]): {
  ok: boolean;
  stdout: string;
  stderr: string;
} {
  const result = spawnSync("git", args, { cwd: repoPath, encoding: "utf8" });
  if (result.error) {
    return {
      ok: false,
      stdout: "",
      stderr: result.error instanceof Error ? result.error.message : String(result.error),
    };
  }
  return {
    ok: (result.status ?? 1) === 0,
    stdout: typeof result.stdout === "string" ? result.stdout : "",
    stderr: typeof result.stderr === "string" ? result.stderr : "",
  };
}

function buildVmState(vm: ProjectVmRow | null): ShiftContext["environment"]["vm"] {
  if (!vm) return null;
  const provisioned = vm.status !== "not_provisioned" && vm.status !== "deleted";
  const status =
    vm.status === "running" ? "running" : vm.status === "stopped" ? "stopped" : "unknown";
  const host = vm.external_ip ?? vm.internal_ip ?? null;
  return { provisioned, host, status };
}

function listEnvVarNames(): string[] {
  return Object.keys(process.env).sort();
}

function isRunnerReady(repoPath: string): boolean {
  const settings = resolveRunnerSettingsForRepo(repoPath).effective;
  const builderReady = isProviderReady(settings.builder);
  if (!builderReady) return false;
  const reviewerReady = isProviderReady(settings.reviewer);
  if (!reviewerReady) return false;
  return true;
}

function isProviderReady(provider: { provider: string; cliPath: string }): boolean {
  if (provider.provider !== "codex") return false;
  const cliPath = provider.cliPath?.trim() || "codex";
  return isExecutableAvailable(cliPath);
}

function isExecutableAvailable(command: string): boolean {
  if (!command) return false;
  if (path.isAbsolute(command)) {
    return fs.existsSync(command);
  }
  if (command.includes(path.sep)) {
    return fs.existsSync(path.resolve(command));
  }
  const pathEntries = (process.env.PATH ?? "")
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean);
  const extensions =
    process.platform === "win32"
      ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM").split(";")
      : [""];
  for (const entry of pathEntries) {
    for (const ext of extensions) {
      const candidate = path.join(entry, `${command}${ext}`);
      if (fs.existsSync(candidate)) return true;
    }
  }
  return false;
}
