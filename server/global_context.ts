import {
  getActiveShift,
  listEscalations,
  listProjectCommunications,
  type EscalationRow,
  type EscalationStatus,
  type ProjectCommunicationIntent,
  type ProjectCommunicationRow,
  type ProjectCommunicationScope,
  type ProjectRow,
  type RunRow,
} from "./db.js";
import { getBudgetUsedTodayOverride } from "./config.js";
import { getGlobalBudget } from "./budgeting.js";
import { syncProjectBudgetAlerts } from "./budget_enforcement.js";
import { syncAndListRepoSummaries } from "./projects_catalog.js";
import { getRunsForProject } from "./runner_agent.js";
import { buildShiftContext, type ShiftContext } from "./shift_context.js";
import { getUserPreferences, type UserPreferences } from "./user_preferences.js";

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

type RoutingEscalationSummary = EscalationSummary & {
  status: EscalationStatus;
};

export type HealthStatus =
  | "healthy"
  | "attention_needed"
  | "stalled"
  | "failing"
  | "blocked";

export type ProjectHealth = {
  project_id: string;
  status: HealthStatus;
  reasons: string[];
  last_activity: string | null;
  metrics: {
    days_since_run: number;
    recent_failure_rate: number;
    pending_escalations: number;
    ready_wo_count: number;
  };
};

export type GlobalProjectSummary = {
  id: string;
  name: string;
  status: ProjectRow["status"];
  health: HealthStatus;
  health_summary: ProjectHealth;
  budget: {
    status: "healthy" | "warning" | "critical" | "exhausted";
    remaining_usd: number;
    allocation_usd: number;
    daily_drip_usd: number;
    runway_days: number;
  };
  active_shift: { id: string; started_at: string; agent_id: string | null } | null;
  escalations: Array<{ id: string; type: string; summary: string }>;
  work_orders: { ready: number; building: number; blocked: number };
  recent_runs: Array<{ id: string; wo_id: string; status: string; outcome: string | null }>;
  last_activity: string | null;
};

export type CommunicationQueueItem = {
  project_id: string;
  communication_id: string;
  intent: ProjectCommunicationIntent;
  type: string | null;
  summary: string;
  priority: number;
  waiting_since: string;
  from_scope: ProjectCommunicationScope;
  from_project_id: string | null;
  to_scope: ProjectCommunicationScope;
  to_project_id: string | null;
  status: EscalationStatus;
};

export type CommunicationQueueGroup = {
  intent: ProjectCommunicationIntent;
  items: CommunicationQueueItem[];
  total: number;
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
  communications_queue: CommunicationQueueGroup[];
  escalation_queue: EscalationQueueItem[];
  resources: {
    budget_used_today: number;
  };
  economy: {
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
  preferences: UserPreferences;
  assembled_at: string;
};

const RUN_FAILURE_STATUSES = new Set<RunRow["status"]>([
  "baseline_failed",
  "failed",
  "merge_conflict",
  "canceled",
]);
const ROUTING_ESCALATION_STATUSES: EscalationStatus[] = [
  "pending",
  "claimed",
  "escalated_to_user",
];
const COMMUNICATION_INTENT_ORDER: ProjectCommunicationIntent[] = [
  "escalation",
  "request",
  "message",
  "suggestion",
  "status",
];
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const STALLED_RUN_DAYS = 3;
const FAILURE_STREAK_THRESHOLD = 3;
const RECENT_RUN_WINDOW = 10;
const LONG_RUNNING_SHIFT_HOURS = 2;

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

function resolveDaysSince(value: string | null, now: Date): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return null;
  const diffDays = (now.getTime() - parsed) / MS_PER_DAY;
  return Math.max(0, diffDays);
}

function resolveLastRunAt(runs: RunRow[]): string | null {
  if (!runs.length) return null;
  const latest = runs[0];
  return latest.started_at ?? latest.created_at ?? null;
}

function resolveFailureStreak(runs: RunRow[]): number {
  let streak = 0;
  for (const run of runs) {
    const outcome = resolveRunOutcome(run);
    if (!outcome) continue;
    if (outcome === "failed") {
      streak += 1;
    } else {
      break;
    }
  }
  return streak;
}

function resolveFailureRate(runs: RunRow[], limit: number): number {
  const outcomes = runs
    .map((run) => resolveRunOutcome(run))
    .filter(
      (outcome): outcome is Exclude<ReturnType<typeof resolveRunOutcome>, null> =>
        outcome !== null
    )
    .slice(0, limit);
  if (!outcomes.length) return 0;
  const failures = outcomes.filter((outcome) => outcome === "failed").length;
  return Math.round((failures / outcomes.length) * 100) / 100;
}

function resolveShiftAgeHours(
  activeShift: { started_at: string } | null,
  now: Date
): number | null {
  if (!activeShift) return null;
  const parsed = Date.parse(activeShift.started_at);
  if (!Number.isFinite(parsed)) return null;
  const diffMs = now.getTime() - parsed;
  return diffMs > 0 ? diffMs / (60 * 60 * 1000) : 0;
}

function areAllWorkOrdersBlocked(workOrders: ShiftContext["work_orders"]): boolean {
  const hasAny =
    workOrders.summary.ready > 0 ||
    workOrders.summary.backlog > 0 ||
    workOrders.summary.in_progress > 0 ||
    workOrders.summary.done > 0 ||
    workOrders.blocked.length > 0;
  if (!hasAny) return false;
  const hasUnblockedBacklog = workOrders.backlog.some((wo) => wo.deps_satisfied);
  const hasUnblocked =
    workOrders.summary.ready > 0 || workOrders.summary.in_progress > 0 || hasUnblockedBacklog;
  return !hasUnblocked && workOrders.blocked.length > 0;
}

function buildProjectHealth(params: {
  projectId: string;
  projectStatus: ProjectRow["status"];
  workOrders: ShiftContext["work_orders"];
  runs: RunRow[];
  pendingEscalations: number;
  activeShift: { started_at: string } | null;
  lastActivity: string | null;
  now: Date;
}): ProjectHealth {
  const reasons: string[] = [];
  const lastRunAt = resolveLastRunAt(params.runs);
  const daysSinceRunRaw = resolveDaysSince(lastRunAt, params.now);
  const daysSinceRun =
    daysSinceRunRaw === null ? -1 : Math.floor(daysSinceRunRaw);
  const failureStreak = resolveFailureStreak(params.runs);
  const failureRate = resolveFailureRate(params.runs, RECENT_RUN_WINDOW);
  const readyCount = params.workOrders.summary.ready;
  const stalled =
    readyCount > 0 &&
    (daysSinceRunRaw === null || daysSinceRunRaw >= STALLED_RUN_DAYS);
  const allBlocked = areAllWorkOrdersBlocked(params.workOrders);
  const shiftAgeHours = resolveShiftAgeHours(params.activeShift, params.now);
  const longRunningShift =
    shiftAgeHours !== null && shiftAgeHours > LONG_RUNNING_SHIFT_HOURS;
  const attentionNeeded = params.pendingEscalations > 0 || longRunningShift;

  let status: HealthStatus = "healthy";
  if (params.projectStatus === "blocked") {
    status = "blocked";
    reasons.push("Project status is blocked.");
  } else if (params.projectStatus === "parked") {
    status = "stalled";
    reasons.push("Project is parked.");
  } else if (failureStreak >= FAILURE_STREAK_THRESHOLD) {
    status = "failing";
    reasons.push(`Failure streak: ${failureStreak} consecutive failed runs.`);
  } else if (stalled) {
    status = "stalled";
    if (daysSinceRunRaw === null) {
      reasons.push(`No runs recorded with ${readyCount} ready WOs.`);
    } else {
      reasons.push(
        `No runs in ${Math.floor(daysSinceRunRaw)} days with ${readyCount} ready WOs.`
      );
    }
  } else if (allBlocked) {
    status = "blocked";
    reasons.push("All work orders blocked on dependencies.");
  } else if (attentionNeeded) {
    status = "attention_needed";
    if (params.pendingEscalations > 0) {
      reasons.push(`Pending escalations: ${params.pendingEscalations}.`);
    }
    if (longRunningShift && shiftAgeHours !== null) {
      reasons.push(`Shift running ${shiftAgeHours.toFixed(1)}h.`);
    }
  }

  return {
    project_id: params.projectId,
    status,
    reasons,
    last_activity: params.lastActivity,
    metrics: {
      days_since_run: daysSinceRun,
      recent_failure_rate: failureRate,
      pending_escalations: params.pendingEscalations,
      ready_wo_count: readyCount,
    },
  };
}

function summarizeRunEscalation(run: RunRow): EscalationSummary | null {
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

function summarizeRoutingEscalation(escalation: EscalationRow): RoutingEscalationSummary | null {
  const summary = escalation.summary.trim();
  if (!summary) return null;
  return {
    id: escalation.id,
    type: escalation.type,
    summary,
    waiting_since: escalation.created_at,
    status: escalation.status,
  };
}

function parseBudgetUsedToday(): number {
  return getBudgetUsedTodayOverride();
}

export function buildGlobalContextResponse(): GlobalContextResponse {
  const now = new Date();
  const preferences = getUserPreferences();
  const priorityTokens = new Set(
    preferences.priority_projects.map((value) => value.trim().toLowerCase()).filter(Boolean)
  );
  const globalBudget = getGlobalBudget();
  const summaries = syncAndListRepoSummaries();
  const globalCommunications = listProjectCommunications({
    toScope: "global",
    statuses: ROUTING_ESCALATION_STATUSES,
    order: "asc",
    limit: 200,
    unacknowledgedOnly: true,
  });
  const communicationsByProjectId = new Map<string, ProjectCommunicationRow[]>();
  for (const communication of globalCommunications) {
    const list = communicationsByProjectId.get(communication.project_id);
    if (list) {
      list.push(communication);
    } else {
      communicationsByProjectId.set(communication.project_id, [communication]);
    }
  }
  const projects: Array<{
    summary: GlobalProjectSummary;
    attentionNeeded: boolean;
    sortPriority: number;
    priorityRank: number;
  }> = [];
  const communicationQueue: CommunicationQueueItem[] = [];
  const escalationQueue: EscalationQueueItem[] = [];
  const priorityByProjectId = new Map<string, boolean>();

  let portfolioBurnRateDaily = 0;
  const budgetStatusCounts = {
    healthy: 0,
    warning: 0,
    critical: 0,
    exhausted: 0,
  };

  for (const project of summaries) {
    const context = buildShiftContext(project.id, { runHistoryLimit: 5, activeRunScanLimit: 50 });
    if (!context) continue;
    try {
      syncProjectBudgetAlerts({
        projectId: context.project.id,
        projectName: context.project.name,
        projectPath: context.project.path,
        readyWorkOrderIds: context.work_orders.ready.map((wo) => wo.id),
      });
    } catch {
      // ignore budget alert sync failures
    }
    const priority = project.priority;
    const runs = getRunsForProject(project.id, 50);
    const runsById = new Map(runs.map((run) => [run.id, run]));
    const activeShift = getActiveShift(project.id);
    const runEscalations = runs
      .map((run) => summarizeRunEscalation(run))
      .filter((entry): entry is EscalationSummary => Boolean(entry));
    const routingEscalations = listEscalations({
      projectId: project.id,
      statuses: ROUTING_ESCALATION_STATUSES,
      order: "asc",
      limit: 200,
    })
      .map((entry) => summarizeRoutingEscalation(entry))
      .filter((entry): entry is RoutingEscalationSummary => Boolean(entry));
    const userRoutingEscalations = routingEscalations.filter(
      (entry) => entry.status === "escalated_to_user"
    );
    const escalations = runEscalations.concat(routingEscalations);
    const projectCommunications = communicationsByProjectId.get(project.id) ?? [];
    const lastActivity = selectLatestTimestamp([
      activeShift?.started_at,
      context.last_handoff?.created_at,
      context.last_human_interaction?.timestamp,
      context.recent_runs[0]?.created_at,
    ]);
    const healthSummary = buildProjectHealth({
      projectId: context.project.id,
      projectStatus: project.status,
      workOrders: context.work_orders,
      runs,
      pendingEscalations: escalations.length,
      activeShift,
      lastActivity,
      now,
    });
    const health = healthSummary.status;
    const attentionNeeded = health !== "healthy" && project.status !== "parked";
    const isPriority =
      priorityTokens.size > 0 &&
      (priorityTokens.has(context.project.id.toLowerCase()) ||
        priorityTokens.has(context.project.name.toLowerCase()));

    const projectSummary: GlobalProjectSummary = {
      id: context.project.id,
      name: context.project.name,
      status: project.status,
      health,
      health_summary: healthSummary,
      budget: {
        status: context.economy.budget_status,
        remaining_usd: context.economy.budget_remaining_usd,
        allocation_usd: context.economy.budget_allocation_usd,
        daily_drip_usd: context.economy.daily_drip_usd,
        runway_days: context.economy.runway_days,
      },
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
      priorityRank: isPriority ? 0 : 1,
    });
    priorityByProjectId.set(context.project.id, isPriority);

    for (const escalation of runEscalations) {
      escalationQueue.push({
        project_id: context.project.id,
        escalation_id: escalation.id,
        type: escalation.type,
        priority,
        waiting_since: escalation.waiting_since,
      });
      communicationQueue.push({
        project_id: context.project.id,
        communication_id: escalation.id,
        intent: "escalation",
        type: escalation.type,
        summary: escalation.summary,
        priority,
        waiting_since: escalation.waiting_since,
        from_scope: "project",
        from_project_id: context.project.id,
        to_scope: "global",
        to_project_id: null,
        status: "pending",
      });
    }

    for (const escalation of userRoutingEscalations) {
      escalationQueue.push({
        project_id: context.project.id,
        escalation_id: escalation.id,
        type: escalation.type,
        priority,
        waiting_since: escalation.waiting_since,
      });
    }

    for (const communication of projectCommunications) {
      communicationQueue.push({
        project_id: communication.project_id,
        communication_id: communication.id,
        intent: communication.intent,
        type: communication.type,
        summary: communication.summary,
        priority,
        waiting_since: communication.created_at,
        from_scope: communication.from_scope,
        from_project_id: communication.from_project_id,
        to_scope: communication.to_scope,
        to_project_id: communication.to_project_id,
        status: communication.status,
      });
    }

    const budgetStatus = context.economy.budget_status;
    budgetStatusCounts[budgetStatus] += 1;
    portfolioBurnRateDaily += context.economy.burn_rate_daily_usd;

  }

  projects.sort((a, b) => {
    if (a.priorityRank !== b.priorityRank) {
      return a.priorityRank - b.priorityRank;
    }
    if (a.attentionNeeded !== b.attentionNeeded) {
      return a.attentionNeeded ? -1 : 1;
    }
    if (a.sortPriority !== b.sortPriority) {
      return a.sortPriority - b.sortPriority;
    }
    return a.summary.name.localeCompare(b.summary.name);
  });

  escalationQueue.sort((a, b) => {
    const aPriority = priorityByProjectId.get(a.project_id) ? 0 : 1;
    const bPriority = priorityByProjectId.get(b.project_id) ? 0 : 1;
    if (aPriority !== bPriority) return aPriority - bPriority;
    if (a.priority !== b.priority) return a.priority - b.priority;
    return a.waiting_since.localeCompare(b.waiting_since);
  });

  communicationQueue.sort((a, b) => {
    const aPriority = priorityByProjectId.get(a.project_id) ? 0 : 1;
    const bPriority = priorityByProjectId.get(b.project_id) ? 0 : 1;
    if (aPriority !== bPriority) return aPriority - bPriority;
    if (a.priority !== b.priority) return a.priority - b.priority;
    return a.waiting_since.localeCompare(b.waiting_since);
  });

  const communicationsQueue: CommunicationQueueGroup[] = COMMUNICATION_INTENT_ORDER.map(
    (intent) => {
      const items = communicationQueue.filter((entry) => entry.intent === intent);
      return { intent, items, total: items.length };
    }
  );

  const periodEnd = new Date(globalBudget.current_period_end);
  const periodDaysRemaining = Number.isFinite(periodEnd.getTime())
    ? Math.max(1, diffDaysInclusive(now, periodEnd))
    : 1;
  const remainingBudget = globalBudget.remaining_usd;
  const portfolioRunwayDays =
    remainingBudget <= 0
      ? 0
      : portfolioBurnRateDaily > 0
        ? remainingBudget / portfolioBurnRateDaily
        : periodDaysRemaining;

  return {
    projects: projects.map((entry) => entry.summary),
    communications_queue: communicationsQueue,
    escalation_queue: escalationQueue,
    resources: {
      budget_used_today: parseBudgetUsedToday(),
    },
    economy: {
      monthly_budget_usd: globalBudget.monthly_budget_usd,
      total_allocated_usd: globalBudget.allocated_usd,
      total_spent_usd: globalBudget.spent_usd,
      total_remaining_usd: globalBudget.remaining_usd,
      projects_healthy: budgetStatusCounts.healthy,
      projects_warning: budgetStatusCounts.warning,
      projects_critical: budgetStatusCounts.critical,
      projects_exhausted: budgetStatusCounts.exhausted,
      portfolio_burn_rate_daily_usd: portfolioBurnRateDaily,
      portfolio_runway_days: portfolioRunwayDays,
    },
    preferences,
    assembled_at: now.toISOString(),
  };
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
