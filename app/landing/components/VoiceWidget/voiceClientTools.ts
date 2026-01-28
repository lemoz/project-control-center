"use client";

import { useEffect, useState } from "react";

type CanvasVoiceNode = {
  id: string;
  type: "project" | "work_order";
  label: string;
  title?: string;
  projectId?: string;
  workOrderId?: string;
};

type CanvasVoiceSessionPhase =
  | "idle"
  | "onboarding"
  | "briefing"
  | "autonomous"
  | "debrief"
  | "ended";

type CanvasVoiceSessionStatus = "idle" | "onboarding" | "autonomous" | "paused";

type CanvasVoiceSession = {
  id: string | null;
  status: CanvasVoiceSessionStatus;
  phase: CanvasVoiceSessionPhase;
  paused: boolean;
  lastCheckInAt: string | null;
  iterationCount: number;
  decisionsCount: number;
  actionsCount: number;
  briefingSummary: string | null;
  priorityProjects: string[];
};

type CanvasVoiceEscalation = {
  id: string;
  projectId: string;
  projectName: string;
  type: string;
  summary: string;
};

type CanvasVoiceShiftUpdate = {
  projectId: string;
  projectName: string;
  completedAt: string;
  workCompleted: string[];
  workOrderCount: number;
};

type CanvasVoiceState = {
  contextLabel?: string;
  focusedNode: CanvasVoiceNode | null;
  selectedNode: CanvasVoiceNode | null;
  visibleProjects: CanvasVoiceNode[];
  visibleWorkOrders: CanvasVoiceNode[];
  highlightedWorkOrderId: string | null;
  detailPanelOpen: boolean;
  session: CanvasVoiceSession;
  escalations: CanvasVoiceEscalation[];
  lastShiftUpdate: CanvasVoiceShiftUpdate | null;
  updatedAt: number;
};

type CanvasVoiceCommand =
  | { type: "focusNode"; nodeId: string }
  | { type: "highlightWorkOrder"; workOrderId: string }
  | { type: "toggleDetailPanel"; open: boolean };

type CanvasVoiceListener = (state: CanvasVoiceState) => void;

type CanvasCommandListener = (command: CanvasVoiceCommand) => void;

const stateListeners = new Set<CanvasVoiceListener>();
const commandListeners = new Set<CanvasCommandListener>();

let canvasVoiceState: CanvasVoiceState = {
  contextLabel: "Canvas",
  focusedNode: null,
  selectedNode: null,
  visibleProjects: [],
  visibleWorkOrders: [],
  highlightedWorkOrderId: null,
  detailPanelOpen: true,
  session: {
    id: null,
    status: "idle",
    phase: "idle",
    paused: false,
    lastCheckInAt: null,
    iterationCount: 0,
    decisionsCount: 0,
    actionsCount: 0,
    briefingSummary: null,
    priorityProjects: [],
  },
  escalations: [],
  lastShiftUpdate: null,
  updatedAt: 0,
};

function notifyStateListeners() {
  stateListeners.forEach((listener) => listener(canvasVoiceState));
}

export function getCanvasVoiceState(): CanvasVoiceState {
  return canvasVoiceState;
}

export function setCanvasVoiceState(next: Partial<CanvasVoiceState>): void {
  canvasVoiceState = {
    ...canvasVoiceState,
    ...next,
    updatedAt: Date.now(),
  };
  notifyStateListeners();
}

export function subscribeCanvasVoiceState(listener: CanvasVoiceListener): () => void {
  stateListeners.add(listener);
  return () => stateListeners.delete(listener);
}

export function sendCanvasCommand(command: CanvasVoiceCommand): void {
  commandListeners.forEach((listener) => listener(command));
}

export function subscribeCanvasCommands(listener: CanvasCommandListener): () => void {
  commandListeners.add(listener);
  return () => commandListeners.delete(listener);
}

export function useCanvasVoiceState(): CanvasVoiceState {
  const [state, setState] = useState(getCanvasVoiceState());

  useEffect(() => subscribeCanvasVoiceState(setState), []);

  return state;
}

type FocusNodeArgs = { nodeId: string };

type HighlightWorkOrderArgs = { workOrderId: string };

type ToggleDetailPanelArgs = { open: boolean };

type ResolveEscalationArgs = {
  escalationId?: string;
  project?: string;
  resolution?: string;
  inputs?: Record<string, string>;
};

type UpdateSessionPriorityArgs = {
  project: string;
  note?: string;
};

type EscalationInput = { key: string; label: string };

type ActiveSessionResponse = {
  session: {
    id: string;
    state: string;
    paused_at: string | null;
    iteration_count: number;
    decisions_count: number;
    actions_count: number;
    last_check_in_at: string | null;
    briefing_summary: string | null;
    priority_projects: string[];
  } | null;
  events?: Array<{
    type?: string;
    payload?: Record<string, unknown> | null;
    created_at?: string;
  }>;
};

type GlobalContextResponse = {
  projects: Array<{
    id: string;
    name: string;
    escalations: Array<{ id: string; type: string; summary: string }>;
  }>;
};

function normalizeMatch(value: string): string {
  return value.trim().toLowerCase();
}

function resolveNode(nodes: CanvasVoiceNode[], query: string): CanvasVoiceNode | null {
  const normalized = normalizeMatch(query);
  if (!normalized) return null;
  let match = nodes.find((node) => normalizeMatch(node.id) === normalized);
  if (match) return match;
  match = nodes.find((node) => normalizeMatch(node.label) === normalized);
  if (match) return match;
  match = nodes.find((node) => (node.title ? normalizeMatch(node.title) === normalized : false));
  if (match) return match;
  match = nodes.find((node) => normalizeMatch(node.label).includes(normalized));
  if (match) return match;
  match = nodes.find((node) => (node.title ? normalizeMatch(node.title).includes(normalized) : false));
  return match ?? null;
}

function formatSessionTimestamp(value: string | null | undefined): string | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return value;
  return new Date(parsed).toLocaleTimeString();
}

function summarizeSessionEvent(event: ActiveSessionResponse["events"][number] | undefined): string {
  if (!event) return "";
  const payload = event.payload ?? {};
  const summary =
    typeof payload.summary === "string"
      ? payload.summary
      : typeof payload.message === "string"
        ? payload.message
        : typeof payload.reason === "string"
          ? payload.reason
          : "";
  return summary || event.type || "";
}

const SESSION_PHASES: CanvasVoiceSessionPhase[] = [
  "idle",
  "onboarding",
  "briefing",
  "autonomous",
  "debrief",
  "ended",
];

function isCanvasVoiceSessionPhase(value: string): value is CanvasVoiceSessionPhase {
  return SESSION_PHASES.includes(value as CanvasVoiceSessionPhase);
}

function deriveSessionStatus(
  session: NonNullable<ActiveSessionResponse["session"]>
): {
  status: CanvasVoiceSessionStatus;
  phase: CanvasVoiceSessionPhase;
} {
  const paused = Boolean(session.paused_at);
  const phase = isCanvasVoiceSessionPhase(session.state) ? session.state : "idle";
  let status: CanvasVoiceSessionStatus = "idle";
  if (phase === "autonomous") status = "autonomous";
  if (phase === "onboarding" || phase === "briefing") status = "onboarding";
  if (paused) status = "paused";
  return { status, phase };
}

function updateBriefingSummary(
  summary: string | null,
  priorityProjects: string[],
  note?: string
): string {
  const lines = summary
    ? summary
        .split(/\r?\n/g)
        .map((line) => line.trim())
        .filter(Boolean)
    : [];
  const filtered = lines.filter(
    (line) => !line.toLowerCase().startsWith("priority projects:")
  );
  filtered.push(`Priority projects: ${priorityProjects.join(", ")}`);
  if (note) filtered.push(`Note: ${note.trim()}`);
  return filtered.join("\n");
}

function parseRunEscalationInputs(raw: unknown): EscalationInput[] {
  if (!raw || typeof raw !== "object") return [];
  const record = raw as Record<string, unknown>;
  const inputs = Array.isArray(record.inputs) ? record.inputs : [];
  return inputs
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const input = entry as Record<string, unknown>;
      const key = typeof input.key === "string" ? input.key.trim() : "";
      const label = typeof input.label === "string" ? input.label.trim() : "";
      if (!key || !label) return null;
      return { key, label };
    })
    .filter((entry): entry is EscalationInput => Boolean(entry));
}

export function createVoiceClientTools() {
  return {
    focusNode: async ({ nodeId }: FocusNodeArgs) => {
      if (!nodeId || typeof nodeId !== "string") {
        return "Missing node id.";
      }
      const trimmed = nodeId.trim();
      const state = getCanvasVoiceState();
      const resolved =
        resolveNode(state.visibleProjects, trimmed) ??
        resolveNode(state.visibleWorkOrders, trimmed);
      sendCanvasCommand({ type: "focusNode", nodeId: resolved?.id ?? trimmed });
      return resolved ? `Focused ${resolved.label}.` : "Focused node.";
    },
    highlightWorkOrder: async ({ workOrderId }: HighlightWorkOrderArgs) => {
      if (!workOrderId || typeof workOrderId !== "string") {
        return "Missing work order id.";
      }
      const trimmed = workOrderId.trim();
      const state = getCanvasVoiceState();
      const resolved = resolveNode(state.visibleWorkOrders, trimmed);
      sendCanvasCommand({
        type: "highlightWorkOrder",
        workOrderId: resolved?.workOrderId ?? resolved?.id ?? trimmed,
      });
      return resolved ? `Highlighted ${resolved.label}.` : "Highlighted work order.";
    },
    toggleDetailPanel: async ({ open }: ToggleDetailPanelArgs) => {
      if (typeof open !== "boolean") {
        return "Missing open state.";
      }
      sendCanvasCommand({ type: "toggleDetailPanel", open });
      return open ? "Detail panel opened." : "Detail panel closed.";
    },
    getSessionStatus: async () => {
      try {
        const res = await fetch("/api/global/sessions/active", { cache: "no-store" });
        const json = (await res.json().catch(() => null)) as ActiveSessionResponse | null;
        if (!res.ok) {
          return "Unable to load the global session status.";
        }
        const session = json?.session;
        if (!session) return "No active global session.";
        const { status, phase } = deriveSessionStatus(session);
        const phaseSuffix =
          phase !== status && phase !== "idle" ? ` (${phase})` : "";
        const parts = [
          `Session is ${status}${phaseSuffix}.`,
          `Iterations ${session.iteration_count}, decisions ${session.decisions_count}, actions ${session.actions_count}.`,
        ];
        const lastCheckIn = formatSessionTimestamp(session.last_check_in_at);
        if (lastCheckIn) {
          parts.push(`Last check-in ${lastCheckIn}.`);
        }
        const eventSummary = summarizeSessionEvent(json?.events?.[0]);
        if (eventSummary) {
          parts.push(`Latest update: ${eventSummary}.`);
        }
        return parts.join(" ");
      } catch {
        return "Unable to load the global session status.";
      }
    },
    updateSessionPriority: async ({ project, note }: UpdateSessionPriorityArgs) => {
      if (!project || typeof project !== "string") {
        return "Project name is required.";
      }
      try {
        const sessionRes = await fetch("/api/global/sessions/active", { cache: "no-store" });
        const sessionJson = (await sessionRes
          .json()
          .catch(() => null)) as ActiveSessionResponse | null;
        if (!sessionRes.ok) return "Unable to load the global session.";
        const session = sessionJson?.session;
        if (!session) return "No active global session.";
        const trimmed = project.trim();
        const normalized = normalizeMatch(trimmed);
        const current = Array.isArray(session.priority_projects)
          ? session.priority_projects
          : [];
        const next = [
          trimmed,
          ...current.filter((entry) => normalizeMatch(entry) !== normalized),
        ];
        const briefingSummary = updateBriefingSummary(
          session.briefing_summary,
          next,
          note
        );
        const patchRes = await fetch(
          `/api/global/sessions/${encodeURIComponent(session.id)}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              priority_projects: next,
              briefing_summary: briefingSummary,
            }),
          }
        );
        if (!patchRes.ok) {
          const errorJson = await patchRes.json().catch(() => null);
          return typeof errorJson?.error === "string"
            ? errorJson.error
            : "Failed to update session priorities.";
        }
        return `Updated session priorities: ${next.join(", ")}.`;
      } catch {
        return "Failed to update session priorities.";
      }
    },
    resolveEscalation: async ({
      escalationId,
      project,
      resolution,
      inputs,
    }: ResolveEscalationArgs) => {
      const trimmedResolution = typeof resolution === "string" ? resolution.trim() : "";
      if (!trimmedResolution && !inputs) {
        return "Resolution details are required.";
      }
      const normalizedProject = project ? normalizeMatch(project) : null;
      const state = getCanvasVoiceState();
      const candidates = state.escalations ?? [];
      let escalation = escalationId
        ? candidates.find((entry) => entry.id === escalationId)
        : null;
      if (!escalation && normalizedProject) {
        escalation = candidates.find(
          (entry) =>
            normalizeMatch(entry.projectName) === normalizedProject ||
            normalizeMatch(entry.projectId) === normalizedProject
        );
      }
      if (!escalation && !escalationId) {
        escalation = candidates[0] ?? null;
      }
      if (!escalation) {
        try {
          const res = await fetch("/api/global/context", { cache: "no-store" });
          const json = (await res.json().catch(() => null)) as GlobalContextResponse | null;
          if (res.ok && json?.projects?.length) {
            if (escalationId) {
              for (const projectEntry of json.projects) {
                const match = projectEntry.escalations.find(
                  (entry) => entry.id === escalationId
                );
                if (match) {
                  escalation = {
                    id: match.id,
                    projectId: projectEntry.id,
                    projectName: projectEntry.name,
                    type: match.type,
                    summary: match.summary,
                  };
                  break;
                }
              }
            } else {
              for (const projectEntry of json.projects) {
                const match = normalizedProject
                  ? normalizeMatch(projectEntry.name) === normalizedProject ||
                    normalizeMatch(projectEntry.id) === normalizedProject
                  : false;
                if (!normalizedProject && projectEntry.escalations.length) {
                  escalation = {
                    id: projectEntry.escalations[0].id,
                    projectId: projectEntry.id,
                    projectName: projectEntry.name,
                    type: projectEntry.escalations[0].type,
                    summary: projectEntry.escalations[0].summary,
                  };
                  break;
                }
                if (match && projectEntry.escalations.length) {
                  escalation = {
                    id: projectEntry.escalations[0].id,
                    projectId: projectEntry.id,
                    projectName: projectEntry.name,
                    type: projectEntry.escalations[0].type,
                    summary: projectEntry.escalations[0].summary,
                  };
                  break;
                }
              }
            }
          }
        } catch {
          // ignore
        }
      }
      const resolvedId = escalation?.id ?? escalationId;
      if (!resolvedId) return "No escalation found to resolve.";
      let runEscalationInputs: EscalationInput[] | null = null;
      let isRunEscalation = escalation?.type === "run_input";
      if (!isRunEscalation) {
        try {
          const runRes = await fetch(`/api/runs/${encodeURIComponent(resolvedId)}`, {
            cache: "no-store",
          });
          if (runRes.ok) {
            const runJson = (await runRes.json().catch(() => null)) as
              | { escalation?: unknown }
              | null;
            runEscalationInputs = parseRunEscalationInputs(runJson?.escalation);
            if (runEscalationInputs.length > 0) {
              isRunEscalation = true;
            }
          }
        } catch {
          // ignore run lookup failures
        }
      }
      if (isRunEscalation) {
        try {
          if (!runEscalationInputs) {
            const runRes = await fetch(`/api/runs/${encodeURIComponent(resolvedId)}`, {
              cache: "no-store",
            });
            const runJson = (await runRes.json().catch(() => null)) as
              | { escalation?: unknown }
              | null;
            runEscalationInputs = parseRunEscalationInputs(runJson?.escalation);
          }
          const escalationInputs = runEscalationInputs ?? [];
          let resolvedInputs = inputs;
          if (!resolvedInputs && trimmedResolution && escalationInputs.length === 1) {
            resolvedInputs = { [escalationInputs[0].key]: trimmedResolution };
          }
          if (!resolvedInputs) {
            const labels = escalationInputs.map((entry) => entry.label).join(", ");
            return labels
              ? `Run escalation needs inputs: ${labels}.`
              : "Run escalation needs structured inputs.";
          }
          const inputRes = await fetch(
            `/api/runs/${encodeURIComponent(resolvedId)}/provide-input`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                inputs: resolvedInputs,
                resolution_notes: trimmedResolution || undefined,
              }),
            }
          );
          if (!inputRes.ok) {
            const errorJson = await inputRes.json().catch(() => null);
            return typeof errorJson?.error === "string"
              ? errorJson.error
              : "Failed to resolve run escalation.";
          }
          return "Provided input for the run escalation.";
        } catch {
          return "Failed to resolve run escalation.";
        }
      }
      try {
        const res = await fetch(
          `/api/escalations/${encodeURIComponent(resolvedId)}/resolve`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              resolution: trimmedResolution || inputs || "resolved",
            }),
          }
        );
        if (!res.ok) {
          const errorJson = await res.json().catch(() => null);
          return typeof errorJson?.error === "string"
            ? errorJson.error
            : "Failed to resolve escalation.";
        }
        return "Escalation resolved.";
      } catch {
        return "Failed to resolve escalation.";
      }
    },
  };
}

export type {
  CanvasVoiceNode,
  CanvasVoiceState,
  CanvasVoiceCommand,
  CanvasVoiceEscalation,
  CanvasVoiceShiftUpdate,
  CanvasVoiceSession,
};
