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
import { parseDependencyRef } from "./work_order_dependencies.js";
import { resolveUtilitySettings } from "./settings.js";
import { buildInitiativePlanPrompt } from "./prompts/initiative_plan.js";

const execFileAsync = promisify(execFile);

const DEFAULT_CODEX_MODEL = "gpt-5.2-codex";
const CLAUDE_PLAN_MODEL = "claude-3-5-sonnet-20241022";
const CLAUDE_TIMEOUT_MS = 60_000;
const CODEX_TIMEOUT_MS = 60_000;

export type InitiativePlanItem = {
  title: string;
  description: string;
  depends_on: string[];
};

export type InitiativePlanProject = {
  project_id: string;
  items: InitiativePlanItem[];
};

export type InitiativePlanMilestone = {
  name: string;
  target_date: string;
  description: string;
  projects: InitiativePlanProject[];
};

export type InitiativePlan = {
  initiative_id: string;
  generated_at: string;
  milestones: InitiativePlanMilestone[];
};

export type InitiativeProgress = Initiative & {
  total_wos: number;
  completed_wos: number;
  blocked_wos: number;
  critical_path: string[];
};

export type InitiativeProjectSuggestion = {
  project_id: string;
  items: Array<{
    milestone: string;
    milestone_target: string;
    title: string;
    description: string;
    depends_on: string[];
  }>;
};

type InitiativeWorkOrder = {
  key: string;
  project_id: string;
  work_order_id: string;
  status: string;
  depends_on: string[];
};

type InitiativePlanDraft = {
  milestones: InitiativePlanMilestone[];
};

const PlanItemSchema = z.object({
  title: z.string().min(1),
  description: z.string().min(1),
  depends_on: z.array(z.string()).optional(),
});

const PlanProjectSchema = z.object({
  project_id: z.string().min(1),
  items: z.array(PlanItemSchema).optional(),
});

const PlanMilestoneSchema = z.object({
  name: z.string().min(1),
  target_date: z.string().min(1),
  description: z.string().optional(),
  projects: z.array(PlanProjectSchema).optional(),
});

const PlanSchema = z.object({
  milestones: z.array(PlanMilestoneSchema),
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
      milestones: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: true,
          properties: {
            name: { type: "string" },
            target_date: { type: "string" },
            description: { type: "string" },
            projects: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: true,
                properties: {
                  project_id: { type: "string" },
                  items: {
                    type: "array",
                    items: {
                      type: "object",
                      additionalProperties: true,
                      properties: {
                        title: { type: "string" },
                        description: { type: "string" },
                        depends_on: { type: "array", items: { type: "string" } },
                      },
                    },
                  },
                },
              },
            },
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

function normalizePlanDraft(
  raw: unknown,
  allowedProjectIds: Set<string>
): InitiativePlanDraft | null {
  const parsed = PlanSchema.safeParse(raw);
  if (!parsed.success) return null;
  const milestones = parsed.data.milestones
    .map((milestone) => {
      const name = milestone.name.trim();
      const targetDate = milestone.target_date.trim();
      if (!name || !targetDate) return null;
      const description = (milestone.description ?? "").trim();
      const projects = (milestone.projects ?? [])
        .map((project) => {
          const projectId = project.project_id.trim();
          if (!projectId || !allowedProjectIds.has(projectId)) return null;
          const items = (project.items ?? [])
            .map((item) => ({
              title: item.title.trim(),
              description: item.description.trim(),
              depends_on: (item.depends_on ?? [])
                .map((dep) => dep.trim())
                .filter(Boolean),
            }))
            .filter((item) => item.title && item.description);
          return { project_id: projectId, items };
        })
        .filter(Boolean) as InitiativePlanProject[];
      return { name, target_date: targetDate, description, projects };
    })
    .filter(Boolean) as InitiativePlanMilestone[];
  return { milestones };
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
  const milestones: InitiativePlanMilestone[] = [
    {
      name: "Initial scope and sequencing",
      target_date: initiative.target_date,
      description: "Define the slice of work needed to hit the target date.",
      projects: projects.map((project) => ({
        project_id: project.id,
        items: [
          {
            title: "Draft initiative work breakdown",
            description:
              "Propose WO-sized tasks, dependencies, and estimates for this initiative.",
            depends_on: [],
          },
        ],
      })),
    },
  ];
  return { milestones };
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
    milestones: draft.milestones,
  };
}

export async function generateInitiativePlan(params: {
  initiative: Initiative;
  projects: ProjectRow[];
  projectPath?: string;
}): Promise<InitiativePlan> {
  const settings = resolveUtilitySettings().effective;
  const allowedProjectIds = new Set(params.projects.map((project) => project.id));
  const prompt = buildInitiativePlanPrompt({
    initiative: params.initiative,
    projects: params.projects.map((project) => ({
      id: project.id,
      name: project.name,
      description: project.description,
    })),
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

  if (!draft || draft.milestones.length === 0) {
    draft = fallback;
  }

  return {
    initiative_id: params.initiative.id,
    generated_at: new Date().toISOString(),
    milestones: draft.milestones,
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
    milestones,
    total_wos: total,
    completed_wos: completed,
    blocked_wos: blocked,
    critical_path: buildCriticalPath(initiative, workOrders),
  };
}

export function groupPlanSuggestionsByProject(plan: InitiativePlan): InitiativeProjectSuggestion[] {
  const byProject = new Map<string, InitiativeProjectSuggestion>();
  for (const milestone of plan.milestones) {
    for (const project of milestone.projects) {
      if (!project.items.length) continue;
      let bucket = byProject.get(project.project_id);
      if (!bucket) {
        bucket = { project_id: project.project_id, items: [] };
        byProject.set(project.project_id, bucket);
      }
      for (const item of project.items) {
        bucket.items.push({
          milestone: milestone.name,
          milestone_target: milestone.target_date,
          title: item.title,
          description: item.description,
          depends_on: item.depends_on,
        });
      }
    }
  }
  return Array.from(byProject.values());
}
