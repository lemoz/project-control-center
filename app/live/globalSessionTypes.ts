export type GlobalAgentSessionState =
  | "onboarding"
  | "briefing"
  | "autonomous"
  | "debrief"
  | "ended";

export type OnboardingRubricItem = {
  id: string;
  label: string;
  done: boolean;
  optional?: boolean;
};

export type IntegrationsConfigured = {
  github: boolean;
  slack: boolean;
  linear: boolean;
};

export type SessionConstraints = {
  max_budget_usd?: number;
  max_duration_minutes?: number;
  max_iterations?: number;
  do_not_touch?: string[];
};

export type GlobalAgentSession = {
  id: string;
  chat_thread_id: string | null;
  state: GlobalAgentSessionState;
  onboarding_rubric: OnboardingRubricItem[];
  integrations_configured: IntegrationsConfigured;
  goals: string[];
  priority_projects: string[];
  constraints: SessionConstraints;
  briefing_summary: string | null;
  briefing_confirmed_at: string | null;
  autonomous_started_at: string | null;
  paused_at: string | null;
  iteration_count: number;
  decisions_count: number;
  actions_count: number;
  last_check_in_at: string | null;
  ended_at: string | null;
  created_at: string;
  updated_at: string;
};

export type GlobalAgentSessionEvent = {
  id: string;
  session_id: string;
  type: string;
  payload: Record<string, unknown> | null;
  created_at: string;
};

export type ActiveSessionResponse = {
  session: GlobalAgentSession | null;
  events: GlobalAgentSessionEvent[];
  error?: string;
};
