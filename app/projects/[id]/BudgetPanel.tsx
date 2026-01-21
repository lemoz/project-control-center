"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type GlobalBudget = {
  monthly_budget_usd: number;
  current_period_start: string;
  current_period_end: string;
  allocated_usd: number;
  unallocated_usd: number;
  spent_usd: number;
  remaining_usd: number;
};

type BudgetStatus = "healthy" | "warning" | "critical" | "exhausted";

type ProjectBudget = {
  project_id: string;
  monthly_allocation_usd: number;
  spent_usd: number;
  remaining_usd: number;
  daily_drip_usd: number;
  runway_days: number;
  budget_status: BudgetStatus;
};

type RepoSummary = {
  id: string;
  name: string;
  hidden: boolean;
};

type BudgetEnforcementEvent = {
  id: string;
  project_id: string;
  event_type: string;
  details: string | null;
  created_at: string;
};

type TransferResponse = {
  from: ProjectBudget;
  to: ProjectBudget;
  global: GlobalBudget;
  error?: string;
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function formatUsd(value: number): string {
  const safe = Number.isFinite(value) ? value : 0;
  return `$${safe.toFixed(2)}`;
}

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function diffDaysInclusive(start: Date, end: Date): number {
  const startDay = startOfUtcDay(start);
  const endDay = startOfUtcDay(end);
  const diff = Math.floor((endDay.getTime() - startDay.getTime()) / MS_PER_DAY);
  return Math.max(0, diff + 1);
}

function daysRemainingLabel(periodEnd: string): string {
  const endMs = Date.parse(periodEnd);
  if (!Number.isFinite(endMs)) return "n/a";
  const daysLeft = diffDaysInclusive(new Date(), new Date(endMs));
  return `${daysLeft} day${daysLeft === 1 ? "" : "s"} left`;
}

function formatPeriodLabel(start: string, end: string): string {
  const startMs = Date.parse(start);
  const endMs = Date.parse(end);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
    return `${start} - ${end}`;
  }
  const startLabel = new Date(startMs).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
  const endLabel = new Date(endMs).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
  return `${startLabel} - ${endLabel}`;
}

function formatRunway(value: number): string {
  if (!Number.isFinite(value)) return "n/a";
  if (value <= 0) return "0";
  return value >= 1000 ? "999+" : value.toFixed(1);
}

function parseEnforcementDetails(details: string | null): Record<string, unknown> | null {
  if (!details) return null;
  try {
    const parsed = JSON.parse(details) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function formatEnforcementSummary(event: BudgetEnforcementEvent): string {
  const parsed = parseEnforcementDetails(event.details);
  if (!parsed) return "";
  const parts: string[] = [];
  const remaining = Number(parsed.remaining_usd);
  if (Number.isFinite(remaining)) parts.push(`remaining ${formatUsd(remaining)}`);
  const estimated = Number(parsed.estimated_cost_usd);
  if (Number.isFinite(estimated)) parts.push(`est run ${formatUsd(estimated)}`);
  const available = Number(parsed.available_usd ?? parsed.daily_drip_usd);
  if (Number.isFinite(available)) parts.push(`available ${formatUsd(available)}`);
  const workOrderId =
    typeof parsed.work_order_id === "string" ? parsed.work_order_id : "";
  if (workOrderId) parts.push(`WO ${workOrderId}`);
  const payload = parsed.payload;
  if (payload && typeof payload === "object") {
    const payloadRecord = payload as Record<string, unknown>;
    if (!Number.isFinite(remaining)) {
      const payloadRemaining = Number(payloadRecord.remaining_usd);
      if (Number.isFinite(payloadRemaining)) {
        parts.push(`remaining ${formatUsd(payloadRemaining)}`);
      }
    }
    const runwayDays = Number(payloadRecord.runway_days);
    if (Number.isFinite(runwayDays)) parts.push(`runway ${formatRunway(runwayDays)} days`);
  }
  return parts.join(" | ");
}

function formatTimestamp(value: string): string {
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return value;
  return new Date(ms).toLocaleString();
}

export function BudgetPanel({ repoId }: { repoId: string }) {
  const [globalBudget, setGlobalBudget] = useState<GlobalBudget | null>(null);
  const [projectBudget, setProjectBudget] = useState<ProjectBudget | null>(null);
  const [projects, setProjects] = useState<RepoSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [action, setAction] = useState<"global" | "project" | "transfer" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [monthlyBudgetInput, setMonthlyBudgetInput] = useState("");
  const [allocationInput, setAllocationInput] = useState("");
  const [transferTarget, setTransferTarget] = useState("");
  const [transferAmount, setTransferAmount] = useState("");
  const [enforcementLog, setEnforcementLog] = useState<BudgetEnforcementEvent[]>([]);
  const [dismissedAlert, setDismissedAlert] = useState(false);
  const allocationInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      const [globalRes, projectRes, reposRes, enforcementRes] = await Promise.all([
        fetch("/api/budget", { cache: "no-store" }),
        fetch(`/api/projects/${encodeURIComponent(repoId)}/budget`, { cache: "no-store" }),
        fetch("/api/repos", { cache: "no-store" }).catch(() => null),
        fetch(`/api/projects/${encodeURIComponent(repoId)}/budget/enforcement`, { cache: "no-store" }).catch(
          () => null
        ),
      ]);

      const globalJson = (await globalRes.json().catch(() => null)) as GlobalBudget | null;
      if (!globalRes.ok) {
        throw new Error((globalJson as { error?: string } | null)?.error || "failed to load global budget");
      }
      const projectJson = (await projectRes.json().catch(() => null)) as ProjectBudget | null;
      if (!projectRes.ok) {
        throw new Error((projectJson as { error?: string } | null)?.error || "failed to load project budget");
      }

      let repos: RepoSummary[] = [];
      if (reposRes && reposRes.ok) {
        const reposJson = (await reposRes.json().catch(() => null)) as RepoSummary[] | null;
        if (Array.isArray(reposJson)) repos = reposJson;
      }

      setGlobalBudget(globalJson);
      setProjectBudget(projectJson);
      setProjects(repos);

      if (enforcementRes && enforcementRes.ok) {
        const enforcementJson = (await enforcementRes.json().catch(() => null)) as
          | { events?: BudgetEnforcementEvent[] }
          | null;
        if (Array.isArray(enforcementJson?.events)) {
          setEnforcementLog(enforcementJson?.events ?? []);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed to load budget data");
    } finally {
      setLoading(false);
    }
  }, [repoId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (globalBudget) {
      setMonthlyBudgetInput(globalBudget.monthly_budget_usd.toFixed(2));
    }
  }, [globalBudget]);

  useEffect(() => {
    if (projectBudget) {
      setAllocationInput(projectBudget.monthly_allocation_usd.toFixed(2));
    }
  }, [projectBudget]);

  useEffect(() => {
    if (!projectBudget) return;
    setDismissedAlert(false);
  }, [projectBudget?.budget_status]);

  const setTimedNotice = useCallback((message: string) => {
    setNotice(message);
    setTimeout(() => setNotice(null), 2500);
  }, []);

  const saveGlobalBudget = useCallback(async () => {
    const value = Number(monthlyBudgetInput);
    if (!Number.isFinite(value) || value < 0) {
      setError("Monthly budget must be a non-negative number.");
      return;
    }
    setAction("global");
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/budget", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ monthly_budget_usd: value }),
      });
      const json = (await res.json().catch(() => null)) as GlobalBudget | null;
      if (!res.ok) {
        throw new Error((json as { error?: string } | null)?.error || "failed to update global budget");
      }
      setGlobalBudget(json);
      setTimedNotice("Global budget saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed to update global budget");
    } finally {
      setAction(null);
    }
  }, [monthlyBudgetInput, setTimedNotice]);

  const saveProjectBudget = useCallback(async () => {
    const value = Number(allocationInput);
    if (!Number.isFinite(value) || value < 0) {
      setError("Project allocation must be a non-negative number.");
      return;
    }
    setAction("project");
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(repoId)}/budget`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ monthly_allocation_usd: value }),
      });
      const json = (await res.json().catch(() => null)) as ProjectBudget | null;
      if (!res.ok) {
        throw new Error((json as { error?: string } | null)?.error || "failed to update project budget");
      }
      setProjectBudget(json);
      const globalRes = await fetch("/api/budget", { cache: "no-store" });
      const globalJson = (await globalRes.json().catch(() => null)) as GlobalBudget | null;
      if (globalRes.ok && globalJson) {
        setGlobalBudget(globalJson);
      } else {
        setError(
          (globalJson as { error?: string } | null)?.error ||
            "Project budget saved, but failed to refresh global totals."
        );
      }
      setTimedNotice("Project budget saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed to update project budget");
    } finally {
      setAction(null);
    }
  }, [allocationInput, repoId, setTimedNotice]);

  const transferBudget = useCallback(async () => {
    const value = Number(transferAmount);
    if (!transferTarget) {
      setError("Select a target project.");
      return;
    }
    if (!Number.isFinite(value) || value <= 0) {
      setError("Transfer amount must be a positive number.");
      return;
    }
    setAction("transfer");
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(repoId)}/budget/transfer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to_project_id: transferTarget,
          amount_usd: value,
        }),
      });
      const json = (await res.json().catch(() => null)) as TransferResponse | null;
      if (!res.ok) {
        throw new Error((json as { error?: string } | null)?.error || "failed to transfer budget");
      }
      if (json?.global) setGlobalBudget(json.global);
      if (json?.from) setProjectBudget(json.from);
      setTransferAmount("");
      setTimedNotice("Budget transferred.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed to transfer budget");
    } finally {
      setAction(null);
    }
  }, [repoId, transferAmount, transferTarget, setTimedNotice]);

  const allocationPercent = useMemo(() => {
    if (!globalBudget || globalBudget.monthly_budget_usd <= 0) return 0;
    const pct = (globalBudget.allocated_usd / globalBudget.monthly_budget_usd) * 100;
    return Math.max(0, Math.min(100, pct));
  }, [globalBudget]);

  const periodLabel = useMemo(() => {
    if (!globalBudget) return "n/a";
    return `${formatPeriodLabel(
      globalBudget.current_period_start,
      globalBudget.current_period_end
    )} (${daysRemainingLabel(globalBudget.current_period_end)})`;
  }, [globalBudget]);

  const projectOptions = useMemo(() => {
    return projects
      .filter((project) => project.id !== repoId)
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [projects, repoId]);

  const budgetAlert = useMemo(() => {
    if (!projectBudget || dismissedAlert) return null;
    if (projectBudget.budget_status === "healthy") return null;
    const label =
      projectBudget.budget_status === "warning"
        ? "Budget warning"
        : projectBudget.budget_status === "critical"
          ? "Budget critical"
          : "Budget exhausted";
    return {
      label,
      status: projectBudget.budget_status,
      remaining: formatUsd(projectBudget.remaining_usd),
      runway: formatRunway(projectBudget.runway_days),
    };
  }, [projectBudget, dismissedAlert]);

  return (
    <section
      id="budget"
      className="card"
      style={{ display: "flex", flexDirection: "column", gap: 12 }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
        <div>
          <h2 style={{ margin: 0 }}>Budgets</h2>
          <div className="muted" style={{ fontSize: 13 }}>
            Allocate monthly spend, track runway, and shift funds between projects.
          </div>
        </div>
        <button className="btnSecondary" onClick={() => void load()} disabled={loading || action !== null}>
          Refresh
        </button>
      </div>

      {!!error && <div className="error">{error}</div>}
      {!!notice && <div className="notice">{notice}</div>}
      {loading && <div className="muted">Loading...</div>}

      {!loading && globalBudget && projectBudget && (
        <>
          {budgetAlert && (
            <div
              style={{
                border: "1px solid",
                borderColor:
                  budgetAlert.status === "warning" ? "#2b3b57" : "#5a2a33",
                borderRadius: 12,
                padding: 12,
                background:
                  budgetAlert.status === "warning"
                    ? "rgba(38, 54, 85, 0.35)"
                    : "rgba(92, 32, 44, 0.35)",
                display: "flex",
                flexDirection: "column",
                gap: 6,
              }}
            >
              <div style={{ fontWeight: 700 }}>{budgetAlert.label}</div>
              <div className="muted" style={{ fontSize: 13 }}>
                Remaining: {budgetAlert.remaining} | Runway: {budgetAlert.runway} days
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button
                  className="btn"
                  onClick={() => allocationInputRef.current?.focus()}
                  disabled={action !== null}
                >
                  Add Funds
                </button>
                <button
                  className="btnSecondary"
                  onClick={() => setDismissedAlert(true)}
                  disabled={action !== null}
                >
                  Ignore
                </button>
              </div>
            </div>
          )}
          <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", alignItems: "start" }}>
            <div
              style={{
                border: "1px solid #22293a",
                borderRadius: 12,
                padding: 14,
                background: "#0f1320",
                display: "flex",
                flexDirection: "column",
                gap: 8,
              }}
            >
              <div style={{ fontWeight: 700 }}>Global monthly budget</div>
              <div style={{ fontSize: 18 }}>{formatUsd(globalBudget.monthly_budget_usd)}</div>
              <div className="muted" style={{ fontSize: 12 }}>
                Allocated: {formatUsd(globalBudget.allocated_usd)} ({Math.round(allocationPercent)}%)
              </div>
              <div className="progressTrack">
                <div className="progressFill" style={{ width: `${allocationPercent}%` }} />
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                <span className="muted">Unallocated</span>
                <span>{formatUsd(globalBudget.unallocated_usd)}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                <span className="muted">Spent</span>
                <span>{formatUsd(globalBudget.spent_usd)}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                <span className="muted">Remaining</span>
                <span>{formatUsd(globalBudget.remaining_usd)}</span>
              </div>
              <div className="muted" style={{ fontSize: 12 }}>
                Period: {periodLabel}
              </div>
            </div>

            <div
              style={{
                border: "1px solid #22293a",
                borderRadius: 12,
                padding: 14,
                background: "#0f1320",
                display: "flex",
                flexDirection: "column",
                gap: 8,
              }}
            >
              <div style={{ fontWeight: 700 }}>Project allocation</div>
              <div style={{ fontSize: 18 }}>{formatUsd(projectBudget.monthly_allocation_usd)}</div>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                <span className="muted">Spent</span>
                <span>{formatUsd(projectBudget.spent_usd)}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                <span className="muted">Remaining</span>
                <span>{formatUsd(projectBudget.remaining_usd)}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                <span className="muted">Daily drip</span>
                <span>{formatUsd(projectBudget.daily_drip_usd)}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                <span className="muted">Runway</span>
                <span>{formatRunway(projectBudget.runway_days)} days</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
                <span className="muted">Status</span>
                <span className="badge">{projectBudget.budget_status}</span>
              </div>
            </div>
          </div>

          <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", alignItems: "end" }}>
            <div className="field">
              <div className="fieldLabel muted">Monthly budget (USD)</div>
              <input
                className="input"
                type="number"
                min="0"
                step="0.01"
                value={monthlyBudgetInput}
                onChange={(e) => setMonthlyBudgetInput(e.target.value)}
                disabled={action !== null}
              />
            </div>
            <div>
              <button className="btn" onClick={() => void saveGlobalBudget()} disabled={action !== null}>
                {action === "global" ? "Saving..." : "Save Global Budget"}
              </button>
            </div>
            <div className="field">
              <div className="fieldLabel muted">Project allocation (USD)</div>
              <input
                className="input"
                type="number"
                min="0"
                step="0.01"
                ref={allocationInputRef}
                value={allocationInput}
                onChange={(e) => setAllocationInput(e.target.value)}
                disabled={action !== null}
              />
            </div>
            <div>
              <button className="btn" onClick={() => void saveProjectBudget()} disabled={action !== null}>
                {action === "project" ? "Saving..." : "Save Project Budget"}
              </button>
            </div>
          </div>

          <div id="budget-transfer" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ fontWeight: 700 }}>Transfer budget</div>
            <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", alignItems: "end" }}>
              <div className="field">
                <div className="fieldLabel muted">To project</div>
                <select
                  className="select"
                  value={transferTarget}
                  onChange={(e) => setTransferTarget(e.target.value)}
                  disabled={action !== null}
                >
                  <option value="">Select project</option>
                  {projectOptions.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name} ({project.id})
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <div className="fieldLabel muted">Amount (USD)</div>
                <input
                  className="input"
                  type="number"
                  min="0"
                  step="0.01"
                  value={transferAmount}
                  onChange={(e) => setTransferAmount(e.target.value)}
                  disabled={action !== null}
                />
              </div>
              <div>
                <button className="btnSecondary" onClick={() => void transferBudget()} disabled={action !== null}>
                  {action === "transfer" ? "Transferring..." : "Transfer"}
                </button>
              </div>
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ fontWeight: 700 }}>Budget enforcement log</div>
            {enforcementLog.length === 0 ? (
              <div className="muted" style={{ fontSize: 12 }}>
                No enforcement events yet.
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {enforcementLog.slice(0, 10).map((event) => {
                  const summary = formatEnforcementSummary(event);
                  return (
                    <div
                      key={event.id}
                      style={{
                        border: "1px solid #22293a",
                        borderRadius: 10,
                        padding: 10,
                        background: "#0f1320",
                        display: "flex",
                        flexDirection: "column",
                        gap: 4,
                      }}
                    >
                      <div style={{ fontSize: 12, fontWeight: 600 }}>
                        {event.event_type} | {formatTimestamp(event.created_at)}
                      </div>
                      {summary && (
                        <div className="muted" style={{ fontSize: 12 }}>
                          {summary}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
}
