import crypto from "crypto";
import Database from "better-sqlite3";
import { getDatabasePath } from "./config.js";

export const LAST_ESCALATION_AT_KEY = "last_escalation_at";

export type ProjectIsolationMode = "local" | "vm" | "vm+container";
export type ProjectIsolationSize = "medium" | "large" | "xlarge";

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
  auto_shift_enabled: 0 | 1;
  tags: string; // JSON array
  isolation_mode: ProjectIsolationMode;
  vm_size: ProjectIsolationSize;
  last_run_at: string | null;
  created_at: string;
  updated_at: string;
};

export type RunFailureCategory =
  | "baseline_failure"
  | "test_failure"
  | "merge_conflict"
  | "build_error"
  | "timeout_or_resource"
  | "agent_error"
  | "canceled"
  | "unknown";

export type RunTrigger = "manual" | "autopilot";

export type RunRow = {
  id: string;
  project_id: string;
  work_order_id: string;
  provider: string;
  triggered_by: RunTrigger;
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

export type SignalRow = {
  id: string;
  project_id: string;
  work_order_id: string | null;
  run_id: string | null;
  type: string;
  summary: string;
  tags: string;
  source: string;
  created_at: string;
};

export type Signal = Omit<SignalRow, "tags"> & { tags: string[] };

export type CreateSignalInput = {
  project_id: string;
  work_order_id?: string | null;
  run_id?: string | null;
  type: string;
  summary: string;
  tags?: string[] | null;
  source: string;
  created_at?: string;
};

export type SignalQuery = {
  project_id: string;
  work_order_id?: string | null;
  run_id?: string | null;
  limit?: number;
};

export type ConstitutionSuggestionStatus = "pending" | "accepted" | "rejected";

export type ConstitutionSuggestionEvidence = {
  id: string;
  type: string;
  summary: string;
  created_at: string;
};

export type ConstitutionSuggestionRow = {
  id: string;
  project_id: string;
  scope: "global" | "project";
  category: string;
  text: string;
  evidence: string;
  status: ConstitutionSuggestionStatus;
  created_at: string;
  accepted_at: string | null;
  accepted_by: string | null;
  rejected_at: string | null;
  rejected_by: string | null;
};

export type ConstitutionSuggestion = Omit<ConstitutionSuggestionRow, "evidence"> & {
  evidence: ConstitutionSuggestionEvidence[];
};

export type CreateConstitutionSuggestionInput = {
  project_id: string;
  scope: "global" | "project";
  category: string;
  text: string;
  evidence: ConstitutionSuggestionEvidence[];
  created_at?: string;
};

export type ConstitutionSuggestionQuery = {
  project_id: string;
  status?: ConstitutionSuggestionStatus | null;
  limit?: number;
};

export type AutopilotPolicyRow = {
  project_id: string;
  enabled: 0 | 1;
  max_concurrent_runs: number;
  allowed_tags: string | null;
  min_priority: number | null;
  stop_on_failure_count: number;
  schedule_cron: string | null;
  created_at: string;
  updated_at: string;
};

export type AutopilotPolicy = {
  project_id: string;
  enabled: boolean;
  max_concurrent_runs: number;
  allowed_tags: string[] | null;
  min_priority: number | null;
  stop_on_failure_count: number;
  schedule_cron: string | null;
  created_at: string;
  updated_at: string;
};

export type AutopilotPolicyPatch = Partial<
  Pick<
    AutopilotPolicy,
    | "enabled"
    | "max_concurrent_runs"
    | "allowed_tags"
    | "min_priority"
    | "stop_on_failure_count"
    | "schedule_cron"
  >
>;

export type SecurityIncidentVerdict = "SAFE" | "WARN" | "KILL";
export type SecurityIncidentAction = "killed" | "warned" | "allowed";
export type SecurityIncidentResolution = "resumed" | "aborted";

export type SecurityIncidentRow = {
  id: string;
  run_id: string;
  project_id: string;
  timestamp: string;
  pattern_category: string;
  pattern_matched: string;
  trigger_content: string;
  agent_output_snippet: string | null;
  wo_id: string | null;
  wo_goal: string | null;
  gemini_verdict: SecurityIncidentVerdict;
  gemini_reason: string | null;
  gemini_latency_ms: number | null;
  action_taken: SecurityIncidentAction;
  user_resolution: SecurityIncidentResolution | null;
  false_positive: 0 | 1;
  resolution_timestamp: string | null;
  resolution_notes: string | null;
  created_at: string;
  archived_at: string | null;
};

export type CreateSecurityIncidentInput = {
  run_id: string;
  project_id: string;
  timestamp: string;
  pattern_category: string;
  pattern_matched: string;
  trigger_content: string;
  agent_output_snippet?: string | null;
  wo_id?: string | null;
  wo_goal?: string | null;
  gemini_verdict: SecurityIncidentVerdict;
  gemini_reason?: string | null;
  gemini_latency_ms?: number | null;
  action_taken: SecurityIncidentAction;
  created_at?: string;
};

export type SecurityIncidentQuery = {
  start?: string;
  end?: string;
  verdict?: SecurityIncidentVerdict;
  false_positive?: boolean;
  order?: "asc" | "desc";
  limit?: number;
};

export type IncidentStats = {
  total: number;
  by_verdict: { SAFE: number; WARN: number; KILL: number };
  by_category: Record<string, number>;
  false_positive_rate: number;
  avg_gemini_latency_ms: number;
  last_7_days: number;
  last_30_days: number;
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

export type AgentMonitoringSettingsRow = {
  id: string;
  builder_network_access: string;
  builder_monitor_enabled: number;
  builder_auto_kill_on_threat: number;
  reviewer_network_access: string;
  reviewer_monitor_enabled: number;
  reviewer_auto_kill_on_threat: number;
  shift_agent_network_access: string;
  shift_agent_monitor_enabled: number;
  shift_agent_auto_kill_on_threat: number;
  global_agent_network_access: string;
  global_agent_monitor_enabled: number;
  global_agent_auto_kill_on_threat: number;
};

export type ShiftSchedulerSettingsRow = {
  enabled: number;
  interval_minutes: number;
  cooldown_minutes: number;
  max_shifts_per_day: number;
  quiet_hours_start: string;
  quiet_hours_end: string;
};

export type NetworkWhitelistRow = {
  domain: string;
  enabled: number;
  created_at: string;
};

export type UserInteractionRow = {
  id: string;
  action_type: string;
  context_json: string | null;
  created_at: string;
};

export type SubscriberRow = {
  id: string;
  email: string;
  source: string;
  created_at: string;
  confirmed_at: string | null;
  unsubscribed_at: string | null;
};

export type SubscriberCreateResult = {
  status: "success" | "already_exists";
  subscriber: SubscriberRow;
};

export type WorkOrderDepRow = {
  project_id: string;
  work_order_id: string;
  depends_on_id: string;
  created_at: string;
};

export type TaggedWorkOrder = {
  project_id: string;
  work_order_id: string;
  status: string;
  depends_on: string[];
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

export type InitiativeStatus = "planning" | "active" | "completed" | "at_risk";
export type InitiativeMilestoneStatus = "pending" | "completed" | "at_risk";

export type InitiativeMilestone = {
  name: string;
  target_date: string;
  wos: string[];
  status: InitiativeMilestoneStatus;
};

export type InitiativeSuggestionSent = {
  project_id: string;
  suggested_title: string;
  sent_at: string;
};

export type Initiative = {
  id: string;
  name: string;
  description: string;
  target_date: string;
  status: InitiativeStatus;
  projects: string[];
  milestones: InitiativeMilestone[];
  suggestions_sent: InitiativeSuggestionSent[];
  created_at: string;
  updated_at: string;
};

type InitiativeRow = {
  id: string;
  name: string;
  description: string;
  target_date: string;
  status: InitiativeStatus;
  projects: string;
  milestones: string;
  suggestions_sent: string;
  created_at: string;
  updated_at: string;
};

export type InitiativePatch = Partial<
  Pick<
    Initiative,
    "name" | "description" | "target_date" | "status" | "projects" | "milestones" | "suggestions_sent"
  >
>;

let db: Database.Database | null = null;

export function getDb() {
  if (db) return db;
  const dbPath = getDatabasePath();
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
      auto_shift_enabled INTEGER NOT NULL DEFAULT 0,
      tags TEXT NOT NULL DEFAULT '[]',
      isolation_mode TEXT NOT NULL DEFAULT 'local',
      vm_size TEXT NOT NULL DEFAULT 'medium',
      last_run_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS autopilot_policies (
      project_id TEXT PRIMARY KEY,
      enabled INTEGER NOT NULL DEFAULT 0,
      max_concurrent_runs INTEGER NOT NULL DEFAULT 1,
      allowed_tags TEXT DEFAULT NULL,
      min_priority INTEGER DEFAULT NULL,
      stop_on_failure_count INTEGER NOT NULL DEFAULT 3,
      schedule_cron TEXT DEFAULT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_autopilot_policies_enabled
      ON autopilot_policies(enabled);

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

    CREATE TABLE IF NOT EXISTS initiatives (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      target_date TEXT NOT NULL,
      status TEXT NOT NULL,
      projects TEXT NOT NULL DEFAULT '[]',
      milestones TEXT NOT NULL DEFAULT '[]',
      suggestions_sent TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_initiatives_status ON initiatives(status);

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
      triggered_by TEXT NOT NULL DEFAULT 'manual',
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

    CREATE TABLE IF NOT EXISTS signals (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      work_order_id TEXT,
      run_id TEXT,
      type TEXT NOT NULL,
      summary TEXT NOT NULL,
      tags TEXT NOT NULL DEFAULT '[]',
      source TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_signals_project_created
      ON signals(project_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_signals_work_order_created
      ON signals(project_id, work_order_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_signals_run_created
      ON signals(run_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS security_incidents (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      pattern_category TEXT NOT NULL,
      pattern_matched TEXT NOT NULL,
      trigger_content TEXT NOT NULL,
      agent_output_snippet TEXT,
      wo_id TEXT,
      wo_goal TEXT,
      gemini_verdict TEXT NOT NULL,
      gemini_reason TEXT,
      gemini_latency_ms INTEGER,
      action_taken TEXT NOT NULL,
      user_resolution TEXT,
      false_positive INTEGER DEFAULT 0,
      resolution_timestamp TEXT,
      resolution_notes TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      archived_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_incidents_run ON security_incidents(run_id);
    CREATE INDEX IF NOT EXISTS idx_incidents_project ON security_incidents(project_id);
    CREATE INDEX IF NOT EXISTS idx_incidents_timestamp ON security_incidents(timestamp);
    CREATE INDEX IF NOT EXISTS idx_incidents_verdict ON security_incidents(gemini_verdict);

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

    CREATE TABLE IF NOT EXISTS shift_scheduler_settings (
      enabled INTEGER NOT NULL DEFAULT 0,
      interval_minutes INTEGER NOT NULL DEFAULT 120,
      cooldown_minutes INTEGER NOT NULL DEFAULT 30,
      max_shifts_per_day INTEGER NOT NULL DEFAULT 6,
      quiet_hours_start TEXT NOT NULL DEFAULT '02:00',
      quiet_hours_end TEXT NOT NULL DEFAULT '06:00'
    );

    CREATE TABLE IF NOT EXISTS agent_monitoring_settings (
      id TEXT PRIMARY KEY DEFAULT 'global',
      builder_network_access TEXT NOT NULL DEFAULT 'sandboxed',
      builder_monitor_enabled INTEGER NOT NULL DEFAULT 1,
      builder_auto_kill_on_threat INTEGER NOT NULL DEFAULT 1,
      reviewer_network_access TEXT NOT NULL DEFAULT 'sandboxed',
      reviewer_monitor_enabled INTEGER NOT NULL DEFAULT 1,
      reviewer_auto_kill_on_threat INTEGER NOT NULL DEFAULT 1,
      shift_agent_network_access TEXT NOT NULL DEFAULT 'full',
      shift_agent_monitor_enabled INTEGER NOT NULL DEFAULT 1,
      shift_agent_auto_kill_on_threat INTEGER NOT NULL DEFAULT 1,
      global_agent_network_access TEXT NOT NULL DEFAULT 'full',
      global_agent_monitor_enabled INTEGER NOT NULL DEFAULT 1,
      global_agent_auto_kill_on_threat INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS network_whitelist (
      domain TEXT PRIMARY KEY,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
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

    CREATE TABLE IF NOT EXISTS constitution_suggestions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      scope TEXT NOT NULL,
      category TEXT NOT NULL,
      text TEXT NOT NULL,
      evidence TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL,
      accepted_at TEXT,
      accepted_by TEXT,
      rejected_at TEXT,
      rejected_by TEXT,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_constitution_suggestions_project_created
      ON constitution_suggestions(project_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_constitution_suggestions_status
      ON constitution_suggestions(project_id, status, created_at DESC);

    CREATE TABLE IF NOT EXISTS user_interactions (
      id TEXT PRIMARY KEY,
      action_type TEXT NOT NULL,
      context_json TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_user_interactions_created
      ON user_interactions(created_at DESC);

    CREATE TABLE IF NOT EXISTS subscribers (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      source TEXT NOT NULL,
      created_at TEXT NOT NULL,
      confirmed_at TEXT,
      unsubscribed_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_subscribers_created
      ON subscribers(created_at DESC);

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

  database.exec(`
    INSERT INTO shift_scheduler_settings
      (enabled, interval_minutes, cooldown_minutes, max_shifts_per_day, quiet_hours_start, quiet_hours_end)
    SELECT 0, 120, 30, 6, '02:00', '06:00'
    WHERE NOT EXISTS (SELECT 1 FROM shift_scheduler_settings);
  `);

  database.exec(`
    INSERT INTO agent_monitoring_settings
      (id,
       builder_network_access,
       builder_monitor_enabled,
       builder_auto_kill_on_threat,
       reviewer_network_access,
       reviewer_monitor_enabled,
       reviewer_auto_kill_on_threat,
       shift_agent_network_access,
       shift_agent_monitor_enabled,
       shift_agent_auto_kill_on_threat,
       global_agent_network_access,
       global_agent_monitor_enabled,
       global_agent_auto_kill_on_threat)
    SELECT
      'global',
      'sandboxed',
      1,
      1,
      'sandboxed',
      1,
      1,
      'full',
      1,
      1,
      'full',
      1,
      1
    WHERE NOT EXISTS (SELECT 1 FROM agent_monitoring_settings);
  `);

  const defaultWhitelist = [
    "nextjs.org",
    "react.dev",
    "nodejs.org",
    "developer.mozilla.org",
    "typescriptlang.org",
    "eslint.org",
    "jestjs.io",
    "playwright.dev",
    "tailwindcss.com",
    "code.claude.com",
    "docs.anthropic.com",
    "platform.openai.com",
    "ai.google.dev",
    "elevenlabs.io",
    "docs.stripe.com",
    "fly.io",
    "registry.npmjs.org",
    "www.npmjs.com",
    "pypi.org",
    "github.com",
    "raw.githubusercontent.com",
    "stackoverflow.com",
    "en.wikipedia.org",
  ];

  const whitelistInsert = database.prepare(
    `INSERT OR IGNORE INTO network_whitelist
      (domain, enabled, created_at)
     VALUES
      (@domain, @enabled, @created_at)`
  );
  const whitelistNow = new Date().toISOString();
  const insertWhitelist = database.transaction((domains: string[]) => {
    for (const domain of domains) {
      whitelistInsert.run({ domain, enabled: 1, created_at: whitelistNow });
    }
  });
  const whitelistCount = database
    .prepare("SELECT COUNT(*) as count FROM network_whitelist")
    .get() as { count: number };
  if (whitelistCount.count === 0) {
    insertWhitelist(defaultWhitelist);
  }

  // Lightweight migration for existing DBs.
  const projectColumns = database.prepare("PRAGMA table_info(projects)").all() as Array<{ name: string }>;
  const hasStarred = projectColumns.some((c) => c.name === "starred");
  const hasDescription = projectColumns.some((c) => c.name === "description");
  const hasSuccessCriteria = projectColumns.some((c) => c.name === "success_criteria");
  const hasSuccessMetrics = projectColumns.some((c) => c.name === "success_metrics");
  const hasHidden = projectColumns.some((c) => c.name === "hidden");
  const hasAutoShiftEnabled = projectColumns.some((c) => c.name === "auto_shift_enabled");
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
  if (!hasAutoShiftEnabled) {
    database.exec("ALTER TABLE projects ADD COLUMN auto_shift_enabled INTEGER NOT NULL DEFAULT 0;");
  }
  if (!hasIsolationMode) {
    database.exec("ALTER TABLE projects ADD COLUMN isolation_mode TEXT NOT NULL DEFAULT 'local';");
  }
  if (!hasVmSize) {
    database.exec("ALTER TABLE projects ADD COLUMN vm_size TEXT NOT NULL DEFAULT 'medium';");
  }

  const initiativeColumns = database
    .prepare("PRAGMA table_info(initiatives)")
    .all() as Array<{ name: string }>;
  const hasInitiativeSuggestionsSent = initiativeColumns.some(
    (c) => c.name === "suggestions_sent"
  );
  if (!hasInitiativeSuggestionsSent) {
    database.exec(
      "ALTER TABLE initiatives ADD COLUMN suggestions_sent TEXT NOT NULL DEFAULT '[]';"
    );
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

  const constitutionSuggestionTableExists = database
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='constitution_suggestions'")
    .get();
  if (!constitutionSuggestionTableExists) {
    database.exec(`
      CREATE TABLE constitution_suggestions (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        scope TEXT NOT NULL,
        category TEXT NOT NULL,
        text TEXT NOT NULL,
        evidence TEXT NOT NULL DEFAULT '[]',
        status TEXT NOT NULL DEFAULT 'pending',
        created_at TEXT NOT NULL,
        accepted_at TEXT,
        accepted_by TEXT,
        rejected_at TEXT,
        rejected_by TEXT,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      );

      CREATE INDEX idx_constitution_suggestions_project_created
        ON constitution_suggestions(project_id, created_at DESC);
      CREATE INDEX idx_constitution_suggestions_status
        ON constitution_suggestions(project_id, status, created_at DESC);
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
  const hasTriggeredBy = runColumns.some((c) => c.name === "triggered_by");
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
  if (!hasTriggeredBy) {
    database.exec("ALTER TABLE runs ADD COLUMN triggered_by TEXT NOT NULL DEFAULT 'manual';");
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

export function listAutoShiftProjects(): ProjectRow[] {
  const database = getDb();
  return database
    .prepare(
      "SELECT * FROM projects WHERE auto_shift_enabled = 1 ORDER BY priority ASC, name ASC"
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
      `INSERT INTO projects (id, path, name, description, success_criteria, success_metrics, type, stage, status, priority, starred, hidden, auto_shift_enabled, tags, isolation_mode, vm_size, last_run_at, created_at, updated_at)
       VALUES (@id, @path, @name, @description, @success_criteria, @success_metrics, @type, @stage, @status, @priority, @starred, @hidden, @auto_shift_enabled, @tags, @isolation_mode, @vm_size, @last_run_at, @created_at, @updated_at)
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
        auto_shift_enabled=projects.auto_shift_enabled,
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

export function updateProjectAutoShift(
  id: string,
  enabled: boolean
): ProjectRow | null {
  const database = getDb();
  const now = new Date().toISOString();
  database
    .prepare("UPDATE projects SET auto_shift_enabled = ?, updated_at = ? WHERE id = ?")
    .run(enabled ? 1 : 0, now, id);
  return findProjectById(id);
}

const AUTOPILOT_POLICY_DEFAULTS: Omit<
  AutopilotPolicyRow,
  "project_id" | "created_at" | "updated_at"
> = {
  enabled: 0,
  max_concurrent_runs: 1,
  allowed_tags: null,
  min_priority: null,
  stop_on_failure_count: 3,
  schedule_cron: null,
};

function parseAutopilotTags(value: string | null): string[] | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return null;
    const cleaned = parsed
      .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
      .filter(Boolean);
    return cleaned.length ? cleaned : null;
  } catch {
    return null;
  }
}

function serializeAutopilotTags(value: string[] | null | undefined): string | null {
  if (!value) return null;
  const cleaned = value.map((entry) => entry.trim()).filter(Boolean);
  return cleaned.length ? JSON.stringify(cleaned) : null;
}

function normalizeAutopilotPolicy(row: AutopilotPolicyRow): AutopilotPolicy {
  return {
    project_id: row.project_id,
    enabled: row.enabled === 1,
    max_concurrent_runs: row.max_concurrent_runs,
    allowed_tags: parseAutopilotTags(row.allowed_tags),
    min_priority: row.min_priority,
    stop_on_failure_count: row.stop_on_failure_count,
    schedule_cron: row.schedule_cron,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function ensureAutopilotPolicyRow(projectId: string): AutopilotPolicyRow {
  const database = getDb();
  const existing = database
    .prepare("SELECT * FROM autopilot_policies WHERE project_id = ? LIMIT 1")
    .get(projectId) as AutopilotPolicyRow | undefined;
  if (existing) return existing;
  const now = new Date().toISOString();
  const row: AutopilotPolicyRow = {
    project_id: projectId,
    ...AUTOPILOT_POLICY_DEFAULTS,
    created_at: now,
    updated_at: now,
  };
  database
    .prepare(
      `INSERT INTO autopilot_policies
        (project_id, enabled, max_concurrent_runs, allowed_tags, min_priority, stop_on_failure_count, schedule_cron, created_at, updated_at)
       VALUES
        (@project_id, @enabled, @max_concurrent_runs, @allowed_tags, @min_priority, @stop_on_failure_count, @schedule_cron, @created_at, @updated_at)`
    )
    .run(row);
  return row;
}

export function getAutopilotPolicy(projectId: string): AutopilotPolicy {
  return normalizeAutopilotPolicy(ensureAutopilotPolicyRow(projectId));
}

export function updateAutopilotPolicy(
  projectId: string,
  patch: AutopilotPolicyPatch
): AutopilotPolicy {
  const database = getDb();
  const existing = ensureAutopilotPolicyRow(projectId);
  const hasAllowedTags = Object.prototype.hasOwnProperty.call(patch, "allowed_tags");
  const hasMinPriority = Object.prototype.hasOwnProperty.call(patch, "min_priority");
  const hasScheduleCron = Object.prototype.hasOwnProperty.call(patch, "schedule_cron");
  const now = new Date().toISOString();
  const updated: AutopilotPolicyRow = {
    ...existing,
    enabled:
      patch.enabled !== undefined ? (patch.enabled ? 1 : 0) : existing.enabled,
    max_concurrent_runs:
      patch.max_concurrent_runs !== undefined
        ? patch.max_concurrent_runs
        : existing.max_concurrent_runs,
    allowed_tags: hasAllowedTags
      ? serializeAutopilotTags(patch.allowed_tags)
      : existing.allowed_tags,
    min_priority: hasMinPriority ? patch.min_priority ?? null : existing.min_priority,
    stop_on_failure_count:
      patch.stop_on_failure_count !== undefined
        ? patch.stop_on_failure_count
        : existing.stop_on_failure_count,
    schedule_cron: hasScheduleCron ? patch.schedule_cron ?? null : existing.schedule_cron,
    updated_at: now,
  };
  database
    .prepare(
      `UPDATE autopilot_policies
       SET enabled = @enabled,
           max_concurrent_runs = @max_concurrent_runs,
           allowed_tags = @allowed_tags,
           min_priority = @min_priority,
           stop_on_failure_count = @stop_on_failure_count,
           schedule_cron = @schedule_cron,
           updated_at = @updated_at
       WHERE project_id = @project_id`
    )
    .run(updated);
  return getAutopilotPolicy(projectId);
}

export function listEnabledAutopilotPolicies(): AutopilotPolicy[] {
  const database = getDb();
  const rows = database
    .prepare("SELECT * FROM autopilot_policies WHERE enabled = 1")
    .all() as AutopilotPolicyRow[];
  return rows.map((row) => normalizeAutopilotPolicy(row));
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

export function createRun(run: RunRow): void {
  const database = getDb();
  database
    .prepare(
      `INSERT INTO runs
        (id, project_id, work_order_id, provider, triggered_by, status, iteration, builder_iteration, reviewer_verdict, reviewer_notes, summary, estimated_iterations, estimated_minutes, estimate_confidence, estimate_reasoning, current_eta_minutes, estimated_completion_at, eta_history, branch_name, source_branch, merge_status, conflict_with_run_id, run_dir, log_path, created_at, started_at, finished_at, error, failure_category, failure_reason, failure_detail, escalation)
       VALUES
        (@id, @project_id, @work_order_id, @provider, @triggered_by, @status, @iteration, @builder_iteration, @reviewer_verdict, @reviewer_notes, @summary, @estimated_iterations, @estimated_minutes, @estimate_confidence, @estimate_reasoning, @current_eta_minutes, @estimated_completion_at, @eta_history, @branch_name, @source_branch, @merge_status, @conflict_with_run_id, @run_dir, @log_path, @created_at, @started_at, @finished_at, @error, @failure_category, @failure_reason, @failure_detail, @escalation)`
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

function normalizeSignalTags(tags: string[]): string[] {
  const cleaned = tags.map((tag) => tag.trim()).filter(Boolean);
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const tag of cleaned) {
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(tag);
  }
  return deduped;
}

function toSignal(row: SignalRow): Signal {
  return {
    id: row.id,
    project_id: row.project_id,
    work_order_id: row.work_order_id ?? null,
    run_id: row.run_id ?? null,
    type: row.type,
    summary: row.summary,
    tags: normalizeSignalTags(parseJsonStringArray(row.tags)),
    source: row.source,
    created_at: row.created_at,
  };
}

export function createSignal(input: CreateSignalInput): Signal {
  const database = getDb();
  const createdAt =
    typeof input.created_at === "string" && input.created_at.trim()
      ? input.created_at.trim()
      : new Date().toISOString();
  const tags = normalizeSignalTags(input.tags ?? []);
  const row: SignalRow = {
    id: crypto.randomUUID(),
    project_id: input.project_id,
    work_order_id: normalizeOptionalString(input.work_order_id) ?? null,
    run_id: normalizeOptionalString(input.run_id) ?? null,
    type: input.type.trim(),
    summary: input.summary.trim(),
    tags: JSON.stringify(tags),
    source: input.source.trim(),
    created_at: createdAt,
  };

  database
    .prepare(
      `INSERT INTO signals
        (id, project_id, work_order_id, run_id, type, summary, tags, source, created_at)
       VALUES
        (@id, @project_id, @work_order_id, @run_id, @type, @summary, @tags, @source, @created_at)`
    )
    .run(row);

  return toSignal(row);
}

export function listSignals(query: SignalQuery): Signal[] {
  const database = getDb();
  const clauses = ["project_id = ?"];
  const params: Array<string> = [query.project_id];

  if (query.work_order_id) {
    clauses.push("work_order_id = ?");
    params.push(query.work_order_id);
  }
  if (query.run_id) {
    clauses.push("run_id = ?");
    params.push(query.run_id);
  }

  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const limit =
    typeof query.limit === "number" && Number.isFinite(query.limit)
      ? Math.max(1, Math.min(200, Math.trunc(query.limit)))
      : 50;

  const rows = database
    .prepare(
      `SELECT *
       FROM signals
       ${where}
       ORDER BY created_at DESC
       LIMIT ?`
    )
    .all(...params, limit) as SignalRow[];

  return rows.map((row) => toSignal(row));
}

function normalizeSuggestionEvidenceInput(
  value: unknown
): ConstitutionSuggestionEvidence[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const evidence: ConstitutionSuggestionEvidence[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    const id = typeof record.id === "string" ? record.id.trim() : "";
    const summary = typeof record.summary === "string" ? record.summary.trim() : "";
    if (!id || !summary) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    evidence.push({
      id,
      summary,
      type: typeof record.type === "string" ? record.type.trim() : "",
      created_at:
        typeof record.created_at === "string" ? record.created_at.trim() : "",
    });
  }
  return evidence;
}

function parseJsonSuggestionEvidence(
  value: string | null
): ConstitutionSuggestionEvidence[] {
  if (!value) return [];
  try {
    return normalizeSuggestionEvidenceInput(JSON.parse(value));
  } catch {
    return [];
  }
}

function toConstitutionSuggestion(
  row: ConstitutionSuggestionRow
): ConstitutionSuggestion {
  return {
    id: row.id,
    project_id: row.project_id,
    scope: row.scope,
    category: row.category,
    text: row.text,
    evidence: parseJsonSuggestionEvidence(row.evidence),
    status: row.status,
    created_at: row.created_at,
    accepted_at: row.accepted_at,
    accepted_by: row.accepted_by,
    rejected_at: row.rejected_at,
    rejected_by: row.rejected_by,
  };
}

export function getConstitutionSuggestionById(
  id: string
): ConstitutionSuggestion | null {
  const database = getDb();
  const row = database
    .prepare("SELECT * FROM constitution_suggestions WHERE id = ?")
    .get(id) as ConstitutionSuggestionRow | undefined;
  return row ? toConstitutionSuggestion(row) : null;
}

export function getLatestConstitutionSuggestionCreatedAt(
  projectId: string
): string | null {
  const database = getDb();
  const row = database
    .prepare(
      `SELECT created_at
       FROM constitution_suggestions
       WHERE project_id = ?
       ORDER BY created_at DESC
       LIMIT 1`
    )
    .get(projectId) as { created_at: string } | undefined;
  return row?.created_at ?? null;
}

export function createConstitutionSuggestions(
  inputs: CreateConstitutionSuggestionInput[]
): ConstitutionSuggestion[] {
  if (inputs.length === 0) return [];
  const database = getDb();
  const now = new Date().toISOString();
  const rows: ConstitutionSuggestionRow[] = inputs.map((input) => {
    const createdAt =
      typeof input.created_at === "string" && input.created_at.trim()
        ? input.created_at.trim()
        : now;
    const evidence = normalizeSuggestionEvidenceInput(input.evidence);
    return {
      id: crypto.randomUUID(),
      project_id: input.project_id,
      scope: input.scope,
      category: input.category.trim(),
      text: input.text.trim(),
      evidence: JSON.stringify(evidence),
      status: "pending",
      created_at: createdAt,
      accepted_at: null,
      accepted_by: null,
      rejected_at: null,
      rejected_by: null,
    };
  });

  const insert = database.transaction(() => {
    const stmt = database.prepare(
      `INSERT INTO constitution_suggestions
        (id, project_id, scope, category, text, evidence, status, created_at, accepted_at, accepted_by, rejected_at, rejected_by)
       VALUES
        (@id, @project_id, @scope, @category, @text, @evidence, @status, @created_at, @accepted_at, @accepted_by, @rejected_at, @rejected_by)`
    );
    for (const row of rows) {
      stmt.run(row);
    }
  });
  insert();

  return rows.map((row) => toConstitutionSuggestion(row));
}

export function listConstitutionSuggestions(
  query: ConstitutionSuggestionQuery
): ConstitutionSuggestion[] {
  const database = getDb();
  const clauses = ["project_id = ?"];
  const params: Array<string> = [query.project_id];
  if (query.status) {
    clauses.push("status = ?");
    params.push(query.status);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const limit =
    typeof query.limit === "number" && Number.isFinite(query.limit)
      ? Math.max(1, Math.min(200, Math.trunc(query.limit)))
      : 50;

  const rows = database
    .prepare(
      `SELECT *
       FROM constitution_suggestions
       ${where}
       ORDER BY created_at DESC
       LIMIT ?`
    )
    .all(...params, limit) as ConstitutionSuggestionRow[];

  return rows.map((row) => toConstitutionSuggestion(row));
}

export function decideConstitutionSuggestion(params: {
  id: string;
  status: "accepted" | "rejected";
  actor: string;
  decided_at?: string;
}): ConstitutionSuggestion | null {
  const database = getDb();
  const row = database
    .prepare("SELECT * FROM constitution_suggestions WHERE id = ?")
    .get(params.id) as ConstitutionSuggestionRow | undefined;
  if (!row) return null;
  if (row.status !== "pending") return toConstitutionSuggestion(row);

  const decidedAt =
    typeof params.decided_at === "string" && params.decided_at.trim()
      ? params.decided_at.trim()
      : new Date().toISOString();
  const actor = params.actor.trim() || "user";

  if (params.status === "accepted") {
    database
      .prepare(
        `UPDATE constitution_suggestions
         SET status = 'accepted', accepted_at = ?, accepted_by = ?
         WHERE id = ?`
      )
      .run(decidedAt, actor, params.id);
  } else {
    database
      .prepare(
        `UPDATE constitution_suggestions
         SET status = 'rejected', rejected_at = ?, rejected_by = ?
         WHERE id = ?`
      )
      .run(decidedAt, actor, params.id);
  }

  const updated = database
    .prepare("SELECT * FROM constitution_suggestions WHERE id = ?")
    .get(params.id) as ConstitutionSuggestionRow | undefined;
  return updated ? toConstitutionSuggestion(updated) : null;
}

const INCIDENT_ARCHIVE_DAYS = 90;

function normalizeLatency(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.max(0, Math.trunc(value));
}

function archiveStaleSecurityIncidents(database: Database.Database): void {
  const cutoff = new Date(
    Date.now() - INCIDENT_ARCHIVE_DAYS * 24 * 60 * 60 * 1000
  ).toISOString();
  database
    .prepare(
      `UPDATE security_incidents
       SET archived_at = ?
       WHERE archived_at IS NULL AND timestamp < ?`
    )
    .run(new Date().toISOString(), cutoff);
}

export function createSecurityIncident(
  input: CreateSecurityIncidentInput
): SecurityIncidentRow {
  const database = getDb();
  archiveStaleSecurityIncidents(database);
  const createdAt = input.created_at ?? new Date().toISOString();
  const row: SecurityIncidentRow = {
    id: crypto.randomUUID(),
    run_id: input.run_id,
    project_id: input.project_id,
    timestamp: input.timestamp,
    pattern_category: input.pattern_category,
    pattern_matched: input.pattern_matched,
    trigger_content: input.trigger_content,
    agent_output_snippet: input.agent_output_snippet ?? null,
    wo_id: input.wo_id ?? null,
    wo_goal: input.wo_goal ?? null,
    gemini_verdict: input.gemini_verdict,
    gemini_reason: input.gemini_reason ?? null,
    gemini_latency_ms: normalizeLatency(input.gemini_latency_ms),
    action_taken: input.action_taken,
    user_resolution: null,
    false_positive: 0,
    resolution_timestamp: null,
    resolution_notes: null,
    created_at: createdAt,
    archived_at: null,
  };
  database
    .prepare(
      `INSERT INTO security_incidents
        (id, run_id, project_id, timestamp, pattern_category, pattern_matched, trigger_content, agent_output_snippet, wo_id, wo_goal, gemini_verdict, gemini_reason, gemini_latency_ms, action_taken, user_resolution, false_positive, resolution_timestamp, resolution_notes, created_at, archived_at)
       VALUES
        (@id, @run_id, @project_id, @timestamp, @pattern_category, @pattern_matched, @trigger_content, @agent_output_snippet, @wo_id, @wo_goal, @gemini_verdict, @gemini_reason, @gemini_latency_ms, @action_taken, @user_resolution, @false_positive, @resolution_timestamp, @resolution_notes, @created_at, @archived_at)`
    )
    .run(row);
  return row;
}

export function getLatestUnresolvedSecurityIncident(
  runId: string
): SecurityIncidentRow | null {
  const database = getDb();
  archiveStaleSecurityIncidents(database);
  const row = database
    .prepare(
      `SELECT *
       FROM security_incidents
       WHERE run_id = ?
         AND archived_at IS NULL
         AND user_resolution IS NULL
       ORDER BY timestamp DESC
       LIMIT 1`
    )
    .get(runId) as SecurityIncidentRow | undefined;
  return row || null;
}

export function listSecurityIncidents(
  query: SecurityIncidentQuery = {}
): SecurityIncidentRow[] {
  const database = getDb();
  archiveStaleSecurityIncidents(database);
  const clauses: string[] = ["archived_at IS NULL"];
  const params: Array<string | number> = [];

  if (query.start) {
    clauses.push("timestamp >= ?");
    params.push(query.start);
  }
  if (query.end) {
    clauses.push("timestamp <= ?");
    params.push(query.end);
  }
  if (query.verdict) {
    clauses.push("gemini_verdict = ?");
    params.push(query.verdict);
  }
  if (query.false_positive !== undefined) {
    clauses.push("false_positive = ?");
    params.push(query.false_positive ? 1 : 0);
  }

  const whereClause = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const order = query.order === "asc" ? "ASC" : "DESC";
  const limit =
    typeof query.limit === "number" && Number.isFinite(query.limit)
      ? Math.max(1, Math.min(500, Math.trunc(query.limit)))
      : 200;

  return database
    .prepare(
      `SELECT *
       FROM security_incidents
       ${whereClause}
       ORDER BY timestamp ${order}
       LIMIT ?`
    )
    .all(...params, limit) as SecurityIncidentRow[];
}

export function updateIncidentResolution(params: {
  run_id: string;
  resolution: SecurityIncidentResolution;
  incident_id?: string | null;
  false_positive?: boolean;
  resolution_notes?: string | null;
  resolved_at?: string;
}): SecurityIncidentRow | null {
  const database = getDb();
  archiveStaleSecurityIncidents(database);
  const resolvedAt = params.resolved_at ?? new Date().toISOString();

  const incidentId = (() => {
    if (params.incident_id) return params.incident_id;
    const row = database
      .prepare(
        `SELECT id
         FROM security_incidents
         WHERE run_id = ?
           AND archived_at IS NULL
           AND user_resolution IS NULL
         ORDER BY timestamp DESC
         LIMIT 1`
      )
      .get(params.run_id) as { id: string } | undefined;
    return row?.id ?? null;
  })();

  if (!incidentId) return null;

  const patch: Partial<SecurityIncidentRow> = {
    user_resolution: params.resolution,
    resolution_timestamp: resolvedAt,
  };
  if (params.false_positive !== undefined) {
    patch.false_positive = params.false_positive ? 1 : 0;
  }
  if (params.resolution_notes !== undefined) {
    patch.resolution_notes = params.resolution_notes ?? null;
  }

  const fields: Array<{ key: keyof typeof patch; column: string }> = [
    { key: "user_resolution", column: "user_resolution" },
    { key: "false_positive", column: "false_positive" },
    { key: "resolution_timestamp", column: "resolution_timestamp" },
    { key: "resolution_notes", column: "resolution_notes" },
  ];
  const sets = fields
    .filter((field) => patch[field.key] !== undefined)
    .map((field) => `${field.column} = @${field.key}`);
  if (!sets.length) return null;

  database
    .prepare(`UPDATE security_incidents SET ${sets.join(", ")} WHERE id = @id`)
    .run({ id: incidentId, ...patch });

  const updated = database
    .prepare("SELECT * FROM security_incidents WHERE id = ? LIMIT 1")
    .get(incidentId) as SecurityIncidentRow | undefined;
  return updated || null;
}

export function markSecurityIncidentFalsePositive(params: {
  id: string;
  false_positive: boolean;
  resolution_notes?: string | null;
}): SecurityIncidentRow | null {
  const database = getDb();
  archiveStaleSecurityIncidents(database);
  const patch: Partial<SecurityIncidentRow> = {
    false_positive: params.false_positive ? 1 : 0,
  };
  if (params.resolution_notes !== undefined) {
    patch.resolution_notes = params.resolution_notes ?? null;
  }

  const fields: Array<{ key: keyof typeof patch; column: string }> = [
    { key: "false_positive", column: "false_positive" },
    { key: "resolution_notes", column: "resolution_notes" },
  ];
  const sets = fields
    .filter((field) => patch[field.key] !== undefined)
    .map((field) => `${field.column} = @${field.key}`);
  if (!sets.length) return null;

  const result = database
    .prepare(`UPDATE security_incidents SET ${sets.join(", ")} WHERE id = @id`)
    .run({ id: params.id, ...patch });
  if (result.changes === 0) return null;

  const updated = database
    .prepare("SELECT * FROM security_incidents WHERE id = ? LIMIT 1")
    .get(params.id) as SecurityIncidentRow | undefined;
  return updated || null;
}

export function getIncidentStats(): IncidentStats {
  const database = getDb();
  archiveStaleSecurityIncidents(database);
  const baseWhere = "WHERE archived_at IS NULL";

  const totalRow = database
    .prepare(`SELECT COUNT(1) AS total FROM security_incidents ${baseWhere}`)
    .get() as { total: number | null } | undefined;

  const verdictRows = database
    .prepare(
      `SELECT gemini_verdict AS verdict, COUNT(1) AS count
       FROM security_incidents
       ${baseWhere}
       GROUP BY gemini_verdict`
    )
    .all() as Array<{ verdict: SecurityIncidentVerdict; count: number }>;

  const categoryRows = database
    .prepare(
      `SELECT pattern_category AS category, COUNT(1) AS count
       FROM security_incidents
       ${baseWhere}
       GROUP BY pattern_category`
    )
    .all() as Array<{ category: string; count: number }>;

  const resolutionRow = database
    .prepare(
      `SELECT
        SUM(CASE WHEN user_resolution IS NOT NULL THEN 1 ELSE 0 END) AS resolved_count,
        SUM(CASE WHEN user_resolution IS NOT NULL AND false_positive = 1 THEN 1 ELSE 0 END) AS false_positives
       FROM security_incidents
       ${baseWhere}`
    )
    .get() as { resolved_count: number | null; false_positives: number | null } | undefined;

  const avgLatencyRow = database
    .prepare(
      `SELECT AVG(gemini_latency_ms) AS avg_latency
       FROM security_incidents
       ${baseWhere}
       AND gemini_latency_ms IS NOT NULL`
    )
    .get() as { avg_latency: number | null } | undefined;

  const cutoff7 = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const cutoff30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const last7Row = database
    .prepare(
      `SELECT COUNT(1) AS count
       FROM security_incidents
       ${baseWhere}
       AND timestamp >= ?`
    )
    .get(cutoff7) as { count: number | null } | undefined;

  const last30Row = database
    .prepare(
      `SELECT COUNT(1) AS count
       FROM security_incidents
       ${baseWhere}
       AND timestamp >= ?`
    )
    .get(cutoff30) as { count: number | null } | undefined;

  const byVerdict = { SAFE: 0, WARN: 0, KILL: 0 };
  for (const row of verdictRows) {
    if (row.verdict in byVerdict) {
      byVerdict[row.verdict] = Number.isFinite(row.count) ? row.count : 0;
    }
  }

  const byCategory: Record<string, number> = {};
  for (const row of categoryRows) {
    if (!row.category) continue;
    byCategory[row.category] = Number.isFinite(row.count) ? row.count : 0;
  }

  const resolvedCount = Number.isFinite(resolutionRow?.resolved_count ?? null)
    ? (resolutionRow?.resolved_count as number)
    : 0;
  const falsePositives = Number.isFinite(resolutionRow?.false_positives ?? null)
    ? (resolutionRow?.false_positives as number)
    : 0;

  return {
    total: Number.isFinite(totalRow?.total ?? null) ? (totalRow?.total as number) : 0,
    by_verdict: byVerdict,
    by_category: byCategory,
    false_positive_rate: resolvedCount > 0 ? falsePositives / resolvedCount : 0,
    avg_gemini_latency_ms: Number.isFinite(avgLatencyRow?.avg_latency ?? null)
      ? (avgLatencyRow?.avg_latency as number)
      : 0,
    last_7_days: Number.isFinite(last7Row?.count ?? null) ? (last7Row?.count as number) : 0,
    last_30_days: Number.isFinite(last30Row?.count ?? null)
      ? (last30Row?.count as number)
      : 0,
  };
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

const AGENT_MONITORING_DEFAULTS: AgentMonitoringSettingsRow = {
  id: "global",
  builder_network_access: "sandboxed",
  builder_monitor_enabled: 1,
  builder_auto_kill_on_threat: 1,
  reviewer_network_access: "sandboxed",
  reviewer_monitor_enabled: 1,
  reviewer_auto_kill_on_threat: 1,
  shift_agent_network_access: "full",
  shift_agent_monitor_enabled: 1,
  shift_agent_auto_kill_on_threat: 1,
  global_agent_network_access: "full",
  global_agent_monitor_enabled: 1,
  global_agent_auto_kill_on_threat: 1,
};

export function getAgentMonitoringSettingsRow(): AgentMonitoringSettingsRow {
  const database = getDb();
  const row = database
    .prepare("SELECT * FROM agent_monitoring_settings LIMIT 1")
    .get() as AgentMonitoringSettingsRow | undefined;
  if (row) return row;
  database
    .prepare(
      `INSERT INTO agent_monitoring_settings
        (id,
         builder_network_access,
         builder_monitor_enabled,
         builder_auto_kill_on_threat,
         reviewer_network_access,
         reviewer_monitor_enabled,
         reviewer_auto_kill_on_threat,
         shift_agent_network_access,
         shift_agent_monitor_enabled,
         shift_agent_auto_kill_on_threat,
         global_agent_network_access,
         global_agent_monitor_enabled,
         global_agent_auto_kill_on_threat)
       VALUES
        (@id,
         @builder_network_access,
         @builder_monitor_enabled,
         @builder_auto_kill_on_threat,
         @reviewer_network_access,
         @reviewer_monitor_enabled,
         @reviewer_auto_kill_on_threat,
         @shift_agent_network_access,
         @shift_agent_monitor_enabled,
         @shift_agent_auto_kill_on_threat,
         @global_agent_network_access,
         @global_agent_monitor_enabled,
         @global_agent_auto_kill_on_threat)`
    )
    .run(AGENT_MONITORING_DEFAULTS);
  return { ...AGENT_MONITORING_DEFAULTS };
}

export function setAgentMonitoringSettingsRow(
  settings: AgentMonitoringSettingsRow
): AgentMonitoringSettingsRow {
  const database = getDb();
  const existing = database
    .prepare("SELECT 1 FROM agent_monitoring_settings LIMIT 1")
    .get();
  if (!existing) {
    database
      .prepare(
        `INSERT INTO agent_monitoring_settings
          (id,
           builder_network_access,
           builder_monitor_enabled,
           builder_auto_kill_on_threat,
           reviewer_network_access,
           reviewer_monitor_enabled,
           reviewer_auto_kill_on_threat,
           shift_agent_network_access,
           shift_agent_monitor_enabled,
           shift_agent_auto_kill_on_threat,
           global_agent_network_access,
           global_agent_monitor_enabled,
           global_agent_auto_kill_on_threat)
         VALUES
          (@id,
           @builder_network_access,
           @builder_monitor_enabled,
           @builder_auto_kill_on_threat,
           @reviewer_network_access,
           @reviewer_monitor_enabled,
           @reviewer_auto_kill_on_threat,
           @shift_agent_network_access,
           @shift_agent_monitor_enabled,
           @shift_agent_auto_kill_on_threat,
           @global_agent_network_access,
           @global_agent_monitor_enabled,
           @global_agent_auto_kill_on_threat)`
      )
      .run(settings);
    return { ...settings };
  }
  database
    .prepare(
      `UPDATE agent_monitoring_settings
       SET builder_network_access = @builder_network_access,
           builder_monitor_enabled = @builder_monitor_enabled,
           builder_auto_kill_on_threat = @builder_auto_kill_on_threat,
           reviewer_network_access = @reviewer_network_access,
           reviewer_monitor_enabled = @reviewer_monitor_enabled,
           reviewer_auto_kill_on_threat = @reviewer_auto_kill_on_threat,
           shift_agent_network_access = @shift_agent_network_access,
           shift_agent_monitor_enabled = @shift_agent_monitor_enabled,
           shift_agent_auto_kill_on_threat = @shift_agent_auto_kill_on_threat,
           global_agent_network_access = @global_agent_network_access,
           global_agent_monitor_enabled = @global_agent_monitor_enabled,
           global_agent_auto_kill_on_threat = @global_agent_auto_kill_on_threat`
    )
    .run(settings);
  return getAgentMonitoringSettingsRow();
}

const SHIFT_SCHEDULER_DEFAULTS: ShiftSchedulerSettingsRow = {
  enabled: 0,
  interval_minutes: 120,
  cooldown_minutes: 30,
  max_shifts_per_day: 6,
  quiet_hours_start: "02:00",
  quiet_hours_end: "06:00",
};

export function getShiftSchedulerSettingsRow(): ShiftSchedulerSettingsRow {
  const database = getDb();
  const row = database
    .prepare("SELECT * FROM shift_scheduler_settings LIMIT 1")
    .get() as ShiftSchedulerSettingsRow | undefined;
  if (row) return row;
  database
    .prepare(
      `INSERT INTO shift_scheduler_settings
        (enabled, interval_minutes, cooldown_minutes, max_shifts_per_day, quiet_hours_start, quiet_hours_end)
       VALUES
        (@enabled, @interval_minutes, @cooldown_minutes, @max_shifts_per_day, @quiet_hours_start, @quiet_hours_end)`
    )
    .run(SHIFT_SCHEDULER_DEFAULTS);
  return { ...SHIFT_SCHEDULER_DEFAULTS };
}

export function setShiftSchedulerSettingsRow(
  settings: ShiftSchedulerSettingsRow
): ShiftSchedulerSettingsRow {
  const database = getDb();
  const existing = database
    .prepare("SELECT 1 FROM shift_scheduler_settings LIMIT 1")
    .get();
  if (!existing) {
    database
      .prepare(
        `INSERT INTO shift_scheduler_settings
          (enabled, interval_minutes, cooldown_minutes, max_shifts_per_day, quiet_hours_start, quiet_hours_end)
         VALUES
          (@enabled, @interval_minutes, @cooldown_minutes, @max_shifts_per_day, @quiet_hours_start, @quiet_hours_end)`
      )
      .run(settings);
    return { ...settings };
  }
  database
    .prepare(
      `UPDATE shift_scheduler_settings
       SET enabled = @enabled,
           interval_minutes = @interval_minutes,
           cooldown_minutes = @cooldown_minutes,
           max_shifts_per_day = @max_shifts_per_day,
           quiet_hours_start = @quiet_hours_start,
           quiet_hours_end = @quiet_hours_end`
    )
    .run(settings);
  return getShiftSchedulerSettingsRow();
}

export function listNetworkWhitelistRows(): NetworkWhitelistRow[] {
  const database = getDb();
  return database
    .prepare(
      `SELECT domain, enabled, created_at
       FROM network_whitelist
       ORDER BY domain ASC`
    )
    .all() as NetworkWhitelistRow[];
}

export function upsertNetworkWhitelistRow(input: {
  domain: string;
  enabled: number;
  created_at?: string;
}): NetworkWhitelistRow {
  const database = getDb();
  const created_at = input.created_at ?? new Date().toISOString();
  database
    .prepare(
      `INSERT INTO network_whitelist
        (domain, enabled, created_at)
       VALUES
        (@domain, @enabled, @created_at)
       ON CONFLICT(domain) DO UPDATE SET
        enabled = excluded.enabled`
    )
    .run({ domain: input.domain, enabled: input.enabled, created_at });
  const row = database
    .prepare(
      `SELECT domain, enabled, created_at
       FROM network_whitelist
       WHERE domain = ?`
    )
    .get(input.domain) as NetworkWhitelistRow | undefined;
  return (
    row ?? {
      domain: input.domain,
      enabled: input.enabled,
      created_at,
    }
  );
}

export function deleteNetworkWhitelistRow(domain: string): boolean {
  const database = getDb();
  const result = database
    .prepare("DELETE FROM network_whitelist WHERE domain = ?")
    .run(domain);
  return result.changes > 0;
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

export function createSubscriber(input: {
  email: string;
  source?: string;
}): SubscriberCreateResult {
  const database = getDb();
  const email = input.email.trim().toLowerCase();
  if (!email) {
    throw new Error("email is required");
  }
  const source = input.source?.trim() || "unknown";
  const existing = database
    .prepare(
      `SELECT id, email, source, created_at, confirmed_at, unsubscribed_at
       FROM subscribers
       WHERE email = ?`
    )
    .get(email) as SubscriberRow | undefined;
  if (existing) {
    if (existing.unsubscribed_at) {
      database
        .prepare(
          `UPDATE subscribers
           SET unsubscribed_at = NULL,
               source = @source
           WHERE id = @id`
        )
        .run({ id: existing.id, source });
      return {
        status: "success",
        subscriber: { ...existing, unsubscribed_at: null, source },
      };
    }
    return { status: "already_exists", subscriber: existing };
  }
  const now = new Date().toISOString();
  const row: SubscriberRow = {
    id: crypto.randomUUID(),
    email,
    source,
    created_at: now,
    confirmed_at: null,
    unsubscribed_at: null,
  };
  database
    .prepare(
      `INSERT INTO subscribers
        (id, email, source, created_at, confirmed_at, unsubscribed_at)
       VALUES
        (@id, @email, @source, @created_at, @confirmed_at, @unsubscribed_at)`
    )
    .run(row);
  return { status: "success", subscriber: row };
}

export function listSubscribers(limit?: number): SubscriberRow[] {
  const database = getDb();
  if (typeof limit === "number" && Number.isFinite(limit) && limit > 0) {
    const safeLimit = Math.min(5000, Math.trunc(limit));
    return database
      .prepare(
        `SELECT id, email, source, created_at, confirmed_at, unsubscribed_at
         FROM subscribers
         ORDER BY created_at DESC
         LIMIT ?`
      )
      .all(safeLimit) as SubscriberRow[];
  }
  return database
    .prepare(
      `SELECT id, email, source, created_at, confirmed_at, unsubscribed_at
       FROM subscribers
       ORDER BY created_at DESC`
    )
    .all() as SubscriberRow[];
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

const INITIATIVE_STATUSES: InitiativeStatus[] = [
  "planning",
  "active",
  "completed",
  "at_risk",
];
const INITIATIVE_STATUS_SET = new Set<InitiativeStatus>(INITIATIVE_STATUSES);
const INITIATIVE_MILESTONE_STATUSES: InitiativeMilestoneStatus[] = [
  "pending",
  "completed",
  "at_risk",
];
const INITIATIVE_MILESTONE_STATUS_SET = new Set<InitiativeMilestoneStatus>(
  INITIATIVE_MILESTONE_STATUSES
);

function normalizeInitiativeStatus(value: unknown): InitiativeStatus {
  if (typeof value === "string" && INITIATIVE_STATUS_SET.has(value as InitiativeStatus)) {
    return value as InitiativeStatus;
  }
  return "planning";
}

function normalizeInitiativeProjects(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const cleaned = value
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter(Boolean);
  return Array.from(new Set(cleaned));
}

function normalizeInitiativeMilestone(raw: unknown): InitiativeMilestone | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const name = typeof record.name === "string" ? record.name.trim() : "";
  const targetDate =
    typeof record.target_date === "string" ? record.target_date.trim() : "";
  if (!name || !targetDate) return null;
  const wos = Array.isArray(record.wos)
    ? record.wos
        .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
        .filter(Boolean)
    : [];
  const rawStatus = typeof record.status === "string" ? record.status.trim() : "";
  const status = INITIATIVE_MILESTONE_STATUS_SET.has(
    rawStatus as InitiativeMilestoneStatus
  )
    ? (rawStatus as InitiativeMilestoneStatus)
    : "pending";
  return { name, target_date: targetDate, wos, status };
}

function normalizeInitiativeMilestones(value: unknown): InitiativeMilestone[] {
  if (!Array.isArray(value)) return [];
  const milestones: InitiativeMilestone[] = [];
  for (const entry of value) {
    const milestone = normalizeInitiativeMilestone(entry);
    if (milestone) milestones.push(milestone);
  }
  return milestones;
}

function normalizeInitiativeSuggestionSent(
  raw: unknown
): InitiativeSuggestionSent | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const projectId =
    typeof record.project_id === "string" ? record.project_id.trim() : "";
  const title =
    typeof record.suggested_title === "string" ? record.suggested_title.trim() : "";
  const sentAt = typeof record.sent_at === "string" ? record.sent_at.trim() : "";
  if (!projectId || !title || !sentAt) return null;
  return { project_id: projectId, suggested_title: title, sent_at: sentAt };
}

function normalizeInitiativeSuggestionsSent(value: unknown): InitiativeSuggestionSent[] {
  if (!Array.isArray(value)) return [];
  const items: InitiativeSuggestionSent[] = [];
  for (const entry of value) {
    const normalized = normalizeInitiativeSuggestionSent(entry);
    if (normalized) items.push(normalized);
  }
  return items;
}

function parseInitiativeProjects(raw: string | null): string[] {
  if (!raw) return [];
  try {
    return normalizeInitiativeProjects(JSON.parse(raw) as unknown);
  } catch {
    return [];
  }
}

function parseInitiativeMilestones(raw: string | null): InitiativeMilestone[] {
  if (!raw) return [];
  try {
    return normalizeInitiativeMilestones(JSON.parse(raw) as unknown);
  } catch {
    return [];
  }
}

function parseInitiativeSuggestionsSent(raw: string | null): InitiativeSuggestionSent[] {
  if (!raw) return [];
  try {
    return normalizeInitiativeSuggestionsSent(JSON.parse(raw) as unknown);
  } catch {
    return [];
  }
}

function toInitiative(row: InitiativeRow): Initiative {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    target_date: row.target_date,
    status: normalizeInitiativeStatus(row.status),
    projects: parseInitiativeProjects(row.projects),
    milestones: parseInitiativeMilestones(row.milestones),
    suggestions_sent: parseInitiativeSuggestionsSent(row.suggestions_sent),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function createInitiative(input: {
  name: string;
  description: string;
  target_date: string;
  status?: InitiativeStatus;
  projects?: string[];
  milestones?: InitiativeMilestone[];
  suggestions_sent?: InitiativeSuggestionSent[];
  created_at?: string;
}): Initiative {
  const database = getDb();
  const now = input.created_at ?? new Date().toISOString();
  const row: InitiativeRow = {
    id: crypto.randomUUID(),
    name: input.name,
    description: input.description,
    target_date: input.target_date,
    status: normalizeInitiativeStatus(input.status),
    projects: JSON.stringify(normalizeInitiativeProjects(input.projects ?? [])),
    milestones: JSON.stringify(normalizeInitiativeMilestones(input.milestones ?? [])),
    suggestions_sent: JSON.stringify(
      normalizeInitiativeSuggestionsSent(input.suggestions_sent ?? [])
    ),
    created_at: now,
    updated_at: now,
  };
  database
    .prepare(
      `INSERT INTO initiatives
        (id, name, description, target_date, status, projects, milestones, suggestions_sent, created_at, updated_at)
       VALUES
        (@id, @name, @description, @target_date, @status, @projects, @milestones, @suggestions_sent, @created_at, @updated_at)`
    )
    .run(row);
  return toInitiative(row);
}

export function getInitiativeById(id: string): Initiative | null {
  const database = getDb();
  const row = database
    .prepare("SELECT * FROM initiatives WHERE id = ? LIMIT 1")
    .get(id) as InitiativeRow | undefined;
  return row ? toInitiative(row) : null;
}

export function listInitiatives(limit = 50): Initiative[] {
  const database = getDb();
  const safeLimit =
    Number.isFinite(limit) && limit > 0 ? Math.min(200, Math.trunc(limit)) : 50;
  const rows = database
    .prepare("SELECT * FROM initiatives ORDER BY updated_at DESC LIMIT ?")
    .all(safeLimit) as InitiativeRow[];
  return rows.map((row) => toInitiative(row));
}

export function updateInitiative(id: string, patch: InitiativePatch): Initiative | null {
  const database = getDb();
  const sets: string[] = [];
  const params: Record<string, unknown> = { id };
  if (patch.name !== undefined) {
    sets.push("name = @name");
    params.name = patch.name;
  }
  if (patch.description !== undefined) {
    sets.push("description = @description");
    params.description = patch.description;
  }
  if (patch.target_date !== undefined) {
    sets.push("target_date = @target_date");
    params.target_date = patch.target_date;
  }
  if (patch.status !== undefined) {
    sets.push("status = @status");
    params.status = normalizeInitiativeStatus(patch.status);
  }
  if (patch.projects !== undefined) {
    sets.push("projects = @projects");
    params.projects = JSON.stringify(normalizeInitiativeProjects(patch.projects));
  }
  if (patch.milestones !== undefined) {
    sets.push("milestones = @milestones");
    params.milestones = JSON.stringify(normalizeInitiativeMilestones(patch.milestones));
  }
  if (patch.suggestions_sent !== undefined) {
    sets.push("suggestions_sent = @suggestions_sent");
    params.suggestions_sent = JSON.stringify(
      normalizeInitiativeSuggestionsSent(patch.suggestions_sent)
    );
  }
  if (!sets.length) return getInitiativeById(id);
  params.updated_at = new Date().toISOString();
  database
    .prepare(
      `UPDATE initiatives
       SET ${sets.join(", ")}, updated_at = @updated_at
       WHERE id = @id`
    )
    .run(params);
  return getInitiativeById(id);
}

export function deleteInitiative(id: string): boolean {
  const database = getDb();
  const result = database.prepare("DELETE FROM initiatives WHERE id = ?").run(id);
  return result.changes > 0;
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

export function listWorkOrdersByTag(projectId: string, tag: string): TaggedWorkOrder[] {
  const needle = tag.trim().toLowerCase();
  if (!needle) return [];
  const database = getDb();
  const rows = database
    .prepare("SELECT id, status, tags FROM work_orders WHERE project_id = ?")
    .all(projectId) as Array<{ id: string; status: string; tags: string | null }>;

  const selected: Array<{ id: string; status: string }> = [];
  for (const row of rows) {
    const tags = parseJsonStringArray(row.tags);
    if (!tags.some((entry) => entry.toLowerCase() === needle)) continue;
    selected.push({ id: row.id, status: row.status });
  }

  if (!selected.length) return [];

  const selectedIds = new Set(selected.map((row) => row.id));
  const depRows = database
    .prepare("SELECT work_order_id, depends_on_id FROM work_order_deps WHERE project_id = ?")
    .all(projectId) as Array<{ work_order_id: string; depends_on_id: string }>;

  const depsByWorkOrder = new Map<string, Set<string>>();
  for (const row of depRows) {
    if (!selectedIds.has(row.work_order_id)) continue;
    let deps = depsByWorkOrder.get(row.work_order_id);
    if (!deps) {
      deps = new Set<string>();
      depsByWorkOrder.set(row.work_order_id, deps);
    }
    if (row.depends_on_id) deps.add(row.depends_on_id);
  }

  return selected.map((row) => ({
    project_id: projectId,
    work_order_id: row.id,
    status: row.status,
    depends_on: Array.from(depsByWorkOrder.get(row.id) ?? []),
  }));
}

export function countReadyWorkOrders(projectId: string): number {
  const database = getDb();
  const row = database
    .prepare("SELECT COUNT(*) as count FROM work_orders WHERE project_id = ? AND status = 'ready'")
    .get(projectId) as { count: number } | undefined;
  return row?.count ?? 0;
}

export function countShiftsSince(projectId: string, sinceIso: string): number {
  const database = getDb();
  const row = database
    .prepare("SELECT COUNT(*) as count FROM shifts WHERE project_id = ? AND started_at >= ?")
    .get(projectId, sinceIso) as { count: number } | undefined;
  return row?.count ?? 0;
}

export function getLatestShift(projectId: string): ShiftRow | null {
  const database = getDb();
  const row = database
    .prepare("SELECT * FROM shifts WHERE project_id = ? ORDER BY started_at DESC LIMIT 1")
    .get(projectId) as ShiftRow | undefined;
  return row || null;
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
