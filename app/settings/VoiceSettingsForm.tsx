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

type VoiceToolAliasMismatch = {
  expected: string;
  configured: string;
};

type VoiceAgentDebugResponse = {
  fetchedAt: string;
  configuredAgentId: string;
  agent: {
    id: string;
    name: string | null;
    promptPath: string | null;
    firstMessage: string | null;
    systemPromptPreview: string | null;
    systemPromptLength: number;
    toolIds: string[];
    builtInTools: string[];
  };
  resolvedTools: Array<{
    id: string;
    name: string;
    type: string | null;
  }>;
  toolAudit: {
    expectedClientTools: string[];
    configuredClientTools: string[];
    missingClientTools: string[];
    aliasMismatches: VoiceToolAliasMismatch[];
    extraConfiguredTools: string[];
  };
  warnings: string[];
};

type VoiceAgentSyncResponse = {
  syncedAt: string;
  updated: boolean;
  dryRun: boolean;
  applied: {
    promptUpdated: boolean;
    firstMessageUpdated: boolean;
    toolsUpdated: boolean;
    promptLength: number;
    firstMessageLength: number;
    toolNames: string[];
    toolIds: string[];
    builtInTools: string[];
  };
  warnings: string[];
  snapshot: VoiceAgentDebugResponse;
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
  const [agentDebug, setAgentDebug] = useState<VoiceAgentDebugResponse | null>(null);
  const [agentDebugLoading, setAgentDebugLoading] = useState(false);
  const [agentDebugError, setAgentDebugError] = useState<string | null>(null);
  const [agentSyncing, setAgentSyncing] = useState(false);
  const [agentSyncError, setAgentSyncError] = useState<string | null>(null);
  const [agentSyncNotice, setAgentSyncNotice] = useState<string | null>(null);

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

  const inspectAgent = useCallback(async () => {
    setAgentDebugLoading(true);
    setAgentDebugError(null);
    try {
      const res = await fetch("/api/settings/voice/agent/debug", { cache: "no-store" });
      const json = (await res.json().catch(() => null)) as
        | (VoiceAgentDebugResponse & { error?: string })
        | null;
      if (!res.ok) {
        throw new Error(json?.error || "failed to inspect live agent");
      }
      if (!json) {
        throw new Error("empty response from live agent inspection");
      }
      setAgentDebug(json);
    } catch (e) {
      setAgentDebug(null);
      setAgentDebugError(e instanceof Error ? e.message : "failed to inspect live agent");
    } finally {
      setAgentDebugLoading(false);
    }
  }, []);

  const syncAgent = useCallback(async () => {
    setAgentSyncing(true);
    setAgentSyncError(null);
    setAgentSyncNotice(null);
    try {
      const res = await fetch("/api/settings/voice/agent/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const json = (await res.json().catch(() => null)) as VoiceAgentSyncResponse | null;
      if (!res.ok || !json) {
        throw new Error(json?.error || "failed to sync live agent");
      }
      setAgentDebug(json.snapshot);
      setAgentSyncNotice(
        `Synced agent config: ${json.applied.toolIds.length} tools, prompt ${json.applied.promptLength} chars.`
      );
      setTimeout(() => setAgentSyncNotice(null), 3500);
    } catch (e) {
      setAgentSyncError(e instanceof Error ? e.message : "failed to sync live agent");
    } finally {
      setAgentSyncing(false);
    }
  }, []);

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

          <section
            style={{
              border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: 10,
              padding: 12,
              display: "flex",
              flexDirection: "column",
              gap: 10,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
              <div>
                <div style={{ fontWeight: 600 }}>Agent Debug</div>
                <div className="muted" style={{ fontSize: 12 }}>
                  Inspect live ElevenLabs tool wiring and spot naming mismatches.
                </div>
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button
                  className="btn"
                  type="button"
                  onClick={() => void syncAgent()}
                  disabled={agentSyncing || agentDebugLoading}
                >
                  {agentSyncing ? "Syncing..." : "Sync PCC defaults"}
                </button>
                <button
                  className="btnSecondary"
                  type="button"
                  onClick={() => void inspectAgent()}
                  disabled={agentDebugLoading || agentSyncing}
                >
                  {agentDebugLoading ? "Inspecting..." : "Inspect live agent"}
                </button>
              </div>
            </div>

            {agentDebugError && <div className="error">{agentDebugError}</div>}
            {agentSyncError && <div className="error">{agentSyncError}</div>}
            {agentSyncNotice && <div className="badge">{agentSyncNotice}</div>}

            {agentDebug && (
              <>
                <div className="muted" style={{ fontSize: 12, lineHeight: 1.5 }}>
                  Agent: {agentDebug.agent.name || "(unnamed)"} ({agentDebug.agent.id})<br />
                  Configured ID: {agentDebug.configuredAgentId}<br />
                  Prompt path: {agentDebug.agent.promptPath || "unknown"}<br />
                  Prompt length: {agentDebug.agent.systemPromptLength} chars
                </div>

                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <span
                    className="badge"
                    style={{
                      background:
                        agentDebug.toolAudit.missingClientTools.length > 0
                          ? "var(--color-warning, #eab308)"
                          : "var(--color-success, #22c55e)",
                      color:
                        agentDebug.toolAudit.missingClientTools.length > 0 ? "#000" : "#fff",
                    }}
                  >
                    Missing tools: {agentDebug.toolAudit.missingClientTools.length}
                  </span>
                  <span className="badge">
                    Alias mismatches: {agentDebug.toolAudit.aliasMismatches.length}
                  </span>
                  <span className="badge">
                    Extra tools: {agentDebug.toolAudit.extraConfiguredTools.length}
                  </span>
                </div>

                {agentDebug.toolAudit.missingClientTools.length > 0 && (
                  <div className="muted" style={{ fontSize: 12, lineHeight: 1.5 }}>
                    Missing: {agentDebug.toolAudit.missingClientTools.join(", ")}
                  </div>
                )}

                {agentDebug.toolAudit.aliasMismatches.length > 0 && (
                  <div className="muted" style={{ fontSize: 12, lineHeight: 1.5 }}>
                    Alias mismatches:{" "}
                    {agentDebug.toolAudit.aliasMismatches
                      .map(
                        (entry) => `${entry.configured} should be ${entry.expected}`
                      )
                      .join("; ")}
                  </div>
                )}

                {agentDebug.warnings.length > 0 && (
                  <div className="muted" style={{ fontSize: 12, lineHeight: 1.5 }}>
                    Warnings: {agentDebug.warnings.join(" ")}
                  </div>
                )}

                <details>
                  <summary className="muted" style={{ cursor: "pointer" }}>
                    Configured tool names
                  </summary>
                  <div className="muted" style={{ fontSize: 12, lineHeight: 1.5 }}>
                    {agentDebug.toolAudit.configuredClientTools.length
                      ? agentDebug.toolAudit.configuredClientTools.join(", ")
                      : "No custom client tools detected."}
                  </div>
                </details>
              </>
            )}
          </section>
        </>
      )}
    </section>
  );
}
