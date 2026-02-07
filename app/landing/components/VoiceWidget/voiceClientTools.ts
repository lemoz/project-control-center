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

type CanvasVoiceConnectionStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "disconnecting";

type CanvasVoiceToolPhase = "idle" | "acting" | "failed";

type CanvasVoiceRuntime = {
  status: CanvasVoiceConnectionStatus;
  isConnecting: boolean;
  isSpeaking: boolean;
  error: string | null;
  permissionDenied: boolean;
  toolPhase: CanvasVoiceToolPhase;
  activeToolName: string | null;
  lastToolError: string | null;
  lastToolAt: number | null;
  availableCanvasCommands: CanvasCommandType[];
};

type CanvasVoiceEscalationDetail = {
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

type CanvasVoiceEscalation = {
  projectId: string;
  projectName: string;
  count: number;
  summary: string | null;
};

type CanvasVoiceShift = {
  projectId: string;
  projectName: string;
  startedAt: string | null;
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
  escalations: CanvasVoiceEscalationDetail[];
  lastShiftUpdate: CanvasVoiceShiftUpdate | null;
  globalSessionState: string | null;
  globalSessionPaused: boolean;
  activeShiftProjects: CanvasVoiceShift[];
  escalationSummaries: CanvasVoiceEscalation[];
  runtime: CanvasVoiceRuntime;
  updatedAt: number;
};

type CanvasVoiceCommand =
  | { type: "focusNode"; nodeId: string }
  | { type: "focusProject"; projectId: string }
  | { type: "highlightWorkOrder"; workOrderId: string }
  | { type: "highlightProject"; projectId: string }
  | { type: "openProjectDetail"; projectId: string }
  | { type: "toggleDetailPanel"; open: boolean };

type CanvasCommandType = CanvasVoiceCommand["type"];

type CanvasCommandCapabilities = Partial<Record<CanvasCommandType, boolean>>;

type CanvasCommandHandlerResult =
  | void
  | boolean
  | {
      handled?: boolean;
      ok?: boolean;
      message?: string;
    };

type CanvasCommandHandler = (
  command: CanvasVoiceCommand
) => CanvasCommandHandlerResult | Promise<CanvasCommandHandlerResult>;

type CanvasCommandDispatchResult = {
  ok: boolean;
  handled: boolean;
  message: string;
  commandType: CanvasCommandType;
  availableCommands: CanvasCommandType[];
  handlerId: string | null;
};

type CanvasCommandRegistration = {
  id: string;
  label: string;
  capabilities: Set<CanvasCommandType>;
  handler: CanvasCommandHandler;
};

type CanvasVoiceListener = (state: CanvasVoiceState) => void;

const stateListeners = new Set<CanvasVoiceListener>();
const commandRegistrations = new Map<string, CanvasCommandRegistration>();
let legacyCommandListenerCount = 0;

const ALL_CANVAS_COMMAND_TYPES: CanvasCommandType[] = [
  "focusNode",
  "focusProject",
  "highlightWorkOrder",
  "highlightProject",
  "openProjectDetail",
  "toggleDetailPanel",
];

const CANVAS_COMMAND_LABELS: Record<CanvasCommandType, string> = {
  focusNode: "focus a node",
  focusProject: "focus a project",
  highlightWorkOrder: "highlight a work order",
  highlightProject: "highlight a project",
  openProjectDetail: "open project detail",
  toggleDetailPanel: "toggle detail panel",
};

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
  globalSessionState: null,
  globalSessionPaused: false,
  activeShiftProjects: [],
  escalationSummaries: [],
  runtime: {
    status: "disconnected",
    isConnecting: false,
    isSpeaking: false,
    error: null,
    permissionDenied: false,
    toolPhase: "idle",
    activeToolName: null,
    lastToolError: null,
    lastToolAt: null,
    availableCanvasCommands: [],
  },
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

export function setCanvasVoiceRuntime(next: Partial<CanvasVoiceRuntime>): void {
  canvasVoiceState = {
    ...canvasVoiceState,
    runtime: {
      ...canvasVoiceState.runtime,
      ...next,
    },
    updatedAt: Date.now(),
  };
  notifyStateListeners();
}

export function subscribeCanvasVoiceState(listener: CanvasVoiceListener): () => void {
  stateListeners.add(listener);
  return () => stateListeners.delete(listener);
}

function toCapabilitySet(
  capabilities?: CanvasCommandCapabilities
): Set<CanvasCommandType> {
  if (!capabilities) {
    return new Set(ALL_CANVAS_COMMAND_TYPES);
  }
  return new Set(
    ALL_CANVAS_COMMAND_TYPES.filter((commandType) => capabilities[commandType])
  );
}

function listAvailableCanvasCommands(): CanvasCommandType[] {
  const available = new Set<CanvasCommandType>();
  for (const registration of commandRegistrations.values()) {
    for (const commandType of registration.capabilities) {
      available.add(commandType);
    }
  }
  return ALL_CANVAS_COMMAND_TYPES.filter((commandType) => available.has(commandType));
}

function refreshRuntimeCanvasCapabilities() {
  setCanvasVoiceRuntime({
    availableCanvasCommands: listAvailableCanvasCommands(),
  });
}

function formatCanvasCommandNames(commands: CanvasCommandType[]): string {
  if (!commands.length) return "none";
  return commands.join(", ");
}

function normalizeCanvasCommandResult(
  value: CanvasCommandHandlerResult
): { handled: boolean; ok: boolean; message: string | null } {
  if (typeof value === "boolean") {
    return {
      handled: true,
      ok: value,
      message: value ? null : "Command rejected.",
    };
  }
  if (value === undefined) {
    return { handled: true, ok: true, message: null };
  }
  const handled = value.handled ?? true;
  const ok = value.ok ?? handled;
  const message =
    typeof value.message === "string" && value.message.trim()
      ? value.message
      : null;
  return { handled, ok, message };
}

export function registerCanvasCommandHandler(
  options: {
    id: string;
    label: string;
    capabilities?: CanvasCommandCapabilities;
  },
  handler: CanvasCommandHandler
): () => void {
  const id = options.id.trim();
  if (!id) {
    throw new Error("Canvas command handler id is required.");
  }
  const label = options.label.trim() || id;
  commandRegistrations.set(id, {
    id,
    label,
    capabilities: toCapabilitySet(options.capabilities),
    handler,
  });
  refreshRuntimeCanvasCapabilities();
  return () => {
    commandRegistrations.delete(id);
    refreshRuntimeCanvasCapabilities();
  };
}

export function getCanvasCommandCapabilities(): {
  availableCommands: CanvasCommandType[];
  canvases: Array<{
    id: string;
    label: string;
    commands: CanvasCommandType[];
  }>;
} {
  const canvases = Array.from(commandRegistrations.values()).map((registration) => ({
    id: registration.id,
    label: registration.label,
    commands: ALL_CANVAS_COMMAND_TYPES.filter((commandType) =>
      registration.capabilities.has(commandType)
    ),
  }));
  return {
    availableCommands: listAvailableCanvasCommands(),
    canvases,
  };
}

export async function sendCanvasCommand(
  command: CanvasVoiceCommand
): Promise<CanvasCommandDispatchResult> {
  const registrations = Array.from(commandRegistrations.values());
  const availableCommands = listAvailableCanvasCommands();
  if (!registrations.length) {
    return {
      ok: false,
      handled: false,
      message: "No canvas is active right now.",
      commandType: command.type,
      availableCommands,
      handlerId: null,
    };
  }

  const capableRegistrations = registrations.filter((registration) =>
    registration.capabilities.has(command.type)
  );
  if (!capableRegistrations.length) {
    return {
      ok: false,
      handled: false,
      message: `Cannot ${CANVAS_COMMAND_LABELS[command.type]} in this view. Available commands: ${formatCanvasCommandNames(
        availableCommands
      )}.`,
      commandType: command.type,
      availableCommands,
      handlerId: null,
    };
  }

  let sawHandledFailure = false;
  let firstFailure: string | null = null;
  for (const registration of capableRegistrations) {
    try {
      const rawResult = await registration.handler(command);
      const result = normalizeCanvasCommandResult(rawResult);
      if (!result.handled) continue;
      if (result.ok) {
        return {
          ok: true,
          handled: true,
          message:
            result.message ??
            `${registration.label} handled ${CANVAS_COMMAND_LABELS[command.type]}.`,
          commandType: command.type,
          availableCommands,
          handlerId: registration.id,
        };
      }
      sawHandledFailure = true;
      if (!firstFailure) {
        firstFailure =
          result.message ??
          `${registration.label} could not ${CANVAS_COMMAND_LABELS[command.type]}.`;
      }
    } catch (error) {
      sawHandledFailure = true;
      if (!firstFailure) {
        const fallback = `${registration.label} failed while handling ${CANVAS_COMMAND_LABELS[command.type]}.`;
        firstFailure =
          error instanceof Error && error.message.trim()
            ? error.message
            : fallback;
      }
    }
  }

  if (sawHandledFailure) {
    return {
      ok: false,
      handled: true,
      message:
        firstFailure ??
        `Unable to ${CANVAS_COMMAND_LABELS[command.type]} in ${capableRegistrations[0]?.label ?? "canvas"}.`,
      commandType: command.type,
      availableCommands,
      handlerId: null,
    };
  }

  return {
    ok: false,
    handled: false,
    message: `No active canvas accepted ${CANVAS_COMMAND_LABELS[command.type]}.`,
    commandType: command.type,
    availableCommands,
    handlerId: null,
  };
}

export function subscribeCanvasCommands(
  listener: (command: CanvasVoiceCommand) => void
): () => void {
  legacyCommandListenerCount += 1;
  const id = `legacy-canvas-listener-${legacyCommandListenerCount}`;
  return registerCanvasCommandHandler(
    {
      id,
      label: "Canvas listener",
    },
    (command) => {
      listener(command);
      return { handled: true, ok: true };
    }
  );
}

export function useCanvasVoiceState(): CanvasVoiceState {
  const [state, setState] = useState(getCanvasVoiceState());

  useEffect(() => subscribeCanvasVoiceState(setState), []);

  return state;
}

type FocusNodeArgs = { nodeId: string };

type FocusProjectArgs = { projectId: string };

type HighlightWorkOrderArgs = { workOrderId: string };

type HighlightProjectArgs = { projectId: string };

type OpenProjectDetailArgs = { projectId: string };

type ToggleDetailPanelArgs = { open: boolean };
type InspectProjectArgs = {
  projectId?: string;
  project?: string;
  includeStatus?: boolean;
};
type InspectProjectEscalationsArgs = {
  projectId?: string;
  project?: string;
  includeStatus?: boolean;
};
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

type StartShiftArgs = { projectId: string };

type AskGlobalAgentArgs = { question: string };

type GetProjectStatusArgs = { project: string };

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

type ShiftContextResponse = {
  project?: {
    id?: string;
    name?: string;
    status?: string;
  };
  lifecycle?: { status?: string };
  work_orders?: {
    summary?: {
      ready?: number;
      backlog?: number;
      done?: number;
      in_progress?: number;
      blocked?: number;
    };
  };
  active_runs?: Array<{
    id?: string;
    work_order_id?: string;
    status?: string;
  }>;
  economy?: {
    budget_status?: string;
    budget_remaining_usd?: number;
    runway_days?: number;
  };
  last_handoff?: {
    summary?: string;
    work_completed?: string[];
  } | null;
};

type GlobalSessionState = "onboarding" | "briefing" | "autonomous" | "debrief" | "ended";

type GlobalSessionSummary = {
  id: string;
  state: GlobalSessionState;
  paused_at: string | null;
};

function normalizeMatch(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
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

type ProjectMatchResult = {
  match: GlobalContextResponse["projects"][number] | null;
  candidates: GlobalContextResponse["projects"][number][];
};

function resolveProjectMatch(
  projects: GlobalContextResponse["projects"],
  query: string
): ProjectMatchResult {
  const normalized = normalizeMatch(query);
  if (!normalized) return { match: null, candidates: [] };
  const exactId = projects.find((project) => normalizeMatch(project.id) === normalized);
  if (exactId) return { match: exactId, candidates: [exactId] };
  const exactName = projects.find((project) => normalizeMatch(project.name) === normalized);
  if (exactName) return { match: exactName, candidates: [exactName] };

  const candidates = new Map<string, GlobalContextResponse["projects"][number]>();
  for (const project of projects) {
    const idMatch = normalizeMatch(project.id).includes(normalized);
    const nameMatch = normalizeMatch(project.name).includes(normalized);
    if (idMatch || nameMatch) {
      candidates.set(project.id, project);
    }
  }
  const list = Array.from(candidates.values());
  if (list.length === 1) {
    return { match: list[0], candidates: list };
  }
  return { match: null, candidates: list };
}

function formatSessionTimestamp(value: string | null | undefined): string | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return value;
  return new Date(parsed).toLocaleTimeString();
}

function formatUsd(value: number): string {
  if (!Number.isFinite(value)) return "$0.00";
  const sign = value < 0 ? "-" : "";
  return `${sign}$${Math.abs(value).toFixed(2)}`;
}

function formatDays(value: number): string {
  if (!Number.isFinite(value)) return "0";
  return value.toFixed(1);
}

function truncateText(value: string, maxLength: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= maxLength) return trimmed;
  return `${trimmed.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

function formatShiftContextSummary(context: ShiftContextResponse): string {
  const projectName = context.project?.name ?? "Project";
  const projectId = context.project?.id ?? "";
  const label = projectId ? `${projectName} (${projectId})` : projectName;
  const parts: string[] = [];
  const statusParts = [
    context.project?.status ? `status ${context.project.status}` : "",
    context.lifecycle?.status ? `lifecycle ${context.lifecycle.status}` : "",
  ].filter(Boolean);
  if (statusParts.length) {
    parts.push(statusParts.join(", "));
  }

  const summary = context.work_orders?.summary;
  if (summary) {
    const ready = summary.ready ?? 0;
    const inProgress = summary.in_progress ?? 0;
    const blocked = summary.blocked ?? 0;
    const backlog = summary.backlog ?? 0;
    const woParts = [`ready ${ready}`, `in progress ${inProgress}`, `blocked ${blocked}`];
    if (backlog > 0) woParts.push(`backlog ${backlog}`);
    parts.push(`WOs ${woParts.join(", ")}`);
  }

  const activeRuns = context.active_runs ?? [];
  if (activeRuns.length) {
    const listed = activeRuns.slice(0, 3).map((run) => {
      const woLabel = run.work_order_id || run.id || "run";
      const statusLabel = run.status ? `:${run.status}` : "";
      return `${woLabel}${statusLabel}`;
    });
    const overflow =
      activeRuns.length > 3 ? ` (+${activeRuns.length - 3} more)` : "";
    parts.push(`Active runs: ${listed.join(", ")}${overflow}`);
  } else {
    parts.push("Active runs: none");
  }

  const economy = context.economy;
  if (economy) {
    const remaining = economy.budget_remaining_usd ?? 0;
    const runway = economy.runway_days ?? 0;
    const budgetStatus = economy.budget_status ?? "unknown";
    parts.push(
      `Budget ${budgetStatus} ${formatUsd(remaining)} remaining, runway ${formatDays(
        runway
      )} days`
    );
  }

  const handoffSummary = context.last_handoff?.summary ?? "";
  const completed = context.last_handoff?.work_completed ?? [];
  if (handoffSummary) {
    parts.push(`Last handoff: ${truncateText(handoffSummary, 140)}`);
  } else if (completed.length) {
    const listed = completed.slice(0, 3).join(", ");
    const overflow = completed.length > 3 ? ` (+${completed.length - 3} more)` : "";
    parts.push(`Last handoff: ${listed}${overflow}`);
  }

  if (!parts.length) {
    return `${label} status unavailable.`;
  }
  return `${label} status: ${parts.join(". ")}.`;
}

type SessionEvent = NonNullable<ActiveSessionResponse["events"]>[number];

function summarizeSessionEvent(event: SessionEvent | undefined): string {
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

const GLOBAL_SESSION_STATES = new Set<GlobalSessionState>([
  "onboarding",
  "briefing",
  "autonomous",
  "debrief",
  "ended",
]);

function isGlobalSessionState(value: unknown): value is GlobalSessionState {
  return typeof value === "string" && GLOBAL_SESSION_STATES.has(value as GlobalSessionState);
}

function parseSessionSummary(raw: unknown): GlobalSessionSummary | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const id = typeof record.id === "string" ? record.id : null;
  const state = isGlobalSessionState(record.state) ? record.state : null;
  const pausedAt = typeof record.paused_at === "string" ? record.paused_at : null;
  if (!id || !state) return null;
  return { id, state, paused_at: pausedAt };
}

function extractErrorMessage(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== "object") return fallback;
  const record = payload as { error?: unknown };
  return typeof record.error === "string" && record.error.trim() ? record.error : fallback;
}

async function postJson(url: string, body?: Record<string, unknown>) {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {}),
    });
    const payload = (await res.json().catch(() => null)) as unknown;
    return { ok: res.ok, payload };
  } catch {
    return { ok: false, payload: null };
  }
}

async function getJson(url: string) {
  try {
    const res = await fetch(url, { cache: "no-store" });
    const payload = (await res.json().catch(() => null)) as unknown;
    return { ok: res.ok, payload };
  } catch {
    return { ok: false, payload: null };
  }
}

async function fetchActiveSession(): Promise<{
  session: GlobalSessionSummary | null;
  error?: string;
}> {
  const response = await getJson("/api/global/sessions/active");
  if (!response.ok) {
    return {
      session: null,
      error: extractErrorMessage(response.payload, "Failed to load global session."),
    };
  }
  if (!response.payload || typeof response.payload !== "object") {
    return { session: null, error: "Invalid global session response." };
  }
  const record = response.payload as { session?: unknown; error?: unknown };
  const session = parseSessionSummary(record.session ?? null);
  const error =
    typeof record.error === "string" && record.error.trim() ? record.error : undefined;
  return { session, error };
}

function normalizeProjectQueryInput(value: string): string {
  let next = value.trim().replace(/^["']|["']$/g, "");
  const prefixes = [
    /^double[- ]?click(?:\s+into)?\s+/i,
    /^drill(?:\s+into)?\s+/i,
    /^go\s+(?:to|into|deeper\s+on)\s+/i,
    /^take\s+me\s+(?:to|into)\s+/i,
    /^focus\s+on\s+/i,
    /^show\s+me\s+/i,
    /^open\s+(?:details?|project\s+details?)(?:\s+for)?\s+/i,
    /^let'?s\s+look\s+at\s+/i,
    /^look\s+at\s+/i,
  ];
  for (const prefix of prefixes) {
    next = next.replace(prefix, "");
  }
  return next
    .replace(/\s+(?:for a second|right now|for now)$/i, "")
    .trim();
}

type ProjectResolution =
  | {
      ok: true;
      projectId: string;
      projectName: string;
      source: "canvas" | "context" | "fallback";
    }
  | {
      ok: false;
      error: string;
    };

function formatProjectCandidateList(
  candidates: GlobalContextResponse["projects"],
  maxItems = 5
): string {
  const listed = candidates
    .slice(0, maxItems)
    .map((project) => `${project.name} (${project.id})`)
    .join(", ");
  const overflow =
    candidates.length > maxItems ? ` (+${candidates.length - maxItems} more)` : "";
  return `${listed}${overflow}`;
}

async function resolveProjectReference(
  query: string,
  options: { allowFallback?: boolean } = {}
): Promise<ProjectResolution> {
  const trimmed = normalizeProjectQueryInput(query);
  if (!trimmed) return { ok: false, error: "Project name or id is required." };

  const state = getCanvasVoiceState();
  const canvasMatch = resolveNode(state.visibleProjects, trimmed);
  if (canvasMatch?.id) {
    return {
      ok: true,
      projectId: canvasMatch.id,
      projectName: canvasMatch.label,
      source: "canvas",
    };
  }

  const response = await getJson("/api/global/context");
  if (response.ok && response.payload && typeof response.payload === "object") {
    const projects = Array.isArray((response.payload as { projects?: unknown }).projects)
      ? ((response.payload as { projects: GlobalContextResponse["projects"] }).projects ??
          [])
      : [];
    if (projects.length) {
      const match = resolveProjectMatch(projects, trimmed);
      if (match.match) {
        return {
          ok: true,
          projectId: match.match.id,
          projectName: match.match.name,
          source: "context",
        };
      }
      if (match.candidates.length > 1) {
        return {
          ok: false,
          error: `Multiple projects match "${trimmed}": ${formatProjectCandidateList(
            match.candidates
          )}. Please specify the project id or exact name.`,
        };
      }
      return { ok: false, error: `Project "${trimmed}" not found.` };
    }
  }

  if (options.allowFallback ?? true) {
    return {
      ok: true,
      projectId: trimmed,
      projectName: trimmed,
      source: "fallback",
    };
  }
  return { ok: false, error: `Unable to resolve project "${trimmed}".` };
}

function resolveProjectQueryArg(
  projectId?: string,
  project?: string
): string | null {
  const candidates = [projectId, project];
  for (const candidate of candidates) {
    if (typeof candidate !== "string") continue;
    const trimmed = candidate.trim();
    if (trimmed) return trimmed;
  }
  return null;
}

type ProjectStatusLookup =
  | {
      ok: true;
      projectId: string;
      projectName: string;
      context: ShiftContextResponse;
      summary: string;
    }
  | {
      ok: false;
      error: string;
    };

async function fetchProjectStatusLookup(projectQuery: string): Promise<ProjectStatusLookup> {
  const resolved = await resolveProjectReference(projectQuery, {
    allowFallback: true,
  });
  if (!resolved.ok) return { ok: false, error: resolved.error };

  const res = await fetch(
    `/api/projects/${encodeURIComponent(resolved.projectId)}/shift-context`,
    { cache: "no-store" }
  );
  const json = (await res.json().catch(() => null)) as ShiftContextResponse | null;
  if (!res.ok) {
    return {
      ok: false,
      error: extractErrorMessage(json, `Unable to load status for ${resolved.projectName}.`),
    };
  }
  if (!json) {
    return {
      ok: false,
      error: `Unable to load status for ${resolved.projectName}.`,
    };
  }
  return {
    ok: true,
    projectId: resolved.projectId,
    projectName: json.project?.name ?? resolved.projectName,
    context: json,
    summary: formatShiftContextSummary(json),
  };
}

type ProjectInspectActions = {
  focus: CanvasCommandDispatchResult;
  highlight: CanvasCommandDispatchResult;
  openDetail: CanvasCommandDispatchResult;
};

async function runProjectInspectActions(projectId: string): Promise<ProjectInspectActions> {
  const focus = await sendCanvasCommand({ type: "focusProject", projectId });
  const highlight = await sendCanvasCommand({ type: "highlightProject", projectId });
  const openDetail = await sendCanvasCommand({
    type: "openProjectDetail",
    projectId,
  });
  return { focus, highlight, openDetail };
}

function buildInspectSummary(
  projectName: string,
  actions: ProjectInspectActions
): {
  ok: boolean;
  message: string;
} {
  const succeeded: string[] = [];
  const failures: string[] = [];

  if (actions.focus.ok) succeeded.push("focused");
  else failures.push(actions.focus.message);

  if (actions.highlight.ok) succeeded.push("highlighted");
  else failures.push(actions.highlight.message);

  if (actions.openDetail.ok) succeeded.push("opened details");
  else failures.push(actions.openDetail.message);

  if (failures.length === 0) {
    return {
      ok: true,
      message: `Inspected ${projectName}: focused, highlighted, and opened details.`,
    };
  }

  if (!succeeded.length) {
    return {
      ok: false,
      message: `Could not inspect ${projectName} on the current canvas. ${failures[0]}`,
    };
  }

  return {
    ok: true,
    message: `Partially inspected ${projectName}: ${succeeded.join(
      ", "
    )}. ${failures[0]}`,
  };
}

function formatProjectEscalationSummary(
  escalations: Array<{ type: string; summary: string }>
): string {
  if (!escalations.length) return "No active escalations.";
  const listed = escalations.slice(0, 3).map((entry) => {
    const typeLabel = entry.type?.trim() ? entry.type : "escalation";
    const summaryLabel = entry.summary?.trim()
      ? truncateText(entry.summary, 90)
      : "requires attention";
    return `${typeLabel}: ${summaryLabel}`;
  });
  const overflow =
    escalations.length > 3 ? ` (+${escalations.length - 3} more)` : "";
  return `Escalations (${escalations.length}): ${listed.join("; ")}${overflow}.`;
}

async function fetchProjectEscalationSummary(
  projectId: string
): Promise<{ ok: true; summary: string; count: number } | { ok: false; error: string }> {
  const response = await getJson("/api/global/context");
  if (response.ok && response.payload && typeof response.payload === "object") {
    const projects = Array.isArray((response.payload as { projects?: unknown }).projects)
      ? ((response.payload as { projects: GlobalContextResponse["projects"] }).projects ??
          [])
      : [];
    if (projects.length) {
      const target = projects.find(
        (project) => normalizeMatch(project.id) === normalizeMatch(projectId)
      );
      if (!target) {
        return {
          ok: false,
          error: `Project "${projectId}" was not found in global context.`,
        };
      }
      const escalations = target.escalations ?? [];
      return {
        ok: true,
        summary: formatProjectEscalationSummary(escalations),
        count: escalations.length,
      };
    }
  }

  const fallbackEscalations = getCanvasVoiceState().escalations.filter(
    (entry) => normalizeMatch(entry.projectId) === normalizeMatch(projectId)
  );
  if (fallbackEscalations.length) {
    return {
      ok: true,
      summary: formatProjectEscalationSummary(
        fallbackEscalations.map((entry) => ({
          type: entry.type,
          summary: entry.summary,
        }))
      ),
      count: fallbackEscalations.length,
    };
  }
  return {
    ok: false,
    error: "Unable to load escalation details for this project right now.",
  };
}

function formatBudgetSnapshot(context: ShiftContextResponse): string {
  const economy = context.economy;
  if (!economy) return "";
  const budgetStatus = economy.budget_status ?? "unknown";
  const remaining = economy.budget_remaining_usd ?? 0;
  return `Budget ${budgetStatus}: ${formatUsd(remaining)} remaining.`;
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
      const dispatch = await sendCanvasCommand({
        type: "focusNode",
        nodeId: resolved?.id ?? trimmed,
      });
      if (!dispatch.ok) return dispatch.message;
      return resolved ? `Focused ${resolved.label}.` : "Focused node.";
    },
    focusProject: async ({ projectId }: FocusProjectArgs) => {
      if (!projectId || typeof projectId !== "string") {
        return "Missing project id.";
      }
      const resolved = await resolveProjectReference(projectId, {
        allowFallback: true,
      });
      if (!resolved.ok) return resolved.error;
      const dispatch = await sendCanvasCommand({
        type: "focusProject",
        projectId: resolved.projectId,
      });
      if (!dispatch.ok) return dispatch.message;
      return `Focused ${resolved.projectName}.`;
    },
    highlightWorkOrder: async ({ workOrderId }: HighlightWorkOrderArgs) => {
      if (!workOrderId || typeof workOrderId !== "string") {
        return "Missing work order id.";
      }
      const trimmed = workOrderId.trim();
      const state = getCanvasVoiceState();
      const resolved = resolveNode(state.visibleWorkOrders, trimmed);
      const dispatch = await sendCanvasCommand({
        type: "highlightWorkOrder",
        workOrderId: resolved?.workOrderId ?? resolved?.id ?? trimmed,
      });
      if (!dispatch.ok) return dispatch.message;
      return resolved ? `Highlighted ${resolved.label}.` : "Highlighted work order.";
    },
    highlightProject: async ({ projectId }: HighlightProjectArgs) => {
      if (!projectId || typeof projectId !== "string") {
        return "Missing project id.";
      }
      const resolved = await resolveProjectReference(projectId, {
        allowFallback: true,
      });
      if (!resolved.ok) return resolved.error;
      const dispatch = await sendCanvasCommand({
        type: "highlightProject",
        projectId: resolved.projectId,
      });
      if (!dispatch.ok) return dispatch.message;
      return `Highlighted ${resolved.projectName}.`;
    },
    openProjectDetail: async ({ projectId }: OpenProjectDetailArgs) => {
      if (!projectId || typeof projectId !== "string") {
        return "Missing project id.";
      }
      const resolved = await resolveProjectReference(projectId, {
        allowFallback: true,
      });
      if (!resolved.ok) return resolved.error;
      const dispatch = await sendCanvasCommand({
        type: "openProjectDetail",
        projectId: resolved.projectId,
      });
      if (!dispatch.ok) return dispatch.message;
      return `Opened ${resolved.projectName} details.`;
    },
    toggleDetailPanel: async ({ open }: ToggleDetailPanelArgs) => {
      if (typeof open !== "boolean") {
        return "Missing open state.";
      }
      const dispatch = await sendCanvasCommand({ type: "toggleDetailPanel", open });
      if (!dispatch.ok) return dispatch.message;
      return open ? "Detail panel opened." : "Detail panel closed.";
    },
    getCanvasCapabilities: async () => {
      const capabilities = getCanvasCommandCapabilities();
      if (!capabilities.canvases.length) {
        return "No canvas is active right now.";
      }
      const canvasSummaries = capabilities.canvases
        .map(
          (canvas) =>
            `${canvas.label}: ${canvas.commands.length ? canvas.commands.join(", ") : "none"}`
        )
        .join(" | ");
      const commands = capabilities.availableCommands;
      const commandSummary = commands.length ? commands.join(", ") : "none";
      return `Available canvas commands: ${commandSummary}. Active canvases: ${canvasSummaries}.`;
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
    getProjectStatus: async ({ project }: GetProjectStatusArgs) => {
      if (!project || typeof project !== "string") {
        return "Project name or id is required.";
      }
      const trimmed = project.trim();
      if (!trimmed) return "Project name or id is required.";
      const statusLookup = await fetchProjectStatusLookup(trimmed);
      if (!statusLookup.ok) return statusLookup.error;
      return statusLookup.summary;
    },
    inspectProject: async ({
      projectId,
      project,
      includeStatus = true,
    }: InspectProjectArgs) => {
      const projectQuery = resolveProjectQueryArg(projectId, project);
      if (!projectQuery) return "Project name or id is required.";

      const resolved = await resolveProjectReference(projectQuery, {
        allowFallback: true,
      });
      if (!resolved.ok) return resolved.error;

      const actions = await runProjectInspectActions(resolved.projectId);
      const inspectSummary = buildInspectSummary(resolved.projectName, actions);

      if (!includeStatus) return inspectSummary.message;
      const statusLookup = await fetchProjectStatusLookup(resolved.projectId);
      if (!statusLookup.ok) return `${inspectSummary.message} ${statusLookup.error}`;
      return `${inspectSummary.message} ${statusLookup.summary}`;
    },
    inspectProjectEscalations: async ({
      projectId,
      project,
      includeStatus = true,
    }: InspectProjectEscalationsArgs) => {
      const projectQuery = resolveProjectQueryArg(projectId, project);
      if (!projectQuery) return "Project name or id is required.";

      const resolved = await resolveProjectReference(projectQuery, {
        allowFallback: true,
      });
      if (!resolved.ok) return resolved.error;

      const actions = await runProjectInspectActions(resolved.projectId);
      const inspectSummary = buildInspectSummary(resolved.projectName, actions);

      const escalationSummary = await fetchProjectEscalationSummary(resolved.projectId);
      const escalationText = escalationSummary.ok
        ? escalationSummary.summary
        : escalationSummary.error;

      if (!includeStatus) return `${inspectSummary.message} ${escalationText}`;

      const statusLookup = await fetchProjectStatusLookup(resolved.projectId);
      if (!statusLookup.ok) {
        return `${inspectSummary.message} ${escalationText} ${statusLookup.error}`;
      }
      const budgetLine = formatBudgetSnapshot(statusLookup.context);
      return [inspectSummary.message, escalationText, budgetLine]
        .filter(Boolean)
        .join(" ");
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
        const resolved = await resolveProjectReference(project, {
          allowFallback: true,
        });
        if (!resolved.ok) return resolved.error;
        const normalized = normalizeMatch(resolved.projectId);
        const current = Array.isArray(session.priority_projects)
          ? session.priority_projects
          : [];
        const next = [
          resolved.projectId,
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
        return `Prioritized ${resolved.projectName}.`;
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
    startShift: async ({ projectId }: StartShiftArgs) => {
      if (!projectId || typeof projectId !== "string") {
        return "Missing project id.";
      }
      const resolved = await resolveProjectReference(projectId, {
        allowFallback: true,
      });
      if (!resolved.ok) return resolved.error;
      const response = await postJson(
        `/api/projects/${encodeURIComponent(resolved.projectId)}/shifts/spawn`,
        {}
      );
      if (!response.ok) {
        return extractErrorMessage(response.payload, "Failed to start shift.");
      }
      return `Started shift for ${resolved.projectName}.`;
    },
    askGlobalAgent: async ({ question }: AskGlobalAgentArgs) => {
      if (!question || typeof question !== "string") {
        return "Missing question.";
      }
      const trimmed = question.trim();
      if (!trimmed) {
        return "Missing question.";
      }
      const response = await postJson("/api/chat/global", { content: trimmed });
      if (!response.ok) {
        return extractErrorMessage(response.payload, "Failed to send message.");
      }
      return "Sent message to the global agent.";
    },
    startSession: async () => {
      const active = await fetchActiveSession();
      if (active.error) {
        return active.error;
      }

      let session = active.session;
      if (!session) {
        const created = await postJson("/api/global/sessions", {});
        if (!created.ok) {
          return extractErrorMessage(created.payload, "Failed to create global session.");
        }
        if (created.payload && typeof created.payload === "object") {
          const record = created.payload as {
            session?: unknown;
            active_session?: unknown;
          };
          session = parseSessionSummary(record.session ?? record.active_session ?? null);
        }
      }

      if (!session) {
        return "Global session unavailable.";
      }

      if (session.state === "autonomous") {
        return "Global session already running.";
      }
      if (session.state === "briefing") {
        const resume = Boolean(session.paused_at);
        const response = await postJson(
          `/api/global/sessions/${encodeURIComponent(session.id)}/start`,
          resume ? { resume: true } : {}
        );
        if (!response.ok) {
          return extractErrorMessage(response.payload, "Failed to start session.");
        }
        return resume ? "Global session resumed." : "Global session started.";
      }
      if (session.state === "onboarding") {
        return "Global session onboarding incomplete. Finish onboarding first.";
      }
      return "Global session not ready to start.";
    },
    pauseSession: async () => {
      const active = await fetchActiveSession();
      if (active.error) {
        return active.error;
      }
      const session = active.session;
      if (!session) {
        return "No active global session.";
      }
      if (session.state !== "autonomous") {
        return "Global session is not running.";
      }
      const response = await postJson(
        `/api/global/sessions/${encodeURIComponent(session.id)}/pause`,
        {}
      );
      if (!response.ok) {
        return extractErrorMessage(response.payload, "Failed to pause session.");
      }
      return "Global session paused.";
    },
  };
}

export type {
  CanvasVoiceNode,
  CanvasVoiceState,
  CanvasVoiceCommand,
  CanvasVoiceRuntime,
  CanvasVoiceEscalation,
  CanvasVoiceEscalationDetail,
  CanvasVoiceShift,
  CanvasVoiceShiftUpdate,
  CanvasVoiceSession,
};
