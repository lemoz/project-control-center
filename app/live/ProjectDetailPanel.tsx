"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import styles from "./live.module.css";
import type { ProjectNode } from "../playground/canvas/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:4010";

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
  initialNode?: ProjectNode | null;
  onClose: () => void;
};

type ShiftContextResponse = {
  project: {
    id: string;
    name: string;
    stage?: string;
    status?: string;
    priority?: number;
  };
  lifecycle?: {
    status: string;
    metrics?: {
      failure_rate_30d: number;
      days_since_last_activity: number;
    };
  };
  economy?: {
    budget_remaining_usd: number;
    daily_drip_usd: number;
    burn_rate_daily_usd: number;
    runway_days: number;
    budget_status: string;
  };
  work_orders?: {
    summary: { ready: number; backlog: number; done: number; in_progress: number; blocked: number };
  };
  recent_runs?: Array<{
    id: string;
    work_order_id: string;
    status: string;
    error?: string | null;
  }>;
  communications_inbox?: Array<{
    id: string;
    intent: string;
    type: string;
    summary: string;
  }>;
};

type ActiveShiftResponse = {
  id: string;
  started_at: string;
  agent_id: string | null;
} | null;

type PanelData = {
  name: string;
  stage: string;
  status: string | null;
  priority: number | null;
  health: string;
  budget: { remaining_usd: number; burn_rate_daily_usd: number; runway_days: number } | null;
  woCounts: { ready: number; building: number; blocked: number; done: number };
  escalations: Array<{ id: string; type: string; summary: string }>;
  recentRuns: Array<{ id: string; status: string; outcome: string | null }>;
  activeShift: { id: string; started_at: string; agent_id: string | null } | null;
};

// ---------------------------------------------------------------------------
// Data loaders — fetch directly from API server (bypasses Next.js proxy)
// ---------------------------------------------------------------------------

async function fetchShiftContext(projectId: string): Promise<ShiftContextResponse> {
  const res = await fetch(
    `${API_BASE}/projects/${encodeURIComponent(projectId)}/shift-context`,
    { cache: "no-store" }
  );
  if (!res.ok) throw new Error("failed to load project context");
  return res.json();
}

async function fetchActiveShift(projectId: string): Promise<ActiveShiftResponse> {
  const res = await fetch(
    `${API_BASE}/projects/${encodeURIComponent(projectId)}/shifts/active`,
    { cache: "no-store" }
  );
  if (!res.ok) return null;
  const data = await res.json();
  return data?.id ? data : null;
}

function deriveHealth(ctx: ShiftContextResponse): string {
  const status = ctx.project.status;
  if (status === "blocked") return "blocked";
  if (status === "paused" || status === "parked") return "stalled";
  const failureRate = ctx.lifecycle?.metrics?.failure_rate_30d ?? 0;
  if (failureRate >= 0.6) return "failing";
  const daysSince = ctx.lifecycle?.metrics?.days_since_last_activity ?? 0;
  const ready = ctx.work_orders?.summary.ready ?? 0;
  if (ready > 0 && daysSince >= 3) return "stalled";
  const escalations = (ctx.communications_inbox ?? []).filter(
    (c) => c.intent === "escalation"
  );
  if (escalations.length > 0) return "attention_needed";
  return "healthy";
}

function buildPanelData(
  ctx: ShiftContextResponse,
  shift: ActiveShiftResponse
): PanelData {
  const woSummary = ctx.work_orders?.summary;
  const escalations = (ctx.communications_inbox ?? []).filter(
    (c) => c.intent === "escalation"
  );
  return {
    name: ctx.project.name,
    stage: ctx.project.stage ?? "Unspecified",
    status: ctx.project.status ?? null,
    priority: ctx.project.priority ?? null,
    health: deriveHealth(ctx),
    budget: ctx.economy
      ? {
          remaining_usd: ctx.economy.budget_remaining_usd,
          burn_rate_daily_usd: ctx.economy.burn_rate_daily_usd,
          runway_days: ctx.economy.runway_days,
        }
      : null,
    woCounts: {
      ready: woSummary?.ready ?? 0,
      building: woSummary?.in_progress ?? 0,
      blocked: woSummary?.blocked ?? 0,
      done: woSummary?.done ?? 0,
    },
    escalations: escalations.map((c) => ({ id: c.id, type: c.type, summary: c.summary })),
    recentRuns: (ctx.recent_runs ?? []).slice(0, 5).map((r) => ({
      id: r.id,
      status: r.status,
      outcome: r.error ? "Failed" : null,
    })),
    activeShift: shift,
  };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

function buildInitialFromNode(node: ProjectNode): PanelData {
  const healthStatus = node.healthStatus ?? "healthy";
  return {
    name: node.name,
    stage: "...",
    status: node.status ?? null,
    priority: node.priority ?? null,
    health: healthStatus,
    budget: null,
    woCounts: {
      ready: node.workOrders.ready,
      building: node.workOrders.building,
      blocked: node.workOrders.blocked,
      done: node.workOrders.done,
    },
    escalations: [],
    recentRuns: [],
    activeShift: null,
  };
}

export function ProjectDetailPanel({ projectId, initialNode, onClose }: ProjectDetailPanelProps) {
  const [data, setData] = useState<PanelData | null>(
    initialNode ? buildInitialFromNode(initialNode) : null
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    Promise.all([fetchShiftContext(projectId), fetchActiveShift(projectId)])
      .then(([ctx, shift]) => {
        if (cancelled) return;
        setData(buildPanelData(ctx, shift));
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "failed to load project details");
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const projectName = data?.name ?? projectId;
  const stageLabel = data?.stage ?? "Unspecified";
  const priorityLabel = data?.priority != null ? `P${data.priority}` : "P?";
  const statusLabel = data?.status ?? null;
  const woCounts = data?.woCounts ?? { ready: 0, building: 0, blocked: 0, done: 0 };
  const escalations = data?.escalations ?? [];
  const budget = data?.budget ?? null;
  const activeShift = data?.activeShift ?? null;
  const recentRuns = data?.recentRuns ?? [];
  const healthStatus = data?.health ?? null;
  const healthColor = healthStatus ? HEALTH_COLORS[healthStatus] ?? "#a9b0c2" : "#a9b0c2";

  const skeletonBar = (width: string | number, height = 14) => (
    <div
      style={{
        width,
        height,
        borderRadius: 4,
        background: "rgba(255,255,255,0.06)",
        animation: "pulse 1.2s ease-in-out infinite",
      }}
    />
  );

  if (loading) {
    return (
      <div className={styles.detailPanelOverlay} role="presentation">
        <aside className={`card ${styles.detailPanel} ${styles.detailPanelSlideIn}`}>
          <div className={styles.detailHeader}>
            <div>
              <div className="muted" style={{ fontSize: 12 }}>{projectId}</div>
              <div className={styles.detailTitle}>{skeletonBar(180, 18)}</div>
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
            {skeletonBar(80, 22)}
            {skeletonBar(32, 22)}
            {skeletonBar(56, 22)}
          </div>
          {[100, 120, 140, 100, 80].map((w, i) => (
            <div key={i} className={styles.detailSection}>
              {skeletonBar(70, 11)}
              <div style={{ marginTop: 6 }}>{skeletonBar(w)}</div>
            </div>
          ))}
          <style>{`@keyframes pulse { 0%, 100% { opacity: 0.4; } 50% { opacity: 0.8; } }`}</style>
        </aside>
      </div>
    );
  }

  return (
    <div className={styles.detailPanelOverlay} role="presentation">
      <aside
        className={`card ${styles.detailPanel} ${styles.detailPanelSlideIn}`}
      >
        <div className={styles.detailHeader}>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>
              {projectId}
            </div>
            <div className={styles.detailTitle}>
              {projectName}
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
              <div>Burn rate: {formatCurrency(budget.burn_rate_daily_usd)} / day</div>
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
