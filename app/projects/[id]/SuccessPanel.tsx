"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type SuccessMetric = {
  name: string;
  target: number | string;
  current?: number | string | null;
};

type ProjectSuccessResponse = {
  project: {
    id: string;
    name: string;
    success_criteria: string | null;
    success_metrics: SuccessMetric[];
  };
  error?: string;
};

type MetricProgress = {
  metric: SuccessMetric;
  progress: number | null;
  progressPercent: number | null;
  valueLabel: string;
  hasNumericCurrent: boolean;
};

function parseNumeric(value: number | string | null | undefined): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const match = trimmed.match(/^(\d+(?:\.\d+)?)\s*%?$/);
  if (!match) return null;
  const num = Number(match[1]);
  return Number.isFinite(num) ? num : null;
}

function formatMetricValue(value: number | string | null | undefined): string {
  if (value === null || value === undefined) return "n/a";
  return String(value);
}

export function SuccessPanel({ repoId }: { repoId: string }) {
  const [data, setData] = useState<ProjectSuccessResponse["project"] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/repos/${encodeURIComponent(repoId)}`, {
        cache: "no-store",
      });
      const json = (await res.json().catch(() => null)) as ProjectSuccessResponse | null;
      if (!res.ok) throw new Error(json?.error || "failed to load success criteria");
      setData(json?.project ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed to load success criteria");
    } finally {
      setLoading(false);
    }
  }, [repoId]);

  useEffect(() => {
    void load();
  }, [load]);

  const metrics = useMemo(() => data?.success_metrics ?? [], [data?.success_metrics]);
  const criteria = data?.success_criteria?.trim() || "";

  const metricProgress = useMemo<MetricProgress[]>(() => {
    return metrics.map((metric) => {
      const targetNumeric = parseNumeric(metric.target);
      const currentNumeric = parseNumeric(metric.current);
      const hasNumericCurrent = currentNumeric !== null;
      const hasNumericTarget = targetNumeric !== null;
      let progress: number | null = null;
      if (hasNumericTarget) {
        if (targetNumeric === 0) {
          progress = hasNumericCurrent ? (currentNumeric <= 0 ? 1 : 0) : 0;
        } else {
          progress = Math.max(0, Math.min(1, (currentNumeric ?? 0) / targetNumeric));
        }
      }
      const progressPercent = progress !== null ? Math.round(progress * 100) : null;
      const valueLabel = `${formatMetricValue(metric.current)} / ${formatMetricValue(
        metric.target
      )}`;
      return {
        metric,
        progress,
        progressPercent,
        valueLabel,
        hasNumericCurrent,
      };
    });
  }, [metrics]);

  const overall = useMemo(() => {
    const values = metricProgress
      .map((m) => m.progress)
      .filter((v): v is number => v !== null);
    if (!values.length) return { value: null, count: 0 };
    const sum = values.reduce((acc, v) => acc + v, 0);
    return { value: Math.max(0, Math.min(1, sum / values.length)), count: values.length };
  }, [metricProgress]);

  const overallProgress = overall.value;
  const overallCount = overall.count;

  return (
    <section className="card" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
        <div>
          <h2 style={{ margin: 0 }}>Success Criteria</h2>
          <div className="muted" style={{ fontSize: 13 }}>
            Define the north star for this project and track progress toward it.
          </div>
        </div>
        <button className="btnSecondary" onClick={() => void load()} disabled={loading}>
          Refresh
        </button>
      </div>

      {!!error && <div className="error">{error}</div>}
      {loading && <div className="muted">Loading...</div>}

      {!loading && (
        <>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div className="fieldLabel muted">Criteria (Markdown)</div>
            {criteria ? (
              <div
                style={{
                  whiteSpace: "pre-wrap",
                  background: "#0f1320",
                  border: "1px solid #22293a",
                  borderRadius: 10,
                  padding: 12,
                  lineHeight: 1.5,
                }}
              >
                {criteria}
              </div>
            ) : (
              <div className="muted" style={{ fontSize: 13 }}>
                No success criteria yet. Ask the chat agent to draft a clear success definition.
              </div>
            )}
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ fontWeight: 700 }}>Progress to success</div>

            {overallProgress !== null && (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <div className="progressTrack">
                  <div
                    className="progressFill"
                    style={{ width: `${Math.round(overallProgress * 100)}%` }}
                  />
                </div>
                <div className="muted" style={{ fontSize: 12 }}>
                  {Math.round(overallProgress * 100)}% across {overallCount} metrics
                </div>
              </div>
            )}

            {!metrics.length && (
              <div className="muted" style={{ fontSize: 13 }}>
                No success metrics yet. Add measurable KPIs to track progress.
              </div>
            )}

            {!!metrics.length && (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {metricProgress.map((item, index) => (
                  <div
                    key={`${item.metric.name}-${index}`}
                    style={{
                      border: "1px solid #22293a",
                      borderRadius: 10,
                      padding: 10,
                      background: "#0f1320",
                      display: "flex",
                      flexDirection: "column",
                      gap: 6,
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                      <div style={{ fontWeight: 600 }}>{item.metric.name}</div>
                      <div className="muted" style={{ fontSize: 12 }}>
                        {item.valueLabel}
                      </div>
                    </div>
                    {item.progress !== null ? (
                      <>
                        <div className="progressTrack">
                          <div
                            className="progressFill"
                            style={{ width: `${item.progressPercent ?? 0}%` }}
                          />
                        </div>
                        <div className="muted" style={{ fontSize: 12 }}>
                          {item.progressPercent ?? 0}%{item.hasNumericCurrent ? "" : " (current not set)"}
                        </div>
                      </>
                    ) : (
                      <div className="muted" style={{ fontSize: 12 }}>
                        Add numeric targets to compute progress.
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
}
