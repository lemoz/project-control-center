import crypto from "crypto";
import fs from "fs";
import { resolveModelPricing } from "./cost_pricing.js";
import { createCostRecord, getDb, type CostCategory } from "./db.js";

export type CostPeriod = "day" | "week" | "month" | "all_time";

export type TokenUsage = {
  inputTokens: number;
  outputTokens: number;
};

export type TokenUsageSource = "actual" | "estimated" | "missing";

export type ProjectCostSummary = {
  project_id: string;
  period: CostPeriod;
  total_cost_usd: number;
  cost_by_category: Record<string, number>;
  run_count: number;
  avg_cost_per_run: number;
  token_totals: {
    input: number;
    output: number;
  };
};

const COST_CATEGORIES: CostCategory[] = [
  "builder",
  "reviewer",
  "chat",
  "handoff",
  "other",
];

function normalizeTokenValue(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.trunc(value));
}

function normalizeUsage(usage: TokenUsage | null): TokenUsage {
  if (!usage) return { inputTokens: 0, outputTokens: 0 };
  return {
    inputTokens: normalizeTokenValue(usage.inputTokens),
    outputTokens: normalizeTokenValue(usage.outputTokens),
  };
}

function combineDescription(base: string | undefined, notes: string[]): string | null {
  const trimmed = typeof base === "string" && base.trim() ? base.trim() : "";
  const parts = trimmed ? [trimmed] : [];
  for (const note of notes) {
    if (!note.trim()) continue;
    parts.push(note.trim());
  }
  return parts.length ? parts.join(" | ") : null;
}

export function recordCostEntry(params: {
  projectId: string;
  runId?: string | null;
  category: CostCategory;
  model: string;
  usage: TokenUsage | null;
  usageSource?: TokenUsageSource;
  description?: string;
  createdAt?: string;
}): void {
  const usage = normalizeUsage(params.usage);
  const usageSource =
    params.usageSource ?? (params.usage ? "actual" : "missing");
  const isActual = usageSource === "actual";
  const pricing = resolveModelPricing(params.model);
  const inputCostPer1k = pricing?.input_cost_per_1k ?? 0;
  const outputCostPer1k = pricing?.output_cost_per_1k ?? 0;
  const totalCostUsd =
    (usage.inputTokens / 1000) * inputCostPer1k +
    (usage.outputTokens / 1000) * outputCostPer1k;

  const notes: string[] = [];
  if (usageSource === "missing") notes.push("token usage missing");
  if (usageSource === "estimated") notes.push("token usage estimated");
  if (!pricing) notes.push("pricing missing for model");
  const description = combineDescription(params.description, notes);

  try {
    createCostRecord({
      id: crypto.randomUUID(),
      project_id: params.projectId,
      run_id: params.runId ?? null,
      category: params.category,
      input_tokens: usage.inputTokens,
      output_tokens: usage.outputTokens,
      is_actual: isActual ? 1 : 0,
      model: params.model,
      input_cost_per_1k: inputCostPer1k,
      output_cost_per_1k: outputCostPer1k,
      total_cost_usd: totalCostUsd,
      description,
      created_at: params.createdAt ?? new Date().toISOString(),
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`[cost_tracking] Failed to write cost record: ${String(err)}`);
  }
}

type TokenUsageEvent = {
  total?: TokenUsage;
  last?: TokenUsage;
};

function parseUsageRecord(value: unknown): TokenUsage | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const input = Number(record.input_tokens);
  const output = Number(record.output_tokens);
  if (!Number.isFinite(input) || !Number.isFinite(output)) return null;
  return { inputTokens: input, outputTokens: output };
}

function parseTokenUsageEvent(value: unknown): TokenUsageEvent | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (record.type !== "event_msg") return null;
  const payload = record.payload;
  if (!payload || typeof payload !== "object") return null;
  const payloadRecord = payload as Record<string, unknown>;
  if (payloadRecord.type !== "token_count") return null;
  const info = payloadRecord.info;
  if (!info || typeof info !== "object") return null;
  const infoRecord = info as Record<string, unknown>;
  const total = parseUsageRecord(infoRecord.total_token_usage) ?? undefined;
  const last = parseUsageRecord(infoRecord.last_token_usage) ?? undefined;
  if (!total && !last) return null;
  return { total, last };
}

export function parseCodexTokenUsageFromLog(logPath: string): TokenUsage | null {
  let text = "";
  try {
    text = fs.readFileSync(logPath, "utf8");
  } catch {
    return null;
  }

  let total: TokenUsage | null = null;
  let sum: TokenUsage = { inputTokens: 0, outputTokens: 0 };
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      continue;
    }
    const event = parseTokenUsageEvent(parsed);
    if (!event) continue;
    if (event.total) {
      total = event.total;
      continue;
    }
    if (event.last) {
      sum = {
        inputTokens: sum.inputTokens + event.last.inputTokens,
        outputTokens: sum.outputTokens + event.last.outputTokens,
      };
    }
  }

  if (total) return normalizeUsage(total);
  if (sum.inputTokens > 0 || sum.outputTokens > 0) return normalizeUsage(sum);
  return null;
}

export function extractTokenUsageFromClaudeResponse(value: unknown): TokenUsage | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const candidates = [
    record.usage,
    record.token_usage,
    record.usage_metadata,
  ];
  for (const candidate of candidates) {
    const usage = parseUsageRecord(candidate);
    if (usage) return normalizeUsage(usage);
    if (candidate && typeof candidate === "object") {
      const nested = candidate as Record<string, unknown>;
      const nestedUsage = parseUsageRecord(nested.total_token_usage);
      if (nestedUsage) return normalizeUsage(nestedUsage);
    }
  }
  return null;
}

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function startOfUtcWeek(date: Date): Date {
  const day = date.getUTCDay();
  const diff = (day + 6) % 7;
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - diff));
}

function startOfUtcMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function periodStartIso(period: CostPeriod, now: Date): string | null {
  if (period === "all_time") return null;
  const start =
    period === "day" ? startOfUtcDay(now) : period === "week" ? startOfUtcWeek(now) : startOfUtcMonth(now);
  return start.toISOString();
}

function initCategoryTotals(): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const category of COST_CATEGORIES) {
    totals[category] = 0;
  }
  return totals;
}

export function getProjectCostSummary(params: {
  projectId: string;
  period: CostPeriod;
  category?: CostCategory | "all";
}): ProjectCostSummary {
  const database = getDb();
  const startIso = periodStartIso(params.period, new Date());
  const values: unknown[] = [params.projectId];
  let where = "WHERE project_id = ?";
  if (startIso) {
    where += " AND created_at >= ?";
    values.push(startIso);
  }
  if (params.category && params.category !== "all") {
    where += " AND category = ?";
    values.push(params.category);
  }

  const totals = database
    .prepare(
      `SELECT
        COALESCE(SUM(total_cost_usd), 0) AS total_cost_usd,
        COALESCE(SUM(input_tokens), 0) AS input_tokens,
        COALESCE(SUM(output_tokens), 0) AS output_tokens
       FROM cost_records
       ${where}`
    )
    .get(...values) as {
    total_cost_usd: number;
    input_tokens: number;
    output_tokens: number;
  };

  const categoryRows = database
    .prepare(
      `SELECT category, COALESCE(SUM(total_cost_usd), 0) AS total_cost_usd
       FROM cost_records
       ${where}
       GROUP BY category`
    )
    .all(...values) as Array<{ category: string; total_cost_usd: number }>;

  const cost_by_category = initCategoryTotals();
  for (const row of categoryRows) {
    cost_by_category[row.category] = row.total_cost_usd;
  }

  const runCountRow = database
    .prepare(
      `SELECT COUNT(DISTINCT run_id) AS run_count
       FROM cost_records
       ${where}
       AND run_id IS NOT NULL`
    )
    .get(...values) as { run_count: number };

  const runTotalsRow = database
    .prepare(
      `SELECT COALESCE(SUM(total_cost_usd), 0) AS run_total_cost_usd
       FROM cost_records
       ${where}
       AND run_id IS NOT NULL`
    )
    .get(...values) as { run_total_cost_usd: number };

  const run_count = runCountRow.run_count ?? 0;
  const total_cost_usd = totals.total_cost_usd ?? 0;
  const run_total_cost_usd = runTotalsRow.run_total_cost_usd ?? 0;
  const avg_cost_per_run = run_count > 0 ? run_total_cost_usd / run_count : 0;

  return {
    project_id: params.projectId,
    period: params.period,
    total_cost_usd,
    cost_by_category,
    run_count,
    avg_cost_per_run,
    token_totals: {
      input: totals.input_tokens ?? 0,
      output: totals.output_tokens ?? 0,
    },
  };
}

function formatDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function getProjectCostHistory(projectId: string, days: number): {
  daily: Array<{
    date: string;
    total_cost_usd: number;
    breakdown: Record<string, number>;
  }>;
} {
  const safeDays = Math.max(1, Math.min(365, Math.trunc(days)));
  const now = new Date();
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const start = new Date(end.getTime() - (safeDays - 1) * 24 * 60 * 60 * 1000);
  const startIso = start.toISOString();

  const database = getDb();
  const rows = database
    .prepare(
      `SELECT date(created_at) AS date_key, category, COALESCE(SUM(total_cost_usd), 0) AS total_cost_usd
       FROM cost_records
       WHERE project_id = ?
         AND created_at >= ?
       GROUP BY date_key, category
       ORDER BY date_key ASC`
    )
    .all(projectId, startIso) as Array<{
    date_key: string;
    category: string;
    total_cost_usd: number;
  }>;

  const byDate = new Map<string, { total: number; breakdown: Record<string, number> }>();
  for (const row of rows) {
    const key = row.date_key;
    if (!byDate.has(key)) {
      byDate.set(key, { total: 0, breakdown: initCategoryTotals() });
    }
    const entry = byDate.get(key);
    if (!entry) continue;
    entry.breakdown[row.category] = (entry.breakdown[row.category] ?? 0) + row.total_cost_usd;
    entry.total += row.total_cost_usd;
  }

  const daily: Array<{ date: string; total_cost_usd: number; breakdown: Record<string, number> }> = [];
  for (let i = 0; i < safeDays; i += 1) {
    const date = new Date(start.getTime() + i * 24 * 60 * 60 * 1000);
    const key = formatDateKey(date);
    const entry = byDate.get(key);
    if (entry) {
      daily.push({ date: key, total_cost_usd: entry.total, breakdown: entry.breakdown });
    } else {
      daily.push({ date: key, total_cost_usd: 0, breakdown: initCategoryTotals() });
    }
  }

  return { daily };
}
