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

export type IncidentStats = {
  total: number;
  by_verdict: { SAFE: number; WARN: number; KILL: number };
  by_category: Record<string, number>;
  false_positive_rate: number;
  avg_gemini_latency_ms: number;
  last_7_days: number;
  last_30_days: number;
};

export type LogTail = {
  lines: string[];
  has_more: boolean;
};
