"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type AgentMonitoringSettings = {
  builder: {
    networkAccess: "sandboxed" | "whitelist";
    monitorEnabled: boolean;
    autoKillOnThreat: boolean;
  };
  reviewer: {
    networkAccess: "sandboxed";
    monitorEnabled: boolean;
    autoKillOnThreat: boolean;
  };
  shift_agent: {
    networkAccess: "full";
    monitorEnabled: boolean;
    autoKillOnThreat: boolean;
  };
  global_agent: {
    networkAccess: "full";
    monitorEnabled: boolean;
    autoKillOnThreat: boolean;
  };
};

type AgentMonitoringSettingsResponse = {
  settings: AgentMonitoringSettings;
  error?: string;
};

type AgentKey = keyof AgentMonitoringSettings;

function emptySettings(): AgentMonitoringSettings {
  return {
    builder: {
      networkAccess: "sandboxed",
      monitorEnabled: true,
      autoKillOnThreat: true,
    },
    reviewer: {
      networkAccess: "sandboxed",
      monitorEnabled: true,
      autoKillOnThreat: true,
    },
    shift_agent: {
      networkAccess: "full",
      monitorEnabled: true,
      autoKillOnThreat: true,
    },
    global_agent: {
      networkAccess: "full",
      monitorEnabled: true,
      autoKillOnThreat: true,
    },
  };
}

const AGENT_LABELS: Record<AgentKey, string> = {
  builder: "Builder",
  reviewer: "Reviewer",
  shift_agent: "Shift agent",
  global_agent: "Global agent",
};

export function AgentMonitoringSettingsForm() {
  const [saved, setSaved] = useState<AgentMonitoringSettings>(emptySettings());
  const [draft, setDraft] = useState<AgentMonitoringSettings>(emptySettings());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const dirty = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(saved),
    [draft, saved]
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/settings/agent-monitoring", {
        cache: "no-store",
      });
      const json = (await res
        .json()
        .catch(() => null)) as AgentMonitoringSettingsResponse | null;
      if (!res.ok) {
        throw new Error(json?.error || "failed to load agent monitoring settings");
      }
      const nextSettings = json?.settings || emptySettings();
      setSaved(nextSettings);
      setDraft(nextSettings);
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed to load agent monitoring settings");
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
      const res = await fetch("/api/settings/agent-monitoring", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      const json = (await res
        .json()
        .catch(() => null)) as AgentMonitoringSettingsResponse | null;
      if (!res.ok) {
        throw new Error(json?.error || "failed to save agent monitoring settings");
      }
      const nextSettings = json?.settings || draft;
      setSaved(nextSettings);
      setDraft(nextSettings);
      setNotice("Saved.");
      setTimeout(() => setNotice(null), 2500);
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed to save agent monitoring settings");
    } finally {
      setSaving(false);
    }
  }, [draft]);

  const updateAgent = useCallback(
    <K extends AgentKey>(agent: K, patch: Partial<AgentMonitoringSettings[K]>) => {
      setDraft((prev) => ({
        ...prev,
        [agent]: {
          ...prev[agent],
          ...patch,
        },
      }));
    },
    []
  );

  return (
    <section className="card" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
        <div>
          <h2 style={{ margin: 0 }}>Agent Monitoring</h2>
          <div className="muted" style={{ fontSize: 13 }}>
            Configure stream monitoring and auto-kill behavior per agent type.
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
        <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", alignItems: "start" }}>
          {(Object.keys(AGENT_LABELS) as AgentKey[]).map((agent) => (
            <div key={agent} className="field" style={{ gap: 10 }}>
              <div style={{ fontWeight: 700 }}>{AGENT_LABELS[agent]}</div>

              <div className="field">
                <div className="fieldLabel muted">Network access</div>
                {agent === "builder" ? (
                  <select
                    className="select"
                    value={draft.builder.networkAccess}
                    onChange={(e) =>
                      updateAgent("builder", {
                        networkAccess: e.target.value as AgentMonitoringSettings["builder"]["networkAccess"],
                      })
                    }
                  >
                    <option value="sandboxed">Sandboxed</option>
                    <option value="whitelist">Whitelist</option>
                  </select>
                ) : (
                  <div className="muted" style={{ fontSize: 13 }}>
                    {agent === "reviewer" ? "Sandboxed (fixed)" : "Full (fixed)"}
                  </div>
                )}
                {agent === "builder" && (
                  <div className="muted" style={{ fontSize: 12 }}>
                    Whitelist uses the domains configured below.
                  </div>
                )}
              </div>

              <div className="field">
                <div className="fieldLabel muted">Monitoring</div>
                <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <input
                    type="checkbox"
                    checked={draft[agent].monitorEnabled}
                    onChange={(e) => updateAgent(agent, { monitorEnabled: e.target.checked })}
                  />
                  <span>Enable stream monitoring</span>
                </label>
                <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <input
                    type="checkbox"
                    checked={draft[agent].autoKillOnThreat}
                    onChange={(e) => updateAgent(agent, { autoKillOnThreat: e.target.checked })}
                  />
                  <span>Auto-kill on threat verdict</span>
                </label>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
