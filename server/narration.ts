import crypto from "crypto";
import { execFile, spawn } from "child_process";
import fs from "fs";
import path from "path";
import { promisify } from "util";
import { findProjectById, getRunById, type RunRow } from "./db.js";
import {
  extractTokenUsageFromClaudeResponse,
  parseCodexTokenUsageFromLog,
  recordCostEntry,
  type TokenUsage,
} from "./cost_tracking.js";
import { resolveUtilitySettings } from "./settings.js";
import { listWorkOrders, type WorkOrder } from "./work_orders.js";
import {
  buildNarrationPrompt,
  type NarrationPromptInput,
  type NarrationRunContext,
} from "./prompts/narration.js";

const execFileAsync = promisify(execFile);

const DEFAULT_CODEX_MODEL = "gpt-5.2-codex";
const CLAUDE_NARRATION_MODEL = "claude-3-5-sonnet-20241022";
const CODEX_TIMEOUT_MS = 20_000;
const CLAUDE_TIMEOUT_MS = 20_000;
const RATE_LIMIT_MS = 30_000;
const MAX_EVENTS = 6;
const MAX_ACTIVE_RUNS = 6;
const MAX_RECENT_NARRATIONS = 6;
const MAX_NARRATION_CHARS = 600;

let lastNarrationAt = 0;
let narrationInFlight = false;
const recentNarrationCache: string[] = [];

export type NarrationEventType =
  | "run_started"
  | "phase_change"
  | "run_completed"
  | "escalation"
  | "periodic";

export type NarrationEventInput = {
  type: NarrationEventType;
  runId?: string | null;
  workOrderId?: string | null;
  phase?: string | null;
  status?: string | null;
  escalationSummary?: string | null;
  activeCount?: number | null;
};

export type NarrationRequest = {
  primaryEvent: NarrationEventInput;
  events: NarrationEventInput[];
  activeRunIds: string[];
  recentNarrations: string[];
};

export type NarrationResult =
  | { ok: true; text: string; provider: string; model: string }
  | { ok: false; status: number; error: string; retryAfterMs?: number };

type RunContext = NarrationRunContext & { projectId: string; projectPath: string };

const EVENT_TYPE_SET: Set<NarrationEventType> = new Set([
  "run_started",
  "phase_change",
  "run_completed",
  "escalation",
  "periodic",
]);

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

function codexCommand(cliPath?: string): string {
  return cliPath?.trim() || process.env.CONTROL_CENTER_CODEX_PATH || "codex";
}

function claudeCommand(cliPath?: string): string {
  return cliPath?.trim() || process.env.CONTROL_CENTER_CLAUDE_PATH || "claude";
}

function writeCodexLog(logPath: string, stdout: string, stderr: string): void {
  const lines = [stdout, stderr].filter(Boolean).join("\n").trimEnd();
  if (!lines) return;
  fs.writeFileSync(logPath, `${lines}\n`, "utf8");
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
        if (typeof text === "string") parts.push(text);
      }
    }
    const combined = parts.join("");
    return combined.trim() ? combined : null;
  }
  return null;
}

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function clampText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 3)).trimEnd()}...`;
}

function clampSentences(text: string, maxSentences = 2): string {
  const matches = text.match(/[^.!?]+[.!?]*/g);
  if (!matches) return text;
  const limited = matches.slice(0, maxSentences).join(" ").trim();
  return limited || text;
}

function normalizeNarrationOutput(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  let cleaned = trimmed;
  const quoted =
    (cleaned.startsWith("\"") && cleaned.endsWith("\"")) ||
    (cleaned.startsWith("'") && cleaned.endsWith("'"));
  if (quoted) {
    cleaned = cleaned.slice(1, -1).trim();
  }
  cleaned = cleaned.replace(/\s+/g, " ").trim();
  const withSentences = clampSentences(cleaned, 4);
  const clamped = clampText(withSentences, MAX_NARRATION_CHARS);
  return clamped.trim() ? clamped : null;
}

function isRedundant(text: string, recent: string[]): boolean {
  const normalized = normalizeText(text);
  if (!normalized) return true;
  for (const entry of recent) {
    const prior = normalizeText(entry);
    if (!prior) continue;
    if (normalized === prior) return true;
    if (normalized.length >= 40 && (normalized.includes(prior) || prior.includes(normalized))) {
      return true;
    }
  }
  return false;
}

function readString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function readNumber(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value;
}

function readStringArray(value: unknown, limit: number): string[] {
  if (!Array.isArray(value)) return [];
  const items: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") continue;
    const trimmed = entry.trim();
    if (!trimmed) continue;
    items.push(trimmed);
    if (items.length >= limit) break;
  }
  return items;
}

function normalizeEvent(raw: unknown): NarrationEventInput | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const type = readString(record.type);
  if (!type || !EVENT_TYPE_SET.has(type as NarrationEventType)) return null;
  return {
    type: type as NarrationEventType,
    runId: readString(record.runId),
    workOrderId: readString(record.workOrderId),
    phase: readString(record.phase),
    status: readString(record.status),
    escalationSummary: readString(record.escalationSummary),
    activeCount: readNumber(record.activeCount),
  };
}

function normalizeRequest(raw: unknown): NarrationRequest | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const eventsRaw = Array.isArray(record.events) ? record.events : [];
  const events = eventsRaw
    .map((event) => normalizeEvent(event))
    .filter((event): event is NarrationEventInput => Boolean(event))
    .slice(0, MAX_EVENTS);
  if (!events.length) return null;

  const primaryRaw =
    record.primaryEvent ?? record.primary_event ?? record.primary ?? events[0];
  const primaryEvent = normalizeEvent(primaryRaw) ?? events[0];

  const activeRunIds = readStringArray(
    record.activeRunIds ?? record.active_run_ids ?? [],
    MAX_ACTIVE_RUNS
  );
  const recentNarrations = readStringArray(
    record.recentNarrations ?? record.recent_narrations ?? [],
    MAX_RECENT_NARRATIONS
  );

  return {
    primaryEvent,
    events,
    activeRunIds,
    recentNarrations,
  };
}

function formatPhase(phase?: string | null): string {
  switch (phase) {
    case "queued":
      return "queued";
    case "builder":
      return "building";
    case "blocked":
      return "waiting for input";
    case "review":
      return "in review";
    case "tests":
      return "running tests";
    case "ready_for_review":
      return "ready for review";
    default:
      return "in progress";
  }
}

function formatStatus(status?: string | null): string {
  switch (status) {
    case "merged":
      return "merged";
    case "you_review":
      return "ready for review";
    case "baseline_failed":
      return "baseline failed";
    case "merge_conflict":
      return "merge conflict";
    case "failed":
      return "failed";
    case "canceled":
      return "canceled";
    case "superseded":
      return "superseded";
    default:
      return status ?? "complete";
  }
}

function phaseForStatus(status: string): string {
  switch (status) {
    case "queued":
      return "queued";
    case "building":
      return "builder";
    case "waiting_for_input":
      return "blocked";
    case "ai_review":
      return "review";
    case "testing":
      return "tests";
    case "you_review":
      return "ready_for_review";
    default:
      return "unknown";
  }
}

function extractEscalationSummary(payload: Record<string, unknown>): string | null {
  const summary =
    typeof payload.summary === "string" ? payload.summary.trim() : "";
  const need =
    typeof payload.what_i_need === "string" ? payload.what_i_need.trim() : "";
  const tried =
    typeof payload.what_i_tried === "string" ? payload.what_i_tried.trim() : "";
  return summary || need || tried || null;
}

function parseEscalationSummary(raw: string | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (typeof parsed === "string") {
      return parsed.trim() || null;
    }
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return extractEscalationSummary(parsed as Record<string, unknown>);
    }
  } catch {
    return trimmed;
  }
  return trimmed;
}

function resolveWorkOrderMap(projectId: string): Map<string, WorkOrder> {
  const project = findProjectById(projectId);
  if (!project) return new Map();
  const workOrders = listWorkOrders(project.path);
  return new Map(workOrders.map((workOrder) => [workOrder.id, workOrder]));
}

function resolveBlockedDependencies(
  workOrder: WorkOrder | null,
  workOrderMap: Map<string, WorkOrder>
): string[] {
  if (!workOrder || !workOrder.depends_on.length) return [];
  const blocked: string[] = [];
  for (const dep of workOrder.depends_on) {
    if (dep.includes(":")) continue;
    const depWorkOrder = workOrderMap.get(dep);
    if (depWorkOrder && depWorkOrder.status !== "done") {
      blocked.push(dep);
    }
  }
  return blocked;
}

function buildRunContext(run: RunRow, workOrderMap: Map<string, WorkOrder>): RunContext | null {
  const project = findProjectById(run.project_id);
  if (!project) return null;
  const workOrder = workOrderMap.get(run.work_order_id) ?? null;
  const escalationSummary = parseEscalationSummary(run.escalation);
  const blockedDependencies = resolveBlockedDependencies(workOrder, workOrderMap);
  const iteration = Math.max(1, run.iteration || 0, run.builder_iteration || 0);

  return {
    runId: run.id,
    workOrderId: run.work_order_id,
    workOrderTitle: workOrder?.title ?? null,
    workOrderGoal: workOrder?.goal ?? null,
    workOrderDependsOn: workOrder?.depends_on ?? [],
    blockedDependencies,
    status: run.status,
    phase: phaseForStatus(run.status),
    iteration,
    builderIteration: Math.max(1, run.builder_iteration || 0),
    escalationSummary,
    projectId: project.id,
    projectPath: project.path,
  };
}

function describeEvent(event: NarrationEventInput, runMap: Map<string, RunContext>): string {
  const run = event.runId ? runMap.get(event.runId) : null;
  const label =
    run?.workOrderTitle?.trim() ||
    run?.workOrderId ||
    event.workOrderId ||
    "work order";

  switch (event.type) {
    case "run_started":
      return `Run started for ${label}.`;
    case "phase_change":
      return `Phase shifted to ${formatPhase(event.phase)} for ${label}.`;
    case "run_completed":
      return `Run completed for ${label} (${formatStatus(event.status)}).`;
    case "escalation": {
      const summary = event.escalationSummary?.trim();
      return summary
        ? `Waiting for input on ${label}. ${summary}`
        : `Waiting for input on ${label}.`;
    }
    case "periodic": {
      const count = event.activeCount ?? 0;
      const plural = count === 1 ? "run is" : "runs are";
      return `${count} ${plural} active.`;
    }
    default:
      return "Work is in progress.";
  }
}

function stripProjectData(run: RunContext): NarrationRunContext {
  const { projectId: _projectId, projectPath: _projectPath, ...rest } = run;
  return rest;
}

async function runCodexPrompt(params: {
  prompt: string;
  projectPath: string;
  model: string;
  cliPath?: string;
}): Promise<{ text: string; usage: TokenUsage | null }> {
  const baseDir = path.join(params.projectPath, ".system", "utility");
  ensureDir(baseDir);
  const id = crypto.randomUUID();
  const outputPath = path.join(baseDir, `narration-${id}.output.txt`);
  const logPath = path.join(baseDir, `narration-${id}.codex.jsonl`);
  const args = [
    "--ask-for-approval",
    "never",
    "exec",
    "--json",
    "--model",
    params.model,
    "--sandbox",
    "read-only",
    "--output-last-message",
    outputPath,
    "--color",
    "never",
    "-",
  ];

  const child = spawn(codexCommand(params.cliPath), args, {
    cwd: params.projectPath,
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env },
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
  if (timedOut) throw new Error("codex exec timed out");
  if (exitCode !== 0) throw new Error(`codex exec failed (exit ${exitCode})`);

  const output = fs.readFileSync(outputPath, "utf8").trim();
  if (!output) throw new Error("Codex CLI returned empty output");
  const usage = parseCodexTokenUsageFromLog(logPath);
  return { text: output, usage };
}

async function runClaudePrompt(params: {
  prompt: string;
  projectPath: string;
  model: string;
  cliPath?: string;
}): Promise<{ text: string; usage: TokenUsage | null }> {
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

export async function generateNarration(raw: unknown): Promise<NarrationResult> {
  const request = normalizeRequest(raw);
  if (!request) {
    return { ok: false, status: 400, error: "invalid narration request" };
  }

  const now = Date.now();
  if (narrationInFlight) {
    return { ok: false, status: 429, error: "narration in flight" };
  }
  const sinceLast = now - lastNarrationAt;
  if (sinceLast < RATE_LIMIT_MS) {
    return {
      ok: false,
      status: 429,
      error: "rate limited",
      retryAfterMs: RATE_LIMIT_MS - sinceLast,
    };
  }

  const runIds = new Set<string>(request.activeRunIds);
  for (const event of request.events) {
    if (event.runId) runIds.add(event.runId);
  }

  const runContextMap = new Map<string, RunContext>();
  const workOrderMaps = new Map<string, Map<string, WorkOrder>>();
  for (const runId of runIds) {
    const run = getRunById(runId);
    if (!run) continue;
    if (!workOrderMaps.has(run.project_id)) {
      workOrderMaps.set(run.project_id, resolveWorkOrderMap(run.project_id));
    }
    const workOrderMap = workOrderMaps.get(run.project_id) ?? new Map();
    const context = buildRunContext(run, workOrderMap);
    if (context) {
      runContextMap.set(runId, context);
    }
  }

  const runContexts = Array.from(runContextMap.values());
  const promptNarrations =
    request.recentNarrations.length > 0 ? request.recentNarrations : recentNarrationCache;
  const promptInput: NarrationPromptInput = {
    activeRuns: runContexts.slice(0, MAX_ACTIVE_RUNS).map(stripProjectData),
    recentEvents: request.events.map((event) => describeEvent(event, runContextMap)),
    recentNarrations: promptNarrations,
    primaryEvent: describeEvent(request.primaryEvent, runContextMap),
  };

  const prompt = buildNarrationPrompt(promptInput);
  const focusRun =
    (request.primaryEvent.runId && runContextMap.get(request.primaryEvent.runId)) ||
    runContexts[0] ||
    null;
  const projectPath = focusRun?.projectPath ?? process.cwd();
  const projectId = focusRun?.projectId ?? null;
  const runId = focusRun?.runId ?? null;

  const settings = resolveUtilitySettings().effective;
  let model =
    settings.provider === "codex"
      ? settings.model.trim() || DEFAULT_CODEX_MODEL
      : settings.model.trim() || CLAUDE_NARRATION_MODEL;
  let usage: TokenUsage | null = null;

  narrationInFlight = true;
  lastNarrationAt = now;
  try {
    let text = "";
    if (settings.provider === "codex") {
      const result = await runCodexPrompt({
        prompt,
        projectPath,
        model,
        cliPath: settings.cliPath,
      });
      usage = result.usage;
      text = result.text;
    } else {
      const result = await runClaudePrompt({
        prompt,
        projectPath,
        model,
        cliPath: settings.cliPath,
      });
      usage = result.usage;
      text = result.text;
    }

    const normalized = normalizeNarrationOutput(text);
    if (!normalized) {
      return { ok: false, status: 502, error: "empty narration" };
    }

    const recent = [...request.recentNarrations, ...recentNarrationCache];
    if (isRedundant(normalized, recent)) {
      return { ok: false, status: 409, error: "duplicate narration" };
    }

    recentNarrationCache.push(normalized);
    while (recentNarrationCache.length > MAX_RECENT_NARRATIONS) {
      recentNarrationCache.shift();
    }

    if (projectId) {
      recordCostEntry({
        projectId,
        runId,
        category: "other",
        model,
        usage,
        description: "narration generation",
      });
    }

    return {
      ok: true,
      text: normalized,
      provider: settings.provider,
      model,
    };
  } catch (err) {
    return {
      ok: false,
      status: 502,
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    narrationInFlight = false;
  }
}
