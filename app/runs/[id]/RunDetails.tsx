"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

type RunStatus =
  | "queued"
  | "baseline_failed"
  | "building"
  | "ai_review"
  | "testing"
  | "you_review"
  | "merged"
  | "merge_conflict"
  | "failed"
  | "canceled";

type RunIterationHistory = {
  iteration: number;
  builder_summary: string | null;
  builder_risks: string[];
  tests: Array<{ command: string; passed: boolean; output: string }>;
  reviewer_verdict: "approved" | "changes_requested" | null;
  reviewer_notes: string[] | null;
};

type RunDetails = {
  id: string;
  project_id: string;
  work_order_id: string;
  provider: string;
  status: RunStatus;
  iteration: number;
  builder_iteration: number;
  reviewer_verdict: "approved" | "changes_requested" | null;
  reviewer_notes: string | null;
  summary: string | null;
  branch_name: string | null;
  merge_status: "pending" | "merged" | "conflict" | null;
  conflict_with_run_id: string | null;
  run_dir: string;
  log_path: string;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  error: string | null;
  log_tail?: string;
  builder_log_tail?: string;
  reviewer_log_tail?: string;
  tests_log_tail?: string;
  iteration_history?: RunIterationHistory[];
};

export function RunDetails({ runId }: { runId: string }) {
  const [run, setRun] = useState<RunDetails | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

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
    if (run.status !== "queued" && run.status !== "building" && run.status !== "ai_review" && run.status !== "testing") {
      return;
    }
    const interval = setInterval(() => void load(), 2000);
    return () => clearInterval(interval);
  }, [run, load]);

  const notes: string[] = (() => {
    if (!run?.reviewer_notes) return [];
    try {
      return JSON.parse(run.reviewer_notes) as string[];
    } catch {
      return [];
    }
  })();

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
            {run?.status && <span className="badge">{run.status}</span>}
          </div>
        </div>

        {!!error && <div className="error" style={{ marginTop: 10 }}>{error}</div>}
        {loading && <div className="muted" style={{ marginTop: 10 }}>Loading…</div>}

        {!!run && (
          <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 6 }}>
            <div className="muted" style={{ fontSize: 12 }}>
              Provider: <code>{run.provider}</code> · Work Order: <code>{run.work_order_id}</code> · Builder iteration:{" "}
              <code>{run.builder_iteration ?? run.iteration}</code>
            </div>
            <div className="muted" style={{ fontSize: 12 }}>
              Branch: <code>{run.branch_name || "n/a"}</code> · Merge:{" "}
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

      {!!run?.summary && (run.status === "you_review" || run.status === "merged") && (
        <section className="card">
          <div style={{ fontWeight: 800 }}>Approved Summary</div>
          <div style={{ marginTop: 8, whiteSpace: "pre-wrap", lineHeight: 1.4 }}>{run.summary}</div>
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
