"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type CostSummary = {
  project_id: string;
  period: "day" | "week" | "month" | "all_time";
  total_cost_usd: number;
  cost_by_category: Record<string, number>;
  run_count: number;
  avg_cost_per_run: number;
  token_totals: { input: number; output: number };
};

type CostHistoryResponse = {
  daily: Array<{ date: string; total_cost_usd: number; breakdown: Record<string, number> }>;
};

const CATEGORY_LABELS: Array<{ key: string; label: string }> = [
  { key: "builder", label: "Builder" },
  { key: "reviewer", label: "Reviewer" },
  { key: "chat", label: "Chat" },
  { key: "handoff", label: "Handoff" },
  { key: "other", label: "Other" },
];

function formatUsd(value: number): string {
  const safe = Number.isFinite(value) ? value : 0;
  return `$${safe.toFixed(2)}`;
}

export function CostPanel({ repoId }: { repoId: string }) {
  const [summary, setSummary] = useState<CostSummary | null>(null);
  const [history, setHistory] = useState<CostHistoryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const summaryRes = await fetch(
        `/api/projects/${encodeURIComponent(repoId)}/costs?period=month`,
        { cache: "no-store" }
      );
      const summaryJson = (await summaryRes.json().catch(() => null)) as CostSummary | null;
      if (!summaryRes.ok) {
        throw new Error(
          (summaryJson as { error?: string } | null)?.error || "failed to load costs"
        );
      }
      const historyRes = await fetch(
        `/api/projects/${encodeURIComponent(repoId)}/costs/history?days=30`,
        { cache: "no-store" }
      );
      const historyJson = (await historyRes.json().catch(() => null)) as CostHistoryResponse | null;
      if (!historyRes.ok) {
        throw new Error(
          (historyJson as { error?: string } | null)?.error || "failed to load cost history"
        );
      }
      setSummary(summaryJson);
      setHistory(historyJson);
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed to load cost data");
    } finally {
      setLoading(false);
    }
  }, [repoId]);

  useEffect(() => {
    void load();
  }, [load]);

  const recentHistory = useMemo(() => {
    const days = history?.daily ?? [];
    return days.slice(-14);
  }, [history]);

  const maxDayCost = useMemo(() => {
    return recentHistory.reduce((max, day) => Math.max(max, day.total_cost_usd), 0);
  }, [recentHistory]);

  return (
    <section className="card" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
        <div>
          <h2 style={{ margin: 0 }}>Costs (This Month)</h2>
          <div className="muted" style={{ fontSize: 13 }}>
            Actual spend based on token usage across runs and chats.
          </div>
        </div>
        <button className="btnSecondary" onClick={() => void load()} disabled={loading}>
          Refresh
        </button>
      </div>

      {!!error && <div className="error">{error}</div>}
      {loading && <div className="muted">Loading...</div>}

      {!loading && summary && (
        <>
          <div
            style={{
              border: "1px solid #22293a",
              borderRadius: 12,
              padding: 14,
              background: "#0f1320",
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            <div style={{ fontSize: 16, fontWeight: 700 }}>
              Total: {formatUsd(summary.total_cost_usd)}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {CATEGORY_LABELS.map((category) => (
                <div key={category.key} style={{ display: "flex", justifyContent: "space-between" }}>
                  <span className="muted">{category.label}</span>
                  <span>{formatUsd(summary.cost_by_category?.[category.key] ?? 0)}</span>
                </div>
              ))}
            </div>
            <div className="muted" style={{ fontSize: 12 }}>
              Runs: {summary.run_count} | Avg: {formatUsd(summary.avg_cost_per_run)}/run
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ fontWeight: 600 }}>Recent cost history</div>
            {recentHistory.length === 0 ? (
              <div className="muted" style={{ fontSize: 13 }}>
                No cost records yet.
              </div>
            ) : (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: `repeat(${recentHistory.length}, minmax(0, 1fr))`,
                  gap: 6,
                  alignItems: "end",
                  height: 90,
                  padding: "4px 2px",
                }}
              >
                {recentHistory.map((day) => {
                  const height = maxDayCost > 0 ? Math.max(4, (day.total_cost_usd / maxDayCost) * 80) : 4;
                  return (
                    <div key={day.date} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                      <div
                        style={{
                          width: "100%",
                          height,
                          borderRadius: 6,
                          background: day.total_cost_usd > 0 ? "#2f7dd1" : "#1f2433",
                          transition: "height 0.2s ease",
                        }}
                        title={`${day.date}: ${formatUsd(day.total_cost_usd)}`}
                      />
                      <div className="muted" style={{ fontSize: 10 }}>
                        {day.date.slice(5)}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
}
