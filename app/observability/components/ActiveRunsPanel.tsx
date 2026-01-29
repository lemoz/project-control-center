"use client";

import type { ActiveRun } from "../types";

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0s";
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.floor(seconds % 60);
  if (minutes < 1) return `${remainingSeconds}s`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (hours < 1) return `${minutes}m`;
  return `${hours}h ${remainingMinutes}m`;
}

export function ActiveRunsPanel({
  data,
  loading,
  error,
  onSelectRun,
}: {
  data: ActiveRun[];
  loading: boolean;
  error: string | null;
  onSelectRun?: (runId: string) => void;
}) {
  return (
    <section className="card" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 16 }}>Active Runs</div>
          <div className="muted" style={{ fontSize: 12 }}>
            Live status + current phase.
          </div>
        </div>
        <span className="badge">{data.length} active</span>
      </div>

      {!!error && <div className="error">{error}</div>}
      {loading && <div className="muted">Loading runs...</div>}

      {!loading && data.length === 0 && (
        <div className="muted" style={{ fontSize: 13 }}>
          No active runs.
        </div>
      )}

      {!loading && data.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {data.map((run) => {
            const statusLabel =
              run.status === "security_hold" ? "security hold" : run.status;
            const statusTitle =
              run.status === "security_hold" ? "Security hold - review required" : undefined;
            return (
              <button
                key={run.id}
                className="btnSecondary"
                style={{ textAlign: "left", padding: 10, width: "100%" }}
                type="button"
                onClick={() => onSelectRun?.(run.id)}
              >
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                  <div style={{ fontWeight: 600 }}>{run.work_order_id}</div>
                  <span className="badge" title={statusTitle}>
                    {statusLabel}
                  </span>
                </div>
                <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                  Phase: {run.phase} - {formatDuration(run.duration_seconds)}
                </div>
                {run.current_activity && (
                  <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                    {run.current_activity}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}
