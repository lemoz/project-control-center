import fs from "fs";
import { getGlobalBudget } from "./budgeting.js";
import {
  findProjectById,
  getDb,
  getProjectVm,
  getRunById,
  listProjects,
  type ProjectRow,
  type RunRow,
} from "./db.js";
import { remoteExec, RemoteExecError } from "./remote_exec.js";

type VmMetric = {
  used_gb: number;
  total_gb: number;
  percent: number;
};

export type VmHealthResponse = {
  project_id: string | null;
  project_name: string | null;
  vm_status: string | null;
  disk: VmMetric;
  memory: VmMetric;
  cpu: { load_1m: number; load_5m: number; percent: number };
  containers: Array<{ name: string; status: string; uptime: string }>;
  reachable: boolean;
  last_check: string;
  error: string | null;
};

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

export type BudgetSummaryResponse = {
  monthly_budget: number;
  spent: number;
  remaining: number;
  daily_rate: number;
  runway_days: number;
  status: "healthy" | "warning" | "critical";
};

export type ObservabilityAlert = {
  id: string;
  type: string;
  severity: "warning" | "critical";
  message: string;
  created_at: string;
  acknowledged: boolean;
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

const VM_HEALTH_CACHE_TTL_MS = 25_000;
let vmHealthCache: {
  projectId: string | null;
  fetchedAt: number;
  data: VmHealthResponse;
} | null = null;

function nowIso(): string {
  return new Date().toISOString();
}

function clampRatio(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function formatGb(valueKb: number): number {
  if (!Number.isFinite(valueKb) || valueKb <= 0) return 0;
  const gb = valueKb / 1024 / 1024;
  return Math.round(gb * 10) / 10;
}

function shellEscape(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function parseDiskLine(line: string): VmMetric {
  const parts = line.trim().split(/\s+/);
  if (parts.length < 5) {
    return { used_gb: 0, total_gb: 0, percent: 0 };
  }
  const totalKb = Number(parts[1]);
  const usedKb = Number(parts[2]);
  const rawPercent = Number(parts[4]?.replace("%", ""));
  const ratio =
    Number.isFinite(rawPercent) ? clampRatio(rawPercent / 100) : clampRatio(usedKb / totalKb);
  return {
    used_gb: formatGb(usedKb),
    total_gb: formatGb(totalKb),
    percent: ratio,
  };
}

function parseMemLine(line: string): VmMetric {
  const parts = line.trim().split(/\s+/);
  if (parts.length < 2) {
    return { used_gb: 0, total_gb: 0, percent: 0 };
  }
  const totalMb = Number(parts[0]);
  const usedMb = Number(parts[1]);
  const ratio = clampRatio(Number.isFinite(totalMb) ? usedMb / totalMb : 0);
  return {
    used_gb: Math.round((usedMb / 1024) * 10) / 10,
    total_gb: Math.round((totalMb / 1024) * 10) / 10,
    percent: ratio,
  };
}

function parseLoadLine(line: string, cpuCount: number): {
  load_1m: number;
  load_5m: number;
  percent: number;
} {
  const parts = line.trim().split(/\s+/);
  const load1 = Number(parts[0]);
  const load5 = Number(parts[1]);
  const ratio =
    Number.isFinite(load1) && cpuCount > 0 ? clampRatio(load1 / cpuCount) : 0;
  return {
    load_1m: Number.isFinite(load1) ? load1 : 0,
    load_5m: Number.isFinite(load5) ? load5 : 0,
    percent: ratio,
  };
}

function defaultVmMetric(): VmMetric {
  return { used_gb: 0, total_gb: 0, percent: 0 };
}

function buildVmHealthFallback(params: {
  projectId: string | null;
  projectName: string | null;
  vmStatus: string | null;
  error: string | null;
}): VmHealthResponse {
  return {
    project_id: params.projectId,
    project_name: params.projectName,
    vm_status: params.vmStatus,
    disk: defaultVmMetric(),
    memory: defaultVmMetric(),
    cpu: { load_1m: 0, load_5m: 0, percent: 0 },
    containers: [],
    reachable: false,
    last_check: nowIso(),
    error: params.error,
  };
}

function resolveVmProject(projectId?: string | null): ProjectRow | null {
  if (projectId) {
    return findProjectById(projectId) ?? null;
  }

  const projects = listProjects();
  if (!projects.length) return null;
  const running = projects.find((project) => {
    const vm = getProjectVm(project.id);
    return vm?.status === "running";
  });
  return running ?? projects[0] ?? null;
}

async function fetchVmHealth(project: ProjectRow | null): Promise<VmHealthResponse> {
  if (!project) {
    return buildVmHealthFallback({
      projectId: null,
      projectName: null,
      vmStatus: null,
      error: "No projects found",
    });
  }
  const vm = getProjectVm(project.id);
  if (!vm || vm.status !== "running") {
    return buildVmHealthFallback({
      projectId: project.id,
      projectName: project.name,
      vmStatus: vm?.status ?? null,
      error: vm ? `VM status is ${vm.status}` : "VM not configured",
    });
  }

  const script = [
    "set -e",
    "df -kP / | tail -n 1",
    "free -m | awk '/^Mem:/ {print $2\" \" $3}'",
    "cat /proc/loadavg",
    "nproc",
  ].join("\n");

  try {
    const result = await remoteExec(project.id, `bash -lc ${shellEscape(script)}`);
    const lines = result.stdout.trim().split(/\r?\n/);
    const diskLine = lines[0] ?? "";
    const memLine = lines[1] ?? "";
    const loadLine = lines[2] ?? "";
    const cpuCount = Number(lines[3]);

    const containersResult = await remoteExec(
      project.id,
      "docker ps --format '{{.Names}}||{{.Status}}||{{.RunningFor}}'",
      { allowFailure: true }
    );
    const containers = containersResult.stdout
      .trim()
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        const parts = line.split("||");
        return {
          name: parts[0] ?? "unknown",
          status: parts[1] ?? "unknown",
          uptime: parts[2] ?? "unknown",
        };
      });

    return {
      project_id: project.id,
      project_name: project.name,
      vm_status: vm.status,
      disk: parseDiskLine(diskLine),
      memory: parseMemLine(memLine),
      cpu: parseLoadLine(loadLine, Number.isFinite(cpuCount) ? cpuCount : 0),
      containers,
      reachable: true,
      last_check: nowIso(),
      error: null,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const reason =
      err instanceof RemoteExecError ? `${err.code}: ${message}` : message;
    return buildVmHealthFallback({
      projectId: project.id,
      projectName: project.name,
      vmStatus: vm.status,
      error: reason,
    });
  }
}

export async function getVmHealthResponse(
  projectId?: string | null
): Promise<VmHealthResponse> {
  const project = resolveVmProject(projectId);
  if (
    vmHealthCache &&
    vmHealthCache.projectId === (project?.id ?? null) &&
    Date.now() - vmHealthCache.fetchedAt < VM_HEALTH_CACHE_TTL_MS
  ) {
    return vmHealthCache.data;
  }
  const data = await fetchVmHealth(project);
  vmHealthCache = {
    projectId: project?.id ?? null,
    fetchedAt: Date.now(),
    data,
  };
  return data;
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

  const vmHealth = await getVmHealthResponse(projectId ?? null);
  if (vmHealth.reachable && vmHealth.disk.total_gb > 0) {
    if (vmHealth.disk.percent >= 0.95) {
      alerts.push({
        id: formatAlertId("vm_disk", vmHealth.project_id),
        type: "vm_disk",
        severity: "critical",
        message: "VM disk > 95%",
        created_at: now,
        acknowledged: false,
      });
    } else if (vmHealth.disk.percent >= 0.8) {
      alerts.push({
        id: formatAlertId("vm_disk", vmHealth.project_id),
        type: "vm_disk",
        severity: "warning",
        message: "VM disk > 80%",
        created_at: now,
        acknowledged: false,
      });
    }
  } else if (vmHealth.project_id && vmHealth.vm_status === "running") {
    alerts.push({
      id: formatAlertId("vm_unreachable", vmHealth.project_id),
      type: "vm_unreachable",
      severity: "critical",
      message: "Cannot reach VM",
      created_at: now,
      acknowledged: false,
    });
  }

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

  const database = getDb();
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
