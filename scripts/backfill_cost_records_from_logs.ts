/**
 * Backfill script to estimate token usage and costs for historical runs.
 *
 * Run with: npx tsx scripts/backfill_cost_records_from_logs.ts
 */
import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { resolveModelPricing, type ModelPricing } from "../server/cost_pricing.js";

type CostCategory = "builder" | "reviewer";

type CostBackfillRow = {
  cost_id: string;
  run_id: string;
  category: CostCategory;
  model: string;
  description: string | null;
  run_dir: string;
  work_order_id: string;
  log_path: string;
};

type CostContext = { kind: "iteration"; iteration: number } | { kind: "merge" };

const TOKEN_CHARS_PER_TOKEN = 4;
const CONSTITUTION_TOKENS = 1793;
const SYSTEM_PROMPT_TOKENS = 2000;
const REVIEWER_SYSTEM_PROMPT_TOKENS = 2000;
const TEST_OUTPUT_TOKENS = 1000;
const REVIEWER_FEEDBACK_TOKENS = 500;
const OUTPUT_SUMMARY_MULTIPLIER = 10;

const dbPath =
  process.env.CONTROL_CENTER_DB_PATH ||
  path.join(process.cwd(), "control-center.db");
const db = new Database(dbPath);

function countTokens(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return Math.max(1, Math.round(trimmed.length / TOKEN_CHARS_PER_TOKEN));
}

function readFileIfExists(filePath: string): string | null {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
}

function readJsonFile(filePath: string): unknown | null {
  const text = readFileIfExists(filePath);
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function resolvePricing(model: string): ModelPricing | null {
  const normalized = model.trim();
  if (!normalized) return null;
  return resolveModelPricing(normalized);
}

function parseCostContext(description: string | null, category: CostCategory): CostContext | null {
  if (!description) return null;
  const match = description.match(/(?:builder|reviewer) iteration (\d+)/i);
  if (match) {
    const value = Number(match[1]);
    return Number.isFinite(value) ? { kind: "iteration", iteration: value } : null;
  }
  const normalized = description.toLowerCase();
  if (normalized.includes("merge") && normalized.includes(category)) {
    return { kind: "merge" };
  }
  return null;
}

function appendEstimateNote(description: string | null, note: string): string {
  if (!description || !description.trim()) return note;
  if (description.includes(note)) return description;
  return `${description} | ${note}`;
}

function extractSummaryAndChanges(value: unknown): { summary: string; changes: unknown } {
  if (!value || typeof value !== "object") {
    return { summary: "", changes: null };
  }
  const record = value as Record<string, unknown>;
  const summary = typeof record.summary === "string" ? record.summary : "";
  const changes = record.changes ?? null;
  return { summary, changes };
}

function extractVerdictSummary(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  const record = value as Record<string, unknown>;
  const status = typeof record.status === "string" ? record.status : "";
  const notes = Array.isArray(record.notes)
    ? record.notes.filter((note): note is string => typeof note === "string")
    : [];
  return [status, ...notes].filter((entry) => entry.trim().length > 0).join("\n");
}

function estimateBuilderInputTokens(woTokens: number, iteration: number): number {
  const base = woTokens + CONSTITUTION_TOKENS + SYSTEM_PROMPT_TOKENS;
  const perIteration = Math.max(0, iteration - 1) * (TEST_OUTPUT_TOKENS + REVIEWER_FEEDBACK_TOKENS);
  return base + perIteration;
}

function estimateReviewerInputTokens(woTokens: number, diffTokens: number): number {
  return woTokens + diffTokens + CONSTITUTION_TOKENS + REVIEWER_SYSTEM_PROMPT_TOKENS;
}

function estimateInputTokensFromPrompt(promptPath: string | null, fallback: number): number {
  if (!promptPath) return fallback;
  const prompt = readFileIfExists(promptPath);
  if (!prompt) return fallback;
  const tokens = countTokens(prompt);
  return tokens > 0 ? tokens : fallback;
}

function estimateOutputTokens(summary: string, changes: unknown): number {
  const summaryTokens = countTokens(summary);
  const changesTokens = changes ? countTokens(JSON.stringify(changes)) : 0;
  return (summaryTokens + changesTokens) * OUTPUT_SUMMARY_MULTIPLIER;
}

function extractModelHints(logPath: string): string[] {
  const text = readFileIfExists(logPath);
  if (!text) return [];
  const hints: string[] = [];
  const regex = /(?:--model\s+|model:\s*|model=)([A-Za-z0-9._-]+)/g;
  let match: RegExpExecArray | null = null;
  while ((match = regex.exec(text))) {
    hints.push(match[1]);
  }
  return hints;
}

function chooseModel(recordModel: string, logHints: string[]): string {
  const normalizedRecord = recordModel.trim();
  if (normalizedRecord && resolvePricing(normalizedRecord)) {
    return normalizedRecord;
  }
  for (const hint of logHints) {
    if (resolvePricing(hint)) return hint;
  }
  return "gpt-5.3-codex";
}

function loadWorkOrderContent(runDir: string, workOrderId: string, repoRoot: string): string {
  const runCopy = path.join(runDir, "work_order.md");
  const runText = readFileIfExists(runCopy);
  if (runText) return runText;

  const workOrdersDir = path.join(repoRoot, "work_orders");
  try {
    const entries = fs.readdirSync(workOrdersDir);
    const match = entries.find(
      (entry) => entry.startsWith(`${workOrderId}-`) || entry === `${workOrderId}.md`
    );
    if (match) {
      const text = readFileIfExists(path.join(workOrdersDir, match));
      if (text) return text;
    }
  } catch {
    // ignore
  }
  return "";
}

function loadDiffTokens(runDir: string, iteration: number): number {
  const candidates = [
    path.join(runDir, "reviewer", `iter-${iteration}`, "diff.patch"),
    path.join(runDir, `diff-iter-${iteration}.patch`),
    path.join(runDir, "reviewer", `iter-${iteration}`, "diff.txt"),
    path.join(runDir, "diff.patch"),
  ];
  for (const candidate of candidates) {
    const text = readFileIfExists(candidate);
    if (text) return countTokens(text);
  }
  return 0;
}

function loadMergeDiffTokens(runDir: string): number {
  const candidates = [
    path.join(runDir, "merge", "diff.patch"),
    path.join(runDir, "merge", "reviewer", "diff.patch"),
    path.join(runDir, "diff-merge.patch"),
    path.join(runDir, "diff.patch"),
  ];
  for (const candidate of candidates) {
    const text = readFileIfExists(candidate);
    if (text) return countTokens(text);
  }
  return 0;
}

function formatPricingSummary(models: string[]): string {
  return models
    .map((model) => {
      const pricing = resolveModelPricing(model);
      if (!pricing) return `${model} unavailable`;
      return `${model} $${pricing.input_cost_per_1k.toFixed(3)}/$${pricing.output_cost_per_1k.toFixed(3)}`;
    })
    .join(", ");
}

console.log("Backfill estimation methodology:");
console.log(`- Token estimator: ~1 token per ${TOKEN_CHARS_PER_TOKEN} chars.`);
console.log(
  `- Builder input: woTokens + ${CONSTITUTION_TOKENS} + ${SYSTEM_PROMPT_TOKENS} + (iteration-1)*(${TEST_OUTPUT_TOKENS}+${REVIEWER_FEEDBACK_TOKENS}).`
);
console.log(
  `- Reviewer input: woTokens + diffTokens + ${CONSTITUTION_TOKENS} + ${REVIEWER_SYSTEM_PROMPT_TOKENS}.`
);
console.log("- Merge input: use merge prompt.txt token count when available; fallback to base formulas.");
console.log(
  `- Output tokens (builder): (summaryTokens + changesTokens) * ${OUTPUT_SUMMARY_MULTIPLIER} + diffTokens (merge uses merge/diff.patch when present).`
);
console.log(
  `- Output tokens (reviewer): summaryTokens * ${OUTPUT_SUMMARY_MULTIPLIER}.`
);
console.log(
  `- Pricing: ${formatPricingSummary([
    "gpt-5.3-codex",
    "claude-3-5-sonnet",
    "claude-3-opus",
  ])}.`
);
console.log("- Updated records are marked with description note: backfill-estimated.");

const rows = db
  .prepare(
    `
      SELECT
        cost_records.id AS cost_id,
        cost_records.run_id AS run_id,
        cost_records.category AS category,
        cost_records.model AS model,
        cost_records.description AS description,
        runs.run_dir AS run_dir,
        runs.work_order_id AS work_order_id,
        runs.log_path AS log_path
      FROM cost_records
      JOIN runs ON runs.id = cost_records.run_id
      WHERE cost_records.run_id IS NOT NULL
        AND cost_records.category IN ('builder', 'reviewer')
        AND cost_records.input_tokens = 0
        AND cost_records.output_tokens = 0
        AND (cost_records.description IS NULL OR cost_records.description NOT LIKE '%backfill-estimated%')
    `
  )
  .all() as CostBackfillRow[];

console.log(`Found ${rows.length} cost_records to backfill`);

const updateStmt = db.prepare(`
  UPDATE cost_records
  SET input_tokens = ?,
      output_tokens = ?,
      model = ?,
      input_cost_per_1k = ?,
      output_cost_per_1k = ?,
      total_cost_usd = ?,
      description = ?
  WHERE id = ?
`);

const woTokenCache = new Map<string, number>();
const diffTokenCache = new Map<string, number>();
const logModelCache = new Map<string, string[]>();

let updated = 0;
let skipped = 0;
let totalEstimatedCost = 0;
const costByModel = new Map<string, number>();
const tokenTotals = { input: 0, output: 0 };

for (const row of rows) {
  const context = parseCostContext(row.description, row.category);
  if (!context) {
    console.log(`- Skip ${row.cost_id.slice(0, 8)}: missing iteration/merge in description`);
    skipped += 1;
    continue;
  }

  if (!fs.existsSync(row.run_dir)) {
    console.log(`- Skip ${row.cost_id.slice(0, 8)}: run_dir missing ${row.run_dir}`);
    skipped += 1;
    continue;
  }

  let woTokens = woTokenCache.get(row.run_id);
  if (woTokens === undefined) {
    const woContent = loadWorkOrderContent(row.run_dir, row.work_order_id, process.cwd());
    woTokens = countTokens(woContent);
    woTokenCache.set(row.run_id, woTokens);
  }

  const diffKey =
    context.kind === "iteration"
      ? `${row.run_id}:${context.iteration}`
      : `${row.run_id}:merge`;
  let diffTokens = diffTokenCache.get(diffKey);
  if (diffTokens === undefined) {
    diffTokens =
      context.kind === "iteration"
        ? loadDiffTokens(row.run_dir, context.iteration)
        : loadMergeDiffTokens(row.run_dir);
    diffTokenCache.set(diffKey, diffTokens);
  }

  const logHints =
    logModelCache.get(row.run_id) ?? extractModelHints(row.log_path);
  if (!logModelCache.has(row.run_id)) {
    logModelCache.set(row.run_id, logHints);
  }

  const model = chooseModel(row.model, logHints);
  const pricing = resolvePricing(model);
  if (!pricing) {
    console.log(`- Skip ${row.cost_id.slice(0, 8)}: pricing missing for model ${model}`);
    skipped += 1;
    continue;
  }

  let inputTokens = 0;
  let outputTokens = 0;
  let missingReviewerVerdict = false;
  const contextLabel =
    context.kind === "iteration" ? `iter-${context.iteration}` : "merge";

  if (row.category === "builder") {
    const builderResultPath =
      context.kind === "iteration"
        ? path.join(row.run_dir, "builder", `iter-${context.iteration}`, "result.json")
        : path.join(row.run_dir, "merge", "result.json");
    const builderResult = readJsonFile(builderResultPath);
    const { summary, changes } = extractSummaryAndChanges(builderResult);
    const fallbackInputTokens =
      context.kind === "iteration"
        ? estimateBuilderInputTokens(woTokens, context.iteration)
        : estimateBuilderInputTokens(woTokens, 1);
    const promptPath =
      context.kind === "merge" ? path.join(row.run_dir, "merge", "prompt.txt") : null;
    inputTokens = estimateInputTokensFromPrompt(promptPath, fallbackInputTokens);
    outputTokens = estimateOutputTokens(summary, changes) + diffTokens;
    if (!builderResult) {
      console.log(
        `- Note ${row.cost_id.slice(0, 8)}: missing builder result at ${contextLabel}`
      );
    }
  } else {
    const verdictPath =
      context.kind === "iteration"
        ? path.join(row.run_dir, "reviewer", `iter-${context.iteration}`, "verdict.json")
        : path.join(row.run_dir, "merge", "reviewer", "verdict.json");
    const verdict = readJsonFile(verdictPath);
    missingReviewerVerdict = !verdict;
    if (missingReviewerVerdict) {
      console.log(
        `- Note ${row.cost_id.slice(0, 8)}: missing reviewer verdict at ${contextLabel}, using empty summary estimate`
      );
    }
    const summary = verdict ? extractVerdictSummary(verdict) : "";
    const fallbackInputTokens = estimateReviewerInputTokens(woTokens, diffTokens);
    const promptPath =
      context.kind === "merge"
        ? path.join(row.run_dir, "merge", "reviewer", "prompt.txt")
        : null;
    inputTokens = estimateInputTokensFromPrompt(promptPath, fallbackInputTokens);
    outputTokens = estimateOutputTokens(summary, null);
  }

  const safeInput = Math.max(0, Math.round(inputTokens));
  const safeOutput = Math.max(0, Math.round(outputTokens));
  const totalCostUsd =
    (safeInput / 1000) * pricing.input_cost_per_1k +
    (safeOutput / 1000) * pricing.output_cost_per_1k;
  let description = appendEstimateNote(row.description, "backfill-estimated");
  if (missingReviewerVerdict) {
    description = appendEstimateNote(description, "missing-reviewer-verdict");
  }

  updateStmt.run(
    safeInput,
    safeOutput,
    model,
    pricing.input_cost_per_1k,
    pricing.output_cost_per_1k,
    totalCostUsd,
    description,
    row.cost_id
  );

  updated += 1;
  totalEstimatedCost += totalCostUsd;
  tokenTotals.input += safeInput;
  tokenTotals.output += safeOutput;
  costByModel.set(model, (costByModel.get(model) ?? 0) + totalCostUsd);
}

console.log(`\nBackfill complete: ${updated} updated, ${skipped} skipped`);
console.log(`Total estimated cost: $${totalEstimatedCost.toFixed(4)}`);
console.log(`Total estimated tokens: input=${tokenTotals.input}, output=${tokenTotals.output}`);

if (costByModel.size) {
  console.log("Cost by model:");
  for (const [model, cost] of costByModel.entries()) {
    console.log(`- ${model}: $${cost.toFixed(4)}`);
  }
}

db.close();
