import type { GlobalContextResponse, GlobalProjectSummary } from "../global_context.js";

const DEFAULT_MAX_PROJECTS = 6;
const MAX_PROJECTS_CAP = 30;
const DEFAULT_RECENT_ACTIVITY_LIMIT = 6;
const MAX_ESCALATIONS = 12;

export type GlobalAttentionAllocation = {
  maxProjects?: number;
};

type DecisionPromptOptions = {
  attention?: GlobalAttentionAllocation;
  recentActivityLimit?: number;
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
    return `- ${project.name} (${project.id}): ${project.health} | ${project.work_orders.ready} ready WOs | ${project.escalations.length} escalations`;
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

  const lines: string[] = [];
  lines.push("You are the Global Agent managing multiple projects.");
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
  lines.push("## Pending Escalations");
  lines.push(formatEscalations(context));
  lines.push("");
  lines.push("## Recent Activity");
  lines.push(formatRecentActivity(context, recentActivityLimit));
  lines.push("");
  lines.push("---");
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
