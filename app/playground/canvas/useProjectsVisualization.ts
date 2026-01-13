"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ProjectNode, VisualizationData } from "./types";

type RepoSummary = {
  id: string;
  name: string;
  description: string | null;
  path: string;
  type: "prototype" | "long_term";
  stage: string;
  status: "active" | "blocked" | "parked";
  priority: number;
  starred: boolean;
  hidden: boolean;
  tags: string[];
  next_work_orders?: Array<{ id: string; title: string; status: string }>;
};

type WorkOrderStatus =
  | "backlog"
  | "ready"
  | "building"
  | "ai_review"
  | "you_review"
  | "done"
  | "blocked"
  | "parked";

type WorkOrder = {
  id: string;
  title: string;
  status: WorkOrderStatus;
  priority: number;
  updated_at: string;
  depends_on: string[];
};

type RunStatus =
  | "queued"
  | "baseline_failed"
  | "building"
  | "waiting_for_input"
  | "ai_review"
  | "testing"
  | "you_review"
  | "merged"
  | "merge_conflict"
  | "failed"
  | "canceled";

type RunSummary = {
  id: string;
  work_order_id: string;
  status: RunStatus;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  escalation: string | null;
};

type RunsResponse = {
  runs: RunSummary[];
  error?: string;
};

type GlobalContextProject = {
  id: string;
  name: string;
  status: "active" | "blocked" | "parked";
  health: "healthy" | "stalled" | "failing" | "blocked";
  active_shift: { id: string; started_at: string; agent_id: string | null } | null;
  escalations: Array<{ id: string; type: string; summary: string }>;
  work_orders: { ready: number; building: number; blocked: number };
  recent_runs: Array<{ id: string; wo_id: string; status: string; outcome: string | null }>;
  last_activity: string | null;
};

type GlobalEconomySummary = {
  monthly_budget_usd: number;
  total_allocated_usd: number;
  total_spent_usd: number;
  total_remaining_usd: number;
  projects_healthy: number;
  projects_warning: number;
  projects_critical: number;
  projects_exhausted: number;
  portfolio_burn_rate_daily_usd: number;
  portfolio_runway_days: number;
};

type GlobalContextResponse = {
  projects: GlobalContextProject[];
  economy: GlobalEconomySummary;
  assembled_at: string;
};

type ShiftContextWorkOrderSummary = {
  ready: number;
  backlog: number;
  done: number;
  in_progress: number;
};

type ProjectCostSummary = {
  project_id: string;
  period: string;
  total_cost_usd: number;
  token_totals: {
    input: number;
    output: number;
  };
};

type ShiftEconomySummary = {
  budget_allocation_usd: number;
  budget_remaining_usd: number;
  budget_status: "healthy" | "warning" | "critical" | "exhausted";
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

type ShiftContext = {
  project: {
    id: string;
    name: string;
    path: string;
    status: string;
  };
  work_orders: {
    summary: ShiftContextWorkOrderSummary;
    blocked: Array<{ id: string }>;
  };
  recent_runs: Array<{ id: string; created_at: string }>;
  active_runs: Array<{ id: string; started_at: string }>;
  last_handoff: { created_at: string } | null;
  last_human_interaction: { timestamp: string } | null;
  economy: ShiftEconomySummary;
  assembled_at: string;
};

type WorkOrderSummary = {
  ready: number;
  building: number;
  blocked: number;
  done: number;
};

const TERMINAL_RUN_STATUSES = new Set<RunStatus>([
  "merged",
  "failed",
  "canceled",
  "baseline_failed",
  "merge_conflict",
]);

const PROJECT_STATUS_HEALTH: Record<RepoSummary["status"], number> = {
  active: 0.85,
  blocked: 0.3,
  parked: 0.5,
};

const GLOBAL_HEALTH_SCORE: Record<GlobalContextProject["health"], number> = {
  healthy: 0.85,
  stalled: 0.55,
  failing: 0.3,
  blocked: 0.2,
};

const BUILDING_WORK_ORDER_STATUSES = new Set<WorkOrderStatus>([
  "building",
  "ai_review",
  "you_review",
]);

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? null : date;
}

function latestDate(dates: Array<Date | null | undefined>): Date | null {
  const valid = dates.filter((date): date is Date => Boolean(date));
  if (!valid.length) return null;
  return new Date(Math.max(...valid.map((date) => date.getTime())));
}

function summarizeWorkOrders(workOrders: WorkOrder[]): WorkOrderSummary {
  const summary: WorkOrderSummary = { ready: 0, building: 0, blocked: 0, done: 0 };
  for (const workOrder of workOrders) {
    if (workOrder.status === "ready") summary.ready += 1;
    else if (workOrder.status === "blocked") summary.blocked += 1;
    else if (workOrder.status === "done") summary.done += 1;
    else if (BUILDING_WORK_ORDER_STATUSES.has(workOrder.status)) summary.building += 1;
  }
  return summary;
}

function computeSuccessProgress(workOrders: WorkOrder[]): number {
  if (!workOrders.length) return 0;
  const doneCount = workOrders.filter((wo) => wo.status === "done").length;
  return clamp(doneCount / workOrders.length, 0, 1);
}

function summarizeShiftWorkOrders(context: ShiftContext): WorkOrderSummary {
  return {
    ready: context.work_orders.summary.ready ?? 0,
    building: context.work_orders.summary.in_progress ?? 0,
    blocked: context.work_orders.blocked?.length ?? 0,
    done: context.work_orders.summary.done ?? 0,
  };
}

function computeSuccessProgressFromSummary(
  summary: WorkOrderSummary,
  backlogCount = 0
): number {
  const total =
    summary.ready + summary.building + summary.blocked + summary.done + backlogCount;
  if (total <= 0) return 0;
  return clamp(summary.done / total, 0, 1);
}

function shiftContextActivityDates(context: ShiftContext | null): Array<Date | null> {
  if (!context) return [];
  return [
    parseDate(context.last_handoff?.created_at ?? null),
    parseDate(context.last_human_interaction?.timestamp ?? null),
    ...context.recent_runs.map((run) => parseDate(run.created_at)),
    ...context.active_runs.map((run) => parseDate(run.started_at)),
  ];
}

function computeActivityLevel(activeRunsCount: number, lastActivity: Date | null): number {
  if (activeRunsCount > 0) return 1;
  if (!lastActivity) return 0;
  const ageHours = (Date.now() - lastActivity.getTime()) / 3_600_000;
  if (ageHours < 6) return 0.7;
  if (ageHours < 24) return 0.55;
  if (ageHours < 72) return 0.4;
  if (ageHours < 168) return 0.25;
  return 0.1;
}

function estimateConsumptionRate(params: {
  activeRuns: number;
  workOrders: WorkOrderSummary;
  lastActivity: Date | null;
  hasActiveShift: boolean;
}): number {
  const activityWeight =
    params.activeRuns * 120 +
    params.workOrders.building * 60 +
    params.workOrders.ready * 25 +
    params.workOrders.blocked * 10;
  const base = 40 + (params.hasActiveShift ? 50 : 0);
  const recencyBoost = params.lastActivity
    ? clamp(1 - (Date.now() - params.lastActivity.getTime()) / (14 * 24 * 60 * 60 * 1000), 0, 1)
    : 0;
  const rate = base + activityWeight;
  return Math.max(10, Math.round(rate * (0.75 + recencyBoost * 0.25)));
}

function hasRuns(value: unknown): value is RunsResponse {
  return Boolean(
    value &&
      typeof value === "object" &&
      "runs" in value &&
      Array.isArray((value as { runs?: unknown }).runs)
  );
}

function hasGlobalContext(value: unknown): value is GlobalContextResponse {
  return Boolean(
    value &&
      typeof value === "object" &&
      "projects" in value &&
      "economy" in value &&
      Array.isArray((value as { projects?: unknown }).projects)
  );
}

function hasShiftContext(value: unknown): value is ShiftContext {
  if (!value || typeof value !== "object") return false;
  const record = value as {
    project?: unknown;
    work_orders?: unknown;
    active_runs?: unknown;
    recent_runs?: unknown;
    economy?: unknown;
  };
  if (!record.project || typeof record.project !== "object") return false;
  if (!record.work_orders || typeof record.work_orders !== "object") return false;
  if (!Array.isArray(record.active_runs)) return false;
  if (!Array.isArray(record.recent_runs)) return false;
  if (!record.economy || typeof record.economy !== "object") return false;
  return true;
}

async function fetchRepos(): Promise<RepoSummary[]> {
  const res = await fetch("/api/repos", { cache: "no-store" });
  const json = (await res.json().catch(() => null)) as RepoSummary[] | { error?: string } | null;
  if (!res.ok) {
    const error = (json as { error?: string } | null)?.error || "failed to load projects";
    throw new Error(error);
  }
  if (!Array.isArray(json)) return [];
  return json as RepoSummary[];
}

async function fetchWorkOrders(projectId: string): Promise<WorkOrder[]> {
  const res = await fetch(`/api/repos/${encodeURIComponent(projectId)}/work-orders`, {
    cache: "no-store",
  });
  const json = (await res.json().catch(() => null)) as unknown;
  if (!res.ok) {
    const error =
      json &&
      typeof json === "object" &&
      "error" in json &&
      typeof (json as { error?: unknown }).error === "string"
        ? (json as { error?: string }).error || "failed to load work orders"
        : "failed to load work orders";
    throw new Error(error);
  }
  if (!json || typeof json !== "object") return [];
  if (!("work_orders" in json)) return [];
  const workOrders = (json as { work_orders?: WorkOrder[] }).work_orders;
  if (!Array.isArray(workOrders)) return [];
  return workOrders;
}

async function fetchRuns(projectId: string): Promise<RunSummary[]> {
  const res = await fetch(`/api/repos/${encodeURIComponent(projectId)}/runs?limit=50`, {
    cache: "no-store",
  });
  const json = (await res.json().catch(() => null)) as unknown;
  if (!res.ok) {
    const error =
      json &&
      typeof json === "object" &&
      "error" in json &&
      typeof (json as { error?: unknown }).error === "string"
        ? (json as { error?: string }).error || "failed to load runs"
        : "failed to load runs";
    throw new Error(error);
  }
  if (!hasRuns(json)) return [];
  return json.runs;
}

async function fetchGlobalContext(): Promise<GlobalContextResponse> {
  const res = await fetch("/api/global/context", { cache: "no-store" });
  const json = (await res.json().catch(() => null)) as unknown;
  if (!res.ok) {
    const error =
      json &&
      typeof json === "object" &&
      "error" in json &&
      typeof (json as { error?: unknown }).error === "string"
        ? (json as { error?: string }).error || "failed to load global context"
        : "failed to load global context";
    throw new Error(error);
  }
  if (!hasGlobalContext(json)) {
    throw new Error("missing global context");
  }
  return json;
}

async function fetchShiftContext(projectId: string): Promise<ShiftContext | null> {
  const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/shift-context`, {
    cache: "no-store",
  });
  const json = (await res.json().catch(() => null)) as unknown;
  if (!res.ok) {
    const error =
      json &&
      typeof json === "object" &&
      "error" in json &&
      typeof (json as { error?: unknown }).error === "string"
        ? (json as { error?: string }).error || "failed to load shift context"
        : "failed to load shift context";
    throw new Error(error);
  }
  if (!hasShiftContext(json)) return null;
  return json;
}

async function fetchProjectCosts(projectId: string): Promise<ProjectCostSummary | null> {
  const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/costs?period=day`, {
    cache: "no-store",
  });
  const json = (await res.json().catch(() => null)) as unknown;
  if (!res.ok) return null;
  if (!json || typeof json !== "object") return null;
  return json as ProjectCostSummary;
}

export function useProjectsVisualization(): {
  data: VisualizationData;
  loading: boolean;
  error: string | null;
  refresh: () => void;
  lastUpdated: Date | null;
} {
  const [projects, setProjects] = useState<RepoSummary[]>([]);
  const [workOrdersByProject, setWorkOrdersByProject] = useState<Record<string, WorkOrder[]>>({});
  const [runsByProject, setRunsByProject] = useState<Record<string, RunSummary[]>>({});
  const [globalContext, setGlobalContext] = useState<GlobalContextResponse | null>(null);
  const [shiftContexts, setShiftContexts] = useState<Record<string, ShiftContext>>({});
  const [costsByProject, setCostsByProject] = useState<Record<string, ProjectCostSummary>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const refreshInFlight = useRef(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const nextProjects = await fetchRepos();
      setProjects(nextProjects);

      const [workOrderResults, runResults, contextResult, shiftResults, costResults] = await Promise.all([
        Promise.allSettled(
          nextProjects.map(async (project) => {
            const workOrders = await fetchWorkOrders(project.id);
            return { projectId: project.id, workOrders };
          })
        ),
        Promise.allSettled(
          nextProjects.map(async (project) => {
            const runs = await fetchRuns(project.id);
            return { projectId: project.id, runs };
          })
        ),
        fetchGlobalContext().catch(() => null),
        Promise.allSettled(
          nextProjects.map(async (project) => {
            const context = await fetchShiftContext(project.id);
            return { projectId: project.id, context };
          })
        ),
        Promise.allSettled(
          nextProjects.map(async (project) => {
            const costs = await fetchProjectCosts(project.id);
            return { projectId: project.id, costs };
          })
        ),
      ]);

      const workOrdersMap: Record<string, WorkOrder[]> = {};
      for (const result of workOrderResults) {
        if (result.status === "fulfilled") {
          workOrdersMap[result.value.projectId] = result.value.workOrders;
        }
      }
      setWorkOrdersByProject(workOrdersMap);

      const runsMap: Record<string, RunSummary[]> = {};
      for (const result of runResults) {
        if (result.status === "fulfilled") {
          runsMap[result.value.projectId] = result.value.runs;
        }
      }
      setRunsByProject(runsMap);

      if (contextResult) {
        setGlobalContext(contextResult);
      }

      const shiftMap: Record<string, ShiftContext> = {};
      for (const result of shiftResults) {
        if (result.status === "fulfilled" && result.value.context) {
          shiftMap[result.value.projectId] = result.value.context;
        }
      }
      setShiftContexts(shiftMap);

      const costsMap: Record<string, ProjectCostSummary> = {};
      for (const result of costResults) {
        if (result.status === "fulfilled" && result.value.costs) {
          costsMap[result.value.projectId] = result.value.costs;
        }
      }
      setCostsByProject(costsMap);

      setLastUpdated(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed to load visualization data");
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshActivity = useCallback(async () => {
    if (refreshInFlight.current) return;
    refreshInFlight.current = true;
    try {
      const nextProjects = await fetchRepos();
      setProjects(nextProjects);

      const [runResults, shiftResults, contextResult] = await Promise.all([
        Promise.allSettled(
          nextProjects.map(async (project) => {
            const runs = await fetchRuns(project.id);
            return { projectId: project.id, runs };
          })
        ),
        Promise.allSettled(
          nextProjects.map(async (project) => {
            const context = await fetchShiftContext(project.id);
            return { projectId: project.id, context };
          })
        ),
        fetchGlobalContext().catch(() => null),
      ]);

      const runsMap: Record<string, RunSummary[]> = {};
      for (const result of runResults) {
        if (result.status === "fulfilled") {
          runsMap[result.value.projectId] = result.value.runs;
        }
      }
      setRunsByProject((prev) => ({ ...prev, ...runsMap }));

      if (contextResult) {
        setGlobalContext(contextResult);
      }

      const shiftMap: Record<string, ShiftContext> = {};
      for (const result of shiftResults) {
        if (result.status === "fulfilled" && result.value.context) {
          shiftMap[result.value.projectId] = result.value.context;
        }
      }
      if (Object.keys(shiftMap).length > 0) {
        setShiftContexts((prev) => ({ ...prev, ...shiftMap }));
      }

      setLastUpdated(new Date());
    } catch {
      // Polling is best-effort; keep last error to avoid noisy retries.
    } finally {
      refreshInFlight.current = false;
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      void refreshActivity();
    }, 5000);
    return () => window.clearInterval(interval);
  }, [refreshActivity]);

  const data = useMemo<VisualizationData>(() => {
    const nodes: ProjectNode[] = [];
    const globalProjects = new Map(
      globalContext?.projects.map((project) => [project.id, project]) ?? []
    );

    for (const project of projects) {
      const workOrders = workOrdersByProject[project.id] ?? [];
      const runs = runsByProject[project.id] ?? [];
      const shiftContext = shiftContexts[project.id] ?? null;
      const summaryFromList = summarizeWorkOrders(workOrders);
      const shiftSummary = shiftContext ? summarizeShiftWorkOrders(shiftContext) : null;
      const summary = shiftSummary ?? summaryFromList;
      const globalProject = globalProjects.get(project.id) ?? null;

      const activeRuns = runs.filter((run) => !TERMINAL_RUN_STATUSES.has(run.status));
      const activeRunsCount = shiftContext ? shiftContext.active_runs.length : activeRuns.length;
      const hasActiveShift = Boolean(globalProject?.active_shift);
      const escalationCount = globalProject?.escalations.length ?? 0;
      const needsHuman = escalationCount > 0;

      const lastActivity = latestDate([
        parseDate(globalProject?.last_activity ?? null),
        ...shiftContextActivityDates(shiftContext),
        ...runs.map((run) => parseDate(run.started_at ?? run.created_at)),
        ...workOrders.map((workOrder) => parseDate(workOrder.updated_at)),
      ]);

      const activityLevel = computeActivityLevel(activeRunsCount, lastActivity);
      const baseHealth = globalProject
        ? GLOBAL_HEALTH_SCORE[globalProject.health]
        : PROJECT_STATUS_HEALTH[project.status];
      const health = needsHuman ? Math.min(baseHealth, 0.35) : baseHealth;

      const successProgress = shiftSummary
        ? computeSuccessProgressFromSummary(
            shiftSummary,
            shiftContext?.work_orders.summary.backlog ?? 0
          )
        : workOrders.length
          ? computeSuccessProgress(workOrders)
          : 0;
      // Use real cost data if available, otherwise fall back to heuristic
      const projectCosts = costsByProject[project.id];
      const consumptionRate = projectCosts
        ? projectCosts.token_totals.input + projectCosts.token_totals.output
        : estimateConsumptionRate({
            activeRuns: activeRunsCount,
            workOrders: summary,
            lastActivity,
            hasActiveShift,
          });

      nodes.push({
        id: project.id,
        type: "project",
        label: project.name,
        name: project.name,
        path: project.path,
        status: project.status,
        consumptionRate,
        isActive: activeRunsCount > 0 || hasActiveShift,
        activityLevel,
        lastActivity,
        needsHuman,
        escalationCount,
        escalationSummary: globalProject?.escalations[0]?.summary,
        health,
        progress: successProgress,
        successProgress,
        workOrders: summary,
        dependsOn: [],
      });
    }

    const edges = nodes.flatMap((node) =>
      node.dependsOn.map((dependency) => ({
        source: dependency,
        target: node.id,
        type: "depends_on",
      }))
    );

    return {
      nodes,
      edges,
      timestamp: lastUpdated ?? new Date(),
    };
  }, [projects, workOrdersByProject, runsByProject, globalContext, shiftContexts, costsByProject, lastUpdated]);

  return {
    data,
    loading,
    error,
    refresh: () => void load(),
    lastUpdated,
  };
}
