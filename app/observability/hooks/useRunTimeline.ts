"use client";

import { useCallback, useEffect, useState } from "react";
import type { RunTimelineEntry } from "../types";

export function useRunTimeline(refreshToken: number, hours = 24) {
  const [data, setData] = useState<RunTimelineEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const url = new URL("/api/observability/runs/timeline", window.location.origin);
      url.searchParams.set("hours", String(hours));
      const res = await fetch(url.toString(), { cache: "no-store" });
      const json = (await res.json().catch(() => null)) as
        | RunTimelineEntry[]
        | { error?: string }
        | null;
      if (!res.ok) throw new Error((json as { error?: string } | null)?.error || "failed");
      setData(Array.isArray(json) ? json : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed");
    } finally {
      setLoading(false);
    }
  }, [hours]);

  useEffect(() => {
    void load();
  }, [load, refreshToken]);

  return { data, loading, error, reload: load };
}
