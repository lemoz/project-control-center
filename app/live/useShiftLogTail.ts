"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type ShiftLogTail = {
  lines: string[];
  has_more: boolean;
  log_path?: string;
};

type ShiftLogOptions = {
  lines?: number;
  intervalMs?: number;
};

const DEFAULT_LINES = 120;
const DEFAULT_INTERVAL_MS = 2000;

export function useShiftLogTail(
  projectId: string | null,
  shiftId: string | null,
  options: ShiftLogOptions = {}
) {
  const lines = options.lines ?? DEFAULT_LINES;
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
  const [data, setData] = useState<ShiftLogTail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const inFlightRef = useRef(false);
  const hasLoadedRef = useRef(false);

  const load = useCallback(async () => {
    if (!projectId || !shiftId) {
      setData(null);
      setError(null);
      setLoading(false);
      hasLoadedRef.current = false;
      return;
    }
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setError(null);
    // Only show loading on initial load, not on refetches
    if (!hasLoadedRef.current) {
      setLoading(true);
    }
    try {
      const url = new URL(
        `/api/projects/${encodeURIComponent(projectId)}/shifts/${encodeURIComponent(
          shiftId
        )}/logs`,
        window.location.origin
      );
      url.searchParams.set("tail", String(lines));
      const res = await fetch(url.toString(), { cache: "no-store" });
      const json = (await res.json().catch(() => null)) as ShiftLogTail | { error?: string } | null;
      if (!res.ok) {
        throw new Error((json as { error?: string } | null)?.error || "failed");
      }
      setData(json as ShiftLogTail);
      setLastUpdated(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed");
    } finally {
      setLoading(false);
      inFlightRef.current = false;
      hasLoadedRef.current = true;
    }
  }, [lines, projectId, shiftId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!projectId || !shiftId) return;
    const interval = window.setInterval(() => void load(), intervalMs);
    return () => window.clearInterval(interval);
  }, [intervalMs, load, projectId, shiftId]);

  return { data, loading, error, lastUpdated, reload: load };
}
