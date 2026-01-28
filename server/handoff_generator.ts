import crypto from "crypto";
import { execFile, spawn } from "child_process";
import fs from "fs";
import path from "path";
import { promisify } from "util";
import { getClaudeCliPath, getCodexCliPath, getProcessEnv } from "./config.js";
import {
  createShiftHandoff,
  findProjectById,
  getActiveShift,
  getRunById,
  listTracks,
  updateShift,
  type ShiftHandoffDecision,
  type Track,
} from "./db.js";
import {
  extractTokenUsageFromClaudeResponse,
  parseCodexTokenUsageFromLog,
  recordCostEntry,
} from "./cost_tracking.js";
import { resolveUtilitySettings } from "./settings.js";
import { assembleTrackContext } from "./shift_context.js";
import type { TrackContext } from "./types.js";
import { listWorkOrders, type WorkOrder } from "./work_orders.js";

const execFileAsync = promisify(execFile);
const CLAUDE_TIMEOUT_MS = 60_000;
const CLAUDE_HANDOFF_MODEL = "claude-3-5-sonnet-20241022";
const DEFAULT_CODEX_MODEL = "gpt-5.2-codex";
const CODEX_TIMEOUT_MS = 60_000;
const MAX_PROMPT_LOG_CHARS = 8_000;
const MAX_PROMPT_DIFF_CHARS = 12_000;
const MAX_PROMPT_TEST_CHARS = 8_000;
const MAX_LOG_LINES = 200;
const MAX_TRACKS_IN_HANDOFF = 5;

export type RunOutcome = "approved" | "merged" | "failed";

export type RunArtifacts = {
  run_id: string;
  work_order_id: string;
  work_order_title: string;
  work_order_track: WorkOrderTrackContext | null;
  outcome: RunOutcome;
  iterations: number;
  duration_minutes: number;
  builder_summary: string;
  builder_log_excerpt: string;
  reviewer_notes: string[];
  test_results: { passed: number; failed: number };
  test_details: string;
  files_changed: string[];
  diff_patch: string;
  error: string | null;
  track_context: TrackContext | null;
};

type HandoffContent = {
  summary: string;
  work_completed: string[];
  decisions_made: ShiftHandoffDecision[];
  recommendations: string[];
  blockers: string[];
  next_priorities: string[];
};

type TestResult = {
  command: string;
  passed: boolean;
  output?: string;
};

type WorkOrderTrackContext = {
  id: string;
  name: string;
  goal: string | null;
};

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

function codexCommand(cliPath?: string): string {
  return cliPath?.trim() || getCodexCliPath();
}

function claudeCommand(cliPath?: string): string {
  return cliPath?.trim() || getClaudeCliPath();
}

function handoffJsonSchema(): object {
  return {
    type: "object",
    additionalProperties: true,
    properties: {
      summary: { type: "string" },
      work_completed: { type: "array", items: { type: "string" } },
      decisions_made: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: true,
          properties: {
            decision: { type: "string" },
            rationale: { type: "string" },
          },
        },
      },
      recommendations: { type: "array", items: { type: "string" } },
      blockers: { type: "array", items: { type: "string" } },
      next_priorities: { type: "array", items: { type: "string" } },
    },
  };
}

function ensureHandoffSchema(baseDir: string): string {
  ensureDir(baseDir);
  const schemaPath = path.join(baseDir, "handoff.schema.json");
  fs.writeFileSync(schemaPath, `${JSON.stringify(handoffJsonSchema(), null, 2)}\n`, "utf8");
  return schemaPath;
}

function writeCodexLog(logPath: string, stdout: string, stderr: string): void {
  const lines = [stdout, stderr].filter(Boolean).join("\n").trimEnd();
  if (!lines) return;
  fs.writeFileSync(logPath, `${lines}\n`, "utf8");
}

function readTextIfExists(filePath: string): string {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return "";
  }
}

function readJsonIfExists<T>(filePath: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
  } catch {
    return null;
  }
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter(Boolean);
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

function parseHandoffOutput(text: string): unknown | null {
  const candidate = extractJsonCandidate(text);
  if (!candidate) return null;
  try {
    return JSON.parse(candidate) as unknown;
  } catch {
    return null;
  }
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

function normalizeDecisionArray(value: unknown): ShiftHandoffDecision[] {
  if (!Array.isArray(value)) return [];
  const decisions: ShiftHandoffDecision[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    const decision =
      typeof record.decision === "string" ? record.decision.trim() : "";
    const rationale =
      typeof record.rationale === "string" ? record.rationale.trim() : "";
    if (!decision || !rationale) continue;
    decisions.push({ decision, rationale });
  }
  return decisions;
}

function parseReviewerNotes(value: string | null): string[] {
  if (!value) return [];
  try {
    return normalizeStringArray(JSON.parse(value));
  } catch {
    return [];
  }
}

function clampText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n...[truncated ${text.length - maxChars} chars]`;
}

function tailLines(text: string, maxLines: number): string {
  const lines = text.split(/\r?\n/);
  if (lines.length <= maxLines) return text;
  return lines.slice(-maxLines).join("\n");
}

function formatTextBlock(text: string, fallback = "(none)"): string {
  const trimmed = text.trim();
  return trimmed ? trimmed : fallback;
}

function formatList(items: string[], fallback = "(none)"): string {
  if (!items.length) return fallback;
  return items.map((item) => `- ${item}`).join("\n");
}

function formatTrackGoal(goal: string | null): string {
  const trimmed = goal?.trim() ?? "";
  return trimmed ? trimmed : "none";
}

function formatActiveTracks(
  tracks: TrackContext["active"],
  limit: number
): string {
  if (!tracks.length) return "None.";
  const shown = tracks.slice(0, limit);
  const lines = shown.map((track) => {
    const goal = formatTrackGoal(track.goal);
    return `- ${track.name} (goal: ${goal}) — ${track.progress.done}/${track.progress.total} complete; ready ${track.progress.ready}; building ${track.progress.building}`;
  });
  if (tracks.length > limit) {
    lines.push(`- ...and ${tracks.length - limit} more active tracks`);
  }
  return lines.join("\n");
}

function formatStalledTracks(
  tracks: TrackContext["stalled"],
  limit: number
): string {
  if (!tracks.length) return "None.";
  const shown = tracks.slice(0, limit);
  const lines = shown.map((track) => {
    const goal = formatTrackGoal(track.goal);
    return `- ${track.name} (goal: ${goal}) — ${track.progress.backlog} backlog`;
  });
  if (tracks.length > limit) {
    lines.push(`- ...and ${tracks.length - limit} more stalled tracks`);
  }
  return lines.join("\n");
}

function computeDurationMinutes(
  startedAt: string | null,
  finishedAt: string | null,
  createdAt: string
): number {
  const start = startedAt ? Date.parse(startedAt) : Date.parse(createdAt);
  const finish = finishedAt ? Date.parse(finishedAt) : NaN;
  if (!Number.isFinite(start) || !Number.isFinite(finish)) return 0;
  const minutes = Math.round((finish - start) / 60_000);
  return Math.max(0, minutes);
}

function buildTestDetails(tests: TestResult[]): string {
  if (!tests.length) return "";
  const lines: string[] = [];
  for (const test of tests) {
    const status = test.passed ? "PASS" : "FAIL";
    lines.push(`${status}: ${test.command}`);
    if (test.output && test.output.trim()) {
      lines.push(clampText(test.output.trim(), MAX_PROMPT_TEST_CHARS));
    }
  }
  return lines.join("\n");
}

function resolveWorkOrderTrack(
  workOrder: WorkOrder | undefined,
  tracks: Track[]
): WorkOrderTrackContext | null {
  if (!workOrder?.trackId) return null;
  const track = tracks.find((entry) => entry.id === workOrder.trackId);
  if (track) {
    return { id: track.id, name: track.name, goal: track.goal };
  }
  const fallbackName = workOrder.track?.name ?? "";
  if (fallbackName) {
    return { id: workOrder.trackId, name: fallbackName, goal: null };
  }
  return null;
}

function gatherRunArtifacts(params: {
  runId: string;
  projectId: string;
  outcome: RunOutcome;
  log: (line: string) => void;
}): RunArtifacts | null {
  const run = getRunById(params.runId);
  if (!run) {
    params.log(`handoff: run ${params.runId} not found`);
    return null;
  }

  const project = findProjectById(params.projectId);
  if (!project) {
    params.log(`handoff: project ${params.projectId} not found`);
    return null;
  }

  const workOrders = listWorkOrders(project.path);
  const workOrder = workOrders.find((wo) => wo.id === run.work_order_id);
  const workOrderTitle = workOrder?.title ?? "(unknown work order)";
  const tracks = listTracks(project.id);
  const workOrderTrack = resolveWorkOrderTrack(workOrder, tracks);
  const trackContext = assembleTrackContext(tracks, workOrders);

  const iterations = Math.max(1, run.iteration || 0, run.builder_iteration || 0);
  const builderDir = path.join(run.run_dir, "builder", `iter-${iterations}`);
  const reviewerDir = path.join(run.run_dir, "reviewer", `iter-${iterations}`);

  const builderResult = readJsonIfExists<{ summary?: string }>(
    path.join(builderDir, "result.json")
  );
  const builderSummary =
    (builderResult?.summary ?? run.summary ?? "(no builder summary)").trim() ||
    "(no builder summary)";

  const builderLogRaw =
    readTextIfExists(path.join(builderDir, "codex.log")) ||
    readTextIfExists(run.log_path);
  const builderLogExcerpt = clampText(
    tailLines(builderLogRaw, MAX_LOG_LINES),
    MAX_PROMPT_LOG_CHARS
  );

  let reviewerNotes = parseReviewerNotes(run.reviewer_notes);
  if (!reviewerNotes.length) {
    const reviewerVerdict = readJsonIfExists<{ notes?: unknown }>(
      path.join(reviewerDir, "verdict.json")
    );
    reviewerNotes = normalizeStringArray(reviewerVerdict?.notes);
  }

  const tests =
    readJsonIfExists<TestResult[]>(path.join(run.run_dir, "tests", "results.json")) ??
    [];
  const passed = tests.filter((test) => test.passed).length;
  const failed = tests.length - passed;

  const filesChanged =
    readJsonIfExists<string[]>(path.join(run.run_dir, "files_changed.merge.json")) ??
    readJsonIfExists<string[]>(path.join(run.run_dir, "files_changed.json")) ??
    [];

  const diffPatch =
    readTextIfExists(path.join(run.run_dir, "diff-merge.patch")) ||
    readTextIfExists(path.join(run.run_dir, "diff.patch"));

  return {
    run_id: run.id,
    work_order_id: run.work_order_id,
    work_order_title: workOrderTitle,
    work_order_track: workOrderTrack,
    outcome: params.outcome,
    iterations,
    duration_minutes: computeDurationMinutes(
      run.started_at,
      run.finished_at,
      run.created_at
    ),
    builder_summary: builderSummary,
    builder_log_excerpt: builderLogExcerpt,
    reviewer_notes: reviewerNotes,
    test_results: { passed, failed },
    test_details: clampText(buildTestDetails(tests), MAX_PROMPT_TEST_CHARS),
    files_changed: filesChanged,
    diff_patch: clampText(diffPatch, MAX_PROMPT_DIFF_CHARS),
    error: run.error ?? null,
    track_context: trackContext,
  };
}

function buildHandoffPrompt(artifacts: RunArtifacts): string {
  const sections: string[] = [];
  sections.push(
    "You are generating a shift handoff for the next agent. Analyze this run and create a structured summary.",
    "",
    "## Run Details",
    `- Work Order: ${artifacts.work_order_id} - ${artifacts.work_order_title}`,
    `- Outcome: ${artifacts.outcome}`,
    `- Iterations: ${artifacts.iterations}`,
    `- Duration: ${artifacts.duration_minutes} minutes`,
    ""
  );

  const trackContext = artifacts.track_context;
  const hasTrackContext =
    Boolean(artifacts.work_order_track) ||
    (trackContext &&
      (trackContext.active.length > 0 || trackContext.stalled.length > 0));

  if (hasTrackContext) {
    sections.push("## Track Context");
    if (artifacts.work_order_track) {
      sections.push(
        `- Work order track: ${artifacts.work_order_track.name} (goal: ${formatTrackGoal(
          artifacts.work_order_track.goal
        )})`
      );
    }
    if (trackContext) {
      sections.push("", "Active tracks (ready or in progress):");
      sections.push(formatActiveTracks(trackContext.active, MAX_TRACKS_IN_HANDOFF));
      if (trackContext.stalled.length) {
        sections.push("", "Stalled tracks (backlog only):");
        sections.push(formatStalledTracks(trackContext.stalled, MAX_TRACKS_IN_HANDOFF));
      }
    }
    sections.push("");
  }

  sections.push(
    "## Builder Summary",
    formatTextBlock(artifacts.builder_summary),
    "",
    "## Builder Logs (tail)",
    formatTextBlock(artifacts.builder_log_excerpt),
    "",
    "## Reviewer Notes",
    formatList(artifacts.reviewer_notes),
    "",
    "## Test Results",
    `Passed: ${artifacts.test_results.passed}, Failed: ${artifacts.test_results.failed}`,
    artifacts.test_details ? `\n${artifacts.test_details}` : "",
    "",
    "## Files Changed",
    formatList(artifacts.files_changed),
    "",
    "## Diff Patch (truncated)",
    formatTextBlock(artifacts.diff_patch)
  );

  if (artifacts.error) {
    sections.push("", "## Error", artifacts.error);
  }

  sections.push(
    "",
    "---",
    "",
    "Generate a handoff JSON with these fields:",
    "- summary: 1-2 sentence summary of what was accomplished",
    "- work_completed: Array of specific items completed",
    "- decisions_made: Array of {decision, rationale} extracted from the logs",
    "- recommendations: Array of suggested next steps",
    "- blockers: Array of any issues or blockers encountered",
    "- next_priorities: Array of WO IDs or tasks to prioritize next",
    "- When listing priorities or recommendations, reference relevant track goals and why they matter",
    "",
    "Respond with only valid JSON."
  );

  return sections.join("\n");
}

function fallbackHandoff(artifacts: RunArtifacts): HandoffContent {
  return {
    summary: `Ran ${artifacts.work_order_id}: ${artifacts.outcome}`,
    work_completed: [artifacts.work_order_id],
    decisions_made: [],
    recommendations: [],
    blockers: artifacts.error ? [artifacts.error] : [],
    next_priorities: [],
  };
}

function normalizeHandoffContent(
  raw: unknown,
  fallback: HandoffContent
): HandoffContent {
  if (!raw || typeof raw !== "object") return fallback;
  const record = raw as Record<string, unknown>;
  const summary =
    typeof record.summary === "string" && record.summary.trim()
      ? record.summary.trim()
      : fallback.summary;
  const workCompleted = normalizeStringArray(record.work_completed);
  const decisions = normalizeDecisionArray(record.decisions_made);
  const recommendations = normalizeStringArray(record.recommendations);
  const blockers = normalizeStringArray(record.blockers);
  const nextPriorities = normalizeStringArray(record.next_priorities);
  return {
    summary,
    work_completed: workCompleted.length ? workCompleted : fallback.work_completed,
    decisions_made: decisions.length ? decisions : fallback.decisions_made,
    recommendations: recommendations.length
      ? recommendations
      : fallback.recommendations,
    blockers: blockers.length ? blockers : fallback.blockers,
    next_priorities: nextPriorities.length
      ? nextPriorities
      : fallback.next_priorities,
  };
}

async function generateHandoff(params: {
  prompt: string;
  projectPath: string;
  model: string;
  cliPath?: string;
}): Promise<{ text: string; usage: { inputTokens: number; outputTokens: number } | null }> {
  const result = await execFileAsync(
    claudeCommand(params.cliPath),
    ["-p", params.prompt, "--model", params.model, "--output-format", "json"],
    {
      cwd: params.projectPath,
      timeout: CLAUDE_TIMEOUT_MS,
      maxBuffer: 5 * 1024 * 1024,
    }
  );
  const stdout = typeof result.stdout === "string" ? result.stdout.trim() : "";
  if (!stdout) {
    throw new Error("Claude CLI returned empty output");
  }
  const parsed = JSON.parse(stdout) as unknown;
  const usage = extractTokenUsageFromClaudeResponse(parsed);
  const text = extractClaudeText(parsed) ?? stdout;
  return { text, usage };
}

async function runCodexPrompt(params: {
  prompt: string;
  projectPath: string;
  model: string;
  cliPath?: string;
}): Promise<{ text: string; usage: { inputTokens: number; outputTokens: number } | null }> {
  const baseDir = path.join(params.projectPath, ".system", "utility");
  ensureDir(baseDir);
  const schemaPath = ensureHandoffSchema(baseDir);
  const id = crypto.randomUUID();
  const outputPath = path.join(baseDir, `handoff-${id}.output.txt`);
  const logPath = path.join(baseDir, `handoff-${id}.codex.jsonl`);
  const args = [
    "--ask-for-approval",
    "never",
    "exec",
    "--json",
    "--model",
    params.model,
    "--sandbox",
    "read-only",
    "--output-schema",
    schemaPath,
    "--output-last-message",
    outputPath,
    "--color",
    "never",
    "-",
  ];

  const child = spawn(codexCommand(params.cliPath), args, {
    cwd: params.projectPath,
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...getProcessEnv() },
  });

  let stdout = "";
  let stderr = "";
  let timedOut = false;

  child.stdout?.on("data", (buf) => {
    stdout += buf.toString("utf8");
  });
  child.stderr?.on("data", (buf) => {
    stderr += buf.toString("utf8");
  });
  child.stdin?.write(params.prompt);
  child.stdin?.end();

  const timeoutId = setTimeout(() => {
    timedOut = true;
    child.kill("SIGTERM");
  }, CODEX_TIMEOUT_MS);

  let exitCode: number;
  try {
    exitCode = await new Promise((resolve, reject) => {
      child.on("close", (code) => resolve(code ?? 1));
      child.on("error", (err) => reject(err));
    });
  } catch (err) {
    clearTimeout(timeoutId);
    writeCodexLog(logPath, stdout, stderr);
    throw err instanceof Error ? err : new Error(String(err));
  }
  clearTimeout(timeoutId);

  writeCodexLog(logPath, stdout, stderr);
  if (timedOut) {
    throw new Error("codex exec timed out");
  }
  if (exitCode !== 0) {
    throw new Error(`codex exec failed (exit ${exitCode})`);
  }
  const output = fs.readFileSync(outputPath, "utf8").trim();
  if (!output) throw new Error("Codex CLI returned empty output");
  const usage = parseCodexTokenUsageFromLog(logPath);
  return { text: output, usage };
}

export async function generateAndStoreHandoff(params: {
  runId: string;
  projectId: string;
  outcome: RunOutcome;
  log?: (line: string) => void;
}): Promise<void> {
  const log = params.log ?? (() => undefined);
  try {
    const artifacts = gatherRunArtifacts({
      runId: params.runId,
      projectId: params.projectId,
      outcome: params.outcome,
      log,
    });
    if (!artifacts) return;

    const project = findProjectById(params.projectId);
    if (!project) {
      log("handoff: project not found while generating handoff");
      return;
    }

    const settings = resolveUtilitySettings().effective;
    const fallback = fallbackHandoff(artifacts);
    let handoffContent = fallback;
    let handoffUsage: { inputTokens: number; outputTokens: number } | null = null;
    let model = CLAUDE_HANDOFF_MODEL;

    try {
      const prompt = buildHandoffPrompt(artifacts);
      let text = "";
      if (settings.provider === "codex") {
        model = settings.model.trim() || DEFAULT_CODEX_MODEL;
        const result = await runCodexPrompt({
          prompt,
          projectPath: project.path,
          model,
          cliPath: settings.cliPath,
        });
        handoffUsage = result.usage;
        text = result.text;
      } else {
        model = settings.model.trim() || CLAUDE_HANDOFF_MODEL;
        const result = await generateHandoff({
          prompt,
          projectPath: project.path,
          model,
          cliPath: settings.cliPath,
        });
        handoffUsage = result.usage;
        text = result.text;
      }
      const parsed = parseHandoffOutput(text);
      handoffContent = normalizeHandoffContent(parsed, fallback);
    } catch (err) {
      log(`handoff: ${settings.provider} failed, using fallback: ${String(err)}`);
      handoffContent = fallback;
    }
    recordCostEntry({
      projectId: params.projectId,
      runId: params.runId,
      category: "handoff",
      model,
      usage: handoffUsage,
      description: "handoff generation",
    });

    const activeShift = getActiveShift(params.projectId);
    const handoff = createShiftHandoff({
      projectId: params.projectId,
      shiftId: activeShift?.id ?? null,
      input: {
        ...handoffContent,
        agent_id: "auto-handoff-generator",
        duration_minutes: artifacts.duration_minutes,
      },
    });

    if (activeShift) {
      // Only auto-complete if the shift has expired
      // If still within timeout, let the shift agent continue working
      const now = new Date();
      const expiresAt = activeShift.expires_at ? new Date(activeShift.expires_at) : null;
      const isExpired = expiresAt && now >= expiresAt;

      if (isExpired) {
        const updated = updateShift(activeShift.id, {
          status: "auto_completed",
          completed_at: now.toISOString(),
          handoff_id: handoff.id,
        });
        if (!updated) {
          log(`handoff: failed to update shift ${activeShift.id}`);
        }
        log(`handoff: auto-completed expired shift ${activeShift.id}`);
      } else {
        // Shift still active - just attach the handoff without completing
        const updated = updateShift(activeShift.id, {
          handoff_id: handoff.id,
        });
        if (updated) {
          log(`handoff: attached to active shift ${activeShift.id} (not auto-completing)`);
        }
      }
    }
  } catch (err) {
    log(`handoff: unexpected error: ${String(err)}`);
  }
}
