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

export type NarrationPromptInput = {
  activeRuns: NarrationRunContext[];
  recentEvents: string[];
  recentNarrations: string[];
  primaryEvent: string | null;
};

function truncate(text: string, max = 160): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, Math.max(0, max - 3)).trimEnd()}...`;
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

export function buildNarrationPrompt(input: NarrationPromptInput): string {
  const lines: string[] = [];
  lines.push(
    "You are a thoughtful podcast host narrating a software build system.",
    "Provide brief, insightful commentary on what's happening.",
    "",
    "Current state:",
    "Active runs:"
  );

  if (input.activeRuns.length === 0) {
    lines.push("- none");
  } else {
    lines.push(...input.activeRuns.map((run) => formatRunContext(run)));
  }

  lines.push("", "Recent events:");
  if (input.recentEvents.length === 0) {
    lines.push("- none");
  } else {
    lines.push(...input.recentEvents.map((event) => `- ${event}`));
  }

  if (input.primaryEvent) {
    lines.push("", `Primary update: ${truncate(input.primaryEvent, 220)}`);
  }

  if (input.recentNarrations.length) {
    lines.push("", "Recent narration (avoid repeating):");
    lines.push(
      ...input.recentNarrations.map((entry) => `- ${truncate(entry, 160)}`)
    );
  }

  lines.push(
    "",
    "Generate 1-2 sentences of narration. Be curious and substantive.",
    "Explain what's happening and why it matters. Avoid robotic announcements or hype.",
    "Avoid repeating recent narration."
  );

  return lines.join("\n");
}
