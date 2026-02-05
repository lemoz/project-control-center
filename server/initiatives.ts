import crypto from "crypto";
import { execFile, spawn } from "child_process";
import fs from "fs";
import path from "path";
import { promisify } from "util";
import { z } from "zod";
import { getClaudeCliPath, getCodexCliPath, getProcessEnv } from "./config.js";
import {
  findProjectById,
  listWorkOrdersByTag,
  type Initiative,
  type InitiativeMilestone,
  type ProjectRow,
} from "./db.js";
import { listWorkOrders } from "./work_orders.js";
import { parseDependencyRef } from "./work_order_dependencies.js";
import { resolveUtilitySettings } from "./settings.js";
import { buildInitiativePlanPrompt } from "./prompts/initiative_plan.js";

const execFileAsync = promisify(execFile);

const DEFAULT_CODEX_MODEL = "gpt-5.3-codex";
const CODEX_REASONING_EFFORT_CONFIG = 'model_reasoning_effort="xhigh"';
const CLAUDE_PLAN_MODEL = "claude-3-5-sonnet-20241022";
const CLAUDE_TIMEOUT_MS = 60_000;
const CODEX_TIMEOUT_MS = 60_000;
const IN_PROGRESS_STATUSES = new Set(["building", "ai_review", "you_review"]);

export type InitiativeSuggestion = {
  project_id: string;
  suggested_title: string;
  suggested_goal: string;
  suggested_acceptance_criteria: string[];
  suggested_dependencies: string[];
  estimated_hours: number;
};

export type InitiativePlan = {
  initiative_id: string;
  generated_at: string;
  suggestions: InitiativeSuggestion[];
};

export type InitiativeProgress = Initiative & {
  involved_projects: string[];
  progress: {
    total_wos: number;
    done: number;
    in_progress: number;
    blocked: number;
  };
  total_wos: number;
  completed_wos: number;
  blocked_wos: number;
  critical_path: string[];
};

export type InitiativeProjectSuggestion = {
  project_id: string;
  suggestions: InitiativeSuggestion[];
};

type InitiativeWorkOrder = {
  key: string;
  project_id: string;
  work_order_id: string;
  status: string;
  depends_on: string[];
};

type InitiativePlanDraft = {
  suggestions: InitiativeSuggestion[];
};

const SuggestionSchema = z.object({
  project_id: z.string().min(1),
  suggested_title: z.string().min(1),
  suggested_goal: z.string().min(1),
  suggested_acceptance_criteria: z.array(z.string()).optional(),
  suggested_dependencies: z.array(z.string()).optional(),
  estimated_hours: z.union([z.number(), z.string()]).optional(),
});

const PlanSchema = z.object({
  suggestions: z.array(SuggestionSchema),
});

function codexCommand(cliPath?: string): string {
  return cliPath?.trim() || getCodexCliPath();
}

function claudeCommand(cliPath?: string): string {
  return cliPath?.trim() || getClaudeCliPath();
}

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

function initiativePlanSchema(): object {
  return {
    type: "object",
    additionalProperties: true,
    properties: {
      suggestions: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: true,
          properties: {
            project_id: { type: "string" },
            suggested_title: { type: "string" },
            suggested_goal: { type: "string" },
            suggested_acceptance_criteria: {
              type: "array",
              items: { type: "string" },
            },
            suggested_dependencies: {
              type: "array",
              items: { type: "string" },
            },
            estimated_hours: { type: "number" },
          },
        },
      },
    },
  };
}

function ensureInitiativePlanSchema(baseDir: string): string {
  ensureDir(baseDir);
  const schemaPath = path.join(baseDir, "initiative_plan.schema.json");
  fs.writeFileSync(schemaPath, `${JSON.stringify(initiativePlanSchema(), null, 2)}\n`, "utf8");
  return schemaPath;
}

function writeCodexLog(logPath: string, stdout: string, stderr: string): void {
  const lines = [stdout, stderr].filter(Boolean).join("\n").trimEnd();
  if (!lines) return;
  fs.writeFileSync(logPath, `${lines}\n`, "utf8");
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

const MIN_ESTIMATED_HOURS = 2;
const MAX_ESTIMATED_HOURS = 4;

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter(Boolean);
}

function normalizeEstimatedHours(value: unknown): number {
  let raw: number;
  if (typeof value === "number") {
    raw = value;
  } else if (typeof value === "string") {
    raw = Number(value);
  } else {
    raw = NaN;
  }
  if (!Number.isFinite(raw)) return MIN_ESTIMATED_HOURS;
  if (raw < MIN_ESTIMATED_HOURS) return MIN_ESTIMATED_HOURS;
  if (raw > MAX_ESTIMATED_HOURS) return MAX_ESTIMATED_HOURS;
  return raw;
}

function normalizePlanDraft(
  raw: unknown,
  allowedProjectIds: Set<string>
): InitiativePlanDraft | null {
  const parsed = PlanSchema.safeParse(raw);
  if (!parsed.success) return null;
  const suggestions = parsed.data.suggestions
    .map((suggestion) => {
      const projectId = suggestion.project_id.trim();
      if (!projectId || !allowedProjectIds.has(projectId)) return null;
      const title = suggestion.suggested_title.trim();
      const goal = suggestion.suggested_goal.trim();
      if (!title || !goal) return null;
      const acceptance = normalizeStringList(
        suggestion.suggested_acceptance_criteria
      );
      const dependencies = normalizeStringList(suggestion.suggested_dependencies);
      if (!acceptance.length) {
        acceptance.push(`Delivers: ${goal}`);
      }
      const estimatedHours = normalizeEstimatedHours(suggestion.estimated_hours);
      return {
        project_id: projectId,
        suggested_title: title,
        suggested_goal: goal,
        suggested_acceptance_criteria: acceptance,
        suggested_dependencies: dependencies,
        estimated_hours: estimatedHours,
      };
    })
    .filter(Boolean) as InitiativeSuggestion[];
  return { suggestions };
}

function parsePlanOutput(
  text: string,
  allowedProjectIds: Set<string>
): InitiativePlanDraft | null {
  const candidate = extractJsonCandidate(text);
  if (!candidate) return null;
  try {
    const parsed = JSON.parse(candidate) as unknown;
    return normalizePlanDraft(parsed, allowedProjectIds);
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

async function runClaudePrompt(params: {
  prompt: string;
  projectPath: string;
  model: string;
  cliPath?: string;
}): Promise<string> {
  const command = claudeCommand(params.cliPath);
  const result = await execFileAsync(
    command,
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
    return stdout;
  }
  const text = extractClaudeText(parsed);
  if (text && text.trim()) return text.trim();
  return stdout;
}

async function runCodexPrompt(params: {
  prompt: string;
  projectPath: string;
  model: string;
  cliPath?: string;
}): Promise<string> {
  const baseDir = path.join(params.projectPath, ".system", "utility");
  ensureDir(baseDir);
  const schemaPath = ensureInitiativePlanSchema(baseDir);
  const id = crypto.randomUUID();
  const outputPath = path.join(baseDir, `initiative-plan-${id}.output.txt`);
  const logPath = path.join(baseDir, `initiative-plan-${id}.codex.jsonl`);
  const args = [
    "--ask-for-approval",
    "never",
    "exec",
    "--json",
    "--model",
    params.model,
    "-c",
    CODEX_REASONING_EFFORT_CONFIG,
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
  return output;
}

function buildFallbackPlanDraft(
  initiative: Initiative,
  projects: ProjectRow[]
): InitiativePlanDraft {
  const suggestions: InitiativeSuggestion[] = projects.map((project) => ({
    project_id: project.id,
    suggested_title: "Draft initiative work breakdown",
    suggested_goal:
      "Identify WO-sized tasks, dependencies, and estimates for this initiative.",
    suggested_acceptance_criteria: [
      "List candidate work orders with dependencies for this repo.",
    ],
    suggested_dependencies: [],
    estimated_hours: MIN_ESTIMATED_HOURS,
  }));
  return { suggestions };
}

export function initiativeTag(initiativeId: string): string {
  return `initiative:${initiativeId}`;
}

export function coerceInitiativePlanInput(
  raw: unknown,
  initiativeId: string,
  allowedProjectIds: string[]
): InitiativePlan | null {
  if (!raw) return null;
  let candidate: unknown = raw;
  if (typeof raw === "string") {
    try {
      candidate = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  const draft = normalizePlanDraft(candidate, new Set(allowedProjectIds));
  if (!draft) return null;
  return {
    initiative_id: initiativeId,
    generated_at: new Date().toISOString(),
    suggestions: draft.suggestions,
  };
}

function detectProjectTechStack(projectPath: string): string {
  const hasFile = (fileName: string) => fs.existsSync(path.join(projectPath, fileName));
  const labels = new Set<string>();
  const hasNextConfig =
    hasFile("next.config.js") || hasFile("next.config.ts") || hasFile("next.config.mjs");
  if (hasNextConfig) labels.add("Next.js");
  if (hasFile("package.json")) labels.add("Node.js");
  if (hasFile("requirements.txt") || hasFile("pyproject.toml") || hasFile("poetry.lock")) {
    labels.add("Python");
  }
  if (hasFile("go.mod")) labels.add("Go");
  if (hasFile("Cargo.toml")) labels.add("Rust");
  if (hasFile("Gemfile")) labels.add("Ruby");
  if (hasFile("pom.xml") || hasFile("build.gradle")) labels.add("Java");
  if (hasFile("mix.exs")) labels.add("Elixir");
  if (labels.size === 0) return "unknown";
  return Array.from(labels).join(", ");
}

function listRecentWorkOrderTitles(projectPath: string, limit = 3): string[] {
  try {
    const workOrders = listWorkOrders(projectPath);
    return workOrders
      .slice()
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
      .slice(0, limit)
      .map((wo) => wo.title);
  } catch {
    return [];
  }
}

export async function generateInitiativePlan(params: {
  initiative: Initiative;
  projects: ProjectRow[];
  projectPath?: string;
  guidance?: string | null;
}): Promise<InitiativePlan> {
  const settings = resolveUtilitySettings().effective;
  const allowedProjectIds = new Set(params.projects.map((project) => project.id));
  const prompt = buildInitiativePlanPrompt({
    initiative: params.initiative,
    projects: params.projects.map((project) => ({
      id: project.id,
      name: project.name,
      description: project.description,
      path: project.path,
      tech_stack: detectProjectTechStack(project.path),
      recent_wos: listRecentWorkOrderTitles(project.path),
    })),
    guidance: params.guidance ?? null,
  });
  const fallback = buildFallbackPlanDraft(params.initiative, params.projects);
  const projectPath =
    params.projectPath ?? params.projects[0]?.path ?? process.cwd();

  let draft: InitiativePlanDraft | null = null;
  try {
    if (settings.provider === "codex") {
      const model = settings.model.trim() || DEFAULT_CODEX_MODEL;
      const text = await runCodexPrompt({
        prompt,
        projectPath,
        model,
        cliPath: settings.cliPath,
      });
      draft = parsePlanOutput(text, allowedProjectIds);
    } else {
      const model = settings.model.trim() || CLAUDE_PLAN_MODEL;
      const text = await runClaudePrompt({
        prompt,
        projectPath,
        model,
        cliPath: settings.cliPath,
      });
      draft = parsePlanOutput(text, allowedProjectIds);
    }
  } catch {
    draft = null;
  }

  if (!draft || draft.suggestions.length === 0) {
    draft = fallback;
  }

  return {
    initiative_id: params.initiative.id,
    generated_at: new Date().toISOString(),
    suggestions: draft.suggestions,
  };
}

function buildInitiativeWorkOrders(initiative: Initiative): InitiativeWorkOrder[] {
  const items: InitiativeWorkOrder[] = [];
  const tag = initiativeTag(initiative.id).toLowerCase();
  for (const projectId of initiative.projects) {
    const project = findProjectById(projectId);
    if (!project) continue;
    const workOrders = listWorkOrdersByTag(project.id, tag);
    for (const wo of workOrders) {
      items.push({
        key: `${projectId}:${wo.work_order_id}`,
        project_id: projectId,
        work_order_id: wo.work_order_id,
        status: wo.status,
        depends_on: wo.depends_on,
      });
    }
  }
  return items;
}

function resolveMilestoneStatus(
  milestone: InitiativeMilestone,
  byKey: Map<string, InitiativeWorkOrder>,
  byId: Map<string, InitiativeWorkOrder[]>
): InitiativeMilestone {
  const resolved: InitiativeWorkOrder[] = [];
  for (const ref of milestone.wos) {
    const trimmed = ref.trim();
    if (!trimmed) continue;
    if (trimmed.includes(":")) {
      const [projectId, woId] = trimmed.split(":").map((chunk) => chunk.trim());
      if (!projectId || !woId) continue;
      const match = byKey.get(`${projectId}:${woId}`);
      if (match) resolved.push(match);
      continue;
    }
    const matches = byId.get(trimmed) ?? [];
    if (matches.length === 1) resolved.push(matches[0]);
  }

  if (resolved.length === 0) {
    return { ...milestone, status: "pending" };
  }
  const allDone = resolved.every((entry) => entry.status === "done");
  if (allDone) return { ...milestone, status: "completed" };
  const anyBlocked = resolved.some((entry) => entry.status === "blocked");
  if (anyBlocked) return { ...milestone, status: "at_risk" };
  return { ...milestone, status: "pending" };
}

function buildCriticalPath(
  initiative: Initiative,
  workOrders: InitiativeWorkOrder[]
): string[] {
  const remaining = workOrders.filter((wo) => wo.status !== "done");
  const byKey = new Map(remaining.map((entry) => [entry.key, entry]));
  const depsByKey = new Map<string, string[]>();

  for (const wo of remaining) {
    const deps: string[] = [];
    for (const dep of wo.depends_on) {
      const parsed = parseDependencyRef(dep, wo.project_id);
      const depKey = `${parsed.projectId}:${parsed.workOrderId}`;
      if (byKey.has(depKey)) deps.push(depKey);
    }
    depsByKey.set(wo.key, deps);
  }

  const memo = new Map<string, string[]>();
  const visiting = new Set<string>();

  const dfs = (key: string): string[] => {
    const cached = memo.get(key);
    if (cached) return cached;
    if (visiting.has(key)) return [key];
    visiting.add(key);
    let best: string[] = [key];
    for (const depKey of depsByKey.get(key) ?? []) {
      const candidate = [...dfs(depKey), key];
      if (candidate.length > best.length) best = candidate;
    }
    visiting.delete(key);
    memo.set(key, best);
    return best;
  };

  let longest: string[] = [];
  for (const key of byKey.keys()) {
    const path = dfs(key);
    if (path.length > longest.length) longest = path;
  }

  if (longest.length === 0) return [];
  const useProjectPrefix = initiative.projects.length > 1;
  return longest.map((entry) => {
    if (useProjectPrefix) return entry;
    const parts = entry.split(":");
    return parts.length > 1 ? parts.slice(1).join(":") : entry;
  });
}

export function buildInitiativeProgress(initiative: Initiative): InitiativeProgress {
  const workOrders = buildInitiativeWorkOrders(initiative);
  const total = workOrders.length;
  const completed = workOrders.filter((wo) => wo.status === "done").length;
  const inProgress = workOrders.filter((wo) =>
    IN_PROGRESS_STATUSES.has(wo.status)
  ).length;
  const blocked = workOrders.filter((wo) => wo.status === "blocked").length;

  const byKey = new Map(workOrders.map((entry) => [entry.key, entry]));
  const byId = new Map<string, InitiativeWorkOrder[]>();
  for (const entry of workOrders) {
    const list = byId.get(entry.work_order_id);
    if (list) {
      list.push(entry);
    } else {
      byId.set(entry.work_order_id, [entry]);
    }
  }

  const milestones = initiative.milestones.map((milestone) =>
    resolveMilestoneStatus(milestone, byKey, byId)
  );

  return {
    ...initiative,
    involved_projects: initiative.projects,
    progress: {
      total_wos: total,
      done: completed,
      in_progress: inProgress,
      blocked,
    },
    milestones,
    total_wos: total,
    completed_wos: completed,
    blocked_wos: blocked,
    critical_path: buildCriticalPath(initiative, workOrders),
  };
}

export function groupPlanSuggestionsByProject(plan: InitiativePlan): InitiativeProjectSuggestion[] {
  const byProject = new Map<string, InitiativeProjectSuggestion>();
  for (const suggestion of plan.suggestions) {
    let bucket = byProject.get(suggestion.project_id);
    if (!bucket) {
      bucket = { project_id: suggestion.project_id, suggestions: [] };
      byProject.set(suggestion.project_id, bucket);
    }
    bucket.suggestions.push(suggestion);
  }
  return Array.from(byProject.values());
}
