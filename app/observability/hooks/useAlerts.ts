"use client";

import { useCallback, useEffect, useState } from "react";
import type { ObservabilityAlert } from "../types";

export function useAlerts(refreshToken: number, projectId?: string | null) {
  const [data, setData] = useState<ObservabilityAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const url = new URL("/api/observability/alerts", window.location.origin);
      if (projectId) {
        url.searchParams.set("projectId", projectId);
      }
      const res = await fetch(url.toString(), { cache: "no-store" });
      const json = (await res.json().catch(() => null)) as
        | ObservabilityAlert[]
        | { error?: string }
        | null;
      if (!res.ok) throw new Error((json as { error?: string } | null)?.error || "failed");
      setData(Array.isArray(json) ? json : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load, refreshToken]);

  return { data, loading, error, reload: load };
}
