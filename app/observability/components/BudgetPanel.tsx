"use client";

import type { BudgetSummary } from "../types";

const formatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});

function formatUsd(value: number): string {
  if (!Number.isFinite(value)) return "$0.00";
  return formatter.format(value);
}

function formatDays(value: number): string {
  if (!Number.isFinite(value)) return "n/a";
  return `${Math.max(0, Math.round(value))} days`;
}

export function BudgetPanel({
  data,
  loading,
  error,
}: {
  data: BudgetSummary | null;
  loading: boolean;
  error: string | null;
}) {
  return (
    <section className="card" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 16 }}>Budget</div>
          <div className="muted" style={{ fontSize: 12 }}>
            Current monthly spend + runway.
          </div>
        </div>
        {data?.status && <span className="badge">{data.status}</span>}
      </div>

      {!!error && <div className="error">{error}</div>}
      {loading && <div className="muted">Loading budget...</div>}

      {!loading && data && (
        <div style={{ display: "grid", gap: 8 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
            <span>Monthly budget</span>
            <span>{formatUsd(data.monthly_budget)}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
            <span>Spent</span>
            <span>{formatUsd(data.spent)}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
            <span>Remaining</span>
            <span>{formatUsd(data.remaining)}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
            <span>Daily rate</span>
            <span>{formatUsd(data.daily_rate)} / day</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
            <span>Runway</span>
            <span>{formatDays(data.runway_days)}</span>
          </div>
        </div>
      )}
    </section>
  );
}
