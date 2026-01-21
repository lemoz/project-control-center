"use client";

import { useEffect, useMemo, useState } from "react";

type BudgetStatus = "healthy" | "warning" | "critical" | "exhausted";

export type BudgetRunBlockReason =
  | "budget_exhausted"
  | "budget_critical"
  | "survival_queue"
  | "survival_priority";

export type BudgetRunBlockedDetails = {
  block_reason: BudgetRunBlockReason;
  project_id: string;
  work_order_id: string;
  budget_status: BudgetStatus;
  remaining_usd: number;
  allocation_usd: number;
  daily_drip_usd: number;
  estimated_cost_usd: number;
  next_available: string | null;
  queued_runs: string[];
  queue_head: string | null;
};

type BudgetRunBlockedCardProps = {
  message?: string | null;
  details: BudgetRunBlockedDetails;
  projectId: string;
  budgetHref: string;
};

function formatUsd(value: number): string {
  const safe = Number.isFinite(value) ? value : 0;
  const sign = safe < 0 ? "-" : "";
  return `${sign}$${Math.abs(safe).toFixed(2)}`;
}

function formatHoursUntil(value: string | null): string | null {
  if (!value) return null;
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return null;
  const diffMs = ms - Date.now();
  const hours = Math.max(0, diffMs / (1000 * 60 * 60));
  return `${hours.toFixed(1)} hours`;
}

export function isBudgetRunBlockedDetails(value: unknown): value is BudgetRunBlockedDetails {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  if (typeof record.block_reason !== "string") return false;
  if (typeof record.project_id !== "string") return false;
  if (typeof record.work_order_id !== "string") return false;
  if (typeof record.budget_status !== "string") return false;
  if (typeof record.remaining_usd !== "number") return false;
  if (typeof record.allocation_usd !== "number") return false;
  if (typeof record.daily_drip_usd !== "number") return false;
  if (typeof record.estimated_cost_usd !== "number") return false;
  if (!Array.isArray(record.queued_runs)) return false;
  return true;
}

export function BudgetRunBlockedCard({
  message,
  details,
  projectId,
  budgetHref,
}: BudgetRunBlockedCardProps) {
  const [action, setAction] = useState<"add50" | "add100" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [allocation, setAllocation] = useState(details.allocation_usd);

  useEffect(() => {
    setAllocation(details.allocation_usd);
  }, [details.allocation_usd]);

  const resetLabel =
    details.block_reason === "survival_queue"
      ? formatHoursUntil(details.next_available)
      : null;
  const queuedLabel = useMemo(() => {
    if (!details.queued_runs.length) return null;
    const preview = details.queued_runs.slice(0, 3).join(", ");
    const extra =
      details.queued_runs.length > 3 ? ` +${details.queued_runs.length - 3}` : "";
    return `${preview}${extra}`;
  }, [details.queued_runs]);

  const addFunds = async (amount: number, nextAction: "add50" | "add100") => {
    setAction(nextAction);
    setError(null);
    setNotice(null);
    const nextAllocation = allocation + amount;
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/budget`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ monthly_allocation_usd: nextAllocation }),
      });
      const json = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) {
        throw new Error(json?.error || "failed to update budget");
      }
      setAllocation(nextAllocation);
      setNotice(`Added ${formatUsd(amount)} to project budget.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed to update budget");
    } finally {
      setAction(null);
    }
  };

  return (
    <section className="card" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ fontWeight: 700 }}>Cannot start run</div>
      <div className="muted" style={{ fontSize: 13 }}>
        {message || "Budget blocked this run. Add more funds to continue."}
      </div>
      <div style={{ display: "grid", gap: 6, fontSize: 13 }}>
        <div>
          Work Order: <code>{details.work_order_id}</code>
        </div>
        <div>
          Remaining: {formatUsd(details.remaining_usd)} | Estimated run cost:{" "}
          {formatUsd(details.estimated_cost_usd)}
        </div>
        {details.daily_drip_usd > 0 && (
          <div>Daily drip: {formatUsd(details.daily_drip_usd)}</div>
        )}
        {resetLabel && <div>Daily drip resets in: {resetLabel}</div>}
        {details.queue_head && details.queue_head !== details.work_order_id && (
          <div>Queue priority: {details.queue_head} is ahead</div>
        )}
        {queuedLabel && <div>Queued runs: {queuedLabel}</div>}
      </div>

      {!!notice && <div className="notice">{notice}</div>}
      {!!error && <div className="error">{error}</div>}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button
          className="btn"
          onClick={() => void addFunds(50, "add50")}
          disabled={action !== null}
        >
          {action === "add50" ? "Adding..." : "Add $50"}
        </button>
        <button
          className="btn"
          onClick={() => void addFunds(100, "add100")}
          disabled={action !== null}
        >
          {action === "add100" ? "Adding..." : "Add $100"}
        </button>
        <a className="btnSecondary" href={budgetHref}>
          Transfer from...
        </a>
      </div>
    </section>
  );
}
