export type NarrationRunContext = {
  runId: string;
  workOrderId: string;
  workOrderTitle: string | null;
  workOrderGoal: string | null;
  workOrderDependsOn: string[];
  blockedDependencies: string[];
  status: string;
  phase: string;
  iteration: number;
  builderIteration: number;
  escalationSummary: string | null;
};

export type NarrationProjectSummary = {
  id: string;
  name: string;
  status: string;
  work_orders: { ready: number; in_progress: number; blocked: number };
  active_runs: number;
  pending_escalations: number;
};

export type NarrationCompletion = {
  workOrderId: string;
  title: string | null;
  projectName: string | null;
  completedAt: string;
};

export type NarrationChatThreadSummary = {
  id: string;
  scope: string;
  name: string | null;
  summary: string | null;
  lastActivityAt: string | null;
  projectName: string | null;
  workOrderId: string | null;
};

export type NarrationDecision = {
  id: string;
  summary: string;
  createdAt: string;
  projectName: string | null;
  workOrderId: string | null;
};

export type NarrationEscalation = {
  id: string;
  summary: string;
  projectName: string | null;
  workOrderId: string | null;
  type: string;
  waitingSince: string;
};

export type NarrationBlockedWorkOrder = {
  workOrderId: string;
  title: string | null;
  projectName: string | null;
};

export type NarrationChange = {
  topic: string;
  summary: string;
  priority: "high" | "medium" | "low";
};

export type NarrationPromptInput = {
  activeRuns: NarrationRunContext[];
  activeProjects: NarrationProjectSummary[];
  recentCompletions: NarrationCompletion[];
  recentChatThreads: NarrationChatThreadSummary[];
  recentDecisions: NarrationDecision[];
  pendingEscalations: NarrationEscalation[];
  blockedWorkOrders: NarrationBlockedWorkOrder[];
  changesSinceLastNarration: NarrationChange[];
  lastNarrationAt: string | null;
  recentlyReportedTopics: string[];
  recentNarrations: string[];
  omitted: {
    completions: number;
    chatThreads: number;
    decisions: number;
    escalations: number;
    blockedWorkOrders: number;
    changes: number;
  };
};

function truncate(text: string, max = 160): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, Math.max(0, max - 3)).trimEnd()}...`;
}

function formatWorkOrderLabel(id: string, title?: string | null): string {
  const cleanTitle = title?.trim();
  return cleanTitle ? `${cleanTitle} (${id})` : id;
}

function formatRunContext(run: NarrationRunContext): string {
  const title = run.workOrderTitle?.trim() || run.workOrderId;
  const goal = run.workOrderGoal ? truncate(run.workOrderGoal, 180) : "n/a";
  const deps = run.workOrderDependsOn.length
    ? run.workOrderDependsOn.join(", ")
    : "none";
  const blocked = run.blockedDependencies.length
    ? run.blockedDependencies.join(", ")
    : "";
  const escalation = run.escalationSummary
    ? truncate(run.escalationSummary, 140)
    : "";
  const iteration = Math.max(1, run.iteration || 0, run.builderIteration || 0);

  const parts = [
    `${title} (${run.workOrderId})`,
    `goal: ${goal}`,
    `status: ${run.status}`,
    `phase: ${run.phase}`,
    `iteration: ${iteration}`,
  ];
  if (run.workOrderDependsOn.length) {
    parts.push(`deps: ${deps}`);
  }
  if (blocked) {
    parts.push(`blocked by: ${blocked}`);
  }
  if (escalation) {
    parts.push(`blocker: ${escalation}`);
  }
  return `- ${parts.join("; ")}`;
}

function formatProjectSummary(project: NarrationProjectSummary): string {
  const counts = [
    `ready ${project.work_orders.ready}`,
    `in progress ${project.work_orders.in_progress}`,
    `blocked ${project.work_orders.blocked}`,
    `runs ${project.active_runs}`,
    `escalations ${project.pending_escalations}`,
  ];
  return `- ${project.name} (${project.id}) [${project.status}] ${counts.join("; ")}`;
}

function formatCompletion(entry: NarrationCompletion): string {
  const label = formatWorkOrderLabel(entry.workOrderId, entry.title);
  const project = entry.projectName ? ` (${entry.projectName})` : "";
  return `- ${label}${project}`;
}

function formatChatThreadLabel(thread: NarrationChatThreadSummary): string {
  const name = thread.name?.trim();
  if (thread.scope === "global") {
    return name ? `Global: ${name}` : "Global chat";
  }
  if (thread.scope === "project") {
    const project = thread.projectName?.trim();
    if (name && project) return `Project ${project}: ${name}`;
    if (name) return `Project chat: ${name}`;
    if (project) return `Project ${project}`;
    return "Project chat";
  }
  const workOrder = thread.workOrderId?.trim();
  if (name && workOrder) return `WO ${workOrder}: ${name}`;
  if (name) return `Work order chat: ${name}`;
  if (workOrder) return `WO ${workOrder}`;
  return "Work order chat";
}

function formatChatThread(entry: NarrationChatThreadSummary): string {
  const label = formatChatThreadLabel(entry);
  const summary = entry.summary?.trim() ? truncate(entry.summary, 160) : "No summary yet";
  return `- ${label}: ${summary}`;
}

function formatDecision(entry: NarrationDecision): string {
  const summary = truncate(entry.summary, 160);
  const parts = [entry.projectName, entry.workOrderId].filter(Boolean);
  const context = parts.length ? ` (${parts.join(" / ")})` : "";
  return `- ${summary}${context}`;
}

function formatEscalation(entry: NarrationEscalation): string {
  const label = entry.workOrderId
    ? formatWorkOrderLabel(entry.workOrderId, null)
    : entry.projectName ?? "Project";
  const summary = truncate(entry.summary, 160);
  return `- ${label}: ${summary}`;
}

function formatBlockedWorkOrder(entry: NarrationBlockedWorkOrder): string {
  const label = formatWorkOrderLabel(entry.workOrderId, entry.title);
  const project = entry.projectName ? ` (${entry.projectName})` : "";
  return `- ${label}${project}`;
}

function formatChange(entry: NarrationChange): string {
  return `- ${truncate(entry.summary, 180)}`;
}

function appendSection(
  lines: string[],
  title: string,
  items: string[],
  omitted = 0
): void {
  lines.push("", `${title}:`);
  if (items.length === 0) {
    lines.push("- none");
  } else {
    lines.push(...items);
  }
  if (omitted > 0) {
    lines.push(`- (${omitted} more omitted)`);
  }
}

export function buildNarrationPrompt(input: NarrationPromptInput): string {
  const lines: string[] = [];
  const activeProjectsCount = input.activeProjects.length;
  const activeRunsCount = input.activeRuns.length;
  const pendingEscalationsCount = input.pendingEscalations.length;
  const sinceLabel = input.lastNarrationAt
    ? `since ${input.lastNarrationAt}`
    : "since last update";

  lines.push(
    "You are the user's chief of staff for their software projects.",
    "Deliver a crisp executive briefing with only what's new or needs attention.",
    "",
    "CURRENT STATE:",
    `- Active projects: ${activeProjectsCount}`,
    `- Active runs: ${activeRunsCount}`,
    `- Pending escalations: ${pendingEscalationsCount}`
  );

  appendSection(
    lines,
    "ACTIVE PROJECTS",
    input.activeProjects.map((project) => formatProjectSummary(project))
  );

  appendSection(
    lines,
    "ACTIVE RUNS",
    input.activeRuns.map((run) => formatRunContext(run))
  );

  appendSection(
    lines,
    "PENDING ESCALATIONS",
    input.pendingEscalations.map((entry) => formatEscalation(entry)),
    input.omitted.escalations
  );

  appendSection(
    lines,
    `WHAT CHANGED (${sinceLabel})`,
    input.changesSinceLastNarration.map((entry) => formatChange(entry)),
    input.omitted.changes
  );

  appendSection(
    lines,
    "RECENT COMPLETIONS (last 24h)",
    input.recentCompletions.map((entry) => formatCompletion(entry)),
    input.omitted.completions
  );

  appendSection(
    lines,
    "RECENT CHAT THREADS",
    input.recentChatThreads.map((entry) => formatChatThread(entry)),
    input.omitted.chatThreads
  );

  appendSection(
    lines,
    "RECENT DECISIONS",
    input.recentDecisions.map((entry) => formatDecision(entry)),
    input.omitted.decisions
  );

  if (input.blockedWorkOrders.length > 0 || input.omitted.blockedWorkOrders > 0) {
    appendSection(
      lines,
      "BLOCKED WORK ORDERS",
      input.blockedWorkOrders.map((entry) => formatBlockedWorkOrder(entry)),
      input.omitted.blockedWorkOrders
    );
  }

  appendSection(
    lines,
    "ALREADY REPORTED (avoid repeating)",
    input.recentlyReportedTopics.map((entry) => `- ${truncate(entry, 160)}`)
  );

  appendSection(
    lines,
    "RECENT NARRATION (avoid repeating)",
    input.recentNarrations.map((entry) => `- ${truncate(entry, 160)}`)
  );

  lines.push(
    "",
    "INSTRUCTIONS:",
    "- Prioritize escalations, then completions, then progress.",
    "- Connect current activity to recent decisions or conversations when relevant.",
    "- Only mention what's new or needs attention; if nothing new, say so succinctly.",
    "- Keep it to 1-3 sentences. No hype or filler."
  );

  return lines.join("\n");
}
