"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type ShiftSchedulerSettings = {
  enabled: boolean;
  interval_minutes: number;
  cooldown_minutes: number;
  max_shifts_per_day: number;
  quiet_hours_start: string;
  quiet_hours_end: string;
};

type ShiftSchedulerActivity = {
  timestamp: string;
  message: string;
  project_id?: string;
};

type ShiftSchedulerStatus = {
  state: "running" | "paused";
  enabled: boolean;
  last_check_at: string | null;
  next_check_at: string | null;
  recent_activity: ShiftSchedulerActivity[];
};

type ShiftSchedulerResponse = {
  settings: ShiftSchedulerSettings;
  status: ShiftSchedulerStatus;
  error?: string;
};

function emptySettings(): ShiftSchedulerSettings {
  return {
    enabled: false,
    interval_minutes: 120,
    cooldown_minutes: 30,
    max_shifts_per_day: 6,
    quiet_hours_start: "02:00",
    quiet_hours_end: "06:00",
  };
}

function emptyStatus(): ShiftSchedulerStatus {
  return {
    state: "paused",
    enabled: false,
    last_check_at: null,
    next_check_at: null,
    recent_activity: [],
  };
}

function formatTimestamp(value: string | null | undefined): string {
  if (!value) return "n/a";
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return value;
  return new Date(ms).toLocaleString();
}

function clampNumber(value: string, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  const next = Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
  return Math.max(min, Math.min(max, next));
}

export function ShiftSchedulerSettingsForm() {
  const [saved, setSaved] = useState<ShiftSchedulerSettings>(emptySettings());
  const [draft, setDraft] = useState<ShiftSchedulerSettings>(emptySettings());
  const [status, setStatus] = useState<ShiftSchedulerStatus>(emptyStatus());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(saved), [draft, saved]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/settings/shift-scheduler", { cache: "no-store" });
      const json = (await res.json().catch(() => null)) as ShiftSchedulerResponse | null;
      if (!res.ok) throw new Error(json?.error || "failed to load shift scheduler settings");
      const nextSettings = json?.settings || emptySettings();
      setSaved(nextSettings);
      setDraft(nextSettings);
      setStatus(json?.status || emptyStatus());
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed to load shift scheduler settings");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = useCallback(async () => {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/settings/shift-scheduler", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      const json = (await res.json().catch(() => null)) as ShiftSchedulerResponse | null;
      if (!res.ok) throw new Error(json?.error || "failed to save shift scheduler settings");
      const nextSettings = json?.settings || draft;
      setSaved(nextSettings);
      setDraft(nextSettings);
      setStatus(json?.status || status);
      setNotice("Saved.");
      setTimeout(() => setNotice(null), 2500);
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed to save shift scheduler settings");
    } finally {
      setSaving(false);
    }
  }, [draft, status]);

  return (
    <section className="card" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
        <div>
          <h2 style={{ margin: 0 }}>Shift Scheduler</h2>
          <div className="muted" style={{ fontSize: 13 }}>
            Automatically start shifts on a cadence so ready work orders keep moving.
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button className="btnSecondary" onClick={() => void load()} disabled={loading || saving}>
            Refresh
          </button>
          <button className="btn" onClick={() => void save()} disabled={loading || saving || !dirty}>
            {saving ? "Saving…" : dirty ? "Save" : "Saved"}
          </button>
        </div>
      </div>

      {!!error && <div className="error">{error}</div>}
      {!!notice && <div className="badge">{notice}</div>}
      {loading && <div className="muted">Loading…</div>}

      {!loading && (
        <>
          <div className="field">
            <div className="fieldLabel muted">Scheduler status</div>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              <div className="badge">{status.state === "running" ? "Running" : "Paused"}</div>
              <div className="muted" style={{ fontSize: 12 }}>
                Next check: {formatTimestamp(status.next_check_at)}
              </div>
              <div className="muted" style={{ fontSize: 12 }}>
                Last check: {formatTimestamp(status.last_check_at)}
              </div>
            </div>
            {status.recent_activity.length > 0 && (
              <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
                <div className="muted" style={{ fontSize: 12 }}>
                  Recent activity
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {status.recent_activity.slice(0, 6).map((entry, index) => (
                    <div
                      key={`${entry.timestamp}-${index}`}
                      style={{
                        border: "1px solid #22293a",
                        borderRadius: 10,
                        padding: "6px 10px",
                        background: "#0f1320",
                        fontSize: 12,
                      }}
                    >
                      <div className="muted" style={{ marginBottom: 2 }}>
                        {formatTimestamp(entry.timestamp)}
                      </div>
                      <div>{entry.message}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="field">
            <div className="fieldLabel muted">Scheduler toggle</div>
            <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                type="checkbox"
                checked={draft.enabled}
                onChange={(e) => setDraft((prev) => ({ ...prev, enabled: e.target.checked }))}
              />
              <span>Enable automated shift scheduling</span>
            </label>
          </div>

          <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", alignItems: "start" }}>
            <div className="field">
              <div className="fieldLabel muted">Interval (minutes)</div>
              <input
                className="input"
                type="number"
                min={1}
                max={1440}
                value={draft.interval_minutes}
                onChange={(e) =>
                  setDraft((prev) => ({
                    ...prev,
                    interval_minutes: clampNumber(e.target.value, prev.interval_minutes, 1, 1440),
                  }))
                }
              />
              <div className="muted" style={{ fontSize: 12 }}>
                Minimum time between shifts for the same project.
              </div>
            </div>

            <div className="field">
              <div className="fieldLabel muted">Cooldown (minutes)</div>
              <input
                className="input"
                type="number"
                min={0}
                max={1440}
                value={draft.cooldown_minutes}
                onChange={(e) =>
                  setDraft((prev) => ({
                    ...prev,
                    cooldown_minutes: clampNumber(e.target.value, prev.cooldown_minutes, 0, 1440),
                  }))
                }
              />
              <div className="muted" style={{ fontSize: 12 }}>
                Wait time after a shift completes before starting the next.
              </div>
            </div>

            <div className="field">
              <div className="fieldLabel muted">Max shifts per day</div>
              <input
                className="input"
                type="number"
                min={1}
                max={48}
                value={draft.max_shifts_per_day}
                onChange={(e) =>
                  setDraft((prev) => ({
                    ...prev,
                    max_shifts_per_day: clampNumber(e.target.value, prev.max_shifts_per_day, 1, 48),
                  }))
                }
              />
              <div className="muted" style={{ fontSize: 12 }}>
                Caps automatic shifts per project per day.
              </div>
            </div>

            <div className="field">
              <div className="fieldLabel muted">Quiet hours</div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input
                  className="input"
                  type="time"
                  value={draft.quiet_hours_start}
                  onChange={(e) =>
                    setDraft((prev) => ({ ...prev, quiet_hours_start: e.target.value }))
                  }
                />
                <span className="muted">to</span>
                <input
                  className="input"
                  type="time"
                  value={draft.quiet_hours_end}
                  onChange={(e) =>
                    setDraft((prev) => ({ ...prev, quiet_hours_end: e.target.value }))
                  }
                />
              </div>
              <div className="muted" style={{ fontSize: 12 }}>
                Scheduler will avoid starting new shifts during quiet hours.
              </div>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
