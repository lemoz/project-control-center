import Database from "better-sqlite3";
import path from "path";

export type ProjectIsolationMode = "local" | "vm" | "vm+container";
export type ProjectVmSize = "small" | "medium" | "large" | "xlarge";

export type ProjectRow = {
  id: string;
  path: string;
  name: string;
  description: string | null;
  success_criteria: string | null;
  success_metrics: string | null;
  type: "prototype" | "long_term";
  stage: string;
  status: "active" | "blocked" | "parked";
  priority: number;
  starred: 0 | 1;
  hidden: 0 | 1;
  tags: string; // JSON array
  isolation_mode: ProjectIsolationMode;
  vm_size: ProjectVmSize;
  last_run_at: string | null;
  created_at: string;
  updated_at: string;
};

export type ProjectVmStatus =
  | "not_provisioned"
  | "provisioning"
  | "running"
  | "stopped"
  | "deleted"
  | "error";

export type ProjectVmRow = {
  project_id: string;
  gcp_instance_id: string | null;
  gcp_instance_name: string | null;
  gcp_project: string | null;
  gcp_zone: string | null;
  external_ip: string | null;
  internal_ip: string | null;
  status: ProjectVmStatus;
  size: ProjectVmSize | null;
  created_at: string | null;
  last_started_at: string | null;
  last_activity_at: string | null;
  last_error: string | null;
  total_hours_used: number;
};

export type ProjectVmPatch = Partial<Omit<ProjectVmRow, "project_id">>;

export type RunRow = {
  id: string;
  project_id: string;
  work_order_id: string;
  provider: string;
  status:
    | "queued"
    | "building"
    | "ai_review"
    | "testing"
    | "you_review"
    | "merged"
    | "merge_conflict"
    | "failed"
    | "canceled";
  iteration: number;
  builder_iteration: number;
  reviewer_verdict: "approved" | "changes_requested" | null;
  reviewer_notes: string | null; // JSON array
  summary: string | null;
  branch_name: string | null;
  merge_status: "pending" | "merged" | "conflict" | null;
  conflict_with_run_id: string | null;
  run_dir: string;
  log_path: string;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  error: string | null;
};

export type SettingRow = {
  key: string;
  value: string; // JSON payload
  updated_at: string;
};

export type WorkOrderDepRow = {
  project_id: string;
  work_order_id: string;
  depends_on_id: string;
  created_at: string;
};

let db: Database.Database | null = null;

export function getDb() {
  if (db) return db;
  const dbPath =
    process.env.CONTROL_CENTER_DB_PATH ||
    path.join(process.cwd(), "control-center.db");
  db = new Database(dbPath);
  db.pragma("foreign_keys = ON");
  db.pragma("journal_mode = WAL");
  initSchema(db);
  return db;
}

function initSchema(database: Database.Database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      path TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      success_criteria TEXT,
      success_metrics TEXT NOT NULL DEFAULT '[]',
      type TEXT NOT NULL,
      stage TEXT NOT NULL,
      status TEXT NOT NULL,
      priority INTEGER NOT NULL,
      starred INTEGER NOT NULL DEFAULT 0,
      hidden INTEGER NOT NULL DEFAULT 0,
      tags TEXT NOT NULL DEFAULT '[]',
      isolation_mode TEXT NOT NULL DEFAULT 'local',
      vm_size TEXT NOT NULL DEFAULT 'medium',
      last_run_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS project_vms (
      project_id TEXT PRIMARY KEY,
      gcp_instance_id TEXT,
      gcp_instance_name TEXT,
      gcp_project TEXT,
      gcp_zone TEXT,
      external_ip TEXT,
      internal_ip TEXT,
      status TEXT NOT NULL DEFAULT 'not_provisioned',
      size TEXT,
      created_at TEXT,
      last_started_at TEXT,
      last_activity_at TEXT,
      last_error TEXT,
      total_hours_used REAL NOT NULL DEFAULT 0,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS work_orders (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      title TEXT NOT NULL,
      status TEXT NOT NULL,
      priority INTEGER NOT NULL,
      tags TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_work_orders_project_id ON work_orders(project_id);

    CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      work_order_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      status TEXT NOT NULL,
      iteration INTEGER NOT NULL DEFAULT 1,
      builder_iteration INTEGER NOT NULL DEFAULT 1,
      reviewer_verdict TEXT,
      reviewer_notes TEXT,
      summary TEXT,
      branch_name TEXT,
      merge_status TEXT,
      conflict_with_run_id TEXT,
      run_dir TEXT NOT NULL,
      log_path TEXT NOT NULL,
      created_at TEXT NOT NULL,
      started_at TEXT,
      finished_at TEXT,
      error TEXT,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_runs_project_id_created_at ON runs(project_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_runs_status_created_at ON runs(status, created_at DESC);

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS work_order_deps (
      project_id TEXT NOT NULL,
      work_order_id TEXT NOT NULL,
      depends_on_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (project_id, work_order_id, depends_on_id)
    );

    CREATE INDEX IF NOT EXISTS idx_work_order_deps_depends_on ON work_order_deps(project_id, depends_on_id);

    CREATE TABLE IF NOT EXISTS chat_threads (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL DEFAULT '',
      scope TEXT NOT NULL,
      project_id TEXT,
      work_order_id TEXT,
      summary TEXT NOT NULL DEFAULT '',
      summarized_count INTEGER NOT NULL DEFAULT 0,
      default_context_depth TEXT NOT NULL DEFAULT 'messages',
      default_access_filesystem TEXT NOT NULL DEFAULT 'read-only',
      default_access_cli TEXT NOT NULL DEFAULT 'off',
      default_access_network TEXT NOT NULL DEFAULT 'none',
      default_access_network_allowlist TEXT,
      last_read_at TEXT,
      last_ack_at TEXT,
      archived_at TEXT,
      worktree_path TEXT,
      has_pending_changes INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_chat_threads_scope_project_work_order ON chat_threads(scope, project_id, work_order_id);

    CREATE TABLE IF NOT EXISTS chat_messages (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      id TEXT NOT NULL UNIQUE,
      thread_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      actions_json TEXT,
      run_id TEXT,
      needs_user_input INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      FOREIGN KEY (thread_id) REFERENCES chat_threads(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_chat_messages_thread_seq ON chat_messages(thread_id, seq);

    CREATE TABLE IF NOT EXISTS chat_pending_sends (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      content TEXT NOT NULL,
      context_depth TEXT NOT NULL DEFAULT 'messages',
      access_filesystem TEXT NOT NULL DEFAULT 'read-only',
      access_cli TEXT NOT NULL DEFAULT 'off',
      access_network TEXT NOT NULL DEFAULT 'none',
      access_network_allowlist TEXT,
      suggestion_json TEXT,
      created_at TEXT NOT NULL,
      resolved_at TEXT,
      canceled_at TEXT,
      FOREIGN KEY (thread_id) REFERENCES chat_threads(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_chat_pending_sends_thread_id ON chat_pending_sends(thread_id);

    CREATE TABLE IF NOT EXISTS chat_runs (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      user_message_id TEXT NOT NULL,
      assistant_message_id TEXT,
      status TEXT NOT NULL,
      model TEXT NOT NULL DEFAULT '',
      cli_path TEXT NOT NULL DEFAULT '',
      cwd TEXT NOT NULL,
      log_path TEXT NOT NULL,
      created_at TEXT NOT NULL,
      started_at TEXT,
      finished_at TEXT,
      error TEXT,
      FOREIGN KEY (thread_id) REFERENCES chat_threads(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_chat_runs_thread_created_at ON chat_runs(thread_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_chat_runs_status_created_at ON chat_runs(status, created_at DESC);

    CREATE TABLE IF NOT EXISTS chat_run_commands (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      seq INTEGER NOT NULL,
      cwd TEXT NOT NULL,
      command TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (run_id) REFERENCES chat_runs(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_chat_run_commands_run_id_seq ON chat_run_commands(run_id, seq);

    CREATE TABLE IF NOT EXISTS chat_action_ledger (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      run_id TEXT NOT NULL,
      message_id TEXT NOT NULL,
      action_index INTEGER NOT NULL,
      action_type TEXT NOT NULL,
      action_payload_json TEXT NOT NULL,
      applied_at TEXT NOT NULL,
      undo_payload_json TEXT,
      undone_at TEXT,
      error TEXT,
      error_at TEXT,
      work_order_run_id TEXT,
      FOREIGN KEY (thread_id) REFERENCES chat_threads(id) ON DELETE CASCADE,
      FOREIGN KEY (run_id) REFERENCES chat_runs(id) ON DELETE CASCADE
    );

    CREATE UNIQUE INDEX IF NOT EXISTS uq_chat_action_ledger_message_action ON chat_action_ledger(message_id, action_index);
    CREATE INDEX IF NOT EXISTS idx_chat_action_ledger_thread_applied_at ON chat_action_ledger(thread_id, applied_at DESC);
    CREATE INDEX IF NOT EXISTS idx_chat_action_ledger_run_id ON chat_action_ledger(run_id);
  `);

  // Lightweight migration for existing DBs.
  const projectColumns = database.prepare("PRAGMA table_info(projects)").all() as Array<{ name: string }>;
  const hasStarred = projectColumns.some((c) => c.name === "starred");
  const hasDescription = projectColumns.some((c) => c.name === "description");
  const hasSuccessCriteria = projectColumns.some((c) => c.name === "success_criteria");
  const hasSuccessMetrics = projectColumns.some((c) => c.name === "success_metrics");
  const hasHidden = projectColumns.some((c) => c.name === "hidden");
  const hasIsolationMode = projectColumns.some((c) => c.name === "isolation_mode");
  const hasVmSize = projectColumns.some((c) => c.name === "vm_size");
  if (!hasStarred) {
    database.exec("ALTER TABLE projects ADD COLUMN starred INTEGER NOT NULL DEFAULT 0;");
  }
  if (!hasDescription) {
    database.exec("ALTER TABLE projects ADD COLUMN description TEXT;");
  }
  if (!hasSuccessCriteria) {
    database.exec("ALTER TABLE projects ADD COLUMN success_criteria TEXT;");
  }
  if (!hasSuccessMetrics) {
    database.exec("ALTER TABLE projects ADD COLUMN success_metrics TEXT NOT NULL DEFAULT '[]';");
  }
  if (!hasHidden) {
    database.exec("ALTER TABLE projects ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0;");
  }
  if (!hasIsolationMode) {
    database.exec("ALTER TABLE projects ADD COLUMN isolation_mode TEXT NOT NULL DEFAULT 'local';");
  }
  if (!hasVmSize) {
    database.exec("ALTER TABLE projects ADD COLUMN vm_size TEXT NOT NULL DEFAULT 'medium';");
  }

  const projectVmColumns = database.prepare("PRAGMA table_info(project_vms)").all() as Array<{ name: string }>;
  const hasVmInstanceId = projectVmColumns.some((c) => c.name === "gcp_instance_id");
  const hasVmProject = projectVmColumns.some((c) => c.name === "gcp_project");
  const hasVmLastActivityAt = projectVmColumns.some((c) => c.name === "last_activity_at");
  const hasVmLastError = projectVmColumns.some((c) => c.name === "last_error");
  const hasVmTotalHours = projectVmColumns.some((c) => c.name === "total_hours_used");
  if (!hasVmInstanceId) {
    database.exec("ALTER TABLE project_vms ADD COLUMN gcp_instance_id TEXT;");
  }
  if (!hasVmProject) {
    database.exec("ALTER TABLE project_vms ADD COLUMN gcp_project TEXT;");
  }
  if (!hasVmLastActivityAt) {
    database.exec("ALTER TABLE project_vms ADD COLUMN last_activity_at TEXT;");
  }
  if (!hasVmLastError) {
    database.exec("ALTER TABLE project_vms ADD COLUMN last_error TEXT;");
  }
  if (!hasVmTotalHours) {
    database.exec("ALTER TABLE project_vms ADD COLUMN total_hours_used REAL NOT NULL DEFAULT 0;");
  }

  const runColumns = database.prepare("PRAGMA table_info(runs)").all() as Array<{ name: string }>;
  const hasBranchName = runColumns.some((c) => c.name === "branch_name");
  const hasMergeStatus = runColumns.some((c) => c.name === "merge_status");
  const hasConflictWithRunId = runColumns.some((c) => c.name === "conflict_with_run_id");
  const hasBuilderIteration = runColumns.some((c) => c.name === "builder_iteration");
  if (!hasBranchName) {
    database.exec("ALTER TABLE runs ADD COLUMN branch_name TEXT;");
  }
  if (!hasMergeStatus) {
    database.exec("ALTER TABLE runs ADD COLUMN merge_status TEXT;");
  }
  if (!hasConflictWithRunId) {
    database.exec("ALTER TABLE runs ADD COLUMN conflict_with_run_id TEXT;");
  }
  if (!hasBuilderIteration) {
    database.exec("ALTER TABLE runs ADD COLUMN builder_iteration INTEGER NOT NULL DEFAULT 1;");
  }

  // chat_threads migrations
  const chatThreadColumns = database.prepare("PRAGMA table_info(chat_threads)").all() as Array<{ name: string }>;
  const hasThreadName = chatThreadColumns.some((c) => c.name === "name");
  const hasThreadContextDepth = chatThreadColumns.some((c) => c.name === "default_context_depth");
  const hasThreadAccessFilesystem = chatThreadColumns.some((c) => c.name === "default_access_filesystem");
  const hasThreadAccessCli = chatThreadColumns.some((c) => c.name === "default_access_cli");
  const hasThreadAccessNetwork = chatThreadColumns.some((c) => c.name === "default_access_network");
  const hasThreadAccessNetworkAllowlist = chatThreadColumns.some((c) => c.name === "default_access_network_allowlist");
  const hasThreadLastReadAt = chatThreadColumns.some((c) => c.name === "last_read_at");
  const hasThreadLastAckAt = chatThreadColumns.some((c) => c.name === "last_ack_at");
  const hasThreadArchivedAt = chatThreadColumns.some((c) => c.name === "archived_at");
  const hasThreadWorktreePath = chatThreadColumns.some((c) => c.name === "worktree_path");
  const hasThreadPendingChanges = chatThreadColumns.some((c) => c.name === "has_pending_changes");
  if (!hasThreadName) {
    database.exec("ALTER TABLE chat_threads ADD COLUMN name TEXT NOT NULL DEFAULT '';");
  }
  if (!hasThreadContextDepth) {
    database.exec("ALTER TABLE chat_threads ADD COLUMN default_context_depth TEXT NOT NULL DEFAULT 'messages';");
  }
  if (!hasThreadAccessFilesystem) {
    database.exec("ALTER TABLE chat_threads ADD COLUMN default_access_filesystem TEXT NOT NULL DEFAULT 'read-only';");
  }
  if (!hasThreadAccessCli) {
    database.exec("ALTER TABLE chat_threads ADD COLUMN default_access_cli TEXT NOT NULL DEFAULT 'off';");
  }
  if (!hasThreadAccessNetwork) {
    database.exec("ALTER TABLE chat_threads ADD COLUMN default_access_network TEXT NOT NULL DEFAULT 'none';");
  }
  if (!hasThreadAccessNetworkAllowlist) {
    database.exec("ALTER TABLE chat_threads ADD COLUMN default_access_network_allowlist TEXT;");
  }
  if (!hasThreadLastReadAt) {
    database.exec("ALTER TABLE chat_threads ADD COLUMN last_read_at TEXT;");
  }
  if (!hasThreadLastAckAt) {
    database.exec("ALTER TABLE chat_threads ADD COLUMN last_ack_at TEXT;");
  }
  if (!hasThreadArchivedAt) {
    database.exec("ALTER TABLE chat_threads ADD COLUMN archived_at TEXT;");
  }
  if (!hasThreadWorktreePath) {
    database.exec("ALTER TABLE chat_threads ADD COLUMN worktree_path TEXT;");
  }
  if (!hasThreadPendingChanges) {
    database.exec("ALTER TABLE chat_threads ADD COLUMN has_pending_changes INTEGER NOT NULL DEFAULT 0;");
  }

  // chat_messages migrations
  const chatMessageColumns = database.prepare("PRAGMA table_info(chat_messages)").all() as Array<{ name: string }>;
  const hasNeedsUserInput = chatMessageColumns.some((c) => c.name === "needs_user_input");
  if (!hasNeedsUserInput) {
    database.exec("ALTER TABLE chat_messages ADD COLUMN needs_user_input INTEGER NOT NULL DEFAULT 0;");
  }

  // chat_action_ledger migrations
  const chatActionLedgerColumns = database.prepare("PRAGMA table_info(chat_action_ledger)").all() as Array<{ name: string }>;
  const hasErrorAt = chatActionLedgerColumns.some((c) => c.name === "error_at");
  const hasWorkOrderRunId = chatActionLedgerColumns.some((c) => c.name === "work_order_run_id");
  if (!hasErrorAt) {
    database.exec("ALTER TABLE chat_action_ledger ADD COLUMN error_at TEXT;");
  }
  if (!hasWorkOrderRunId) {
    database.exec("ALTER TABLE chat_action_ledger ADD COLUMN work_order_run_id TEXT;");
  }
}

export function listProjects(): ProjectRow[] {
  const database = getDb();
  return database
    .prepare(
      "SELECT * FROM projects ORDER BY hidden ASC, starred DESC, priority ASC, name ASC"
    )
    .all() as ProjectRow[];
}

export function findProjectByPath(repoPath: string): ProjectRow | null {
  const database = getDb();
  const row = database
    .prepare(
      "SELECT * FROM projects WHERE path = ? ORDER BY priority ASC, created_at ASC LIMIT 1"
    )
    .get(repoPath) as ProjectRow | undefined;
  return row || null;
}

export function listProjectsByPath(repoPath: string): ProjectRow[] {
  const database = getDb();
  return database
    .prepare("SELECT * FROM projects WHERE path = ?")
    .all(repoPath) as ProjectRow[];
}

export function findProjectById(id: string): ProjectRow | null {
  const database = getDb();
  const row = database
    .prepare("SELECT * FROM projects WHERE id = ? LIMIT 1")
    .get(id) as ProjectRow | undefined;
  return row || null;
}

export function deleteProjectsByPathExceptId(
  repoPath: string,
  keepId: string
): number {
  const database = getDb();
  const result = database
    .prepare("DELETE FROM projects WHERE path = ? AND id != ?")
    .run(repoPath, keepId);
  return result.changes;
}

export type ProjectMergeResult = {
  kept_id: string;
  merged_ids: string[];
  moved_runs: number;
  moved_work_orders: number;
  deleted_projects: number;
};

type ProjectIdForeignKey = { table: string; column: string };

function quoteIdentifier(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function listProjectIdForeignKeys(database: Database.Database): ProjectIdForeignKey[] {
  const tables = database
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
    )
    .all() as Array<{ name: string }>;

  const found: ProjectIdForeignKey[] = [];
  for (const t of tables) {
    const tableName = t.name;
    const fkRows = database
      .prepare(`PRAGMA foreign_key_list(${quoteIdentifier(tableName)})`)
      .all() as Array<{ table: string; from: string; to: string }>;
    for (const fk of fkRows) {
      if (fk.table !== "projects") continue;
      if (fk.to !== "id") continue;
      found.push({ table: tableName, column: fk.from });
    }
  }

  const seen = new Set<string>();
  return found.filter((fk) => {
    const key = `${fk.table}\0${fk.column}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function mergeProjectsByPath(
  repoPath: string,
  keepId: string
): ProjectMergeResult {
  const database = getDb();

  const keep = database
    .prepare("SELECT id FROM projects WHERE id = ? LIMIT 1")
    .get(keepId) as { id: string } | undefined;
  if (!keep) {
    return {
      kept_id: keepId,
      merged_ids: [],
      moved_runs: 0,
      moved_work_orders: 0,
      deleted_projects: 0,
    };
  }

  const duplicates = database
    .prepare("SELECT id FROM projects WHERE path = ? AND id != ?")
    .all(repoPath, keepId) as Array<{ id: string }>;
  if (!duplicates.length) {
    return {
      kept_id: keepId,
      merged_ids: [],
      moved_runs: 0,
      moved_work_orders: 0,
      deleted_projects: 0,
    };
  }

  const mergeTx = database.transaction(() => {
    let movedRuns = 0;
    let movedWorkOrders = 0;
    let deletedProjects = 0;
    const mergedIds: string[] = [];

    const moveProjectIdStmts = listProjectIdForeignKeys(database).map((fk) => ({
      ...fk,
      stmt: database.prepare(
        `UPDATE ${quoteIdentifier(fk.table)} SET ${quoteIdentifier(fk.column)} = ? WHERE ${quoteIdentifier(fk.column)} = ?`
      ),
    }));
    const deleteProjectStmt = database.prepare(
      "DELETE FROM projects WHERE id = ? AND id != ?"
    );

    for (const dup of duplicates) {
      const dupId = dup.id;
      if (!dupId || dupId === keepId) continue;
      mergedIds.push(dupId);

      for (const mover of moveProjectIdStmts) {
        const moved = mover.stmt.run(keepId, dupId).changes;
        if (mover.table === "runs" && mover.column === "project_id") movedRuns += moved;
        if (mover.table === "work_orders" && mover.column === "project_id") movedWorkOrders += moved;
      }
      deletedProjects += deleteProjectStmt.run(dupId, keepId).changes;
    }

    return {
      kept_id: keepId,
      merged_ids: mergedIds,
      moved_runs: movedRuns,
      moved_work_orders: movedWorkOrders,
      deleted_projects: deletedProjects,
    } satisfies ProjectMergeResult;
  });

  return mergeTx();
}

export function upsertProject(p: Omit<ProjectRow, "created_at" | "updated_at"> & { created_at?: string; updated_at?: string; }) {
  const database = getDb();
  const now = new Date().toISOString();
  const createdAt = p.created_at || now;
  const updatedAt = p.updated_at || now;
  database
    .prepare(
      `INSERT INTO projects (id, path, name, description, success_criteria, success_metrics, type, stage, status, priority, starred, hidden, tags, isolation_mode, vm_size, last_run_at, created_at, updated_at)
       VALUES (@id, @path, @name, @description, @success_criteria, @success_metrics, @type, @stage, @status, @priority, @starred, @hidden, @tags, @isolation_mode, @vm_size, @last_run_at, @created_at, @updated_at)
       ON CONFLICT(id) DO UPDATE SET
         path=excluded.path,
         name=excluded.name,
         description=COALESCE(excluded.description, projects.description),
         success_criteria=excluded.success_criteria,
         success_metrics=excluded.success_metrics,
         type=excluded.type,
         stage=excluded.stage,
         status=excluded.status,
         priority=excluded.priority,
         starred=excluded.starred,
         hidden=excluded.hidden,
         tags=excluded.tags,
         isolation_mode=excluded.isolation_mode,
         vm_size=excluded.vm_size,
         last_run_at=COALESCE(excluded.last_run_at, projects.last_run_at),
         updated_at=excluded.updated_at`
    )
    .run({
      ...p,
      created_at: createdAt,
      updated_at: updatedAt,
    });
}

export function setProjectStar(id: string, starred: boolean): boolean {
  const database = getDb();
  const now = new Date().toISOString();
  const result = database
    .prepare("UPDATE projects SET starred = ?, updated_at = ? WHERE id = ?")
    .run(starred ? 1 : 0, now, id);
  return result.changes > 0;
}

export function setProjectHidden(id: string, hidden: boolean): boolean {
  const database = getDb();
  const now = new Date().toISOString();
  const result = database
    .prepare("UPDATE projects SET hidden = ?, updated_at = ? WHERE id = ?")
    .run(hidden ? 1 : 0, now, id);
  return result.changes > 0;
}

export function updateProjectIsolationSettings(
  id: string,
  patch: Partial<Pick<ProjectRow, "isolation_mode" | "vm_size">>
): ProjectRow | null {
  const database = getDb();
  const fields: Array<{ key: keyof typeof patch; column: string }> = [
    { key: "isolation_mode", column: "isolation_mode" },
    { key: "vm_size", column: "vm_size" },
  ];
  const sets = fields
    .filter((f) => patch[f.key] !== undefined)
    .map((f) => `${f.column} = @${f.key}`);
  if (!sets.length) return findProjectById(id);
  const now = new Date().toISOString();
  database
    .prepare(`UPDATE projects SET ${sets.join(", ")}, updated_at = @updated_at WHERE id = @id`)
    .run({ id, updated_at: now, ...patch });
  return findProjectById(id);
}

export function updateProjectSuccess(
  id: string,
  patch: Partial<Pick<ProjectRow, "success_criteria" | "success_metrics">>
): ProjectRow | null {
  const database = getDb();
  const fields: Array<{ key: keyof typeof patch; column: string }> = [
    { key: "success_criteria", column: "success_criteria" },
    { key: "success_metrics", column: "success_metrics" },
  ];
  const sets = fields
    .filter((f) => patch[f.key] !== undefined)
    .map((f) => `${f.column} = @${f.key}`);
  if (!sets.length) return findProjectById(id);
  const now = new Date().toISOString();
  database
    .prepare(`UPDATE projects SET ${sets.join(", ")}, updated_at = @updated_at WHERE id = @id`)
    .run({ id, updated_at: now, ...patch });
  return findProjectById(id);
}

export function getProjectVm(projectId: string): ProjectVmRow | null {
  const database = getDb();
  const row = database
    .prepare("SELECT * FROM project_vms WHERE project_id = ? LIMIT 1")
    .get(projectId) as ProjectVmRow | undefined;
  return row || null;
}

export function upsertProjectVm(vm: ProjectVmRow): void {
  const database = getDb();
  database
    .prepare(
      `INSERT INTO project_vms
        (project_id, gcp_instance_id, gcp_instance_name, gcp_project, gcp_zone, external_ip, internal_ip, status, size, created_at, last_started_at, last_activity_at, last_error, total_hours_used)
       VALUES
        (@project_id, @gcp_instance_id, @gcp_instance_name, @gcp_project, @gcp_zone, @external_ip, @internal_ip, @status, @size, @created_at, @last_started_at, @last_activity_at, @last_error, @total_hours_used)
       ON CONFLICT(project_id) DO UPDATE SET
        gcp_instance_id=excluded.gcp_instance_id,
        gcp_instance_name=excluded.gcp_instance_name,
        gcp_project=excluded.gcp_project,
        gcp_zone=excluded.gcp_zone,
        external_ip=excluded.external_ip,
        internal_ip=excluded.internal_ip,
        status=excluded.status,
        size=excluded.size,
        created_at=excluded.created_at,
        last_started_at=excluded.last_started_at,
        last_activity_at=excluded.last_activity_at,
        last_error=excluded.last_error,
        total_hours_used=excluded.total_hours_used`
    )
    .run(vm);
}

export function updateProjectVm(projectId: string, patch: ProjectVmPatch): ProjectVmRow | null {
  const database = getDb();
  const fields: Array<{ key: keyof ProjectVmPatch; column: string }> = [
    { key: "gcp_instance_id", column: "gcp_instance_id" },
    { key: "gcp_instance_name", column: "gcp_instance_name" },
    { key: "gcp_project", column: "gcp_project" },
    { key: "gcp_zone", column: "gcp_zone" },
    { key: "external_ip", column: "external_ip" },
    { key: "internal_ip", column: "internal_ip" },
    { key: "status", column: "status" },
    { key: "size", column: "size" },
    { key: "created_at", column: "created_at" },
    { key: "last_started_at", column: "last_started_at" },
    { key: "last_activity_at", column: "last_activity_at" },
    { key: "last_error", column: "last_error" },
    { key: "total_hours_used", column: "total_hours_used" },
  ];
  const sets = fields
    .filter((f) => patch[f.key] !== undefined)
    .map((f) => `${f.column} = @${f.key}`);
  if (!sets.length) return getProjectVm(projectId);

  database
    .prepare(`UPDATE project_vms SET ${sets.join(", ")} WHERE project_id = @project_id`)
    .run({ project_id: projectId, ...patch });

  const updated = getProjectVm(projectId);
  if (updated) return updated;

  const fallback: ProjectVmRow = {
    project_id: projectId,
    gcp_instance_id: null,
    gcp_instance_name: null,
    gcp_project: null,
    gcp_zone: null,
    external_ip: null,
    internal_ip: null,
    status: "not_provisioned",
    size: null,
    created_at: null,
    last_started_at: null,
    last_activity_at: null,
    last_error: null,
    total_hours_used: 0,
  };
  upsertProjectVm({ ...fallback, ...patch, project_id: projectId });

  return getProjectVm(projectId);
}

export function createRun(run: RunRow): void {
  const database = getDb();
  database
    .prepare(
      `INSERT INTO runs
        (id, project_id, work_order_id, provider, status, iteration, builder_iteration, reviewer_verdict, reviewer_notes, summary, branch_name, merge_status, conflict_with_run_id, run_dir, log_path, created_at, started_at, finished_at, error)
       VALUES
        (@id, @project_id, @work_order_id, @provider, @status, @iteration, @builder_iteration, @reviewer_verdict, @reviewer_notes, @summary, @branch_name, @merge_status, @conflict_with_run_id, @run_dir, @log_path, @created_at, @started_at, @finished_at, @error)`
    )
    .run(run);
}

export function updateRun(
  id: string,
  patch: Partial<
    Pick<
      RunRow,
      | "status"
      | "iteration"
      | "builder_iteration"
      | "reviewer_verdict"
      | "reviewer_notes"
      | "summary"
      | "branch_name"
      | "merge_status"
      | "conflict_with_run_id"
      | "started_at"
      | "finished_at"
      | "error"
    >
  >
): boolean {
  const database = getDb();
  const fields: Array<{ key: keyof typeof patch; column: string }> = [
    { key: "status", column: "status" },
    { key: "iteration", column: "iteration" },
    { key: "builder_iteration", column: "builder_iteration" },
    { key: "reviewer_verdict", column: "reviewer_verdict" },
    { key: "reviewer_notes", column: "reviewer_notes" },
    { key: "summary", column: "summary" },
    { key: "branch_name", column: "branch_name" },
    { key: "merge_status", column: "merge_status" },
    { key: "conflict_with_run_id", column: "conflict_with_run_id" },
    { key: "started_at", column: "started_at" },
    { key: "finished_at", column: "finished_at" },
    { key: "error", column: "error" },
  ];
  const sets = fields
    .filter((f) => patch[f.key] !== undefined)
    .map((f) => `${f.column} = @${f.key}`);
  if (!sets.length) return false;
  const result = database
    .prepare(`UPDATE runs SET ${sets.join(", ")} WHERE id = @id`)
    .run({ id, ...patch });
  return result.changes > 0;
}

export function getRunById(id: string): RunRow | null {
  const database = getDb();
  const row = database
    .prepare("SELECT * FROM runs WHERE id = ? LIMIT 1")
    .get(id) as RunRow | undefined;
  return row || null;
}

export function listRunsByProject(projectId: string, limit = 50): RunRow[] {
  const database = getDb();
  return database
    .prepare(
      "SELECT * FROM runs WHERE project_id = ? ORDER BY created_at DESC LIMIT ?"
    )
    .all(projectId, limit) as RunRow[];
}

export function markWorkOrderRunsMerged(projectId: string, workOrderId: string): number {
  const database = getDb();
  const result = database
    .prepare(
      "UPDATE runs SET status = 'merged' WHERE project_id = ? AND work_order_id = ? AND status = 'you_review'"
    )
    .run(projectId, workOrderId);
  return result.changes;
}

export function markInProgressRunsFailed(reason: string): number {
  const database = getDb();
  const now = new Date().toISOString();
  const result = database
    .prepare(
      `UPDATE runs
       SET status = 'failed',
           error = ?,
           finished_at = COALESCE(finished_at, ?)
       WHERE status IN ('queued', 'building', 'ai_review', 'testing')`
    )
    .run(reason, now);
  return result.changes;
}

export function getSetting(key: string): SettingRow | null {
  const database = getDb();
  const row = database
    .prepare("SELECT * FROM settings WHERE key = ? LIMIT 1")
    .get(key) as SettingRow | undefined;
  return row || null;
}

export function setSetting(key: string, value: string): SettingRow {
  const database = getDb();
  const now = new Date().toISOString();
  database
    .prepare(
      `INSERT INTO settings (key, value, updated_at)
       VALUES (@key, @value, @updated_at)
       ON CONFLICT(key) DO UPDATE SET
         value=excluded.value,
         updated_at=excluded.updated_at`
    )
    .run({ key, value, updated_at: now });
  return (
    getSetting(key) ?? {
      key,
      value,
      updated_at: now,
    }
  );
}

export function syncWorkOrderDeps(
  projectId: string,
  workOrderId: string,
  dependsOn: string[]
): void {
  const database = getDb();
  const now = new Date().toISOString();

  const tx = database.transaction(() => {
    // Delete existing deps for this work order
    database
      .prepare(
        "DELETE FROM work_order_deps WHERE project_id = ? AND work_order_id = ?"
      )
      .run(projectId, workOrderId);

    // Insert new deps
    const insertStmt = database.prepare(
      `INSERT INTO work_order_deps (project_id, work_order_id, depends_on_id, created_at)
       VALUES (?, ?, ?, ?)`
    );
    for (const depId of dependsOn) {
      if (depId && depId !== workOrderId) {
        insertStmt.run(projectId, workOrderId, depId, now);
      }
    }
  });

  tx();
}

export function getWorkOrderDependents(
  projectId: string,
  workOrderId: string
): string[] {
  const database = getDb();
  const rows = database
    .prepare(
      "SELECT work_order_id FROM work_order_deps WHERE project_id = ? AND depends_on_id = ?"
    )
    .all(projectId, workOrderId) as Array<{ work_order_id: string }>;
  return rows.map((r) => r.work_order_id);
}

export function listAllWorkOrderDeps(projectId: string): WorkOrderDepRow[] {
  const database = getDb();
  return database
    .prepare("SELECT * FROM work_order_deps WHERE project_id = ?")
    .all(projectId) as WorkOrderDepRow[];
}
