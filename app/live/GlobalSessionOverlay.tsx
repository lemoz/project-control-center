"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "./live.module.css";

// ── Types (local copies — do not import from GlobalSessionPanel) ──

type GlobalAgentSessionState =
  | "onboarding"
  | "briefing"
  | "autonomous"
  | "debrief"
  | "ended";

type OnboardingRubricItem = {
  id: string;
  label: string;
  done: boolean;
  optional?: boolean;
};

type IntegrationsConfigured = {
  github: boolean;
  slack: boolean;
  linear: boolean;
};

type SessionConstraints = {
  max_budget_usd?: number;
  max_duration_minutes?: number;
  max_iterations?: number;
  do_not_touch?: string[];
};

type GlobalAgentSession = {
  id: string;
  chat_thread_id: string | null;
  state: GlobalAgentSessionState;
  onboarding_rubric: OnboardingRubricItem[];
  integrations_configured: IntegrationsConfigured;
  goals: string[];
  priority_projects: string[];
  constraints: SessionConstraints;
  briefing_summary: string | null;
  briefing_confirmed_at: string | null;
  autonomous_started_at: string | null;
  paused_at: string | null;
  iteration_count: number;
  decisions_count: number;
  actions_count: number;
  last_check_in_at: string | null;
  ended_at: string | null;
  created_at: string;
  updated_at: string;
};

type GlobalAgentSessionEvent = {
  id: string;
  session_id: string;
  type: string;
  payload: Record<string, unknown> | null;
  created_at: string;
};

type ActiveSessionResponse = {
  session: GlobalAgentSession | null;
  events: GlobalAgentSessionEvent[];
  error?: string;
};

// ── Helpers ──

function splitLines(value: string): string[] {
  return value
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter(Boolean);
}

function parseOptionalNumber(value: string): number | undefined {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return undefined;
  return parsed;
}

function formatDuration(startIso: string): string {
  const elapsed = Date.now() - Date.parse(startIso);
  if (!Number.isFinite(elapsed) || elapsed < 0) return "0m";
  const minutes = Math.floor(elapsed / 60_000);
  const hours = Math.floor(minutes / 60);
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  return `${minutes}m`;
}

function formatTimestamp(value: string | null): string {
  if (!value) return "n/a";
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return value;
  return new Date(ms).toLocaleTimeString();
}

// ── Component ──

export function GlobalSessionOverlay() {
  const [session, setSession] = useState<GlobalAgentSession | null>(null);
  const [events, setEvents] = useState<GlobalAgentSessionEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Briefing form drafts
  const [goalsDraft, setGoalsDraft] = useState("");
  const [priorityDraft, setPriorityDraft] = useState("");
  const [maxIterationsDraft, setMaxIterationsDraft] = useState("");
  const [maxDurationDraft, setMaxDurationDraft] = useState("");
  const [maxBudgetDraft, setMaxBudgetDraft] = useState("");
  const [doNotTouchDraft, setDoNotTouchDraft] = useState("");

  // ── Data fetching ──

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/global/sessions/active", {
        cache: "no-store",
      });
      const json = (await res
        .json()
        .catch(() => null)) as ActiveSessionResponse | null;
      if (!res.ok) {
        throw new Error(json?.error || "Failed to load session");
      }
      setSession(json?.session ?? null);
      setEvents(json?.events ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load session");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Poll every 10s in autonomous state
  useEffect(() => {
    if (!session) return;
    if (session.state !== "autonomous") return;
    const timer = window.setInterval(() => {
      void load();
    }, 10_000);
    return () => window.clearInterval(timer);
  }, [session, load]);

  // Sync briefing drafts when session changes
  useEffect(() => {
    if (!session) return;
    setGoalsDraft(session.goals.join("\n"));
    setPriorityDraft(session.priority_projects.join("\n"));
    setMaxIterationsDraft(
      session.constraints.max_iterations
        ? String(session.constraints.max_iterations)
        : ""
    );
    setMaxDurationDraft(
      session.constraints.max_duration_minutes
        ? String(session.constraints.max_duration_minutes)
        : ""
    );
    setMaxBudgetDraft(
      session.constraints.max_budget_usd !== undefined
        ? String(session.constraints.max_budget_usd)
        : ""
    );
    setDoNotTouchDraft((session.constraints.do_not_touch ?? []).join("\n"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.id]);

  // ── Derived ──

  const onboardingComplete = useMemo(() => {
    if (!session) return false;
    return session.onboarding_rubric.every((item) => item.done || item.optional);
  }, [session]);

  const completionEvent = useMemo(() => {
    return events.find((e) => e.type === "completion") ?? null;
  }, [events]);

  const isPaused = Boolean(session?.paused_at);

  // ── Actions ──

  const createSession = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/global/sessions", { method: "POST" });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error || "Failed to create session");
      setSession(json?.session ?? null);
      setEvents([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create session");
    } finally {
      setSaving(false);
    }
  }, []);

  const completeOnboarding = useCallback(async () => {
    if (!session) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/global/sessions/${encodeURIComponent(session.id)}/onboarding/complete`,
        { method: "POST" }
      );
      const json = await res.json().catch(() => null);
      if (!res.ok)
        throw new Error(json?.error || "Failed to complete onboarding");
      setSession(json?.session ?? session);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to complete onboarding"
      );
    } finally {
      setSaving(false);
    }
  }, [session]);

  const saveBriefingAndStart = useCallback(async () => {
    if (!session) return;
    setSaving(true);
    setError(null);
    try {
      // 1. Save briefing data
      const patch = {
        goals: splitLines(goalsDraft),
        priority_projects: splitLines(priorityDraft),
        constraints: {
          max_iterations: parseOptionalNumber(maxIterationsDraft),
          max_duration_minutes: parseOptionalNumber(maxDurationDraft),
          max_budget_usd: parseOptionalNumber(maxBudgetDraft),
          do_not_touch: splitLines(doNotTouchDraft),
        },
      };
      const briefRes = await fetch(
        `/api/global/sessions/${encodeURIComponent(session.id)}/briefing`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        }
      );
      const briefJson = await briefRes.json().catch(() => null);
      if (!briefRes.ok)
        throw new Error(briefJson?.error || "Failed to save briefing");

      // 2. Start autonomous
      const startRes = await fetch(
        `/api/global/sessions/${encodeURIComponent(session.id)}/start`,
        { method: "POST" }
      );
      const startJson = await startRes.json().catch(() => null);
      if (!startRes.ok)
        throw new Error(startJson?.error || "Failed to start session");
      setSession(startJson?.session ?? session);
      void load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start session");
    } finally {
      setSaving(false);
    }
  }, [
    session,
    goalsDraft,
    priorityDraft,
    maxIterationsDraft,
    maxDurationDraft,
    maxBudgetDraft,
    doNotTouchDraft,
    load,
  ]);

  const pauseSession = useCallback(async () => {
    if (!session) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/global/sessions/${encodeURIComponent(session.id)}/pause`,
        { method: "POST" }
      );
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error || "Failed to pause session");
      setSession(json?.session ?? session);
      void load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to pause session");
    } finally {
      setSaving(false);
    }
  }, [session, load]);

  const resumeSession = useCallback(async () => {
    if (!session) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/global/sessions/${encodeURIComponent(session.id)}/start`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ resume: true }),
        }
      );
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error || "Failed to resume session");
      setSession(json?.session ?? session);
      void load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to resume session");
    } finally {
      setSaving(false);
    }
  }, [session, load]);

  const stopSession = useCallback(async () => {
    if (!session) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/global/sessions/${encodeURIComponent(session.id)}/stop`,
        { method: "POST" }
      );
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error || "Failed to stop session");
      setSession(json?.session ?? session);
      void load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to stop session");
    } finally {
      setSaving(false);
    }
  }, [session, load]);

  const endSession = useCallback(async () => {
    if (!session) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/global/sessions/${encodeURIComponent(session.id)}/end`,
        { method: "POST" }
      );
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error || "Failed to end session");
      setSession(json?.session ?? session);
      void load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to end session");
    } finally {
      setSaving(false);
    }
  }, [session, load]);

  const updateRubricItem = useCallback(
    async (itemId: string) => {
      if (!session) return;
      setSaving(true);
      setError(null);
      try {
        const next = session.onboarding_rubric.map((entry) =>
          entry.id === itemId ? { ...entry, done: !entry.done } : entry
        );
        const res = await fetch(
          `/api/global/sessions/${encodeURIComponent(session.id)}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ onboarding_rubric: next }),
          }
        );
        const json = await res.json().catch(() => null);
        if (!res.ok) throw new Error(json?.error || "Failed to update");
        setSession(json?.session ?? session);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to update");
      } finally {
        setSaving(false);
      }
    },
    [session]
  );

  // ── Render helpers ──

  const labelStyle: React.CSSProperties = {
    fontSize: 11,
    color: "#a9b0c2",
    marginBottom: 2,
  };

  const inputStyle: React.CSSProperties = {
    width: "100%",
    background: "#0b0d12",
    border: "1px solid #2b3347",
    borderRadius: 8,
    color: "#e6e8ee",
    padding: "6px 8px",
    fontSize: 13,
    boxSizing: "border-box",
  };

  const textareaStyle: React.CSSProperties = {
    ...inputStyle,
    resize: "vertical",
  };

  const btnPrimary: React.CSSProperties = {
    borderRadius: 8,
    padding: "6px 12px",
    fontWeight: 650,
    border: "1px solid #2b5cff",
    background: "#2b5cff",
    color: "#ffffff",
    cursor: "pointer",
    fontSize: 13,
  };

  const btnSecondary: React.CSSProperties = {
    borderRadius: 8,
    padding: "6px 12px",
    fontWeight: 650,
    border: "1px solid #2b3347",
    background: "transparent",
    color: "#e6e8ee",
    cursor: "pointer",
    fontSize: 13,
  };

  // ── Loading state ──

  if (loading && !session) {
    return (
      <div className={styles.overlayCard} style={{ position: "relative" }}>
        <div style={{ fontSize: 13, color: "#a9b0c2" }}>Loading session...</div>
      </div>
    );
  }

  // ── No session / Ended ──

  if (!session || session.state === "ended") {
    return (
      <div className={styles.overlayCard} style={{ position: "relative" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span
            style={{
              display: "inline-block",
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: "#6b7280",
            }}
          />
          <span style={{ fontWeight: 700, fontSize: 14 }}>Global Agent</span>
        </div>
        <div style={{ fontSize: 12, color: "#a9b0c2", marginTop: 4 }}>
          {session?.state === "ended" ? "Session ended" : "No active session"}
        </div>
        <button
          style={{ ...btnPrimary, marginTop: 8, width: "100%" }}
          onClick={createSession}
          disabled={saving}
        >
          {session?.state === "ended" ? "Start New Session" : "Start Session"}
        </button>
        {error && (
          <div className="error" style={{ marginTop: 8, fontSize: 12 }}>
            {error}
          </div>
        )}
      </div>
    );
  }

  // ── Onboarding ──

  if (session.state === "onboarding") {
    return (
      <div className={styles.overlayCard} style={{ position: "relative" }}>
        <div style={{ fontWeight: 700, fontSize: 14 }}>Setting up...</div>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 6,
            marginTop: 8,
          }}
        >
          {session.onboarding_rubric.map((item) => (
            <label
              key={item.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                fontSize: 12,
                cursor: "pointer",
              }}
            >
              <input
                type="checkbox"
                checked={item.done}
                onChange={() => updateRubricItem(item.id)}
                disabled={saving}
              />
              <span style={{ color: item.done ? "#a9b0c2" : "#e6e8ee" }}>
                {item.label}
                {item.optional && (
                  <span style={{ color: "#6b7280", marginLeft: 4 }}>
                    (optional)
                  </span>
                )}
              </span>
            </label>
          ))}
        </div>
        <button
          style={{
            ...btnPrimary,
            marginTop: 10,
            width: "100%",
            opacity: !onboardingComplete || saving ? 0.6 : 1,
            cursor: !onboardingComplete || saving ? "not-allowed" : "pointer",
          }}
          onClick={completeOnboarding}
          disabled={!onboardingComplete || saving}
        >
          Continue to Briefing
        </button>
        {error && (
          <div className="error" style={{ marginTop: 8, fontSize: 12 }}>
            {error}
          </div>
        )}
      </div>
    );
  }

  // ── Briefing ──

  if (session.state === "briefing") {
    return (
      <div
        className={styles.overlayCard}
        style={{ position: "relative", maxWidth: 380 }}
      >
        <div style={{ fontWeight: 700, fontSize: 14 }}>Briefing</div>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 10,
            marginTop: 8,
          }}
        >
          <div>
            <div style={labelStyle}>Goals (one per line)</div>
            <textarea
              style={textareaStyle}
              rows={3}
              value={goalsDraft}
              onChange={(e) => setGoalsDraft(e.target.value)}
            />
          </div>
          <div>
            <div style={labelStyle}>Priority projects (one per line)</div>
            <textarea
              style={textareaStyle}
              rows={2}
              value={priorityDraft}
              onChange={(e) => setPriorityDraft(e.target.value)}
            />
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr 1fr",
              gap: 8,
            }}
          >
            <div>
              <div style={labelStyle}>Max iterations</div>
              <input
                style={inputStyle}
                value={maxIterationsDraft}
                onChange={(e) => setMaxIterationsDraft(e.target.value)}
              />
            </div>
            <div>
              <div style={labelStyle}>Duration (min)</div>
              <input
                style={inputStyle}
                value={maxDurationDraft}
                onChange={(e) => setMaxDurationDraft(e.target.value)}
              />
            </div>
            <div>
              <div style={labelStyle}>Budget ($)</div>
              <input
                style={inputStyle}
                value={maxBudgetDraft}
                onChange={(e) => setMaxBudgetDraft(e.target.value)}
              />
            </div>
          </div>
          <div>
            <div style={labelStyle}>Do-not-touch repos (one per line)</div>
            <textarea
              style={textareaStyle}
              rows={2}
              value={doNotTouchDraft}
              onChange={(e) => setDoNotTouchDraft(e.target.value)}
            />
          </div>
        </div>
        <button
          style={{
            ...btnPrimary,
            marginTop: 10,
            width: "100%",
            opacity: saving ? 0.6 : 1,
            cursor: saving ? "not-allowed" : "pointer",
          }}
          onClick={saveBriefingAndStart}
          disabled={saving}
        >
          {saving ? "Starting..." : "Confirm & Start"}
        </button>
        {error && (
          <div className="error" style={{ marginTop: 8, fontSize: 12 }}>
            {error}
          </div>
        )}
      </div>
    );
  }

  // ── Autonomous ──

  if (session.state === "autonomous") {
    return (
      <div className={styles.overlayCard} style={{ position: "relative" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {isPaused ? (
            <>
              <span
                style={{
                  display: "inline-block",
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background: "#f59e0b",
                }}
              />
              <span style={{ fontWeight: 700, fontSize: 14 }}>Paused</span>
            </>
          ) : (
            <>
              <span className="session-pulse" />
              <span style={{ fontWeight: 700, fontSize: 14 }}>
                Session Active
              </span>
            </>
          )}
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr 1fr",
            gap: 8,
            marginTop: 8,
            textAlign: "center",
          }}
        >
          <div>
            <div style={{ fontSize: 20, fontWeight: 700, color: "#e6e8ee" }}>
              {session.iteration_count}
            </div>
            <div style={{ fontSize: 10, color: "#7c8aaf", textTransform: "uppercase", letterSpacing: "0.08em", marginTop: 2 }}>
              Iterations
            </div>
          </div>
          <div>
            <div style={{ fontSize: 20, fontWeight: 700, color: "#e6e8ee" }}>
              {session.decisions_count}
            </div>
            <div style={{ fontSize: 10, color: "#7c8aaf", textTransform: "uppercase", letterSpacing: "0.08em", marginTop: 2 }}>
              Decisions
            </div>
          </div>
          <div>
            <div style={{ fontSize: 20, fontWeight: 700, color: "#e6e8ee" }}>
              {session.actions_count}
            </div>
            <div style={{ fontSize: 10, color: "#7c8aaf", textTransform: "uppercase", letterSpacing: "0.08em", marginTop: 2 }}>
              Actions
            </div>
          </div>
        </div>
        {session.autonomous_started_at && (
          <div style={{ fontSize: 11, color: "#6b7280", marginTop: 4 }}>
            Elapsed: {formatDuration(session.autonomous_started_at)}
          </div>
        )}
        <div style={{ fontSize: 11, color: "#6b7280", marginTop: 4 }}>
          Last check-in: {formatTimestamp(session.last_check_in_at)}
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
          {isPaused ? (
            <button
              style={{ ...btnPrimary, flex: 1 }}
              onClick={resumeSession}
              disabled={saving}
            >
              Resume
            </button>
          ) : (
            <button
              style={{ ...btnSecondary, flex: 1 }}
              onClick={pauseSession}
              disabled={saving}
            >
              Pause
            </button>
          )}
          <button
            style={{
              ...btnSecondary,
              flex: 1,
              borderColor: "#5a1f2a",
              color: "#ffb4c0",
            }}
            onClick={stopSession}
            disabled={saving}
          >
            Stop
          </button>
        </div>
        {error && (
          <div className="error" style={{ marginTop: 8, fontSize: 12 }}>
            {error}
          </div>
        )}
      </div>
    );
  }

  // ── Debrief ──

  if (session.state === "debrief") {
    const summary =
      completionEvent?.payload &&
      typeof completionEvent.payload.summary === "string"
        ? completionEvent.payload.summary
        : null;

    return (
      <div className={styles.overlayCard} style={{ position: "relative" }}>
        <div style={{ fontWeight: 700, fontSize: 14 }}>Session Complete</div>
        <div
          style={{
            display: "flex",
            gap: 12,
            marginTop: 8,
            fontSize: 12,
            color: "#a9b0c2",
          }}
        >
          <span>Iterations: {session.iteration_count}</span>
          <span>Decisions: {session.decisions_count}</span>
          <span>Actions: {session.actions_count}</span>
        </div>
        {summary && (
          <div
            style={{
              marginTop: 8,
              fontSize: 12,
              color: "#cbd5f5",
              lineHeight: 1.4,
              maxHeight: 120,
              overflow: "auto",
            }}
          >
            {summary}
          </div>
        )}
        <button
          style={{ ...btnSecondary, marginTop: 10, width: "100%" }}
          onClick={endSession}
          disabled={saving}
        >
          End Session
        </button>
        {error && (
          <div className="error" style={{ marginTop: 8, fontSize: 12 }}>
            {error}
          </div>
        )}
      </div>
    );
  }

  // Fallback (should not reach here)
  return null;
}
