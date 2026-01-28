"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type AutopilotPolicy = {
  enabled: boolean;
  max_concurrent_runs: number;
  allowed_tags: string[] | null;
  min_priority: number | null;
  stop_on_failure_count: number;
  schedule_cron: string | null;
};

type AutopilotStatus = {
  state: "disabled" | "paused" | "running" | "idle";
  enabled: boolean;
  failure_count: number;
  stop_on_failure_count: number;
  active_run: {
    id: string;
    work_order_id: string;
    status: string;
    created_at: string;
  } | null;
  blocked_reason: string | null;
};

type AutopilotCandidate = {
  id: string;
  title: string;
  priority: number;
  tags: string[];
  updated_at: string;
  depends_on: string[];
};

type AutopilotActivity = {
  run_id: string;
  work_order_id: string;
  status: string;
  created_at: string;
};

type AutopilotSnapshot = {
  policy: AutopilotPolicy;
  status: AutopilotStatus;
  next_candidate: AutopilotCandidate | null;
  recent_activity: AutopilotActivity[];
};

function formatTimestamp(value: string): string {
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return value;
  return new Date(ms).toLocaleString();
}

export function AutopilotPanel({ repoId }: { repoId: string }) {
  const [snapshot, setSnapshot] = useState<AutopilotSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(repoId)}/autopilot`, {
        cache: "no-store",
      });
      const json = (await res.json().catch(() => null)) as AutopilotSnapshot | null;
      if (!res.ok) throw new Error((json as { error?: string } | null)?.error || "failed");
      if (!json) throw new Error("invalid response");
      setSnapshot(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed to load autopilot");
    } finally {
      setLoading(false);
    }
  }, [repoId]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggle = useCallback(
    async (next: boolean) => {
      setSaving(true);
      setError(null);
      setNotice(null);
      try {
        const res = await fetch(`/api/projects/${encodeURIComponent(repoId)}/autopilot`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enabled: next }),
        });
        const json = (await res.json().catch(() => null)) as AutopilotSnapshot | null;
        if (!res.ok) throw new Error((json as { error?: string } | null)?.error || "failed");
        if (json) {
          setSnapshot(json);
        } else {
          await load();
        }
        setNotice("Saved.");
        setTimeout(() => setNotice(null), 2000);
      } catch (e) {
        setError(e instanceof Error ? e.message : "failed to update autopilot");
      } finally {
        setSaving(false);
      }
    },
    [load, repoId]
  );

  const statusLabel = useMemo(() => {
    switch (snapshot?.status.state) {
      case "running":
        return "Running";
      case "paused":
        return "Paused on failures";
      case "disabled":
        return "Disabled";
      default:
        return "Idle";
    }
  }, [snapshot?.status.state]);

  const statusDetail = useMemo(() => {
    const status = snapshot?.status;
    if (!status) return "";
    if (status.blocked_reason === "failure_limit") {
      return `Paused after ${status.failure_count}/${status.stop_on_failure_count} failures.`;
    }
    if (status.blocked_reason === "active_run" && status.active_run) {
      return `Active run ${status.active_run.work_order_id} (${status.active_run.status}).`;
    }
    return "";
  }, [snapshot?.status]);

  const enabled = snapshot?.policy.enabled ?? false;
  const nextCandidate = snapshot?.next_candidate;
  const recentActivity = snapshot?.recent_activity ?? [];

  return (
    <section className="card" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
        <div>
          <h2 style={{ margin: 0 }}>Autopilot</h2>
          <div className="muted" style={{ fontSize: 13 }}>
            Run Ready work orders automatically when policy allows.
          </div>
        </div>
        <button className="btnSecondary" onClick={() => void load()} disabled={loading || saving}>
          Refresh
        </button>
      </div>

      {!!error && <div className="error">{error}</div>}
      {!!notice && <div className="badge">{notice}</div>}
      {loading && <div className="muted">Loading...</div>}

      {!loading && snapshot && (
        <>
          <div className="field">
            <div className="fieldLabel muted">Autopilot</div>
            <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                type="checkbox"
                checked={enabled}
                disabled={saving}
                onChange={(e) => void toggle(e.target.checked)}
              />
              <span>{enabled ? "Enabled" : "Disabled"}</span>
            </label>
          </div>

          <div className="field">
            <div className="fieldLabel muted">Status</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <span className="badge">{statusLabel}</span>
              {statusDetail && <span className="muted" style={{ fontSize: 12 }}>{statusDetail}</span>}
            </div>
          </div>

          <div className="field">
            <div className="fieldLabel muted">Next candidate</div>
            {nextCandidate ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <div style={{ fontWeight: 600 }}>
                  {nextCandidate.id} - p{nextCandidate.priority}
                </div>
                <div className="muted" style={{ fontSize: 13 }}>
                  {nextCandidate.title}
                </div>
                {nextCandidate.tags.length > 0 && (
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {nextCandidate.tags.slice(0, 4).map((tag) => (
                      <span key={tag} className="badge">
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="muted">No eligible work orders.</div>
            )}
          </div>

          <div className="field">
            <div className="fieldLabel muted">Recent autopilot activity</div>
            {recentActivity.length === 0 && <div className="muted">No autopilot runs yet.</div>}
            {recentActivity.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {recentActivity.slice(0, 5).map((entry) => (
                  <div key={entry.run_id} style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <span className="badge">{entry.status}</span>
                    <span className="muted" style={{ fontSize: 12 }}>
                      {entry.work_order_id} - {formatTimestamp(entry.created_at)}
                    </span>
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
