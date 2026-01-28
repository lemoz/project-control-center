"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import styles from "./live.module.css";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatRunStatus(value?: string): string {
  if (!value) return "idle";
  return value.replace(/_/g, " ");
}

function statusColor(status: string): string {
  switch (status) {
    case "active":
      return "#22c55e";
    case "blocked":
      return "#f87171";
    case "parked":
      return "#fbbf24";
    default:
      return "#a9b0c2";
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ProjectDetailPanelProps = {
  projectId: string;
  onClose: () => void;
};

type RepoSummary = {
  id: string;
  name: string;
  description?: string;
  path?: string;
  type?: string;
  stage?: string;
  status?: string;
  priority?: number;
  starred?: boolean;
  hidden?: boolean;
  tags?: string[];
};

type WorkOrder = {
  id: string;
  title: string;
  status: string;
  priority: number;
};

type Run = {
  id: string;
  status: string;
  work_order_id?: string;
  started_at?: string;
  ended_at?: string;
};

type ShiftContext = {
  active_shift?: {
    agent_name?: string;
    started_at?: string;
    iteration_count?: number;
  } | null;
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ProjectDetailPanel({ projectId, onClose }: ProjectDetailPanelProps) {
  const [project, setProject] = useState<RepoSummary | null>(null);
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [shift, setShift] = useState<ShiftContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    Promise.all([
      fetch(`/api/repos/${projectId}`).then((r) => (r.ok ? r.json() : Promise.reject("Failed to load project"))),
      fetch(`/api/repos/${projectId}/work-orders`).then((r) => (r.ok ? r.json() : Promise.reject("Failed to load work orders"))),
      fetch(`/api/repos/${projectId}/runs?limit=5`).then((r) => (r.ok ? r.json() : Promise.reject("Failed to load runs"))),
      fetch(`/api/projects/${projectId}/shift-context`).then((r) => (r.ok ? r.json() : null)).catch(() => null),
    ])
      .then(([projectData, woData, runsData, shiftData]) => {
        if (cancelled) return;
        setProject(projectData);
        setWorkOrders(Array.isArray(woData) ? woData : []);
        setRuns(Array.isArray(runsData) ? runsData : []);
        setShift(shiftData);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(typeof err === "string" ? err : "Failed to load project details");
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [projectId]);

  // Work order counts
  const woCounts = {
    ready: workOrders.filter((wo) => wo.status === "ready").length,
    building: workOrders.filter((wo) => wo.status === "building").length,
    blocked: workOrders.filter((wo) => wo.status === "blocked").length,
    done: workOrders.filter((wo) => wo.status === "done").length,
  };

  const activeWOs = workOrders.filter((wo) => wo.status === "ready" || wo.status === "building");

  // Escalation count — derive from blocked work orders
  const escalationCount = woCounts.blocked;

  return (
    <aside className={`card ${styles.detailPanel}`}>
      {/* Header */}
      <div className={styles.detailHeader}>
        <div>
          <div className="muted" style={{ fontSize: 12 }}>
            {projectId}
          </div>
          <div className={styles.detailTitle}>
            {project?.name ?? (loading ? "Loading..." : projectId)}
          </div>
        </div>
        <button
          onClick={onClose}
          style={{
            width: 28,
            height: 28,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(255, 255, 255, 0.08)",
            border: "none",
            borderRadius: "50%",
            color: "#a9b0c2",
            fontSize: 18,
            cursor: "pointer",
            flexShrink: 0,
          }}
          aria-label="Close project details"
        >
          &times;
        </button>
      </div>

      {/* Meta badges */}
      {project && (
        <div className={styles.detailMeta}>
          {project.type && <span className="badge">{project.type}</span>}
          {project.stage && <span className="badge">{project.stage}</span>}
          {project.status && <span className="badge">{formatRunStatus(project.status)}</span>}
          {project.priority != null && <span className="badge">P{project.priority}</span>}
        </div>
      )}

      {/* Loading / Error */}
      {loading && (
        <div className="muted" style={{ fontSize: 12 }}>
          Loading project details...
        </div>
      )}
      {error && (
        <div className="error" style={{ fontSize: 12 }}>
          {error}
        </div>
      )}

      {/* Health */}
      {project?.status && (
        <div className={styles.detailSection}>
          <div className={styles.detailLabel}>Health</div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span
              style={{
                display: "inline-block",
                width: 10,
                height: 10,
                borderRadius: "50%",
                background: statusColor(project.status),
              }}
            />
            <span style={{ fontSize: 13, fontWeight: 600 }}>
              {formatRunStatus(project.status)}
            </span>
          </div>
        </div>
      )}

      {/* Work Orders summary */}
      {!loading && (
        <div className={styles.detailSection}>
          <div className={styles.detailLabel}>Work Orders</div>
          <div style={{ fontSize: 12, color: "#a9b0c2", display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            <span style={{ color: woCounts.ready > 0 ? "#22c55e" : undefined }}>{woCounts.ready} ready</span>
            <span style={{ color: "#2b3347" }}>&middot;</span>
            <span style={{ color: woCounts.building > 0 ? "#59c6ff" : undefined }}>{woCounts.building} building</span>
            <span style={{ color: "#2b3347" }}>&middot;</span>
            <span style={{ color: woCounts.blocked > 0 ? "#f87171" : undefined }}>{woCounts.blocked} blocked</span>
            <span style={{ color: "#2b3347" }}>&middot;</span>
            <span>{woCounts.done} done</span>
          </div>
          {activeWOs.length > 0 ? (
            <div className={styles.runList}>
              {activeWOs.map((wo) => (
                <div key={wo.id} className={styles.runItem}>
                  <span className={styles.runId}>{wo.id}</span>
                  <span style={{ fontSize: 12, flex: 1, marginLeft: 8 }}>{wo.title}</span>
                  <span className="badge">{formatRunStatus(wo.status)}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="muted" style={{ fontSize: 12 }}>
              No active work orders.
            </div>
          )}
        </div>
      )}

      {/* Active shift */}
      {!loading && (
        <div className={styles.detailSection}>
          <div className={styles.detailLabel}>Active Shift</div>
          {shift?.active_shift ? (
            <div style={{ fontSize: 12 }}>
              <div>
                <span style={{ fontWeight: 600 }}>{shift.active_shift.agent_name ?? "Agent"}</span>
              </div>
              {shift.active_shift.started_at && (
                <div className="muted" style={{ marginTop: 2 }}>
                  Started: {new Date(shift.active_shift.started_at).toLocaleString()}
                </div>
              )}
              {shift.active_shift.iteration_count != null && (
                <div className="muted" style={{ marginTop: 2 }}>
                  Iterations: {shift.active_shift.iteration_count}
                </div>
              )}
            </div>
          ) : (
            <div className="muted" style={{ fontSize: 12 }}>
              No active shift
            </div>
          )}
        </div>
      )}

      {/* Recent runs */}
      {!loading && (
        <div className={styles.detailSection}>
          <div className={styles.detailLabel}>Recent Runs</div>
          {runs.length > 0 ? (
            <div className={styles.runList}>
              {runs.map((run) => (
                <div key={run.id} className={styles.runItem}>
                  <span className={styles.runId}>{run.id}</span>
                  <span className="badge">{formatRunStatus(run.status)}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="muted" style={{ fontSize: 12 }}>
              No recent runs yet.
            </div>
          )}
        </div>
      )}

      {/* Escalations */}
      {!loading && escalationCount > 0 && (
        <div className={styles.detailSection}>
          <div className={styles.detailLabel}>Escalations</div>
          <div style={{ fontSize: 12, color: "#fbbf24" }}>
            {escalationCount} blocked work order{escalationCount > 1 ? "s" : ""} requiring attention
          </div>
          <ul className={styles.detailList}>
            {workOrders
              .filter((wo) => wo.status === "blocked")
              .map((wo) => (
                <li key={wo.id}>
                  {wo.id}: {wo.title}
                </li>
              ))}
          </ul>
        </div>
      )}

      {/* Links */}
      {!loading && (
        <div className={styles.detailSection}>
          <div className={styles.detailLabel}>Links</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 13 }}>
            <Link href={`/projects/${projectId}/live`} style={{ color: "#7dd3fc" }}>
              Live Canvas
            </Link>
            <Link href={`/projects/${projectId}`} style={{ color: "#7dd3fc" }}>
              Project Board
            </Link>
            <Link href={`/chat?scope=project&id=${projectId}`} style={{ color: "#7dd3fc" }}>
              Chat
            </Link>
          </div>
        </div>
      )}
    </aside>
  );
}
