import {
  createBudgetEnforcementLog,
  createEscalation,
  findProjectById,
  getSetting,
  hasBudgetEnforcementEvent,
  listEscalations,
  setSetting,
  updateEscalation,
  updateProjectStatus,
  type EscalationRow,
} from "./db.js";
import { ensureChatThread, createChatMessage } from "./chat_db.js";
import {
  getGlobalBudget,
  getProjectBudget,
  type BudgetStatus,
  type GlobalBudget,
  type ProjectBudget,
} from "./budgeting.js";
import { getProjectCostSummary } from "./cost_tracking.js";
import { listWorkOrders } from "./work_orders.js";

export type SurvivalModeState = {
  daily_drip_used: boolean;
  next_available: string | null;
  queued_runs: string[];
};

export type BudgetRunBlockReason =
  | "budget_exhausted"
  | "budget_critical"
  | "survival_queue"
  | "survival_priority";

export type BudgetRunBlockDetails = {
  block_reason: BudgetRunBlockReason;
  project_id: string;
  work_order_id: string;
  budget_status: BudgetStatus;
  remaining_usd: number;
  allocation_usd: number;
  daily_drip_usd: number;
  estimated_cost_usd: number;
  next_available: string | null;
  queued_runs: string[];
  queue_head: string | null;
};

export class BudgetEnforcementError extends Error {
  code: BudgetRunBlockReason;
  details: BudgetRunBlockDetails;
  constructor(message: string, code: BudgetRunBlockReason, details: BudgetRunBlockDetails) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

type StoredSurvivalState = {
  daily_drip_used_on: string | null;
  queued_runs: string[];
};

const WARNING_THRESHOLD = 0.5;
const CRITICAL_THRESHOLD = 0.25;
const SURVIVAL_STATE_PREFIX = "budget_survival_state:";
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function formatUsd(value: number): string {
  if (!Number.isFinite(value)) return "$0.00";
  const sign = value < 0 ? "-" : "";
  return `${sign}$${Math.abs(value).toFixed(2)}`;
}

function formatPercent(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "n/a";
  return `${value.toFixed(0)}%`;
}

function formatDays(value: number): string {
  if (!Number.isFinite(value)) return "0";
  return value.toFixed(1);
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

function dayKey(date: Date): string {
  return startOfUtcDay(date).toISOString().slice(0, 10);
}

function nextUtcDayStartIso(date: Date): string {
  const start = startOfUtcDay(date);
  return new Date(start.getTime() + MS_PER_DAY).toISOString();
}

function survivalStateKey(projectId: string): string {
  return `${SURVIVAL_STATE_PREFIX}${projectId}`;
}

function safeParseState(value: string | null): StoredSurvivalState {
  if (!value) return { daily_drip_used_on: null, queued_runs: [] };
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object") {
      return { daily_drip_used_on: null, queued_runs: [] };
    }
    const record = parsed as Record<string, unknown>;
    const daily =
      typeof record.daily_drip_used_on === "string" ? record.daily_drip_used_on : null;
    const queuedRaw = Array.isArray(record.queued_runs) ? record.queued_runs : [];
    const queued_runs = queuedRaw.filter((item): item is string => typeof item === "string");
    return { daily_drip_used_on: daily, queued_runs };
  } catch {
    return { daily_drip_used_on: null, queued_runs: [] };
  }
}

function loadSurvivalState(projectId: string): StoredSurvivalState {
  const row = getSetting(survivalStateKey(projectId));
  return safeParseState(row?.value ?? null);
}

function saveSurvivalState(projectId: string, state: StoredSurvivalState): void {
  setSetting(survivalStateKey(projectId), JSON.stringify(state));
}

function buildSurvivalModeState(state: StoredSurvivalState, now: Date): SurvivalModeState {
  const today = dayKey(now);
  const dailyUsed = state.daily_drip_used_on === today;
  return {
    daily_drip_used: dailyUsed,
    next_available: dailyUsed ? nextUtcDayStartIso(now) : now.toISOString(),
    queued_runs: state.queued_runs.slice(),
  };
}

function resetSurvivalState(projectId: string): void {
  saveSurvivalState(projectId, { daily_drip_used_on: null, queued_runs: [] });
}

function sortQueueByPriority(projectPath: string, queue: string[]): string[] {
  const workOrders = listWorkOrders(projectPath);
  const priorities = new Map(workOrders.map((wo) => [wo.id, wo.priority]));
  const unique = Array.from(new Set(queue));
  return unique.sort((a, b) => {
    const pa = priorities.get(a) ?? 99;
    const pb = priorities.get(b) ?? 99;
    if (pa !== pb) return pa - pb;
    return a.localeCompare(b);
  });
}

function computeSurvivalDripUsd(projectBudget: ProjectBudget, globalBudget: GlobalBudget): number {
  const allocation = projectBudget.monthly_allocation_usd;
  if (!Number.isFinite(allocation) || allocation <= 0) return 0;
  const periodStart = new Date(globalBudget.current_period_start);
  const periodEnd = new Date(globalBudget.current_period_end);
  const totalDays = diffDaysInclusive(periodStart, periodEnd);
  if (totalDays <= 0) return 0;
  return allocation / totalDays;
}

function getAverageRunCostUsd(projectId: string): number {
  const month = getProjectCostSummary({ projectId, period: "month" });
  if (month.run_count > 0 && Number.isFinite(month.avg_cost_per_run)) {
    return month.avg_cost_per_run;
  }
  const allTime = getProjectCostSummary({ projectId, period: "all_time" });
  return Number.isFinite(allTime.avg_cost_per_run) ? allTime.avg_cost_per_run : 0;
}

function hasOpenEscalation(projectId: string, type: EscalationRow["type"]): boolean {
  const open = listEscalations({
    projectId,
    statuses: ["pending", "claimed", "escalated_to_user"],
    order: "desc",
    limit: 50,
  });
  return open.some((entry) => entry.type === type);
}

function writeBudgetAlert(params: {
  projectId: string;
  projectName: string;
  eventType: "warning" | "critical" | "exhausted";
  escalationType: EscalationRow["type"];
  payload: Record<string, unknown>;
  summary: string;
  message: string;
  periodStart: string;
  needsUserInput: boolean;
}): void {
  if (
    hasBudgetEnforcementEvent({
      projectId: params.projectId,
      eventType: params.eventType,
      since: params.periodStart,
    })
  ) {
    return;
  }

  createBudgetEnforcementLog({
    project_id: params.projectId,
    event_type: params.eventType,
    details: JSON.stringify({
      project_name: params.projectName,
      payload: params.payload,
    }),
  });

  if (hasOpenEscalation(params.projectId, params.escalationType)) {
    return;
  }

  const escalation = createEscalation({
    project_id: params.projectId,
    type: params.escalationType,
    summary: params.summary,
    payload: JSON.stringify(params.payload),
  });

  updateEscalation(escalation.id, { status: "escalated_to_user" });

  const thread = ensureChatThread({ scope: "project", projectId: params.projectId });
  createChatMessage({
    threadId: thread.id,
    role: "assistant",
    content: params.message,
    needsUserInput: params.needsUserInput,
  });
}

export function syncProjectBudgetAlerts(params: {
  projectId: string;
  projectName?: string;
  projectPath?: string;
  projectBudget?: ProjectBudget;
  globalBudget?: GlobalBudget;
  readyWorkOrderIds?: string[];
}): void {
  const project =
    params.projectName && params.projectPath
      ? { id: params.projectId, name: params.projectName, path: params.projectPath }
      : findProjectById(params.projectId);
  if (!project) return;

  const projectBudget = params.projectBudget ?? getProjectBudget(project.id);
  const globalBudget = params.globalBudget ?? getGlobalBudget();
  const remaining = projectBudget.remaining_usd;
  const allocation = projectBudget.monthly_allocation_usd;
  const remainingPct = allocation > 0 ? (remaining / allocation) * 100 : null;

  const readyWorkOrderIds =
    params.readyWorkOrderIds ??
    listWorkOrders(project.path)
      .filter((wo) => wo.status === "ready")
      .map((wo) => wo.id);

  if (projectBudget.budget_status === "warning") {
    writeBudgetAlert({
      projectId: project.id,
      projectName: project.name,
      eventType: "warning",
      escalationType: "budget_warning",
      payload: {
        type: "budget_warning",
        threshold: WARNING_THRESHOLD,
        remaining_usd: remaining,
        allocation_usd: allocation,
        remaining_pct: remainingPct,
        message: `Budget below ${formatPercent(WARNING_THRESHOLD * 100)} (${formatUsd(
          remaining
        )} remaining).`,
      },
      summary: `Budget warning for ${project.name}: ${formatUsd(remaining)} remaining`,
      message: `Budget warning for ${project.name}: ${formatUsd(
        remaining
      )} remaining (${formatPercent(remainingPct)}). Consider adding funds or transferring budget.`,
      periodStart: globalBudget.current_period_start,
      needsUserInput: false,
    });
  }

  if (projectBudget.budget_status === "critical") {
    writeBudgetAlert({
      projectId: project.id,
      projectName: project.name,
      eventType: "critical",
      escalationType: "budget_critical",
      payload: {
        type: "budget_critical",
        remaining_usd: remaining,
        runway_days: projectBudget.runway_days,
      },
      summary: `Budget critical for ${project.name}: ${formatUsd(remaining)} remaining`,
      message: `Budget critical for ${project.name}: ${formatUsd(
        remaining
      )} remaining (${formatPercent(
        remainingPct
      )}). Runway ${formatDays(projectBudget.runway_days)} days.`,
      periodStart: globalBudget.current_period_start,
      needsUserInput: true,
    });
  }

  if (projectBudget.budget_status === "exhausted") {
    writeBudgetAlert({
      projectId: project.id,
      projectName: project.name,
      eventType: "exhausted",
      escalationType: "budget_exhausted",
      payload: {
        type: "budget_exhausted",
        blocked_work: readyWorkOrderIds,
        remaining_usd: remaining,
        allocation_usd: allocation,
      },
      summary: `Budget exhausted for ${project.name}: ${readyWorkOrderIds.length} work orders blocked`,
      message: `Budget exhausted for ${project.name}. Blocked work orders: ${
        readyWorkOrderIds.length ? readyWorkOrderIds.join(", ") : "none"
      }. Add funds or transfer budget to continue.`,
      periodStart: globalBudget.current_period_start,
      needsUserInput: true,
    });

    const projectRow = findProjectById(project.id);
    if (projectRow && projectRow.status !== "parked") {
      updateProjectStatus(projectRow.id, "parked");
    }
  }
}

export function enforceRunBudget(params: {
  projectId: string;
  projectPath: string;
  workOrderId: string;
}): { mode: "normal" | "survival"; estimated_cost_usd: number; survival?: SurvivalModeState } {
  const now = new Date();
  const projectBudget = getProjectBudget(params.projectId);
  const globalBudget = getGlobalBudget();
  const estimatedCost = getAverageRunCostUsd(params.projectId);

  syncProjectBudgetAlerts({
    projectId: params.projectId,
    projectName: findProjectById(params.projectId)?.name ?? params.projectId,
    projectPath: params.projectPath,
    projectBudget,
    globalBudget,
  });

  if (projectBudget.budget_status !== "exhausted") {
    const existingState = loadSurvivalState(params.projectId);
    if (existingState.daily_drip_used_on || existingState.queued_runs.length) {
      resetSurvivalState(params.projectId);
    }
  }

  if (projectBudget.budget_status === "critical") {
    if (projectBudget.daily_drip_usd >= estimatedCost) {
      return { mode: "normal", estimated_cost_usd: estimatedCost };
    }
    const details: BudgetRunBlockDetails = {
      block_reason: "budget_critical",
      project_id: params.projectId,
      work_order_id: params.workOrderId,
      budget_status: projectBudget.budget_status,
      remaining_usd: projectBudget.remaining_usd,
      allocation_usd: projectBudget.monthly_allocation_usd,
      daily_drip_usd: projectBudget.daily_drip_usd,
      estimated_cost_usd: estimatedCost,
      next_available: null,
      queued_runs: [],
      queue_head: null,
    };
    createBudgetEnforcementLog({
      project_id: params.projectId,
      event_type: "run_blocked",
      details: JSON.stringify({
        reason: details.block_reason,
        work_order_id: params.workOrderId,
        estimated_cost_usd: estimatedCost,
        available_usd: projectBudget.daily_drip_usd,
      }),
    });
    throw new BudgetEnforcementError(
      `Budget critical (${formatUsd(projectBudget.remaining_usd)} left). Estimated run cost: ${formatUsd(
        estimatedCost
      )}`,
      "budget_critical",
      details
    );
  }

  if (projectBudget.budget_status === "exhausted") {
    const survivalDrip = computeSurvivalDripUsd(projectBudget, globalBudget);
    const existingState = loadSurvivalState(params.projectId);
    const survivalState = buildSurvivalModeState(existingState, now);

    if (survivalDrip > 0 && estimatedCost <= survivalDrip) {
      const queueWithCandidate = sortQueueByPriority(params.projectPath, [
        ...existingState.queued_runs,
        params.workOrderId,
      ]);
      const queueHead = queueWithCandidate[0] ?? null;
      const dailyUsed = survivalState.daily_drip_used;
      const needsPriorityBlock = queueHead !== null && queueHead !== params.workOrderId;

      if (!dailyUsed && !needsPriorityBlock) {
        const nextQueue = queueWithCandidate.filter((id) => id !== params.workOrderId);
        const nextState: StoredSurvivalState = {
          daily_drip_used_on: dayKey(now),
          queued_runs: nextQueue,
        };
        saveSurvivalState(params.projectId, nextState);
        const updated = buildSurvivalModeState(nextState, now);
        createBudgetEnforcementLog({
          project_id: params.projectId,
          event_type: "survival_used",
          details: JSON.stringify({
            work_order_id: params.workOrderId,
            estimated_cost_usd: estimatedCost,
            daily_drip_usd: survivalDrip,
            next_available: updated.next_available,
          }),
        });
        return { mode: "survival", estimated_cost_usd: estimatedCost, survival: updated };
      }

      const queued = queueWithCandidate;
      const nextState: StoredSurvivalState = {
        daily_drip_used_on: existingState.daily_drip_used_on,
        queued_runs: queued,
      };
      saveSurvivalState(params.projectId, nextState);
      const updated = buildSurvivalModeState(nextState, now);
      const blockReason: BudgetRunBlockReason = needsPriorityBlock
        ? "survival_priority"
        : "survival_queue";
      const details: BudgetRunBlockDetails = {
        block_reason: blockReason,
        project_id: params.projectId,
        work_order_id: params.workOrderId,
        budget_status: projectBudget.budget_status,
        remaining_usd: projectBudget.remaining_usd,
        allocation_usd: projectBudget.monthly_allocation_usd,
        daily_drip_usd: survivalDrip,
        estimated_cost_usd: estimatedCost,
        next_available: updated.next_available,
        queued_runs: updated.queued_runs,
        queue_head: updated.queued_runs[0] ?? null,
      };
      createBudgetEnforcementLog({
        project_id: params.projectId,
        event_type: "run_blocked",
        details: JSON.stringify({
          reason: blockReason,
          work_order_id: params.workOrderId,
          estimated_cost_usd: estimatedCost,
          available_usd: survivalDrip,
          queued_runs: updated.queued_runs,
          next_available: updated.next_available,
        }),
      });
      const message = needsPriorityBlock
        ? `Survival queue active. Next eligible work order: ${queueHead ?? "unknown"}`
        : `Daily drip already used today. Run queued for the next available window.`;
      throw new BudgetEnforcementError(message, blockReason, details);
    }

    const details: BudgetRunBlockDetails = {
      block_reason: "budget_exhausted",
      project_id: params.projectId,
      work_order_id: params.workOrderId,
      budget_status: projectBudget.budget_status,
      remaining_usd: projectBudget.remaining_usd,
      allocation_usd: projectBudget.monthly_allocation_usd,
      daily_drip_usd: survivalDrip,
      estimated_cost_usd: estimatedCost,
      next_available: null,
      queued_runs: [],
      queue_head: null,
    };
    createBudgetEnforcementLog({
      project_id: params.projectId,
      event_type: "run_blocked",
      details: JSON.stringify({
        reason: "budget_exhausted",
        work_order_id: params.workOrderId,
        estimated_cost_usd: estimatedCost,
        available_usd: survivalDrip,
      }),
    });
    throw new BudgetEnforcementError(
      "Budget exhausted. Add more funds to continue.",
      "budget_exhausted",
      details
    );
  }

  return { mode: "normal", estimated_cost_usd: estimatedCost };
}
