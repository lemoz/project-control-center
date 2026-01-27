"use client";

import type { IncidentStats } from "../types";

function formatPercent(value: number): string {
  if (!Number.isFinite(value)) return "0%";
  const pct = Math.max(0, Math.round(value * 1000) / 10);
  return `${pct}%`;
}

function formatMs(value: number): string {
  if (!Number.isFinite(value)) return "n/a";
  return `${Math.max(0, Math.round(value))} ms`;
}

function summarizeCategories(stats: IncidentStats): string {
  const entries = Object.entries(stats.by_category || {});
  if (!entries.length) return "none";
  const sorted = entries.sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0));
  return sorted
    .slice(0, 3)
    .map(([category, count]) => `${category} (${count})`)
    .join(", ");
}

export function SecurityIncidentsPanel({
  data,
  loading,
  error,
}: {
  data: IncidentStats | null;
  loading: boolean;
  error: string | null;
}) {
  return (
    <section className="card" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 16 }}>Security incidents</div>
          <div className="muted" style={{ fontSize: 12 }}>
            Monitor false positives and verdict mix.
          </div>
        </div>
      </div>

      {!!error && <div className="error">{error}</div>}
      {loading && <div className="muted">Loading incident stats...</div>}

      {!loading && data && (
        <div style={{ display: "grid", gap: 8, fontSize: 13 }}>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span>Total incidents</span>
            <span>{data.total}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span>False positive rate</span>
            <span>{formatPercent(data.false_positive_rate)}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span>Verdicts (SAFE / WARN / KILL)</span>
            <span>
              {data.by_verdict.SAFE} / {data.by_verdict.WARN} / {data.by_verdict.KILL}
            </span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span>Last 7 days</span>
            <span>{data.last_7_days}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span>Last 30 days</span>
            <span>{data.last_30_days}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span>Avg Gemini latency</span>
            <span>{formatMs(data.avg_gemini_latency_ms)}</span>
          </div>
          <div className="muted" style={{ fontSize: 12 }}>
            Top categories: {summarizeCategories(data)}
          </div>
        </div>
      )}
    </section>
  );
}
