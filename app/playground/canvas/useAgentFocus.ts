"use client";

import { useEffect, useRef, useState } from "react";
import type { RunStatus } from "./types";

type ShiftContextRun = {
  id: string;
  work_order_id: string;
  started_at: string;
  status: RunStatus;
};

type ShiftContextHandoff = {
  created_at: string;
  next_priorities: string[];
  decisions_made: Array<{ decision: string; rationale: string }>;
};

type ShiftContext = {
  active_runs: ShiftContextRun[];
  last_handoff: ShiftContextHandoff | null;
  assembled_at: string;
};

export type AgentFocus = {
  kind: "work_order" | "none";
  workOrderId?: string;
  runId?: string;
  status?: RunStatus;
  source: "active_run" | "handoff" | "log" | "idle";
  updatedAt: string;
};

type FocusSyncOptions = {
  intervalMs?: number;
  hiddenIntervalMs?: number;
  debounceMs?: number;
};

type ActiveShift = {
  id: string;
  started_at?: string | null;
};

type ShiftLogTail = {
  lines: string[];
  has_more: boolean;
  log_path?: string;
};

const RUN_STATUS_PRIORITY: RunStatus[][] = [
  ["security_hold"],
  ["waiting_for_input"],
  ["you_review", "ai_review"],
  ["testing"],
  ["building", "queued"],
];

const WO_ID_REGEX = /WO-\d{4}-\d+/;
const WO_ID_REGEX_GLOBAL = /WO-\d{4}-\d+/g;
const LOG_TAIL_LINES = 160;

function usePageVisibility(): boolean {
  const [isVisible, setIsVisible] = useState(
    typeof document === "undefined" ? true : document.visibilityState !== "hidden"
  );

  useEffect(() => {
    if (typeof document === "undefined") return;
    const onChange = () => setIsVisible(document.visibilityState !== "hidden");
    document.addEventListener("visibilitychange", onChange);
    return () => document.removeEventListener("visibilitychange", onChange);
  }, []);

  return isVisible;
}

function parseTimestamp(value: string): number {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function extractWorkOrderIdFromText(text: string): string | null {
  const match = text.match(WO_ID_REGEX);
  return match ? match[0] : null;
}

function extractLatestWorkOrderIdFromText(text: string): string | null {
  const matches = text.match(WO_ID_REGEX_GLOBAL);
  if (!matches || matches.length === 0) return null;
  return matches[matches.length - 1] ?? null;
}

function extractWorkOrderIdFromLogLines(lines: string[]): string | null {
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i];
    const match = extractLatestWorkOrderIdFromText(line);
    if (match) return match;
  }
  return null;
}

function extractWorkOrderIdFromHandoff(handoff: ShiftContextHandoff | null): string | null {
  if (!handoff) return null;
  for (const line of handoff.next_priorities ?? []) {
    const match = extractWorkOrderIdFromText(line);
    if (match) return match;
  }
  for (const decision of handoff.decisions_made ?? []) {
    const matchDecision = extractWorkOrderIdFromText(decision.decision);
    if (matchDecision) return matchDecision;
    const matchRationale = extractWorkOrderIdFromText(decision.rationale);
    if (matchRationale) return matchRationale;
  }
  return null;
}

function isActiveShift(value: unknown): value is ActiveShift {
  return Boolean(value && typeof value === "object" && "id" in value);
}

function resolveAgentFocus(context: ShiftContext): AgentFocus {
  const activeRuns = Array.isArray(context.active_runs) ? context.active_runs : [];

  for (const group of RUN_STATUS_PRIORITY) {
    const matches = activeRuns.filter(
      (run) => group.includes(run.status) && run.work_order_id
    );
    if (!matches.length) continue;
    const latest = matches.reduce((current, run) => {
      return parseTimestamp(run.started_at) > parseTimestamp(current.started_at)
        ? run
        : current;
    });
    return {
      kind: "work_order",
      workOrderId: latest.work_order_id,
      runId: latest.id,
      status: latest.status,
      source: "active_run",
      updatedAt: latest.started_at,
    };
  }

  const handoffWorkOrderId = extractWorkOrderIdFromHandoff(context.last_handoff);
  if (handoffWorkOrderId) {
    return {
      kind: "work_order",
      workOrderId: handoffWorkOrderId,
      source: "handoff",
      updatedAt: context.last_handoff?.created_at ?? context.assembled_at,
    };
  }

  return {
    kind: "none",
    source: "idle",
    updatedAt: context.assembled_at,
  };
}

function isSameFocus(a: AgentFocus | null, b: AgentFocus | null): boolean {
  if (!a || !b) return a === b;
  return (
    a.kind === b.kind &&
    a.workOrderId === b.workOrderId &&
    a.runId === b.runId &&
    a.status === b.status &&
    a.source === b.source
  );
}

async function fetchShiftContext(projectId: string): Promise<ShiftContext | null> {
  const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/shift-context`, {
    cache: "no-store",
  }).catch(() => null);
  if (!res) return null;
  const json = (await res.json().catch(() => null)) as ShiftContext | { error?: string } | null;
  if (!res.ok) return null;
  if (!json || typeof json !== "object") return null;
  if (!("active_runs" in json)) return null;
  return json as ShiftContext;
}

async function fetchActiveShift(projectId: string): Promise<ActiveShift | null> {
  const res = await fetch(
    `/api/projects/${encodeURIComponent(projectId)}/shifts/active`,
    { cache: "no-store" }
  ).catch(() => null);
  if (!res) return null;
  const json = (await res.json().catch(() => null)) as unknown;
  if (!res.ok) return null;
  return isActiveShift(json) ? (json as ActiveShift) : null;
}

async function fetchShiftLogTail(
  projectId: string,
  shiftId: string,
  tailLines = LOG_TAIL_LINES
): Promise<ShiftLogTail | null> {
  const url = new URL(
    `/api/projects/${encodeURIComponent(projectId)}/shifts/${encodeURIComponent(shiftId)}/logs`,
    window.location.origin
  );
  url.searchParams.set("tail", String(tailLines));
  const res = await fetch(url.toString(), { cache: "no-store" }).catch(() => null);
  if (!res) return null;
  const json = (await res.json().catch(() => null)) as ShiftLogTail | { error?: string } | null;
  if (!res.ok) return null;
  if (!json || typeof json !== "object") return null;
  if (!("lines" in json)) return null;
  return json as ShiftLogTail;
}

async function resolveLogFocus(projectId: string): Promise<AgentFocus | null> {
  const shift = await fetchActiveShift(projectId);
  if (!shift?.id) return null;
  const logTail = await fetchShiftLogTail(projectId, shift.id);
  const workOrderId = extractWorkOrderIdFromLogLines(logTail?.lines ?? []);
  if (!workOrderId) return null;
  return {
    kind: "work_order",
    workOrderId,
    source: "log",
    updatedAt: new Date().toISOString(),
  };
}

export function useAgentFocusSync(
  projectId: string | null,
  options: FocusSyncOptions = {}
): AgentFocus | null {
  const intervalMs = options.intervalMs ?? 5000;
  const hiddenIntervalMs = options.hiddenIntervalMs ?? 15000;
  const debounceMs = options.debounceMs ?? 400;
  const isVisible = usePageVisibility();
  const [focus, setFocus] = useState<AgentFocus | null>(null);
  const focusRef = useRef<AgentFocus | null>(null);
  const inFlightRef = useRef(false);
  const debounceRef = useRef<number | null>(null);
  const pendingRef = useRef<AgentFocus | null>(null);

  useEffect(() => {
    focusRef.current = focus;
  }, [focus]);

  useEffect(() => {
    if (!projectId) {
      setFocus(null);
      return;
    }

    let active = true;
    let timer: number | null = null;

    const applyFocus = (next: AgentFocus) => {
      pendingRef.current = next;
      if (debounceRef.current) {
        window.clearTimeout(debounceRef.current);
      }
      debounceRef.current = window.setTimeout(() => {
        const latest = pendingRef.current;
        if (!latest) return;
        setFocus((prev) => (isSameFocus(prev, latest) ? prev : latest));
        pendingRef.current = null;
      }, debounceMs);
    };

    const poll = async () => {
      if (!active || inFlightRef.current) return;
      inFlightRef.current = true;
      try {
        const [context, logFocus] = await Promise.all([
          fetchShiftContext(projectId),
          resolveLogFocus(projectId),
        ]);
        if (!context && !logFocus) return;
        const contextFocus = context ? resolveAgentFocus(context) : null;
        let nextFocus = logFocus ?? contextFocus;
        if (!nextFocus) return;
        if (
          logFocus &&
          contextFocus &&
          logFocus.kind === "work_order" &&
          contextFocus.kind === "work_order" &&
          logFocus.workOrderId === contextFocus.workOrderId
        ) {
          nextFocus = {
            ...logFocus,
            runId: contextFocus.runId,
            status: contextFocus.status,
          };
        }
        if (!isSameFocus(nextFocus, focusRef.current)) {
          applyFocus(nextFocus);
        }
      } finally {
        inFlightRef.current = false;
      }
    };

    const schedule = (delay: number) => {
      timer = window.setTimeout(async () => {
        if (!active) return;
        await poll();
        if (!active) return;
        schedule(isVisible ? intervalMs : hiddenIntervalMs);
      }, delay);
    };

    schedule(0);

    return () => {
      active = false;
      if (timer) window.clearTimeout(timer);
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
  }, [projectId, intervalMs, hiddenIntervalMs, debounceMs, isVisible]);

  return focus;
}
