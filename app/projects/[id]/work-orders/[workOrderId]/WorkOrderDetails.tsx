"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

type WorkOrderStatus =
  | "backlog"
  | "ready"
  | "building"
  | "ai_review"
  | "you_review"
  | "done"
  | "blocked"
  | "parked";

type WorkOrder = {
  id: string;
  title: string;
  goal: string | null;
  context: string[];
  acceptance_criteria: string[];
  non_goals: string[];
  stop_conditions: string[];
  priority: number;
  tags: string[];
  base_branch: string | null;
  estimate_hours: number | null;
  status: WorkOrderStatus;
  created_at: string;
  updated_at: string;
  ready_check: { ok: boolean; errors: string[] };
};

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

type Run = {
  id: string;
  project_id: string;
  work_order_id: string;
  provider: string;
  status: RunStatus;
  iteration: number;
  reviewer_verdict: "approved" | "changes_requested" | null;
  reviewer_notes: string | null;
  summary: string | null;
  run_dir: string;
  log_path: string;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  error: string | null;
};

type WorkOrderResponse = {
  project: { id: string; name: string; path: string };
  work_order: WorkOrder;
  markdown: string;
};

type RunsResponse = { runs: Run[] };

function linesToList(input: string): string[] {
  return input
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
}

function listToLines(items: string[]): string {
  return (items ?? []).join("\n");
}

function tagsToString(tags: string[]): string {
  return (tags ?? []).join(", ");
}

function stringToTags(input: string): string[] {
  return input
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function WorkOrderDetails({
  repoId,
  workOrderId,
}: {
  repoId: string;
  workOrderId: string;
}) {
  const [project, setProject] = useState<WorkOrderResponse["project"] | null>(
    null
  );
  const [workOrder, setWorkOrder] = useState<WorkOrder | null>(null);
  const [markdown, setMarkdown] = useState<string>("");
  const [runs, setRuns] = useState<Run[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [woRes, runsRes] = await Promise.all([
        fetch(
          `/api/repos/${encodeURIComponent(repoId)}/work-orders/${encodeURIComponent(workOrderId)}`,
          { cache: "no-store" }
        ),
        fetch(`/api/repos/${encodeURIComponent(repoId)}/runs?limit=100`, {
          cache: "no-store",
        }),
      ]);

      const woJson = (await woRes.json().catch(() => null)) as
        | WorkOrderResponse
        | { error?: string }
        | null;
      if (!woRes.ok) {
        throw new Error(
          (woJson as { error?: string } | null)?.error || "failed to load"
        );
      }
      const woData = woJson as WorkOrderResponse;
      setProject(woData.project);
      setWorkOrder(woData.work_order);
      setMarkdown(woData.markdown || "");

      if (runsRes.ok) {
        const runsJson = (await runsRes.json().catch(() => null)) as
          | RunsResponse
          | null;
        const allRuns = runsJson?.runs || [];
        setRuns(allRuns.filter((r) => r.work_order_id === workOrderId));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed to load");
    } finally {
      setLoading(false);
    }
  }, [repoId, workOrderId]);

  useEffect(() => {
    void load();
  }, [load]);

  const latestRun = useMemo(() => {
    return runs.slice().sort((a, b) => b.created_at.localeCompare(a.created_at))[0] || null;
  }, [runs]);

  const [title, setTitle] = useState("");
  const [status, setStatus] = useState<WorkOrderStatus>("backlog");
  const [priority, setPriority] = useState("3");
  const [tags, setTags] = useState("");
  const [baseBranch, setBaseBranch] = useState("");
  const [estimateHours, setEstimateHours] = useState("");
  const [goal, setGoal] = useState("");
  const [context, setContext] = useState("");
  const [acceptance, setAcceptance] = useState("");
  const [nonGoals, setNonGoals] = useState("");
  const [stops, setStops] = useState("");

  useEffect(() => {
    if (!workOrder) return;
    setTitle(workOrder.title);
    setStatus(workOrder.status);
    setPriority(String(workOrder.priority));
    setTags(tagsToString(workOrder.tags));
    setBaseBranch(workOrder.base_branch ?? "");
    setEstimateHours(
      workOrder.estimate_hours === null ? "" : String(workOrder.estimate_hours)
    );
    setGoal(workOrder.goal ?? "");
    setContext(listToLines(workOrder.context));
    setAcceptance(listToLines(workOrder.acceptance_criteria));
    setNonGoals(listToLines(workOrder.non_goals));
    setStops(listToLines(workOrder.stop_conditions));
  }, [workOrder]);

  const onSave = useCallback(async () => {
    if (!workOrder) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/repos/${encodeURIComponent(repoId)}/work-orders/${encodeURIComponent(workOrderId)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: title.trim(),
            status,
            priority: Number(priority),
            tags: stringToTags(tags),
            base_branch: baseBranch.trim() ? baseBranch.trim() : null,
            estimate_hours: estimateHours.trim()
              ? Number(estimateHours)
              : null,
            goal,
            context: linesToList(context),
            acceptance_criteria: linesToList(acceptance),
            non_goals: linesToList(nonGoals),
            stop_conditions: linesToList(stops),
          }),
        }
      );
      const json = (await res.json().catch(() => null)) as
        | WorkOrder
        | { error?: string }
        | null;
      if (!res.ok) {
        throw new Error((json as { error?: string } | null)?.error || "save failed");
      }
      setWorkOrder(json as WorkOrder);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "save failed");
    } finally {
      setSaving(false);
    }
  }, [
    acceptance,
    context,
    estimateHours,
    goal,
    load,
    nonGoals,
    priority,
    repoId,
    status,
    stops,
    tags,
    baseBranch,
    title,
    workOrder,
    workOrderId,
  ]);

  const onStartRun = useCallback(async () => {
    if (!workOrder) return;
    setStarting(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/repos/${encodeURIComponent(repoId)}/work-orders/${encodeURIComponent(workOrderId)}/runs`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }
      );
      const json = (await res.json().catch(() => null)) as
        | Run
        | { error?: string }
        | null;
      if (!res.ok) {
        throw new Error((json as { error?: string } | null)?.error || "failed to start run");
      }
      const run = json as Run;
      router.push(`/runs/${encodeURIComponent(run.id)}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed to start run");
    } finally {
      setStarting(false);
    }
  }, [repoId, router, workOrder, workOrderId]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <section className="card">
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: 10,
            alignItems: "baseline",
            flexWrap: "wrap",
          }}
        >
          <div>
            <div style={{ fontWeight: 800, fontSize: 16 }}>
              {workOrder?.title || "Work Order"}
            </div>
            <div className="muted" style={{ fontSize: 12 }}>
              {project ? (
                <>
                  Project{" "}
                  <Link
                    href={`/projects/${encodeURIComponent(project.id)}`}
                    className="badge"
                  >
                    {project.name}
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
            <button className="btn" onClick={() => void onSave()} disabled={loading || saving || !workOrder}>
              {saving ? "Saving…" : "Save"}
            </button>
            {workOrder?.status === "ready" && (
              <button className="btn" onClick={() => void onStartRun()} disabled={starting || saving || loading}>
                {starting ? "Starting…" : "Run"}
              </button>
            )}
            {workOrder?.status && <span className="badge">{workOrder.status}</span>}
          </div>
        </div>

        {!!error && (
          <div className="error" style={{ marginTop: 10 }}>
            {error}
          </div>
        )}
        {loading && (
          <div className="muted" style={{ marginTop: 10 }}>
            Loading…
          </div>
        )}

        {!!workOrder && (
          <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 6 }}>
            <div className="muted" style={{ fontSize: 12 }}>
              ID: <code>{workOrder.id}</code> · Updated: <code>{workOrder.updated_at}</code>
            </div>
            <div className="muted" style={{ fontSize: 12 }}>
              {project?.path ? (
                <>
                  Repo: <code>{project.path}</code>
                </>
              ) : null}
            </div>
          </div>
        )}
      </section>

      {!!latestRun && (
        <section className="card">
          <div style={{ fontWeight: 800 }}>Latest Run</div>
          <div style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <span className="badge">{latestRun.status}</span>
            <Link href={`/runs/${encodeURIComponent(latestRun.id)}`} className="badge">
              open
            </Link>
            {(latestRun.status === "failed" ||
              latestRun.status === "merge_conflict" ||
              latestRun.status === "baseline_failed") && (
              <span className="muted" style={{ fontSize: 12 }}>
                {latestRun.error || "Unknown error"}
              </span>
            )}
          </div>
        </section>
      )}

      {!!workOrder && (
        <section className="card">
          <div style={{ fontWeight: 800 }}>Fields</div>

          {!workOrder.ready_check.ok && (
            <div className="error" style={{ marginTop: 10 }}>
              Ready contract missing: {workOrder.ready_check.errors.join(" ")}
            </div>
          )}

          <div className="woFieldsGrid" style={{ marginTop: 10 }}>
            <label className="field" style={{ gridColumn: "1 / -1" }}>
              <div className="muted fieldLabel">Title</div>
              <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
            </label>

            <label className="field">
              <div className="muted fieldLabel">Status</div>
              <select className="select" value={status} onChange={(e) => setStatus(e.target.value as WorkOrderStatus)}>
                {(
                  [
                    "backlog",
                    "ready",
                    "building",
                    "ai_review",
                    "you_review",
                    "done",
                    "blocked",
                    "parked",
                  ] as WorkOrderStatus[]
                ).map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>

            <label className="field">
              <div className="muted fieldLabel">Priority</div>
              <select className="select" value={priority} onChange={(e) => setPriority(e.target.value)}>
                {[1, 2, 3, 4, 5].map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </label>

            <label className="field">
              <div className="muted fieldLabel">Estimate hours</div>
              <input
                className="input"
                inputMode="decimal"
                value={estimateHours}
                onChange={(e) => setEstimateHours(e.target.value)}
                placeholder="e.g. 1.5"
              />
            </label>

            <label className="field" style={{ gridColumn: "1 / -1" }}>
              <div className="muted fieldLabel">Tags (comma-separated)</div>
              <input className="input" value={tags} onChange={(e) => setTags(e.target.value)} />
            </label>

            <label className="field" style={{ gridColumn: "1 / -1" }}>
              <div className="muted fieldLabel">Base branch (optional)</div>
              <input
                className="input"
                value={baseBranch}
                onChange={(e) => setBaseBranch(e.target.value)}
                placeholder="e.g. develop"
              />
            </label>

            <label className="field" style={{ gridColumn: "1 / -1" }}>
              <div className="muted fieldLabel">Goal (required for Ready)</div>
              <textarea className="textarea" rows={3} value={goal} onChange={(e) => setGoal(e.target.value)} />
            </label>

            <label className="field" style={{ gridColumn: "1 / -1" }}>
              <div className="muted fieldLabel">Acceptance criteria (one per line, required)</div>
              <textarea className="textarea" rows={6} value={acceptance} onChange={(e) => setAcceptance(e.target.value)} />
            </label>

            <label className="field" style={{ gridColumn: "1 / -1" }}>
              <div className="muted fieldLabel">Stop conditions (one per line, required)</div>
              <textarea className="textarea" rows={5} value={stops} onChange={(e) => setStops(e.target.value)} />
            </label>

            <label className="field" style={{ gridColumn: "1 / -1" }}>
              <div className="muted fieldLabel">Context (one per line)</div>
              <textarea className="textarea" rows={4} value={context} onChange={(e) => setContext(e.target.value)} />
            </label>

            <label className="field" style={{ gridColumn: "1 / -1" }}>
              <div className="muted fieldLabel">Non-goals (one per line)</div>
              <textarea className="textarea" rows={4} value={nonGoals} onChange={(e) => setNonGoals(e.target.value)} />
            </label>
          </div>

          <div className="muted" style={{ marginTop: 10, fontSize: 12 }}>
            Saves update YAML frontmatter; body editing isn’t supported yet.
          </div>
        </section>
      )}

      {!!markdown && (
        <section className="card">
          <div style={{ fontWeight: 800 }}>Work Order Markdown</div>
          <details style={{ marginTop: 10 }}>
            <summary className="muted" style={{ cursor: "pointer", userSelect: "none" }}>
              Show raw file
            </summary>
            <pre style={{ marginTop: 10, whiteSpace: "pre-wrap", fontSize: 12, lineHeight: 1.35 }}>
              {markdown}
            </pre>
          </details>
        </section>
      )}
    </div>
  );
}
