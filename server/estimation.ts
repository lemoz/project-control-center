import { execFile } from "child_process";
import { promisify } from "util";
import {
  getEstimationContextSummary,
  listEstimationContextRuns,
  type EstimationContextRunRow,
} from "./db.js";
import { resolveUtilitySettings } from "./settings.js";

const execFileAsync = promisify(execFile);

const CLAUDE_ESTIMATE_MODEL = "claude-3-haiku-20240307";
const CLAUDE_TIMEOUT_MS = 45_000;
const DEFAULT_CONTEXT_LIMIT = 5;
const CONTEXT_FETCH_MULTIPLIER = 5;
const MAX_REASONING_CHARS = 240;
const DEFAULT_ETA_TOTAL_SECONDS = 60 * 60;
const DEFAULT_ETA_PHASE_SECONDS = {
  setup: 5 * 60,
  builder: 20 * 60,
  test: 8 * 60,
  reviewer: 8 * 60,
  merge: 60,
};

export type RunEstimateConfidence = "high" | "medium" | "low";

export type RunEstimate = {
  estimated_iterations: number;
  estimated_minutes: number;
  confidence: RunEstimateConfidence;
  reasoning: string;
};

export type ProgressiveEstimate = {
  phase: string;
  iteration: number;
  estimated_remaining_minutes: number;
  estimated_completion_at: string;
  reasoning: string;
  updated_at: string;
};

export type EtaPhasePlan = {
  setup_seconds: number;
  builder_seconds: number;
  test_seconds: number;
  reviewer_seconds: number;
  merge_seconds: number;
  iteration_seconds: number;
};

export type EtaCompletedCounts = {
  setup_done: boolean;
  builder: number;
  test: number;
  reviewer: number;
};

export type EtaActualTotals = {
  setup_seconds: number;
  builder_seconds: number;
  test_seconds: number;
  reviewer_seconds: number;
};

export type EtaUpdateEvent =
  | {
      phase: "setup";
      iteration: number;
      actual_setup_seconds: number;
    }
  | {
      phase: "builder";
      iteration: number;
      tests_passed: boolean;
      actual_builder_seconds: number;
      actual_test_seconds: number;
    }
  | {
      phase: "reviewer";
      iteration: number;
      verdict: "approved" | "changes_requested";
      actual_reviewer_seconds: number;
    };

export type ProgressiveEtaResult = {
  entry: ProgressiveEstimate;
  current_eta_minutes: number;
  estimated_completion_at: string;
};

export type EstimationContext = {
  averages: {
    setup_seconds: number;
    builder_seconds: number;
    reviewer_seconds: number;
    test_seconds: number;
    iterations: number;
    total_seconds: number;
  };
  sample_size: number;
  recent_runs: Array<{
    wo_title: string;
    iterations: number;
    total_minutes: number;
    outcome: "approved" | "failed";
  }>;
};

type EstimationContextCandidate = {
  wo_title: string;
  wo_tags: string[];
  iterations: number;
  total_minutes: number;
  outcome: "approved" | "failed";
  created_at: string;
};

function claudeCommand(cliPath?: string): string {
  return cliPath?.trim() || process.env.CONTROL_CENTER_CLAUDE_PATH || "claude";
}

function normalizeCount(value: unknown, fallback = 0): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.trunc(value));
}

function normalizeSeconds(value: unknown, fallback = 0): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(0, value);
}

function normalizeMinutes(seconds: number): number {
  if (!Number.isFinite(seconds) || seconds <= 0) return 0;
  return Math.max(0, Math.round(seconds / 60));
}

function clampInt(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

function normalizeConfidence(
  value: unknown,
  fallback: RunEstimateConfidence
): RunEstimateConfidence {
  if (typeof value !== "string") return fallback;
  const normalized = value.trim().toLowerCase();
  if (normalized === "high" || normalized === "medium" || normalized === "low") {
    return normalized;
  }
  return fallback;
}

function normalizeReasoning(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  if (!trimmed) return fallback;
  return trimmed.length > MAX_REASONING_CHARS ? trimmed.slice(0, MAX_REASONING_CHARS) : trimmed;
}

function clampEtaReasoning(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "Estimate updated.";
  return trimmed.length > MAX_REASONING_CHARS ? trimmed.slice(0, MAX_REASONING_CHARS) : trimmed;
}

function formatMinutes(seconds: number): number {
  if (!Number.isFinite(seconds) || seconds <= 0) return 0;
  return Math.max(1, Math.round(seconds / 60));
}

function buildAdjustmentNote(actualMinutes: number, expectedMinutes: number): string {
  if (actualMinutes === expectedMinutes) return "Keeping estimate steady.";
  return actualMinutes < expectedMinutes ? "Adjusting estimate down." : "Adjusting estimate up.";
}

function extractJsonCandidate(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const fencedJson = trimmed.match(/```json\s*([\s\S]*?)```/i);
  if (fencedJson && fencedJson[1]) return fencedJson[1].trim();
  const fenced = trimmed.match(/```\s*([\s\S]*?)```/);
  if (fenced && fenced[1]) return fenced[1].trim();
  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first === -1 || last === -1 || last <= first) return null;
  return trimmed.slice(first, last + 1);
}

function extractClaudeText(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record.text === "string") return record.text;
  const content = record.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const item of content) {
      if (typeof item === "string") {
        parts.push(item);
        continue;
      }
      if (item && typeof item === "object") {
        const text = (item as Record<string, unknown>).text;
        if (typeof text === "string") {
          parts.push(text);
        }
      }
    }
    const combined = parts.join("");
    return combined.trim() ? combined : null;
  }
  return null;
}

function parseEstimateOutput(text: string, fallback: RunEstimate): RunEstimate | null {
  const candidate = extractJsonCandidate(text);
  if (!candidate) return null;
  try {
    const parsed = JSON.parse(candidate) as Record<string, unknown>;
    const estimatedIterationsRaw =
      typeof parsed.estimated_iterations === "number"
        ? parsed.estimated_iterations
        : Number(parsed.estimated_iterations);
    const estimatedMinutesRaw =
      typeof parsed.estimated_minutes === "number"
        ? parsed.estimated_minutes
        : Number(parsed.estimated_minutes);
    const estimated_iterations = clampInt(estimatedIterationsRaw, 1, 5, fallback.estimated_iterations);
    const estimated_minutes = clampInt(estimatedMinutesRaw, 20, 120, fallback.estimated_minutes);
    const confidence = normalizeConfidence(parsed.confidence, fallback.confidence);
    const reasoning = normalizeReasoning(parsed.reasoning, fallback.reasoning);
    return { estimated_iterations, estimated_minutes, confidence, reasoning };
  } catch {
    return null;
  }
}

function resolveRunOutcome(
  status: EstimationContextRunRow["status"],
  reviewerVerdict: EstimationContextRunRow["reviewer_verdict"]
): "approved" | "failed" {
  if (status === "baseline_failed" || status === "merge_conflict" || status === "failed") {
    return "failed";
  }
  if (status === "merged" || status === "you_review") return "approved";
  if (reviewerVerdict === "approved") return "approved";
  return "failed";
}

function countTagOverlap(tags: string[], targetTags: Set<string>): number {
  if (!tags.length || targetTags.size === 0) return 0;
  const seen = new Set<string>();
  let count = 0;
  for (const tag of tags) {
    const normalized = tag.trim().toLowerCase();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    if (targetTags.has(normalized)) count += 1;
  }
  return count;
}

function sortRunsBySimilarity(
  runs: EstimationContextCandidate[],
  targetTags: string[]
): EstimationContextCandidate[] {
  const sortedByRecency = [...runs].sort((a, b) => b.created_at.localeCompare(a.created_at));
  if (!targetTags.length) return sortedByRecency;
  const targetSet = new Set(
    targetTags.map((tag) => tag.trim().toLowerCase()).filter(Boolean)
  );
  if (!targetSet.size) return sortedByRecency;
  const scored = sortedByRecency.map((run) => ({
    run,
    overlap: countTagOverlap(run.wo_tags, targetSet),
  }));
  const filtered = scored.filter((entry) => entry.overlap > 0);
  const base = filtered.length ? filtered : scored;
  return base
    .sort((a, b) => {
      if (a.overlap !== b.overlap) return b.overlap - a.overlap;
      return b.run.created_at.localeCompare(a.run.created_at);
    })
    .map((entry) => entry.run);
}

export function buildEstimationContext(params: {
  projectId: string;
  workOrderTags: string[];
  limit?: number;
}): EstimationContext {
  const limit = params.limit ?? DEFAULT_CONTEXT_LIMIT;
  const normalizedLimit =
    Number.isFinite(limit) && limit > 0 ? Math.min(50, Math.trunc(limit)) : DEFAULT_CONTEXT_LIMIT;
  const fetchLimit = Math.min(
    200,
    Math.max(normalizedLimit * CONTEXT_FETCH_MULTIPLIER, normalizedLimit)
  );

  const summary = getEstimationContextSummary(params.projectId);
  const runs = listEstimationContextRuns(params.projectId, fetchLimit);

  const resolvedRuns: EstimationContextCandidate[] = runs.map((run) => {
    const woTitle = run.work_order_title?.trim() || run.work_order_id;
    const totalMinutes = normalizeMinutes(run.total_seconds);
    return {
      wo_title: woTitle,
      wo_tags: run.work_order_tags,
      iterations: clampInt(run.iterations, 1, 5, 1),
      total_minutes: totalMinutes,
      outcome: resolveRunOutcome(run.status, run.reviewer_verdict),
      created_at: run.created_at,
    };
  });

  const sorted = sortRunsBySimilarity(resolvedRuns, params.workOrderTags).slice(0, normalizedLimit);

  return {
    averages: summary.averages,
    sample_size: summary.sample_size,
    recent_runs: sorted.map((run) => ({
      wo_title: run.wo_title,
      iterations: run.iterations,
      total_minutes: run.total_minutes,
      outcome: run.outcome,
    })),
  };
}

function buildEstimationPrompt(woContent: string, context: EstimationContext): string {
  const avgTotal =
    normalizeSeconds(context.averages.total_seconds) ||
    normalizeSeconds(
      context.averages.setup_seconds +
        context.averages.builder_seconds +
        context.averages.reviewer_seconds +
        context.averages.test_seconds
    );

  const recentRunsBlock = context.recent_runs.length
    ? context.recent_runs
        .map(
          (run) =>
            `- ${run.wo_title}: ${run.iterations} iterations, ${run.total_minutes} min (${run.outcome})`
        )
        .join("\n")
    : "- None available";

  return [
    "You are estimating wall-clock time for an autonomous code agent run.",
    "",
    "## Historical Data",
    `- Average setup: ${Math.round(normalizeSeconds(context.averages.setup_seconds))} seconds`,
    `- Average builder phase: ${Math.round(normalizeSeconds(context.averages.builder_seconds))} seconds`,
    `- Average reviewer phase: ${Math.round(
      normalizeSeconds(context.averages.reviewer_seconds)
    )} seconds`,
    `- Average iterations: ${Math.round(normalizeSeconds(context.averages.iterations))}`,
    `- Average total time: ${Math.round(avgTotal)} seconds`,
    `- Sample size: ${normalizeCount(context.sample_size)} runs`,
    "",
    "## Recent Similar Runs",
    recentRunsBlock,
    "",
    "## Work Order to Estimate",
    woContent.trim(),
    "",
    "## Instructions",
    "Based on the work order complexity, estimate:",
    "1. Likely iterations (1-5): More files, new patterns, or complex logic = more iterations",
    "2. Total time in minutes (20-120)",
    "3. Confidence (high/medium/low)",
    "4. Brief reasoning (1-2 sentences)",
    "",
    "If data is sparse, lean on historical averages and lower confidence.",
    "",
    'Respond in JSON: {"estimated_iterations": N, "estimated_minutes": N, "confidence": "...", "reasoning": "..."}',
  ].join("\n");
}

function fallbackConfidence(sampleSize: number): RunEstimateConfidence {
  if (sampleSize >= 12) return "high";
  if (sampleSize >= 4) return "medium";
  return "low";
}

function buildFallbackEstimate(context: EstimationContext, note: string): RunEstimate {
  const avgIterations = normalizeSeconds(context.averages.iterations);
  const avgTotalSeconds =
    normalizeSeconds(context.averages.total_seconds) ||
    normalizeSeconds(
      context.averages.setup_seconds +
        context.averages.builder_seconds +
        context.averages.reviewer_seconds +
        context.averages.test_seconds
    );
  const baseIterations = avgIterations > 0 ? avgIterations : 2;
  const baseMinutes =
    avgTotalSeconds > 0 ? Math.round(avgTotalSeconds / 60) : 60;
  const estimated_iterations = clampInt(baseIterations, 1, 5, 2);
  const estimated_minutes = clampInt(baseMinutes, 20, 120, 60);
  const confidence = fallbackConfidence(context.sample_size);
  const reasoning = normalizeReasoning(
    `${note} Using historical averages and recent runs for a baseline estimate.`,
    "Using historical averages for a baseline estimate."
  );
  return { estimated_iterations, estimated_minutes, confidence, reasoning };
}

async function runClaudePrompt(params: { prompt: string; model: string; cliPath?: string }) {
  const command = claudeCommand(params.cliPath);
  const result = await execFileAsync(
    command,
    ["-p", "-", "--model", params.model, "--output-format", "json"],
    {
      timeout: CLAUDE_TIMEOUT_MS,
      maxBuffer: 5 * 1024 * 1024,
      input: params.prompt,
    }
  );
  const stdout = typeof result.stdout === "string" ? result.stdout.trim() : "";
  if (!stdout) throw new Error("Claude CLI returned empty output");
  try {
    const parsed = JSON.parse(stdout) as unknown;
    return extractClaudeText(parsed) ?? stdout;
  } catch {
    return stdout;
  }
}

export async function estimateRunTime(
  woContent: string,
  historicalContext: EstimationContext
): Promise<RunEstimate> {
  const fallback = buildFallbackEstimate(historicalContext, "LLM estimate unavailable.");
  const prompt = buildEstimationPrompt(woContent, historicalContext);
  let cliPath: string | undefined;
  try {
    const settings = resolveUtilitySettings().effective;
    if (settings.provider === "claude_cli") cliPath = settings.cliPath;
  } catch {
    cliPath = undefined;
  }

  try {
    const text = await runClaudePrompt({
      prompt,
      model: CLAUDE_ESTIMATE_MODEL,
      cliPath,
    });
    const parsed = parseEstimateOutput(text, fallback);
    if (parsed) return parsed;
    return buildFallbackEstimate(historicalContext, "Claude output did not match expected JSON.");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return buildFallbackEstimate(historicalContext, `Claude estimate failed: ${message}`);
  }
}

export function buildEtaPhasePlan(params: {
  averages: EstimationContext["averages"];
  estimatedMinutes: number | null;
  estimatedIterations: number | null;
}): { plan: EtaPhasePlan; estimated_iterations: number } {
  const fallbackIterationsRaw = normalizeSeconds(params.averages.iterations);
  const fallbackIterations = fallbackIterationsRaw > 0 ? Math.round(fallbackIterationsRaw) : 1;
  const estimated_iterations = clampInt(
    typeof params.estimatedIterations === "number"
      ? params.estimatedIterations
      : fallbackIterations,
    1,
    10,
    1
  );

  const setupBase = normalizeSeconds(
    params.averages.setup_seconds,
    DEFAULT_ETA_PHASE_SECONDS.setup
  );
  const builderBase = normalizeSeconds(
    params.averages.builder_seconds,
    DEFAULT_ETA_PHASE_SECONDS.builder
  );
  const testBase = normalizeSeconds(
    params.averages.test_seconds,
    DEFAULT_ETA_PHASE_SECONDS.test
  );
  const reviewerBase = normalizeSeconds(
    params.averages.reviewer_seconds,
    DEFAULT_ETA_PHASE_SECONDS.reviewer
  );
  const mergeBase = DEFAULT_ETA_PHASE_SECONDS.merge;

  const baseIterationSeconds = builderBase + testBase + reviewerBase;
  const baseTotalSeconds = setupBase + baseIterationSeconds * estimated_iterations + mergeBase;

  const avgTotalSeconds =
    normalizeSeconds(params.averages.total_seconds) ||
    normalizeSeconds(
      params.averages.setup_seconds +
        params.averages.builder_seconds +
        params.averages.test_seconds +
        params.averages.reviewer_seconds
    );
  const targetTotalSeconds =
    typeof params.estimatedMinutes === "number" && Number.isFinite(params.estimatedMinutes)
      ? Math.max(1, Math.round(params.estimatedMinutes * 60))
      : avgTotalSeconds > 0
        ? avgTotalSeconds
        : DEFAULT_ETA_TOTAL_SECONDS;

  const scale =
    baseTotalSeconds > 0 && Number.isFinite(targetTotalSeconds)
      ? targetTotalSeconds / baseTotalSeconds
      : 1;

  const setupSeconds = setupBase * scale;
  const builderSeconds = builderBase * scale;
  const testSeconds = testBase * scale;
  const reviewerSeconds = reviewerBase * scale;
  const mergeSeconds = mergeBase * scale;

  return {
    plan: {
      setup_seconds: setupSeconds,
      builder_seconds: builderSeconds,
      test_seconds: testSeconds,
      reviewer_seconds: reviewerSeconds,
      merge_seconds: mergeSeconds,
      iteration_seconds: builderSeconds + testSeconds + reviewerSeconds,
    },
    estimated_iterations,
  };
}

export function buildInitialEtaEstimate(params: {
  estimate: RunEstimate;
  now?: Date;
}): ProgressiveEtaResult {
  const now = params.now ?? new Date();
  const remainingMinutes = Math.max(1, Math.round(params.estimate.estimated_minutes));
  const estimatedCompletionAt = new Date(
    now.getTime() + remainingMinutes * 60 * 1000
  ).toISOString();
  const reasoning = clampEtaReasoning(`Initial estimate: ${params.estimate.reasoning}`);
  return {
    entry: {
      phase: "initial",
      iteration: 1,
      estimated_remaining_minutes: remainingMinutes,
      estimated_completion_at: estimatedCompletionAt,
      reasoning,
      updated_at: now.toISOString(),
    },
    current_eta_minutes: remainingMinutes,
    estimated_completion_at: estimatedCompletionAt,
  };
}

export function refineProgressiveEta(params: {
  plan: EtaPhasePlan;
  estimatedIterations: number;
  completed: EtaCompletedCounts;
  actual: EtaActualTotals;
  event: EtaUpdateEvent;
  now?: Date;
}): ProgressiveEtaResult {
  const now = params.now ?? new Date();
  const expectedCompletedSeconds =
    (params.completed.setup_done ? params.plan.setup_seconds : 0) +
    params.completed.builder * params.plan.builder_seconds +
    params.completed.test * params.plan.test_seconds +
    params.completed.reviewer * params.plan.reviewer_seconds;
  const actualCompletedSeconds =
    params.actual.setup_seconds +
    params.actual.builder_seconds +
    params.actual.test_seconds +
    params.actual.reviewer_seconds;
  const ratio =
    expectedCompletedSeconds > 0 && actualCompletedSeconds > 0
      ? actualCompletedSeconds / expectedCompletedSeconds
      : 1;

  let remainingExpectedSeconds = 0;
  let reasoning = "";
  if (params.event.phase === "setup") {
    const remainingIterations = Math.max(params.estimatedIterations, 1);
    remainingExpectedSeconds =
      remainingIterations * params.plan.iteration_seconds + params.plan.merge_seconds;
    const actualMinutes = formatMinutes(params.event.actual_setup_seconds);
    const expectedMinutes = formatMinutes(params.plan.setup_seconds);
    const adjustment = buildAdjustmentNote(actualMinutes, expectedMinutes);
    reasoning = `Setup took ${actualMinutes} min (expected ${expectedMinutes}). ${adjustment}`;
  } else if (params.event.phase === "builder") {
    const remainingIterations = params.event.tests_passed
      ? Math.max(params.estimatedIterations - params.event.iteration, 0)
      : Math.max(params.estimatedIterations - params.event.iteration, 1);
    remainingExpectedSeconds =
      (params.event.tests_passed ? params.plan.reviewer_seconds : 0) +
      remainingIterations * params.plan.iteration_seconds +
      params.plan.merge_seconds;
    const actualMinutes = formatMinutes(
      params.event.actual_builder_seconds + params.event.actual_test_seconds
    );
    const expectedMinutes = formatMinutes(
      params.plan.builder_seconds + params.plan.test_seconds
    );
    const adjustment = buildAdjustmentNote(actualMinutes, expectedMinutes);
    const testNote = params.event.tests_passed
      ? "Tests passing."
      : "Tests failed; adding another iteration.";
    reasoning = `Builder + tests took ${actualMinutes} min (expected ${expectedMinutes}). ${testNote} ${adjustment}`;
  } else {
    const remainingIterations =
      params.event.verdict === "approved"
        ? 0
        : Math.max(params.estimatedIterations - params.event.iteration, 1);
    remainingExpectedSeconds =
      (params.event.verdict === "approved" ? 0 : remainingIterations * params.plan.iteration_seconds) +
      params.plan.merge_seconds;
    const actualMinutes = formatMinutes(params.event.actual_reviewer_seconds);
    const expectedMinutes = formatMinutes(params.plan.reviewer_seconds);
    const adjustment = buildAdjustmentNote(actualMinutes, expectedMinutes);
    if (params.event.verdict === "approved") {
      reasoning = `Reviewer approved in ${actualMinutes} min (expected ${expectedMinutes}). Estimating merge only. ${adjustment}`;
    } else {
      reasoning = `Reviewer requested changes in ${actualMinutes} min (expected ${expectedMinutes}). Adding another iteration. ${adjustment}`;
    }
  }

  const adjustedRemainingSeconds = remainingExpectedSeconds * (Number.isFinite(ratio) ? ratio : 1);
  const rawMinutes = Math.round(adjustedRemainingSeconds / 60);
  const remainingMinutes =
    remainingExpectedSeconds > 0 ? Math.max(1, rawMinutes) : Math.max(0, rawMinutes);
  const estimatedCompletionAt = new Date(
    now.getTime() + remainingMinutes * 60 * 1000
  ).toISOString();
  const entry: ProgressiveEstimate = {
    phase: params.event.phase,
    iteration: params.event.iteration,
    estimated_remaining_minutes: remainingMinutes,
    estimated_completion_at: estimatedCompletionAt,
    reasoning: clampEtaReasoning(reasoning),
    updated_at: now.toISOString(),
  };

  return {
    entry,
    current_eta_minutes: remainingMinutes,
    estimated_completion_at: estimatedCompletionAt,
  };
}
