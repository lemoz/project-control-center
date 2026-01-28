"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { SpeakingIndicator } from "./SpeakingIndicator";
import { useVoiceAgent, type TranscriptEntry } from "./useVoiceAgent";
import { VoiceButton } from "./VoiceButton";
import {
  setCanvasVoiceState,
  useCanvasVoiceState,
  type CanvasVoiceEscalation,
  type CanvasVoiceShiftUpdate,
  type CanvasVoiceState,
  type CanvasVoiceNode,
} from "./voiceClientTools";

const MAX_CONTEXT_ITEMS = 8;
const CONTEXT_THROTTLE_MS = 600;
const SESSION_POLL_MS = 10_000;
const SESSION_IDLE_POLL_MS = 30_000;
const ESCALATION_POLL_MS = 20_000;
const SHIFT_POLL_MS = 30_000;
const MAX_SHIFT_PROJECTS = 6;
const MAX_ANNOUNCEMENTS = 6;

function formatNodeLabel(node: CanvasVoiceNode): string {
  if (node.type === "work_order" && node.title) {
    return `${node.label} (${node.title})`;
  }
  return node.label;
}

function formatNodeList(label: string, nodes: CanvasVoiceNode[]): string {
  if (!nodes.length) return `${label}: none.`;
  const listed = nodes.slice(0, MAX_CONTEXT_ITEMS).map(formatNodeLabel).join(", ");
  const overflow =
    nodes.length > MAX_CONTEXT_ITEMS
      ? ` (+${nodes.length - MAX_CONTEXT_ITEMS} more)`
      : "";
  return `${label}: ${listed}${overflow}.`;
}

function formatSessionTimestamp(value: string | null): string | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return value;
  return new Date(parsed).toLocaleTimeString();
}

function formatSessionSummary(session: CanvasVoiceState["session"]): string {
  const phaseSuffix =
    session.phase !== session.status && session.phase !== "idle"
      ? ` (${session.phase})`
      : "";
  const statusLine = `Session: ${session.status}${phaseSuffix}.`;
  if (session.status === "idle") return statusLine;
  const stats = `Iterations ${session.iterationCount}, decisions ${session.decisionsCount}, actions ${session.actionsCount}.`;
  const lastCheckIn = formatSessionTimestamp(session.lastCheckInAt);
  const priorities = session.priorityProjects.length
    ? `Priority projects: ${session.priorityProjects
        .slice(0, MAX_CONTEXT_ITEMS)
        .join(", ")}.`
    : "";
  const checkInLine = lastCheckIn ? `Last check-in ${lastCheckIn}.` : "";
  return [statusLine, stats, checkInLine, priorities].filter(Boolean).join(" ");
}

function formatEscalationSummary(escalations: CanvasVoiceEscalation[]): string {
  if (!escalations.length) return "Escalations: none.";
  const listed = escalations
    .slice(0, MAX_CONTEXT_ITEMS)
    .map((entry) => `${entry.projectName}: ${entry.summary}`)
    .join("; ");
  const overflow =
    escalations.length > MAX_CONTEXT_ITEMS
      ? ` (+${escalations.length - MAX_CONTEXT_ITEMS} more)`
      : "";
  return `Escalations: ${listed}${overflow}.`;
}

function formatShiftUpdate(update: CanvasVoiceShiftUpdate | null): string {
  if (!update) return "";
  const label =
    update.workOrderCount > 0
      ? `${update.workOrderCount} WOs completed`
      : update.workCompleted.length
        ? `${update.workCompleted.length} items completed`
        : "shift finished";
  return `Latest shift: ${update.projectName} ${label}.`;
}

function buildCanvasSummary(state: CanvasVoiceState): string {
  const contextLabel = state.contextLabel ?? "Canvas";
  const focusLabel = state.focusedNode ? formatNodeLabel(state.focusedNode) : "none";
  const selectedLabel = state.selectedNode ? formatNodeLabel(state.selectedNode) : "none";
  const detailPanel = state.detailPanelOpen ? "open" : "closed";
  const visibleProjects = formatNodeList("Visible projects", state.visibleProjects);
  const visibleWorkOrders = formatNodeList("Visible work orders", state.visibleWorkOrders);
  const sessionSummary = formatSessionSummary(state.session);
  const escalationSummary = formatEscalationSummary(state.escalations);
  const shiftSummary = formatShiftUpdate(state.lastShiftUpdate);

  return [
    `${contextLabel} context update.`,
    `Focused: ${focusLabel}.`,
    `Selected: ${selectedLabel}.`,
    `Detail panel: ${detailPanel}.`,
    visibleProjects,
    visibleWorkOrders,
    sessionSummary,
    escalationSummary,
    shiftSummary,
  ]
    .filter(Boolean)
    .join(" ");
}

function statusLabel(
  status: string,
  isConnecting: boolean,
  isSpeaking: boolean,
  error: string | null
): string {
  if (error) return "Error";
  if (isConnecting) return "Connecting";
  if (status === "disconnecting") return "Stopping";
  if (status === "connected" && isSpeaking) return "Speaking";
  if (status === "connected") return "Listening";
  return "Idle";
}

function transcriptLabel(entry: TranscriptEntry): string {
  return entry.role === "agent" ? "Agent" : "You";
}

type VoiceStatusResponse = {
  available: boolean;
  reason?: string;
};

type GlobalAgentSessionState =
  | "onboarding"
  | "briefing"
  | "autonomous"
  | "debrief"
  | "ended";

type GlobalAgentSession = {
  id: string;
  state: GlobalAgentSessionState;
  paused_at: string | null;
  iteration_count: number;
  decisions_count: number;
  actions_count: number;
  last_check_in_at: string | null;
  briefing_summary: string | null;
  priority_projects: string[];
};

type GlobalAgentSessionEvent = {
  type: string;
  payload: Record<string, unknown> | null;
  created_at: string;
};

type ActiveSessionResponse = {
  session: GlobalAgentSession | null;
  events: GlobalAgentSessionEvent[];
  error?: string;
};

type GlobalContextResponse = {
  projects: Array<{
    id: string;
    name: string;
    escalations: Array<{ id: string; type: string; summary: string }>;
  }>;
};

type ShiftContextResponse = {
  project: { id: string; name: string };
  last_handoff: { created_at: string; work_completed: string[] } | null;
};

function deriveVoiceSession(session: GlobalAgentSession | null): CanvasVoiceState["session"] {
  if (!session) {
    return {
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
    };
  }
  const paused = Boolean(session.paused_at);
  let status: CanvasVoiceState["session"]["status"] = "idle";
  if (session.state === "autonomous") status = "autonomous";
  if (session.state === "onboarding" || session.state === "briefing") {
    status = "onboarding";
  }
  if (paused) status = "paused";
  return {
    id: session.id,
    status,
    phase: session.state,
    paused,
    lastCheckInAt: session.last_check_in_at,
    iterationCount: session.iteration_count,
    decisionsCount: session.decisions_count,
    actionsCount: session.actions_count,
    briefingSummary: session.briefing_summary,
    priorityProjects: session.priority_projects ?? [],
  };
}

function countWorkOrders(items: string[]): number {
  return items.filter((entry) => /WO-\d{4}-\d+/i.test(entry)).length;
}

export function VoiceWidget() {
  const {
    status,
    isSpeaking,
    isConnecting,
    transcript,
    error,
    permissionDenied,
    start,
    stop,
    sendTextMessage,
    sendSystemMessage,
    sendContextualUpdate,
  } = useVoiceAgent();
  const canvasState = useCanvasVoiceState();
  const [textOnly, setTextOnly] = useState(false);
  const [textInput, setTextInput] = useState("");
  const lastContextRef = useRef<string>("");
  const contextTimerRef = useRef<number | null>(null);
  const [voiceStatus, setVoiceStatus] = useState<VoiceStatusResponse | null>(null);
  const [voiceStatusLoading, setVoiceStatusLoading] = useState(true);
  const [sessionSnapshot, setSessionSnapshot] = useState<GlobalAgentSession | null>(null);
  const lastEscalationIdsRef = useRef<Set<string>>(new Set());
  const hasLoadedEscalationsRef = useRef(false);
  const lastHandoffRef = useRef<Map<string, string>>(new Map());
  const [pendingAnnouncements, setPendingAnnouncements] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/voice/status", { cache: "no-store" });
        const json = (await res.json()) as VoiceStatusResponse;
        if (!cancelled) setVoiceStatus(json);
      } catch {
        if (!cancelled) setVoiceStatus({ available: false, reason: "server_unreachable" });
      } finally {
        if (!cancelled) setVoiceStatusLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const isConnected = status === "connected";
  const isBusy = isConnecting || status === "disconnecting";
  const buttonState = error
    ? "error"
    : isConnecting
      ? "connecting"
      : isConnected && isSpeaking
        ? "speaking"
        : isConnected
          ? "listening"
          : "idle";

  useEffect(() => {
    if (permissionDenied) {
      setTextOnly(true);
    }
  }, [permissionDenied]);

  const queueAnnouncement = useCallback((message: string) => {
    const trimmed = message.trim();
    if (!trimmed) return;
    setPendingAnnouncements((prev) => {
      if (prev.includes(trimmed)) return prev;
      const next = [...prev, trimmed];
      if (next.length > MAX_ANNOUNCEMENTS) {
        return next.slice(-MAX_ANNOUNCEMENTS);
      }
      return next;
    });
  }, []);

  useEffect(() => {
    if (!isConnected || pendingAnnouncements.length === 0) return;
    let cancelled = false;
    const flush = async () => {
      for (const message of pendingAnnouncements) {
        if (cancelled) return;
        await sendSystemMessage(message);
      }
      if (!cancelled) setPendingAnnouncements([]);
    };
    void flush();
    return () => {
      cancelled = true;
    };
  }, [isConnected, pendingAnnouncements, sendSystemMessage]);

  const loadSession = useCallback(async () => {
    try {
      const res = await fetch("/api/global/sessions/active", { cache: "no-store" });
      const json = (await res.json().catch(() => null)) as ActiveSessionResponse | null;
      if (!res.ok) throw new Error(json?.error || "failed to load session");
      setSessionSnapshot(json?.session ?? null);
      setCanvasVoiceState({ session: deriveVoiceSession(json?.session ?? null) });
    } catch {
      setSessionSnapshot(null);
      setCanvasVoiceState({
        session: deriveVoiceSession(null),
      });
    }
  }, []);

  useEffect(() => {
    void loadSession();
  }, [loadSession]);

  useEffect(() => {
    const interval =
      sessionSnapshot?.state === "autonomous" ? SESSION_POLL_MS : SESSION_IDLE_POLL_MS;
    const timer = window.setInterval(() => {
      void loadSession();
    }, interval);
    return () => window.clearInterval(timer);
  }, [loadSession, sessionSnapshot?.state]);

  const loadEscalations = useCallback(async () => {
    try {
      const res = await fetch("/api/global/context", { cache: "no-store" });
      const json = (await res.json().catch(() => null)) as GlobalContextResponse | null;
      if (!res.ok || !json?.projects) return;
      const escalations: CanvasVoiceEscalation[] = [];
      for (const project of json.projects) {
        for (const escalation of project.escalations ?? []) {
          escalations.push({
            id: escalation.id,
            projectId: project.id,
            projectName: project.name,
            type: escalation.type,
            summary: escalation.summary,
          });
        }
      }
      setCanvasVoiceState({ escalations });

      const nextIds = new Set(escalations.map((entry) => entry.id));
      const previous = lastEscalationIdsRef.current;
      if (!hasLoadedEscalationsRef.current) {
        for (const escalation of escalations) {
          const typeLabel = escalation.type.toLowerCase().includes("budget")
            ? "budget escalation"
            : "escalation";
          queueAnnouncement(`${escalation.projectName} has a ${typeLabel}.`);
        }
      } else {
        for (const escalation of escalations) {
          if (previous.has(escalation.id)) continue;
          const typeLabel = escalation.type.toLowerCase().includes("budget")
            ? "budget escalation"
            : "escalation";
          queueAnnouncement(`${escalation.projectName} has a ${typeLabel}.`);
        }
      }
      lastEscalationIdsRef.current = nextIds;
      hasLoadedEscalationsRef.current = true;
    } catch {
      // ignore escalation load failures
    }
  }, [queueAnnouncement]);

  useEffect(() => {
    void loadEscalations();
    const timer = window.setInterval(() => {
      void loadEscalations();
    }, ESCALATION_POLL_MS);
    return () => window.clearInterval(timer);
  }, [loadEscalations]);

  const loadShiftUpdates = useCallback(async () => {
    const projects = canvasState.visibleProjects.slice(0, MAX_SHIFT_PROJECTS);
    if (!projects.length) return;
    const results = await Promise.all(
      projects.map(async (project) => {
        try {
          const res = await fetch(
            `/api/projects/${encodeURIComponent(project.id)}/shift-context`,
            { cache: "no-store" }
          );
          const json = (await res.json().catch(() => null)) as ShiftContextResponse | null;
          if (!res.ok || !json?.project) return null;
          return json;
        } catch {
          return null;
        }
      })
    );

    let latestUpdate: CanvasVoiceShiftUpdate | null = null;
    let seededUpdate: CanvasVoiceShiftUpdate | null = null;
    for (const context of results) {
      if (!context?.last_handoff) continue;
      const previous = lastHandoffRef.current.get(context.project.id);
      const nextStamp = context.last_handoff.created_at;
      const workCompleted = context.last_handoff.work_completed ?? [];
      const workOrderCount = countWorkOrders(workCompleted);
      const update: CanvasVoiceShiftUpdate = {
        projectId: context.project.id,
        projectName: context.project.name,
        completedAt: nextStamp,
        workCompleted,
        workOrderCount,
      };
      if (!previous) {
        lastHandoffRef.current.set(context.project.id, nextStamp);
        if (!seededUpdate || update.completedAt > seededUpdate.completedAt) {
          seededUpdate = update;
        }
        continue;
      }
      if (previous === nextStamp) continue;
      lastHandoffRef.current.set(context.project.id, nextStamp);
      if (!latestUpdate || update.completedAt > latestUpdate.completedAt) {
        latestUpdate = update;
      }
      const countLabel =
        workOrderCount > 0
          ? `${workOrderCount} WOs completed`
          : workCompleted.length
            ? `${workCompleted.length} items completed`
            : "shift finished";
      const announcement =
        countLabel === "shift finished"
          ? `${context.project.name} shift finished.`
          : `${context.project.name} shift finished, ${countLabel}.`;
      queueAnnouncement(announcement);
    }
    if (latestUpdate) {
      setCanvasVoiceState({ lastShiftUpdate: latestUpdate });
    } else if (seededUpdate) {
      const existing = canvasState.lastShiftUpdate;
      if (!existing || seededUpdate.completedAt > existing.completedAt) {
        setCanvasVoiceState({ lastShiftUpdate: seededUpdate });
      }
    }
  }, [canvasState.lastShiftUpdate, canvasState.visibleProjects, queueAnnouncement]);

  useEffect(() => {
    void loadShiftUpdates();
    const timer = window.setInterval(() => {
      void loadShiftUpdates();
    }, SHIFT_POLL_MS);
    return () => window.clearInterval(timer);
  }, [loadShiftUpdates]);

  useEffect(() => {
    if (status === "connected") return;
    lastContextRef.current = "";
    if (contextTimerRef.current) {
      window.clearTimeout(contextTimerRef.current);
      contextTimerRef.current = null;
    }
  }, [status]);

  useEffect(() => {
    if (status !== "connected") return;
    const summary = buildCanvasSummary(canvasState);
    if (summary === lastContextRef.current) return;

    if (contextTimerRef.current) {
      window.clearTimeout(contextTimerRef.current);
    }
    contextTimerRef.current = window.setTimeout(() => {
      if (status === "connected") {
        sendContextualUpdate(summary);
        lastContextRef.current = summary;
      }
    }, CONTEXT_THROTTLE_MS);

    return () => {
      if (contextTimerRef.current) {
        window.clearTimeout(contextTimerRef.current);
      }
    };
  }, [canvasState, sendContextualUpdate, status]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && (isConnected || isConnecting)) {
        stop();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isConnected, isConnecting, stop]);

  const handleToggle = async () => {
    if (isConnected || isConnecting) {
      await stop();
    } else {
      await start({ textOnly });
    }
  };

  const handleSendText = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = textInput.trim();
    if (!trimmed) return;
    const sent = await sendTextMessage(trimmed, { textOnly: true });
    if (sent) setTextInput("");
  };

  const statusText = useMemo(
    () => statusLabel(status, isConnecting, isSpeaking, error),
    [status, isConnecting, isSpeaking, error]
  );

  if (!voiceStatusLoading && !voiceStatus?.available) {
    return (
      <section className="card voice-widget">
        <div className="voice-widget-header">
          <div style={{ fontWeight: 600 }}>Voice guide</div>
        </div>
        <div className="notice">
          Voice requires an ElevenLabs API key. Configure in Settings or upgrade to PCC Cloud.
        </div>
        <div className="voice-widget-controls">
          <Link href="/chat" className="btnSecondary">
            Open text chat
          </Link>
          <div className="muted" style={{ fontSize: 12 }}>
            Use the global chat to onboard and control the session without voice.
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="card voice-widget">
      <div className="voice-widget-header">
        <div>
          <div style={{ fontWeight: 600 }}>Voice guide</div>
          <div className="muted" style={{ fontSize: 12 }}>
            Ask about projects, work orders, or the canvas.
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <VoiceButton
            state={buttonState}
            label={isConnected ? "Stop voice session" : "Start voice session"}
            onClick={handleToggle}
            disabled={isBusy}
          />
          <span className="badge">{statusText}</span>
        </div>
      </div>

      <div
        aria-live="polite"
        className="muted"
        style={{ fontSize: 12, display: "flex", gap: 8, alignItems: "center" }}
      >
        <span>Status: {statusText}</span>
        <SpeakingIndicator active={isConnected && isSpeaking} />
      </div>

      {error && <div className="error">{error}</div>}

      {permissionDenied && (
        <div className="notice">
          Microphone access denied. Use text-only mode to continue.
        </div>
      )}

      <div className="voice-widget-controls">
        <button
          className="btnSecondary"
          onClick={() => setTextOnly((prev) => !prev)}
          disabled={isConnected || isConnecting}
          aria-pressed={textOnly}
        >
          {textOnly ? "Voice mode" : "Text-only mode"}
        </button>
        <div className="muted" style={{ fontSize: 12 }}>
          {textOnly
            ? "Text-only mode will open a chat-style session."
            : "Voice mode uses your microphone."}
        </div>
      </div>

      {textOnly && (
        <form onSubmit={handleSendText} className="voice-widget-text">
          <input
            className="input"
            value={textInput}
            onChange={(event) => setTextInput(event.target.value)}
            placeholder="Type a question for the voice agent"
          />
          <button className="btn" type="submit" disabled={!textInput.trim()}>
            Send
          </button>
        </form>
      )}

      <details>
        <summary className="muted" style={{ cursor: "pointer" }}>
          Transcript
        </summary>
        <div className="voice-transcript" aria-live="polite">
          {transcript.length ? (
            transcript.map((entry) => (
              <div key={entry.id} className="voice-transcript-line">
                <span className="muted">{entry.timestamp}</span>{" "}
                <span style={{ fontWeight: 600 }}>{transcriptLabel(entry)}:</span>{" "}
                <span>{entry.text}</span>
              </div>
            ))
          ) : (
            <div className="muted" style={{ fontSize: 12 }}>
              No transcript yet.
            </div>
          )}
        </div>
      </details>
    </section>
  );
}
