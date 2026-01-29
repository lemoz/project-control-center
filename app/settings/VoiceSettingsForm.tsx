"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type VoiceStatus = {
  available: boolean;
  reason?: string;
  source: "env" | "settings" | "mixed" | "missing";
  mode: "local" | "cloud";
  apiKeyConfigured: boolean;
  agentIdConfigured: boolean;
  apiKeySource?: "env" | "settings";
  agentIdSource?: "env" | "settings";
};

type VoiceSettingsResponse = {
  saved: {
    apiKeyConfigured: boolean;
    agentId: string;
  };
  effective: VoiceStatus;
  env_overrides: {
    apiKey?: boolean;
    agentId?: boolean;
  };
  error?: string;
};

export function VoiceSettingsForm() {
  const [saved, setSaved] = useState<VoiceSettingsResponse["saved"]>({
    apiKeyConfigured: false,
    agentId: "",
  });
  const [effective, setEffective] = useState<VoiceStatus>({
    available: false,
    source: "missing",
    mode: "local",
    apiKeyConfigured: false,
    agentIdConfigured: false,
  });
  const [env, setEnv] = useState<VoiceSettingsResponse["env_overrides"]>({});
  const [draftApiKey, setDraftApiKey] = useState("");
  const [draftAgentId, setDraftAgentId] = useState("");
  const [clearApiKey, setClearApiKey] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showKey, setShowKey] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/settings/voice", { cache: "no-store" });
      const json = (await res.json().catch(() => null)) as VoiceSettingsResponse | null;
      if (!res.ok) throw new Error(json?.error || "failed to load voice settings");
      const nextSaved = json?.saved ?? { apiKeyConfigured: false, agentId: "" };
      setSaved(nextSaved);
      setEffective(
        json?.effective ?? {
          available: false,
          source: "missing",
          mode: "local",
          apiKeyConfigured: false,
          agentIdConfigured: false,
        }
      );
      setEnv(json?.env_overrides ?? {});
      setDraftAgentId(nextSaved.agentId ?? "");
      setDraftApiKey("");
      setClearApiKey(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed to load voice settings");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const dirty = useMemo(() => {
    const agentIdChanged = draftAgentId.trim() !== (saved.agentId ?? "");
    const apiKeyChanged = clearApiKey || draftApiKey.trim().length > 0;
    return agentIdChanged || apiKeyChanged;
  }, [clearApiKey, draftAgentId, draftApiKey, saved.agentId]);

  const save = useCallback(async () => {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const patch: Record<string, string> = {};
      const nextAgentId = draftAgentId.trim();
      if (nextAgentId !== (saved.agentId ?? "")) {
        patch.agentId = nextAgentId;
      }
      if (clearApiKey) {
        patch.apiKey = "";
      } else if (draftApiKey.trim()) {
        patch.apiKey = draftApiKey.trim();
      }

      const res = await fetch("/api/settings/voice", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const json = (await res.json().catch(() => null)) as VoiceSettingsResponse | null;
      if (!res.ok) throw new Error(json?.error || "failed to save voice settings");
      const nextSaved = json?.saved ?? saved;
      setSaved(nextSaved);
      setEffective(
        json?.effective ?? {
          available: false,
          source: "missing",
          mode: "local",
          apiKeyConfigured: false,
          agentIdConfigured: false,
        }
      );
      setEnv(json?.env_overrides ?? {});
      setDraftAgentId(nextSaved.agentId ?? "");
      setDraftApiKey("");
      setClearApiKey(false);
      setNotice("Saved.");
      setTimeout(() => setNotice(null), 2500);
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed to save voice settings");
    } finally {
      setSaving(false);
    }
  }, [clearApiKey, draftAgentId, draftApiKey, saved]);

  const envNote = useMemo(() => {
    const parts: string[] = [];
    if (env.apiKey) parts.push("API key");
    if (env.agentId) parts.push("Agent ID");
    if (!parts.length) return null;
    return `Voice ${parts.join(" + ")} provided by environment variables.`;
  }, [env.apiKey, env.agentId]);

  const reasonLabel = useMemo(() => {
    if (effective.reason === "api_key_missing") return "ElevenLabs API key missing.";
    if (effective.reason === "agent_id_missing") return "ElevenLabs agent ID missing.";
    return null;
  }, [effective.reason]);

  const available = effective.available;

  return (
    <section className="card" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
        <div>
          <h2 style={{ margin: 0 }}>Voice</h2>
          <div className="muted" style={{ fontSize: 13 }}>
            ElevenLabs voice agent configuration.
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button className="btnSecondary" onClick={() => void load()} disabled={loading || saving}>
            Refresh
          </button>
          <button className="btn" onClick={() => void save()} disabled={loading || saving || !dirty}>
            {saving ? "Saving..." : dirty ? "Save" : "Saved"}
          </button>
          {!loading && (
            <span
              className="badge"
              style={{
                background: available ? "var(--color-success, #22c55e)" : "var(--color-warning, #eab308)",
                color: available ? "#fff" : "#000",
              }}
            >
              {available ? "Voice available" : "Voice not configured"}
            </span>
          )}
        </div>
      </div>

      {!!error && <div className="error">{error}</div>}
      {!!notice && <div className="badge">{notice}</div>}

      {loading && <div className="muted">Loading...</div>}

      {!loading && (
        <>
          {!!envNote && (
            <div className="muted" style={{ fontSize: 12, lineHeight: 1.5 }}>
              {envNote} Saved values are used only when env overrides are removed.
            </div>
          )}

          {!!reasonLabel && (
            <div className="muted" style={{ fontSize: 12, lineHeight: 1.5 }}>
              {reasonLabel}
            </div>
          )}

          <div className="muted" style={{ fontSize: 12, lineHeight: 1.5 }}>
            Enter your ElevenLabs API key + agent ID to enable BYOK voice. Validation runs on save.
          </div>

          <div className="field">
            <div className="fieldLabel muted">API Key</div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                className="input"
                type={showKey ? "text" : "password"}
                value={draftApiKey}
                placeholder={saved.apiKeyConfigured && !clearApiKey ? "******** (saved)" : "(not set)"}
                onChange={(event) => {
                  setDraftApiKey(event.target.value);
                  setClearApiKey(false);
                }}
                style={{ flex: 1 }}
              />
              <button
                className="btnSecondary"
                onClick={() => setShowKey((prev) => !prev)}
                type="button"
              >
                {showKey ? "Hide" : "Show"}
              </button>
              {saved.apiKeyConfigured && !clearApiKey && (
                <button
                  className="linkBtn"
                  type="button"
                  onClick={() => {
                    setClearApiKey(true);
                    setDraftApiKey("");
                  }}
                >
                  Clear
                </button>
              )}
              {clearApiKey && (
                <button
                  className="linkBtn"
                  type="button"
                  onClick={() => setClearApiKey(false)}
                >
                  Keep
                </button>
              )}
            </div>
            <div className="muted" style={{ fontSize: 12 }}>
              {clearApiKey
                ? "Saved API key will be removed on save."
                : saved.apiKeyConfigured
                  ? "Leave blank to keep the saved API key."
                  : "Add an ElevenLabs API key to enable voice."}
            </div>
          </div>

          <div className="field">
            <div className="fieldLabel muted">Agent ID</div>
            <input
              className="input"
              type="text"
              value={draftAgentId}
              placeholder={saved.agentId ? "" : "(not set)"}
              onChange={(event) => setDraftAgentId(event.target.value)}
            />
            <div className="muted" style={{ fontSize: 12 }}>
              {draftAgentId.trim()
                ? "Use the ElevenLabs agent ID for your voice assistant."
                : "Missing. Add the ElevenLabs agent ID to enable voice."}
            </div>
          </div>
        </>
      )}
    </section>
  );
}
