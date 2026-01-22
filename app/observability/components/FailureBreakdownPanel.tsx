"use client";

import type { RunFailureBreakdown } from "../types";

function formatPercent(value: number): string {
  if (!Number.isFinite(value)) return "0%";
  return `${value.toFixed(1)}%`;
}

function formatLabel(value: string): string {
  return value.replace(/_/g, " ");
}

export function FailureBreakdownPanel({
  data,
  loading,
  error,
}: {
  data: RunFailureBreakdown | null;
  loading: boolean;
  error: string | null;
}) {
  const terminalRuns = data?.total_terminal ?? 0;
  const sampledRuns = data?.total_runs ?? 0;
  const hasActive = sampledRuns > terminalRuns;

  return (
    <section className="card" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 16 }}>Failure breakdown</div>
          <div className="muted" style={{ fontSize: 12 }}>
            Top failure categories and patterns across recent runs.
          </div>
        </div>
        {data && (
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <span className="badge">Success {formatPercent(data.success_rate)}</span>
            <span className="badge">Fail {formatPercent(data.failure_rate)}</span>
          </div>
        )}
      </div>

      {!!error && <div className="error">{error}</div>}
      {loading && <div className="muted">Loading breakdown...</div>}

      {!loading && data && (
        <div style={{ display: "grid", gap: 12 }}>
          <div style={{ fontSize: 12 }} className="muted">
            {data.total_failed} failed of {terminalRuns} terminal runs sampled
            {hasActive ? ` (${sampledRuns} total runs in window)` : ""}
          </div>
          <div style={{ display: "grid", gap: 8 }}>
            {data.categories.length === 0 && (
              <div className="muted" style={{ fontSize: 13 }}>
                No failed runs in sample.
              </div>
            )}
            {data.categories.map((entry) => (
              <div
                key={entry.category}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  fontSize: 13,
                }}
              >
                <span>{formatLabel(entry.category)}</span>
                <span>
                  {entry.count} / {formatPercent(entry.percent)}
                </span>
              </div>
            ))}
          </div>
          <div style={{ display: "grid", gap: 6 }}>
            <div style={{ fontWeight: 600, fontSize: 13 }}>Top patterns</div>
            {data.top_patterns.length === 0 && (
              <div className="muted" style={{ fontSize: 13 }}>
                No failure patterns yet.
              </div>
            )}
            {data.top_patterns.map((pattern) => (
              <div
                key={`${pattern.category}-${pattern.pattern}`}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  fontSize: 12,
                }}
              >
                <span>
                  {formatLabel(pattern.pattern)}{" "}
                  <span className="muted">({formatLabel(pattern.category)})</span>
                </span>
                <span>
                  {pattern.count} / {formatPercent(pattern.percent)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
