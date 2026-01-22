"use client";

import { useCallback, useEffect, useState } from "react";
import type { RunFailureBreakdown } from "../types";

export function useFailureBreakdown(refreshToken: number, limit = 200) {
  const [data, setData] = useState<RunFailureBreakdown | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const url = new URL("/api/observability/runs/failure-breakdown", window.location.origin);
      url.searchParams.set("limit", String(limit));
      const res = await fetch(url.toString(), { cache: "no-store" });
      const json = (await res.json().catch(() => null)) as
        | RunFailureBreakdown
        | { error?: string }
        | null;
      if (!res.ok) throw new Error((json as { error?: string } | null)?.error || "failed");
      setData(json as RunFailureBreakdown);
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed");
    } finally {
      setLoading(false);
    }
  }, [limit]);

  useEffect(() => {
    void load();
  }, [load, refreshToken]);

  return { data, loading, error, reload: load };
}
