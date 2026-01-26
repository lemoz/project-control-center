export type VmMetric = {
  used_gb: number;
  total_gb: number;
  percent: number;
};

export type VmHealthResponse = {
  project_id: string | null;
  project_name: string | null;
  vm_status: string | null;
  disk: VmMetric;
  memory: VmMetric;
  cpu: { load_1m: number; load_5m: number; percent: number };
  containers: Array<{ name: string; status: string; uptime: string }>;
  reachable: boolean;
  last_check: string;
  error: string | null;
};

export type ActiveRun = {
  id: string;
  work_order_id: string;
  status: string;
  phase: string;
  started_at: string | null;
  duration_seconds: number;
  current_activity: string;
};

export type RunTimelineEntry = {
  id: string;
  work_order_id: string;
  status: string;
  started_at: string | null;
  finished_at: string | null;
  outcome: "passed" | "failed" | "in_progress";
};

export type RunFailureBreakdownCategory = {
  category: string;
  count: number;
  percent: number;
};

export type RunFailurePatternBreakdown = {
  category: string;
  pattern: string;
  count: number;
  percent: number;
};

export type RunFailureBreakdown = {
  total_runs: number;
  total_terminal: number;
  total_failed: number;
  success_rate: number;
  failure_rate: number;
  categories: RunFailureBreakdownCategory[];
  top_patterns: RunFailurePatternBreakdown[];
};

export type BudgetSummary = {
  monthly_budget: number;
  spent: number;
  remaining: number;
  daily_rate: number;
  runway_days: number;
  status: "healthy" | "warning" | "critical";
};

export type ObservabilityAlert = {
  id: string;
  type: string;
  severity: "warning" | "critical";
  message: string;
  created_at: string;
  acknowledged: boolean;
  run_id?: string;
  work_order_id?: string;
  waiting_since?: string;
};

export type LogTail = {
  lines: string[];
  has_more: boolean;
};
