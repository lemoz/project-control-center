import {
  getActiveShift,
  getProjectVm,
  listProjects,
  listRunsByProject,
  type ProjectRow,
  type RunRow,
} from "./db.js";
import { buildShiftContext, type ShiftContext } from "./shift_context.js";

type ProjectHealth = "healthy" | "stalled" | "failing" | "blocked";

type ProjectSummary = {
  id: string;
  name: string;
  status: ProjectRow["status"];
  health: ProjectHealth;
  active_shift: {
    id: string;
    started_at: string;
    agent_id: string | null;
  } | null;
  escalations: Array<{
    id: string;
    type: string;
    summary: string;
  }>;
  work_orders: {
    ready: number;
    building: number;
    blocked: number;
  };
  recent_runs: Array<{
    id: string;
    wo_id: string;
    status: string;
    outcome: "success" | "failure" | "pending";
  }>;
  last_activity: string | null;
};

type Escalation = {
  project_id: string;
  escalation_id: string;
  type: string;
  priority: number;
  waiting_since: string;
};

type ResourceSummary = {
  vms_running: number;
  vms_available: number;
  budget_used_today: number | null;
};

export type GlobalContext = {
  projects: ProjectSummary[];
  escalation_queue: Escalation[];
  resources: ResourceSummary;
  assembled_at: string;
};

type BuildGlobalContextOptions = {
  includeHidden?: boolean;
  runHistoryLimit?: number;
};

const DEFAULT_RUN_HISTORY_LIMIT = 5;
const STALE_ACTIVITY_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export function buildGlobalContext(
  options: BuildGlobalContextOptions = {}
): GlobalContext {
  const now = new Date();
  const allProjects = listProjects();
  const visibleProjects = options.includeHidden
    ? allProjects
    : allProjects.filter((p) => p.hidden === 0);

  const projectSummaries: ProjectSummary[] = [];
  const escalationQueue: Escalation[] = [];
  let vmsRunning = 0;
  let vmsAvailable = 0;

  for (const project of visibleProjects) {
    const shiftContext = buildShiftContext(project.id, {
      runHistoryLimit: options.runHistoryLimit ?? DEFAULT_RUN_HISTORY_LIMIT,
    });

    const activeShiftRow = getActiveShift(project.id);
    const activeShift = activeShiftRow
      ? {
          id: activeShiftRow.id,
          started_at: activeShiftRow.started_at,
          agent_id: activeShiftRow.agent_id,
        }
      : null;

    const vm = getProjectVm(project.id);
    if (vm) {
      if (vm.status === "running") vmsRunning++;
      if (vm.status === "stopped" || vm.status === "running") vmsAvailable++;
    }

    const runs = listRunsByProject(
      project.id,
      options.runHistoryLimit ?? DEFAULT_RUN_HISTORY_LIMIT
    );

    const escalations = extractEscalations(runs, project.id);
    for (const esc of escalations) {
      escalationQueue.push(esc);
    }

    const health = computeProjectHealth(project, shiftContext, runs, now);
    const lastActivity = computeLastActivity(project, runs);

    projectSummaries.push({
      id: project.id,
      name: project.name,
      status: project.status,
      health,
      active_shift: activeShift,
      escalations: escalations.map((e) => ({
        id: e.escalation_id,
        type: e.type,
        summary: `Run ${e.escalation_id} waiting for input`,
      })),
      work_orders: {
        ready: shiftContext?.work_orders.summary.ready ?? 0,
        building: shiftContext?.work_orders.summary.in_progress ?? 0,
        blocked: shiftContext?.work_orders.blocked.length ?? 0,
      },
      recent_runs: runs.slice(0, 5).map((run) => ({
        id: run.id,
        wo_id: run.work_order_id,
        status: run.status,
        outcome: runOutcome(run.status),
      })),
      last_activity: lastActivity,
    });
  }

  // Sort escalations by priority (lower is higher priority) and waiting time
  escalationQueue.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    return a.waiting_since.localeCompare(b.waiting_since);
  });

  // Sort projects by attention needed
  projectSummaries.sort((a, b) => {
    const healthOrder: Record<ProjectHealth, number> = {
      blocked: 0,
      failing: 1,
      stalled: 2,
      healthy: 3,
    };
    const aHealth = healthOrder[a.health];
    const bHealth = healthOrder[b.health];
    if (aHealth !== bHealth) return aHealth - bHealth;
    return b.escalations.length - a.escalations.length;
  });

  return {
    projects: projectSummaries,
    escalation_queue: escalationQueue,
    resources: {
      vms_running: vmsRunning,
      vms_available: vmsAvailable,
      budget_used_today: null, // Not yet tracked
    },
    assembled_at: now.toISOString(),
  };
}

function extractEscalations(runs: RunRow[], projectId: string): Escalation[] {
  const escalations: Escalation[] = [];

  for (const run of runs) {
    if (run.status === "waiting_for_input" || run.status === "you_review") {
      escalations.push({
        project_id: projectId,
        escalation_id: run.id,
        type: run.status === "you_review" ? "review" : "input",
        priority: 1,
        waiting_since: run.started_at ?? run.created_at,
      });
    }
  }

  return escalations;
}

function computeProjectHealth(
  project: ProjectRow,
  shiftContext: ShiftContext | null,
  runs: RunRow[],
  now: Date
): ProjectHealth {
  if (project.status === "blocked") return "blocked";

  // Check for recent failures
  const recentRuns = runs.slice(0, 5);
  const failedCount = recentRuns.filter(
    (r) => r.status === "failed" || r.status === "baseline_failed"
  ).length;
  if (failedCount >= 3) return "failing";

  // Check for stalled (no activity in 7 days)
  const lastActivity = computeLastActivity(project, runs);
  if (lastActivity) {
    const lastActivityDate = new Date(lastActivity);
    if (now.getTime() - lastActivityDate.getTime() > STALE_ACTIVITY_THRESHOLD_MS) {
      return "stalled";
    }
  }

  // Check for blocked work orders
  if (shiftContext && shiftContext.work_orders.blocked.length > shiftContext.work_orders.ready.length) {
    return "blocked";
  }

  return "healthy";
}

function computeLastActivity(project: ProjectRow, runs: RunRow[]): string | null {
  const candidates: string[] = [];

  if (project.last_run_at) candidates.push(project.last_run_at);
  if (project.updated_at) candidates.push(project.updated_at);

  for (const run of runs.slice(0, 3)) {
    if (run.finished_at) candidates.push(run.finished_at);
    if (run.started_at) candidates.push(run.started_at);
    if (run.created_at) candidates.push(run.created_at);
  }

  if (candidates.length === 0) return null;

  return candidates.reduce((latest, candidate) => {
    return candidate > latest ? candidate : latest;
  });
}

function runOutcome(status: RunRow["status"]): "success" | "failure" | "pending" {
  switch (status) {
    case "merged":
      return "success";
    case "failed":
    case "baseline_failed":
    case "canceled":
      return "failure";
    default:
      return "pending";
  }
}
