import type { GlobalContextResponse, GlobalProjectSummary } from "../global_context.js";
import { isWithinQuietHours } from "../user_preferences.js";

const DEFAULT_MAX_PROJECTS = 6;
const MAX_PROJECTS_CAP = 30;
const DEFAULT_RECENT_ACTIVITY_LIMIT = 6;
const MAX_ESCALATIONS = 12;

export type GlobalAttentionAllocation = {
  maxProjects?: number;
};

export type GlobalDecisionSessionConstraints = {
  max_budget_usd?: number;
  max_duration_minutes?: number;
  max_iterations?: number;
  do_not_touch?: string[];
};

export type GlobalDecisionSessionContext = {
  session_id: string;
  iteration_index: number;
  goals: string[];
  priority_projects: string[];
  constraints: GlobalDecisionSessionConstraints;
  briefing_summary: string;
};

type DecisionPromptOptions = {
  attention?: GlobalAttentionAllocation;
  recentActivityLimit?: number;
  session?: GlobalDecisionSessionContext;
};

function normalizeAttention(allocation?: GlobalAttentionAllocation): {
  maxProjects: number;
} {
  const raw = allocation?.maxProjects;
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    return { maxProjects: DEFAULT_MAX_PROJECTS };
  }
  const rounded = Math.trunc(raw);
  if (rounded <= 0) return { maxProjects: DEFAULT_MAX_PROJECTS };
  return { maxProjects: Math.min(rounded, MAX_PROJECTS_CAP) };
}

function selectProjects(
  projects: GlobalProjectSummary[],
  maxProjects: number
): { selected: GlobalProjectSummary[]; omitted: number } {
  if (projects.length <= maxProjects) {
    return { selected: projects, omitted: 0 };
  }
  return {
    selected: projects.slice(0, maxProjects),
    omitted: projects.length - maxProjects,
  };
}

function formatProjectsOverview(params: {
  projects: GlobalProjectSummary[];
  omitted: number;
}): string {
  if (!params.projects.length) return "None.";
  const lines = params.projects.map((project) => {
    const budget = project.budget
      ? `budget ${project.budget.status} ${formatUsd(project.budget.remaining_usd)}`
      : "budget n/a";
    return `- ${project.name} (${project.id}): ${project.health} | ${budget} | ${project.work_orders.ready} ready WOs | ${project.escalations.length} escalations`;
  });
  if (params.omitted > 0) {
    lines.push(`- ...and ${params.omitted} more projects`);
  }
  return lines.join("\n");
}

function buildEscalationSummaryMap(
  projects: GlobalProjectSummary[]
): Map<string, { projectId: string; summary: string }> {
  const map = new Map<string, { projectId: string; summary: string }>();
  for (const project of projects) {
    for (const escalation of project.escalations) {
      if (!escalation.id || map.has(escalation.id)) continue;
      map.set(escalation.id, { projectId: project.id, summary: escalation.summary });
    }
  }
  return map;
}

function formatEscalations(context: GlobalContextResponse): string {
  if (!context.escalation_queue.length) return "None.";
  const summaryMap = buildEscalationSummaryMap(context.projects);
  const shown = context.escalation_queue.slice(0, MAX_ESCALATIONS);
  const lines = shown.map((entry) => {
    const summary = summaryMap.get(entry.escalation_id)?.summary ?? "summary unavailable";
    return `- [${entry.project_id}] ${entry.type}: ${summary}`;
  });
  if (context.escalation_queue.length > MAX_ESCALATIONS) {
    lines.push(`- ...and ${context.escalation_queue.length - MAX_ESCALATIONS} more`);
  }
  return lines.join("\n");
}

function formatRecentActivity(context: GlobalContextResponse, limit: number): string {
  const withActivity = context.projects
    .filter((project) => project.last_activity)
    .slice()
    .sort((a, b) => (b.last_activity ?? "").localeCompare(a.last_activity ?? ""));
  if (!withActivity.length) return "No recent activity.";
  const shown = withActivity.slice(0, limit);
  const lines = shown.map(
    (project) => `- ${project.name} (${project.id}): ${project.last_activity}`
  );
  if (withActivity.length > limit) {
    lines.push(`- ...and ${withActivity.length - limit} more`);
  }
  return lines.join("\n");
}

function formatBudgetBlocks(projects: GlobalProjectSummary[]): string {
  const blocked = projects.filter(
    (project) =>
      project.budget &&
      (project.budget.status === "critical" || project.budget.status === "exhausted")
  );
  if (!blocked.length) return "None.";
  return blocked
    .map((project) => {
      const budget = project.budget;
      if (!budget) {
        return `- ${project.name} (${project.id}): budget data unavailable`;
      }
      return `- ${project.name} (${project.id}): ${budget.status.toUpperCase()} ${formatUsd(
        budget.remaining_usd
      )} remaining, runway ${formatDays(budget.runway_days)} days`;
    })
    .join("\n");
}

function formatUsd(value: number): string {
  if (!Number.isFinite(value)) return "$0.00";
  const sign = value < 0 ? "-" : "";
  return `${sign}$${Math.abs(value).toFixed(2)}`;
}

function formatPercent(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "n/a";
  return `${value.toFixed(0)}%`;
}

function formatDays(value: number): string {
  if (!Number.isFinite(value)) return "0";
  return value.toFixed(1);
}

function formatPortfolioEconomy(context: GlobalContextResponse): string {
  const economy = context.economy;
  const remainingPct =
    economy.monthly_budget_usd > 0
      ? (economy.total_remaining_usd / economy.monthly_budget_usd) * 100
      : null;
  const lines: string[] = [];
  lines.push(`Monthly budget: ${formatUsd(economy.monthly_budget_usd)}`);
  lines.push(`Allocated: ${formatUsd(economy.total_allocated_usd)}`);
  lines.push(`Spent: ${formatUsd(economy.total_spent_usd)}`);
  lines.push(
    `Remaining: ${formatUsd(economy.total_remaining_usd)} (${formatPercent(remainingPct)})`
  );
  lines.push(
    `Portfolio burn rate: ${formatUsd(economy.portfolio_burn_rate_daily_usd)}/day average (7d)`
  );
  lines.push(
    `Portfolio runway: ${formatDays(economy.portfolio_runway_days)} days at current rate`
  );
  lines.push(
    `Project budgets: ${economy.projects_healthy} healthy, ${economy.projects_warning} warning, ${economy.projects_critical} critical, ${economy.projects_exhausted} exhausted`
  );
  return lines.join("\n");
}

function formatPreferenceList(values: string[]): string {
  if (!values.length) return "None.";
  return values.map((value) => `- ${value}`).join("\n");
}

function formatPatternTime(value: string | null): string {
  return value ? value : "unknown";
}

function formatPatternMinutes(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "unknown";
  return `${Math.max(0, Math.round(value))} minutes`;
}

function formatSessionList(values: string[]): string {
  if (!values.length) return "None.";
  return values.map((value) => `- ${value}`).join("\n");
}

function formatSessionConstraints(constraints: GlobalDecisionSessionConstraints): string {
  const parts: string[] = [];
  if (typeof constraints.max_iterations === "number") {
    parts.push(`Max iterations: ${constraints.max_iterations}`);
  }
  if (typeof constraints.max_duration_minutes === "number") {
    parts.push(`Max duration: ${constraints.max_duration_minutes} minutes`);
  }
  if (typeof constraints.max_budget_usd === "number") {
    parts.push(`Max budget: $${constraints.max_budget_usd.toFixed(2)}`);
  }
  if (constraints.do_not_touch && constraints.do_not_touch.length) {
    parts.push(`Do not touch: ${constraints.do_not_touch.join(", ")}`);
  }
  if (!parts.length) return "None.";
  return parts.map((entry) => `- ${entry}`).join("\n");
}

function resolveAssembledDate(context: GlobalContextResponse): Date {
  const parsed = Date.parse(context.assembled_at);
  return Number.isFinite(parsed) ? new Date(parsed) : new Date();
}

export function buildGlobalDecisionPrompt(
  context: GlobalContextResponse,
  options: DecisionPromptOptions = {}
): string {
  const attention = normalizeAttention(options.attention);
  const selected = selectProjects(context.projects, attention.maxProjects);
  const recentActivityLimit =
    typeof options.recentActivityLimit === "number" && options.recentActivityLimit > 0
      ? Math.trunc(options.recentActivityLimit)
      : DEFAULT_RECENT_ACTIVITY_LIMIT;
  const preferences = context.preferences;
  const assembledAt = resolveAssembledDate(context);
  const quietNow = isWithinQuietHours(preferences.quiet_hours, assembledAt);

  const lines: string[] = [];
  lines.push("You are the Global Agent managing multiple projects.");
  lines.push("");
  if (options.session) {
    lines.push("## Session Briefing");
    lines.push(`Session ID: ${options.session.session_id}`);
    lines.push(`Iteration: ${options.session.iteration_index + 1}`);
    lines.push("Briefing summary:");
    lines.push(options.session.briefing_summary || "None.");
    lines.push("Goals:");
    lines.push(formatSessionList(options.session.goals));
    lines.push("Priority projects:");
    lines.push(formatSessionList(options.session.priority_projects));
    lines.push("Constraints:");
    lines.push(formatSessionConstraints(options.session.constraints));
    lines.push("");
  }
  lines.push("## User Preferences");
  lines.push(
    `- Quiet hours: ${preferences.quiet_hours.start}-${preferences.quiet_hours.end} (${quietNow ? "quiet hours active" : "active hours"})`
  );
  lines.push(
    `- Escalation batch window: ${preferences.escalation_batch_minutes} minutes`
  );
  lines.push("Priority projects:");
  lines.push(formatPreferenceList(preferences.priority_projects));
  lines.push("");
  lines.push("## Learned Patterns");
  lines.push(
    `- Typical active hours: ${
      preferences.typical_active_hours
        ? `${preferences.typical_active_hours.start}-${preferences.typical_active_hours.end}`
        : "unknown"
    }`
  );
  lines.push(
    `- Avg response time: ${formatPatternMinutes(
      preferences.avg_response_time_minutes
    )}`
  );
  lines.push(
    `- Preferred review time: ${formatPatternTime(preferences.preferred_review_time)}`
  );
  lines.push("");
  lines.push("## Attention Allocation");
  lines.push(`- Max projects in focus: ${attention.maxProjects}`);
  if (context.projects.length > attention.maxProjects) {
    lines.push(`- ${selected.omitted} projects are out of focus unless escalated`);
  }
  lines.push("");
  lines.push("## Projects Overview");
  lines.push(formatProjectsOverview({ projects: selected.selected, omitted: selected.omitted }));
  lines.push("");
  lines.push("## Budget Blocks");
  lines.push(formatBudgetBlocks(selected.selected));
  lines.push("");
  lines.push("## Portfolio Economy");
  lines.push(formatPortfolioEconomy(context));
  lines.push("");
  lines.push("## Pending Escalations");
  lines.push(formatEscalations(context));
  lines.push("");
  lines.push("## Recent Activity");
  lines.push(formatRecentActivity(context, recentActivityLimit));
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push(
    "Respect quiet hours for non-urgent escalations and batch interruptions when possible."
  );
  lines.push("");
  lines.push("Decide your next action:");
  lines.push("1. DELEGATE - Start shift on a project (specify project_id)");
  lines.push("2. RESOLVE - Handle an escalation (specify escalation_id + resolution)");
  lines.push("3. CREATE_PROJECT - Spin up new project (specify details)");
  lines.push("4. REPORT - Surface something to user (specify message)");
  lines.push("5. WAIT - Nothing urgent, check back later");
  lines.push("");
  lines.push("Respond with JSON:");
  lines.push("```json");
  lines.push('{ "action": "DELEGATE|RESOLVE|CREATE_PROJECT|REPORT|WAIT", "project_id": "", "escalation_id": "", "resolution": {}, "project": {}, "message": "", "reason": "" }');
  lines.push("```");
  return lines.join("\n");
}
