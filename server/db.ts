import crypto from "crypto";
import Database from "better-sqlite3";
import path from "path";

export const LAST_ESCALATION_AT_KEY = "last_escalation_at";

export type ProjectIsolationMode = "local" | "vm" | "vm+container";
export type ProjectVmSize = "medium" | "large" | "xlarge";

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
  | "installing"
  | "syncing"
  | "installing_deps"
  | "running"
  | "stopped"
  | "deleted"
  | "error";

export type ProjectVmProvider = "gcp";

export type ProjectVmRow = {
  project_id: string;
  provider: ProjectVmProvider | null;
  repo_path: string | null;
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

export type RunFailureCategory =
  | "baseline_failure"
  | "test_failure"
  | "merge_conflict"
  | "build_error"
  | "timeout_or_resource"
  | "agent_error"
  | "canceled"
  | "unknown";

export type RunRow = {
  id: string;
  project_id: string;
  work_order_id: string;
  provider: string;
  status:
    | "queued"
    | "baseline_failed"
    | "building"
    | "waiting_for_input"
    | "ai_review"
    | "testing"
    | "you_review"
    | "merged"
    | "merge_conflict"
    | "failed"
    | "canceled"
    | "superseded";
  iteration: number;
  builder_iteration: number;
  reviewer_verdict: "approved" | "changes_requested" | null;
  reviewer_notes: string | null; // JSON array
  summary: string | null;
  estimated_iterations: number | null;
  estimated_minutes: number | null;
  estimate_confidence: "high" | "medium" | "low" | null;
  estimate_reasoning: string | null;
  current_eta_minutes: number | null;
  estimated_completion_at: string | null;
  eta_history: string | null;
  branch_name: string | null;
  source_branch: string | null;
  merge_status: "pending" | "merged" | "conflict" | null;
  conflict_with_run_id: string | null;
  run_dir: string;
  log_path: string;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  error: string | null;
  failure_category: RunFailureCategory | null;
  failure_reason: string | null;
  failure_detail: string | null;
  escalation: string | null;
};

export type MergeLockRow = {
  project_id: string;
  run_id: string;
  acquired_at: string;
};

export type CostCategory = "builder" | "reviewer" | "chat" | "handoff" | "other";

export type CostRecord = {
  id: string;
  project_id: string;
  run_id: string | null;
  category: CostCategory;
  input_tokens: number;
  output_tokens: number;
  is_actual: number;
  model: string;
  input_cost_per_1k: number;
  output_cost_per_1k: number;
  total_cost_usd: number;
  description: string | null;
  created_at: string;
};

export type EscalationType =
  | "need_input"
  | "blocked"
  | "decision_required"
  | "error"
  | "budget_warning"
  | "budget_critical"
  | "budget_exhausted"
  | "run_blocked";

export type EscalationStatus = "pending" | "claimed" | "resolved" | "escalated_to_user";

export type ProjectCommunicationIntent =
  | "escalation"
  | "request"
  | "message"
  | "suggestion"
  | "status";

export type ProjectCommunicationScope = "project" | "global" | "user";

export type ProjectCommunicationType = EscalationType | ProjectCommunicationIntent | null;

export type ProjectCommunicationRow = {
  id: string;
  project_id: string;
  run_id: string | null;
  shift_id: string | null;
  intent: ProjectCommunicationIntent;
  type: ProjectCommunicationType;
  summary: string;
  body: string | null;
  payload: string | null;
  status: EscalationStatus;
  from_scope: ProjectCommunicationScope;
  from_project_id: string | null;
  to_scope: ProjectCommunicationScope;
  to_project_id: string | null;
  claimed_by: string | null;
  resolution: string | null;
  created_at: string;
  resolved_at: string | null;
  read_at: string | null;
  acknowledged_at: string | null;
};

export type EscalationRow = ProjectCommunicationRow & {
  intent: "escalation";
  type: EscalationType;
};

export type ConstitutionScope = "global" | "project";

export type ConstitutionVersionRow = {
  id: string;
  scope: ConstitutionScope;
  project_id: string | null;
  content: string;
  statements: string;
  source: string;
  created_at: string;
  active: 0 | 1;
};

export type ConstitutionVersion = {
  id: string;
  scope: ConstitutionScope;
  project_id: string | null;
  content: string;
  statements: string[];
  source: string;
  created_at: string;
  active: boolean;
};

export type BudgetEnforcementEventType =
  | "run_blocked"
  | "warning"
  | "critical"
  | "exhausted"
  | "survival_used";

export type BudgetEnforcementLogRow = {
  id: string;
  project_id: string;
  event_type: BudgetEnforcementEventType;
  details: string | null;
  created_at: string;
};

export type RunPhaseMetricPhase = "setup" | "builder" | "test" | "reviewer" | "merge";

export type RunPhaseMetricOutcome =
  | "success"
  | "failed"
  | "changes_requested"
  | "approved"
  | "skipped";

export type RunPhaseMetricRow = {
  id: string;
  run_id: string;
  phase: RunPhaseMetricPhase;
  iteration: number;
  started_at: string;
  ended_at: string | null;
  duration_seconds: number | null;
  outcome: RunPhaseMetricOutcome | null;
  metadata: string | null;
};

export type RunPhaseMetricsSummary = {
  avg_setup_seconds: number;
  avg_builder_seconds: number;
  avg_reviewer_seconds: number;
  avg_iterations: number;
  total_runs: number;
  recent_runs: Array<{ wo_id: string; iterations: number; total_seconds: number }>;
};

export type EstimationContextAverages = {
  setup_seconds: number;
  builder_seconds: number;
  reviewer_seconds: number;
  test_seconds: number;
  iterations: number;
  total_seconds: number;
};

export type EstimationContextRunRow = {
  run_id: string;
  project_id: string;
  work_order_id: string;
  work_order_title: string | null;
  work_order_tags: string[];
  iterations: number;
  total_seconds: number;
  status: RunRow["status"];
  reviewer_verdict: RunRow["reviewer_verdict"];
  created_at: string;
};

export type EstimationContextSummary = {
  averages: EstimationContextAverages;
  sample_size: number;
};

export type WorkOrderRunDuration = {
  work_order_id: string;
  avg_seconds: number;
  run_count: number;
};

export type SettingRow = {
  key: string;
  value: string; // JSON payload
  updated_at: string;
};

export type UserInteractionRow = {
  id: string;
  action_type: string;
  context_json: string | null;
  created_at: string;
};

export type WorkOrderDepRow = {
  project_id: string;
  work_order_id: string;
  depends_on_id: string;
  created_at: string;
};

export type TrackRow = {
  id: string;
  project_id: string;
  name: string;
  description: string | null;
  goal: string | null;
  color: string | null;
  icon: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

export type Track = {
  id: string;
  projectId: string;
  name: string;
  description: string | null;
  goal: string | null;
  color: string | null;
  icon: string | null;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
  workOrderCount?: number;
  doneCount?: number;
  readyCount?: number;
};

export type ShiftStatus = "active" | "completed" | "auto_completed" | "expired" | "failed";

export type ShiftRow = {
  id: string;
  project_id: string;
  status: ShiftStatus;
  agent_type: string | null;
  agent_id: string | null;
  started_at: string;
  completed_at: string | null;
  expires_at: string | null;
  handoff_id: string | null;
  error: string | null;
};

export type ShiftHandoffDecision = {
  decision: string;
  rationale: string;
};

export type ShiftHandoffRow = {
  id: string;
  project_id: string;
  shift_id: string | null;
  summary: string;
  work_completed: string | null;
  recommendations: string | null;
  blockers: string | null;
  next_priorities: string | null;
  decisions_made: string | null;
  agent_id: string | null;
  duration_minutes: number | null;
  created_at: string;
};

export type ShiftHandoff = {
  id: string;
  project_id: string;
  shift_id: string | null;
  summary: string;
  work_completed: string[];
  recommendations: string[];
  blockers: string[];
  next_priorities: string[];
  decisions_made: ShiftHandoffDecision[];
  agent_id: string | null;
  duration_minutes: number | null;
  created_at: string;
};

export type CreateShiftHandoffInput = {
  summary: string;
  work_completed?: string[];
  recommendations?: string[];
  blockers?: string[];
  next_priorities?: string[];
  decisions_made?: ShiftHandoffDecision[];
  agent_id?: string;
  duration_minutes?: number;
};

export type GlobalShiftRow = {
  id: string;
  status: ShiftStatus;
  agent_type: string | null;
  agent_id: string | null;
  session_id: string | null;
  iteration_index: number | null;
  started_at: string;
  completed_at: string | null;
  expires_at: string | null;
  handoff_id: string | null;
  error: string | null;
};

export type GlobalShiftStateSnapshot = {
  projects: Array<{
    id: string;
    name: string;
    status: string;
    health: string;
    active_shift: { id: string; started_at: string; agent_id: string | null } | null;
    escalations: Array<{ id: string; type: string; summary: string }>;
    work_orders: { ready: number; building: number; blocked: number };
    recent_runs: Array<{ id: string; wo_id: string; status: string; outcome: string | null }>;
    last_activity: string | null;
  }>;
  escalation_queue: Array<{
    project_id: string;
    escalation_id: string;
    type: string;
    priority: number;
    waiting_since: string;
  }>;
  resources: {
    vms_running: number;
    vms_available: number;
    budget_used_today: number;
  };
  assembled_at: string;
};

export type GlobalShiftHandoffRow = {
  id: string;
  shift_id: string | null;
  summary: string;
  actions_taken: string | null;
  pending_items: string | null;
  project_state: string | null;
  decisions_made: string | null;
  agent_id: string | null;
  duration_minutes: number | null;
  created_at: string;
};

export type GlobalShiftHandoff = {
  id: string;
  shift_id: string | null;
  summary: string;
  actions_taken: string[];
  pending_items: string[];
  project_state: GlobalShiftStateSnapshot | null;
  decisions_made: ShiftHandoffDecision[];
  agent_id: string | null;
  duration_minutes: number | null;
  created_at: string;
};

export type CreateGlobalShiftHandoffInput = {
  summary: string;
  actions_taken?: string[];
  pending_items?: string[];
  project_state?: GlobalShiftStateSnapshot | null;
  decisions_made?: ShiftHandoffDecision[];
  agent_id?: string;
  duration_minutes?: number;
};

export type GlobalPatternRow = {
  id: string;
  name: string;
  description: string;
  tags: string;
  source_project: string;
  source_wo: string;
  implementation_notes: string | null;
  success_metrics: string | null;
  created_at: string;
};

export type GlobalPattern = {
  id: string;
  name: string;
  description: string;
  tags: string[];
  source_project: string;
  source_wo: string;
  implementation_notes: string;
  success_metrics: string;
  created_at: string;
};

export type CreateGlobalPatternInput = {
  name: string;
  description: string;
  tags: string[];
  source_project: string;
  source_wo: string;
  implementation_notes?: string | null;
  success_metrics?: string | null;
  created_at?: string;
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
      provider TEXT,
      repo_path TEXT,
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

    CREATE TABLE IF NOT EXISTS tracks (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      goal TEXT,
      color TEXT,
      icon TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_tracks_project_id ON tracks(project_id);

    CREATE TABLE IF NOT EXISTS work_orders (
      id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      title TEXT NOT NULL,
      status TEXT NOT NULL,
      priority INTEGER NOT NULL,
      tags TEXT NOT NULL DEFAULT '[]',
      base_branch TEXT,
      track_id TEXT REFERENCES tracks(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (project_id, id),
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
      estimated_iterations INTEGER,
      estimated_minutes INTEGER,
      estimate_confidence TEXT,
      estimate_reasoning TEXT,
      current_eta_minutes INTEGER,
      estimated_completion_at TEXT,
      eta_history TEXT,
      branch_name TEXT,
      source_branch TEXT,
      merge_status TEXT,
      conflict_with_run_id TEXT,
      run_dir TEXT NOT NULL,
      log_path TEXT NOT NULL,
      created_at TEXT NOT NULL,
      started_at TEXT,
      finished_at TEXT,
      error TEXT,
      failure_category TEXT,
      failure_reason TEXT,
      failure_detail TEXT,
      escalation TEXT,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_runs_project_id_created_at ON runs(project_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_runs_status_created_at ON runs(status, created_at DESC);

    CREATE TABLE IF NOT EXISTS merge_locks (
      project_id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      acquired_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS cost_records (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      run_id TEXT,
      category TEXT NOT NULL,
      input_tokens INTEGER NOT NULL,
      output_tokens INTEGER NOT NULL,
      is_actual INTEGER NOT NULL DEFAULT 0,
      model TEXT NOT NULL,
      input_cost_per_1k REAL NOT NULL,
      output_cost_per_1k REAL NOT NULL,
      total_cost_usd REAL NOT NULL,
      description TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_cost_records_project_created
      ON cost_records(project_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS budget_settings (
      id TEXT PRIMARY KEY DEFAULT 'global',
      monthly_budget_usd REAL NOT NULL DEFAULT 0,
      period_start TEXT NOT NULL,
      period_end TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS project_budgets (
      project_id TEXT PRIMARY KEY,
      monthly_allocation_usd REAL NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS budget_enforcement_log (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      details TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_budget_enforcement_project_created
      ON budget_enforcement_log(project_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS escalations (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      run_id TEXT,
      shift_id TEXT,
      intent TEXT NOT NULL DEFAULT 'escalation',
      type TEXT,
      summary TEXT NOT NULL,
      body TEXT,
      payload TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      from_scope TEXT NOT NULL DEFAULT 'project',
      from_project_id TEXT,
      to_scope TEXT NOT NULL DEFAULT 'global',
      to_project_id TEXT,
      claimed_by TEXT,
      resolution TEXT,
      created_at TEXT NOT NULL,
      resolved_at TEXT,
      read_at TEXT,
      acknowledged_at TEXT,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_escalations_project_status ON escalations(project_id, status);
    CREATE INDEX IF NOT EXISTS idx_escalations_status_created_at ON escalations(status, created_at);

    CREATE TABLE IF NOT EXISTS run_phase_metrics (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      phase TEXT NOT NULL,
      iteration INTEGER NOT NULL DEFAULT 1,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      duration_seconds INTEGER,
      outcome TEXT,
      metadata TEXT,
      FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_run_phase_metrics_run ON run_phase_metrics(run_id);

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS constitution_versions (
      id TEXT PRIMARY KEY,
      scope TEXT NOT NULL,
      project_id TEXT,
      content TEXT NOT NULL,
      statements TEXT NOT NULL DEFAULT '[]',
      source TEXT NOT NULL,
      created_at TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_constitution_versions_scope_active
      ON constitution_versions(scope, active, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_constitution_versions_project_active
      ON constitution_versions(project_id, scope, active, created_at DESC);

    CREATE TABLE IF NOT EXISTS user_interactions (
      id TEXT PRIMARY KEY,
      action_type TEXT NOT NULL,
      context_json TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_user_interactions_created
      ON user_interactions(created_at DESC);

    CREATE TABLE IF NOT EXISTS work_order_deps (
      project_id TEXT NOT NULL,
      work_order_id TEXT NOT NULL,
      depends_on_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (project_id, work_order_id, depends_on_id)
    );

    CREATE INDEX IF NOT EXISTS idx_work_order_deps_depends_on ON work_order_deps(project_id, depends_on_id);

    CREATE TABLE IF NOT EXISTS shift_handoffs (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      shift_id TEXT,
      summary TEXT NOT NULL,
      work_completed TEXT,
      recommendations TEXT,
      blockers TEXT,
      next_priorities TEXT,
      decisions_made TEXT,
      agent_id TEXT,
      duration_minutes INTEGER,
      created_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_shift_handoffs_project_created
      ON shift_handoffs(project_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS shifts (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      agent_type TEXT,
      agent_id TEXT,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      expires_at TEXT,
      handoff_id TEXT,
      error TEXT,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (handoff_id) REFERENCES shift_handoffs(id)
    );

    CREATE INDEX IF NOT EXISTS idx_shifts_project_status
      ON shifts(project_id, status);

    CREATE TABLE IF NOT EXISTS global_shift_handoffs (
      id TEXT PRIMARY KEY,
      shift_id TEXT,
      summary TEXT NOT NULL,
      actions_taken TEXT,
      pending_items TEXT,
      project_state TEXT,
      decisions_made TEXT,
      agent_id TEXT,
      duration_minutes INTEGER,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_global_shift_handoffs_created
      ON global_shift_handoffs(created_at DESC);

    CREATE TABLE IF NOT EXISTS global_agent_sessions (
      id TEXT PRIMARY KEY,
      chat_thread_id TEXT,
      state TEXT NOT NULL,
      onboarding_rubric TEXT,
      integrations_configured TEXT,
      goals TEXT,
      priority_projects TEXT,
      constraints TEXT,
      briefing_summary TEXT,
      briefing_confirmed_at TEXT,
      autonomous_started_at TEXT,
      paused_at TEXT,
      iteration_count INTEGER NOT NULL DEFAULT 0,
      decisions_count INTEGER NOT NULL DEFAULT 0,
      actions_count INTEGER NOT NULL DEFAULT 0,
      last_check_in_at TEXT,
      ended_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_global_agent_sessions_state
      ON global_agent_sessions(state);

    CREATE TABLE IF NOT EXISTS global_agent_session_events (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      type TEXT NOT NULL,
      payload TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (session_id) REFERENCES global_agent_sessions(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_global_agent_session_events_session
      ON global_agent_session_events(session_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS global_shifts (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'active',
      agent_type TEXT,
      agent_id TEXT,
      session_id TEXT,
      iteration_index INTEGER,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      expires_at TEXT,
      handoff_id TEXT,
      error TEXT,
      FOREIGN KEY (handoff_id) REFERENCES global_shift_handoffs(id),
      FOREIGN KEY (session_id) REFERENCES global_agent_sessions(id)
    );

    CREATE INDEX IF NOT EXISTS idx_global_shifts_status
      ON global_shifts(status);
    CREATE INDEX IF NOT EXISTS idx_global_shifts_session
      ON global_shifts(session_id);

    CREATE TABLE IF NOT EXISTS global_patterns (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      tags TEXT NOT NULL DEFAULT '[]',
      source_project TEXT NOT NULL,
      source_wo TEXT NOT NULL,
      implementation_notes TEXT,
      success_metrics TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_global_patterns_created
      ON global_patterns(created_at DESC);

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
      context_depth TEXT NOT NULL DEFAULT 'messages',
      access_filesystem TEXT NOT NULL DEFAULT 'read-only',
      access_cli TEXT NOT NULL DEFAULT 'off',
      access_network TEXT NOT NULL DEFAULT 'none',
      access_network_allowlist TEXT,
      suggestion_json TEXT,
      suggestion_accepted INTEGER NOT NULL DEFAULT 0,
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
  const hasVmProvider = projectVmColumns.some((c) => c.name === "provider");
  const hasVmRepoPath = projectVmColumns.some((c) => c.name === "repo_path");
  if (!hasVmInstanceId) {
    database.exec("ALTER TABLE project_vms ADD COLUMN gcp_instance_id TEXT;");
  }
  if (!hasVmProject) {
    database.exec("ALTER TABLE project_vms ADD COLUMN gcp_project TEXT;");
  }
  if (!hasVmProvider) {
    database.exec("ALTER TABLE project_vms ADD COLUMN provider TEXT;");
  }
  if (!hasVmRepoPath) {
    database.exec("ALTER TABLE project_vms ADD COLUMN repo_path TEXT;");
  }
  const envRepoPath = process.env.CONTROL_CENTER_VM_REPO_ROOT;
  const defaultRepoPath = (envRepoPath && envRepoPath.trim()) || "/home/project/repo";
  database.exec("UPDATE project_vms SET provider = COALESCE(provider, 'gcp');");
  database
    .prepare("UPDATE project_vms SET repo_path = COALESCE(repo_path, ?)")
    .run(defaultRepoPath);
  if (!hasVmLastActivityAt) {
    database.exec("ALTER TABLE project_vms ADD COLUMN last_activity_at TEXT;");
  }
  if (!hasVmLastError) {
    database.exec("ALTER TABLE project_vms ADD COLUMN last_error TEXT;");
  }
  if (!hasVmTotalHours) {
    database.exec("ALTER TABLE project_vms ADD COLUMN total_hours_used REAL NOT NULL DEFAULT 0;");
  }

  const trackTableExists = database
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='tracks'")
    .get();
  if (!trackTableExists) {
    database.exec(`
      CREATE TABLE tracks (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        goal TEXT,
        color TEXT,
        icon TEXT,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      );
      CREATE INDEX idx_tracks_project_id ON tracks(project_id);
    `);
  }

  let workOrderColumns = database
    .prepare("PRAGMA table_info(work_orders)")
    .all() as Array<{ name: string; pk: number }>;
  const hasCompositeWorkOrderKey =
    workOrderColumns.some((c) => c.name === "project_id" && c.pk > 0) &&
    workOrderColumns.some((c) => c.name === "id" && c.pk > 0);
  if (workOrderColumns.length && !hasCompositeWorkOrderKey) {
    const hadBaseBranch = workOrderColumns.some((c) => c.name === "base_branch");
    const hadTrackId = workOrderColumns.some((c) => c.name === "track_id");
    const migrate = database.transaction(() => {
      database.exec(`
        CREATE TABLE work_orders_new (
          id TEXT NOT NULL,
          project_id TEXT NOT NULL,
          title TEXT NOT NULL,
          status TEXT NOT NULL,
          priority INTEGER NOT NULL,
          tags TEXT NOT NULL DEFAULT '[]',
          base_branch TEXT,
          track_id TEXT REFERENCES tracks(id) ON DELETE SET NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (project_id, id),
          FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
        );
      `);
      database.exec(`
        INSERT INTO work_orders_new
          (id, project_id, title, status, priority, tags, base_branch, track_id, created_at, updated_at)
        SELECT
          id,
          project_id,
          title,
          status,
          priority,
          tags,
          ${hadBaseBranch ? "base_branch" : "NULL"},
          ${hadTrackId ? "track_id" : "NULL"},
          created_at,
          updated_at
        FROM work_orders;
      `);
      database.exec("DROP TABLE work_orders;");
      database.exec("ALTER TABLE work_orders_new RENAME TO work_orders;");
      database.exec("CREATE INDEX IF NOT EXISTS idx_work_orders_project_id ON work_orders(project_id);");
    });
    migrate();
    workOrderColumns = database
      .prepare("PRAGMA table_info(work_orders)")
      .all() as Array<{ name: string; pk: number }>;
  }

  const hasWorkOrderBaseBranch = workOrderColumns.some((c) => c.name === "base_branch");
  const hasWorkOrderTrackId = workOrderColumns.some((c) => c.name === "track_id");
  if (!hasWorkOrderBaseBranch) {
    database.exec("ALTER TABLE work_orders ADD COLUMN base_branch TEXT;");
  }
  if (!hasWorkOrderTrackId) {
    database.exec(
      "ALTER TABLE work_orders ADD COLUMN track_id TEXT REFERENCES tracks(id) ON DELETE SET NULL;"
    );
  }

  const runColumns = database.prepare("PRAGMA table_info(runs)").all() as Array<{ name: string }>;
  const hasBranchName = runColumns.some((c) => c.name === "branch_name");
  const hasSourceBranch = runColumns.some((c) => c.name === "source_branch");
  const hasMergeStatus = runColumns.some((c) => c.name === "merge_status");
  const hasConflictWithRunId = runColumns.some((c) => c.name === "conflict_with_run_id");
  const hasBuilderIteration = runColumns.some((c) => c.name === "builder_iteration");
  const hasEstimatedIterations = runColumns.some((c) => c.name === "estimated_iterations");
  const hasEstimatedMinutes = runColumns.some((c) => c.name === "estimated_minutes");
  const hasEstimateConfidence = runColumns.some((c) => c.name === "estimate_confidence");
  const hasEstimateReasoning = runColumns.some((c) => c.name === "estimate_reasoning");
  const hasCurrentEtaMinutes = runColumns.some((c) => c.name === "current_eta_minutes");
  const hasEstimatedCompletionAt = runColumns.some((c) => c.name === "estimated_completion_at");
  const hasEtaHistory = runColumns.some((c) => c.name === "eta_history");
  const hasEscalation = runColumns.some((c) => c.name === "escalation");
  const hasFailureCategory = runColumns.some((c) => c.name === "failure_category");
  const hasFailureReason = runColumns.some((c) => c.name === "failure_reason");
  const hasFailureDetail = runColumns.some((c) => c.name === "failure_detail");
  if (!hasBranchName) {
    database.exec("ALTER TABLE runs ADD COLUMN branch_name TEXT;");
  }
  if (!hasSourceBranch) {
    database.exec("ALTER TABLE runs ADD COLUMN source_branch TEXT;");
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
  if (!hasEstimatedIterations) {
    database.exec("ALTER TABLE runs ADD COLUMN estimated_iterations INTEGER;");
  }
  if (!hasEstimatedMinutes) {
    database.exec("ALTER TABLE runs ADD COLUMN estimated_minutes INTEGER;");
  }
  if (!hasEstimateConfidence) {
    database.exec("ALTER TABLE runs ADD COLUMN estimate_confidence TEXT;");
  }
  if (!hasEstimateReasoning) {
    database.exec("ALTER TABLE runs ADD COLUMN estimate_reasoning TEXT;");
  }
  if (!hasCurrentEtaMinutes) {
    database.exec("ALTER TABLE runs ADD COLUMN current_eta_minutes INTEGER;");
  }
  if (!hasEstimatedCompletionAt) {
    database.exec("ALTER TABLE runs ADD COLUMN estimated_completion_at TEXT;");
  }
  if (!hasEtaHistory) {
    database.exec("ALTER TABLE runs ADD COLUMN eta_history TEXT;");
  }
  if (!hasFailureCategory) {
    database.exec("ALTER TABLE runs ADD COLUMN failure_category TEXT;");
  }
  if (!hasFailureReason) {
    database.exec("ALTER TABLE runs ADD COLUMN failure_reason TEXT;");
  }
  if (!hasFailureDetail) {
    database.exec("ALTER TABLE runs ADD COLUMN failure_detail TEXT;");
  }
  if (!hasEscalation) {
    database.exec("ALTER TABLE runs ADD COLUMN escalation TEXT;");
  }

  const escalationColumns = database
    .prepare("PRAGMA table_info(escalations)")
    .all() as Array<{ name: string }>;
  const hasIntent = escalationColumns.some((c) => c.name === "intent");
  const hasFromScope = escalationColumns.some((c) => c.name === "from_scope");
  const hasFromProjectId = escalationColumns.some((c) => c.name === "from_project_id");
  const hasToScope = escalationColumns.some((c) => c.name === "to_scope");
  const hasToProjectId = escalationColumns.some((c) => c.name === "to_project_id");
  const hasBody = escalationColumns.some((c) => c.name === "body");
  const hasReadAt = escalationColumns.some((c) => c.name === "read_at");
  const hasAcknowledgedAt = escalationColumns.some((c) => c.name === "acknowledged_at");
  const hasEscalationType = escalationColumns.some((c) => c.name === "type");
  if (!hasIntent) {
    database.exec("ALTER TABLE escalations ADD COLUMN intent TEXT NOT NULL DEFAULT 'escalation';");
  }
  if (!hasEscalationType) {
    database.exec("ALTER TABLE escalations ADD COLUMN type TEXT;");
  }
  if (!hasBody) {
    database.exec("ALTER TABLE escalations ADD COLUMN body TEXT;");
  }
  if (!hasFromScope) {
    database.exec("ALTER TABLE escalations ADD COLUMN from_scope TEXT NOT NULL DEFAULT 'project';");
  }
  if (!hasFromProjectId) {
    database.exec("ALTER TABLE escalations ADD COLUMN from_project_id TEXT;");
  }
  if (!hasToScope) {
    database.exec("ALTER TABLE escalations ADD COLUMN to_scope TEXT NOT NULL DEFAULT 'global';");
  }
  if (!hasToProjectId) {
    database.exec("ALTER TABLE escalations ADD COLUMN to_project_id TEXT;");
  }
  if (!hasReadAt) {
    database.exec("ALTER TABLE escalations ADD COLUMN read_at TEXT;");
  }
  if (!hasAcknowledgedAt) {
    database.exec("ALTER TABLE escalations ADD COLUMN acknowledged_at TEXT;");
  }
  if (escalationColumns.length > 0) {
    database.exec(`
      UPDATE escalations
      SET
        intent = COALESCE(NULLIF(intent, ''), 'escalation'),
        from_scope = COALESCE(NULLIF(from_scope, ''), 'project'),
        to_scope = COALESCE(NULLIF(to_scope, ''), 'global'),
        from_project_id = CASE
          WHEN from_scope IS NULL OR from_scope = '' OR from_scope = 'project'
            THEN COALESCE(from_project_id, project_id)
          ELSE from_project_id
        END
    `);
  }

  const costRecordColumns = database
    .prepare("PRAGMA table_info(cost_records)")
    .all() as Array<{ name: string }>;
  const hasCostActual = costRecordColumns.some((c) => c.name === "is_actual");
  if (!hasCostActual) {
    database.exec("ALTER TABLE cost_records ADD COLUMN is_actual INTEGER NOT NULL DEFAULT 0;");
    database.exec(
      "UPDATE cost_records SET is_actual = 1 WHERE (input_tokens > 0 OR output_tokens > 0) AND (description IS NULL OR description NOT LIKE '%estimated%');"
    );
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

  // chat_runs migrations
  const chatRunColumns = database.prepare("PRAGMA table_info(chat_runs)").all() as Array<{ name: string }>;
  const hasRunContextDepth = chatRunColumns.some((c) => c.name === "context_depth");
  const hasRunAccessFilesystem = chatRunColumns.some((c) => c.name === "access_filesystem");
  const hasRunAccessCli = chatRunColumns.some((c) => c.name === "access_cli");
  const hasRunAccessNetwork = chatRunColumns.some((c) => c.name === "access_network");
  const hasRunAccessNetworkAllowlist = chatRunColumns.some(
    (c) => c.name === "access_network_allowlist"
  );
  const hasRunSuggestionJson = chatRunColumns.some((c) => c.name === "suggestion_json");
  const hasRunSuggestionAccepted = chatRunColumns.some((c) => c.name === "suggestion_accepted");
  if (!hasRunContextDepth) {
    database.exec("ALTER TABLE chat_runs ADD COLUMN context_depth TEXT NOT NULL DEFAULT 'messages';");
  }
  if (!hasRunAccessFilesystem) {
    database.exec("ALTER TABLE chat_runs ADD COLUMN access_filesystem TEXT NOT NULL DEFAULT 'read-only';");
  }
  if (!hasRunAccessCli) {
    database.exec("ALTER TABLE chat_runs ADD COLUMN access_cli TEXT NOT NULL DEFAULT 'off';");
  }
  if (!hasRunAccessNetwork) {
    database.exec("ALTER TABLE chat_runs ADD COLUMN access_network TEXT NOT NULL DEFAULT 'none';");
  }
  if (!hasRunAccessNetworkAllowlist) {
    database.exec("ALTER TABLE chat_runs ADD COLUMN access_network_allowlist TEXT;");
  }
  if (!hasRunSuggestionJson) {
    database.exec("ALTER TABLE chat_runs ADD COLUMN suggestion_json TEXT;");
  }
  if (!hasRunSuggestionAccepted) {
    database.exec("ALTER TABLE chat_runs ADD COLUMN suggestion_accepted INTEGER NOT NULL DEFAULT 0;");
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

  const globalShiftColumns = database
    .prepare("PRAGMA table_info(global_shifts)")
    .all() as Array<{ name: string }>;
  const hasGlobalSessionId = globalShiftColumns.some((c) => c.name === "session_id");
  const hasGlobalIterationIndex = globalShiftColumns.some(
    (c) => c.name === "iteration_index"
  );
  if (!hasGlobalSessionId) {
    database.exec(
      "ALTER TABLE global_shifts ADD COLUMN session_id TEXT REFERENCES global_agent_sessions(id);"
    );
  }
  if (!hasGlobalIterationIndex) {
    database.exec("ALTER TABLE global_shifts ADD COLUMN iteration_index INTEGER;");
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

    // Preserve starred if any duplicate was starred
    const anyStarred = database
      .prepare("SELECT 1 FROM projects WHERE path = ? AND starred = 1 LIMIT 1")
      .get(repoPath);
    if (anyStarred) {
      database
        .prepare("UPDATE projects SET starred = 1 WHERE id = ?")
        .run(keepId);
    }

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
         starred=projects.starred,
         hidden=projects.hidden,
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

export function updateProjectStatus(id: string, status: ProjectRow["status"]): ProjectRow | null {
  const database = getDb();
  const now = new Date().toISOString();
  database
    .prepare("UPDATE projects SET status = ?, updated_at = ? WHERE id = ?")
    .run(status, now, id);
  return findProjectById(id);
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
        (project_id, provider, repo_path, gcp_instance_id, gcp_instance_name, gcp_project, gcp_zone, external_ip, internal_ip, status, size, created_at, last_started_at, last_activity_at, last_error, total_hours_used)
       VALUES
        (@project_id, @provider, @repo_path, @gcp_instance_id, @gcp_instance_name, @gcp_project, @gcp_zone, @external_ip, @internal_ip, @status, @size, @created_at, @last_started_at, @last_activity_at, @last_error, @total_hours_used)
       ON CONFLICT(project_id) DO UPDATE SET
        provider=excluded.provider,
        repo_path=excluded.repo_path,
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
    { key: "provider", column: "provider" },
    { key: "repo_path", column: "repo_path" },
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
    provider: null,
    repo_path: null,
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
        (id, project_id, work_order_id, provider, status, iteration, builder_iteration, reviewer_verdict, reviewer_notes, summary, estimated_iterations, estimated_minutes, estimate_confidence, estimate_reasoning, current_eta_minutes, estimated_completion_at, eta_history, branch_name, source_branch, merge_status, conflict_with_run_id, run_dir, log_path, created_at, started_at, finished_at, error, failure_category, failure_reason, failure_detail, escalation)
       VALUES
        (@id, @project_id, @work_order_id, @provider, @status, @iteration, @builder_iteration, @reviewer_verdict, @reviewer_notes, @summary, @estimated_iterations, @estimated_minutes, @estimate_confidence, @estimate_reasoning, @current_eta_minutes, @estimated_completion_at, @eta_history, @branch_name, @source_branch, @merge_status, @conflict_with_run_id, @run_dir, @log_path, @created_at, @started_at, @finished_at, @error, @failure_category, @failure_reason, @failure_detail, @escalation)`
    )
    .run(run);
}

export function createCostRecord(record: CostRecord): void {
  const database = getDb();
  database
    .prepare(
      `INSERT INTO cost_records
        (id, project_id, run_id, category, input_tokens, output_tokens, is_actual, model, input_cost_per_1k, output_cost_per_1k, total_cost_usd, description, created_at)
       VALUES
        (@id, @project_id, @run_id, @category, @input_tokens, @output_tokens, @is_actual, @model, @input_cost_per_1k, @output_cost_per_1k, @total_cost_usd, @description, @created_at)`
    )
    .run(record);
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
      | "estimated_iterations"
      | "estimated_minutes"
      | "estimate_confidence"
      | "estimate_reasoning"
      | "current_eta_minutes"
      | "estimated_completion_at"
      | "eta_history"
      | "branch_name"
      | "merge_status"
      | "conflict_with_run_id"
      | "started_at"
      | "finished_at"
      | "error"
      | "failure_category"
      | "failure_reason"
      | "failure_detail"
      | "escalation"
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
    { key: "estimated_iterations", column: "estimated_iterations" },
    { key: "estimated_minutes", column: "estimated_minutes" },
    { key: "estimate_confidence", column: "estimate_confidence" },
    { key: "estimate_reasoning", column: "estimate_reasoning" },
    { key: "current_eta_minutes", column: "current_eta_minutes" },
    { key: "estimated_completion_at", column: "estimated_completion_at" },
    { key: "eta_history", column: "eta_history" },
    { key: "branch_name", column: "branch_name" },
    { key: "merge_status", column: "merge_status" },
    { key: "conflict_with_run_id", column: "conflict_with_run_id" },
    { key: "started_at", column: "started_at" },
    { key: "finished_at", column: "finished_at" },
    { key: "error", column: "error" },
    { key: "failure_category", column: "failure_category" },
    { key: "failure_reason", column: "failure_reason" },
    { key: "failure_detail", column: "failure_detail" },
    { key: "escalation", column: "escalation" },
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

const MERGE_LOCK_TTL_MS = 10 * 60 * 1000;

export function acquireMergeLock(projectId: string, runId: string): boolean {
  const database = getDb();
  const now = new Date();
  const cutoff = new Date(now.getTime() - MERGE_LOCK_TTL_MS).toISOString();
  database.prepare("DELETE FROM merge_locks WHERE acquired_at < ?").run(cutoff);

  const insert = database
    .prepare(
      "INSERT OR IGNORE INTO merge_locks (project_id, run_id, acquired_at) VALUES (?, ?, ?)"
    )
    .run(projectId, runId, now.toISOString());
  if (insert.changes > 0) return true;

  const existing = database
    .prepare("SELECT * FROM merge_locks WHERE project_id = ?")
    .get(projectId) as MergeLockRow | undefined;
  return existing?.run_id === runId;
}

export function releaseMergeLock(projectId: string, runId: string): void {
  const database = getDb();
  database
    .prepare("DELETE FROM merge_locks WHERE project_id = ? AND run_id = ?")
    .run(projectId, runId);
}

export function getMergeLock(projectId: string): MergeLockRow | null {
  const database = getDb();
  const row = database
    .prepare("SELECT * FROM merge_locks WHERE project_id = ? LIMIT 1")
    .get(projectId) as MergeLockRow | undefined;
  return row || null;
}

export function createBudgetEnforcementLog(input: {
  project_id: string;
  event_type: BudgetEnforcementEventType;
  details?: string | null;
  created_at?: string;
}): BudgetEnforcementLogRow {
  const database = getDb();
  const row: BudgetEnforcementLogRow = {
    id: crypto.randomUUID(),
    project_id: input.project_id,
    event_type: input.event_type,
    details: input.details ?? null,
    created_at: input.created_at ?? new Date().toISOString(),
  };
  database
    .prepare(
      `INSERT INTO budget_enforcement_log
        (id, project_id, event_type, details, created_at)
       VALUES
        (@id, @project_id, @event_type, @details, @created_at)`
    )
    .run(row);
  return row;
}

export function listBudgetEnforcementLog(projectId: string, limit = 50): BudgetEnforcementLogRow[] {
  const database = getDb();
  const safeLimit =
    Number.isFinite(limit) && limit > 0 ? Math.min(200, Math.trunc(limit)) : 50;
  return database
    .prepare(
      `SELECT id, project_id, event_type, details, created_at
       FROM budget_enforcement_log
       WHERE project_id = ?
       ORDER BY created_at DESC
       LIMIT ?`
    )
    .all(projectId, safeLimit) as BudgetEnforcementLogRow[];
}

export function hasBudgetEnforcementEvent(params: {
  projectId: string;
  eventType: BudgetEnforcementEventType;
  since: string;
}): boolean {
  const database = getDb();
  const row = database
    .prepare(
      `SELECT 1
       FROM budget_enforcement_log
       WHERE project_id = ?
         AND event_type = ?
         AND created_at >= ?
       LIMIT 1`
    )
    .get(params.projectId, params.eventType, params.since) as { "1"?: number } | undefined;
  return Boolean(row);
}

export type ProjectCommunicationQuery = {
  projectId?: string;
  intents?: ProjectCommunicationIntent[];
  statuses?: EscalationStatus[];
  fromScope?: ProjectCommunicationScope;
  fromProjectId?: string;
  toScope?: ProjectCommunicationScope;
  toProjectId?: string;
  unreadOnly?: boolean;
  unacknowledgedOnly?: boolean;
  limit?: number;
  order?: "asc" | "desc";
};

export type CreateProjectCommunicationInput = {
  project_id: string;
  intent: ProjectCommunicationIntent;
  summary: string;
  body?: string | null;
  payload?: string | null;
  run_id?: string | null;
  shift_id?: string | null;
  type?: EscalationType | null;
  status?: EscalationStatus;
  from_scope?: ProjectCommunicationScope;
  from_project_id?: string | null;
  to_scope?: ProjectCommunicationScope;
  to_project_id?: string | null;
};

export function createProjectCommunication(
  input: CreateProjectCommunicationInput
): ProjectCommunicationRow {
  const database = getDb();
  const fromScope: ProjectCommunicationScope = input.from_scope ?? "project";
  const toScope: ProjectCommunicationScope = input.to_scope ?? "global";
  const resolvedType: ProjectCommunicationType =
    input.type ?? (input.intent === "escalation" ? null : input.intent);
  const row: ProjectCommunicationRow = {
    id: crypto.randomUUID(),
    project_id: input.project_id,
    run_id: input.run_id ?? null,
    shift_id: input.shift_id ?? null,
    intent: input.intent,
    type: resolvedType,
    summary: input.summary,
    body: input.body ?? null,
    payload: input.payload ?? null,
    status: input.status ?? "pending",
    from_scope: fromScope,
    from_project_id:
      input.from_project_id ??
      (fromScope === "project" ? input.project_id : null),
    to_scope: toScope,
    to_project_id: input.to_project_id ?? null,
    claimed_by: null,
    resolution: null,
    created_at: new Date().toISOString(),
    resolved_at: null,
    read_at: null,
    acknowledged_at: null,
  };
  database
    .prepare(
      `INSERT INTO escalations
        (id, project_id, run_id, shift_id, intent, type, summary, body, payload, status, from_scope, from_project_id, to_scope, to_project_id, claimed_by, resolution, created_at, resolved_at, read_at, acknowledged_at)
       VALUES
        (@id, @project_id, @run_id, @shift_id, @intent, @type, @summary, @body, @payload, @status, @from_scope, @from_project_id, @to_scope, @to_project_id, @claimed_by, @resolution, @created_at, @resolved_at, @read_at, @acknowledged_at)`
    )
    .run(row);
  return row;
}

export function getProjectCommunicationById(id: string): ProjectCommunicationRow | null {
  const database = getDb();
  const row = database
    .prepare("SELECT * FROM escalations WHERE id = ? LIMIT 1")
    .get(id) as ProjectCommunicationRow | undefined;
  return row || null;
}

export function listProjectCommunications(
  query: ProjectCommunicationQuery = {}
): ProjectCommunicationRow[] {
  const database = getDb();
  const clauses: string[] = [];
  const params: Array<string | number> = [];

  if (query.projectId) {
    clauses.push("project_id = ?");
    params.push(query.projectId);
  }

  if (query.intents) {
    if (!query.intents.length) return [];
    if (query.intents.length === 1) {
      clauses.push("intent = ?");
      params.push(query.intents[0]);
    } else {
      const placeholders = query.intents.map(() => "?").join(", ");
      clauses.push(`intent IN (${placeholders})`);
      params.push(...query.intents);
    }
  }

  if (query.statuses) {
    if (!query.statuses.length) return [];
    if (query.statuses.length === 1) {
      clauses.push("status = ?");
      params.push(query.statuses[0]);
    } else {
      const placeholders = query.statuses.map(() => "?").join(", ");
      clauses.push(`status IN (${placeholders})`);
      params.push(...query.statuses);
    }
  }

  if (query.fromScope) {
    clauses.push("from_scope = ?");
    params.push(query.fromScope);
  }

  if (query.fromProjectId) {
    clauses.push("from_project_id = ?");
    params.push(query.fromProjectId);
  }

  if (query.toScope) {
    clauses.push("to_scope = ?");
    params.push(query.toScope);
  }

  if (query.toProjectId) {
    clauses.push("to_project_id = ?");
    params.push(query.toProjectId);
  }

  if (query.unreadOnly) {
    clauses.push("read_at IS NULL");
  }

  if (query.unacknowledgedOnly) {
    clauses.push("acknowledged_at IS NULL");
  }

  const whereClause = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const order = query.order === "desc" ? "DESC" : "ASC";
  const limit =
    typeof query.limit === "number" && Number.isFinite(query.limit)
      ? Math.max(1, Math.min(200, Math.trunc(query.limit)))
      : 100;
  const rows = database
    .prepare(
      `SELECT * FROM escalations ${whereClause} ORDER BY created_at ${order} LIMIT ?`
    )
    .all(...params, limit) as ProjectCommunicationRow[];
  return rows;
}

export function updateProjectCommunication(
  id: string,
  patch: Partial<
    Pick<
      ProjectCommunicationRow,
      | "status"
      | "claimed_by"
      | "resolution"
      | "resolved_at"
      | "read_at"
      | "acknowledged_at"
    >
  >
): boolean {
  const database = getDb();
  const fields: Array<{ key: keyof typeof patch; column: string }> = [
    { key: "status", column: "status" },
    { key: "claimed_by", column: "claimed_by" },
    { key: "resolution", column: "resolution" },
    { key: "resolved_at", column: "resolved_at" },
    { key: "read_at", column: "read_at" },
    { key: "acknowledged_at", column: "acknowledged_at" },
  ];
  const sets = fields
    .filter((field) => patch[field.key] !== undefined)
    .map((field) => `${field.column} = @${field.key}`);
  if (!sets.length) return false;
  const result = database
    .prepare(`UPDATE escalations SET ${sets.join(", ")} WHERE id = @id`)
    .run({ id, ...patch });
  return result.changes > 0;
}

export type EscalationQuery = {
  projectId?: string;
  statuses?: EscalationStatus[];
  limit?: number;
  order?: "asc" | "desc";
};

export function createEscalation(input: {
  project_id: string;
  run_id?: string | null;
  shift_id?: string | null;
  type: EscalationType;
  summary: string;
  payload?: string | null;
}): EscalationRow {
  const database = getDb();
  const row: EscalationRow = {
    id: crypto.randomUUID(),
    project_id: input.project_id,
    run_id: input.run_id ?? null,
    shift_id: input.shift_id ?? null,
    intent: "escalation",
    type: input.type,
    summary: input.summary,
    body: null,
    payload: input.payload ?? null,
    status: "pending",
    from_scope: "project",
    from_project_id: input.project_id,
    to_scope: "global",
    to_project_id: null,
    claimed_by: null,
    resolution: null,
    created_at: new Date().toISOString(),
    resolved_at: null,
    read_at: null,
    acknowledged_at: null,
  };
  database
    .prepare(
      `INSERT INTO escalations
        (id, project_id, run_id, shift_id, intent, type, summary, body, payload, status, from_scope, from_project_id, to_scope, to_project_id, claimed_by, resolution, created_at, resolved_at, read_at, acknowledged_at)
       VALUES
        (@id, @project_id, @run_id, @shift_id, @intent, @type, @summary, @body, @payload, @status, @from_scope, @from_project_id, @to_scope, @to_project_id, @claimed_by, @resolution, @created_at, @resolved_at, @read_at, @acknowledged_at)`
    )
    .run(row);
  return row;
}

export function getEscalationById(id: string): EscalationRow | null {
  const database = getDb();
  const row = database
    .prepare("SELECT * FROM escalations WHERE id = ? AND intent = 'escalation' LIMIT 1")
    .get(id) as EscalationRow | undefined;
  return row || null;
}

export function listEscalations(query: EscalationQuery = {}): EscalationRow[] {
  const database = getDb();
  const clauses: string[] = [];
  const params: Array<string | number> = [];

  clauses.push("intent = 'escalation'");

  if (query.projectId) {
    clauses.push("project_id = ?");
    params.push(query.projectId);
  }

  if (query.statuses) {
    if (!query.statuses.length) return [];
    if (query.statuses.length === 1) {
      clauses.push("status = ?");
      params.push(query.statuses[0]);
    } else {
      const placeholders = query.statuses.map(() => "?").join(", ");
      clauses.push(`status IN (${placeholders})`);
      params.push(...query.statuses);
    }
  }

  const whereClause = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const order = query.order === "desc" ? "DESC" : "ASC";
  const limit =
    typeof query.limit === "number" && Number.isFinite(query.limit)
      ? Math.max(1, Math.min(200, Math.trunc(query.limit)))
      : 100;
  const rows = database
    .prepare(
      `SELECT * FROM escalations ${whereClause} ORDER BY created_at ${order} LIMIT ?`
    )
    .all(...params, limit) as EscalationRow[];
  return rows;
}

export function updateEscalation(
  id: string,
  patch: Partial<Pick<EscalationRow, "status" | "claimed_by" | "resolution" | "resolved_at">>
): boolean {
  const database = getDb();
  const fields: Array<{ key: keyof typeof patch; column: string }> = [
    { key: "status", column: "status" },
    { key: "claimed_by", column: "claimed_by" },
    { key: "resolution", column: "resolution" },
    { key: "resolved_at", column: "resolved_at" },
  ];
  const sets = fields
    .filter((field) => patch[field.key] !== undefined)
    .map((field) => `${field.column} = @${field.key}`);
  if (!sets.length) return false;
  const result = database
    .prepare(
      `UPDATE escalations SET ${sets.join(", ")} WHERE id = @id AND intent = 'escalation'`
    )
    .run({ id, ...patch });
  const updated = result.changes > 0;
  if (updated && patch.status === "escalated_to_user") {
    setSetting(LAST_ESCALATION_AT_KEY, new Date().toISOString());
  }
  return updated;
}

export function getOpenEscalationForProject(projectId: string): EscalationRow | null {
  const database = getDb();
  const row = database
    .prepare(
      "SELECT * FROM escalations WHERE project_id = ? AND intent = 'escalation' AND status = 'escalated_to_user' ORDER BY created_at DESC LIMIT 1"
    )
    .get(projectId) as EscalationRow | undefined;
  return row || null;
}

export function createRunPhaseMetric(input: {
  run_id: string;
  phase: RunPhaseMetricPhase;
  iteration?: number;
  started_at: string;
  ended_at?: string | null;
  duration_seconds?: number | null;
  outcome?: RunPhaseMetricOutcome | null;
  metadata?: string | null;
}): RunPhaseMetricRow {
  const database = getDb();
  const iteration =
    typeof input.iteration === "number" && Number.isFinite(input.iteration)
      ? Math.max(1, Math.trunc(input.iteration))
      : 1;
  const durationSeconds =
    typeof input.duration_seconds === "number" &&
    Number.isFinite(input.duration_seconds)
      ? Math.trunc(input.duration_seconds)
      : null;
  const row: RunPhaseMetricRow = {
    id: crypto.randomUUID(),
    run_id: input.run_id,
    phase: input.phase,
    iteration,
    started_at: input.started_at,
    ended_at: input.ended_at ?? null,
    duration_seconds: durationSeconds,
    outcome: input.outcome ?? null,
    metadata: input.metadata ?? null,
  };
  database
    .prepare(
      `INSERT INTO run_phase_metrics
        (id, run_id, phase, iteration, started_at, ended_at, duration_seconds, outcome, metadata)
       VALUES
        (@id, @run_id, @phase, @iteration, @started_at, @ended_at, @duration_seconds, @outcome, @metadata)`
    )
    .run(row);
  return row;
}

export function listRunPhaseMetrics(runId: string): RunPhaseMetricRow[] {
  const database = getDb();
  return database
    .prepare(
      "SELECT * FROM run_phase_metrics WHERE run_id = ? ORDER BY started_at ASC, phase ASC"
    )
    .all(runId) as RunPhaseMetricRow[];
}

export function getRunPhaseMetricsSummary(
  projectId: string,
  recentLimit = 10
): RunPhaseMetricsSummary {
  const database = getDb();
  const totalRunsRow = database
    .prepare("SELECT COUNT(1) AS total_runs FROM runs WHERE project_id = ?")
    .get(projectId) as { total_runs: number } | undefined;
  const avgIterationsRow = database
    .prepare("SELECT AVG(iteration) AS avg_iterations FROM runs WHERE project_id = ?")
    .get(projectId) as { avg_iterations: number | null } | undefined;
  const phaseRows = database
    .prepare(
      `SELECT m.phase AS phase, AVG(m.duration_seconds) AS avg_seconds
       FROM run_phase_metrics m
       JOIN runs r ON r.id = m.run_id
       WHERE r.project_id = ? AND m.duration_seconds IS NOT NULL
       GROUP BY m.phase`
    )
    .all(projectId) as Array<{ phase: RunPhaseMetricPhase; avg_seconds: number | null }>;

  const phaseAverages = new Map<RunPhaseMetricPhase, number>();
  for (const row of phaseRows) {
    if (typeof row.avg_seconds === "number" && Number.isFinite(row.avg_seconds)) {
      phaseAverages.set(row.phase, row.avg_seconds);
    }
  }

  const recentRows = database
    .prepare(
      `SELECT r.work_order_id AS wo_id,
              r.iteration AS iterations,
              COALESCE(SUM(m.duration_seconds), 0) AS total_seconds
       FROM runs r
       LEFT JOIN run_phase_metrics m ON m.run_id = r.id
       WHERE r.project_id = ?
       GROUP BY r.id
       ORDER BY r.created_at DESC
       LIMIT ?`
    )
    .all(projectId, recentLimit) as Array<{
    wo_id: string;
    iterations: number;
    total_seconds: number;
  }>;

  const normalizeAverage = (value: unknown): number => {
    if (typeof value !== "number" || !Number.isFinite(value)) return 0;
    return value;
  };

  const normalizeCount = (value: unknown): number => {
    if (typeof value !== "number" || !Number.isFinite(value)) return 0;
    return Math.trunc(value);
  };

  return {
    avg_setup_seconds: normalizeAverage(phaseAverages.get("setup")),
    avg_builder_seconds: normalizeAverage(phaseAverages.get("builder")),
    avg_reviewer_seconds: normalizeAverage(phaseAverages.get("reviewer")),
    avg_iterations: normalizeAverage(avgIterationsRow?.avg_iterations ?? null),
    total_runs: normalizeCount(totalRunsRow?.total_runs ?? null),
    recent_runs: recentRows.map((row) => ({
      wo_id: row.wo_id,
      iterations: normalizeCount(row.iterations),
      total_seconds: normalizeCount(row.total_seconds),
    })),
  };
}

const ESTIMATION_RUN_STATUSES = [
  "merged",
  "you_review",
  "failed",
  "merge_conflict",
  "baseline_failed",
] as const;

function buildEstimationRunFilter(
  alias: string,
  projectId: string | null
): { clause: string; params: string[] } {
  const placeholders = ESTIMATION_RUN_STATUSES.map(() => "?").join(", ");
  const clauses = [`${alias}.status IN (${placeholders})`];
  const params: string[] = [...ESTIMATION_RUN_STATUSES];
  if (projectId) {
    clauses.push(`${alias}.project_id = ?`);
    params.push(projectId);
  }
  return { clause: clauses.join(" AND "), params };
}

export function getEstimationContextSummary(
  projectId: string | null
): EstimationContextSummary {
  const database = getDb();
  const { clause, params } = buildEstimationRunFilter("r", projectId);
  const sampleRow = database
    .prepare(`SELECT COUNT(1) AS sample_size FROM runs r WHERE ${clause}`)
    .get(...params) as { sample_size: number | null } | undefined;
  const iterationsRow = database
    .prepare(`SELECT AVG(r.iteration) AS avg_iterations FROM runs r WHERE ${clause}`)
    .get(...params) as { avg_iterations: number | null } | undefined;
  const phaseRows = database
    .prepare(
      `SELECT m.phase AS phase, AVG(m.duration_seconds) AS avg_seconds
       FROM run_phase_metrics m
       JOIN runs r ON r.id = m.run_id
       WHERE ${clause} AND m.duration_seconds IS NOT NULL
       GROUP BY m.phase`
    )
    .all(...params) as Array<{ phase: RunPhaseMetricPhase; avg_seconds: number | null }>;
  const totalRow = database
    .prepare(
      `SELECT AVG(total_seconds) AS avg_total_seconds
       FROM (
         SELECT r.id AS run_id, COALESCE(SUM(m.duration_seconds), 0) AS total_seconds
         FROM runs r
         LEFT JOIN run_phase_metrics m
           ON m.run_id = r.id AND m.duration_seconds IS NOT NULL
         WHERE ${clause}
         GROUP BY r.id
       ) totals`
    )
    .get(...params) as { avg_total_seconds: number | null } | undefined;

  const phaseAverages = new Map<RunPhaseMetricPhase, number>();
  for (const row of phaseRows) {
    if (typeof row.avg_seconds === "number" && Number.isFinite(row.avg_seconds)) {
      phaseAverages.set(row.phase, row.avg_seconds);
    }
  }

  const normalizeAverage = (value: unknown): number => {
    if (typeof value !== "number" || !Number.isFinite(value)) return 0;
    return value;
  };

  const normalizeCount = (value: unknown): number => {
    if (typeof value !== "number" || !Number.isFinite(value)) return 0;
    return Math.trunc(value);
  };

  return {
    averages: {
      setup_seconds: normalizeAverage(phaseAverages.get("setup")),
      builder_seconds: normalizeAverage(phaseAverages.get("builder")),
      reviewer_seconds: normalizeAverage(phaseAverages.get("reviewer")),
      test_seconds: normalizeAverage(phaseAverages.get("test")),
      iterations: normalizeAverage(iterationsRow?.avg_iterations ?? null),
      total_seconds: normalizeAverage(totalRow?.avg_total_seconds ?? null),
    },
    sample_size: normalizeCount(sampleRow?.sample_size ?? null),
  };
}

export function listEstimationContextRuns(
  projectId: string | null,
  limit = 5
): EstimationContextRunRow[] {
  const database = getDb();
  const normalizedLimit =
    typeof limit === "number" && Number.isFinite(limit)
      ? Math.max(1, Math.min(200, Math.trunc(limit)))
      : 5;
  const { clause, params } = buildEstimationRunFilter("r", projectId);
  const rows = database
    .prepare(
      `SELECT r.id AS run_id,
              r.project_id AS project_id,
              r.work_order_id AS work_order_id,
              r.iteration AS iterations,
              r.status AS status,
              r.reviewer_verdict AS reviewer_verdict,
              r.created_at AS created_at,
              wo.title AS work_order_title,
              wo.tags AS work_order_tags,
              COALESCE(SUM(m.duration_seconds), 0) AS total_seconds
       FROM runs r
       LEFT JOIN work_orders wo
         ON wo.project_id = r.project_id AND wo.id = r.work_order_id
       LEFT JOIN run_phase_metrics m
         ON m.run_id = r.id AND m.duration_seconds IS NOT NULL
       WHERE ${clause}
       GROUP BY r.id
       ORDER BY r.created_at DESC
       LIMIT ?`
    )
    .all(...params, normalizedLimit) as Array<{
    run_id: string;
    project_id: string;
    work_order_id: string;
    iterations: number | null;
    status: RunRow["status"];
    reviewer_verdict: RunRow["reviewer_verdict"];
    created_at: string;
    work_order_title: string | null;
    work_order_tags: string | null;
    total_seconds: number | null;
  }>;

  const normalizeSeconds = (value: unknown): number => {
    if (typeof value !== "number" || !Number.isFinite(value)) return 0;
    return Math.max(0, value);
  };

  const normalizeCount = (value: unknown): number => {
    if (typeof value !== "number" || !Number.isFinite(value)) return 0;
    return Math.max(0, Math.trunc(value));
  };

  return rows.map((row) => ({
    run_id: row.run_id,
    project_id: row.project_id,
    work_order_id: row.work_order_id,
    work_order_title: typeof row.work_order_title === "string" ? row.work_order_title : null,
    work_order_tags: parseJsonStringArray(row.work_order_tags),
    iterations: normalizeCount(row.iterations),
    total_seconds: normalizeSeconds(row.total_seconds),
    status: row.status,
    reviewer_verdict: row.reviewer_verdict,
    created_at: row.created_at,
  }));
}

export function getWorkOrderRunDurations(
  projectId: string,
  workOrderIds: string[]
): WorkOrderRunDuration[] {
  if (!workOrderIds.length) return [];
  const database = getDb();
  const placeholders = workOrderIds.map(() => "?").join(", ");
  const rows = database
    .prepare(
      `SELECT r.work_order_id as work_order_id,
              COUNT(r.id) as run_count,
              AVG(COALESCE(t.total_seconds, 0)) as avg_seconds
       FROM runs r
       LEFT JOIN (
         SELECT run_id, SUM(duration_seconds) AS total_seconds
         FROM run_phase_metrics
         GROUP BY run_id
       ) t ON t.run_id = r.id
       WHERE r.project_id = ? AND r.work_order_id IN (${placeholders})
       GROUP BY r.work_order_id`
    )
    .all(projectId, ...workOrderIds) as Array<{
    work_order_id: string;
    run_count: number | null;
    avg_seconds: number | null;
  }>;

  const normalizeSeconds = (value: number | null): number => {
    if (typeof value !== "number" || !Number.isFinite(value)) return 0;
    return Math.max(0, value);
  };

  const normalizeCount = (value: number | null): number => {
    if (typeof value !== "number" || !Number.isFinite(value)) return 0;
    return Math.max(0, Math.trunc(value));
  };

  return rows.map((row) => ({
    work_order_id: row.work_order_id,
    avg_seconds: normalizeSeconds(row.avg_seconds),
    run_count: normalizeCount(row.run_count),
  }));
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
       WHERE status IN ('queued', 'building', 'ai_review', 'testing', 'waiting_for_input')`
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

export function createUserInteraction(input: {
  action_type: string;
  context?: Record<string, unknown> | null;
  created_at?: string;
}): UserInteractionRow {
  const database = getDb();
  const actionType = input.action_type.trim();
  if (!actionType) {
    throw new Error("action_type is required");
  }
  const row: UserInteractionRow = {
    id: crypto.randomUUID(),
    action_type: actionType,
    context_json: input.context ? JSON.stringify(input.context) : null,
    created_at: input.created_at ?? new Date().toISOString(),
  };
  database
    .prepare(
      `INSERT INTO user_interactions
        (id, action_type, context_json, created_at)
       VALUES
        (@id, @action_type, @context_json, @created_at)`
    )
    .run(row);
  return row;
}

export function listUserInteractions(params?: {
  limit?: number;
  since?: string;
}): UserInteractionRow[] {
  const database = getDb();
  const limit =
    Number.isFinite(params?.limit) && (params?.limit ?? 0) > 0
      ? Math.min(500, Math.trunc(params?.limit ?? 0))
      : 100;
  if (params?.since) {
    return database
      .prepare(
        `SELECT id, action_type, context_json, created_at
         FROM user_interactions
         WHERE created_at >= ?
         ORDER BY created_at DESC
         LIMIT ?`
      )
      .all(params.since, limit) as UserInteractionRow[];
  }
  return database
    .prepare(
      `SELECT id, action_type, context_json, created_at
       FROM user_interactions
       ORDER BY created_at DESC
       LIMIT ?`
    )
    .all(limit) as UserInteractionRow[];
}

type TrackCounts = Partial<
  Pick<Track, "workOrderCount" | "doneCount" | "readyCount">
>;

type TrackPatch = Partial<{
  name: string;
  description: string | null;
  goal: string | null;
  color: string | null;
  icon: string | null;
  sortOrder: number;
}>;

function toTrack(row: TrackRow, counts?: TrackCounts): Track {
  const track: Track = {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    description: row.description,
    goal: row.goal,
    color: row.color,
    icon: row.icon,
    sortOrder: row.sort_order,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
  if (counts) {
    if (counts.workOrderCount !== undefined) {
      track.workOrderCount = counts.workOrderCount;
    }
    if (counts.doneCount !== undefined) {
      track.doneCount = counts.doneCount;
    }
    if (counts.readyCount !== undefined) {
      track.readyCount = counts.readyCount;
    }
  }
  return track;
}

export function createTrack(input: {
  project_id: string;
  name: string;
  description?: string | null;
  goal?: string | null;
  color?: string | null;
  icon?: string | null;
  sort_order?: number;
}): Track {
  const database = getDb();
  const now = new Date().toISOString();
  const row: TrackRow = {
    id: crypto.randomUUID(),
    project_id: input.project_id,
    name: input.name,
    description: input.description ?? null,
    goal: input.goal ?? null,
    color: input.color ?? null,
    icon: input.icon ?? null,
    sort_order:
      typeof input.sort_order === "number" && Number.isFinite(input.sort_order)
        ? Math.trunc(input.sort_order)
        : 0,
    created_at: now,
    updated_at: now,
  };
  database
    .prepare(
      `INSERT INTO tracks
        (id, project_id, name, description, goal, color, icon, sort_order, created_at, updated_at)
       VALUES
        (@id, @project_id, @name, @description, @goal, @color, @icon, @sort_order, @created_at, @updated_at)`
    )
    .run(row);
  return toTrack(row);
}

export function updateTrack(
  projectId: string,
  trackId: string,
  patch: TrackPatch
): Track | null {
  const database = getDb();
  const fields: Array<{ key: keyof TrackPatch; column: string }> = [
    { key: "name", column: "name" },
    { key: "description", column: "description" },
    { key: "goal", column: "goal" },
    { key: "color", column: "color" },
    { key: "icon", column: "icon" },
    { key: "sortOrder", column: "sort_order" },
  ];
  const sets = fields
    .filter((f) => patch[f.key] !== undefined)
    .map((f) => `${f.column} = @${f.key}`);
  if (!sets.length) return getTrackById(projectId, trackId);
  const now = new Date().toISOString();
  database
    .prepare(
      `UPDATE tracks
       SET ${sets.join(", ")}, updated_at = @updated_at
       WHERE id = @id AND project_id = @project_id`
    )
    .run({
      id: trackId,
      project_id: projectId,
      updated_at: now,
      ...patch,
    });
  return getTrackById(projectId, trackId);
}

export function deleteTrack(projectId: string, trackId: string): boolean {
  const database = getDb();
  const result = database
    .prepare("DELETE FROM tracks WHERE id = ? AND project_id = ?")
    .run(trackId, projectId);
  return result.changes > 0;
}

export function listTracks(projectId: string): Track[] {
  const database = getDb();
  const rows = database
    .prepare(
      "SELECT * FROM tracks WHERE project_id = ? ORDER BY sort_order ASC, name ASC"
    )
    .all(projectId) as TrackRow[];
  return rows.map((row) => toTrack(row));
}

export function getTrackById(projectId: string, trackId: string): Track | null {
  const database = getDb();
  const row = database
    .prepare("SELECT * FROM tracks WHERE id = ? AND project_id = ? LIMIT 1")
    .get(trackId, projectId) as TrackRow | undefined;
  return row ? toTrack(row) : null;
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

const DEFAULT_SHIFT_TIMEOUT_MINUTES = 120;

type StartShiftResult =
  | { ok: true; shift: ShiftRow }
  | { ok: false; activeShift: ShiftRow };

function normalizeOptionalString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function normalizeTimeoutMinutes(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_SHIFT_TIMEOUT_MINUTES;
  }
  const minutes = Math.trunc(value);
  return minutes > 0 ? minutes : DEFAULT_SHIFT_TIMEOUT_MINUTES;
}

function expireStaleShiftsWithDatabase(
  database: Database.Database,
  options: { projectId?: string | null; now: Date }
): number {
  const nowIso = options.now.toISOString();
  const params: Array<string> = [nowIso, nowIso];
  let sql = `UPDATE shifts
             SET status = 'expired',
                 completed_at = COALESCE(completed_at, ?),
                 error = COALESCE(error, 'Shift expired')
             WHERE status = 'active'
               AND expires_at IS NOT NULL
               AND expires_at < ?`;
  if (options.projectId) {
    sql += " AND project_id = ?";
    params.push(options.projectId);
  }
  const result = database.prepare(sql).run(...params);
  return result.changes;
}

export function expireStaleShifts(projectId?: string): number {
  const database = getDb();
  return expireStaleShiftsWithDatabase(database, { projectId, now: new Date() });
}

export function startShift(params: {
  projectId: string;
  agentType?: string | null;
  agentId?: string | null;
  timeoutMinutes?: number | null;
}): StartShiftResult {
  const database = getDb();
  const now = new Date();
  const agentType = normalizeOptionalString(params.agentType);
  const agentId = normalizeOptionalString(params.agentId);
  const timeoutMinutes = normalizeTimeoutMinutes(params.timeoutMinutes);
  const startedAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + timeoutMinutes * 60_000).toISOString();

  const tx = database.transaction(() => {
    expireStaleShiftsWithDatabase(database, { projectId: params.projectId, now });
    const active = database
      .prepare(
        "SELECT * FROM shifts WHERE project_id = ? AND status = 'active' ORDER BY started_at DESC LIMIT 1"
      )
      .get(params.projectId) as ShiftRow | undefined;
    if (active) return { ok: false, activeShift: active } as const;

    const id = crypto.randomUUID();
    const row: ShiftRow = {
      id,
      project_id: params.projectId,
      status: "active",
      agent_type: agentType,
      agent_id: agentId,
      started_at: startedAt,
      completed_at: null,
      expires_at: expiresAt,
      handoff_id: null,
      error: null,
    };

    database
      .prepare(
        `INSERT INTO shifts
          (id, project_id, status, agent_type, agent_id, started_at, completed_at, expires_at, handoff_id, error)
         VALUES
          (@id, @project_id, @status, @agent_type, @agent_id, @started_at, @completed_at, @expires_at, @handoff_id, @error)`
      )
      .run(row);
    return { ok: true, shift: row } as const;
  });

  return tx();
}

export function getActiveShift(projectId: string): ShiftRow | null {
  const database = getDb();
  expireStaleShiftsWithDatabase(database, { projectId, now: new Date() });
  const row = database
    .prepare(
      "SELECT * FROM shifts WHERE project_id = ? AND status = 'active' ORDER BY started_at DESC LIMIT 1"
    )
    .get(projectId) as ShiftRow | undefined;
  return row || null;
}

export function listShifts(projectId: string, limit = 10): ShiftRow[] {
  const database = getDb();
  expireStaleShiftsWithDatabase(database, { projectId, now: new Date() });
  const safeLimit = Math.max(1, Math.min(100, Math.trunc(limit)));
  return database
    .prepare(
      "SELECT * FROM shifts WHERE project_id = ? ORDER BY started_at DESC LIMIT ?"
    )
    .all(projectId, safeLimit) as ShiftRow[];
}

export function getShiftByProjectId(projectId: string, shiftId: string): ShiftRow | null {
  const database = getDb();
  const row = database
    .prepare("SELECT * FROM shifts WHERE id = ? AND project_id = ? LIMIT 1")
    .get(shiftId, projectId) as ShiftRow | undefined;
  return row || null;
}

export function updateShift(
  id: string,
  patch: Partial<
    Pick<ShiftRow, "status" | "completed_at" | "expires_at" | "handoff_id" | "error">
  >
): boolean {
  const database = getDb();
  const fields: Array<{ key: keyof typeof patch; column: string }> = [
    { key: "status", column: "status" },
    { key: "completed_at", column: "completed_at" },
    { key: "expires_at", column: "expires_at" },
    { key: "handoff_id", column: "handoff_id" },
    { key: "error", column: "error" },
  ];
  const sets = fields
    .filter((field) => patch[field.key] !== undefined)
    .map((field) => `${field.column} = @${field.key}`);
  if (!sets.length) return false;
  const result = database
    .prepare(`UPDATE shifts SET ${sets.join(", ")} WHERE id = @id`)
    .run({ id, ...patch });
  return result.changes > 0;
}

function normalizeStringArrayInput(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter(Boolean);
}

function normalizeDecisionArrayInput(value: unknown): ShiftHandoffDecision[] {
  if (!Array.isArray(value)) return [];
  const decisions: ShiftHandoffDecision[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    const decision = typeof record.decision === "string" ? record.decision.trim() : "";
    const rationale = typeof record.rationale === "string" ? record.rationale.trim() : "";
    if (!decision || !rationale) continue;
    decisions.push({ decision, rationale });
  }
  return decisions;
}

function parseJsonStringArray(value: string | null): string[] {
  if (!value) return [];
  try {
    return normalizeStringArrayInput(JSON.parse(value));
  } catch {
    return [];
  }
}

function parseJsonDecisionArray(value: string | null): ShiftHandoffDecision[] {
  if (!value) return [];
  try {
    return normalizeDecisionArrayInput(JSON.parse(value));
  } catch {
    return [];
  }
}

function normalizeShiftId(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function toShiftHandoff(row: ShiftHandoffRow): ShiftHandoff {
  return {
    id: row.id,
    project_id: row.project_id,
    shift_id: row.shift_id,
    summary: row.summary,
    work_completed: parseJsonStringArray(row.work_completed),
    recommendations: parseJsonStringArray(row.recommendations),
    blockers: parseJsonStringArray(row.blockers),
    next_priorities: parseJsonStringArray(row.next_priorities),
    decisions_made: parseJsonDecisionArray(row.decisions_made),
    agent_id: row.agent_id,
    duration_minutes: row.duration_minutes ?? null,
    created_at: row.created_at,
  };
}

export function createShiftHandoff(params: {
  projectId: string;
  shiftId?: string | null;
  input: CreateShiftHandoffInput;
}): ShiftHandoff {
  const database = getDb();
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const summary = params.input.summary.trim();
  const workCompleted = normalizeStringArrayInput(params.input.work_completed);
  const recommendations = normalizeStringArrayInput(params.input.recommendations);
  const blockers = normalizeStringArrayInput(params.input.blockers);
  const nextPriorities = normalizeStringArrayInput(params.input.next_priorities);
  const decisionsMade = normalizeDecisionArrayInput(params.input.decisions_made);
  const agentId =
    typeof params.input.agent_id === "string" && params.input.agent_id.trim()
      ? params.input.agent_id.trim()
      : null;
  const durationMinutes =
    typeof params.input.duration_minutes === "number" &&
    Number.isFinite(params.input.duration_minutes)
      ? Math.trunc(params.input.duration_minutes)
      : null;
  const shiftId = normalizeShiftId(params.shiftId);

  const row: ShiftHandoffRow = {
    id,
    project_id: params.projectId,
    shift_id: shiftId,
    summary,
    work_completed: JSON.stringify(workCompleted),
    recommendations: JSON.stringify(recommendations),
    blockers: JSON.stringify(blockers),
    next_priorities: JSON.stringify(nextPriorities),
    decisions_made: JSON.stringify(decisionsMade),
    agent_id: agentId,
    duration_minutes: durationMinutes,
    created_at: now,
  };

  database
    .prepare(
      `INSERT INTO shift_handoffs
        (id, project_id, shift_id, summary, work_completed, recommendations, blockers, next_priorities, decisions_made, agent_id, duration_minutes, created_at)
       VALUES
        (@id, @project_id, @shift_id, @summary, @work_completed, @recommendations, @blockers, @next_priorities, @decisions_made, @agent_id, @duration_minutes, @created_at)`
    )
    .run(row);

  return toShiftHandoff(row);
}

export function listShiftHandoffs(projectId: string, limit = 10): ShiftHandoff[] {
  const database = getDb();
  const safeLimit = Math.max(1, Math.min(100, Math.trunc(limit)));
  const rows = database
    .prepare(
      `SELECT *
       FROM shift_handoffs
       WHERE project_id = ?
       ORDER BY created_at DESC
       LIMIT ?`
    )
    .all(projectId, safeLimit) as ShiftHandoffRow[];
  return rows.map((row) => toShiftHandoff(row));
}

export function getLatestShiftHandoff(projectId: string): ShiftHandoff | null {
  const database = getDb();
  const row = database
    .prepare(
      `SELECT *
       FROM shift_handoffs
       WHERE project_id = ?
       ORDER BY created_at DESC
       LIMIT 1`
    )
    .get(projectId) as ShiftHandoffRow | undefined;
  if (!row) return null;
  return toShiftHandoff(row);
}

type StartGlobalShiftResult =
  | { ok: true; shift: GlobalShiftRow }
  | { ok: false; activeShift: GlobalShiftRow };

function expireStaleGlobalShiftsWithDatabase(
  database: Database.Database,
  options: { now: Date }
): number {
  const nowIso = options.now.toISOString();
  const result = database
    .prepare(
      `UPDATE global_shifts
       SET status = 'expired',
           completed_at = COALESCE(completed_at, ?),
           error = COALESCE(error, 'Shift expired')
       WHERE status = 'active'
         AND expires_at IS NOT NULL
         AND expires_at < ?`
    )
    .run(nowIso, nowIso);
  return result.changes;
}

export function expireStaleGlobalShifts(): number {
  const database = getDb();
  return expireStaleGlobalShiftsWithDatabase(database, { now: new Date() });
}

export function startGlobalShift(params: {
  agentType?: string | null;
  agentId?: string | null;
  timeoutMinutes?: number | null;
  sessionId?: string | null;
  iterationIndex?: number | null;
}): StartGlobalShiftResult {
  const database = getDb();
  const now = new Date();
  const agentType = normalizeOptionalString(params.agentType);
  const agentId = normalizeOptionalString(params.agentId);
  const sessionId = normalizeOptionalString(params.sessionId);
  const iterationIndex =
    typeof params.iterationIndex === "number" && Number.isFinite(params.iterationIndex)
      ? Math.trunc(params.iterationIndex)
      : null;
  const timeoutMinutes = normalizeTimeoutMinutes(params.timeoutMinutes);
  const startedAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + timeoutMinutes * 60_000).toISOString();

  const tx = database.transaction(() => {
    expireStaleGlobalShiftsWithDatabase(database, { now });
    const active = database
      .prepare(
        "SELECT * FROM global_shifts WHERE status = 'active' ORDER BY started_at DESC LIMIT 1"
      )
      .get() as GlobalShiftRow | undefined;
    if (active) return { ok: false, activeShift: active } as const;

    const id = crypto.randomUUID();
    const row: GlobalShiftRow = {
      id,
      status: "active",
      agent_type: agentType,
      agent_id: agentId,
      session_id: sessionId,
      iteration_index: iterationIndex,
      started_at: startedAt,
      completed_at: null,
      expires_at: expiresAt,
      handoff_id: null,
      error: null,
    };

    database
      .prepare(
        `INSERT INTO global_shifts
          (id, status, agent_type, agent_id, session_id, iteration_index, started_at, completed_at, expires_at, handoff_id, error)
         VALUES
          (@id, @status, @agent_type, @agent_id, @session_id, @iteration_index, @started_at, @completed_at, @expires_at, @handoff_id, @error)`
      )
      .run(row);
    return { ok: true, shift: row } as const;
  });

  return tx();
}

export function getActiveGlobalShift(): GlobalShiftRow | null {
  const database = getDb();
  expireStaleGlobalShiftsWithDatabase(database, { now: new Date() });
  const row = database
    .prepare(
      "SELECT * FROM global_shifts WHERE status = 'active' ORDER BY started_at DESC LIMIT 1"
    )
    .get() as GlobalShiftRow | undefined;
  return row || null;
}

export function listGlobalShifts(limit = 10): GlobalShiftRow[] {
  const database = getDb();
  expireStaleGlobalShiftsWithDatabase(database, { now: new Date() });
  const safeLimit = Math.max(1, Math.min(100, Math.trunc(limit)));
  return database
    .prepare("SELECT * FROM global_shifts ORDER BY started_at DESC LIMIT ?")
    .all(safeLimit) as GlobalShiftRow[];
}

export function getGlobalShiftById(shiftId: string): GlobalShiftRow | null {
  const database = getDb();
  const row = database
    .prepare("SELECT * FROM global_shifts WHERE id = ? LIMIT 1")
    .get(shiftId) as GlobalShiftRow | undefined;
  return row || null;
}

export function updateGlobalShift(
  id: string,
  patch: Partial<
    Pick<GlobalShiftRow, "status" | "completed_at" | "expires_at" | "handoff_id" | "error">
  >
): boolean {
  const database = getDb();
  const fields: Array<{ key: keyof typeof patch; column: string }> = [
    { key: "status", column: "status" },
    { key: "completed_at", column: "completed_at" },
    { key: "expires_at", column: "expires_at" },
    { key: "handoff_id", column: "handoff_id" },
    { key: "error", column: "error" },
  ];
  const sets = fields
    .filter((field) => patch[field.key] !== undefined)
    .map((field) => `${field.column} = @${field.key}`);
  if (!sets.length) return false;
  const result = database
    .prepare(`UPDATE global_shifts SET ${sets.join(", ")} WHERE id = @id`)
    .run({ id, ...patch });
  return result.changes > 0;
}

function parseProjectState(value: string | null): GlobalShiftStateSnapshot | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as GlobalShiftStateSnapshot;
  } catch {
    return null;
  }
}

function toGlobalShiftHandoff(row: GlobalShiftHandoffRow): GlobalShiftHandoff {
  return {
    id: row.id,
    shift_id: row.shift_id,
    summary: row.summary,
    actions_taken: parseJsonStringArray(row.actions_taken),
    pending_items: parseJsonStringArray(row.pending_items),
    project_state: parseProjectState(row.project_state),
    decisions_made: parseJsonDecisionArray(row.decisions_made),
    agent_id: row.agent_id,
    duration_minutes: row.duration_minutes ?? null,
    created_at: row.created_at,
  };
}

export function createGlobalShiftHandoff(params: {
  shiftId?: string | null;
  input: CreateGlobalShiftHandoffInput;
}): GlobalShiftHandoff {
  const database = getDb();
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const summary = params.input.summary.trim();
  const actionsTaken = normalizeStringArrayInput(params.input.actions_taken);
  const pendingItems = normalizeStringArrayInput(params.input.pending_items);
  const decisionsMade = normalizeDecisionArrayInput(params.input.decisions_made);
  const agentId =
    typeof params.input.agent_id === "string" && params.input.agent_id.trim()
      ? params.input.agent_id.trim()
      : null;
  const durationMinutes =
    typeof params.input.duration_minutes === "number" &&
    Number.isFinite(params.input.duration_minutes)
      ? Math.trunc(params.input.duration_minutes)
      : null;
  const shiftId = normalizeShiftId(params.shiftId);
  let projectState: string | null = null;
  if (params.input.project_state !== undefined) {
    try {
      projectState = params.input.project_state
        ? JSON.stringify(params.input.project_state)
        : null;
    } catch {
      throw new Error("project_state must be JSON-serializable");
    }
  }

  const row: GlobalShiftHandoffRow = {
    id,
    shift_id: shiftId,
    summary,
    actions_taken: JSON.stringify(actionsTaken),
    pending_items: JSON.stringify(pendingItems),
    project_state: projectState,
    decisions_made: JSON.stringify(decisionsMade),
    agent_id: agentId,
    duration_minutes: durationMinutes,
    created_at: now,
  };

  database
    .prepare(
      `INSERT INTO global_shift_handoffs
        (id, shift_id, summary, actions_taken, pending_items, project_state, decisions_made, agent_id, duration_minutes, created_at)
       VALUES
        (@id, @shift_id, @summary, @actions_taken, @pending_items, @project_state, @decisions_made, @agent_id, @duration_minutes, @created_at)`
    )
    .run(row);

  return toGlobalShiftHandoff(row);
}

export function listGlobalShiftHandoffs(limit = 10): GlobalShiftHandoff[] {
  const database = getDb();
  const safeLimit = Math.max(1, Math.min(100, Math.trunc(limit)));
  const rows = database
    .prepare(
      `SELECT *
       FROM global_shift_handoffs
       ORDER BY created_at DESC
       LIMIT ?`
    )
    .all(safeLimit) as GlobalShiftHandoffRow[];
  return rows.map((row) => toGlobalShiftHandoff(row));
}

export function getLatestGlobalShiftHandoff(): GlobalShiftHandoff | null {
  const database = getDb();
  const row = database
    .prepare(
      `SELECT *
       FROM global_shift_handoffs
       ORDER BY created_at DESC
       LIMIT 1`
    )
    .get() as GlobalShiftHandoffRow | undefined;
  if (!row) return null;
  return toGlobalShiftHandoff(row);
}

function normalizePatternTags(tags: string[]): string[] {
  const normalized = tags
    .map((tag) => tag.trim().toLowerCase())
    .filter(Boolean);
  return Array.from(new Set(normalized));
}

function toGlobalPattern(row: GlobalPatternRow): GlobalPattern {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    tags: normalizePatternTags(parseJsonStringArray(row.tags)),
    source_project: row.source_project,
    source_wo: row.source_wo,
    implementation_notes: row.implementation_notes ?? "",
    success_metrics: row.success_metrics ?? "",
    created_at: row.created_at,
  };
}

export function listGlobalPatterns(limit = 100): GlobalPattern[] {
  const database = getDb();
  const safeLimit = Number.isFinite(limit)
    ? Math.max(1, Math.min(200, Math.trunc(limit)))
    : 100;
  const rows = database
    .prepare(
      `SELECT *
       FROM global_patterns
       ORDER BY created_at DESC
       LIMIT ?`
    )
    .all(safeLimit) as GlobalPatternRow[];
  return rows.map((row) => toGlobalPattern(row));
}

export function findGlobalPatternById(id: string): GlobalPattern | null {
  const database = getDb();
  const row = database
    .prepare("SELECT * FROM global_patterns WHERE id = ? LIMIT 1")
    .get(id) as GlobalPatternRow | undefined;
  if (!row) return null;
  return toGlobalPattern(row);
}

export function searchGlobalPatternsByTags(tags: string[], limit = 50): GlobalPattern[] {
  const normalizedTags = normalizePatternTags(tags);
  if (!normalizedTags.length) return [];
  const safeLimit = Number.isFinite(limit)
    ? Math.max(1, Math.min(200, Math.trunc(limit)))
    : 50;
  const database = getDb();
  const rows = database
    .prepare(
      `SELECT *
       FROM global_patterns
       ORDER BY created_at DESC`
    )
    .all() as GlobalPatternRow[];
  const matches = rows
    .map((row) => toGlobalPattern(row))
    .filter((pattern) => normalizedTags.some((tag) => pattern.tags.includes(tag)));
  return matches.slice(0, safeLimit);
}

export function createGlobalPattern(input: CreateGlobalPatternInput): GlobalPattern {
  const database = getDb();
  const id = crypto.randomUUID();
  const now =
    typeof input.created_at === "string" && input.created_at.trim()
      ? input.created_at.trim()
      : new Date().toISOString();
  const tags = normalizePatternTags(input.tags);
  const row: GlobalPatternRow = {
    id,
    name: input.name.trim(),
    description: input.description.trim(),
    tags: JSON.stringify(tags),
    source_project: input.source_project.trim(),
    source_wo: input.source_wo.trim(),
    implementation_notes: normalizeOptionalString(input.implementation_notes),
    success_metrics: normalizeOptionalString(input.success_metrics),
    created_at: now,
  };

  database
    .prepare(
      `INSERT INTO global_patterns
        (id, name, description, tags, source_project, source_wo, implementation_notes, success_metrics, created_at)
       VALUES
        (@id, @name, @description, @tags, @source_project, @source_wo, @implementation_notes, @success_metrics, @created_at)`
    )
    .run(row);

  return toGlobalPattern(row);
}

const MAX_CONSTITUTION_VERSIONS = 5;

function normalizeConstitutionStatements(statements: string[]): string[] {
  const trimmed = statements.map((entry) => entry.trim()).filter(Boolean);
  return Array.from(new Set(trimmed));
}

function toConstitutionVersion(row: ConstitutionVersionRow): ConstitutionVersion {
  return {
    id: row.id,
    scope: row.scope,
    project_id: row.project_id ?? null,
    content: row.content,
    statements: parseJsonStringArray(row.statements),
    source: row.source,
    created_at: row.created_at,
    active: row.active === 1,
  };
}

export function getActiveConstitutionVersion(params: {
  scope: ConstitutionScope;
  projectId?: string | null;
}): ConstitutionVersion | null {
  const database = getDb();
  const scope = params.scope;
  const projectId = params.projectId ?? null;
  let row: ConstitutionVersionRow | undefined;
  if (scope === "global") {
    row = database
      .prepare(
        `SELECT *
         FROM constitution_versions
         WHERE scope = 'global' AND active = 1
         ORDER BY created_at DESC
         LIMIT 1`
      )
      .get() as ConstitutionVersionRow | undefined;
    if (!row) {
      row = database
        .prepare(
          `SELECT *
           FROM constitution_versions
           WHERE scope = 'global'
           ORDER BY created_at DESC
           LIMIT 1`
        )
        .get() as ConstitutionVersionRow | undefined;
    }
  } else {
    if (!projectId) return null;
    row = database
      .prepare(
        `SELECT *
         FROM constitution_versions
         WHERE scope = 'project' AND project_id = ? AND active = 1
         ORDER BY created_at DESC
         LIMIT 1`
      )
      .get(projectId) as ConstitutionVersionRow | undefined;
    if (!row) {
      row = database
        .prepare(
          `SELECT *
           FROM constitution_versions
           WHERE scope = 'project' AND project_id = ?
           ORDER BY created_at DESC
           LIMIT 1`
        )
        .get(projectId) as ConstitutionVersionRow | undefined;
    }
  }
  return row ? toConstitutionVersion(row) : null;
}

export function listConstitutionVersions(params: {
  scope: ConstitutionScope;
  projectId?: string | null;
  limit?: number;
}): ConstitutionVersion[] {
  const database = getDb();
  const scope = params.scope;
  const projectId = params.projectId ?? null;
  const safeLimit = Number.isFinite(params.limit)
    ? Math.max(1, Math.min(200, Math.trunc(params.limit ?? 100)))
    : 100;
  let rows: ConstitutionVersionRow[] = [];
  if (scope === "global") {
    rows = database
      .prepare(
        `SELECT *
         FROM constitution_versions
         WHERE scope = 'global'
         ORDER BY created_at DESC
         LIMIT ?`
      )
      .all(safeLimit) as ConstitutionVersionRow[];
  } else if (projectId) {
    rows = database
      .prepare(
        `SELECT *
         FROM constitution_versions
         WHERE scope = 'project' AND project_id = ?
         ORDER BY created_at DESC
         LIMIT ?`
      )
      .all(projectId, safeLimit) as ConstitutionVersionRow[];
  }
  return rows.map((row) => toConstitutionVersion(row));
}

export function createConstitutionVersion(params: {
  scope: ConstitutionScope;
  projectId?: string | null;
  content: string;
  statements: string[];
  source: string;
  createdAt?: string;
}): ConstitutionVersion {
  const database = getDb();
  const scope = params.scope;
  const projectId = params.projectId ?? null;
  if (scope === "project" && !projectId) {
    throw new Error("projectId is required for project constitution versions");
  }
  const id = crypto.randomUUID();
  const createdAt =
    typeof params.createdAt === "string" && params.createdAt.trim()
      ? params.createdAt.trim()
      : new Date().toISOString();
  const statements = normalizeConstitutionStatements(params.statements);

  const row: ConstitutionVersionRow = {
    id,
    scope,
    project_id: scope === "project" ? projectId : null,
    content: params.content,
    statements: JSON.stringify(statements),
    source: params.source.trim() || "user",
    created_at: createdAt,
    active: 1,
  };

  const insert = database.transaction(() => {
    if (scope === "global") {
      database
        .prepare("UPDATE constitution_versions SET active = 0 WHERE scope = 'global'")
        .run();
    } else {
      database
        .prepare(
          "UPDATE constitution_versions SET active = 0 WHERE scope = 'project' AND project_id = ?"
        )
        .run(projectId);
    }

    database
      .prepare(
        `INSERT INTO constitution_versions
          (id, scope, project_id, content, statements, source, created_at, active)
         VALUES
          (@id, @scope, @project_id, @content, @statements, @source, @created_at, @active)`
      )
      .run(row);

    let idsToPrune: Array<{ id: string }> = [];
    if (scope === "global") {
      idsToPrune = database
        .prepare(
          `SELECT id
           FROM constitution_versions
           WHERE scope = 'global'
           ORDER BY created_at DESC
           LIMIT -1 OFFSET ?`
        )
        .all(MAX_CONSTITUTION_VERSIONS) as Array<{ id: string }>;
    } else if (projectId) {
      idsToPrune = database
        .prepare(
          `SELECT id
           FROM constitution_versions
           WHERE scope = 'project' AND project_id = ?
           ORDER BY created_at DESC
           LIMIT -1 OFFSET ?`
        )
        .all(projectId, MAX_CONSTITUTION_VERSIONS) as Array<{ id: string }>;
    }
    if (idsToPrune.length > 0) {
      const ids = idsToPrune.map((entry) => entry.id);
      const placeholders = ids.map(() => "?").join(", ");
      database
        .prepare(`DELETE FROM constitution_versions WHERE id IN (${placeholders})`)
        .run(...ids);
    }
  });

  insert();
  return toConstitutionVersion(row);
}
