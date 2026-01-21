"use client";

import { useCallback, useEffect, useMemo, useState, type MouseEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  BudgetRunBlockedCard,
  isBudgetRunBlockedDetails,
  type BudgetRunBlockedDetails,
} from "../../components/BudgetRunBlockedCard";

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
  estimate_hours: number | null;
  status: WorkOrderStatus;
  created_at: string;
  updated_at: string;
  ready_check: { ok: boolean; errors: string[] };
};

type WorkOrdersResponse = {
  project: { id: string; name: string; path: string };
  work_orders: WorkOrder[];
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

type RunsResponse = {
  runs: Run[];
};

const SUCCESS_CRITERIA_SUGGESTION = "Define success criteria";

const COLUMNS: Array<{ status: WorkOrderStatus; label: string }> = [
  { status: "backlog", label: "Backlog" },
  { status: "ready", label: "Ready" },
  { status: "building", label: "Building" },
  { status: "ai_review", label: "AI Review" },
  { status: "you_review", label: "You Review" },
  { status: "done", label: "Done" },
  { status: "blocked", label: "Blocked" },
  { status: "parked", label: "Parked" },
];

export function KanbanBoard({ repoId }: { repoId: string }) {
  const [project, setProject] = useState<WorkOrdersResponse["project"] | null>(
    null
  );
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [blockedDetails, setBlockedDetails] = useState<BudgetRunBlockedDetails | null>(null);
  const [blockedMessage, setBlockedMessage] = useState<string | null>(null);
  const [pendingIds, setPendingIds] = useState<Record<string, boolean>>({});
  const [newTitle, setNewTitle] = useState("");
  const [creating, setCreating] = useState(false);
  const [startingRunForId, setStartingRunForId] = useState<string | null>(null);
  const router = useRouter();

  const latestRunByWorkOrderId = useMemo(() => {
    const map = new Map<string, Run>();
    for (const r of runs) {
      if (!map.has(r.work_order_id)) map.set(r.work_order_id, r);
    }
    return map;
  }, [runs]);

  const grouped = useMemo(() => {
    const map = new Map<WorkOrderStatus, WorkOrder[]>(
      COLUMNS.map((c) => [c.status, []])
    );
    for (const wo of workOrders) {
      // Determine effective status based on active run
      const latestRun = latestRunByWorkOrderId.get(wo.id);
      let effectiveStatus = wo.status;
      if (latestRun) {
        if (latestRun.status === "waiting_for_input") {
          effectiveStatus = "blocked";
        } else if (
          latestRun.status === "queued" ||
          latestRun.status === "building" ||
          latestRun.status === "testing"
        ) {
          effectiveStatus = "building";
        } else if (latestRun.status === "ai_review") {
          effectiveStatus = "ai_review";
        } else if (latestRun.status === "you_review" && wo.status !== "done") {
          effectiveStatus = "you_review";
        }
      }
      const arr = map.get(effectiveStatus);
      if (!arr) continue;
      arr.push(wo);
    }
    for (const [status, items] of map.entries()) {
      items.sort((a, b) => {
        if (a.priority !== b.priority) return a.priority - b.priority;
        return b.updated_at.localeCompare(a.updated_at);
      });
      map.set(status, items);
    }
    return map;
  }, [workOrders, latestRunByWorkOrderId]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [woRes, runsRes] = await Promise.all([
        fetch(`/api/repos/${encodeURIComponent(repoId)}/work-orders`, { cache: "no-store" }),
        fetch(`/api/repos/${encodeURIComponent(repoId)}/runs?limit=50`, { cache: "no-store" }),
      ]);

      const woJson = (await woRes.json().catch(() => null)) as
        | WorkOrdersResponse
        | { error?: string }
        | null;
      if (!woRes.ok) {
        throw new Error((woJson as { error?: string } | null)?.error || "failed");
      }
      const woData = woJson as WorkOrdersResponse;
      setProject(woData.project);
      setWorkOrders(woData.work_orders);

      if (runsRes.ok) {
        const runsJson = (await runsRes.json().catch(() => null)) as RunsResponse | null;
        setRuns(runsJson?.runs || []);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed to load");
    } finally {
      setLoading(false);
    }
  }, [repoId]);

  useEffect(() => {
    void load();
  }, [load]);

  const patch = useCallback(
    async (id: string, body: Record<string, unknown>) => {
      setPendingIds((p) => ({ ...p, [id]: true }));
      setError(null);
      try {
        const res = await fetch(
          `/api/repos/${encodeURIComponent(repoId)}/work-orders/${encodeURIComponent(id)}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          }
        );
        const json = (await res.json().catch(() => null)) as WorkOrder | {
          error?: string;
          details?: unknown;
        } | null;
        if (!res.ok) {
          const msg =
            (json as { error?: string } | null)?.error || "update failed";
          const details = (json as { details?: unknown } | null)?.details;
          throw new Error(
            details && typeof details === "object"
              ? `${msg}`
              : msg
          );
        }
        const updated = json as WorkOrder;
        setWorkOrders((prev) =>
          prev.map((w) => (w.id === updated.id ? updated : w))
        );
      } catch (e) {
        setError(e instanceof Error ? e.message : "update failed");
      } finally {
        setPendingIds((p) => {
          const next = { ...p };
          delete next[id];
          return next;
        });
      }
    },
    [repoId]
  );

  const create = useCallback(async (titleOverride?: string) => {
    const title = (titleOverride ?? newTitle).trim();
    if (!title) return;
    setCreating(true);
    setError(null);
    try {
      const res = await fetch(`/api/repos/${encodeURIComponent(repoId)}/work-orders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      });
      const json = (await res.json().catch(() => null)) as WorkOrder | {
        error?: string;
      } | null;
      if (!res.ok) {
        throw new Error((json as { error?: string } | null)?.error || "create failed");
      }
      setNewTitle("");
      const created = json as WorkOrder;
      setWorkOrders((prev) => [created, ...prev]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "create failed");
    } finally {
      setCreating(false);
    }
  }, [newTitle, repoId]);

  const startRun = useCallback(
    async (workOrderId: string) => {
      setStartingRunForId(workOrderId);
      setError(null);
      setBlockedDetails(null);
      setBlockedMessage(null);
      try {
        const res = await fetch(
          `/api/repos/${encodeURIComponent(repoId)}/work-orders/${encodeURIComponent(workOrderId)}/runs`,
          { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }
        );
        const json = (await res.json().catch(() => null)) as
          | Run
          | { error?: string; details?: unknown }
          | null;
        if (!res.ok) {
          const message =
            (json as { error?: string } | null)?.error || "failed to start run";
          const details = (json as { details?: unknown } | null)?.details;
          if (details && isBudgetRunBlockedDetails(details)) {
            setBlockedDetails(details);
            setBlockedMessage(message);
            return;
          }
          throw new Error(message);
        }
        const run = json as Run;
        setRuns((prev) => [run, ...prev]);
        router.push(`/runs/${encodeURIComponent(run.id)}`);
      } catch (e) {
        setError(e instanceof Error ? e.message : "failed to start run");
      } finally {
        setStartingRunForId(null);
      }
    },
    [repoId, router]
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <section className="card">
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
          <div style={{ fontWeight: 700, fontSize: 16 }}>
            {project?.name || `Project ${repoId}`}
          </div>
          {project?.path && (
            <div className="muted" style={{ fontSize: 12 }}>
              {project.path}
            </div>
          )}
          <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
            <button className="btn" onClick={() => void load()} disabled={loading}>
              Refresh
            </button>
          </div>
        </div>

        <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <input
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="New Work Order title…"
            className="input"
            style={{ flex: "1 1 260px" }}
          />
          <button className="btn" onClick={() => void create()} disabled={creating || !newTitle.trim()}>
            {creating ? "Creating…" : "Create"}
          </button>
        </div>

        {!loading && !error && workOrders.length === 0 && (
          <div style={{ marginTop: 10, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <div className="muted" style={{ fontSize: 12 }}>
              Suggested first Work Order:
              <span style={{ fontWeight: 600, marginLeft: 6 }}>{SUCCESS_CRITERIA_SUGGESTION}</span>
            </div>
            <button
              className="btnSecondary"
              onClick={() => void create(SUCCESS_CRITERIA_SUGGESTION)}
              disabled={creating}
            >
              Create suggestion
            </button>
          </div>
        )}

        {!!error && (
          <div className="error" style={{ marginTop: 10 }}>
            {error}
          </div>
        )}
        {blockedDetails && (
          <div style={{ marginTop: 10 }}>
            <BudgetRunBlockedCard
              message={blockedMessage}
              details={blockedDetails}
              projectId={repoId}
              budgetHref="#budget-transfer"
            />
          </div>
        )}
        {loading && (
          <div className="muted" style={{ marginTop: 10, fontSize: 13 }}>
            Loading…
          </div>
        )}
      </section>

      <section className="board">
        {COLUMNS.map((col) => {
          const items = grouped.get(col.status) ?? [];
          return (
            <div key={col.status} className="card column">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
                <div style={{ fontWeight: 700 }}>{col.label}</div>
                <div className="muted" style={{ fontSize: 12 }}>{items.length}</div>
              </div>

              <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 10 }}>
                {items.map((wo) => (
                  <WorkOrderCard
                    key={wo.id}
                    repoId={repoId}
                    workOrder={wo}
                    disabled={!!pendingIds[wo.id]}
                    latestRun={latestRunByWorkOrderId.get(wo.id) || null}
                    startingRun={startingRunForId === wo.id}
                    onPatch={(body) => void patch(wo.id, body)}
                    onStartRun={() => void startRun(wo.id)}
                  />
                ))}

                {!items.length && (
                  <div className="muted" style={{ fontSize: 13 }}>
                    No cards.
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </section>
    </div>
  );
}

function WorkOrderCard({
  repoId,
  workOrder,
  disabled,
  latestRun,
  startingRun,
  onPatch,
  onStartRun,
}: {
  repoId: string;
  workOrder: WorkOrder;
  disabled: boolean;
  latestRun: Run | null;
  startingRun: boolean;
  onPatch: (body: Record<string, unknown>) => void;
  onStartRun: () => void;
}) {
  const router = useRouter();
  const inspectHref = `/projects/${encodeURIComponent(repoId)}/work-orders/${encodeURIComponent(workOrder.id)}`;

  const onCardClick = (e: MouseEvent<HTMLDivElement>) => {
    if (disabled) return;
    const target = e.target as HTMLElement | null;
    if (!target) return;
    const interactive = target.closest("button, a, select, input, textarea, label, summary");
    if (interactive) return;
    router.push(inspectHref);
  };

  const canRun = workOrder.status === "ready";
  const runInProgress =
    latestRun?.status === "queued" ||
    latestRun?.status === "building" ||
    latestRun?.status === "waiting_for_input" ||
    latestRun?.status === "ai_review" ||
    latestRun?.status === "testing";

  return (
    <div
      className="woCard"
      role="button"
      tabIndex={0}
      onClick={onCardClick}
      onKeyDown={(e) => {
        if (disabled) return;
        if (e.key !== "Enter" && e.key !== " ") return;
        e.preventDefault();
        router.push(inspectHref);
      }}
      style={{ cursor: disabled ? "default" : "pointer" }}
      aria-label={`Inspect ${workOrder.id}`}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
        <div style={{ minWidth: 0 }}>
          <div className="muted" style={{ fontSize: 13 }}>
            {workOrder.id} · p{workOrder.priority}
          </div>
          <div style={{ fontWeight: 650, marginTop: 2, lineHeight: 1.25, fontSize: 16 }}>
            {workOrder.title}
          </div>
          {!!workOrder.tags.length && (
            <div style={{ marginTop: 6, display: "flex", gap: 6, flexWrap: "wrap" }}>
              {workOrder.tags.slice(0, 4).map((t) => (
                <span key={t} className="badge">
                  {t}
                </span>
              ))}
            </div>
          )}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-end" }}>
          <select
            className="select"
            value={workOrder.status}
            disabled={disabled}
            style={{ minWidth: 140 }}
            onChange={(e) => onPatch({ status: e.target.value })}
          >
            {COLUMNS.map((c) => (
              <option key={c.status} value={c.status}>
                {c.label}
              </option>
            ))}
          </select>
	          <Link
	            className="btnSecondary"
	            href={inspectHref}
	          >
	            Inspect
	          </Link>
        </div>
      </div>

      <div style={{ marginTop: 10, display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          {latestRun && (
            <>
              <span className="badge">run: {latestRun.status}</span>
              <Link href={`/runs/${encodeURIComponent(latestRun.id)}`} className="badge">
                open
              </Link>
            </>
          )}
          {!latestRun && <span className="muted" style={{ fontSize: 12 }}>No runs yet.</span>}
        </div>

        {canRun && (
          <button className="btn" onClick={onStartRun} disabled={disabled || startingRun || runInProgress}>
            {startingRun ? "Starting…" : runInProgress ? "Running…" : "Run"}
          </button>
        )}
      </div>

      {(latestRun?.status === "failed" ||
        latestRun?.status === "merge_conflict" ||
        latestRun?.status === "baseline_failed") && (
        <div className="error" style={{ marginTop: 10 }}>
          <div style={{ fontWeight: 700 }}>
            {latestRun?.status === "merge_conflict"
              ? "Last run hit merge conflict"
              : latestRun?.status === "baseline_failed"
                ? "Last run failed baseline tests"
                : "Last run failed"}
          </div>
          <div style={{ marginTop: 6 }}>
            {latestRun.error?.trim() || "Unknown error"}
          </div>
          <div style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap" }}>
            <span className="badge">run id: {latestRun.id.slice(0, 8)}</span>
            <Link href={`/runs/${encodeURIComponent(latestRun.id)}`} className="badge">
              open logs
            </Link>
          </div>
        </div>
      )}

      {workOrder.status === "backlog" && !workOrder.ready_check.ok && (
        <div className="muted" style={{ marginTop: 8, fontSize: 12 }}>
          Needs goal, acceptance criteria, stop conditions to move to Ready.
        </div>
      )}

      {!!workOrder.goal?.trim() && <div className="woGoal">{workOrder.goal}</div>}

      {(workOrder.status === "ready" || workOrder.status === "building") && !workOrder.ready_check.ok && (
        <div className="error" style={{ marginTop: 8 }}>
          Ready contract missing: {workOrder.ready_check.errors.join(" ")}
        </div>
      )}

    </div>
  );
}
