"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import styles from "./live.module.css";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BUILDING_WORK_ORDER_STATUSES = new Set(["building", "ai_review", "you_review"]);

const HEALTH_COLORS: Record<string, string> = {
  healthy: "#22c55e",
  attention_needed: "#fbbf24",
  stalled: "#f97316",
  failing: "#f87171",
  blocked: "#f87171",
};

function formatLabel(value?: string | null): string {
  if (!value) return "Unknown";
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatCurrency(value?: number | null): string {
  if (value == null || Number.isNaN(value)) return "Unknown";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(value);
}

function formatDateTime(value?: string | null): string {
  if (!value) return "Unknown";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) return "Unknown";
  return parsed.toLocaleString();
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
  stage?: string;
  status?: string;
  priority?: number;
};

type WorkOrder = {
  id: string;
  title: string;
  status: string;
  priority: number;
};

type WorkOrdersResponse = {
  project?: { id: string; name: string };
  work_orders?: WorkOrder[];
};

type GlobalContextProject = {
  id: string;
  name: string;
  status: string;
  health: string;
  budget?: {
    status: string;
    remaining_usd: number;
    allocation_usd: number;
    daily_drip_usd: number;
    runway_days: number;
  };
  active_shift: { id: string; started_at: string; agent_id: string | null } | null;
  escalations: Array<{ id: string; type: string; summary: string }>;
  work_orders: { ready: number; building: number; blocked: number };
  recent_runs: Array<{ id: string; wo_id: string; status: string; outcome: string | null }>;
  last_activity: string | null;
};

type GlobalContextResponse = {
  projects: GlobalContextProject[];
  economy: unknown;
  assembled_at: string;
};

// ---------------------------------------------------------------------------
// Data loaders
// ---------------------------------------------------------------------------

async function fetchRepoSummaries(): Promise<RepoSummary[]> {
  const res = await fetch("/api/repos", { cache: "no-store" });
  const json = (await res.json().catch(() => null)) as RepoSummary[] | { error?: string } | null;
  if (!res.ok) {
    const error = (json as { error?: string } | null)?.error || "failed to load projects";
    throw new Error(error);
  }
  if (!Array.isArray(json)) return [];
  return json;
}

async function fetchGlobalContext(): Promise<GlobalContextResponse> {
  const res = await fetch("/api/global/context", { cache: "no-store" });
  const json = (await res.json().catch(() => null)) as GlobalContextResponse | { error?: string } | null;
  if (!res.ok) {
    const error = (json as { error?: string } | null)?.error || "failed to load global context";
    throw new Error(error);
  }
  const ctx = json as GlobalContextResponse | null;
  if (!ctx || !Array.isArray(ctx.projects)) {
    throw new Error("missing global context");
  }
  return ctx;
}

async function fetchWorkOrders(projectId: string): Promise<WorkOrdersResponse> {
  const res = await fetch(`/api/repos/${encodeURIComponent(projectId)}/work-orders`, {
    cache: "no-store",
  });
  const json = (await res.json().catch(() => null)) as WorkOrdersResponse | { error?: string } | null;
  if (!res.ok) {
    const error = (json as { error?: string } | null)?.error || "failed to load work orders";
    throw new Error(error);
  }
  return (json as WorkOrdersResponse) ?? {};
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ProjectDetailPanel({ projectId, onClose }: ProjectDetailPanelProps) {
  const [projectSummary, setProjectSummary] = useState<RepoSummary | null>(null);
  const [globalProject, setGlobalProject] = useState<GlobalContextProject | null>(null);
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
  const [fallbackName, setFallbackName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    Promise.allSettled([
      fetchRepoSummaries(),
      fetchGlobalContext(),
      fetchWorkOrders(projectId),
    ])
      .then(([reposResult, globalResult, workOrdersResult]) => {
        if (cancelled) return;
        const errors: string[] = [];

        if (reposResult.status === "fulfilled") {
          const repo = reposResult.value.find((item) => item.id === projectId) ?? null;
          setProjectSummary(repo);
        } else {
          errors.push(
            reposResult.reason instanceof Error
              ? reposResult.reason.message
              : "failed to load projects"
          );
          setProjectSummary(null);
        }

        if (globalResult.status === "fulfilled") {
          const match =
            globalResult.value.projects.find((item) => item.id === projectId) ?? null;
          setGlobalProject(match);
        } else {
          errors.push(
            globalResult.reason instanceof Error
              ? globalResult.reason.message
              : "failed to load global context"
          );
          setGlobalProject(null);
        }

        if (workOrdersResult.status === "fulfilled") {
          const list = Array.isArray(workOrdersResult.value.work_orders)
            ? workOrdersResult.value.work_orders
            : [];
          setWorkOrders(list);
          setFallbackName(workOrdersResult.value.project?.name ?? null);
        } else {
          errors.push(
            workOrdersResult.reason instanceof Error
              ? workOrdersResult.reason.message
              : "failed to load work orders"
          );
          setWorkOrders([]);
          setFallbackName(null);
        }

        setError(errors.length > 0 ? errors.join(" | ") : null);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setError("failed to load project details");
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const projectName =
    projectSummary?.name ?? globalProject?.name ?? fallbackName ?? projectId;

  const stageLabel = projectSummary?.stage ? projectSummary.stage : "Unspecified";
  const priorityLabel = projectSummary?.priority != null ? `P${projectSummary.priority}` : "P?";
  const statusLabel = projectSummary?.status ?? globalProject?.status ?? null;

  const woCounts = workOrders.reduce(
    (acc, wo) => {
      if (wo.status === "ready") acc.ready += 1;
      else if (wo.status === "blocked") acc.blocked += 1;
      else if (wo.status === "done") acc.done += 1;
      else if (BUILDING_WORK_ORDER_STATUSES.has(wo.status)) acc.building += 1;
      return acc;
    },
    { ready: 0, building: 0, blocked: 0, done: 0 }
  );

  const escalations = globalProject?.escalations ?? [];
  const budget = globalProject?.budget ?? null;
  const activeShift = globalProject?.active_shift ?? null;
  const recentRuns = (globalProject?.recent_runs ?? []).slice(0, 5);
  const healthStatus = globalProject?.health ?? null;
  const healthColor = healthStatus ? HEALTH_COLORS[healthStatus] ?? "#a9b0c2" : "#a9b0c2";

  return (
    <div className={styles.detailPanelOverlay} onClick={onClose} role="presentation">
      <aside
        className={`card ${styles.detailPanel} ${styles.detailPanelSlideIn}`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className={styles.detailHeader}>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>
              {projectId}
            </div>
            <div className={styles.detailTitle}>
              {loading ? "Loading..." : projectName}
            </div>
          </div>
          <button
            className="btnSecondary"
            onClick={onClose}
            style={{ padding: "4px 8px", fontSize: 12 }}
            aria-label="Close project details"
          >
            X
          </button>
        </div>

        <div className={styles.detailMeta}>
          <span className="badge">Stage {stageLabel}</span>
          <span className="badge">{priorityLabel}</span>
          {statusLabel && <span className="badge">{formatLabel(statusLabel)}</span>}
        </div>

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

        <div className={styles.detailSection}>
          <div className={styles.detailLabel}>Health</div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span
              style={{
                display: "inline-block",
                width: 10,
                height: 10,
                borderRadius: "50%",
                background: healthColor,
              }}
            />
            <span style={{ fontSize: 13, fontWeight: 600 }}>
              {formatLabel(healthStatus)}
            </span>
          </div>
        </div>

        <div className={styles.detailSection}>
          <div className={styles.detailLabel}>Work Orders</div>
          <div
            style={{
              fontSize: 12,
              color: "#a9b0c2",
              display: "flex",
              alignItems: "center",
              gap: 6,
              flexWrap: "wrap",
            }}
          >
            <span style={{ color: woCounts.ready > 0 ? "#22c55e" : undefined }}>
              {woCounts.ready} ready
            </span>
            <span style={{ color: "#2b3347" }}>|</span>
            <span style={{ color: woCounts.building > 0 ? "#59c6ff" : undefined }}>
              {woCounts.building} building
            </span>
            <span style={{ color: "#2b3347" }}>|</span>
            <span style={{ color: woCounts.blocked > 0 ? "#f87171" : undefined }}>
              {woCounts.blocked} blocked
            </span>
            <span style={{ color: "#2b3347" }}>|</span>
            <span>{woCounts.done} done</span>
          </div>
        </div>

        <div className={styles.detailSection}>
          <div className={styles.detailLabel}>Escalations</div>
          {escalations.length ? (
            <ul className={styles.detailList}>
              {escalations.map((item) => (
                <li key={item.id}>
                  {formatLabel(item.type)}: {item.summary}
                </li>
              ))}
            </ul>
          ) : (
            <div className="muted" style={{ fontSize: 12 }}>
              No active escalations.
            </div>
          )}
        </div>

        <div className={styles.detailSection}>
          <div className={styles.detailLabel}>Budget</div>
          {budget ? (
            <div style={{ fontSize: 12, display: "flex", flexDirection: "column", gap: 6 }}>
              <div>Remaining: {formatCurrency(budget.remaining_usd)}</div>
              <div>Burn rate: {formatCurrency(budget.daily_drip_usd)} / day</div>
              <div>Runway: {Math.round(budget.runway_days)} days</div>
            </div>
          ) : (
            <div className="muted" style={{ fontSize: 12 }}>
              No budget data.
            </div>
          )}
        </div>

        <div className={styles.detailSection}>
          <div className={styles.detailLabel}>Active Shift</div>
          {activeShift ? (
            <div style={{ fontSize: 12, display: "flex", flexDirection: "column", gap: 4 }}>
              <div>
                <span className="badge">Running</span>
              </div>
              <div className="muted">Agent: {activeShift.agent_id ?? "Unassigned"}</div>
              <div className="muted">Started: {formatDateTime(activeShift.started_at)}</div>
            </div>
          ) : (
            <div className="muted" style={{ fontSize: 12 }}>
              Idle
            </div>
          )}
        </div>

        <div className={styles.detailSection}>
          <div className={styles.detailLabel}>Recent Runs</div>
          {recentRuns.length ? (
            <div className={styles.runList}>
              {recentRuns.map((run) => (
                <div key={run.id} className={styles.runItem}>
                  <span className={styles.runId}>{run.id}</span>
                  <span className="badge">{formatLabel(run.status)}</span>
                  {run.outcome && (
                    <span className="muted" style={{ fontSize: 11 }}>
                      {formatLabel(run.outcome)}
                    </span>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="muted" style={{ fontSize: 12 }}>
              No recent runs yet.
            </div>
          )}
        </div>

        <div className={styles.detailSection}>
          <div className={styles.detailLabel}>Links</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 13 }}>
            <Link href={`/live?project=${encodeURIComponent(projectId)}`} style={{ color: "#7dd3fc" }}>
              Live Canvas
            </Link>
            <Link href={`/projects/${encodeURIComponent(projectId)}`} style={{ color: "#7dd3fc" }}>
              Project Board
            </Link>
            <Link href={`/projects/${encodeURIComponent(projectId)}/chat`} style={{ color: "#7dd3fc" }}>
              Chat
            </Link>
          </div>
        </div>
      </aside>
    </div>
  );
}
