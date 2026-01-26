"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import type { AgentFocus } from "../playground/canvas/useAgentFocus";
import type { ProjectNode } from "../playground/canvas/types";

type ShiftStatusBarProps = {
  focus: AgentFocus | null;
  project: ProjectNode | null;
  loading: boolean;
};

function formatRunStatus(status?: string): string | null {
  if (!status) return null;
  return status.replace(/_/g, " ");
}

export function ShiftStatusBar({ focus, project, loading }: ShiftStatusBarProps) {
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const projectId = project?.id ?? null;

  const startShift = useCallback(async () => {
    if (!projectId) return;
    setStarting(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/projects/${encodeURIComponent(projectId)}/shifts/spawn`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        }
      );
      const json = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) {
        throw new Error(json?.error || "Failed to start shift.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start shift.");
    } finally {
      setStarting(false);
    }
  }, [projectId]);

  if (loading) {
    return <span className="badge">Loading shift...</span>;
  }

  if (!project) {
    return <span className="badge">No project data</span>;
  }

  const hasActiveRun = Boolean(
    focus?.kind === "work_order" && focus.source === "active_run" && focus.workOrderId
  );
  const activeWorkOrderId =
    focus?.kind === "work_order" ? focus.workOrderId ?? null : null;
  const statusLabel = hasActiveRun ? formatRunStatus(focus?.status ?? "") : null;

  // Show active run info, but still allow starting a shift
  if (hasActiveRun && activeWorkOrderId) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span className="badge">Active run</span>
          <Link
            href={`/projects/${encodeURIComponent(project.id)}/work-orders/${encodeURIComponent(
              activeWorkOrderId
            )}`}
            className="badge"
          >
            {activeWorkOrderId}
          </Link>
          {statusLabel && <span className="badge">{statusLabel}</span>}
          <button className="btn" type="button" onClick={() => void startShift()} disabled={starting}>
            {starting ? "Starting..." : "Start Shift"}
          </button>
        </div>
        {!!error && <div className="error">{error}</div>}
      </div>
    );
  }

  const lastFocusWorkOrder = activeWorkOrderId;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span className="badge">Idle</span>
        <button className="btn" type="button" onClick={() => void startShift()} disabled={starting}>
          {starting ? "Starting..." : "Start Shift"}
        </button>
        {lastFocusWorkOrder ? (
          <Link
            href={`/projects/${encodeURIComponent(project.id)}/work-orders/${encodeURIComponent(
              lastFocusWorkOrder
            )}`}
            className="muted"
            style={{ fontSize: 12 }}
          >
            Last focus {lastFocusWorkOrder}
          </Link>
        ) : (
          <Link
            href={`/projects/${encodeURIComponent(project.id)}`}
            className="muted"
            style={{ fontSize: 12 }}
          >
            Explore {project.name}
          </Link>
        )}
      </div>
      {!!error && <div className="error">{error}</div>}
    </div>
  );
}
