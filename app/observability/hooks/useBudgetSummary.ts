"use client";

import { useCallback, useEffect, useState } from "react";
import type { BudgetSummary } from "../types";

export function useBudgetSummary(refreshToken: number) {
  const [data, setData] = useState<BudgetSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/observability/budget/summary", { cache: "no-store" });
      const json = (await res.json().catch(() => null)) as BudgetSummary | { error?: string } | null;
      if (!res.ok) throw new Error((json as { error?: string } | null)?.error || "failed");
      setData(json as BudgetSummary);
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshToken]);

  return { data, loading, error, reload: load };
}
