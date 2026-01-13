import { getDb } from "./db.js";

export type BudgetStatus = "healthy" | "warning" | "critical" | "exhausted";

export type GlobalBudget = {
  monthly_budget_usd: number;
  current_period_start: string;
  current_period_end: string;
  allocated_usd: number;
  unallocated_usd: number;
  spent_usd: number;
  remaining_usd: number;
};

export type ProjectBudget = {
  project_id: string;
  monthly_allocation_usd: number;
  spent_usd: number;
  remaining_usd: number;
  daily_drip_usd: number;
  runway_days: number;
  budget_status: BudgetStatus;
};

type BudgetSettingsRow = {
  id: string;
  monthly_budget_usd: number;
  period_start: string;
  period_end: string;
  updated_at: string;
};

type ProjectBudgetRow = {
  project_id: string;
  monthly_allocation_usd: number;
  updated_at: string;
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function startOfUtcMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1, 0, 0, 0, 0));
}

function endOfUtcMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0, 23, 59, 59, 999));
}

function diffDaysInclusive(start: Date, end: Date): number {
  const startDay = startOfUtcDay(start);
  const endDay = startOfUtcDay(end);
  const diff = Math.floor((endDay.getTime() - startDay.getTime()) / MS_PER_DAY);
  return Math.max(0, diff + 1);
}

function normalizeAmount(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, value);
}

function parseDateMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function currentPeriodBounds(now: Date): { start: Date; end: Date } {
  return {
    start: startOfUtcMonth(now),
    end: endOfUtcMonth(now),
  };
}

function ensureBudgetSettings(now: Date): BudgetSettingsRow {
  const database = getDb();
  const existing = database
    .prepare("SELECT * FROM budget_settings WHERE id = 'global' LIMIT 1")
    .get() as BudgetSettingsRow | undefined;
  const { start, end } = currentPeriodBounds(now);
  const startIso = start.toISOString();
  const endIso = end.toISOString();
  const nowIso = now.toISOString();

  const shouldResetPeriod = (() => {
    if (!existing) return true;
    const startMs = parseDateMs(existing.period_start);
    const endMs = parseDateMs(existing.period_end);
    if (startMs === null || endMs === null) return true;
    const nowMs = now.getTime();
    return nowMs < startMs || nowMs > endMs;
  })();

  if (!existing) {
    database
      .prepare(
        `INSERT INTO budget_settings
          (id, monthly_budget_usd, period_start, period_end, updated_at)
         VALUES ('global', 0, @period_start, @period_end, @updated_at)`
      )
      .run({ period_start: startIso, period_end: endIso, updated_at: nowIso });
  } else if (shouldResetPeriod) {
    database
      .prepare(
        `UPDATE budget_settings
         SET period_start = @period_start,
             period_end = @period_end,
             updated_at = @updated_at
         WHERE id = 'global'`
      )
      .run({ period_start: startIso, period_end: endIso, updated_at: nowIso });
  }

  return (
    database
      .prepare("SELECT * FROM budget_settings WHERE id = 'global' LIMIT 1")
      .get() as BudgetSettingsRow
  );
}

function upsertBudgetSettings(monthlyBudgetUsd: number, now: Date): BudgetSettingsRow {
  const database = getDb();
  const { start, end } = currentPeriodBounds(now);
  const row: BudgetSettingsRow = {
    id: "global",
    monthly_budget_usd: normalizeAmount(monthlyBudgetUsd),
    period_start: start.toISOString(),
    period_end: end.toISOString(),
    updated_at: now.toISOString(),
  };

  database
    .prepare(
      `INSERT INTO budget_settings
        (id, monthly_budget_usd, period_start, period_end, updated_at)
       VALUES (@id, @monthly_budget_usd, @period_start, @period_end, @updated_at)
       ON CONFLICT(id) DO UPDATE SET
         monthly_budget_usd = excluded.monthly_budget_usd,
         period_start = excluded.period_start,
         period_end = excluded.period_end,
         updated_at = excluded.updated_at`
    )
    .run(row);

  return row;
}

function getProjectBudgetRow(projectId: string): ProjectBudgetRow | null {
  const database = getDb();
  const row = database
    .prepare("SELECT * FROM project_budgets WHERE project_id = ? LIMIT 1")
    .get(projectId) as ProjectBudgetRow | undefined;
  return row ?? null;
}

function upsertProjectBudgetRow(projectId: string, allocationUsd: number, now: Date): void {
  const database = getDb();
  const row: ProjectBudgetRow = {
    project_id: projectId,
    monthly_allocation_usd: normalizeAmount(allocationUsd),
    updated_at: now.toISOString(),
  };
  database
    .prepare(
      `INSERT INTO project_budgets (project_id, monthly_allocation_usd, updated_at)
       VALUES (@project_id, @monthly_allocation_usd, @updated_at)
       ON CONFLICT(project_id) DO UPDATE SET
         monthly_allocation_usd = excluded.monthly_allocation_usd,
         updated_at = excluded.updated_at`
    )
    .run(row);
}

function sumProjectAllocations(): number {
  const database = getDb();
  const row = database
    .prepare("SELECT COALESCE(SUM(monthly_allocation_usd), 0) AS total FROM project_budgets")
    .get() as { total: number };
  return row.total ?? 0;
}

function sumGlobalSpend(periodStart: string, periodEnd: string): number {
  const database = getDb();
  const row = database
    .prepare(
      `SELECT COALESCE(SUM(total_cost_usd), 0) AS total
       FROM cost_records
       WHERE created_at >= ? AND created_at <= ?`
    )
    .get(periodStart, periodEnd) as { total: number };
  return row.total ?? 0;
}

function sumProjectSpend(projectId: string, periodStart: string, periodEnd: string): number {
  const database = getDb();
  const row = database
    .prepare(
      `SELECT COALESCE(SUM(total_cost_usd), 0) AS total
       FROM cost_records
       WHERE project_id = ?
         AND created_at >= ?
         AND created_at <= ?`
    )
    .get(projectId, periodStart, periodEnd) as { total: number };
  return row.total ?? 0;
}

function getBudgetStatus(remaining: number, allocation: number): BudgetStatus {
  if (!Number.isFinite(allocation) || allocation <= 0) {
    return remaining <= 0 ? "exhausted" : "healthy";
  }
  const pct = remaining / allocation;
  if (pct <= 0) return "exhausted";
  if (pct < 0.25) return "critical";
  if (pct <= 0.5) return "warning";
  return "healthy";
}

export function getGlobalBudget(): GlobalBudget {
  const now = new Date();
  const settings = ensureBudgetSettings(now);
  const allocated = sumProjectAllocations();
  const spent = sumGlobalSpend(settings.period_start, settings.period_end);
  const monthlyBudget = settings.monthly_budget_usd ?? 0;
  return {
    monthly_budget_usd: monthlyBudget,
    current_period_start: settings.period_start,
    current_period_end: settings.period_end,
    allocated_usd: allocated,
    unallocated_usd: monthlyBudget - allocated,
    spent_usd: spent,
    remaining_usd: monthlyBudget - spent,
  };
}

export function setGlobalMonthlyBudget(monthlyBudgetUsd: number): GlobalBudget {
  const now = new Date();
  const settings = upsertBudgetSettings(monthlyBudgetUsd, now);
  const allocated = sumProjectAllocations();
  const spent = sumGlobalSpend(settings.period_start, settings.period_end);
  return {
    monthly_budget_usd: settings.monthly_budget_usd,
    current_period_start: settings.period_start,
    current_period_end: settings.period_end,
    allocated_usd: allocated,
    unallocated_usd: settings.monthly_budget_usd - allocated,
    spent_usd: spent,
    remaining_usd: settings.monthly_budget_usd - spent,
  };
}

export function getProjectBudget(projectId: string): ProjectBudget {
  const now = new Date();
  const settings = ensureBudgetSettings(now);
  const allocationRow = getProjectBudgetRow(projectId);
  const allocation = allocationRow?.monthly_allocation_usd ?? 0;
  const spent = sumProjectSpend(projectId, settings.period_start, settings.period_end);
  const remaining = allocation - spent;
  const periodEnd = new Date(settings.period_end);
  const periodStart = new Date(settings.period_start);
  const daysRemaining = Math.max(1, diffDaysInclusive(now, periodEnd));
  const daysElapsed = Math.max(1, diffDaysInclusive(periodStart, now));
  const remainingForDrip = Math.max(0, remaining);
  const dailyDrip = remainingForDrip / daysRemaining;
  const dailyBurn = spent / daysElapsed;
  const runwayDays = dailyBurn > 0 ? remainingForDrip / dailyBurn : daysRemaining;

  return {
    project_id: projectId,
    monthly_allocation_usd: allocation,
    spent_usd: spent,
    remaining_usd: remaining,
    daily_drip_usd: dailyDrip,
    runway_days: runwayDays,
    budget_status: getBudgetStatus(remaining, allocation),
  };
}

export function setProjectBudget(projectId: string, monthlyAllocationUsd: number): ProjectBudget {
  const now = new Date();
  upsertProjectBudgetRow(projectId, monthlyAllocationUsd, now);
  return getProjectBudget(projectId);
}

export function transferProjectBudget(params: {
  fromProjectId: string;
  toProjectId: string;
  amountUsd: number;
}): { from: ProjectBudget; to: ProjectBudget; global: GlobalBudget } {
  const amount = normalizeAmount(params.amountUsd);
  if (amount <= 0) {
    throw new Error("transfer amount must be greater than 0");
  }
  if (params.fromProjectId === params.toProjectId) {
    throw new Error("cannot transfer budget to the same project");
  }

  const database = getDb();
  const now = new Date();
  const nowIso = now.toISOString();

  const tx = database.transaction(() => {
    const fromRow = getProjectBudgetRow(params.fromProjectId);
    const toRow = getProjectBudgetRow(params.toProjectId);
    const fromAllocation = fromRow?.monthly_allocation_usd ?? 0;
    if (fromAllocation < amount) {
      throw new Error("source project does not have enough allocated budget");
    }
    const nextFrom = fromAllocation - amount;
    const nextTo = (toRow?.monthly_allocation_usd ?? 0) + amount;

    database
      .prepare(
        `INSERT INTO project_budgets (project_id, monthly_allocation_usd, updated_at)
         VALUES (@project_id, @monthly_allocation_usd, @updated_at)
         ON CONFLICT(project_id) DO UPDATE SET
           monthly_allocation_usd = excluded.monthly_allocation_usd,
           updated_at = excluded.updated_at`
      )
      .run({
        project_id: params.fromProjectId,
        monthly_allocation_usd: nextFrom,
        updated_at: nowIso,
      });

    database
      .prepare(
        `INSERT INTO project_budgets (project_id, monthly_allocation_usd, updated_at)
         VALUES (@project_id, @monthly_allocation_usd, @updated_at)
         ON CONFLICT(project_id) DO UPDATE SET
           monthly_allocation_usd = excluded.monthly_allocation_usd,
           updated_at = excluded.updated_at`
      )
      .run({
        project_id: params.toProjectId,
        monthly_allocation_usd: nextTo,
        updated_at: nowIso,
      });
  });

  tx();

  return {
    from: getProjectBudget(params.fromProjectId),
    to: getProjectBudget(params.toProjectId),
    global: getGlobalBudget(),
  };
}
