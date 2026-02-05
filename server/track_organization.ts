import crypto from "crypto";
import fs from "fs";
import path from "path";
import { execFile, spawn } from "child_process";
import { promisify } from "util";
import { z } from "zod";
import {
  createTrack,
  findProjectById,
  listTracks,
  replaceWorkOrderTracks,
  updateTrack,
  type Track,
} from "./db.js";
import { getClaudeCliPath, getCodexCliPath, getProcessEnv } from "./config.js";
import { buildTrackOrganizationPrompt, type TrackOrganizationMode } from "./prompts/track_organization.js";
import { resolveUtilitySettings } from "./settings.js";
import { listWorkOrders, type WorkOrder } from "./work_orders.js";

const execFileAsync = promisify(execFile);

const DEFAULT_CODEX_MODEL = "gpt-5.3-codex";
const CODEX_REASONING_EFFORT_CONFIG = 'model_reasoning_effort="xhigh"';
const CLAUDE_MODEL = "claude-3-5-sonnet-20241022";
const CLAUDE_TIMEOUT_MS = 60_000;
const CODEX_TIMEOUT_MS = 60_000;
const TRACK_STATUS_SET = new Set(["active", "paused", "completed"]);
const TOP_LEVEL_TRACK_LIMIT = 8;

export type TrackSuggestion = {
  id: string;
  name: string;
  goal: string | null;
  status: "active" | "paused" | "completed";
  parent_track_id: string | null;
};

export type TrackAssignmentSuggestion = {
  wo_id: string;
  track_ids: string[];
};

export type TrackOrganizationSuggestion = {
  tracks: TrackSuggestion[];
  assignments: TrackAssignmentSuggestion[];
  recommendations: string[];
};

export type TrackOrganizationScope = {
  total_work_orders: number;
  unassigned_work_orders: number;
  assigned_work_orders: number;
};

export type TrackOrganizationResult = {
  mode: TrackOrganizationMode;
  scope: TrackOrganizationScope;
  suggestions: TrackOrganizationSuggestion;
  warnings: string[];
};

export type TrackOrganizationApplyResult = {
  created_tracks: Track[];
  updated_tracks: Track[];
  assignments_applied: number;
  assignments_cleared: number;
  warnings: string[];
};

type TrackOrganizationDraft = {
  tracks: TrackSuggestion[];
  assignments: TrackAssignmentSuggestion[];
  recommendations: string[];
};

const TrackSuggestionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  goal: z.string().nullable().optional(),
  status: z.enum(["active", "paused", "completed"]),
  parent_track_id: z.string().nullable().optional(),
});

const TrackAssignmentSchema = z.object({
  wo_id: z.string().min(1),
  track_ids: z.array(z.string().min(1)),
});

const TrackOrganizationSchema = z.object({
  tracks: z.array(TrackSuggestionSchema),
  assignments: z.array(TrackAssignmentSchema),
  recommendations: z.array(z.string()).optional(),
});

function ensureDir(dir: string): void {
  if (fs.existsSync(dir)) return;
  fs.mkdirSync(dir, { recursive: true });
}

function codexCommand(cliPath?: string): string {
  return cliPath?.trim() || getCodexCliPath();
}

function claudeCommand(cliPath?: string): string {
  return cliPath?.trim() || getClaudeCliPath();
}

function trackOrganizationSchema(): object {
  return {
    type: "object",
    additionalProperties: false,
    required: ["tracks", "assignments"],
    properties: {
      tracks: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["id", "name", "status"],
          properties: {
            id: { type: "string" },
            name: { type: "string" },
            goal: { type: ["string", "null"] },
            status: { type: "string", enum: ["active", "paused", "completed"] },
            parent_track_id: { type: ["string", "null"] },
          },
        },
      },
      assignments: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["wo_id", "track_ids"],
          properties: {
            wo_id: { type: "string" },
            track_ids: { type: "array", items: { type: "string" } },
          },
        },
      },
      recommendations: { type: "array", items: { type: "string" } },
    },
  };
}

function ensureTrackOrganizationSchema(baseDir: string): string {
  ensureDir(baseDir);
  const schemaPath = path.join(baseDir, "track-organization.schema.json");
  fs.writeFileSync(schemaPath, `${JSON.stringify(trackOrganizationSchema(), null, 2)}\n`, "utf8");
  return schemaPath;
}

function extractClaudeText(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const content = record.content;
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
  const schemaPath = ensureTrackOrganizationSchema(baseDir);
  const id = crypto.randomUUID();
  const outputPath = path.join(baseDir, `track-organization-${id}.output.txt`);
  const logPath = path.join(baseDir, `track-organization-${id}.codex.jsonl`);
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
      child.on("error", reject);
    });
  } finally {
    clearTimeout(timeoutId);
  }

  const output = fs.existsSync(outputPath)
    ? fs.readFileSync(outputPath, "utf8").trim()
    : stdout.trim();

  const logLines = [stdout, stderr].filter(Boolean).join("\n").trimEnd();
  if (logLines) {
    fs.writeFileSync(logPath, `${logLines}\n`, "utf8");
  }

  if (timedOut) {
    throw new Error("Codex prompt timed out");
  }
  if (exitCode !== 0 && !output) {
    throw new Error("Codex prompt failed");
  }
  return output || stdout.trim();
}

function normalizeMode(raw: unknown, fallback: TrackOrganizationMode): TrackOrganizationMode {
  if (raw === "initial" || raw === "incremental" || raw === "reorg") {
    return raw;
  }
  return fallback;
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

function normalizeTrackSuggestion(raw: TrackOrganizationDraft): TrackOrganizationSuggestion {
  const tracks = raw.tracks.map((track) => ({
    id: track.id.trim(),
    name: track.name.trim(),
    goal: track.goal ? track.goal.trim() : null,
    status: track.status,
    parent_track_id: track.parent_track_id ? track.parent_track_id.trim() : null,
  }));
  const assignments = raw.assignments.map((assignment) => ({
    wo_id: assignment.wo_id.trim(),
    track_ids: assignment.track_ids
      .map((id) => id.trim())
      .filter(Boolean),
  }));
  const recommendations = raw.recommendations
    ? raw.recommendations.map((item) => item.trim()).filter(Boolean)
    : [];
  return { tracks, assignments, recommendations };
}

function parseTrackOrganizationOutput(text: string): TrackOrganizationSuggestion | null {
  const candidate = extractJsonCandidate(text);
  if (!candidate) return null;
  try {
    const parsed = JSON.parse(candidate) as unknown;
    const result = TrackOrganizationSchema.safeParse(parsed);
    if (!result.success) return null;
    return normalizeTrackSuggestion({
      tracks: result.data.tracks,
      assignments: result.data.assignments,
      recommendations: result.data.recommendations ?? [],
    });
  } catch {
    return null;
  }
}

function isNewTrackId(id: string): boolean {
  return id.startsWith("new:");
}

function computeScope(workOrders: WorkOrder[]): TrackOrganizationScope {
  let assigned = 0;
  for (const wo of workOrders) {
    if (wo.trackIds.length > 0 || wo.trackId) assigned += 1;
  }
  return {
    total_work_orders: workOrders.length,
    assigned_work_orders: assigned,
    unassigned_work_orders: Math.max(0, workOrders.length - assigned),
  };
}

function countSuggestedTopLevel(tracks: TrackSuggestion[]): number {
  return tracks.filter((track) => !track.parent_track_id).length;
}

function countFinalTopLevelTracks(params: {
  existingTracks: Track[];
  suggestedTracks: TrackSuggestion[];
}): number {
  const existingIds = new Set(params.existingTracks.map((track) => track.id));
  const suggestedById = new Map<string, TrackSuggestion>();
  for (const track of params.suggestedTracks) {
    const id = track.id.trim();
    if (!id || suggestedById.has(id)) continue;
    suggestedById.set(id, {
      ...track,
      id,
      parent_track_id: track.parent_track_id ? track.parent_track_id.trim() : null,
    });
  }

  const validParentIds = new Set<string>([...existingIds, ...suggestedById.keys()]);
  const resolveParent = (parentId: string | null): string | null => {
    if (!parentId) return null;
    const trimmed = parentId.trim();
    if (!trimmed) return null;
    return validParentIds.has(trimmed) ? trimmed : null;
  };

  let topLevel = 0;
  for (const track of params.existingTracks) {
    const override = suggestedById.get(track.id);
    const parentId = override ? resolveParent(override.parent_track_id) : track.parentTrackId;
    if (!parentId) topLevel += 1;
  }

  for (const [id, track] of suggestedById) {
    if (existingIds.has(id)) continue;
    const parentId = resolveParent(track.parent_track_id);
    if (!parentId) topLevel += 1;
  }

  return topLevel;
}

function buildProposedParentMap(params: {
  existingTracks: Track[];
  suggestedTracks: TrackSuggestion[];
}): Map<string, string | null> {
  const existingIds = new Set(params.existingTracks.map((track) => track.id));
  const suggestedById = new Map<string, TrackSuggestion>();
  for (const track of params.suggestedTracks) {
    const id = track.id.trim();
    if (!id || suggestedById.has(id)) continue;
    if (!existingIds.has(id) && !isNewTrackId(id)) continue;
    suggestedById.set(id, {
      ...track,
      id,
      parent_track_id: track.parent_track_id ? track.parent_track_id.trim() : null,
    });
  }
  const validIds = new Set<string>([...existingIds, ...suggestedById.keys()]);
  const resolveParent = (parentId: string | null): string | null => {
    if (!parentId) return null;
    const trimmed = parentId.trim();
    if (!trimmed) return null;
    return validIds.has(trimmed) ? trimmed : null;
  };

  const parentById = new Map<string, string | null>();
  for (const track of params.existingTracks) {
    const override = suggestedById.get(track.id);
    const parentId = override
      ? resolveParent(override.parent_track_id)
      : resolveParent(track.parentTrackId ?? null);
    parentById.set(track.id, parentId);
  }

  for (const [id, track] of suggestedById) {
    if (existingIds.has(id)) continue;
    const parentId = resolveParent(track.parent_track_id);
    parentById.set(id, parentId);
  }

  return parentById;
}

function findTrackCycle(parentById: Map<string, string | null>): string[] | null {
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const stack: string[] = [];
  const indices = new Map<string, number>();

  const visit = (id: string): string[] | null => {
    if (visited.has(id)) return null;
    if (visiting.has(id)) {
      const start = indices.get(id) ?? 0;
      return stack.slice(start).concat(id);
    }
    visiting.add(id);
    indices.set(id, stack.length);
    stack.push(id);
    const parent = parentById.get(id);
    if (parent && parentById.has(parent)) {
      const cycle = visit(parent);
      if (cycle) return cycle;
    }
    visiting.delete(id);
    indices.delete(id);
    stack.pop();
    visited.add(id);
    return null;
  };

  for (const id of parentById.keys()) {
    const cycle = visit(id);
    if (cycle) return cycle;
  }
  return null;
}

export async function generateTrackOrganizationSuggestions(params: {
  projectId: string;
  mode?: TrackOrganizationMode;
}): Promise<TrackOrganizationResult> {
  const project = findProjectById(params.projectId);
  if (!project) {
    throw new Error("project not found");
  }
  const tracks = listTracks(project.id);
  const workOrders = listWorkOrders(project.path);
  const fallbackMode = tracks.length === 0 ? "initial" : "incremental";
  const mode = normalizeMode(params.mode, fallbackMode);
  const scope = computeScope(workOrders);

  const workOrdersForPrompt =
    mode === "incremental"
      ? workOrders.filter((wo) => wo.trackIds.length === 0 && !wo.trackId)
      : workOrders;

  const prompt = buildTrackOrganizationPrompt({
    mode,
    tracks,
    workOrders: workOrdersForPrompt,
  });

  const settings = resolveUtilitySettings().effective;
  const model = settings.model.trim() || (settings.provider === "codex" ? DEFAULT_CODEX_MODEL : CLAUDE_MODEL);
  const text =
    settings.provider === "codex"
      ? await runCodexPrompt({
          prompt,
          projectPath: project.path,
          model,
          cliPath: settings.cliPath,
        })
      : await runClaudePrompt({
          prompt,
          projectPath: project.path,
          model,
          cliPath: settings.cliPath,
        });

  const suggestions = parseTrackOrganizationOutput(text);
  if (!suggestions) {
    throw new Error("Failed to parse track organization output");
  }

  const warnings: string[] = [];
  const topLevel = countSuggestedTopLevel(suggestions.tracks);
  if (topLevel > TOP_LEVEL_TRACK_LIMIT) {
    throw new Error(`Suggested ${topLevel} top-level tracks (limit ${TOP_LEVEL_TRACK_LIMIT}).`);
  }
  const finalTopLevel = countFinalTopLevelTracks({
    existingTracks: tracks,
    suggestedTracks: suggestions.tracks,
  });
  if (finalTopLevel > TOP_LEVEL_TRACK_LIMIT) {
    throw new Error(
      `Top-level tracks would total ${finalTopLevel} after applying suggestions (limit ${TOP_LEVEL_TRACK_LIMIT}).`
    );
  }

  if (suggestions.assignments.length === 0) {
    warnings.push("No assignments were suggested.");
  }

  return { mode, scope, suggestions, warnings };
}

function mapTracksById(tracks: Track[]): Map<string, Track> {
  return new Map(tracks.map((track) => [track.id, track]));
}

function resolveParentId(
  parentId: string | null,
  idMap: Map<string, string>
): string | null {
  if (!parentId) return null;
  const trimmed = parentId.trim();
  if (!trimmed) return null;
  return idMap.get(trimmed) ?? null;
}

export function applyTrackOrganizationSuggestions(params: {
  projectId: string;
  mode: TrackOrganizationMode;
  suggestions: TrackOrganizationSuggestion;
}): TrackOrganizationApplyResult {
  const project = findProjectById(params.projectId);
  if (!project) {
    throw new Error("project not found");
  }
  const warnings: string[] = [];
  const parsed = TrackOrganizationSchema.safeParse(params.suggestions);
  if (!parsed.success) {
    throw new Error("Invalid track suggestions payload");
  }
  const normalizedSuggestions = normalizeTrackSuggestion({
    tracks: parsed.data.tracks,
    assignments: parsed.data.assignments,
    recommendations: parsed.data.recommendations ?? [],
  });
  const existingTracks = listTracks(project.id);
  const existingById = mapTracksById(existingTracks);
  const workOrders = listWorkOrders(project.path);
  const workOrdersById = new Map(workOrders.map((wo) => [wo.id, wo]));

  const trackBySuggestionId = new Map<string, TrackSuggestion>();
  for (const track of normalizedSuggestions.tracks) {
    if (!track.id.trim()) continue;
    if (!TRACK_STATUS_SET.has(track.status)) continue;
    if (trackBySuggestionId.has(track.id)) {
      warnings.push(`Duplicate track suggestion for ${track.id} ignored.`);
      continue;
    }
    trackBySuggestionId.set(track.id, {
      ...track,
      id: track.id.trim(),
      name: track.name.trim(),
      goal: track.goal ? track.goal.trim() : null,
      parent_track_id: track.parent_track_id ? track.parent_track_id.trim() : null,
    });
  }

  const suggestedTracks = Array.from(trackBySuggestionId.values());
  const finalTopLevel = countFinalTopLevelTracks({
    existingTracks,
    suggestedTracks,
  });
  if (finalTopLevel > TOP_LEVEL_TRACK_LIMIT) {
    throw new Error(
      `Top-level tracks would total ${finalTopLevel} after applying suggestions (limit ${TOP_LEVEL_TRACK_LIMIT}).`
    );
  }

  if (params.mode !== "incremental") {
    const validTrackIds = new Set<string>(existingTracks.map((track) => track.id));
    for (const track of suggestedTracks) {
      if (existingById.has(track.id) || isNewTrackId(track.id)) {
        validTrackIds.add(track.id);
      }
    }
    const assignmentsById = new Map(
      normalizedSuggestions.assignments.map((assignment) => [assignment.wo_id, assignment])
    );
    const missingAssignments: string[] = [];
    const invalidAssignments: string[] = [];
    for (const wo of workOrders) {
      const assignment = assignmentsById.get(wo.id);
      if (!assignment) {
        missingAssignments.push(wo.id);
        continue;
      }
      const mapped = assignment.track_ids
        .map((id) => id.trim())
        .filter((id) => validTrackIds.has(id));
      const unique = Array.from(new Set(mapped));
      if (unique.length === 0) {
        invalidAssignments.push(wo.id);
      }
    }
    if (missingAssignments.length > 0) {
      const sample = missingAssignments.slice(0, 8).join(", ");
      const suffix =
        missingAssignments.length > 8
          ? ` (+${missingAssignments.length - 8} more)`
          : "";
      throw new Error(
        `Non-incremental apply requires assignments for every work order. Missing ${missingAssignments.length}: ${sample}${suffix}`
      );
    }
    if (invalidAssignments.length > 0) {
      const sample = invalidAssignments.slice(0, 8).join(", ");
      const suffix =
        invalidAssignments.length > 8
          ? ` (+${invalidAssignments.length - 8} more)`
          : "";
      throw new Error(
        `Non-incremental apply requires at least one valid track for every work order. Invalid ${invalidAssignments.length}: ${sample}${suffix}`
      );
    }
  }

  const parentById = buildProposedParentMap({
    existingTracks,
    suggestedTracks,
  });
  for (const [id, parent] of parentById) {
    if (parent === id) {
      throw new Error(`Track ${id} cannot be parented to itself.`);
    }
  }
  const cycle = findTrackCycle(parentById);
  if (cycle) {
    throw new Error(`Track hierarchy contains a cycle: ${cycle.join(" -> ")}`);
  }

  const createdTracks: Track[] = [];
  const updatedTracks: Track[] = [];
  const suggestionIdToActual = new Map<string, string>();
  for (const track of existingTracks) {
    suggestionIdToActual.set(track.id, track.id);
  }

  const newTrackDefs = suggestedTracks.filter((track) => isNewTrackId(track.id));
  for (const track of newTrackDefs) {
    const parent =
      track.parent_track_id && !isNewTrackId(track.parent_track_id)
        ? track.parent_track_id
        : null;
    const created = createTrack({
      project_id: project.id,
      name: track.name,
      goal: track.goal,
      status: track.status,
      parent_track_id: parent,
    });
    suggestionIdToActual.set(track.id, created.id);
    createdTracks.push(created);
  }

  for (const track of suggestedTracks) {
    const actualId = suggestionIdToActual.get(track.id);
    if (!actualId) continue;
    const parentResolved = resolveParentId(track.parent_track_id, suggestionIdToActual);
    if (track.parent_track_id && !parentResolved) {
      warnings.push(`Parent track ${track.parent_track_id} not found for ${track.id}.`);
    }
    if (isNewTrackId(track.id)) {
      if (parentResolved) {
        const updated = updateTrack(project.id, actualId, {
          parentTrackId: parentResolved,
        });
        if (updated) updatedTracks.push(updated);
      }
      continue;
    }

    if (!existingById.has(actualId)) {
      warnings.push(`Track ${track.id} not found; skipping update.`);
      continue;
    }
    const updated = updateTrack(project.id, actualId, {
      name: track.name,
      goal: track.goal,
      status: track.status,
      parentTrackId: parentResolved,
    });
    if (updated) updatedTracks.push(updated);
  }

  let assignmentsApplied = 0;
  const assignedIds = new Set<string>();
  for (const assignment of normalizedSuggestions.assignments) {
    const workOrderId = assignment.wo_id.trim();
    if (!workOrdersById.has(workOrderId)) {
      warnings.push(`Work order ${workOrderId} not found; skipping assignment.`);
      continue;
    }
    const workOrder = workOrdersById.get(workOrderId);
    if (!workOrder) continue;
    if (
      params.mode === "incremental" &&
      (workOrder.trackIds.length > 0 || workOrder.trackId)
    ) {
      warnings.push(`Work order ${workOrderId} already assigned; skipping incremental update.`);
      continue;
    }
    const mapped = assignment.track_ids
      .map((id) => suggestionIdToActual.get(id.trim()) ?? null)
      .filter((id): id is string => typeof id === "string" && id.trim().length > 0);
    const unique = Array.from(new Set(mapped));
    if (unique.length === 0) {
      if (params.mode !== "incremental") {
        throw new Error(
          `Non-incremental apply requires at least one valid track for ${workOrderId}.`
        );
      }
      warnings.push(`Assignment for ${workOrderId} had no valid tracks.`);
      continue;
    }
    replaceWorkOrderTracks(project.id, workOrderId, unique);
    assignedIds.add(workOrderId);
    assignmentsApplied += 1;
  }

  let assignmentsCleared = 0;
  if (params.mode !== "incremental") {
    for (const wo of workOrders) {
      if (assignedIds.has(wo.id)) continue;
      if (wo.trackIds.length === 0 && !wo.trackId) continue;
      replaceWorkOrderTracks(project.id, wo.id, []);
      assignmentsCleared += 1;
    }
  }

  return {
    created_tracks: createdTracks,
    updated_tracks: updatedTracks,
    assignments_applied: assignmentsApplied,
    assignments_cleared: assignmentsCleared,
    warnings,
  };
}
