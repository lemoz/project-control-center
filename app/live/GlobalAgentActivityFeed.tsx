"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ProjectNode } from "../playground/canvas/types";
import styles from "./live.module.css";

type GlobalAgentSessionState =
  | "onboarding"
  | "briefing"
  | "autonomous"
  | "debrief"
  | "ended";

type GlobalAgentSession = {
  id: string;
  state: GlobalAgentSessionState;
  iteration_count: number;
  decisions_count: number;
  actions_count: number;
  last_check_in_at: string | null;
  paused_at: string | null;
};

type GlobalAgentSessionEvent = {
  id: string;
  session_id: string;
  type:
    | "onboarding_step"
    | "briefing_confirmed"
    | "check_in"
    | "guidance"
    | "alert"
    | "paused"
    | "resumed"
    | "completion";
  payload: Record<string, unknown> | null;
  created_at: string;
};

type GlobalAgentActionContext = {
  project_id?: string;
  project_name?: string;
  escalation_id?: string;
  escalation_type?: string;
};

type GlobalAgentActionResult = {
  action: string;
  ok: boolean;
  detail: string;
  context?: GlobalAgentActionContext;
};

type ActiveSessionResponse = {
  session: GlobalAgentSession | null;
  events: GlobalAgentSessionEvent[];
  error?: string;
};

type ActivityItem = {
  id: string;
  kind: "decision" | "event";
  label: string;
  detail: string;
  createdAt: string;
  ok?: boolean;
  projectId?: string;
  projectName?: string;
  escalationId?: string;
  highlight?: "guidance" | "alert";
};

type GlobalAgentActivityFeedProps = {
  projectNodes: ProjectNode[];
  onProjectPulse?: (projectId: string, action?: string) => void;
};

const POLL_INTERVAL_MS = 8_000;
const MAX_ITEMS = 40;

function formatTimestamp(value: string): string {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return value;
  return new Date(parsed).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatStateLabel(state: GlobalAgentSessionState): string {
  return state.charAt(0).toUpperCase() + state.slice(1);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function parseActionContext(value: unknown): GlobalAgentActionContext | undefined {
  if (!isRecord(value)) return undefined;
  const context: GlobalAgentActionContext = {};
  const projectId = readString(value.project_id);
  if (projectId) context.project_id = projectId;
  const projectName = readString(value.project_name);
  if (projectName) context.project_name = projectName;
  const escalationId = readString(value.escalation_id);
  if (escalationId) context.escalation_id = escalationId;
  const escalationType = readString(value.escalation_type);
  if (escalationType) context.escalation_type = escalationType;
  if (Object.keys(context).length === 0) return undefined;
  return context;
}

function parseAction(value: unknown): GlobalAgentActionResult | null {
  if (!isRecord(value)) return null;
  const actionRaw = readString(value.action);
  if (!actionRaw) return null;
  const ok = typeof value.ok === "boolean" ? value.ok : null;
  if (ok === null) return null;
  const detail = readString(value.detail) ?? "";
  const context = parseActionContext(value.context);
  return {
    action: actionRaw.toUpperCase(),
    ok,
    detail,
    context,
  };
}

function parseActions(payload: Record<string, unknown> | null): GlobalAgentActionResult[] {
  if (!payload || !Array.isArray(payload.actions)) return [];
  const actions: GlobalAgentActionResult[] = [];
  for (const entry of payload.actions) {
    const parsed = parseAction(entry);
    if (parsed) actions.push(parsed);
  }
  return actions;
}

function eventSummary(payload: Record<string, unknown> | null): string {
  if (!payload) return "";
  const summary = readString(payload.summary);
  if (summary) return summary;
  const message = readString(payload.message);
  if (message) return message;
  const reason = readString(payload.reason);
  if (reason) return `Reason: ${reason}`;
  return "";
}

function extractProjectNameFromDetail(detail: string): string | undefined {
  const match = detail.match(/for\s+(.+)$/i);
  if (match && match[1]) return match[1].trim();
  return undefined;
}

function extractEscalationId(detail: string): string | undefined {
  const match = detail.match(/escalation\s+([a-zA-Z0-9-_]+)/i);
  if (match && match[1]) return match[1].trim();
  return undefined;
}

function formatDecisionDetail(action: GlobalAgentActionResult): string {
  switch (action.action) {
    case "DELEGATE": {
      const project = action.context?.project_name ?? extractProjectNameFromDetail(action.detail);
      if (project) return `Delegated to ${project}`;
      return action.detail || "Delegated to project";
    }
    case "RESOLVE": {
      const escalation = action.context?.escalation_id ?? extractEscalationId(action.detail);
      if (action.ok) {
        if (escalation) return `Resolved escalation ${escalation}`;
        return action.detail || "Resolved escalation";
      }
      return action.detail || "Resolution failed";
    }
    case "CREATE_PROJECT": {
      const project = action.context?.project_name;
      if (project) return `Created project ${project}`;
      return action.detail || "Created project";
    }
    case "REPORT":
      return action.detail || "Reported update";
    case "WAIT":
      return action.detail || "Waiting";
    default:
      return action.detail || "Decision recorded";
  }
}

export function GlobalAgentActivityFeed({
  projectNodes,
  onProjectPulse,
}: GlobalAgentActivityFeedProps) {
  const [session, setSession] = useState<GlobalAgentSession | null>(null);
  const [events, setEvents] = useState<GlobalAgentSessionEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);

  const logRef = useRef<HTMLDivElement | null>(null);
  const seenItemsRef = useRef<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/global/sessions/active", { cache: "no-store" });
      const json = (await res.json().catch(() => null)) as ActiveSessionResponse | null;
      if (!res.ok) {
        throw new Error(json?.error || "Failed to load global session");
      }
      setSession(json?.session ?? null);
      setEvents(json?.events ?? []);
      setLastUpdated(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load global session");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!session) return;
    const timer = window.setInterval(() => {
      void load();
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [session, load]);

  const projectById = useMemo(() => {
    return new Map(projectNodes.map((node) => [node.id, node]));
  }, [projectNodes]);

  const projectByName = useMemo(() => {
    return new Map(
      projectNodes.map((node) => [node.name.toLowerCase(), node])
    );
  }, [projectNodes]);

  const activityItems = useMemo<ActivityItem[]>(() => {
    const ordered = [...events].sort(
      (a, b) => Date.parse(a.created_at) - Date.parse(b.created_at)
    );
    const items: ActivityItem[] = [];

    for (const event of ordered) {
      const summary = eventSummary(event.payload);
      const actions = parseActions(event.payload);

      if (event.type === "check_in") {
        const detail = summary || "Check-in received.";
        items.push({
          id: `${event.id}-checkin`,
          kind: "event",
          label: "Check-in",
          detail,
          createdAt: event.created_at,
        });
      }

      if (event.type === "guidance") {
        items.push({
          id: `${event.id}-guidance`,
          kind: "event",
          label: "Guidance needed",
          detail: summary || "Guidance required for last shift.",
          createdAt: event.created_at,
          highlight: "guidance",
        });
      }

      if (event.type === "alert") {
        items.push({
          id: `${event.id}-alert`,
          kind: "event",
          label: "Alert",
          detail: summary || "Alert raised by global agent.",
          createdAt: event.created_at,
          highlight: "alert",
        });
      }

      if (event.type === "briefing_confirmed") {
        items.push({
          id: `${event.id}-briefing`,
          kind: "event",
          label: "Briefing confirmed",
          detail: summary || "Briefing confirmed.",
          createdAt: event.created_at,
        });
      }

      if (event.type === "paused") {
        items.push({
          id: `${event.id}-paused`,
          kind: "event",
          label: "Paused",
          detail: summary || "Autonomous session paused.",
          createdAt: event.created_at,
        });
      }

      if (event.type === "resumed") {
        items.push({
          id: `${event.id}-resumed`,
          kind: "event",
          label: "Resumed",
          detail: summary || "Autonomous session resumed.",
          createdAt: event.created_at,
        });
      }

      if (event.type === "completion") {
        items.push({
          id: `${event.id}-completion`,
          kind: "event",
          label: "Completion",
          detail: summary || "Session completed.",
          createdAt: event.created_at,
        });
      }

      if (event.type === "onboarding_step") {
        items.push({
          id: `${event.id}-onboarding`,
          kind: "event",
          label: "Onboarding",
          detail: summary || "Onboarding updated.",
          createdAt: event.created_at,
        });
      }

      actions.forEach((action, index) => {
        const projectFromContext =
          (action.context?.project_id && projectById.get(action.context.project_id)) ||
          (action.context?.project_name
            ? projectByName.get(action.context.project_name.toLowerCase())
            : undefined);
        const extractedName =
          action.context?.project_name ?? extractProjectNameFromDetail(action.detail);
        const projectName = projectFromContext?.name ?? extractedName;
        const projectId = projectFromContext?.id ?? action.context?.project_id;
        const escalationId =
          action.context?.escalation_id ?? extractEscalationId(action.detail);
        items.push({
          id: `${event.id}-decision-${index}`,
          kind: "decision",
          label: action.action,
          detail: formatDecisionDetail(action),
          createdAt: event.created_at,
          ok: action.ok,
          projectId,
          projectName,
          escalationId,
        });
      });
    }

    if (items.length <= MAX_ITEMS) return items;
    return items.slice(items.length - MAX_ITEMS);
  }, [events, projectById, projectByName]);

  useEffect(() => {
    if (!onProjectPulse) return;
    const seen = seenItemsRef.current;
    const nextSeen = new Set(seen);
    for (const item of activityItems) {
      nextSeen.add(item.id);
      if (item.kind !== "decision") continue;
      if (!item.projectId) continue;
      if (seen.has(item.id)) continue;
      onProjectPulse(item.projectId, item.label);
    }
    if (nextSeen.size > 500) {
      seenItemsRef.current = new Set(activityItems.map((item) => item.id));
      return;
    }
    seenItemsRef.current = nextSeen;
  }, [activityItems, onProjectPulse]);

  useEffect(() => {
    if (collapsed) return;
    if (!logRef.current) return;
    logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [activityItems, collapsed]);

  if (!session) return null;

  const subtitle = `${formatStateLabel(session.state)} • ${session.decisions_count} decisions`;
  const statusLine = session.paused_at ? "Paused" : "Live";

  return (
    <div className={styles.activityOverlay}>
      <div className={styles.activityOverlayHeader}>
        <div>
          <div className={styles.activityOverlayTitle}>Global activity</div>
          <div className={styles.activityOverlaySubtitle}>{subtitle}</div>
        </div>
        <button
          type="button"
          className={styles.activityOverlayToggle}
          onClick={() => setCollapsed((prev) => !prev)}
          aria-expanded={!collapsed}
          aria-label={collapsed ? "Expand global activity feed" : "Collapse global activity feed"}
        >
          {collapsed ? "Expand" : "Collapse"}
        </button>
      </div>

      {!collapsed && (
        <>
          <div className={styles.activityOverlayMeta}>
            <span className="badge">Iterations {session.iteration_count}</span>
            <span className={styles.activityOverlayStatus}>
              {loading ? "Loading..." : statusLine}
            </span>
          </div>

          <div className={styles.activityOverlayLog} ref={logRef}>
            {error ? (
              <div className={styles.activityOverlayEmpty}>{error}</div>
            ) : activityItems.length === 0 ? (
              <div className={styles.activityOverlayEmpty}>
                {loading ? "Loading activity..." : "No activity yet."}
              </div>
            ) : (
              <div className={styles.activityFeedList}>
                {activityItems.map((item) => {
                  const highlightClass =
                    item.highlight === "alert"
                      ? styles.activityFeedAlert
                      : item.highlight === "guidance"
                        ? styles.activityFeedGuidance
                        : "";
                  const decisionClass =
                    item.kind === "decision" ? styles.activityFeedDecision : "";
                  const failedClass = item.ok === false ? styles.activityFeedFailed : "";
                  return (
                    <div
                      key={item.id}
                      className={`${styles.activityFeedItem} ${highlightClass} ${decisionClass} ${failedClass}`}
                    >
                      <div className={styles.activityFeedHeader}>
                        <span className={styles.activityFeedTag}>{item.label}</span>
                        <span className={styles.activityFeedTimestamp}>
                          {formatTimestamp(item.createdAt)}
                        </span>
                      </div>
                      <div className={styles.activityFeedDetail}>{item.detail}</div>
                      {(item.projectName || item.projectId || item.escalationId) && (
                        <div className={styles.activityFeedContext}>
                          {item.projectName || item.projectId ? (
                            <span>
                              Project{" "}
                              <span className={styles.activityFeedContextValue}>
                                {item.projectName ?? item.projectId}
                              </span>
                            </span>
                          ) : null}
                          {item.escalationId ? (
                            <span>
                              Escalation{" "}
                              <span className={styles.activityFeedContextValue}>
                                {item.escalationId}
                              </span>
                            </span>
                          ) : null}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className={styles.activityOverlayFooter}>
            <div>{activityItems.length} entries</div>
            <div>{lastUpdated ? `Updated ${lastUpdated}` : ""}</div>
          </div>
        </>
      )}
    </div>
  );
}
