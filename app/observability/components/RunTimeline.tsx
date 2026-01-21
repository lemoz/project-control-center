"use client";

import type { RunTimelineEntry } from "../types";

const COLORS = {
  passed: "#22c55e",
  failed: "#ef4444",
  in_progress: "#f59e0b",
};

function formatTimestamp(value: string | null): string {
  if (!value) return "n/a";
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return value;
  return new Date(ms).toLocaleTimeString();
}

export function RunTimeline({
  data,
  loading,
  error,
  hours,
}: {
  data: RunTimelineEntry[];
  loading: boolean;
  error: string | null;
  hours: number;
}) {
  const ordered = [...data].reverse();
  return (
    <section className="card" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 16 }}>Run Timeline</div>
          <div className="muted" style={{ fontSize: 12 }}>
            Last {hours}h runs with outcome signals.
          </div>
        </div>
        <span className="badge">{data.length} runs</span>
      </div>

      {!!error && <div className="error">{error}</div>}
      {loading && <div className="muted">Loading timeline...</div>}

      {!loading && data.length === 0 && (
        <div className="muted" style={{ fontSize: 13 }}>
          No recent runs.
        </div>
      )}

      {!loading && ordered.length > 0 && (
        <>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 8,
              alignItems: "center",
            }}
          >
            {ordered.map((run) => (
              <span
                key={run.id}
                title={`${run.work_order_id} - ${run.status} - ${formatTimestamp(run.started_at)}`}
                style={{
                  color: COLORS[run.outcome],
                  fontSize: 18,
                  lineHeight: 1,
                }}
              >
                o
              </span>
            ))}
          </div>
          <div className="muted" style={{ fontSize: 12, display: "flex", gap: 12 }}>
            <span style={{ color: COLORS.passed }}>o passed</span>
            <span style={{ color: COLORS.failed }}>o failed</span>
            <span style={{ color: COLORS.in_progress }}>o in progress</span>
          </div>
        </>
      )}
    </section>
  );
}
