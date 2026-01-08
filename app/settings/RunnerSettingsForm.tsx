"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type ProviderName = "codex" | "claude_code" | "gemini_cli";

type ProviderSettings = {
  provider: ProviderName;
  model: string;
  cliPath: string;
};

type RunnerSettings = {
  builder: ProviderSettings;
  reviewer: ProviderSettings;
  useWorktree: boolean;
  maxBuilderIterations: number;
};

type SettingsResponse = {
  saved: RunnerSettings;
  effective: RunnerSettings;
  env_overrides: {
    codex_model?: string;
    codex_path?: string;
    max_builder_iterations?: number;
  };
  error?: string;
};

const PROVIDERS: Array<{ value: ProviderName; label: string; enabled: boolean }> = [
  { value: "codex", label: "Codex", enabled: true },
  { value: "claude_code", label: "Claude Code (soon)", enabled: false },
  { value: "gemini_cli", label: "Gemini CLI (soon)", enabled: false },
];

function emptySettings(): RunnerSettings {
  return {
    builder: { provider: "codex", model: "", cliPath: "" },
    reviewer: { provider: "codex", model: "", cliPath: "" },
    useWorktree: true,
    maxBuilderIterations: 10,
  };
}

export function RunnerSettingsForm() {
  const [saved, setSaved] = useState<RunnerSettings>(emptySettings());
  const [effective, setEffective] = useState<RunnerSettings>(emptySettings());
  const [env, setEnv] = useState<SettingsResponse["env_overrides"]>({});
  const [draft, setDraft] = useState<RunnerSettings>(emptySettings());
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
      const res = await fetch("/api/settings", { cache: "no-store" });
      const json = (await res.json().catch(() => null)) as SettingsResponse | null;
      if (!res.ok) throw new Error(json?.error || "failed to load settings");
      setSaved(json?.saved || emptySettings());
      setDraft(json?.saved || emptySettings());
      setEffective(json?.effective || json?.saved || emptySettings());
      setEnv(json?.env_overrides || {});
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed to load settings");
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
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      const json = (await res.json().catch(() => null)) as SettingsResponse | null;
      if (!res.ok) throw new Error(json?.error || "failed to save settings");
      setSaved(json?.saved || draft);
      setDraft(json?.saved || draft);
      setEffective(json?.effective || json?.saved || draft);
      setEnv(json?.env_overrides || {});
      setNotice("Saved.");
      setTimeout(() => setNotice(null), 2500);
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed to save settings");
    } finally {
      setSaving(false);
    }
  }, [draft]);

  const update = useCallback(
    (role: "builder" | "reviewer", patch: Partial<ProviderSettings>) => {
      setDraft((prev) => ({
        ...prev,
        [role]: {
          ...prev[role],
          ...patch,
        },
      }));
    },
    []
  );

  const codexEnvNote = useMemo(() => {
    const parts: string[] = [];
    if (env.codex_model) parts.push("model");
    if (env.codex_path) parts.push("cliPath");
    if (!parts.length) return null;
    return `Codex ${parts.join(" + ")} overridden by env.`;
  }, [env.codex_model, env.codex_path]);

  const maxIterationsEnvNote = useMemo(() => {
    if (!env.max_builder_iterations) return null;
    return `Max builder iterations overridden by env.`;
  }, [env.max_builder_iterations]);

  return (
    <section className="card" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
        <div>
          <h2 style={{ margin: 0 }}>Settings</h2>
          <div className="muted" style={{ fontSize: 13 }}>
            Choose the provider + model used for Builder/Reviewer runs.
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
          {!!codexEnvNote && (
            <div className="muted" style={{ fontSize: 12 }}>
              {codexEnvNote} (`CONTROL_CENTER_CODEX_MODEL` / `CODEX_MODEL`, `CONTROL_CENTER_CODEX_PATH`)
            </div>
          )}
          {!!maxIterationsEnvNote && (
            <div className="muted" style={{ fontSize: 12 }}>
              {maxIterationsEnvNote} (`CONTROL_CENTER_MAX_BUILDER_ITERATIONS`)
            </div>
          )}

          <div className="field">
            <div className="fieldLabel muted">Worktree isolation</div>
            <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                type="checkbox"
                checked={draft.useWorktree}
                onChange={(e) =>
                  setDraft((prev) => ({ ...prev, useWorktree: e.target.checked }))
                }
              />
              <span>Run builder in an isolated git worktree</span>
            </label>
            <div className="muted" style={{ fontSize: 12 }}>
              Disable to fall back to the legacy direct-to-repo flow.
            </div>
          </div>

          <div className="field">
            <div className="fieldLabel muted">Max builder iterations</div>
            <input
              className="input"
              type="number"
              min={1}
              max={20}
              value={draft.maxBuilderIterations}
              onChange={(e) =>
                setDraft((prev) => ({
                  ...prev,
                  maxBuilderIterations: Math.max(1, Math.min(20, Math.trunc(Number(e.target.value) || 1))),
                }))
              }
            />
            {effective.maxBuilderIterations !== saved.maxBuilderIterations && (
              <div className="muted" style={{ fontSize: 12 }}>
                Effective: <code>{effective.maxBuilderIterations}</code>
              </div>
            )}
            <div className="muted" style={{ fontSize: 12 }}>
              Caps test-failure retries before the run is marked failed.
            </div>
          </div>

          <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", alignItems: "start" }}>
            {(["builder", "reviewer"] as const).map((role) => (
              <div key={role} className="field" style={{ gap: 10 }}>
                <div style={{ fontWeight: 700, textTransform: "capitalize" }}>{role}</div>

                <div className="field">
                  <div className="fieldLabel muted">Provider</div>
                  <select
                    className="select"
                    value={draft[role].provider}
                    onChange={(e) => update(role, { provider: e.target.value as ProviderName })}
                  >
                    {PROVIDERS.map((p) => (
                      <option key={p.value} value={p.value} disabled={!p.enabled}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                  <div className="muted" style={{ fontSize: 12 }}>
                    v0 supports Codex only (other providers are placeholders).
                  </div>
                </div>

                <div className="field">
                  <div className="fieldLabel muted">Model</div>
                  <input
                    className="input"
                    value={draft[role].model}
                    placeholder="(blank = provider default)"
                    onChange={(e) => update(role, { model: e.target.value })}
                  />
                  {effective[role].model && effective[role].model !== saved[role].model && (
                    <div className="muted" style={{ fontSize: 12 }}>
                      Effective: <code>{effective[role].model}</code>
                    </div>
                  )}
                </div>

                <div className="field">
                  <div className="fieldLabel muted">CLI path (optional)</div>
                  <input
                    className="input"
                    value={draft[role].cliPath}
                    placeholder="codex"
                    onChange={(e) => update(role, { cliPath: e.target.value })}
                  />
                  {effective[role].cliPath && effective[role].cliPath !== saved[role].cliPath && (
                    <div className="muted" style={{ fontSize: 12 }}>
                      Effective: <code>{effective[role].cliPath}</code>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>

          <details>
            <summary className="muted" style={{ cursor: "pointer" }}>
              Per-repo overrides (hook)
            </summary>
            <div className="muted" style={{ fontSize: 12, marginTop: 10, lineHeight: 1.4 }}>
              Add a <code>runner</code> block to a repo’s <code>.control.yml</code> to override global settings. Example:
              <pre style={{ margin: "10px 0 0", whiteSpace: "pre-wrap" }}>{`runner:
  builder:
    provider: codex
    model: ""
  reviewer:
    provider: codex
    model: ""`}</pre>
            </div>
          </details>
        </>
      )}
    </section>
  );
}
