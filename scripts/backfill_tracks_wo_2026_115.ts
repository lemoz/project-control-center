/**
 * Backfill script to create PCC tracks and assign existing Work Orders.
 *
 * Run (report only):
 *   node --import tsx/esm scripts/backfill_tracks_wo_2026_115.ts --report docs/track-assignment-report-wo-2026-115.md
 *
 * Run (apply to DB):
 *   node --import tsx/esm scripts/backfill_tracks_wo_2026_115.ts --apply --project-path /path/to/project-control-center
 */
import crypto from "crypto";
import fs from "fs";
import path from "path";
import Database from "better-sqlite3";
import YAML from "yaml";

const WORK_ORDER_STATUSES = [
  "backlog",
  "ready",
  "building",
  "ai_review",
  "you_review",
  "done",
  "blocked",
  "parked",
] as const;

type TrackDefinition = {
  name: string;
  description: string;
  goal: string;
  color: string;
  icon: string;
  sortOrder: number;
};

type AssignmentGroup = {
  label: string;
  workOrders: string[];
};

type WorkOrderFile = {
  id: string;
  title: string;
  status: string;
  priority: number;
  tags: string[];
  baseBranch: string | null;
  createdAt: string;
  updatedAt: string;
};

type ProjectRow = {
  id: string;
  name: string;
  path: string;
};

type Options = {
  apply: boolean;
  reportPath: string | null;
  projectId: string | null;
  projectPath: string;
  projectName: string | null;
};

const TRACK_DEFINITIONS: TrackDefinition[] = [
  {
    name: "Foundation",
    description: "Core scaffolding and baseline features to get PCC running.",
    goal: "Bootstrap the system from zero to functional.",
    color: "#6B7280",
    icon: "foundation",
    sortOrder: 1,
  },
  {
    name: "Runner Reliability",
    description: "Stability and resilience for the agent run loop.",
    goal: "Parallel runs that do not break each other.",
    color: "#10B981",
    icon: "shield-check",
    sortOrder: 2,
  },
  {
    name: "VM Isolation",
    description: "VM-based isolation, provisioning, and secure execution.",
    goal: "Secure, isolated execution environments.",
    color: "#8B5CF6",
    icon: "server",
    sortOrder: 3,
  },
  {
    name: "Chat Experience",
    description: "Chat UI, threads, and realtime interaction improvements.",
    goal: "Rich conversational interface with the system.",
    color: "#3B82F6",
    icon: "chat",
    sortOrder: 4,
  },
  {
    name: "Constitution",
    description: "Policy and governance flow for agent behavior.",
    goal: "Define and enforce agent behavior governance.",
    color: "#F59E0B",
    icon: "scroll",
    sortOrder: 5,
  },
  {
    name: "Autonomous Orchestration",
    description: "Autonomous shift agents and global orchestration loops.",
    goal: "Self-directing agent shifts and global coordination.",
    color: "#EC4899",
    icon: "robot",
    sortOrder: 6,
  },
  {
    name: "Economy",
    description: "Cost tracking, budgeting, and economic controls.",
    goal: "Cost awareness and self-sustaining agent budgets.",
    color: "#14B8A6",
    icon: "dollar",
    sortOrder: 7,
  },
  {
    name: "Visualization",
    description: "Dashboards and visualizations of system state.",
    goal: "Rich visual dashboards for system state.",
    color: "#F97316",
    icon: "chart",
    sortOrder: 8,
  },
  {
    name: "Run Estimation",
    description: "Services and UI for run time prediction.",
    goal: "Predict how long runs will take.",
    color: "#6366F1",
    icon: "clock",
    sortOrder: 9,
  },
  {
    name: "Multi-Repo",
    description: "Cross-project coordination and dependency management.",
    goal: "Coordinate work across multiple projects.",
    color: "#84CC16",
    icon: "git-branch",
    sortOrder: 10,
  },
  {
    name: "Testing & Quality",
    description: "Testing infrastructure and reliability improvements.",
    goal: "Reliable, non-flaky tests.",
    color: "#EF4444",
    icon: "beaker",
    sortOrder: 11,
  },
];

const TRACK_ASSIGNMENTS: Record<string, string[]> = {
  Foundation: [
    "WO-2025-001",
    "WO-2025-002",
    "WO-2025-003",
    "WO-2025-004",
    "WO-2025-005",
    "WO-2025-006",
    "WO-2025-008",
    "WO-2026-120",
  ],
  "Runner Reliability": [
    "WO-2026-020",
    "WO-2026-022",
    "WO-2026-032",
    "WO-2026-033",
    "WO-2026-046",
    "WO-2026-050",
    "WO-2026-051",
    "WO-2026-054",
    "WO-2026-055",
    "WO-2026-057",
    "WO-2026-100",
    "WO-2026-106",
    "WO-2026-107",
    "WO-2026-113",
  ],
  "VM Isolation": [
    "WO-2026-027",
    "WO-2026-028",
    "WO-2026-036",
    "WO-2026-038",
    "WO-2026-039",
    "WO-2026-040",
    "WO-2026-041",
    "WO-2026-049",
    "WO-2026-058",
    "WO-2026-059",
    "WO-2026-067",
    "WO-2026-068",
    "WO-2026-089",
  ],
  "Chat Experience": ["WO-2025-011", "WO-2026-001", "WO-2026-016", "WO-2026-042"],
  Constitution: [
    "WO-2026-024",
    "WO-2026-025",
    "WO-2026-026",
    "WO-2026-029",
    "WO-2026-030",
    "WO-2026-031",
    "WO-2026-047",
    "WO-2026-048",
  ],
  "Autonomous Orchestration": [
    "WO-2026-023",
    "WO-2026-060",
    "WO-2026-061",
    "WO-2026-062",
    "WO-2026-063",
    "WO-2026-064",
    "WO-2026-065",
    "WO-2026-074",
    "WO-2026-075",
    "WO-2026-076",
    "WO-2026-077",
    "WO-2026-078",
    "WO-2026-079",
    "WO-2026-080",
    "WO-2026-081",
    "WO-2026-082",
    "WO-2026-083",
    "WO-2026-084",
    "WO-2026-085",
    "WO-2026-086",
    "WO-2026-087",
    "WO-2026-088",
    "WO-2026-090",
  ],
  Economy: [
    "WO-2026-037",
    "WO-2026-101",
    "WO-2026-102",
    "WO-2026-103",
    "WO-2026-104",
    "WO-2026-105",
    "WO-2026-110",
    "WO-2026-111",
  ],
  Visualization: [
    "WO-2026-021",
    "WO-2026-066",
    "WO-2026-091",
    "WO-2026-092",
    "WO-2026-093",
    "WO-2026-094",
    "WO-2026-095",
    "WO-2026-096",
    "WO-2026-097",
    "WO-2026-112",
  ],
  "Run Estimation": [
    "WO-2026-069",
    "WO-2026-070",
    "WO-2026-071",
    "WO-2026-072",
    "WO-2026-073",
  ],
  "Multi-Repo": ["WO-2026-098", "WO-2026-099"],
  "Testing & Quality": [
    "WO-2025-009",
    "WO-2025-010",
    "WO-2026-053",
    "WO-2026-056",
    "WO-2026-109",
  ],
};

const UNASSIGNED_GROUPS: AssignmentGroup[] = [
  {
    label: "Tracks Meta",
    workOrders: [
      "WO-2026-043",
      "WO-2026-108",
      "WO-2026-114",
      "WO-2026-115",
      "WO-2026-116",
      "WO-2026-117",
      "WO-2026-118",
      "WO-2026-119",
    ],
  },
  {
    label: "Uncategorized",
    workOrders: [
      "WO-2025-007",
      "WO-2026-034",
      "WO-2026-035",
      "WO-2026-044",
      "WO-2026-045",
      "WO-2026-052",
    ],
  },
];

function parseArgs(argv: string[]): Options {
  const options: Options = {
    apply: false,
    reportPath: null,
    projectId: null,
    projectPath: process.cwd(),
    projectName: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--apply") {
      options.apply = true;
      continue;
    }
    if (arg === "--dry-run") {
      options.apply = false;
      continue;
    }
    if (arg === "--report") {
      options.reportPath = argv[i + 1] ?? null;
      i += 1;
      continue;
    }
    if (arg === "--project-id") {
      options.projectId = argv[i + 1] ?? null;
      i += 1;
      continue;
    }
    if (arg === "--project-path") {
      options.projectPath = argv[i + 1] ?? options.projectPath;
      i += 1;
      continue;
    }
    if (arg === "--project-name") {
      options.projectName = argv[i + 1] ?? null;
      i += 1;
      continue;
    }
  }
  return options;
}

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
  return {
    yaml: lines.slice(1, endIdx).join("\n"),
    body: lines.slice(endIdx + 1).join("\n"),
  };
}

function normalizeTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((tag) => (typeof tag === "string" ? tag.trim() : ""))
    .filter(Boolean);
}

function normalizeStatus(value: unknown): string {
  if (typeof value !== "string") return "backlog";
  return (WORK_ORDER_STATUSES as readonly string[]).includes(value)
    ? value
    : "backlog";
}

function normalizePriority(value: unknown): number {
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return Math.min(5, Math.max(1, Math.trunc(parsed)));
    }
    return 3;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) return 3;
  return Math.min(5, Math.max(1, Math.trunc(value)));
}

function normalizeOptionalString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function extractFlatValues(lines: string[]): Record<string, string> {
  const output: Record<string, string> = {};
  for (const line of lines) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    if (/^\s+-\s+/.test(line)) continue;
    const match = line.match(/^([A-Za-z0-9_]+):\s*(.*)$/);
    if (!match) continue;
    const key = match[1];
    let value = match[2].trim();
    if (!value) continue;
    if (
      (value.startsWith("\"") && value.endsWith("\"")) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    output[key] = value;
  }
  return output;
}

function extractList(lines: string[], key: string): string[] {
  const items: string[] = [];
  let inList = false;
  for (const line of lines) {
    if (!inList) {
      if (line.startsWith(`${key}:`)) {
        inList = true;
      }
      continue;
    }
    if (!line.startsWith("  -")) {
      if (!line.startsWith("  ")) break;
      continue;
    }
    const value = line.replace(/^\s*-\s*/, "").trim();
    if (value) items.push(value);
  }
  return items;
}

function loadWorkOrders(repoPath: string): {
  workOrders: WorkOrderFile[];
  parseErrors: string[];
} {
  const dir = path.join(repoPath, "work_orders");
  if (!fs.existsSync(dir)) return { workOrders: [], parseErrors: [] };
  const files = fs.readdirSync(dir).filter((file) => file.endsWith(".md"));
  const items: WorkOrderFile[] = [];
  const parseErrors: string[] = [];
  const seen = new Set<string>();

  for (const file of files) {
    const filePath = path.join(dir, file);
    let contents = "";
    try {
      contents = fs.readFileSync(filePath, "utf8");
    } catch {
      continue;
    }
    const parts = splitFrontmatter(contents);
    if (!parts) continue;
    const yamlLines = parts.yaml.split(/\r?\n/);
    let data: Record<string, unknown> = {};
    let tags: string[] = [];
    try {
      const parsed = YAML.parse(parts.yaml);
      if (typeof parsed === "object" && parsed !== null) {
        data = parsed as Record<string, unknown>;
        tags = normalizeTags(data.tags);
      } else {
        data = extractFlatValues(yamlLines);
        tags = extractList(yamlLines, "tags");
        parseErrors.push(file);
      }
    } catch {
      data = extractFlatValues(yamlLines);
      tags = extractList(yamlLines, "tags");
      parseErrors.push(file);
    }

    const id = typeof data.id === "string" ? data.id.trim() : "";
    const title = typeof data.title === "string" ? data.title.trim() : "";
    if (!id || !title) continue;
    if (seen.has(id)) continue;
    seen.add(id);

    const status = normalizeStatus(data.status);
    const priority = normalizePriority(data.priority);
    const baseBranch = normalizeOptionalString(data.base_branch);
    const createdAt = normalizeOptionalString(data.created_at) ?? todayIsoDate();
    const updatedAt = normalizeOptionalString(data.updated_at) ?? todayIsoDate();

    items.push({
      id,
      title,
      status,
      priority,
      tags,
      baseBranch,
      createdAt,
      updatedAt,
    });
  }

  return { workOrders: items, parseErrors };
}

function validateAssignments(
  trackAssignments: Record<string, string[]>,
  unassignedGroups: AssignmentGroup[],
  trackDefinitions: TrackDefinition[]
): void {
  const trackNames = new Set(trackDefinitions.map((track) => track.name));
  for (const name of Object.keys(trackAssignments)) {
    if (!trackNames.has(name)) {
      throw new Error(`Unknown track name in assignments: ${name}`);
    }
  }

  const seen = new Map<string, string>();
  for (const [trackName, workOrders] of Object.entries(trackAssignments)) {
    for (const workOrderId of workOrders) {
      const existing = seen.get(workOrderId);
      if (existing) {
        throw new Error(
          `Work order ${workOrderId} assigned to multiple groups: ${existing} and ${trackName}`
        );
      }
      seen.set(workOrderId, trackName);
    }
  }
  for (const group of unassignedGroups) {
    for (const workOrderId of group.workOrders) {
      const existing = seen.get(workOrderId);
      if (existing) {
        throw new Error(
          `Work order ${workOrderId} assigned to multiple groups: ${existing} and ${group.label}`
        );
      }
      seen.set(workOrderId, group.label);
    }
  }
}

function buildReport(
  workOrders: WorkOrderFile[],
  trackAssignments: Record<string, string[]>,
  unassignedGroups: AssignmentGroup[],
  trackDefinitions: TrackDefinition[]
): string {
  const workOrderMap = new Map(workOrders.map((wo) => [wo.id, wo]));
  const assigned = new Set<string>();
  const missingInRepo: string[] = [];

  for (const list of Object.values(trackAssignments)) {
    for (const workOrderId of list) {
      assigned.add(workOrderId);
      if (!workOrderMap.has(workOrderId)) missingInRepo.push(workOrderId);
    }
  }
  for (const group of unassignedGroups) {
    for (const workOrderId of group.workOrders) {
      assigned.add(workOrderId);
      if (!workOrderMap.has(workOrderId)) missingInRepo.push(workOrderId);
    }
  }

  const unmapped = workOrders
    .map((wo) => wo.id)
    .filter((id) => !assigned.has(id));
  const totalInMapping = assigned.size;
  const assignedCount = Object.values(trackAssignments).reduce(
    (sum, list) => sum + list.length,
    0
  );
  const unassignedCount = unassignedGroups.reduce(
    (sum, group) => sum + group.workOrders.length,
    0
  );

  const lines: string[] = [];
  lines.push("# WO-2026-115 Track Assignment Report");
  lines.push("");
  lines.push(
    "Generated from scripts/backfill_tracks_wo_2026_115.ts. Update this report by re-running the script with --report."
  );
  lines.push("");
  lines.push("## Summary");
  lines.push(`- Total work orders in repo: ${workOrders.length}`);
  lines.push(`- Total in mapping: ${totalInMapping}`);
  lines.push(`- Assigned to tracks: ${assignedCount}`);
  lines.push(`- Unassigned (Tracks Meta + Uncategorized): ${unassignedCount}`);
  lines.push(`- Unmapped in repo: ${unmapped.length}`);
  lines.push(`- Missing from repo (in mapping): ${missingInRepo.length}`);
  lines.push("");
  lines.push("## Track Distribution");
  for (const track of trackDefinitions) {
    const count = trackAssignments[track.name]?.length ?? 0;
    lines.push(`- ${track.name}: ${count}`);
  }

  const formatEntry = (workOrderId: string): string => {
    const info = workOrderMap.get(workOrderId);
    if (!info) return `- ${workOrderId}: (missing file)`;
    return `- ${workOrderId}: ${sanitizeText(info.title)}`;
  };

  for (const track of trackDefinitions) {
    const workOrdersForTrack = trackAssignments[track.name] ?? [];
    lines.push("");
    lines.push(`## ${track.name} (${workOrdersForTrack.length})`);
    for (const workOrderId of workOrdersForTrack) {
      lines.push(formatEntry(workOrderId));
    }
  }

  for (const group of unassignedGroups) {
    lines.push("");
    lines.push(`## Unassigned - ${group.label} (${group.workOrders.length})`);
    for (const workOrderId of group.workOrders) {
      lines.push(formatEntry(workOrderId));
    }
  }

  if (unmapped.length > 0) {
    lines.push("");
    lines.push(`## Unmapped Work Orders (${unmapped.length})`);
    for (const workOrderId of unmapped) {
      lines.push(formatEntry(workOrderId));
    }
  }

  if (missingInRepo.length > 0) {
    lines.push("");
    lines.push(`## Missing Work Orders in Repo (${missingInRepo.length})`);
    for (const workOrderId of missingInRepo) {
      lines.push(`- ${workOrderId}`);
    }
  }

  lines.push("");
  return `${lines.join("\n")}\n`;
}

function sanitizeText(value: string): string {
  return value
    .replace(/\u2192/g, "->")
    .replace(/\u2014/g, "-")
    .replace(/\u2013/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/[^\x00-\x7F]/g, "");
}

function syncWorkOrderRows(
  db: Database.Database,
  projectId: string,
  workOrders: WorkOrderFile[]
): void {
  if (workOrders.length === 0) return;
  const stmt = db.prepare(
    `INSERT INTO work_orders
      (id, project_id, title, status, priority, tags, base_branch, created_at, updated_at)
     VALUES
      (@id, @project_id, @title, @status, @priority, @tags, @base_branch, @created_at, @updated_at)
     ON CONFLICT(project_id, id) DO NOTHING`
  );
  const tx = db.transaction((entries: WorkOrderFile[]) => {
    for (const entry of entries) {
      stmt.run({
        id: entry.id,
        project_id: projectId,
        title: entry.title,
        status: entry.status,
        priority: entry.priority,
        tags: JSON.stringify(entry.tags),
        base_branch: entry.baseBranch,
        created_at: entry.createdAt,
        updated_at: entry.updatedAt,
      });
    }
  });
  tx(workOrders);
}

function upsertTracks(
  db: Database.Database,
  projectId: string,
  trackDefinitions: TrackDefinition[]
): Map<string, string> {
  const rows = db
    .prepare("SELECT id, name FROM tracks WHERE project_id = ?")
    .all(projectId) as Array<{ id: string; name: string }>;
  const byName = new Map<string, { id: string; name: string }>();
  for (const row of rows) {
    if (byName.has(row.name)) {
      throw new Error(`Duplicate track name in DB: ${row.name}`);
    }
    byName.set(row.name, row);
  }

  const now = new Date().toISOString();
  const insertStmt = db.prepare(
    `INSERT INTO tracks
      (id, project_id, name, description, goal, color, icon, sort_order, created_at, updated_at)
     VALUES
      (@id, @project_id, @name, @description, @goal, @color, @icon, @sort_order, @created_at, @updated_at)`
  );
  const updateStmt = db.prepare(
    `UPDATE tracks
     SET description = @description,
         goal = @goal,
         color = @color,
         icon = @icon,
         sort_order = @sort_order,
         updated_at = @updated_at
     WHERE id = @id AND project_id = @project_id`
  );

  const trackIds = new Map<string, string>();
  const tx = db.transaction(() => {
    for (const track of trackDefinitions) {
      const existing = byName.get(track.name);
      if (existing) {
        updateStmt.run({
          id: existing.id,
          project_id: projectId,
          description: track.description,
          goal: track.goal,
          color: track.color,
          icon: track.icon,
          sort_order: track.sortOrder,
          updated_at: now,
        });
        trackIds.set(track.name, existing.id);
      } else {
        const id = crypto.randomUUID();
        insertStmt.run({
          id,
          project_id: projectId,
          name: track.name,
          description: track.description,
          goal: track.goal,
          color: track.color,
          icon: track.icon,
          sort_order: track.sortOrder,
          created_at: now,
          updated_at: now,
        });
        trackIds.set(track.name, id);
      }
    }
  });
  tx();
  return trackIds;
}

function applyAssignments(
  db: Database.Database,
  projectId: string,
  trackIds: Map<string, string>,
  trackAssignments: Record<string, string[]>,
  unassignedGroups: AssignmentGroup[]
): { updated: number; cleared: number; missing: string[] } {
  const existsStmt = db.prepare(
    "SELECT 1 FROM work_orders WHERE project_id = ? AND id = ? LIMIT 1"
  );
  const updateStmt = db.prepare(
    "UPDATE work_orders SET track_id = @track_id WHERE project_id = @project_id AND id = @id"
  );
  const clearStmt = db.prepare(
    "UPDATE work_orders SET track_id = NULL WHERE project_id = @project_id AND id = @id"
  );

  const missing: string[] = [];
  let updated = 0;
  let cleared = 0;

  const tx = db.transaction(() => {
    for (const [trackName, workOrders] of Object.entries(trackAssignments)) {
      const trackId = trackIds.get(trackName);
      if (!trackId) {
        throw new Error(`Track ID missing for ${trackName}`);
      }
      for (const workOrderId of workOrders) {
        const exists = existsStmt.get(projectId, workOrderId);
        if (!exists) {
          missing.push(workOrderId);
          continue;
        }
        updateStmt.run({
          track_id: trackId,
          project_id: projectId,
          id: workOrderId,
        });
        updated += 1;
      }
    }
    for (const group of unassignedGroups) {
      for (const workOrderId of group.workOrders) {
        const exists = existsStmt.get(projectId, workOrderId);
        if (!exists) {
          missing.push(workOrderId);
          continue;
        }
        clearStmt.run({ project_id: projectId, id: workOrderId });
        cleared += 1;
      }
    }
  });
  tx();
  return { updated, cleared, missing };
}

function findProject(db: Database.Database, options: Options): ProjectRow | null {
  if (options.projectId) {
    const row = db
      .prepare("SELECT id, name, path FROM projects WHERE id = ? LIMIT 1")
      .get(options.projectId) as ProjectRow | undefined;
    return row ?? null;
  }
  if (options.projectName) {
    const row = db
      .prepare("SELECT id, name, path FROM projects WHERE name = ? LIMIT 1")
      .get(options.projectName) as ProjectRow | undefined;
    return row ?? null;
  }
  const resolvedPath = path.resolve(options.projectPath);
  const row = db
    .prepare("SELECT id, name, path FROM projects WHERE path = ? LIMIT 1")
    .get(resolvedPath) as ProjectRow | undefined;
  return row ?? null;
}

function listProjects(db: Database.Database): ProjectRow[] {
  return db
    .prepare("SELECT id, name, path FROM projects ORDER BY priority ASC, name ASC")
    .all() as ProjectRow[];
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  validateAssignments(TRACK_ASSIGNMENTS, UNASSIGNED_GROUPS, TRACK_DEFINITIONS);

  const repoPath = path.resolve(options.projectPath);
  const { workOrders, parseErrors } = loadWorkOrders(repoPath);
  const report = buildReport(
    workOrders,
    TRACK_ASSIGNMENTS,
    UNASSIGNED_GROUPS,
    TRACK_DEFINITIONS
  );

  if (options.reportPath) {
    const reportPath = path.resolve(options.reportPath);
    fs.writeFileSync(reportPath, report, "utf8");
    console.log(`Report written to ${reportPath}`);
  }

  if (parseErrors.length > 0) {
    console.log(
      `Parsed ${parseErrors.length} work orders with fallback frontmatter parsing.`
    );
  }

  if (!options.apply) {
    console.log("Dry run (no DB changes). Use --apply to write to the database.");
    return;
  }

  const dbPath =
    process.env.CONTROL_CENTER_DB_PATH || path.join(repoPath, "control-center.db");
  const db = new Database(dbPath);
  db.pragma("foreign_keys = ON");

  const project = findProject(db, options);
  if (!project) {
    console.error("Project not found. Available projects:");
    for (const row of listProjects(db)) {
      console.error(`- ${row.id} ${row.name} (${row.path})`);
    }
    db.close();
    process.exit(1);
  }

  syncWorkOrderRows(db, project.id, workOrders);
  const trackIds = upsertTracks(db, project.id, TRACK_DEFINITIONS);
  const assignmentResult = applyAssignments(
    db,
    project.id,
    trackIds,
    TRACK_ASSIGNMENTS,
    UNASSIGNED_GROUPS
  );

  console.log(`Updated work orders: ${assignmentResult.updated}`);
  console.log(`Cleared work orders: ${assignmentResult.cleared}`);
  if (assignmentResult.missing.length > 0) {
    console.log(`Missing work orders in DB: ${assignmentResult.missing.length}`);
  }

  db.close();
}

main();
