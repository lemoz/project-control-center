"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef } from "react";
import type { AgentFocus } from "../playground/canvas/useAgentFocus";
import type { ProjectNode, RunStatus, WorkOrderNode } from "../playground/canvas/types";
import { useActiveShift } from "./useActiveShift";
import { useShiftLogTail } from "./useShiftLogTail";
import { parseShiftLogLines, extractCurrentState, type ActivityEntry } from "./parseShiftLog";
import styles from "./live.module.css";

type AgentActivityPanelProps = {
  project: ProjectNode | null;
  focus: AgentFocus | null;
  workOrderNodes: WorkOrderNode[];
  loading: boolean;
};

const STATUS_LABELS: Record<RunStatus, string> = {
  queued: "Queued",
  baseline_failed: "Baseline failed",
  building: "Building",
  waiting_for_input: "Waiting for input",
  ai_review: "Reviewing",
  testing: "Testing",
  you_review: "Awaiting review",
  merged: "Merged",
  merge_conflict: "Merge conflict",
  failed: "Failed",
  canceled: "Canceled",
};

function formatTime(value: string | null | undefined): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function resolveActionLabel(
  focus: AgentFocus | null,
  hasActiveShift: boolean
): string {
  if (focus?.status) {
    return STATUS_LABELS[focus.status] ?? focus.status.replace(/_/g, " ");
  }
  if (hasActiveShift) return "Planning";
  return "Idle";
}

const ENTRY_TYPE_STYLES: Record<ActivityEntry["type"], { icon: string; color: string }> = {
  init: { icon: "⚡", color: "#6ee7b7" },
  tool: { icon: "→", color: "#60a5fa" },
  text: { icon: "💬", color: "#a9b0c2" },
  result: { icon: "✓", color: "#6ee7b7" },
  error: { icon: "✗", color: "#f87171" },
  unknown: { icon: "•", color: "#6b7280" },
};

function ActivityLogEntry({ entry }: { entry: ActivityEntry }) {
  const style = ENTRY_TYPE_STYLES[entry.type];
  return (
    <div
      style={{
        display: "flex",
        gap: 8,
        padding: "4px 0",
        borderBottom: "1px solid #1f2433",
        fontSize: 12,
        lineHeight: 1.4,
      }}
    >
      <span style={{ color: style.color, flexShrink: 0, width: 16 }}>{style.icon}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ color: style.color, fontWeight: entry.type === "tool" ? 600 : 400 }}>
          {entry.content}
        </div>
        {entry.details && (
          <div style={{ color: "#6b7280", fontSize: 11, marginTop: 2 }}>{entry.details}</div>
        )}
      </div>
    </div>
  );
}

export function AgentActivityPanel({
  project,
  focus,
  workOrderNodes,
  loading,
}: AgentActivityPanelProps) {
  const projectId = project?.id ?? null;
  const { shift, loading: shiftLoading, error: shiftError } = useActiveShift(projectId);
  const shiftId = shift?.id ?? null;
  const {
    data: logTail,
    loading: logLoading,
    error: logError,
    lastUpdated,
  } = useShiftLogTail(projectId, shiftId, { lines: 120, intervalMs: 2000 });
  const logRef = useRef<HTMLDivElement | null>(null);

  const activeWorkOrderId =
    focus?.kind === "work_order" && focus.source === "active_run"
      ? focus.workOrderId ?? null
      : null;
  const lastFocusWorkOrderId =
    activeWorkOrderId ?? (focus?.kind === "work_order" ? focus.workOrderId ?? null : null);
  const workOrderIdToShow = lastFocusWorkOrderId;
  const workOrderLabel = activeWorkOrderId ? "Work order" : "Last focus";

  const activeWorkOrder = useMemo(() => {
    if (!projectId || !workOrderIdToShow) return null;
    return (
      workOrderNodes.find(
        (node) => node.projectId === projectId && node.workOrderId === workOrderIdToShow
      ) ?? null
    );
  }, [projectId, workOrderIdToShow, workOrderNodes]);

  const hasActiveShift = Boolean(shiftId);
  const focusUpdated = formatTime(focus?.updatedAt);
  const shiftStarted = formatTime(shift?.started_at);
  const logUpdated = lastUpdated ? lastUpdated.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : null;
  const logLines = logTail?.lines ?? [];

  // Parse stream-json log lines into structured activity entries
  const activityEntries = useMemo(() => parseShiftLogLines(logLines), [logLines]);
  const currentState = useMemo(() => extractCurrentState(activityEntries), [activityEntries]);

  // Derive action label from parsed logs or fall back to focus/shift status
  const actionLabel = useMemo(() => {
    if (currentState.currentTool) {
      return currentState.currentTool.replace("→ ", "");
    }
    return resolveActionLabel(focus, hasActiveShift);
  }, [currentState.currentTool, focus, hasActiveShift]);

  const showLogError = Boolean(logError) && !logLines.length;

  useEffect(() => {
    const el = logRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (distanceFromBottom < 40) {
      el.scrollTop = el.scrollHeight;
    }
  }, [activityEntries]);

  if (loading) {
    return (
      <section className={`card ${styles.activityCard}`}>
        <div className={styles.activityHeader}>
          <div>
            <div className={styles.activityTitle}>Agent activity</div>
            <div className="muted" style={{ fontSize: 12 }}>
              Loading live context...
            </div>
          </div>
        </div>
      </section>
    );
  }

  if (!project) {
    return (
      <section className={`card ${styles.activityCard}`}>
        <div className={styles.activityHeader}>
          <div>
            <div className={styles.activityTitle}>Agent activity</div>
            <div className="muted" style={{ fontSize: 12 }}>
              Project data unavailable.
            </div>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className={`card ${styles.activityCard}`}>
      <div className={styles.activityHeader}>
        <div>
          <div className={styles.activityTitle}>Agent activity</div>
          <div className="muted" style={{ fontSize: 12 }}>
            Live shift focus and log stream.
          </div>
        </div>
        <span className="badge">{hasActiveShift ? "Active shift" : "No active shift"}</span>
      </div>

      <div className={styles.activityMeta}>
        <div className={styles.activityItem}>
          <div className={styles.activityLabel}>Current action</div>
          <div className={styles.activityValue}>
            <span className="badge">{actionLabel}</span>
          </div>
          {focusUpdated && (
            <div className="muted" style={{ fontSize: 12 }}>
              Updated {focusUpdated}
            </div>
          )}
        </div>

        <div className={styles.activityItem}>
          <div className={styles.activityLabel}>{workOrderLabel}</div>
          {workOrderIdToShow ? (
            <>
              <Link
                href={`/projects/${encodeURIComponent(project.id)}/work-orders/${encodeURIComponent(
                  workOrderIdToShow
                )}`}
                className={styles.activityValue}
              >
                {workOrderIdToShow}
              </Link>
              {activeWorkOrder?.title && (
                <div className="muted" style={{ fontSize: 12 }}>
                  {activeWorkOrder.title}
                </div>
              )}
            </>
          ) : (
            <div className="muted" style={{ fontSize: 12 }}>
              No active work order.
            </div>
          )}
        </div>

        <div className={styles.activityItem}>
          <div className={styles.activityLabel}>Shift status</div>
          {shiftLoading && !shift && <div className="muted">Loading shift...</div>}
          {!shiftLoading && shiftError && !shift && (
            <div className="muted" style={{ fontSize: 12 }}>
              {shiftError}
            </div>
          )}
          {!shiftLoading && (!shiftError || shift) && (
            <div className={styles.activityValue}>
              {hasActiveShift ? "Active" : "Idle"}
            </div>
          )}
          {shiftStarted && (
            <div className="muted" style={{ fontSize: 12 }}>
              Started {shiftStarted}
            </div>
          )}
        </div>
      </div>

      <div className={styles.logPanel}>
        <div className={styles.logHeader}>
          <div style={{ fontWeight: 600 }}>Agent activity</div>
          <div className="muted" style={{ fontSize: 12 }}>
            {logLoading && !logLines.length ? "Loading..." : "Live"}
            {currentState.isComplete && " • Complete"}
            {currentState.hasError && " • Error"}
          </div>
        </div>

        <div className={styles.logScroller} ref={logRef}>
          {showLogError ? (
            <pre className={styles.logText}>{logError}</pre>
          ) : activityEntries.length > 0 ? (
            <div style={{ display: "flex", flexDirection: "column" }}>
              {activityEntries.map((entry) => (
                <ActivityLogEntry key={entry.id} entry={entry} />
              ))}
            </div>
          ) : (
            <pre className={styles.logText}>
              {hasActiveShift ? "(waiting for activity...)" : "No active shift."}
            </pre>
          )}
        </div>

        <div className={styles.logMeta}>
          <div>
            {activityEntries.length > 0
              ? `${activityEntries.length} events`
              : logTail?.has_more
                ? "Showing latest"
                : ""}
          </div>
          {logUpdated && <div>Updated {logUpdated}</div>}
        </div>
      </div>
    </section>
  );
}
