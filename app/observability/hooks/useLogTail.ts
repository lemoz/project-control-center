"use client";

import { useCallback, useEffect, useState } from "react";
import type { LogTail } from "../types";

const POLL_INTERVAL_MS = 2000;

export function useLogTail(runId: string | null, lines = 50) {
  const [data, setData] = useState<LogTail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!runId) {
      setData(null);
      setError(null);
      setLoading(false);
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const url = new URL(
        `/api/runs/${encodeURIComponent(runId)}/logs/tail`,
        window.location.origin
      );
      url.searchParams.set("lines", String(lines));
      const res = await fetch(url.toString(), { cache: "no-store" });
      const json = (await res.json().catch(() => null)) as LogTail | { error?: string } | null;
      if (!res.ok) throw new Error((json as { error?: string } | null)?.error || "failed");
      setData(json as LogTail);
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed");
    } finally {
      setLoading(false);
    }
  }, [lines, runId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!runId) return;
    const interval = setInterval(() => void load(), POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [load, runId]);

  return { data, loading, error, reload: load };
}
