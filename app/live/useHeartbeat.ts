"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type ActiveRunHeartbeat = {
  id: string;
  work_order_id: string;
  status: string;
  phase: string;
  current_activity: string;
};

type ActiveShiftHeartbeat = {
  shift_id: string;
  project_id: string;
  project_name: string;
  current_activity: string;
};

export type HeartbeatData = {
  activeRuns: ActiveRunHeartbeat[];
  activeShifts: ActiveShiftHeartbeat[];
};

type RawHeartbeatResponse = {
  ok: boolean;
  active_runs?: Array<{
    id: string;
    work_order_id: string;
    status: string;
    phase: string;
    current_activity: string;
  }>;
  active_shifts?: Array<{
    shift_id: string;
    project_id: string;
    project_name: string;
    current_activity: string;
  }>;
};

const HEARTBEAT_INTERVAL_MS = 4_000;

export function useHeartbeat(enabled: boolean): {
  data: HeartbeatData | null;
  loading: boolean;
} {
  const [data, setData] = useState<HeartbeatData | null>(null);
  const [loading, setLoading] = useState(false);
  const mountedRef = useRef(true);

  const poll = useCallback(async () => {
    try {
      const res = await fetch("/api/heartbeat", { cache: "no-store" });
      if (!res.ok) return;
      const json = (await res.json()) as RawHeartbeatResponse;
      if (!mountedRef.current) return;
      setData({
        activeRuns: (json.active_runs ?? []).map((r) => ({
          id: r.id,
          work_order_id: r.work_order_id,
          status: r.status,
          phase: r.phase,
          current_activity: r.current_activity,
        })),
        activeShifts: (json.active_shifts ?? []).map((s) => ({
          shift_id: s.shift_id,
          project_id: s.project_id,
          project_name: s.project_name,
          current_activity: s.current_activity,
        })),
      });
    } catch {
      // Silently ignore heartbeat fetch errors
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!enabled) {
      setData(null);
      return;
    }
    setLoading(true);
    void poll();
    const timer = window.setInterval(() => {
      void poll();
    }, HEARTBEAT_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [enabled, poll]);

  return { data, loading };
}
