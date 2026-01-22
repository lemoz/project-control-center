"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

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

function formatStateLabel(state: GlobalAgentSessionState): string {
  return state.charAt(0).toUpperCase() + state.slice(1);
}

function formatTimestamp(value: string | null): string {
  if (!value) return "n/a";
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return value;
  return new Date(ms).toLocaleString();
}

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

function eventSummary(event: GlobalAgentSessionEvent): string {
  const payload = event.payload ?? {};
  const summary = typeof payload.summary === "string" ? payload.summary : "";
  if (summary) return summary;
  const message = typeof payload.message === "string" ? payload.message : "";
  if (message) return message;
  const reason = typeof payload.reason === "string" ? payload.reason : "";
  if (reason) return `Reason: ${reason}`;
  return "";
}

export function GlobalSessionPanel() {
  const [session, setSession] = useState<GlobalAgentSession | null>(null);
  const [events, setEvents] = useState<GlobalAgentSessionEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [goalsDraft, setGoalsDraft] = useState("");
  const [priorityDraft, setPriorityDraft] = useState("");
  const [summaryDraft, setSummaryDraft] = useState("");
  const [maxIterationsDraft, setMaxIterationsDraft] = useState("");
  const [maxDurationDraft, setMaxDurationDraft] = useState("");
  const [maxBudgetDraft, setMaxBudgetDraft] = useState("");
  const [doNotTouchDraft, setDoNotTouchDraft] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/global/sessions/active", { cache: "no-store" });
      const json = (await res.json().catch(() => null)) as ActiveSessionResponse | null;
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

  useEffect(() => {
    if (!session) return;
    if (session.state !== "autonomous") return;
    const timer = window.setInterval(() => {
      void load();
    }, 10000);
    return () => window.clearInterval(timer);
  }, [session, load]);

  useEffect(() => {
    if (!session) return;
    setGoalsDraft(session.goals.join("\n"));
    setPriorityDraft(session.priority_projects.join("\n"));
    setSummaryDraft(session.briefing_summary ?? "");
    setMaxIterationsDraft(
      session.constraints.max_iterations ? String(session.constraints.max_iterations) : ""
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
  }, [session?.id]);

  const onboardingComplete = useMemo(() => {
    if (!session) return false;
    return session.onboarding_rubric.every((item) => item.done || item.optional);
  }, [session]);

  const latestCompletion = useMemo(() => {
    return events.find((event) => event.type === "completion") ?? null;
  }, [events]);

  const updateSession = useCallback(
    async (patch: Record<string, unknown>) => {
      if (!session) return;
      setSaving(true);
      setError(null);
      setNotice(null);
      try {
        const res = await fetch(`/api/global/sessions/${encodeURIComponent(session.id)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        });
        const json = await res.json().catch(() => null);
        if (!res.ok) {
          throw new Error(json?.error || "Failed to update session");
        }
        setSession(json?.session ?? session);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to update session");
      } finally {
        setSaving(false);
      }
    },
    [session]
  );

  const createSession = useCallback(async () => {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/global/sessions", { method: "POST" });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(json?.error || "Failed to create session");
      }
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
    setNotice(null);
    try {
      const res = await fetch(
        `/api/global/sessions/${encodeURIComponent(session.id)}/onboarding/complete`,
        { method: "POST" }
      );
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(json?.error || "Failed to complete onboarding");
      }
      setSession(json?.session ?? session);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to complete onboarding");
    } finally {
      setSaving(false);
    }
  }, [session]);

  const startAutonomous = useCallback(
    async (resume: boolean) => {
      if (!session) return;
      setSaving(true);
      setError(null);
      setNotice(null);
      try {
        const res = await fetch(
          `/api/global/sessions/${encodeURIComponent(session.id)}/start`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ resume }),
          }
        );
        const json = await res.json().catch(() => null);
        if (!res.ok) {
          throw new Error(json?.error || "Failed to start autonomous");
        }
        setSession(json?.session ?? session);
        void load();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to start autonomous");
      } finally {
        setSaving(false);
      }
    },
    [session, load]
  );

  const pauseAutonomous = useCallback(async () => {
    if (!session) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(
        `/api/global/sessions/${encodeURIComponent(session.id)}/pause`,
        { method: "POST" }
      );
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(json?.error || "Failed to pause session");
      }
      setSession(json?.session ?? session);
      void load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to pause session");
    } finally {
      setSaving(false);
    }
  }, [session, load]);

  const stopAutonomous = useCallback(async () => {
    if (!session) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(
        `/api/global/sessions/${encodeURIComponent(session.id)}/stop`,
        { method: "POST" }
      );
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(json?.error || "Failed to stop session");
      }
      setSession(json?.session ?? session);
      setNotice(json?.summary ?? null);
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
    setNotice(null);
    try {
      const res = await fetch(
        `/api/global/sessions/${encodeURIComponent(session.id)}/end`,
        { method: "POST" }
      );
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(json?.error || "Failed to end session");
      }
      setSession(json?.session ?? session);
      void load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to end session");
    } finally {
      setSaving(false);
    }
  }, [session, load]);

  const saveBriefing = useCallback(async () => {
    if (!session) return;
    const patch: Record<string, unknown> = {
      goals: splitLines(goalsDraft),
      priority_projects: splitLines(priorityDraft),
      constraints: {
        max_iterations: parseOptionalNumber(maxIterationsDraft),
        max_duration_minutes: parseOptionalNumber(maxDurationDraft),
        max_budget_usd: parseOptionalNumber(maxBudgetDraft),
        do_not_touch: splitLines(doNotTouchDraft),
      },
      briefing_summary: summaryDraft.trim() || null,
    };
    await updateSession(patch);
  }, [
    session,
    goalsDraft,
    priorityDraft,
    maxIterationsDraft,
    maxDurationDraft,
    maxBudgetDraft,
    doNotTouchDraft,
    summaryDraft,
    updateSession,
  ]);

  const handleStartAutonomous = useCallback(async () => {
    await saveBriefing();
    await startAutonomous(false);
  }, [saveBriefing, startAutonomous]);

  const handleResumeAutonomous = useCallback(async () => {
    await saveBriefing();
    await startAutonomous(true);
  }, [saveBriefing, startAutonomous]);

  if (loading && !session) {
    return (
      <section className="card">
        <div className="muted">Loading session...</div>
      </section>
    );
  }

  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <section className="card" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <div style={{ fontWeight: 600 }}>Global Agent Session</div>
          {session && (
            <span className="badge">
              {formatStateLabel(session.state)}
              {session.paused_at ? " (paused)" : ""}
            </span>
          )}
        </div>
        {!session && (
          <>
            <div className="muted">No active session yet.</div>
            <button className="btn" type="button" onClick={createSession} disabled={saving}>
              Start new session
            </button>
          </>
        )}
        {session && (
          <>
            <div className="muted" style={{ fontSize: 13 }}>
              Iterations {session.iteration_count} | Decisions {session.decisions_count} | Actions{" "}
              {session.actions_count} | Last check-in {formatTimestamp(session.last_check_in_at)}
            </div>
            {session.state === "briefing" && (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {session.paused_at ? (
                  <>
                    <button className="btn" type="button" onClick={handleResumeAutonomous} disabled={saving}>
                      Resume autonomous
                    </button>
                    <button className="btnSecondary" type="button" onClick={stopAutonomous} disabled={saving}>
                      Stop
                    </button>
                  </>
                ) : (
                  <button className="btn" type="button" onClick={handleStartAutonomous} disabled={saving}>
                    Start autonomous
                  </button>
                )}
              </div>
            )}
            {session.state === "autonomous" && (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button className="btnSecondary" type="button" onClick={pauseAutonomous} disabled={saving}>
                  Pause
                </button>
                <button className="btn" type="button" onClick={stopAutonomous} disabled={saving}>
                  Stop
                </button>
              </div>
            )}
            {session.state === "debrief" && (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button className="btnSecondary" type="button" onClick={endSession} disabled={saving}>
                  End session
                </button>
              </div>
            )}
          </>
        )}
        {notice && <div className="muted">{notice}</div>}
        {error && <div className="error">{error}</div>}
      </section>

      {session?.state === "onboarding" && (
        <section className="card" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ fontWeight: 600 }}>Onboarding checklist</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {session.onboarding_rubric.map((item) => (
              <label key={item.id} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input
                  type="checkbox"
                  checked={item.done}
                  onChange={() => {
                    const next = session.onboarding_rubric.map((entry) =>
                      entry.id === item.id ? { ...entry, done: !entry.done } : entry
                    );
                    updateSession({ onboarding_rubric: next });
                  }}
                />
                <span>{item.label}</span>
              </label>
            ))}
          </div>
          <div className="muted">Integration setup prompts (optional)</div>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            {(["github", "slack", "linear"] as const).map((key) => (
              <label key={key} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <input
                  type="checkbox"
                  checked={session.integrations_configured[key]}
                  onChange={() => {
                    updateSession({
                      integrations_configured: {
                        ...session.integrations_configured,
                        [key]: !session.integrations_configured[key],
                      },
                    });
                  }}
                />
                <span>{key.toUpperCase()}</span>
              </label>
            ))}
          </div>
          <button
            className="btn"
            type="button"
            onClick={completeOnboarding}
            disabled={!onboardingComplete || saving}
          >
            Continue to briefing
          </button>
        </section>
      )}

      {session?.state === "briefing" && (
        <section className="card" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ fontWeight: 600 }}>Briefing</div>
          <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span className="muted">Goals (one per line)</span>
            <textarea
              className="textarea"
              rows={3}
              value={goalsDraft}
              onChange={(e) => setGoalsDraft(e.target.value)}
            />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span className="muted">Priority projects (one per line)</span>
            <textarea
              className="textarea"
              rows={2}
              value={priorityDraft}
              onChange={(e) => setPriorityDraft(e.target.value)}
            />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span className="muted">Briefing summary</span>
            <textarea
              className="textarea"
              rows={3}
              value={summaryDraft}
              onChange={(e) => setSummaryDraft(e.target.value)}
            />
          </label>
          <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))" }}>
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span className="muted">Max iterations</span>
              <input
                className="input"
                value={maxIterationsDraft}
                onChange={(e) => setMaxIterationsDraft(e.target.value)}
              />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span className="muted">Max duration (minutes)</span>
              <input
                className="input"
                value={maxDurationDraft}
                onChange={(e) => setMaxDurationDraft(e.target.value)}
              />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span className="muted">Max budget (USD)</span>
              <input
                className="input"
                value={maxBudgetDraft}
                onChange={(e) => setMaxBudgetDraft(e.target.value)}
              />
            </label>
          </div>
          <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span className="muted">Do not touch (one per line)</span>
            <textarea
              className="textarea"
              rows={2}
              value={doNotTouchDraft}
              onChange={(e) => setDoNotTouchDraft(e.target.value)}
            />
          </label>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className="btnSecondary" type="button" onClick={saveBriefing} disabled={saving}>
              Save briefing
            </button>
          </div>
        </section>
      )}

      {events.length > 0 && (
        <section className="card" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ fontWeight: 600 }}>Session check-ins</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {events.slice(0, 5).map((event) => (
              <div key={event.id} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span className="badge">{event.type}</span>
                  <span className="muted" style={{ fontSize: 12 }}>
                    {formatTimestamp(event.created_at)}
                  </span>
                </div>
                {eventSummary(event) && <div className="muted">{eventSummary(event)}</div>}
              </div>
            ))}
          </div>
        </section>
      )}

      {session?.state === "debrief" && latestCompletion?.payload && (
        <section className="card" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ fontWeight: 600 }}>Debrief summary</div>
          <div className="muted">
            {typeof latestCompletion.payload.summary === "string"
              ? latestCompletion.payload.summary
              : "Debrief ready."}
          </div>
        </section>
      )}
    </section>
  );
}
