"use client";

import { useCallback, useEffect, useState } from "react";

type VoiceStatus = {
  available: boolean;
  reason?: string;
};

export function VoiceSettingsForm() {
  const [status, setStatus] = useState<VoiceStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showKey, setShowKey] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/voice/status", { cache: "no-store" });
      const json = (await res.json().catch(() => null)) as VoiceStatus | null;
      if (!res.ok) throw new Error("failed to load voice status");
      setStatus(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed to load voice status");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const available = status?.available ?? false;

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
          <button className="btnSecondary" onClick={() => void load()} disabled={loading}>
            Refresh
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

      {loading && <div className="muted">Loading...</div>}

      {!loading && (
        <>
          <div className="muted" style={{ fontSize: 12, lineHeight: 1.5 }}>
            Voice keys are configured via environment variables (<code>ELEVENLABS_API_KEY</code> and{" "}
            <code>ELEVENLABS_AGENT_ID</code>). BYOK settings storage coming soon.
          </div>

          <div className="field">
            <div className="fieldLabel muted">API Key</div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                className="input"
                type={showKey ? "text" : "password"}
                value={available ? "********" : ""}
                placeholder={available ? "" : "(not set)"}
                readOnly
                style={{ flex: 1 }}
              />
              <button
                className="btnSecondary"
                onClick={() => setShowKey((prev) => !prev)}
                type="button"
              >
                {showKey ? "Hide" : "Show"}
              </button>
            </div>
            <div className="muted" style={{ fontSize: 12 }}>
              {available
                ? "Set via ELEVENLABS_API_KEY environment variable."
                : "Missing. Set ELEVENLABS_API_KEY in your environment."}
            </div>
          </div>

          <div className="field">
            <div className="fieldLabel muted">Agent ID</div>
            <input
              className="input"
              type="text"
              value={status?.reason === "agent_id_missing" ? "" : available ? "(configured)" : ""}
              placeholder={status?.reason === "agent_id_missing" ? "(not set)" : ""}
              readOnly
            />
            <div className="muted" style={{ fontSize: 12 }}>
              {status?.reason === "agent_id_missing"
                ? "Missing. Set ELEVENLABS_AGENT_ID in your environment."
                : "Set via ELEVENLABS_AGENT_ID environment variable."}
            </div>
          </div>
        </>
      )}
    </section>
  );
}
