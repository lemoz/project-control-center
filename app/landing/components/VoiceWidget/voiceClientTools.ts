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
  globalSessionState: string | null;
  globalSessionPaused: boolean;
  activeShiftProjects: CanvasVoiceShift[];
  escalationSummaries: CanvasVoiceEscalation[];
  updatedAt: number;
};

type CanvasVoiceCommand =
  | { type: "focusNode"; nodeId: string }
  | { type: "focusProject"; projectId: string }
  | { type: "highlightWorkOrder"; workOrderId: string }
  | { type: "highlightProject"; projectId: string }
  | { type: "openProjectDetail"; projectId: string }
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
  globalSessionState: null,
  globalSessionPaused: false,
  activeShiftProjects: [],
  escalationSummaries: [],
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

type FocusProjectArgs = { projectId: string };

type HighlightWorkOrderArgs = { workOrderId: string };

type HighlightProjectArgs = { projectId: string };

type OpenProjectDetailArgs = { projectId: string };

type ToggleDetailPanelArgs = { open: boolean };

type StartShiftArgs = { projectId: string };

type AskGlobalAgentArgs = { question: string };

type GlobalSessionState = "onboarding" | "briefing" | "autonomous" | "debrief" | "ended";

type GlobalSessionSummary = {
  id: string;
  state: GlobalSessionState;
  paused_at: string | null;
};

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

async function fetchActiveSession(): Promise<{ session: GlobalSessionSummary | null; error?: string }> {
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

export function createVoiceClientTools() {
  return {
    focusNode: async ({ nodeId }: FocusNodeArgs) => {
      if (!nodeId || typeof nodeId !== "string") {
        return "Missing node id.";
      }
      sendCanvasCommand({ type: "focusNode", nodeId: nodeId.trim() });
      return "Focused node.";
    },
    focusProject: async ({ projectId }: FocusProjectArgs) => {
      if (!projectId || typeof projectId !== "string") {
        return "Missing project id.";
      }
      sendCanvasCommand({ type: "focusProject", projectId: projectId.trim() });
      return "Focused project.";
    },
    highlightWorkOrder: async ({ workOrderId }: HighlightWorkOrderArgs) => {
      if (!workOrderId || typeof workOrderId !== "string") {
        return "Missing work order id.";
      }
      sendCanvasCommand({ type: "highlightWorkOrder", workOrderId: workOrderId.trim() });
      return "Highlighted work order.";
    },
    highlightProject: async ({ projectId }: HighlightProjectArgs) => {
      if (!projectId || typeof projectId !== "string") {
        return "Missing project id.";
      }
      sendCanvasCommand({ type: "highlightProject", projectId: projectId.trim() });
      return "Highlighted project.";
    },
    openProjectDetail: async ({ projectId }: OpenProjectDetailArgs) => {
      if (!projectId || typeof projectId !== "string") {
        return "Missing project id.";
      }
      sendCanvasCommand({ type: "openProjectDetail", projectId: projectId.trim() });
      return "Opened project detail panel.";
    },
    toggleDetailPanel: async ({ open }: ToggleDetailPanelArgs) => {
      if (typeof open !== "boolean") {
        return "Missing open state.";
      }
      sendCanvasCommand({ type: "toggleDetailPanel", open });
      return open ? "Detail panel opened." : "Detail panel closed.";
    },
    startShift: async ({ projectId }: StartShiftArgs) => {
      if (!projectId || typeof projectId !== "string") {
        return "Missing project id.";
      }
      const trimmed = projectId.trim();
      const response = await postJson(
        `/api/projects/${encodeURIComponent(trimmed)}/shifts/spawn`,
        {}
      );
      if (!response.ok) {
        return extractErrorMessage(response.payload, "Failed to start shift.");
      }
      return `Started shift for ${trimmed}.`;
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
  CanvasVoiceEscalation,
  CanvasVoiceShift,
};
