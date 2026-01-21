import { execFile } from "child_process";
import { promisify } from "util";
import { z } from "zod";
import {
  getRunPhaseMetricsSummary,
  getWorkOrderRunDurations,
  type ProjectRow,
  type RunPhaseMetricsSummary,
} from "./db.js";
import { buildWorkOrderGenerationPrompt } from "./prompts/wo_generation.js";
import { listWorkOrders, readyCheck, type WorkOrder } from "./work_orders.js";
import { recordCostEntry, extractTokenUsageFromClaudeResponse } from "./cost_tracking.js";

const execFileAsync = promisify(execFile);

const CLAUDE_WO_MODEL = "claude-3-5-sonnet-20241022";
const CLAUDE_TIMEOUT_MS = 60_000;
const MAX_SIMILAR_WOS = 5;
const MAX_PROMPT_REFERENCES = 12;
const MIN_DESCRIPTION_TOKENS = 6;

export type WorkOrderGenerationType = "feature" | "bugfix" | "refactor" | "research";

export type WOGenerationRequest = {
  project_id: string;
  description: string;
  type?: WorkOrderGenerationType;
  priority?: number;
};

export type GeneratedWO = {
  draft: WorkOrder;
  confidence: number;
  suggestions: string[];
  similar_wos: string[];
};

type LlmDraft = {
  title: string | null;
  goal: string | null;
  context: string[];
  acceptance_criteria: string[];
  non_goals: string[];
  stop_conditions: string[];
  tags: string[];
  depends_on: string[];
  estimate_hours: number | null;
  priority: number | null;
  suggestions: string[];
};

const LlmDraftSchema = z.object({
  title: z.string().min(1),
  goal: z.string().optional(),
  context: z.array(z.string()).optional(),
  acceptance_criteria: z.array(z.string()).optional(),
  non_goals: z.array(z.string()).optional(),
  stop_conditions: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
  depends_on: z.array(z.string()).optional(),
  estimate_hours: z.coerce.number().optional(),
  priority: z.coerce.number().optional(),
  suggestions: z.array(z.string()).optional(),
});

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function normalizeStringArray(value: unknown): string[] {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? [trimmed] : [];
  }
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter(Boolean);
}

function normalizeOptionalString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function normalizePriority(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const clamped = Math.min(5, Math.max(1, Math.trunc(value)));
  return clamped;
}

function normalizeEstimate(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value;
}

function normalizeLlmDraft(raw: unknown): LlmDraft | null {
  const parsed = LlmDraftSchema.safeParse(raw);
  if (!parsed.success) return null;
  const data = parsed.data;
  return {
    title: normalizeOptionalString(data.title),
    goal: normalizeOptionalString(data.goal),
    context: normalizeStringArray(data.context),
    acceptance_criteria: normalizeStringArray(data.acceptance_criteria),
    non_goals: normalizeStringArray(data.non_goals),
    stop_conditions: normalizeStringArray(data.stop_conditions),
    tags: normalizeStringArray(data.tags),
    depends_on: normalizeStringArray(data.depends_on),
    estimate_hours: normalizeEstimate(data.estimate_hours),
    priority: normalizePriority(data.priority),
    suggestions: normalizeStringArray(data.suggestions),
  };
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

function parseLlmOutput(text: string): LlmDraft | null {
  const candidate = extractJsonCandidate(text);
  if (!candidate) return null;
  try {
    const parsed = JSON.parse(candidate) as unknown;
    return normalizeLlmDraft(parsed);
  } catch {
    return null;
  }
}

async function runClaudePrompt(params: {
  prompt: string;
  projectPath: string;
  claudePath?: string;
}): Promise<{ text: string; usage: { inputTokens: number; outputTokens: number } | null }> {
  const command =
    params.claudePath?.trim() ||
    (process.env.CONTROL_CENTER_CLAUDE_PATH || "").trim() ||
    "claude";
  const result = await execFileAsync(
    command,
    ["-p", params.prompt, "--model", CLAUDE_WO_MODEL, "--output-format", "json"],
    {
      cwd: params.projectPath,
      timeout: CLAUDE_TIMEOUT_MS,
      maxBuffer: 5 * 1024 * 1024,
    }
  );
  const stdout = typeof result.stdout === "string" ? result.stdout.trim() : "";
  if (!stdout) throw new Error("Claude CLI returned empty output");
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout) as unknown;
  } catch {
    return { text: stdout, usage: null };
  }
  const usage = extractTokenUsageFromClaudeResponse(parsed);
  const text = extractClaudeText(parsed) ?? stdout;
  return { text, usage };
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

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3);
}

function scoreWorkOrder(
  descriptionTokens: Set<string>,
  workOrder: WorkOrder
): number {
  const fields = [
    workOrder.title,
    workOrder.goal ?? "",
    workOrder.tags.join(" "),
    workOrder.non_goals.join(" "),
  ].join(" ");
  const tokens = new Set(tokenize(fields));
  let score = 0;
  for (const token of descriptionTokens) {
    if (tokens.has(token)) score += 1;
  }
  return score;
}

type ScoredWorkOrder = { workOrder: WorkOrder; score: number };

function scoreWorkOrders(
  workOrders: WorkOrder[],
  description: string,
  type?: WorkOrderGenerationType
): ScoredWorkOrder[] {
  const tokens = new Set(
    tokenize([description, type ?? ""].filter(Boolean).join(" "))
  );
  const scored = workOrders.map((wo) => ({
    workOrder: wo,
    score: scoreWorkOrder(tokens, wo),
  }));
  scored.sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score;
    return b.workOrder.updated_at.localeCompare(a.workOrder.updated_at);
  });
  return scored;
}

function selectSimilarWorkOrders(scored: ScoredWorkOrder[]): WorkOrder[] {
  return scored
    .filter((entry) => entry.score > 0)
    .slice(0, MAX_SIMILAR_WOS)
    .map((entry) => entry.workOrder);
}

function selectPromptReferences(scored: ScoredWorkOrder[]): WorkOrder[] {
  const selected: WorkOrder[] = [];
  const seen = new Set<string>();
  for (const entry of scored) {
    if (entry.score <= 0) continue;
    if (selected.length >= MAX_PROMPT_REFERENCES) break;
    selected.push(entry.workOrder);
    seen.add(entry.workOrder.id);
  }
  if (selected.length >= MAX_PROMPT_REFERENCES) return selected;
  for (const entry of scored) {
    if (selected.length >= MAX_PROMPT_REFERENCES) break;
    if (seen.has(entry.workOrder.id)) continue;
    selected.push(entry.workOrder);
    seen.add(entry.workOrder.id);
  }
  return selected;
}

function deriveWorkOrderId(workOrders: WorkOrder[]): string {
  const year = new Date().getFullYear();
  let maxSeq = 0;
  const re = /^WO-(\d{4})-(\d{3})/;
  for (const wo of workOrders) {
    const match = wo.id.match(re);
    if (!match) continue;
    if (Number(match[1]) !== year) continue;
    const seq = Number(match[2]);
    if (Number.isFinite(seq)) {
      maxSeq = Math.max(maxSeq, seq);
    }
  }
  const next = maxSeq + 1;
  return `WO-${year}-${String(next).padStart(3, "0")}`;
}

function deriveTitle(description: string): string {
  const trimmed = description.trim();
  if (!trimmed) return "New Work Order";
  const first = trimmed.split(/[\n.!?]/)[0] ?? trimmed;
  const candidate = first.trim();
  if (!candidate) return "New Work Order";
  const capped = candidate.length > 80 ? `${candidate.slice(0, 77).trimEnd()}...` : candidate;
  return capped.charAt(0).toUpperCase() + capped.slice(1);
}

function selectTags(params: {
  llmTags: string[];
  similarTags: string[];
  knownTags: string[];
  type?: WorkOrderGenerationType;
}): string[] {
  const knownSet = new Set(params.knownTags);
  const allowAll = knownSet.size === 0;
  const fromLlm = params.llmTags.filter((tag) => allowAll || knownSet.has(tag));
  if (fromLlm.length) return Array.from(new Set(fromLlm));
  const fromSimilar = params.similarTags.filter((tag) => knownSet.has(tag));
  if (fromSimilar.length) return Array.from(new Set(fromSimilar));
  if (params.type) return [params.type];
  return [];
}

function deriveEra(similar: WorkOrder[]): string | null {
  const counts = new Map<string, number>();
  for (const wo of similar) {
    if (!wo.era) continue;
    counts.set(wo.era, (counts.get(wo.era) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestCount = 0;
  for (const [era, count] of counts) {
    if (count > bestCount) {
      best = era;
      bestCount = count;
    }
  }
  return best;
}

function deriveDependencies(
  llmDeps: string[],
  similar: WorkOrder[],
  validIds: Set<string>
): string[] {
  const deps = new Set<string>();
  for (const dep of llmDeps) {
    if (validIds.has(dep)) deps.add(dep);
  }
  for (const wo of similar) {
    if (wo.status === "done") continue;
    if (validIds.has(wo.id)) deps.add(wo.id);
  }
  return Array.from(deps);
}

function roundHours(seconds: number): number {
  const hours = seconds / 3600;
  const rounded = Math.round(hours * 2) / 2;
  const normalized = Number(rounded.toFixed(1));
  return Math.max(0.5, normalized);
}

function estimateFromRunDurations(params: {
  similar: ReturnType<typeof getWorkOrderRunDurations>;
  summary: RunPhaseMetricsSummary;
}): { hours: number | null; method: "similar" | "recent" | "average" | "none" } {
  const similarRuns = params.similar.filter((entry) => entry.avg_seconds > 0);
  if (similarRuns.length) {
    let totalSeconds = 0;
    let totalRuns = 0;
    for (const entry of similarRuns) {
      const weight = Math.max(1, entry.run_count);
      totalSeconds += entry.avg_seconds * weight;
      totalRuns += weight;
    }
    if (totalRuns > 0) {
      return { hours: roundHours(totalSeconds / totalRuns), method: "similar" };
    }
  }

  const recent = params.summary.recent_runs.filter((run) => run.total_seconds > 0);
  if (recent.length) {
    const totalSeconds = recent.reduce((sum, run) => sum + run.total_seconds, 0);
    return { hours: roundHours(totalSeconds / recent.length), method: "recent" };
  }

  const avgIterations =
    params.summary.avg_iterations > 0 ? params.summary.avg_iterations : 1;
  const avgTotal =
    params.summary.avg_setup_seconds +
    params.summary.avg_reviewer_seconds +
    params.summary.avg_builder_seconds * avgIterations;
  if (avgTotal > 0) {
    return { hours: roundHours(avgTotal), method: "average" };
  }
  return { hours: null, method: "none" };
}

function computeConfidence(params: {
  usedLlm: boolean;
  descriptionTokenCount: number;
  readyOk: boolean;
  suggestions: string[];
  similarCount: number;
}): number {
  let confidence = params.usedLlm ? 0.78 : 0.55;
  if (params.descriptionTokenCount < MIN_DESCRIPTION_TOKENS) confidence -= 0.15;
  if (!params.readyOk) confidence -= 0.2;
  if (!params.similarCount) confidence -= 0.05;
  confidence -= Math.min(0.15, params.suggestions.length * 0.03);
  return Math.max(0.2, Math.min(0.95, Number(confidence.toFixed(2))));
}

export async function generateWorkOrderDraft(params: {
  project: ProjectRow;
  description: string;
  type?: WorkOrderGenerationType;
  priority?: number | null;
  claudePath?: string;
}): Promise<GeneratedWO> {
  const description = params.description.trim();
  const workOrders = listWorkOrders(params.project.path);
  const scored = scoreWorkOrders(workOrders, description, params.type);
  const similar = selectSimilarWorkOrders(scored);
  const promptRefs = selectPromptReferences(scored);
  const knownTags = Array.from(
    new Set(workOrders.flatMap((wo) => wo.tags).filter(Boolean))
  ).sort();

  const prompt = buildWorkOrderGenerationPrompt({
    projectName: params.project.name,
    description,
    type: params.type,
    priority: params.priority ?? null,
    knownTags,
    references: promptRefs.map((wo) => ({
      id: wo.id,
      title: wo.title,
      status: wo.status,
      tags: wo.tags,
      goal: wo.goal,
      depends_on: wo.depends_on,
      estimate_hours: wo.estimate_hours,
    })),
  });

  let llmDraft: LlmDraft | null = null;
  let llmUsed = false;
  let llmError: string | null = null;
  let usage: { inputTokens: number; outputTokens: number } | null = null;

  try {
    const result = await runClaudePrompt({
      prompt,
      projectPath: params.project.path,
      claudePath: params.claudePath,
    });
    usage = result.usage;
    llmDraft = parseLlmOutput(result.text);
    llmUsed = llmDraft !== null;
    if (!llmDraft) {
      llmError = "Claude response did not match expected JSON.";
    }
  } catch (err) {
    llmError = err instanceof Error ? err.message : String(err);
  }

  recordCostEntry({
    projectId: params.project.id,
    category: "other",
    model: CLAUDE_WO_MODEL,
    usage,
    description: "work order generation",
  });

  const similarTags = similar.flatMap((wo) => wo.tags);
  const selectedTags = selectTags({
    llmTags: llmDraft?.tags ?? [],
    similarTags,
    knownTags,
    type: params.type,
  });

  const defaultTitle = deriveTitle(description);
  const title = llmDraft?.title ?? defaultTitle;
  const goal = llmDraft?.goal ?? description;
  const acceptance = llmDraft?.acceptance_criteria.length
    ? llmDraft.acceptance_criteria
    : ["Behavior matches the request description."];
  const stopConditionsBase = llmDraft?.stop_conditions.length
    ? llmDraft.stop_conditions
    : ["Stop and ask for clarification if requirements are ambiguous."];
  const stopConditions = [...stopConditionsBase];
  const hasClarify = stopConditions.some((entry) =>
    entry.toLowerCase().includes("clarif")
  );
  if (!hasClarify) {
    stopConditions.push("Stop and ask for clarification if requirements are ambiguous.");
  }
  const nonGoals = llmDraft?.non_goals.length
    ? llmDraft.non_goals
    : ["No unrelated refactors or scope expansion."];
  const context = llmDraft?.context.length
    ? llmDraft.context
    : [`User request: ${description}`];

  const validIds = new Set(workOrders.map((wo) => wo.id));
  const depends_on = deriveDependencies(llmDraft?.depends_on ?? [], similar, validIds);

  const runSummary = getRunPhaseMetricsSummary(params.project.id);
  const similarDurations = getWorkOrderRunDurations(
    params.project.id,
    similar.map((wo) => wo.id)
  );
  const estimate = estimateFromRunDurations({
    similar: similarDurations,
    summary: runSummary,
  });
  const estimate_hours =
    estimate.hours ?? llmDraft?.estimate_hours ?? 1;

  const priority = params.priority ?? llmDraft?.priority ?? 3;
  const era = deriveEra(similar);

  const rc = readyCheck({
    goal,
    acceptance_criteria: acceptance,
    stop_conditions: stopConditions,
  });

  const suggestionsSet = new Set<string>();
  for (const suggestion of llmDraft?.suggestions ?? []) {
    suggestionsSet.add(suggestion);
  }
  if (!params.type) {
    suggestionsSet.add("Confirm the work order type (feature/bugfix/refactor/research).");
  }
  if (!similar.length) {
    suggestionsSet.add("No similar work orders found; confirm tags or related areas.");
  }
  if (depends_on.length) {
    suggestionsSet.add(`Verify dependencies: ${depends_on.join(", ")}.`);
  }
  if (estimate.method !== "similar") {
    const note =
      estimate.method === "recent"
        ? "Estimate is based on recent run averages, not specific similar WOs."
        : estimate.method === "average"
          ? "Estimate is based on project averages; adjust if needed."
          : "No run metrics available; provide a time estimate.";
    suggestionsSet.add(note);
  }
  if (!rc.ok) {
    suggestionsSet.add("Provide missing goal/acceptance criteria/stop conditions.");
  }
  if (tokenize(description).length < MIN_DESCRIPTION_TOKENS) {
    suggestionsSet.add("Add more detail about scope, success criteria, and exclusions.");
  }
  if (llmError) {
    suggestionsSet.add("Claude generation failed; provide more detail or retry.");
  }

  const suggestions = Array.from(suggestionsSet);
  const confidence = computeConfidence({
    usedLlm: llmUsed,
    descriptionTokenCount: tokenize(description).length,
    readyOk: rc.ok,
    suggestions,
    similarCount: similar.length,
  });

  const draft: WorkOrder = {
    id: deriveWorkOrderId(workOrders),
    title,
    goal,
    context,
    acceptance_criteria: acceptance,
    non_goals: nonGoals,
    stop_conditions: stopConditions,
    priority: Math.min(5, Math.max(1, Math.trunc(priority))),
    tags: selectedTags,
    base_branch: null,
    estimate_hours,
    status: "backlog",
    created_at: todayIsoDate(),
    updated_at: todayIsoDate(),
    depends_on,
    era,
    ready_check: rc,
    trackId: null,
    track: null,
  };

  return {
    draft,
    confidence,
    suggestions,
    similar_wos: similar.map((wo) => wo.id),
  };
}
