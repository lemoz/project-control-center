"use client";

import { useCallback, useEffect, useState } from "react";
import type { ActiveRun } from "../types";

export function useActiveRuns(refreshToken: number) {
  const [data, setData] = useState<ActiveRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/observability/runs/active", { cache: "no-store" });
      const json = (await res.json().catch(() => null)) as ActiveRun[] | { error?: string } | null;
      if (!res.ok) throw new Error((json as { error?: string } | null)?.error || "failed");
      setData(Array.isArray(json) ? json : []);
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
