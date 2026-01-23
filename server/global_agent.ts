import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";
import {
  createGlobalShiftHandoff,
  expireStaleGlobalShifts,
  findProjectById,
  getEscalationById,
  startGlobalShift,
  startShift,
  updateEscalation,
  updateGlobalShift,
  type CreateGlobalShiftHandoffInput,
  type GlobalShiftHandoff,
  type GlobalShiftRow,
  type ProjectRow,
  type ShiftHandoffDecision,
} from "./db.js";
import { ensureChatThread, createChatMessage } from "./chat_db.js";
import { loadDiscoveryConfig } from "./discovery.js";
import { buildGlobalContextResponse, type GlobalContextResponse } from "./global_context.js";
import {
  buildGlobalDecisionPrompt,
  type GlobalDecisionSessionContext,
  type GlobalAttentionAllocation,
} from "./prompts/global_decision.js";
import { syncAndListRepoSummaries, invalidateDiscoveryCache } from "./projects_catalog.js";
import { provideRunInput } from "./runner_agent.js";
import { stableRepoId } from "./utils.js";
import {
  getEscalationDeferral,
  getLastGlobalReportAt,
  getPreferredReviewDeferral,
  getUserPreferences,
} from "./user_preferences.js";

const DEFAULT_MAX_ITERATIONS = 1;
const DEFAULT_ATTENTION_MAX_PROJECTS = 6;
const GLOBAL_ESCALATION_CLAIMANT = "global_agent";

export type GlobalAgentDecision =
  | { action: "DELEGATE"; project_id: string; reason?: string }
  | {
      action: "RESOLVE";
      escalation_id: string;
      resolution: string | Record<string, unknown>;
      reason?: string;
    }
  | { action: "CREATE_PROJECT"; project: CreateProjectInput; reason?: string }
  | { action: "REPORT"; message: string; reason?: string }
  | { action: "WAIT"; reason?: string; retry_after_minutes?: number };

export type CreateProjectInput = {
  path: string;
  name?: string;
  id?: string;
  status?: ProjectRow["status"];
  priority?: number;
  init_git?: boolean;
};

type GlobalAgentActionResult = {
  action: GlobalAgentDecision["action"];
  ok: boolean;
  detail: string;
};

export type GlobalAgentLoopOptions = {
  agentType?: string;
  agentId?: string;
  timeoutMinutes?: number;
  maxIterations?: number;
  attention?: GlobalAttentionAllocation;
  claudePath?: string;
  cwd?: string;
  session?: GlobalDecisionSessionContext;
  decide?: (prompt: string) => Promise<string | GlobalAgentDecision>;
  onLog?: (line: string) => void;
};

export type GlobalAgentRunResult =
  | {
      ok: true;
      shift: GlobalShiftRow;
      handoff: GlobalShiftHandoff;
      actions: GlobalAgentActionResult[];
    }
  | {
      ok: false;
      error: string;
      activeShift: GlobalShiftRow;
    };

function logLine(cb: GlobalAgentLoopOptions["onLog"], line: string) {
  cb?.(line);
}

function resolveAttentionAllocation(
  overrides?: GlobalAttentionAllocation
): GlobalAttentionAllocation {
  const rawEnv = process.env.CONTROL_CENTER_GLOBAL_ATTENTION_MAX_PROJECTS;
  const envValue = rawEnv ? Number(rawEnv) : NaN;
  const envMax =
    Number.isFinite(envValue) && envValue > 0 ? Math.trunc(envValue) : undefined;
  return {
    maxProjects:
      overrides?.maxProjects ?? envMax ?? DEFAULT_ATTENTION_MAX_PROJECTS,
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

function readString(record: Record<string, unknown>, key: string): string | null {
  const raw = record[key];
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed ? trimmed : null;
}

function normalizeDecision(value: unknown): GlobalAgentDecision | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const actionRaw = readString(record, "action");
  const action = actionRaw ? actionRaw.toUpperCase() : "";
  if (!action) return null;

  switch (action) {
    case "DELEGATE": {
      const projectId = readString(record, "project_id");
      if (!projectId) return null;
      const reason = readString(record, "reason") ?? undefined;
      return { action: "DELEGATE", project_id: projectId, reason };
    }
    case "RESOLVE": {
      const escalationId = readString(record, "escalation_id");
      if (!escalationId) return null;
      const resolution =
        typeof record.resolution === "string"
          ? record.resolution
          : typeof record.resolution === "object" && record.resolution
            ? (record.resolution as Record<string, unknown>)
            : null;
      if (!resolution) return null;
      const reason = readString(record, "reason") ?? undefined;
      return {
        action: "RESOLVE",
        escalation_id: escalationId,
        resolution,
        reason,
      };
    }
    case "CREATE_PROJECT": {
      const project =
        typeof record.project === "object" && record.project
          ? (record.project as Record<string, unknown>)
          : record;
      const repoPath = readString(project, "path");
      if (!repoPath) return null;
      const name = readString(project, "name") ?? undefined;
      const id = readString(project, "id") ?? undefined;
      const statusRaw = readString(project, "status");
      const status =
        statusRaw === "active" || statusRaw === "blocked" || statusRaw === "parked"
          ? statusRaw
          : undefined;
      const priorityRaw =
        typeof project.priority === "number" && Number.isFinite(project.priority)
          ? Math.trunc(project.priority)
          : undefined;
      const initGit =
        typeof project.init_git === "boolean" ? project.init_git : undefined;
      const reason = readString(record, "reason") ?? undefined;
      return {
        action: "CREATE_PROJECT",
        project: {
          path: repoPath,
          name,
          id,
          status,
          priority: priorityRaw,
          init_git: initGit,
        },
        reason,
      };
    }
    case "REPORT": {
      const message = readString(record, "message");
      if (!message) return null;
      const reason = readString(record, "reason") ?? undefined;
      return { action: "REPORT", message, reason };
    }
    case "WAIT": {
      const reason = readString(record, "reason") ?? undefined;
      const retryRaw =
        typeof record.retry_after_minutes === "number" &&
        Number.isFinite(record.retry_after_minutes)
          ? Math.trunc(record.retry_after_minutes)
          : undefined;
      return { action: "WAIT", reason, retry_after_minutes: retryRaw };
    }
    default:
      return null;
  }
}

export function parseGlobalDecision(text: string): GlobalAgentDecision | null {
  const json = extractJsonCandidate(text);
  if (!json) return null;
  try {
    return normalizeDecision(JSON.parse(json));
  } catch {
    return null;
  }
}

async function decideWithClaude(options: {
  prompt: string;
  claudePath?: string;
  cwd?: string;
  onLog?: (line: string) => void;
}): Promise<string> {
  const command = options.claudePath?.trim() || "claude";
  const args = [
    "--dangerously-skip-permissions",
    "--allowedTools",
    "Read,Edit,Bash,Glob,Grep,WebFetch,WebSearch",
    "-p",
    options.prompt,
  ];
  logLine(options.onLog, `global-agent: invoking ${command}`);
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? process.cwd(),
    encoding: "utf8",
  });
  if (result.error) throw result.error;
  const status = result.status ?? 1;
  if (status !== 0) {
    const stderr = result.stderr ? String(result.stderr).trim() : "";
    const detail = stderr ? `: ${stderr}` : "";
    throw new Error(`claude exited ${status}${detail}`);
  }
  return result.stdout ? String(result.stdout) : "";
}

function toResolutionPayload(
  resolution: string | Record<string, unknown>
): string {
  if (typeof resolution === "string") {
    return JSON.stringify({ message: resolution });
  }
  return JSON.stringify(resolution);
}

function normalizeRunInputResolution(
  resolution: string | Record<string, unknown>
): Record<string, unknown> | null {
  if (typeof resolution === "string") {
    const trimmed = resolution.trim();
    if (!trimmed) return null;
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return null;
    }
    return null;
  }
  if (resolution && typeof resolution === "object" && !Array.isArray(resolution)) {
    return resolution;
  }
  return null;
}

function ensureDir(dir: string) {
  if (fs.existsSync(dir)) return;
  fs.mkdirSync(dir, { recursive: true });
}

function isPathWithinRoots(resolvedPath: string, roots: string[]): boolean {
  return roots.some((root) => {
    const resolvedRoot = path.resolve(root);
    const relative = path.relative(resolvedRoot, resolvedPath);
    return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
  });
}

function validateProjectPath(
  rawPath: string
): { ok: true; resolvedPath: string } | { ok: false; error: string } {
  const trimmed = rawPath.trim();
  if (!trimmed) return { ok: false, error: "path is required" };
  const segments = trimmed.split(/[\\/]+/).filter(Boolean);
  if (segments.includes("..")) {
    return { ok: false, error: "path traversal is not allowed" };
  }
  const resolvedPath = path.resolve(process.cwd(), trimmed);
  const config = loadDiscoveryConfig();
  if (!isPathWithinRoots(resolvedPath, config.roots)) {
    return { ok: false, error: "path must be within configured scan roots" };
  }
  return { ok: true, resolvedPath };
}

function escapeYamlString(value: string): string {
  return value.replace(/"/g, '\\"');
}

function createControlFile(params: {
  repoPath: string;
  name: string;
  id: string;
  status?: ProjectRow["status"];
  priority?: number;
}): void {
  const lines = [`id: ${params.id}`, `name: "${escapeYamlString(params.name)}"`];
  if (params.status) lines.push(`status: ${params.status}`);
  if (typeof params.priority === "number") lines.push(`priority: ${params.priority}`);
  fs.writeFileSync(path.join(params.repoPath, ".control.yml"), `${lines.join("\n")}\n`, "utf8");
}

export function createProjectFromSpec(spec: CreateProjectInput): {
  ok: true;
  projectId: string;
  path: string;
} | { ok: false; error: string } {
  const validatedPath = validateProjectPath(spec.path);
  if (!validatedPath.ok) return { ok: false, error: validatedPath.error };
  const resolvedPath = validatedPath.resolvedPath;
  if (fs.existsSync(resolvedPath)) {
    const stat = fs.statSync(resolvedPath);
    if (!stat.isDirectory()) {
      return { ok: false, error: "path exists and is not a directory" };
    }
  } else {
    ensureDir(resolvedPath);
  }

  const initGit = spec.init_git !== false;
  const gitDir = path.join(resolvedPath, ".git");
  if (initGit && !fs.existsSync(gitDir)) {
    const res = spawnSync("git", ["init"], { cwd: resolvedPath, encoding: "utf8" });
    if ((res.status ?? 1) !== 0) {
      const stderr = res.stderr ? String(res.stderr).trim() : "git init failed";
      return { ok: false, error: stderr };
    }
  }

  const controlPath = path.join(resolvedPath, ".control.yml");
  const controlAltPath = path.join(resolvedPath, ".control.yaml");
  const hasControl = fs.existsSync(controlPath) || fs.existsSync(controlAltPath);
  if (!hasControl) {
    const id = spec.id?.trim() || stableRepoId(resolvedPath);
    const name = spec.name?.trim() || path.basename(resolvedPath);
    createControlFile({
      repoPath: resolvedPath,
      id,
      name,
      status: spec.status,
      priority: spec.priority,
    });
  }

  invalidateDiscoveryCache();
  const summaries = syncAndListRepoSummaries({ forceRescan: true });
  const resolvedSummary =
    summaries.find((entry) => path.resolve(entry.path) === resolvedPath) ??
    (spec.id ? summaries.find((entry) => entry.id === spec.id) : undefined);
  if (!resolvedSummary) {
    return { ok: false, error: "project not discovered; check scan roots" };
  }
  return { ok: true, projectId: resolvedSummary.id, path: resolvedSummary.path };
}

async function executeDecision(
  decision: GlobalAgentDecision,
  options: GlobalAgentLoopOptions
): Promise<GlobalAgentActionResult> {
  switch (decision.action) {
    case "DELEGATE": {
      const project = findProjectById(decision.project_id);
      if (!project) {
        return { action: "DELEGATE", ok: false, detail: "project not found" };
      }
      const result = startShift({
        projectId: project.id,
        agentType: options.agentType ?? "global_agent",
        agentId: options.agentId ?? GLOBAL_ESCALATION_CLAIMANT,
      });
      if (result.ok) {
        return {
          action: "DELEGATE",
          ok: true,
          detail: `started shift for ${project.name}`,
        };
      }
      return {
        action: "DELEGATE",
        ok: true,
        detail: `shift already active for ${project.name}`,
      };
    }
    case "RESOLVE": {
      const escalation = getEscalationById(decision.escalation_id);
      if (escalation) {
        if (escalation.status === "resolved") {
          return {
            action: "RESOLVE",
            ok: true,
            detail: "escalation already resolved",
          };
        }
        if (
          escalation.status !== "pending" &&
          escalation.status !== "claimed" &&
          escalation.status !== "escalated_to_user"
        ) {
          return {
            action: "RESOLVE",
            ok: false,
            detail: `escalation not resolvable (${escalation.status})`,
          };
        }
        const resolvedAt = new Date().toISOString();
        let payload: string;
        try {
          payload = toResolutionPayload(decision.resolution);
        } catch {
          return {
            action: "RESOLVE",
            ok: false,
            detail: "resolution payload invalid",
          };
        }
        const updated = updateEscalation(escalation.id, {
          status: "resolved",
          claimed_by: escalation.claimed_by ?? GLOBAL_ESCALATION_CLAIMANT,
          resolution: payload,
          resolved_at: resolvedAt,
        });
        if (!updated) {
          return { action: "RESOLVE", ok: false, detail: "failed to resolve" };
        }
        return {
          action: "RESOLVE",
          ok: true,
          detail: `resolved escalation ${escalation.id}`,
        };
      }

      const inputs = normalizeRunInputResolution(decision.resolution);
      if (!inputs) {
        return {
          action: "RESOLVE",
          ok: false,
          detail: "run input resolution must be a JSON object",
        };
      }
      const provided = provideRunInput(decision.escalation_id, inputs);
      if (!provided.ok) {
        return { action: "RESOLVE", ok: false, detail: provided.error };
      }
      return {
        action: "RESOLVE",
        ok: true,
        detail: `provided run input for ${decision.escalation_id}`,
      };
    }
    case "CREATE_PROJECT": {
      const created = createProjectFromSpec(decision.project);
      if (!created.ok) {
        return {
          action: "CREATE_PROJECT",
          ok: false,
          detail: created.error,
        };
      }
      return {
        action: "CREATE_PROJECT",
        ok: true,
        detail: `created project ${created.projectId}`,
      };
    }
    case "REPORT": {
      const preferences = getUserPreferences();
      const preferredDeferral = getPreferredReviewDeferral({
        preferredReviewTime: preferences.preferred_review_time,
      });
      if (preferredDeferral) {
        return {
          action: "REPORT",
          ok: true,
          detail: `report deferred (${preferredDeferral.reason}, retry in ${preferredDeferral.retry_after_minutes}m)`,
        };
      }
      const deferral = getEscalationDeferral({
        preferences,
        lastEscalationAt: getLastGlobalReportAt(),
      });
      if (deferral) {
        return {
          action: "REPORT",
          ok: true,
          detail: `report deferred (${deferral.reason}, retry in ${deferral.retry_after_minutes}m)`,
        };
      }
      const thread = ensureChatThread({ scope: "global" });
      createChatMessage({
        threadId: thread.id,
        role: "assistant",
        content: decision.message,
        needsUserInput: true,
      });
      return { action: "REPORT", ok: true, detail: "reported to user" };
    }
    case "WAIT": {
      return { action: "WAIT", ok: true, detail: decision.reason ?? "waiting" };
    }
  }
}

function buildActionSummary(actions: GlobalAgentActionResult[]): string {
  if (!actions.length) return "No actions taken.";
  const details = actions.map((action) => action.detail).filter(Boolean);
  if (!details.length) return "Actions completed.";
  return `Actions: ${details.join("; ")}`;
}

function buildPendingItems(context: GlobalContextResponse): string[] {
  const items: string[] = [];
  for (const group of context.communications_queue) {
    for (const entry of group.items) {
      items.push(`${group.intent} ${entry.communication_id} on ${entry.project_id}`);
    }
  }
  return items;
}

export async function runGlobalAgentShift(
  options: GlobalAgentLoopOptions = {}
): Promise<GlobalAgentRunResult> {
  const attention = resolveAttentionAllocation(options.attention);
  const result = startGlobalShift({
    agentType: options.agentType ?? "claude_cli",
    agentId: options.agentId ?? "global-agent",
    timeoutMinutes: options.timeoutMinutes,
    sessionId: options.session?.session_id,
    iterationIndex: options.session?.iteration_index ?? null,
  });
  if (!result.ok) {
    return {
      ok: false,
      error: "shift already active",
      activeShift: result.activeShift,
    };
  }
  const shift = result.shift;
  const startedAt = new Date(shift.started_at);
  const actions: GlobalAgentActionResult[] = [];
  const decisions: ShiftHandoffDecision[] = [];
  const maxIterations = Math.max(
    1,
    Math.trunc(options.maxIterations ?? DEFAULT_MAX_ITERATIONS)
  );
  let error: Error | null = null;
  let handoff: GlobalShiftHandoff | null = null;

  try {
    for (let i = 0; i < maxIterations; i += 1) {
      const context = buildGlobalContextResponse();
      const prompt = buildGlobalDecisionPrompt(context, {
        attention,
        session: options.session,
      });
      const decider = options.decide
        ? options.decide
        : async (value: string) =>
            decideWithClaude({
              prompt: value,
              claudePath: options.claudePath,
              cwd: options.cwd,
              onLog: options.onLog,
            });
      const decisionOutput = await decider(prompt);
      const decision =
        typeof decisionOutput === "string"
          ? parseGlobalDecision(decisionOutput)
          : decisionOutput;
      if (!decision) {
        actions.push({
          action: "WAIT",
          ok: false,
          detail: "decision parse failed",
        });
        break;
      }
      decisions.push({
        decision: decision.action,
        rationale: decision.reason ?? "global agent decision",
      });
      const actionResult = await executeDecision(decision, options);
      actions.push(actionResult);
      if (decision.action === "WAIT") break;
    }
  } catch (err) {
    error = err instanceof Error ? err : new Error("global agent shift failed");
  }

  let endContext: GlobalContextResponse | null = null;
  try {
    endContext = buildGlobalContextResponse();
  } catch (err) {
    if (!error) {
      error = err instanceof Error ? err : new Error("failed to build global context");
    }
  }

  const summary = error ? `Shift failed: ${error.message}` : buildActionSummary(actions);
  const durationMinutes = Math.max(
    0,
    Math.round((Date.now() - startedAt.getTime()) / 60_000)
  );
  const handoffInput: CreateGlobalShiftHandoffInput = {
    summary,
    actions_taken: actions.map((action) => action.detail),
    pending_items: endContext ? buildPendingItems(endContext) : [],
    project_state: endContext,
    decisions_made: decisions,
    agent_id: options.agentId ?? "global-agent",
    duration_minutes: durationMinutes,
  };

  try {
    handoff = createGlobalShiftHandoff({ shiftId: shift.id, input: handoffInput });
  } catch (err) {
    if (!error) {
      error = err instanceof Error ? err : new Error("failed to create handoff");
    }
  }

  const completedAt = new Date().toISOString();
  const updatedShift: GlobalShiftRow = {
    ...shift,
    status: error ? "failed" : "completed",
    completed_at: completedAt,
    handoff_id: handoff?.id ?? null,
    error: error ? error.message : null,
  };
  const updatedOk = updateGlobalShift(shift.id, {
    status: updatedShift.status,
    completed_at: updatedShift.completed_at,
    handoff_id: updatedShift.handoff_id,
    error: updatedShift.error,
  });
  if (!updatedOk && !error) {
    error = new Error("failed to update global shift");
    updatedShift.status = "failed";
    updatedShift.error = error.message;
  }

  expireStaleGlobalShifts();
  if (error || !handoff) {
    return {
      ok: false,
      error: error ? error.message : "handoff creation failed",
      activeShift: updatedShift,
    };
  }
  return { ok: true, shift: updatedShift, handoff, actions };
}
