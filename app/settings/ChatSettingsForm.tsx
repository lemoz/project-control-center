"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type ProviderName = "codex" | "claude_code" | "gemini_cli";

type ProviderSettings = {
  provider: ProviderName;
  model: string;
  cliPath: string;
};

type ChatSettingsResponse = {
  saved: ProviderSettings;
  effective: ProviderSettings;
  env_overrides: {
    chat_codex_model?: string;
    chat_codex_path?: string;
  };
  error?: string;
};

const PROVIDERS: Array<{ value: ProviderName; label: string; enabled: boolean }> = [
  { value: "codex", label: "Codex", enabled: true },
  { value: "claude_code", label: "Claude Code (soon)", enabled: false },
  { value: "gemini_cli", label: "Gemini CLI (soon)", enabled: false },
];

function emptySettings(): ProviderSettings {
  return { provider: "codex", model: "", cliPath: "" };
}

export function ChatSettingsForm() {
  const [saved, setSaved] = useState<ProviderSettings>(emptySettings());
  const [effective, setEffective] = useState<ProviderSettings>(emptySettings());
  const [env, setEnv] = useState<ChatSettingsResponse["env_overrides"]>({});
  const [draft, setDraft] = useState<ProviderSettings>(emptySettings());
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
      const res = await fetch("/api/chat/settings", { cache: "no-store" });
      const json = (await res.json().catch(() => null)) as ChatSettingsResponse | null;
      if (!res.ok) throw new Error(json?.error || "failed to load chat settings");
      setSaved(json?.saved || emptySettings());
      setDraft(json?.saved || emptySettings());
      setEffective(json?.effective || json?.saved || emptySettings());
      setEnv(json?.env_overrides || {});
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed to load chat settings");
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
      const res = await fetch("/api/chat/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      const json = (await res.json().catch(() => null)) as ChatSettingsResponse | null;
      if (!res.ok) throw new Error(json?.error || "failed to save chat settings");
      setSaved(json?.saved || draft);
      setDraft(json?.saved || draft);
      setEffective(json?.effective || json?.saved || draft);
      setEnv(json?.env_overrides || {});
      setNotice("Saved.");
      setTimeout(() => setNotice(null), 2500);
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed to save chat settings");
    } finally {
      setSaving(false);
    }
  }, [draft]);

  const chatEnvNote = useMemo(() => {
    const parts: string[] = [];
    if (env.chat_codex_model) parts.push("model");
    if (env.chat_codex_path) parts.push("cliPath");
    if (!parts.length) return null;
    return `Chat Codex ${parts.join(" + ")} overridden by env.`;
  }, [env.chat_codex_model, env.chat_codex_path]);

  return (
    <section className="card" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
        <div>
          <h2 style={{ margin: 0 }}>Chat Settings</h2>
          <div className="muted" style={{ fontSize: 13 }}>
            Provider + model used for Control Center chat runs.
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
          {!!chatEnvNote && (
            <div className="muted" style={{ fontSize: 12 }}>
              {chatEnvNote} (<code>CONTROL_CENTER_CHAT_CODEX_MODEL</code>, <code>CONTROL_CENTER_CHAT_CODEX_PATH</code>)
            </div>
          )}

          <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", alignItems: "start" }}>
            <div className="field" style={{ gap: 10 }}>
              <div style={{ fontWeight: 700 }}>Chat runner</div>

              <div className="field">
                <div className="fieldLabel muted">Provider</div>
                <select
                  className="select"
                  value={draft.provider}
                  onChange={(e) => setDraft((p) => ({ ...p, provider: e.target.value as ProviderName }))}
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
                  placeholder="codex"
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

