"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type ActiveShift = {
  id: string;
  status: string;
  agent_type: string | null;
  agent_id: string | null;
  started_at: string;
  completed_at: string | null;
  expires_at: string | null;
  handoff_id: string | null;
  error: string | null;
};

const DEFAULT_INTERVAL_MS = 3000;

function isActiveShift(value: unknown): value is ActiveShift {
  return Boolean(value && typeof value === "object" && "id" in value);
}

export function useActiveShift(projectId: string | null, intervalMs = DEFAULT_INTERVAL_MS) {
  const [shift, setShift] = useState<ActiveShift | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlightRef = useRef(false);

  const load = useCallback(async () => {
    if (!projectId) {
      setShift(null);
      setError(null);
      setLoading(false);
      return;
    }
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(
        `/api/projects/${encodeURIComponent(projectId)}/shifts/active`,
        { cache: "no-store" }
      );
      const json = (await res.json().catch(() => null)) as unknown;
      if (!res.ok) {
        const message =
          json &&
          typeof json === "object" &&
          "error" in json &&
          typeof (json as { error?: unknown }).error === "string"
            ? ((json as { error?: string }).error ?? "failed to load shift")
            : "failed to load shift";
        throw new Error(message);
      }
      setShift(isActiveShift(json) ? json : null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed to load shift");
    } finally {
      setLoading(false);
      inFlightRef.current = false;
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!projectId) return;
    const interval = window.setInterval(() => void load(), intervalMs);
    return () => window.clearInterval(interval);
  }, [intervalMs, load, projectId]);

  return { shift, loading, error, reload: load };
}
