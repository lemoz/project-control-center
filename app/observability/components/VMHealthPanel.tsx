"use client";

import type { VmHealthResponse } from "../types";

function percentLabel(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function formatGb(value: number): string {
  if (!Number.isFinite(value)) return "0 GB";
  return `${value.toFixed(1)} GB`;
}

function MetricRow({ label, metric }: { label: string; metric: VmHealthResponse["disk"] }) {
  const percent = Math.round(metric.percent * 100);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
        <span>{label}</span>
        <span className="muted">{percentLabel(metric.percent)}</span>
      </div>
      <div className="progressTrack">
        <div className="progressFill" style={{ width: `${Math.min(100, percent)}%` }} />
      </div>
      <div className="muted" style={{ fontSize: 12 }}>
        {formatGb(metric.used_gb)} / {formatGb(metric.total_gb)}
      </div>
    </div>
  );
}

export function VMHealthPanel({
  data,
  loading,
  error,
}: {
  data: VmHealthResponse | null;
  loading: boolean;
  error: string | null;
}) {
  const cpuPercent = data ? Math.round(data.cpu.percent * 100) : 0;
  const containerCount = data?.containers.length ?? 0;
  const projectLabel = data?.project_name || data?.project_id || "n/a";

  return (
    <section className="card" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 16 }}>VM Health</div>
          <div className="muted" style={{ fontSize: 12 }}>
            {projectLabel}
          </div>
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          {data?.vm_status && <span className="badge">{data.vm_status}</span>}
          {data && <span className="badge">{data.reachable ? "reachable" : "unreachable"}</span>}
        </div>
      </div>

      {!!error && <div className="error">{error}</div>}
      {!!data?.error && !error && <div className="notice">{data.error}</div>}
      {loading && <div className="muted">Loading VM metrics...</div>}

      {!loading && data && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <MetricRow label="Disk" metric={data.disk} />
          <MetricRow label="Memory" metric={data.memory} />
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
              <span>CPU</span>
              <span className="muted">{percentLabel(data.cpu.percent)}</span>
            </div>
            <div className="progressTrack">
              <div className="progressFill" style={{ width: `${Math.min(100, cpuPercent)}%` }} />
            </div>
            <div className="muted" style={{ fontSize: 12 }}>
              Load: {data.cpu.load_1m.toFixed(2)} / {data.cpu.load_5m.toFixed(2)}
            </div>
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
            <span>Containers</span>
            <span className="muted">{containerCount}</span>
          </div>
          {containerCount > 0 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {data.containers.slice(0, 4).map((container) => (
                <div key={container.name} className="muted" style={{ fontSize: 12 }}>
                  {container.name}: {container.status}
                </div>
              ))}
              {containerCount > 4 && (
                <div className="muted" style={{ fontSize: 12 }}>
                  +{containerCount - 4} more
                </div>
              )}
            </div>
          ) : (
            <div className="muted" style={{ fontSize: 12 }}>
              No containers running.
            </div>
          )}
        </div>
      )}
    </section>
  );
}
