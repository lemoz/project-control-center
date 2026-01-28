"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { RunEstimateDisplay } from "./RunEstimateDisplay";
import { type RunPhase } from "./RunPhaseProgress";

function formatFailureLabel(value: string | null | undefined): string {
  if (!value) return "";
  return value.replace(/_/g, " ");
}

function stringToTags(input: string): string[] {
  return input
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

type RunStatus =
  | "queued"
  | "baseline_failed"
  | "building"
  | "waiting_for_input"
  | "ai_review"
  | "testing"
  | "you_review"
  | "merged"
  | "merge_conflict"
  | "failed"
  | "canceled";

type RunEstimateConfidence = "high" | "medium" | "low";

type RunEstimate = {
  estimated_iterations: number;
  estimated_minutes: number;
  confidence: RunEstimateConfidence;
  reasoning: string;
};

type ProgressiveEstimate = {
  phase: string;
  iteration: number;
  estimated_remaining_minutes: number;
  estimated_completion_at: string;
  reasoning: string;
  updated_at: string;
};

type RunEscalationInput = {
  key: string;
  label: string;
};

type RunEscalation = {
  what_i_tried: string;
  what_i_need: string;
  inputs: RunEscalationInput[];
  created_at: string;
  resolved_at?: string;
  resolution?: Record<string, string>;
};

type BuilderChange = {
  file: string;
  type: "wo_implementation" | "blocking_fix";
  reason?: string | null;
};

type RunIterationHistory = {
  iteration: number;
  builder_summary: string | null;
  builder_risks: string[];
  builder_changes?: BuilderChange[];
  tests: Array<{ command: string; passed: boolean; output: string }>;
  reviewer_verdict: "approved" | "changes_requested" | null;
  reviewer_notes: string[] | null;
};

type SecurityIncidentSummary = {
  id: string;
  pattern_category: string;
  pattern_matched: string;
  gemini_verdict: string;
  timestamp: string;
  false_positive: number;
  user_resolution: string | null;
};

type RunDetails = {
  id: string;
  project_id: string;
  work_order_id: string;
  provider: string;
  triggered_by: "manual" | "autopilot";
  status: RunStatus;
  iteration: number;
  builder_iteration: number;
  reviewer_verdict: "approved" | "changes_requested" | null;
  reviewer_notes: string | null;
  summary: string | null;
  branch_name: string | null;
  source_branch: string | null;
  merge_status: "pending" | "merged" | "conflict" | null;
  conflict_with_run_id: string | null;
  run_dir: string;
  log_path: string;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  error: string | null;
  failure_category?: string | null;
  failure_reason?: string | null;
  failure_detail?: string | null;
  current_eta_minutes?: number | null;
  estimated_completion_at?: string | null;
  eta_history?: ProgressiveEstimate[];
  initial_estimate?: RunEstimate | null;
  escalation?: RunEscalation | null;
  log_tail?: string;
  builder_log_tail?: string;
  reviewer_log_tail?: string;
  tests_log_tail?: string;
  iteration_history?: RunIterationHistory[];
  security_incident?: SecurityIncidentSummary | null;
};

const ACTIVE_RUN_STATUSES: RunStatus[] = [
  "queued",
  "building",
  "waiting_for_input",
  "ai_review",
  "testing",
];

function isActiveRunStatus(status: RunStatus): boolean {
  return ACTIVE_RUN_STATUSES.includes(status);
}

function resolveRunPhase(status: RunStatus): RunPhase | null {
  switch (status) {
    case "queued":
    case "baseline_failed":
      return "setup";
    case "building":
    case "waiting_for_input":
      return "builder";
    case "testing":
      return "test";
    case "ai_review":
      return "reviewer";
    case "you_review":
    case "merged":
    case "merge_conflict":
    case "failed":
    case "canceled":
      return "merge";
    default:
      return "setup";
  }
}

export function RunDetails({ runId }: { runId: string }) {
  const [run, setRun] = useState<RunDetails | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [inputValues, setInputValues] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [escalationCreatedAt, setEscalationCreatedAt] = useState<string | null>(null);
  const [canceling, setCanceling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [falsePositive, setFalsePositive] = useState(false);
  const [signalSummary, setSignalSummary] = useState("");
  const [signalTags, setSignalTags] = useState("");
  const [signalType, setSignalType] = useState("outcome");
  const [signalSaving, setSignalSaving] = useState(false);
  const [signalError, setSignalError] = useState<string | null>(null);
  const [signalNotice, setSignalNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(`/api/runs/${encodeURIComponent(runId)}`, {
        cache: "no-store",
      });
      const json = (await res.json().catch(() => null)) as RunDetails | { error?: string } | null;
      if (!res.ok) throw new Error((json as { error?: string } | null)?.error || "failed");
      setRun(json as RunDetails);
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed");
    } finally {
      setLoading(false);
    }
  }, [runId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!run) return;
    if (!isActiveRunStatus(run.status)) return;
    const interval = setInterval(() => void load(), 10000);
    return () => clearInterval(interval);
  }, [run, load]);

  useEffect(() => {
    const escalation = run?.escalation;
    if (!escalation) {
      if (escalationCreatedAt !== null) {
        setEscalationCreatedAt(null);
        setInputValues({});
      }
      return;
    }
    if (escalation.created_at === escalationCreatedAt) return;
    const nextValues: Record<string, string> = {};
    for (const input of escalation.inputs || []) {
      nextValues[input.key] = escalation.resolution?.[input.key] ?? "";
    }
    setInputValues(nextValues);
    setSubmitError(null);
    setEscalationCreatedAt(escalation.created_at);
  }, [run?.escalation, escalationCreatedAt]);

  const securityIncident = run?.security_incident ?? null;
  const incidentId = securityIncident?.id ?? null;

  useEffect(() => {
    setFalsePositive(false);
  }, [incidentId]);

  const notes: string[] = (() => {
    if (!run?.reviewer_notes) return [];
    try {
      return JSON.parse(run.reviewer_notes) as string[];
    } catch {
      return [];
    }
  })();

  const etaHistory = run?.eta_history ?? [];
  const latestEta = etaHistory.length ? etaHistory[etaHistory.length - 1] : null;
  const estimateReasoning =
    latestEta?.reasoning || run?.initial_estimate?.reasoning || null;
  const currentPhase = run ? resolveRunPhase(run.status) : null;
  const isActive = run ? isActiveRunStatus(run.status) : false;

  const escalation = run?.escalation ?? null;
  const missingInputs = escalation
    ? escalation.inputs.filter((input) => !inputValues[input.key]?.trim())
    : [];
  const canSubmit = !!escalation && missingInputs.length === 0 && !submitting;
  const canCancel = !!run && isActiveRunStatus(run.status);
  const canSubmitSignal = !!run && !!signalSummary.trim() && !signalSaving;

  const cancelRun = useCallback(async () => {
    if (!canCancel) return;
    setCanceling(true);
    setCancelError(null);
    try {
      const res = await fetch(`/api/runs/${encodeURIComponent(runId)}/cancel`, {
        method: "POST",
      });
      const json = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) throw new Error(json?.error || "failed to cancel run");
      await load();
    } catch (e) {
      setCancelError(e instanceof Error ? e.message : "failed to cancel run");
    } finally {
      setCanceling(false);
    }
  }, [canCancel, load, runId]);

  const submitInputs = useCallback(async () => {
    if (!escalation) return;
    const missing = escalation.inputs.filter((input) => !inputValues[input.key]?.trim());
    if (missing.length) {
      setSubmitError("Fill out all fields to resume the run.");
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    try {
      const payload: Record<string, string> = {};
      for (const input of escalation.inputs) {
        payload[input.key] = inputValues[input.key] ?? "";
      }
      const body: Record<string, unknown> = { inputs: payload };
      if (incidentId) body.incident_id = incidentId;
      if (falsePositive) body.false_positive = true;
      const res = await fetch(`/api/runs/${encodeURIComponent(runId)}/provide-input`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) throw new Error(json?.error || "failed to submit inputs");
      await load();
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : "failed to submit inputs");
    } finally {
      setSubmitting(false);
    }
  }, [escalation, falsePositive, incidentId, inputValues, load, runId]);

  const submitSignal = useCallback(async () => {
    if (!run) return;
    const summary = signalSummary.trim();
    if (!summary) {
      setSignalError("Summary is required.");
      return;
    }
    setSignalSaving(true);
    setSignalError(null);
    setSignalNotice(null);
    try {
      const res = await fetch(`/api/repos/${encodeURIComponent(run.project_id)}/signals`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          work_order_id: run.work_order_id,
          run_id: run.id,
          type: signalType,
          summary,
          tags: stringToTags(signalTags),
          source: "run_details",
        }),
      });
      const json = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) throw new Error(json?.error || "failed to save signal");
      setSignalSummary("");
      setSignalTags("");
      setSignalNotice("Saved outcome note.");
    } catch (e) {
      setSignalError(e instanceof Error ? e.message : "failed to save signal");
    } finally {
      setSignalSaving(false);
    }
  }, [run, signalSummary, signalTags, signalType]);

  const latestChanges = (() => {
    const history = run?.iteration_history;
    if (!history?.length) return [];
    return history[history.length - 1]?.builder_changes || [];
  })();

  const sourceBranchValue = run?.source_branch?.trim();
  const sourceBranchLabel = sourceBranchValue ? "explicit" : "auto-detected";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <section className="card">
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: 16 }}>Run {runId}</div>
            <div className="muted" style={{ fontSize: 12 }}>
              {run?.project_id ? (
                <>
                  Project{" "}
                  <Link href={`/projects/${encodeURIComponent(run.project_id)}`} className="badge">
                    {run.project_id}
                  </Link>
                </>
              ) : (
                "Loading…"
              )}
            </div>
          </div>

          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button className="btnSecondary" onClick={() => void load()} disabled={loading}>
              Refresh
            </button>
            {canCancel && (
              <button className="btnSecondary" onClick={() => void cancelRun()} disabled={canceling}>
                {canceling ? "Canceling…" : "Cancel Run"}
              </button>
            )}
            {run?.status && <span className="badge">{run.status}</span>}
            {run?.triggered_by === "autopilot" && (
              <span className="badge">autopilot</span>
            )}
          </div>
        </div>

        {!!error && <div className="error" style={{ marginTop: 10 }}>{error}</div>}
        {!!cancelError && <div className="error" style={{ marginTop: 10 }}>{cancelError}</div>}
        {loading && <div className="muted" style={{ marginTop: 10 }}>Loading…</div>}

        {!!run && (
          <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 6 }}>
            <div className="muted" style={{ fontSize: 12 }}>
              Provider: <code>{run.provider}</code> · Work Order: <code>{run.work_order_id}</code> · Builder iteration:{" "}
              <code>{run.builder_iteration ?? run.iteration}</code>
            </div>
            <div className="muted" style={{ fontSize: 12 }}>
              Branch: <code>{run.branch_name || "n/a"}</code> · Source:{" "}
              <code>{sourceBranchValue || "auto"}</code> ({sourceBranchLabel}) · Merge:{" "}
              <code>{run.merge_status || "n/a"}</code>
              {run.conflict_with_run_id ? (
                <>
                  {" "}
                  · Conflict with: <code>{run.conflict_with_run_id}</code>
                </>
              ) : null}
            </div>
            <div className="muted" style={{ fontSize: 12 }}>
              Created: <code>{run.created_at}</code>
              {run.started_at ? <> · Started: <code>{run.started_at}</code></> : null}
              {run.finished_at ? <> · Finished: <code>{run.finished_at}</code></> : null}
            </div>
            <div className="muted" style={{ fontSize: 12 }}>
              Artifacts: <code>{run.run_dir}</code>
            </div>
          </div>
        )}
      </section>

      {!!run && (
        <RunEstimateDisplay
          initialEstimate={run.initial_estimate ?? null}
          currentEta={run.current_eta_minutes ?? null}
          estimatedCompletion={run.estimated_completion_at ?? null}
          confidence={run.initial_estimate?.confidence ?? null}
          reasoning={estimateReasoning}
          phase={currentPhase}
          iteration={run.builder_iteration ?? run.iteration ?? null}
          isActive={isActive}
        />
      )}

      {!!run && (
        <section className="card">
          <div style={{ fontWeight: 800 }}>Add Outcome Note</div>
          <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
            Capture outcome and decision signals for planning.
          </div>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void submitSignal();
            }}
            style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 12 }}
          >
            <label className="field">
              <div className="muted fieldLabel">Type</div>
              <select
                className="select"
                value={signalType}
                onChange={(event) => {
                  setSignalType(event.target.value);
                  setSignalError(null);
                  setSignalNotice(null);
                }}
              >
                <option value="outcome">outcome</option>
                <option value="decision">decision</option>
              </select>
            </label>
            <label className="field">
              <div className="muted fieldLabel">Summary</div>
              <textarea
                className="textarea"
                rows={3}
                value={signalSummary}
                onChange={(event) => {
                  setSignalSummary(event.target.value);
                  setSignalError(null);
                  setSignalNotice(null);
                }}
              />
            </label>
            <label className="field">
              <div className="muted fieldLabel">Tags (comma-separated)</div>
              <input
                className="input"
                value={signalTags}
                onChange={(event) => {
                  setSignalTags(event.target.value);
                  setSignalError(null);
                  setSignalNotice(null);
                }}
              />
            </label>
            {!!signalError && <div className="error">{signalError}</div>}
            {!!signalNotice && <div className="badge">{signalNotice}</div>}
            <button className="btn" type="submit" disabled={!canSubmitSignal}>
              {signalSaving ? "Saving…" : "Save Note"}
            </button>
          </form>
        </section>
      )}

      {run?.status === "waiting_for_input" && escalation && (
        <section className="card">
          <div style={{ fontWeight: 800 }}>Builder needs your help</div>
          <div style={{ marginTop: 10 }}>
            <div style={{ fontWeight: 700 }}>What was tried</div>
            <div style={{ marginTop: 6, whiteSpace: "pre-wrap", lineHeight: 1.4 }}>
              {escalation.what_i_tried}
            </div>
          </div>
          <div style={{ marginTop: 10 }}>
            <div style={{ fontWeight: 700 }}>{"What's needed"}</div>
            <div style={{ marginTop: 6, whiteSpace: "pre-wrap", lineHeight: 1.4 }}>
              {escalation.what_i_need}
            </div>
          </div>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void submitInputs();
            }}
            style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 12 }}
          >
            {escalation.inputs.map((input) => (
              <label key={input.key} className="field">
                <div className="muted fieldLabel">{input.label}</div>
                <input
                  className="input"
                  value={inputValues[input.key] ?? ""}
                  onChange={(event) =>
                    setInputValues((prev) => ({ ...prev, [input.key]: event.target.value }))
                  }
                />
              </label>
            ))}
            {securityIncident && (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <div className="muted" style={{ fontSize: 12 }}>
                  Security incident: {securityIncident.pattern_category} · {securityIncident.gemini_verdict} ·{" "}
                  <code>{securityIncident.pattern_matched}</code>
                </div>
                <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13 }}>
                  <input
                    type="checkbox"
                    checked={falsePositive}
                    onChange={(event) => setFalsePositive(event.target.checked)}
                  />
                  Was this a false positive?
                </label>
              </div>
            )}
            {missingInputs.length > 0 && (
              <div className="muted" style={{ fontSize: 12 }}>
                Fill out all fields to resume the run.
              </div>
            )}
            {!!submitError && (
              <div className="error" style={{ marginTop: 4 }}>
                {submitError}
              </div>
            )}
            <button className="btn" type="submit" disabled={!canSubmit}>
              {submitting ? "Submitting…" : "Provide & Resume"}
            </button>
          </form>
        </section>
      )}

      {!!run?.summary && (run.status === "you_review" || run.status === "merged") && (
        <section className="card">
          <div style={{ fontWeight: 800 }}>Approved Summary</div>
          <div style={{ marginTop: 8, whiteSpace: "pre-wrap", lineHeight: 1.4 }}>{run.summary}</div>
          {!!latestChanges.length && (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontWeight: 700 }}>Changes</div>
              <ul style={{ marginTop: 6, marginBottom: 0, paddingLeft: 18 }}>
                {latestChanges.map((change, idx) => {
                  const label =
                    change.type === "blocking_fix"
                      ? `Blocking fix: ${change.reason || "reason not provided"}`
                      : "WO implementation";
                  return (
                    <li key={`${change.file}-${idx}`}>
                      <code>{change.file || "(unknown file)"}</code> ({label})
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
          {!!notes.length && (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontWeight: 700 }}>Reviewer Notes</div>
              <ul style={{ marginTop: 6, marginBottom: 0, paddingLeft: 18 }}>
                {notes.map((n, idx) => (
                  <li key={idx}>{n}</li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      {run?.status === "baseline_failed" && (
        <section className="card">
          <div style={{ fontWeight: 800 }}>Baseline Failed</div>
          <div className="muted" style={{ marginTop: 8 }}>
            This run cannot proceed because tests are failing on main. Fix the baseline first.
          </div>
          <div className="muted" style={{ marginTop: 6 }}>
            {run.error || "Unknown error"}
          </div>
          {(run.failure_category || run.failure_reason) && (
            <div className="muted" style={{ marginTop: 6 }}>
              {run.failure_category && (
                <span>Category: {formatFailureLabel(run.failure_category)}</span>
              )}
              {run.failure_reason && (
                <span>
                  {run.failure_category ? " · " : ""}
                  Pattern: {formatFailureLabel(run.failure_reason)}
                </span>
              )}
            </div>
          )}
        </section>
      )}

      {(run?.status === "failed" || run?.status === "merge_conflict") && (
        <section className="card">
          <div style={{ fontWeight: 800 }}>
            {run.status === "merge_conflict" ? "Merge Conflict" : "Failed"}
          </div>
          <div className="muted" style={{ marginTop: 8 }}>
            {run.error || "Unknown error"}
          </div>
          {(run.failure_category || run.failure_reason) && (
            <div className="muted" style={{ marginTop: 6 }}>
              {run.failure_category && (
                <span>Category: {formatFailureLabel(run.failure_category)}</span>
              )}
              {run.failure_reason && (
                <span>
                  {run.failure_category ? " · " : ""}
                  Pattern: {formatFailureLabel(run.failure_reason)}
                </span>
              )}
            </div>
          )}
        </section>
      )}

      {!!run?.iteration_history?.length && (
        <section className="card">
          <div style={{ fontWeight: 800 }}>Builder Iterations</div>
          <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 10 }}>
            {run.iteration_history.map((entry, idx) => {
              const failed = entry.tests.some((test) => !test.passed);
              const isLast = idx === run.iteration_history!.length - 1;
              return (
                <details key={entry.iteration} open={isLast}>
                  <summary className="muted" style={{ cursor: "pointer", userSelect: "none" }}>
                    Iteration {entry.iteration} · {failed ? "tests failed" : "tests passed"}
                  </summary>
                  <div style={{ marginTop: 8 }}>
                    <div style={{ fontWeight: 700 }}>Builder summary</div>
                    <div style={{ marginTop: 6, whiteSpace: "pre-wrap", lineHeight: 1.4 }}>
                      {entry.builder_summary || "(no summary)"}
                    </div>
                  </div>
                  <div style={{ marginTop: 10 }}>
                    <div style={{ fontWeight: 700 }}>Tests</div>
                    {entry.tests.length ? (
                      entry.tests.map((test, testIdx) => (
                        <div key={`${test.command}-${testIdx}`} style={{ marginTop: 8 }}>
                          <div className="muted" style={{ fontSize: 12 }}>
                            {test.command} · {test.passed ? "passed" : "failed"}
                          </div>
                          {test.output ? (
                            <pre
                              style={{
                                marginTop: 6,
                                whiteSpace: "pre-wrap",
                                fontSize: 12,
                                lineHeight: 1.35,
                                maxHeight: 240,
                                overflow: "auto",
                              }}
                            >
                              {test.output}
                            </pre>
                          ) : (
                            <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
                              (no output captured)
                            </div>
                          )}
                        </div>
                      ))
                    ) : (
                      <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
                        (no tests recorded)
                      </div>
                    )}
                  </div>
                  {entry.reviewer_verdict && (
                    <div style={{ marginTop: 10 }}>
                      <div style={{ fontWeight: 700 }}>Reviewer</div>
                      <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                        {entry.reviewer_verdict}
                      </div>
                      {!!entry.reviewer_notes?.length && (
                        <ul style={{ marginTop: 6, marginBottom: 0, paddingLeft: 18 }}>
                          {entry.reviewer_notes.map((note, noteIdx) => (
                            <li key={`${note}-${noteIdx}`}>{note}</li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                </details>
              );
            })}
          </div>
        </section>
      )}

      {!!run && (
        <section className="card">
          <div style={{ fontWeight: 800 }}>Logs</div>

          <details open style={{ marginTop: 10 }}>
            <summary className="muted" style={{ cursor: "pointer", userSelect: "none" }}>
              Run log (tail)
            </summary>
            <pre style={{ marginTop: 10, whiteSpace: "pre-wrap", fontSize: 12, lineHeight: 1.35 }}>
              {run.log_tail || "(no logs yet)"}
            </pre>
            <div className="muted" style={{ marginTop: 8, fontSize: 12 }}>
              Log file: <code>{run.log_path}</code>
            </div>
          </details>

          <details style={{ marginTop: 10 }}>
            <summary className="muted" style={{ cursor: "pointer", userSelect: "none" }}>
              Builder log (tail)
            </summary>
            <pre style={{ marginTop: 10, whiteSpace: "pre-wrap", fontSize: 12, lineHeight: 1.35 }}>
              {run.builder_log_tail || "(no builder logs yet)"}
            </pre>
            <div className="muted" style={{ marginTop: 8, fontSize: 12 }}>
              Builder log file:{" "}
              <code>{`${run.run_dir}/builder/iter-${run.builder_iteration ?? run.iteration}/codex.log`}</code>
            </div>
          </details>

          <details style={{ marginTop: 10 }}>
            <summary className="muted" style={{ cursor: "pointer", userSelect: "none" }}>
              Reviewer log (tail)
            </summary>
            <pre style={{ marginTop: 10, whiteSpace: "pre-wrap", fontSize: 12, lineHeight: 1.35 }}>
              {run.reviewer_log_tail || "(no reviewer logs yet)"}
            </pre>
            <div className="muted" style={{ marginTop: 8, fontSize: 12 }}>
              Reviewer log file:{" "}
              <code>{`${run.run_dir}/reviewer/iter-${run.iteration}/codex.log`}</code>
            </div>
          </details>

          <details style={{ marginTop: 10 }}>
            <summary className="muted" style={{ cursor: "pointer", userSelect: "none" }}>
              Tests log (tail)
            </summary>
            <pre style={{ marginTop: 10, whiteSpace: "pre-wrap", fontSize: 12, lineHeight: 1.35 }}>
              {run.tests_log_tail || "(no test logs yet)"}
            </pre>
            <div className="muted" style={{ marginTop: 8, fontSize: 12 }}>
              Tests log file: <code>{`${run.run_dir}/tests/npm-test.log`}</code>
            </div>
          </details>
        </section>
      )}
    </div>
  );
}
