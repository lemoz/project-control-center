import fs from "fs";
import path from "path";
import YAML from "yaml";
import { z } from "zod";
import { findProjectByPath, getDb, syncWorkOrderDeps } from "./db.js";
import { slugify } from "./utils.js";

export const WORK_ORDER_STATUSES = [
  "backlog",
  "ready",
  "building",
  "ai_review",
  "you_review",
  "done",
  "blocked",
  "parked",
] as const;

export type WorkOrderStatus = (typeof WORK_ORDER_STATUSES)[number];

const WorkOrderStatusSchema = z.enum(WORK_ORDER_STATUSES);
const WORK_ORDER_ERAS = ["v0", "v1", "v2"] as const;
const WORK_ORDER_ERA_SET = new Set<string>(WORK_ORDER_ERAS);

const MinimalFrontmatterSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
  })
  .passthrough();

const FrontmatterSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    goal: z.string().optional(),
    context: z.array(z.string()).optional(),
    acceptance_criteria: z.array(z.string()).optional(),
    non_goals: z.array(z.string()).optional(),
    stop_conditions: z.array(z.string()).optional(),
    priority: z.coerce.number().int().min(1).max(5).optional(),
    tags: z.array(z.string()).optional(),
    base_branch: z.string().optional(),
    estimate_hours: z.coerce.number().optional(),
    status: WorkOrderStatusSchema.optional(),
    created_at: z.string().optional(),
    updated_at: z.string().optional(),
    depends_on: z.array(z.string()).optional(),
    era: z.string().optional(),
  })
  .passthrough();

export type WorkOrder = {
  id: string;
  title: string;
  goal: string | null;
  context: string[];
  acceptance_criteria: string[];
  non_goals: string[];
  stop_conditions: string[];
  priority: number;
  tags: string[];
  base_branch: string | null;
  estimate_hours: number | null;
  status: WorkOrderStatus;
  created_at: string;
  updated_at: string;
  depends_on: string[];
  era: string | null;
  ready_check: { ok: boolean; errors: string[] };
  validation_warnings: string[];
  trackId: string | null;
  track: { id: string; name: string; color: string | null } | null;
};

export type WorkOrderSummary = Pick<
  WorkOrder,
  "id" | "title" | "status" | "priority"
>;

export type WorkOrderCreateInput = {
  title: string;
  priority?: number;
  tags?: string[];
  depends_on?: string[];
  era?: string;
  base_branch?: string;
};

export type WorkOrderPatchInput = Partial<{
  title: string;
  goal: string | null;
  context: string[];
  acceptance_criteria: string[];
  non_goals: string[];
  stop_conditions: string[];
  priority: number;
  tags: string[];
  base_branch: string | null;
  estimate_hours: number | null;
  status: WorkOrderStatus;
  depends_on: string[];
  era: string | null;
}>;

export type ScopeCreepDraftInput = {
  title: string;
  file: string;
  lines?: string | null;
  rationale: string;
  sourceWorkOrderId: string;
  era?: string | null;
  base_branch?: string | null;
};

export class WorkOrderError extends Error {
  code: "not_found" | "invalid" | "io";
  details?: unknown;
  constructor(
    message: string,
    code: "not_found" | "invalid" | "io",
    details?: unknown
  ) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function workOrdersDir(repoPath: string): string {
  return path.join(repoPath, "work_orders");
}

function ensureDir(dir: string) {
  if (fs.existsSync(dir)) return;
  fs.mkdirSync(dir, { recursive: true });
}

type ParsedFile = {
  rawFrontmatter: Record<string, unknown>;
  body: string;
};

function splitFrontmatter(markdown: string): { yaml: string; body: string } | null {
  if (!markdown.startsWith("---")) return null;
  const lines = markdown.split(/\r?\n/);
  if (lines.length < 3) return null;
  if (lines[0].trim() !== "---") return null;
  let endIdx = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === "---") {
      endIdx = i;
      break;
    }
  }
  if (endIdx === -1) return null;
  const yaml = lines.slice(1, endIdx).join("\n");
  const body = lines.slice(endIdx + 1).join("\n");
  return { yaml, body };
}

function parseWorkOrderFileContents(contents: string): ParsedFile {
  const parts = splitFrontmatter(contents);
  if (!parts) {
    throw new WorkOrderError("Missing YAML frontmatter", "invalid");
  }
  let parsed: unknown;
  try {
    parsed = YAML.parse(parts.yaml) ?? {};
  } catch (err) {
    throw new WorkOrderError("Invalid YAML frontmatter", "invalid", {
      error: String(err),
    });
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new WorkOrderError("YAML frontmatter must be a map", "invalid");
  }
  return { rawFrontmatter: parsed as Record<string, unknown>, body: parts.body };
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((v) => (typeof v === "string" ? v.trim() : ""))
    .filter(Boolean);
}

function normalizeOptionalString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function buildMetadataWarnings(frontmatter: Record<string, unknown>): string[] {
  const warnings: string[] = [];
  const hasEra = Object.prototype.hasOwnProperty.call(frontmatter, "era");
  if (!hasEra) {
    warnings.push(`Missing \`era\` (expected ${WORK_ORDER_ERAS.join(", ")}).`);
  } else {
    const rawEra = frontmatter.era;
    if (typeof rawEra !== "string" || !rawEra.trim()) {
      warnings.push(`Invalid \`era\` (expected ${WORK_ORDER_ERAS.join(", ")}).`);
    } else if (!WORK_ORDER_ERA_SET.has(rawEra.trim())) {
      warnings.push(
        `Invalid \`era\` "${rawEra.trim()}" (expected ${WORK_ORDER_ERAS.join(", ")}).`
      );
    }
  }

  const hasDependsOn = Object.prototype.hasOwnProperty.call(frontmatter, "depends_on");
  if (!hasDependsOn) {
    warnings.push("Missing `depends_on` (expected array).");
  } else if (!Array.isArray(frontmatter.depends_on)) {
    warnings.push("Invalid `depends_on` (expected array).");
  }

  return warnings;
}

export function readyCheck(frontmatter: Record<string, unknown>): {
  ok: boolean;
  errors: string[];
} {
  const errors: string[] = [];
  const goal = typeof frontmatter.goal === "string" ? frontmatter.goal.trim() : "";
  const acceptance = normalizeStringArray(frontmatter.acceptance_criteria);
  const stops = normalizeStringArray(frontmatter.stop_conditions);

  if (!goal) errors.push("Missing `goal`.");
  if (!acceptance.length) errors.push("Missing `acceptance_criteria`.");
  if (!stops.length) errors.push("Missing `stop_conditions`.");

  return { ok: errors.length === 0, errors };
}

function normalizeWorkOrder(
  rawFrontmatter: Record<string, unknown>
): WorkOrder | null {
  const parsedFull = FrontmatterSchema.safeParse(rawFrontmatter);
  const parsedMinimal = parsedFull.success
    ? { success: true, data: parsedFull.data }
    : MinimalFrontmatterSchema.safeParse(rawFrontmatter);

  if (!parsedMinimal.success) return null;

  const data = parsedMinimal.data as z.infer<typeof FrontmatterSchema>;
  const status = WorkOrderStatusSchema.safeParse(data.status).success
    ? (data.status as WorkOrderStatus)
    : "backlog";
  const priorityRaw =
    typeof data.priority === "number" && Number.isFinite(data.priority)
      ? data.priority
      : 3;
  const priority = Math.min(5, Math.max(1, Math.trunc(priorityRaw)));
  const tags = normalizeStringArray(data.tags);
  const base_branch = normalizeOptionalString(data.base_branch);
  const context = normalizeStringArray(data.context);
  const acceptance_criteria = normalizeStringArray(data.acceptance_criteria);
  const non_goals = normalizeStringArray(data.non_goals);
  const stop_conditions = normalizeStringArray(data.stop_conditions);
  const goal = typeof data.goal === "string" ? data.goal : null;
  const created_at =
    typeof data.created_at === "string" && data.created_at.trim()
      ? data.created_at
      : todayIsoDate();
  const updated_at =
    typeof data.updated_at === "string" && data.updated_at.trim()
      ? data.updated_at
      : todayIsoDate();
  const estimate_hours =
    typeof data.estimate_hours === "number" && Number.isFinite(data.estimate_hours)
      ? data.estimate_hours
      : null;
  const depends_on = normalizeStringArray(data.depends_on);
  const era =
    typeof data.era === "string" && data.era.trim() ? data.era.trim() : null;

  const rc = readyCheck(rawFrontmatter);
  const validation_warnings = buildMetadataWarnings(rawFrontmatter);

  return {
    id: data.id,
    title: data.title,
    goal,
    context,
    acceptance_criteria,
    non_goals,
    stop_conditions,
    priority,
    tags,
    base_branch,
    estimate_hours,
    status,
    created_at,
    updated_at,
    depends_on,
    era,
    ready_check: rc,
    validation_warnings,
    trackId: null,
    track: null,
  };
}

function serializeWorkOrderFile(
  frontmatter: Record<string, unknown>,
  body: string
): string {
  const yamlText = YAML.stringify(frontmatter, { lineWidth: 0 }).trimEnd();
  const normalizedBody = body.startsWith("\n") ? body : `\n${body}`;
  return `---\n${yamlText}\n---${normalizedBody.endsWith("\n") ? normalizedBody : `${normalizedBody}\n`}`;
}

type WorkOrderTrackInfo = {
  trackId: string | null;
  track: { id: string; name: string; color: string | null } | null;
};

type WorkOrderRowInput = {
  id: string;
  project_id: string;
  title: string;
  status: WorkOrderStatus;
  priority: number;
  tags: string;
  base_branch: string | null;
  created_at: string;
  updated_at: string;
};

function buildWorkOrderRow(projectId: string, workOrder: WorkOrder): WorkOrderRowInput {
  return {
    id: workOrder.id,
    project_id: projectId,
    title: workOrder.title,
    status: workOrder.status,
    priority: workOrder.priority,
    tags: JSON.stringify(workOrder.tags ?? []),
    base_branch: workOrder.base_branch,
    created_at: workOrder.created_at,
    updated_at: workOrder.updated_at,
  };
}

function syncWorkOrderRows(projectId: string, workOrders: WorkOrder[]): void {
  if (!workOrders.length) return;
  const database = getDb();
  const rows = workOrders.map((workOrder) => buildWorkOrderRow(projectId, workOrder));
  const stmt = database.prepare(
    `INSERT INTO work_orders
      (id, project_id, title, status, priority, tags, base_branch, created_at, updated_at)
     VALUES
      (@id, @project_id, @title, @status, @priority, @tags, @base_branch, @created_at, @updated_at)
     ON CONFLICT(project_id, id) DO UPDATE SET
       title = excluded.title,
       status = excluded.status,
       priority = excluded.priority,
       tags = excluded.tags,
       base_branch = excluded.base_branch,
       created_at = excluded.created_at,
       updated_at = excluded.updated_at`
  );
  const tx = database.transaction((entries: WorkOrderRowInput[]) => {
    for (const entry of entries) {
      stmt.run(entry);
    }
  });
  tx(rows);
}

function buildInClause(ids: string[]): string {
  return ids.map(() => "?").join(", ");
}

function loadWorkOrderTrackInfo(
  projectId: string,
  workOrderIds: string[]
): Map<string, WorkOrderTrackInfo> {
  if (!workOrderIds.length) return new Map();
  const database = getDb();
  const rows = database
    .prepare(
      `SELECT wo.id as work_order_id,
              wo.track_id as track_id,
              t.name as track_name,
              t.color as track_color
       FROM work_orders wo
       LEFT JOIN tracks t ON t.id = wo.track_id
       WHERE wo.project_id = ? AND wo.id IN (${buildInClause(workOrderIds)})`
    )
    .all(projectId, ...workOrderIds) as Array<{
    work_order_id: string;
    track_id: string | null;
    track_name: string | null;
    track_color: string | null;
  }>;

  const map = new Map<string, WorkOrderTrackInfo>();
  for (const row of rows) {
    const trackId = typeof row.track_id === "string" ? row.track_id : null;
    const trackName = typeof row.track_name === "string" ? row.track_name : null;
    const trackColor = typeof row.track_color === "string" ? row.track_color : null;
    map.set(row.work_order_id, {
      trackId,
      track: trackId && trackName ? { id: trackId, name: trackName, color: trackColor } : null,
    });
  }
  return map;
}

export function listWorkOrders(repoPath: string): WorkOrder[] {
  const dir = workOrdersDir(repoPath);
  if (!fs.existsSync(dir)) return [];

  let files: string[];
  try {
    files = fs
      .readdirSync(dir)
      .filter((f) => f.toLowerCase().endsWith(".md"))
      .map((f) => path.join(dir, f));
  } catch {
    return [];
  }

  const workOrders: WorkOrder[] = [];
  for (const filePath of files) {
    let contents: string;
    try {
      contents = fs.readFileSync(filePath, "utf8");
    } catch {
      continue;
    }
    let parsed: ParsedFile;
    try {
      parsed = parseWorkOrderFileContents(contents);
    } catch {
      continue;
    }
    const normalized = normalizeWorkOrder(parsed.rawFrontmatter);
    if (!normalized) continue;
    workOrders.push(normalized);
  }

  workOrders.sort((a, b) => {
    if (a.status !== b.status) return a.status.localeCompare(b.status);
    if (a.priority !== b.priority) return a.priority - b.priority;
    return b.updated_at.localeCompare(a.updated_at);
  });

  const project = findProjectByPath(repoPath);
  if (project && workOrders.length > 0) {
    syncWorkOrderRows(project.id, workOrders);
    const trackInfo = loadWorkOrderTrackInfo(
      project.id,
      workOrders.map((wo) => wo.id)
    );
    for (const wo of workOrders) {
      const info = trackInfo.get(wo.id);
      if (!info) continue;
      wo.trackId = info.trackId;
      wo.track = info.track;
    }
  }

  return workOrders;
}

function findWorkOrderFileById(repoPath: string, id: string): string | null {
  const dir = workOrdersDir(repoPath);
  if (!fs.existsSync(dir)) return null;

  const candidates = [
    path.join(dir, `${id}.md`),
    ...safeListDir(dir)
      .filter((f) => f.startsWith(`${id}-`) && f.toLowerCase().endsWith(".md"))
      .map((f) => path.join(dir, f)),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }

  for (const filePath of safeListDir(dir)
    .filter((f) => f.toLowerCase().endsWith(".md"))
    .map((f) => path.join(dir, f))) {
    let contents: string;
    try {
      contents = fs.readFileSync(filePath, "utf8");
    } catch {
      continue;
    }
    let parsed: ParsedFile;
    try {
      parsed = parseWorkOrderFileContents(contents);
    } catch {
      continue;
    }
    const maybeId = parsed.rawFrontmatter.id;
    if (maybeId === id) return filePath;
  }

  return null;
}

export function readWorkOrderMarkdown(repoPath: string, id: string): string {
  const filePath = findWorkOrderFileById(repoPath, id);
  if (!filePath) throw new WorkOrderError("Work Order not found", "not_found");
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch (err) {
    throw new WorkOrderError("Failed to read Work Order file", "io", {
      error: String(err),
    });
  }
}

export function getWorkOrder(repoPath: string, id: string): WorkOrder {
  const all = listWorkOrders(repoPath);
  const found = all.find((w) => w.id === id);
  if (!found) throw new WorkOrderError("Work Order not found", "not_found");
  return found;
}

function safeListDir(dir: string): string[] {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}

function nextSequence(repoPath: string, year: number): number {
  const dir = workOrdersDir(repoPath);
  if (!fs.existsSync(dir)) return 1;

  const re = /^WO-(\d{4})-(\d{3})/;
  let max = 0;

  for (const fileName of safeListDir(dir)) {
    const match = fileName.match(re);
    if (match && Number(match[1]) === year) {
      const n = Number(match[2]);
      if (Number.isFinite(n)) max = Math.max(max, n);
      continue;
    }

    const filePath = path.join(dir, fileName);
    if (!fileName.toLowerCase().endsWith(".md")) continue;
    let contents: string;
    try {
      contents = fs.readFileSync(filePath, "utf8");
    } catch {
      continue;
    }
    const parts = splitFrontmatter(contents);
    if (!parts) continue;
    const match2 = parts.yaml.match(re);
    if (match2 && Number(match2[1]) === year) {
      const n = Number(match2[2]);
      if (Number.isFinite(n)) max = Math.max(max, n);
    }
  }

  return max + 1;
}

export function createWorkOrder(
  repoPath: string,
  input: WorkOrderCreateInput
): WorkOrder {
  if (!input.title?.trim()) {
    throw new WorkOrderError("`title` is required", "invalid");
  }

  const dir = workOrdersDir(repoPath);
  ensureDir(dir);

  const now = todayIsoDate();
  const year = new Date().getFullYear();
  let seq = nextSequence(repoPath, year);
  const title = input.title.trim();
  const slug = slugify(title) || "work-order";

  let id: string;
  let filePath: string;
  while (true) {
    id = `WO-${year}-${String(seq).padStart(3, "0")}`;
    filePath = path.join(dir, `${id}-${slug}.md`);
    if (!fs.existsSync(filePath)) break;
    seq += 1;
  }

  const priority =
    typeof input.priority === "number" && Number.isFinite(input.priority)
      ? Math.min(5, Math.max(1, Math.trunc(input.priority)))
      : 3;
  const tags = normalizeStringArray(input.tags);
  const depends_on = normalizeStringArray(input.depends_on);
  const era =
    typeof input.era === "string" && input.era.trim() ? input.era.trim() : null;
  const base_branch = normalizeOptionalString(input.base_branch);

  const frontmatter: Record<string, unknown> = {
    id,
    title,
    goal: "",
    context: [],
    acceptance_criteria: [],
    non_goals: [],
    stop_conditions: [],
    priority,
    tags,
    estimate_hours: 0.5,
    status: "backlog",
    created_at: now,
    updated_at: now,
    depends_on,
    era,
  };
  if (base_branch) {
    frontmatter.base_branch = base_branch;
  }

  const body = `\n\n## Notes\n- \n`;

  try {
    fs.writeFileSync(filePath, serializeWorkOrderFile(frontmatter, body), "utf8");
  } catch (err) {
    throw new WorkOrderError("Failed to write Work Order file", "io", {
      error: String(err),
    });
  }

  const normalized = normalizeWorkOrder(frontmatter);
  if (!normalized) {
    throw new WorkOrderError("Failed to normalize created Work Order", "invalid");
  }
  const project = findProjectByPath(repoPath);
  if (project) {
    syncWorkOrderRows(project.id, [normalized]);
    syncWorkOrderDeps(project.id, normalized.id, normalized.depends_on);
  }
  return normalized;
}

export function createScopeCreepDraftWorkOrder(
  repoPath: string,
  input: ScopeCreepDraftInput
): WorkOrder {
  const rawTitle = normalizeOptionalString(input.title);
  const file = normalizeOptionalString(input.file);
  const rationale = normalizeOptionalString(input.rationale);
  const sourceWorkOrderId = normalizeOptionalString(input.sourceWorkOrderId);
  if (!rawTitle || !file || !rationale || !sourceWorkOrderId) {
    throw new WorkOrderError(
      "Scope creep draft requires title, file, rationale, and sourceWorkOrderId",
      "invalid"
    );
  }

  const cleanedTitle = rawTitle.replace(/^\[Auto\]\s*/i, "").trim();
  const changeTitle = cleanedTitle || rawTitle;
  const title = rawTitle.match(/^\[Auto\]/i) ? rawTitle : `[Auto] ${changeTitle}`;

  const lines = normalizeOptionalString(input.lines);
  const context = [
    `Surfaced during ${sourceWorkOrderId} review`,
    `File: ${file}${lines ? ` (${lines})` : ""}`,
    `Change: ${changeTitle}`,
    `Rationale: ${rationale}`,
  ];

  const era = normalizeOptionalString(input.era);
  const baseBranch = normalizeOptionalString(input.base_branch);
  const created = createWorkOrder(repoPath, {
    title,
    priority: 3,
    tags: ["auto-generated", "from-scope-creep"],
    depends_on: [],
    ...(era ? { era } : {}),
    ...(baseBranch ? { base_branch: baseBranch } : {}),
  });

  return patchWorkOrder(repoPath, created.id, {
    goal: `Evaluate and implement if appropriate: ${changeTitle}`,
    context,
  });
}

export function patchWorkOrder(
  repoPath: string,
  workOrderId: string,
  patch: WorkOrderPatchInput
): WorkOrder {
  const filePath = findWorkOrderFileById(repoPath, workOrderId);
  if (!filePath) throw new WorkOrderError("Work Order not found", "not_found");

  let contents: string;
  try {
    contents = fs.readFileSync(filePath, "utf8");
  } catch (err) {
    throw new WorkOrderError("Failed to read Work Order file", "io", {
      error: String(err),
    });
  }

  const parsed = parseWorkOrderFileContents(contents);
  const frontmatter = parsed.rawFrontmatter;

  if (patch.title !== undefined) {
    if (!patch.title?.trim()) {
      throw new WorkOrderError("`title` cannot be empty", "invalid");
    }
    frontmatter.title = patch.title.trim();
  }
  if (patch.goal !== undefined) {
    frontmatter.goal = patch.goal === null ? "" : String(patch.goal);
  }
  if (patch.context !== undefined) {
    frontmatter.context = normalizeStringArray(patch.context);
  }
  if (patch.acceptance_criteria !== undefined) {
    frontmatter.acceptance_criteria = normalizeStringArray(patch.acceptance_criteria);
  }
  if (patch.non_goals !== undefined) {
    frontmatter.non_goals = normalizeStringArray(patch.non_goals);
  }
  if (patch.stop_conditions !== undefined) {
    frontmatter.stop_conditions = normalizeStringArray(patch.stop_conditions);
  }
  if (patch.priority !== undefined) {
    if (typeof patch.priority !== "number" || !Number.isFinite(patch.priority)) {
      throw new WorkOrderError("`priority` must be a number", "invalid");
    }
    frontmatter.priority = Math.min(5, Math.max(1, Math.trunc(patch.priority)));
  }
  if (patch.tags !== undefined) {
    frontmatter.tags = normalizeStringArray(patch.tags);
  }
  if (patch.base_branch !== undefined) {
    const normalized = normalizeOptionalString(patch.base_branch);
    if (normalized) {
      frontmatter.base_branch = normalized;
    } else {
      delete frontmatter.base_branch;
    }
  }
  if (patch.estimate_hours !== undefined) {
    if (patch.estimate_hours === null) {
      delete frontmatter.estimate_hours;
    } else if (
      typeof patch.estimate_hours !== "number" ||
      !Number.isFinite(patch.estimate_hours)
    ) {
      throw new WorkOrderError("`estimate_hours` must be a number", "invalid");
    } else {
      frontmatter.estimate_hours = patch.estimate_hours;
    }
  }
  if (patch.status !== undefined) {
    const parsedStatus = WorkOrderStatusSchema.safeParse(patch.status);
    if (!parsedStatus.success) {
      throw new WorkOrderError("Invalid status", "invalid", {
        allowed: WORK_ORDER_STATUSES,
      });
    }
    frontmatter.status = parsedStatus.data;
  }
  if (patch.depends_on !== undefined) {
    frontmatter.depends_on = normalizeStringArray(patch.depends_on);
  }
  if (patch.era !== undefined) {
    frontmatter.era =
      patch.era === null || !patch.era.trim() ? null : patch.era.trim();
  }

  frontmatter.updated_at = todayIsoDate();

  const statusAfter = WorkOrderStatusSchema.safeParse(frontmatter.status).success
    ? (frontmatter.status as WorkOrderStatus)
    : "backlog";

  if (statusAfter === "ready" || statusAfter === "building") {
    const rc = readyCheck(frontmatter);
    if (!rc.ok) {
      throw new WorkOrderError("Ready contract not satisfied", "invalid", rc);
    }
  }

  try {
    fs.writeFileSync(
      filePath,
      serializeWorkOrderFile(frontmatter, parsed.body),
      "utf8"
    );
  } catch (err) {
    throw new WorkOrderError("Failed to write Work Order file", "io", {
      error: String(err),
    });
  }

  const normalized = normalizeWorkOrder(frontmatter);
  if (!normalized) {
    throw new WorkOrderError("Invalid Work Order after patch", "invalid");
  }
  const project = findProjectByPath(repoPath);
  if (project) {
    syncWorkOrderRows(project.id, [normalized]);
    syncWorkOrderDeps(project.id, normalized.id, normalized.depends_on);
  }
  return normalized;
}

/**
 * Auto-transition dependents to 'ready' when all their dependencies are done.
 * Called after a work order is marked as 'done'.
 * @returns list of work order IDs that were auto-transitioned
 */
export function cascadeAutoReady(
  repoPath: string,
  completedWorkOrderId: string,
  getDependents: (workOrderId: string) => string[]
): string[] {
  const transitioned: string[] = [];
  const allWorkOrders = listWorkOrders(repoPath);
  const workOrderMap = new Map(allWorkOrders.map((wo) => [wo.id, wo]));

  // Get dependents of the just-completed work order
  const dependentIds = getDependents(completedWorkOrderId);

  for (const dependentId of dependentIds) {
    const dependent = workOrderMap.get(dependentId);
    if (!dependent) continue;

    // Only process backlog items
    if (dependent.status !== "backlog") continue;

    // Check if ALL dependencies are now done
    const allDepsDone = dependent.depends_on.every((depId) => {
      const dep = workOrderMap.get(depId);
      return dep && dep.status === "done";
    });

    if (!allDepsDone) continue;

    // Check if ready contract is satisfied
    const rc = readyCheck({
      goal: dependent.goal,
      acceptance_criteria: dependent.acceptance_criteria,
      stop_conditions: dependent.stop_conditions,
    });

    if (!rc.ok) continue;

    // Auto-transition to ready
    try {
      patchWorkOrder(repoPath, dependentId, { status: "ready" });
      transitioned.push(dependentId);
    } catch {
      // Ignore errors, just skip this one
    }
  }

  return transitioned;
}

export function topActiveWorkOrders(
  repoPath: string,
  limit = 3
): WorkOrderSummary[] {
  const items = listWorkOrders(repoPath)
    .filter((wo) => wo.status === "ready" || wo.status === "building")
    .sort((a, b) => {
      const statusRank = (s: WorkOrderStatus) => (s === "ready" ? 0 : 1);
      const sr = statusRank(a.status) - statusRank(b.status);
      if (sr !== 0) return sr;
      if (a.priority !== b.priority) return a.priority - b.priority;
      return b.updated_at.localeCompare(a.updated_at);
    })
    .slice(0, limit)
    .map((wo) => ({
      id: wo.id,
      title: wo.title,
      status: wo.status,
      priority: wo.priority,
    }));
  return items;
}

export function deleteWorkOrder(repoPath: string, id: string): void {
  const filePath = findWorkOrderFileById(repoPath, id);
  if (!filePath) throw new WorkOrderError("Work Order not found", "not_found");
  try {
    fs.rmSync(filePath, { force: true });
  } catch (err) {
    throw new WorkOrderError("Failed to delete Work Order file", "io", {
      error: String(err),
    });
  }
}

export function overwriteWorkOrderMarkdown(
  repoPath: string,
  id: string,
  markdown: string
): WorkOrder {
  const filePath = findWorkOrderFileById(repoPath, id);
  if (!filePath) throw new WorkOrderError("Work Order not found", "not_found");

  let parsed: ParsedFile;
  try {
    parsed = parseWorkOrderFileContents(markdown);
  } catch (err) {
    throw err instanceof WorkOrderError
      ? err
      : new WorkOrderError("Invalid Work Order markdown", "invalid");
  }

  if (parsed.rawFrontmatter.id !== id) {
    throw new WorkOrderError("Work Order id mismatch", "invalid", {
      expected: id,
      actual: parsed.rawFrontmatter.id,
    });
  }

  try {
    fs.writeFileSync(filePath, markdown, "utf8");
  } catch (err) {
    throw new WorkOrderError("Failed to write Work Order file", "io", {
      error: String(err),
    });
  }

  const normalized = normalizeWorkOrder(parsed.rawFrontmatter);
  if (!normalized) {
    throw new WorkOrderError("Invalid Work Order after overwrite", "invalid");
  }
  const project = findProjectByPath(repoPath);
  if (project) {
    syncWorkOrderRows(project.id, [normalized]);
    syncWorkOrderDeps(project.id, normalized.id, normalized.depends_on);
  }
  return normalized;
}
