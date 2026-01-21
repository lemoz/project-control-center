"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type UtilityProviderName = "codex" | "claude_cli";

type UtilitySettings = {
  provider: UtilityProviderName;
  model: string;
  cliPath: string;
};

type UtilitySettingsResponse = {
  saved: UtilitySettings;
  effective: UtilitySettings;
  env_overrides: {
    utility_provider?: UtilityProviderName;
    utility_model?: string;
  };
  error?: string;
};

const PROVIDERS: Array<{ value: UtilityProviderName; label: string }> = [
  { value: "codex", label: "Codex" },
  { value: "claude_cli", label: "Claude CLI" },
];

function emptySettings(): UtilitySettings {
  return { provider: "codex", model: "", cliPath: "" };
}

export function UtilitySettingsForm() {
  const [saved, setSaved] = useState<UtilitySettings>(emptySettings());
  const [effective, setEffective] = useState<UtilitySettings>(emptySettings());
  const [env, setEnv] = useState<UtilitySettingsResponse["env_overrides"]>({});
  const [draft, setDraft] = useState<UtilitySettings>(emptySettings());
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
      const res = await fetch("/api/settings/utility", { cache: "no-store" });
      const json = (await res.json().catch(() => null)) as UtilitySettingsResponse | null;
      if (!res.ok) throw new Error(json?.error || "failed to load utility settings");
      setSaved(json?.saved || emptySettings());
      setDraft(json?.saved || emptySettings());
      setEffective(json?.effective || json?.saved || emptySettings());
      setEnv(json?.env_overrides || {});
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed to load utility settings");
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
      const res = await fetch("/api/settings/utility", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      const json = (await res.json().catch(() => null)) as UtilitySettingsResponse | null;
      if (!res.ok) throw new Error(json?.error || "failed to save utility settings");
      setSaved(json?.saved || draft);
      setDraft(json?.saved || draft);
      setEffective(json?.effective || json?.saved || draft);
      setEnv(json?.env_overrides || {});
      setNotice("Saved.");
      setTimeout(() => setNotice(null), 2500);
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed to save utility settings");
    } finally {
      setSaving(false);
    }
  }, [draft]);

  const utilityEnvNote = useMemo(() => {
    const parts: string[] = [];
    if (env.utility_provider) parts.push("provider");
    if (env.utility_model) parts.push("model");
    if (!parts.length) return null;
    return `Utility settings ${parts.join(" + ")} overridden by env.`;
  }, [env.utility_model, env.utility_provider]);

  return (
    <section className="card" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
        <div>
          <h2 style={{ margin: 0 }}>Utility Tasks (WO Generation, Handoffs)</h2>
          <div className="muted" style={{ fontSize: 13 }}>
            Provider + model used for work order generation and handoff summaries.
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
          {!!utilityEnvNote && (
            <div className="muted" style={{ fontSize: 12 }}>
              {utilityEnvNote} (<code>CONTROL_CENTER_UTILITY_PROVIDER</code>, <code>CONTROL_CENTER_UTILITY_MODEL</code>)
            </div>
          )}

          <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", alignItems: "start" }}>
            <div className="field" style={{ gap: 10 }}>
              <div style={{ fontWeight: 700 }}>WO generation + handoffs</div>

              <div className="field">
                <div className="fieldLabel muted">Provider</div>
                <select
                  className="select"
                  value={draft.provider}
                  onChange={(e) => setDraft((p) => ({ ...p, provider: e.target.value as UtilityProviderName }))}
                >
                  {PROVIDERS.map((p) => (
                    <option key={p.value} value={p.value}>
                      {p.label}
                    </option>
                  ))}
                </select>
                {effective.provider !== saved.provider && (
                  <div className="muted" style={{ fontSize: 12 }}>
                    Effective: <code>{effective.provider}</code>
                  </div>
                )}
              </div>

              <div className="field">
                <div className="fieldLabel muted">Model</div>
                <input
                  className="input"
                  value={draft.model}
                  placeholder="(blank = provider default)"
                  onChange={(e) => setDraft((p) => ({ ...p, model: e.target.value }))}
                />
                {effective.model && effective.model !== saved.model && (
                  <div className="muted" style={{ fontSize: 12 }}>
                    Effective: <code>{effective.model}</code>
                  </div>
                )}
              </div>

              <div className="field">
                <div className="fieldLabel muted">CLI path (optional)</div>
                <input
                  className="input"
                  value={draft.cliPath}
                  placeholder={draft.provider === "claude_cli" ? "claude" : "codex"}
                  onChange={(e) => setDraft((p) => ({ ...p, cliPath: e.target.value }))}
                />
                {effective.cliPath && effective.cliPath !== saved.cliPath && (
                  <div className="muted" style={{ fontSize: 12 }}>
                    Effective: <code>{effective.cliPath}</code>
                  </div>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
