import { formatConstitutionBlock } from "../constitution.js";
import type { ShiftContext, WorkOrderSummary } from "../shift_context.js";

const MAX_WORK_ORDER_LINES = 10;
const MAX_RECENT_RUNS = 8;
const MAX_ENV_VARS = 12;
const MAX_ACTIVE_RUNS = 8;
const MAX_ACTIVE_TRACKS = 5;
const MAX_STALLED_TRACKS = 5;

function formatTextBlock(value: string, emptyLabel: string): string {
  const trimmed = value.trim();
  return trimmed ? trimmed : emptyLabel;
}

function formatSuccessMetrics(metrics: ShiftContext["goals"]["success_metrics"]): string {
  if (!metrics.length) return "No success metrics provided.";
  return metrics
    .map((metric) => {
      const current = metric.current ?? "unknown";
      return `- ${metric.name}: ${current} / ${metric.target}`;
    })
    .join("\n");
}

function formatWorkOrderList(items: WorkOrderSummary[], limit: number): string {
  if (!items.length) return "None.";
  const sorted = [...items].sort((a, b) => {
    if (a.priority !== b.priority) return b.priority - a.priority;
    return a.id.localeCompare(b.id);
  });
  const shown = sorted.slice(0, limit);
  const lines = shown.map((item) => {
    const tags = item.tags.length ? item.tags.join(", ") : "none";
    const deps = item.depends_on.length ? item.depends_on.join(", ") : "none";
    const depStatus =
      item.depends_on.length === 0
        ? "deps ok"
        : item.deps_satisfied
          ? "deps ok"
          : "deps blocked";
    const track = item.track
      ? `track: ${item.track.name} (goal: ${formatTrackGoal(item.track.goal)})`
      : "track: none";
    return `- [P${item.priority}] ${item.id}: ${item.title} (${track}; tags: ${tags}; deps: ${deps}; ${depStatus})`;
  });
  if (items.length > limit) {
    lines.push(`- ...and ${items.length - limit} more`);
  }
  return lines.join("\n");
}

function formatRecentRuns(runs: ShiftContext["recent_runs"], limit: number): string {
  if (!runs.length) return "None.";
  const shown = runs.slice(0, limit);
  const lines = shown.map((run) => {
    const error = run.error ? ` - ${run.error}` : "";
    return `- ${run.work_order_id}: ${run.status}${error}`;
  });
  if (runs.length > limit) {
    lines.push(`- ...and ${runs.length - limit} more`);
  }
  return lines.join("\n");
}

function formatActiveRuns(runs: ShiftContext["active_runs"], limit: number): string {
  if (!runs.length) return "No active runs.";
  const shown = runs.slice(0, limit);
  const lines = shown.map(
    (run) => `- ${run.work_order_id}: ${run.status} (started ${run.started_at})`
  );
  if (runs.length > limit) {
    lines.push(`- ...and ${runs.length - limit} more`);
  }
  return lines.join("\n");
}

function formatInlineList(items: string[], emptyLabel: string): string {
  if (!items.length) return emptyLabel;
  return items.join("; ");
}

function formatBulletList(items: string[], emptyLabel: string): string {
  if (!items.length) return `- ${emptyLabel}`;
  return items.map((item) => `- ${item}`).join("\n");
}

function formatDecisionList(
  decisions: NonNullable<ShiftContext["last_handoff"]>["decisions_made"]
): string {
  if (!decisions.length) return "- (none)";
  return decisions.map((entry) => `- ${entry.decision}: ${entry.rationale}`).join("\n");
}

function formatLastHandoff(handoff: ShiftContext["last_handoff"]): string {
  if (!handoff) return "No previous handoff - this may be the first shift.";
  const lines: string[] = [];
  lines.push(`Summary: ${formatTextBlock(handoff.summary, "(none)")}`);
  lines.push(`Work completed: ${formatInlineList(handoff.work_completed, "(none)")}`);
  lines.push("Recommendations:");
  lines.push(formatBulletList(handoff.recommendations, "(none)"));
  lines.push("Blockers:");
  lines.push(formatBulletList(handoff.blockers, "(none)"));
  lines.push("Next priorities:");
  lines.push(formatBulletList(handoff.next_priorities, "(none)"));
  lines.push("Decisions made:");
  lines.push(formatDecisionList(handoff.decisions_made));
  return lines.join("\n");
}

function formatEnvVars(envVars: string[], limit: number): string {
  if (!envVars.length) return "none";
  const shown = envVars.slice(0, limit);
  const remainder = envVars.length - shown.length;
  const suffix = remainder > 0 ? `, ...and ${remainder} more` : "";
  return `${envVars.length} total: ${shown.join(", ")}${suffix}`;
}

function formatHumanInteraction(
  interaction: ShiftContext["last_human_interaction"]
): string {
  if (!interaction) return "No recent human interaction recorded.";
  const age =
    interaction.seconds_since === null ? "" : ` (${interaction.seconds_since}s ago)`;
  return `Last interaction: ${interaction.type} at ${interaction.timestamp}${age}`;
}

function formatConstitutionSection(content?: string | null): string {
  const block = formatConstitutionBlock(content ?? "");
  if (!block.trim()) return "No constitution available.";
  return block.trimEnd();
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

function formatTrackGoal(goal: string | null): string {
  const trimmed = goal?.trim() ?? "";
  return trimmed ? trimmed : "none";
}

function formatActiveTracks(
  tracks: ShiftContext["tracks"]["active"],
  limit: number
): string {
  if (!tracks.length) return "None.";
  const shown = tracks.slice(0, limit);
  const lines = shown.map((track) => {
    const goal = formatTrackGoal(track.goal);
    return `- ${track.name} (goal: ${goal}) — ${track.progress.done}/${track.progress.total} complete; ready ${track.progress.ready}; building ${track.progress.building}`;
  });
  if (tracks.length > limit) {
    lines.push(`- ...and ${tracks.length - limit} more active tracks`);
  }
  return lines.join("\n");
}

function formatStalledTracks(
  tracks: ShiftContext["tracks"]["stalled"],
  limit: number
): string {
  if (!tracks.length) return "None.";
  const shown = tracks.slice(0, limit);
  const lines = shown.map((track) => {
    const goal = formatTrackGoal(track.goal);
    return `- ${track.name} (goal: ${goal}) — ${track.progress.backlog} backlog`;
  });
  if (tracks.length > limit) {
    lines.push(`- ...and ${tracks.length - limit} more stalled tracks`);
  }
  return lines.join("\n");
}

function buildBudgetStatusNote(
  economy: ShiftContext["economy"],
  remainingPct: number | null
): string {
  const days = economy.period_days_remaining;
  const dayLabel = `${days} day${days === 1 ? "" : "s"} left in period`;
  const pctLabel = remainingPct === null ? "n/a" : `${remainingPct.toFixed(0)}%`;
  switch (economy.budget_status) {
    case "healthy":
      return `above warning threshold (${pctLabel}) with ${dayLabel}`;
    case "warning":
      return `below warning threshold (${pctLabel}) with ${dayLabel}`;
    case "critical":
      return `critical level (${pctLabel}) with ${dayLabel}`;
    case "exhausted":
      return `budget exhausted with ${dayLabel}`;
  }
}

function economyGuidance(status: ShiftContext["economy"]["budget_status"]): string[] {
  switch (status) {
    case "healthy":
      return ["Normal operations", "Can explore and experiment", "Full autonomy"];
    case "warning":
      return ["Prioritize high-impact work", "Reduce speculative runs", "Focus on efficiency"];
    case "critical":
      return ["Essential work only", "Flag blockers to user", "Conservative decisions"];
    case "exhausted":
      return ["Do not start new runs", "Escalate to user for budget", "Document what's blocked"];
  }
}

function formatEconomyStatus(economy: ShiftContext["economy"]): string {
  const allocation = economy.budget_allocation_usd;
  const remaining = economy.budget_remaining_usd;
  const remainingPct = allocation > 0 ? (remaining / allocation) * 100 : null;
  const lines: string[] = [];
  lines.push(
    `Budget: ${formatUsd(remaining)} remaining of ${formatUsd(allocation)} (${formatPercent(
      remainingPct
    )})`
  );
  lines.push(
    `Status: ${economy.budget_status.toUpperCase()} - ${buildBudgetStatusNote(
      economy,
      remainingPct
    )}`
  );
  lines.push(`Burn rate: ${formatUsd(economy.burn_rate_daily_usd)}/day average (7d)`);
  lines.push(`Runway: ${formatDays(economy.runway_days)} days at current rate`);
  lines.push("");
  lines.push(`Daily drip available: ${formatUsd(economy.daily_drip_usd)}`);
  lines.push("");
  lines.push("Cost efficiency:");
  lines.push(`- Avg cost per run: ${formatUsd(economy.avg_cost_per_run_usd)}`);
  lines.push(
    `- Avg cost per WO completed: ${formatUsd(economy.avg_cost_per_wo_completed_usd)}`
  );
  lines.push("");
  lines.push("Consider:");
  lines.push(...economyGuidance(economy.budget_status).map((line) => `- ${line}`));
  return lines.join("\n");
}

export function buildShiftDecisionPrompt(context: ShiftContext): string {
  const lines: string[] = [];
  lines.push("# Agent Shift: Decision Phase");
  lines.push("");
  lines.push(`You are taking a shift on project "${context.project.name}".`);
  lines.push("");
  lines.push("You're part of a continuous line of agents working toward this project's success.");
  lines.push("You inherit the work and decisions of every agent before you.");
  lines.push("Treat this as YOUR project - you know the history, you own the progress.");
  lines.push("");
  lines.push("## Your Mission");
  lines.push("");
  lines.push("The project's success criteria:");
  lines.push(formatTextBlock(context.goals.success_criteria, "(none provided)"));
  lines.push("");
  lines.push("Current progress on success metrics:");
  lines.push(formatSuccessMetrics(context.goals.success_metrics));
  lines.push("");
  lines.push("## Current State");
  lines.push("");
  lines.push("### Work Orders");
  lines.push(`- Ready to work on: ${context.work_orders.summary.ready}`);
  lines.push(`- In backlog: ${context.work_orders.summary.backlog}`);
  lines.push(`- In progress: ${context.work_orders.summary.in_progress}`);
  lines.push(`- Completed: ${context.work_orders.summary.done}`);
  lines.push("");
  lines.push("Ready work orders (dependencies satisfied):");
  lines.push(formatWorkOrderList(context.work_orders.ready, MAX_WORK_ORDER_LINES));
  lines.push("");
  lines.push("Blocked or dependency-blocked:");
  lines.push(formatWorkOrderList(context.work_orders.blocked, MAX_WORK_ORDER_LINES));
  lines.push("");
  lines.push("Recently completed:");
  lines.push(formatWorkOrderList(context.work_orders.recent_done, MAX_WORK_ORDER_LINES));
  lines.push("");
  lines.push("### Active Tracks");
  lines.push("Tracks with ready or in-progress work:");
  lines.push(formatActiveTracks(context.tracks.active, MAX_ACTIVE_TRACKS));
  lines.push("");
  lines.push("### Stalled Tracks");
  lines.push("Tracks with backlog but no active work:");
  lines.push(formatStalledTracks(context.tracks.stalled, MAX_STALLED_TRACKS));
  lines.push("");
  lines.push("Use track goals to justify priority choices in your decision rationale.");
  lines.push("");
  lines.push("### Recent History");
  lines.push(formatRecentRuns(context.recent_runs, MAX_RECENT_RUNS));
  lines.push("");
  lines.push("### Last Handoff");
  lines.push(formatLastHandoff(context.last_handoff));
  lines.push("");
  lines.push("### Git State");
  lines.push(`- Branch: ${context.git.branch}`);
  lines.push(
    `- Uncommitted changes: ${context.git.uncommitted_changes} (${context.git.files_changed} files)`
  );
  if (context.git.ahead_behind) {
    lines.push(
      `- Ahead/behind: ${context.git.ahead_behind.ahead} ahead, ${context.git.ahead_behind.behind} behind`
    );
  }
  lines.push("");
  lines.push("### Active Runs");
  lines.push(formatActiveRuns(context.active_runs, MAX_ACTIVE_RUNS));
  lines.push("");
  lines.push("### Environment");
  const vmLine = context.environment.vm
    ? `${context.environment.vm.status} at ${context.environment.vm.host ?? "unknown host"}`
    : "Not provisioned";
  lines.push(`- VM: ${vmLine}`);
  lines.push(`- Runner ready: ${context.environment.runner_ready}`);
  lines.push(
    `- Available env vars: ${formatEnvVars(context.environment.env_vars_available, MAX_ENV_VARS)}`
  );
  lines.push("");
  lines.push("### Human Engagement");
  lines.push(formatHumanInteraction(context.last_human_interaction));
  lines.push("");
  lines.push("## Economy Status");
  lines.push("");
  lines.push(formatEconomyStatus(context.economy));
  lines.push("");
  lines.push("## Constitution (How This User Works)");
  lines.push(formatConstitutionSection(context.constitution?.content));
  lines.push("");
  lines.push("Follow the Constitution above. If it conflicts with other guidance, follow it.");
  lines.push("");
  lines.push("## Your Capabilities");
  lines.push("");
  lines.push("You have full permissions:");
  lines.push("- Full network access");
  lines.push("- Full filesystem access");
  lines.push("- Can run any tool, command, or script");
  lines.push("- Can modify code, create files, run tests, deploy");
  lines.push("");
  lines.push("Use escalation only when truly blocked, missing critical requirements,");
  lines.push("or facing high-risk or irreversible decisions that need human input.");
  lines.push("");
  lines.push("## Instruction Hierarchy");
  lines.push("Hierarchy shorthand: goals > urgency > ease.");
  lines.push("1. Goals: success criteria and metrics (north star).");
  lines.push("2. Urgency: blockers, failing runs, regressions, time-sensitive risks.");
  lines.push("3. Ease: low effort wins (only as a tiebreaker).");
  lines.push("");
  lines.push("## Decision Tree (Common Situations)");
  lines.push("- If success criteria are empty or unclear, create a WO or request clarification first.");
  lines.push("- If there are active runs on priority WOs, avoid starting conflicting work.");
  lines.push("- If a blocker exists, remove the blocker before starting new feature work.");
  lines.push("- If a ready WO advances success criteria, choose the highest leverage one.");
  lines.push("- If backlog items match goals and deps are satisfied, promote to ready and do it.");
  lines.push("- If no suitable WO exists, create a new WO that captures the missing work.");
  lines.push("- If repeated failures occur, investigate root cause before adding scope.");
  lines.push("");
  lines.push("## Method Choice");
  lines.push("- WO run: multi-file or substantial changes, or when isolation helps.");
  lines.push("- Direct action: small, safe edits or config changes.");
  lines.push("- VM: heavy compute or when isolation is required.");
  lines.push("- Research: gather missing info before acting.");
  lines.push("");
  lines.push("## Phase 1: Assess (keep internal)");
  lines.push("- Identify the top 3 candidate actions.");
  lines.push("- Tie each candidate to success criteria or a blocker.");
  lines.push("");
  lines.push("## Phase 2: Decide (output required)");
  lines.push("Output your decision as:");
  lines.push("```");
  lines.push("DECISION: [What you will do]");
  lines.push("METHOD: [WO run | direct action | VM | research]");
  lines.push("WHY: [How this connects to success criteria]");
  lines.push("EXPECTED_OUTCOME: [What will be true after this shift]");
  lines.push("RISK: [What could go wrong]");
  lines.push("FOR_NEXT_AGENT: [Key decision rationale and notes to preserve]");
  lines.push("```");
  lines.push("");
  lines.push("## Examples (Good Reasoning)");
  lines.push("");
  lines.push("Good:");
  lines.push("```");
  lines.push("DECISION: Implement WO-2026-060 (Agent Shift Protocol Definition)");
  lines.push("METHOD: WO run");
  lines.push("WHY: Success criteria requires autonomous progress.");
  lines.push("     The shift protocol is the core mechanism to achieve that.");
  lines.push("EXPECTED_OUTCOME: Protocol doc complete so downstream WOs can proceed.");
  lines.push("RISK: Over-scoping; keep it minimal.");
  lines.push("FOR_NEXT_AGENT: Chose WO run for multi-file changes and test coverage.");
  lines.push("```");
  lines.push("");
  lines.push("Good:");
  lines.push("```");
  lines.push("DECISION: Unblock failed tests from the last run");
  lines.push("METHOD: direct action");
  lines.push("WHY: Recent runs show failing tests blocking progress toward success criteria.");
  lines.push("EXPECTED_OUTCOME: Tests pass so ready WOs can proceed.");
  lines.push("RISK: Might miss the root cause; validate with a focused fix.");
  lines.push("FOR_NEXT_AGENT: Prioritized unblock before new features.");
  lines.push("```");
  lines.push("");
  lines.push("Bad:");
  lines.push("```");
  lines.push("DECISION: Work on WO-2025-007 (iMessage notifier)");
  lines.push("WHY: It is in the backlog and seems useful.");
  lines.push("```");
  lines.push("");
  lines.push("Then proceed to execute.");
  lines.push("");

  return lines.join("\n");
}
