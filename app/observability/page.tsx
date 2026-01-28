"use client";

import { useEffect, useMemo, useState } from "react";
import { ActiveRunsPanel } from "./components/ActiveRunsPanel";
import { AlertsBanner } from "./components/AlertsBanner";
import { BudgetPanel } from "./components/BudgetPanel";
import { FailureBreakdownPanel } from "./components/FailureBreakdownPanel";
import { LiveLogs } from "./components/LiveLogs";
import { RunTimeline } from "./components/RunTimeline";
import { SecurityIncidentsPanel } from "./components/SecurityIncidentsPanel";
import { VMHealthPanel } from "./components/VMHealthPanel";
import { useActiveRuns } from "./hooks/useActiveRuns";
import { useAlerts } from "./hooks/useAlerts";
import { useBudgetSummary } from "./hooks/useBudgetSummary";
import { useFailureBreakdown } from "./hooks/useFailureBreakdown";
import { useIncidentStats } from "./hooks/useIncidentStats";
import { useRunTimeline } from "./hooks/useRunTimeline";

const REFRESH_INTERVAL_MS = 30_000;
const TIMELINE_HOURS = 24;

function formatTime(value: Date | null): string {
  if (!value) return "never";
  return value.toLocaleTimeString();
}

export default function ObservabilityPage() {
  const [refreshToken, setRefreshToken] = useState(0);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);

  useEffect(() => {
    setLastRefresh(new Date());
  }, [refreshToken]);

  useEffect(() => {
    const interval = setInterval(() => {
      setRefreshToken((prev) => prev + 1);
    }, REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

  const activeRuns = useActiveRuns(refreshToken);
  const budget = useBudgetSummary(refreshToken);
  const failures = useFailureBreakdown(refreshToken);
  const timeline = useRunTimeline(refreshToken, TIMELINE_HOURS);
  const alerts = useAlerts(refreshToken);
  const incidents = useIncidentStats(refreshToken);

  useEffect(() => {
    if (!activeRuns.data.length) {
      setSelectedRunId(null);
      return;
    }
    if (!selectedRunId || !activeRuns.data.some((run) => run.id === selectedRunId)) {
      setSelectedRunId(activeRuns.data[0]?.id ?? null);
    }
  }, [activeRuns.data, selectedRunId]);

  const refreshLabel = useMemo(() => formatTime(lastRefresh), [lastRefresh]);

  return (
    <main style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <section className="card" style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 18 }}>PCC Observability</div>
          <div className="muted" style={{ fontSize: 12 }}>
            Auto-refresh every 30 seconds - last refresh {refreshLabel}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span className="badge">Auto-refresh: ON</span>
          <button className="btnSecondary" onClick={() => setRefreshToken((prev) => prev + 1)}>
            Refresh now
          </button>
        </div>
      </section>

      <section className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))" }}>
        <VMHealthPanel />
        <BudgetPanel data={budget.data} loading={budget.loading} error={budget.error} />
        <FailureBreakdownPanel data={failures.data} loading={failures.loading} error={failures.error} />
        <SecurityIncidentsPanel
          data={incidents.data}
          loading={incidents.loading}
          error={incidents.error}
        />
        <ActiveRunsPanel
          data={activeRuns.data}
          loading={activeRuns.loading}
          error={activeRuns.error}
          onSelectRun={(runId) => setSelectedRunId(runId)}
        />
      </section>

      <RunTimeline data={timeline.data} loading={timeline.loading} error={timeline.error} hours={TIMELINE_HOURS} />
      <AlertsBanner data={alerts.data} loading={alerts.loading} error={alerts.error} />
      <LiveLogs runs={activeRuns.data} selectedRunId={selectedRunId} onSelectRun={setSelectedRunId} />
    </main>
  );
}
