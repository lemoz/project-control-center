"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  NarrationService,
  type NarrationPriority,
  type NarrationState,
} from "../services/narration";
import type { ActiveRun } from "../../observability/types";

const ENABLE_KEY = "pcc:narration-enabled";
const PROMPT_KEY = "pcc:narration-prompt-dismissed";
const POLL_INTERVAL_MS = 8_000;
const BURST_WINDOW_MS = 7_000;
const PERIODIC_MIN_MS = 45_000;
const PERIODIC_MAX_MS = 75_000;
const TRANSCRIPT_LIMIT = 12;

type TranscriptEntry = {
  id: string;
  time: string;
  text: string;
};

type WorkOrderMeta = {
  title: string | null;
  goal: string | null;
  projectId: string | null;
};

type EscalationPayload = Record<string, unknown> | string | null;

type RunDetails = {
  id: string;
  project_id: string | null;
  work_order_id: string | null;
  status: string | null;
  escalation: EscalationPayload;
};

type WorkOrderDetails = {
  title: string | null;
  goal: string | null;
};

type NarrationEventType =
  | "run_started"
  | "phase_change"
  | "run_completed"
  | "escalation"
  | "periodic";

type NarrationEvent = {
  type: NarrationEventType;
  priority: NarrationPriority;
  workOrderId?: string;
  phase?: string;
  status?: string;
  activeCount?: number;
  escalationSummary?: string;
};

function randomBetween(min: number, max: number): number {
  const safeMin = Math.min(min, max);
  const safeMax = Math.max(min, max);
  return Math.floor(Math.random() * (safeMax - safeMin + 1)) + safeMin;
}

function formatPhase(phase?: string): string {
  switch (phase) {
    case "queued":
      return "queued";
    case "builder":
      return "building";
    case "blocked":
      return "waiting for input";
    case "review":
      return "in review";
    case "tests":
      return "running tests";
    case "ready_for_review":
      return "ready for review";
    default:
      return "in progress";
  }
}

function formatStatus(status?: string | null): string {
  switch (status) {
    case "merged":
      return "merged";
    case "you_review":
      return "ready for review";
    case "baseline_failed":
      return "baseline failed";
    case "merge_conflict":
      return "merge conflict";
    case "failed":
      return "failed";
    case "canceled":
      return "canceled";
    case "superseded":
      return "superseded";
    default:
      return status || "complete";
  }
}

function extractEscalationSummary(payload: Record<string, unknown>): string | null {
  const summary = typeof payload.summary === "string" ? payload.summary.trim() : "";
  const need = typeof payload.what_i_need === "string" ? payload.what_i_need.trim() : "";
  const tried = typeof payload.what_i_tried === "string" ? payload.what_i_tried.trim() : "";
  return summary || need || tried || null;
}

function parseEscalationSummary(raw: EscalationPayload | undefined): string | null {
  if (!raw) return null;
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (typeof parsed === "string") {
        return parsed.trim() || null;
      }
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return extractEscalationSummary(parsed as Record<string, unknown>);
      }
    } catch {
      return trimmed;
    }
    return null;
  }
  if (typeof raw === "object" && !Array.isArray(raw)) {
    return extractEscalationSummary(raw);
  }
  return null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function readEscalation(value: unknown): EscalationPayload {
  if (!value) return null;
  if (typeof value === "string") return value;
  if (typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

async function fetchRunDetails(runId: string): Promise<RunDetails | null> {
  const res = await fetch(`/api/runs/${encodeURIComponent(runId)}`, {
    cache: "no-store",
  }).catch(() => null);
  if (!res || !res.ok) return null;
  const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!json) return null;
  return {
    id: runId,
    project_id: readString(json.project_id),
    work_order_id: readString(json.work_order_id),
    status: readString(json.status),
    escalation: readEscalation(json.escalation),
  };
}

async function fetchWorkOrderDetails(
  projectId: string,
  workOrderId: string
): Promise<WorkOrderDetails | null> {
  const res = await fetch(
    `/api/repos/${encodeURIComponent(projectId)}/work-orders/${encodeURIComponent(
      workOrderId
    )}`,
    { cache: "no-store" }
  ).catch(() => null);
  if (!res || !res.ok) return null;
  const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!json) return null;
  const workOrderRaw = json.work_order;
  if (!workOrderRaw || typeof workOrderRaw !== "object") return null;
  const workOrder = workOrderRaw as Record<string, unknown>;
  return {
    title: readString(workOrder.title),
    goal: readString(workOrder.goal),
  };
}

export function useNarration() {
  const [enabled, setEnabled] = useState(false);
  const [muted, setMuted] = useState(false);
  const [promptDismissed, setPromptDismissed] = useState(false);
  const [supported, setSupported] = useState(false);
  const [state, setState] = useState<NarrationState>("disabled");
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [activeCount, setActiveCount] = useState(0);
  const readyRef = useRef(false);

  const serviceRef = useRef<NarrationService | null>(null);
  const previousRunsRef = useRef<Map<string, ActiveRun>>(new Map());
  const completedRunsRef = useRef<Set<string>>(new Set());
  const activeCountRef = useRef(0);
  const workOrderMetaRef = useRef<Map<string, WorkOrderMeta>>(new Map());
  const workOrderFetchRef = useRef<Set<string>>(new Set());
  const burstBufferRef = useRef<NarrationEvent[]>([]);
  const burstTimerRef = useRef<number | null>(null);
  const periodicTimerRef = useRef<number | null>(null);
  const baselineReadyRef = useRef(false);

  const enabledRef = useRef(enabled);
  const supportedRef = useRef(supported);

  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);

  useEffect(() => {
    supportedRef.current = supported;
  }, [supported]);

  const appendTranscript = useCallback((text: string) => {
    const timestamp = new Date().toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    setTranscript((prev) => {
      const next = [
        ...prev,
        {
          id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
          time: timestamp,
          text,
        },
      ];
      return next.slice(-TRANSCRIPT_LIMIT);
    });
  }, []);

  const clearPeriodicTimer = useCallback(() => {
    if (periodicTimerRef.current === null || typeof window === "undefined") return;
    window.clearTimeout(periodicTimerRef.current);
    periodicTimerRef.current = null;
  }, []);

  const clearBurstBuffer = useCallback(() => {
    if (burstTimerRef.current !== null && typeof window !== "undefined") {
      window.clearTimeout(burstTimerRef.current);
    }
    burstTimerRef.current = null;
    burstBufferRef.current = [];
  }, []);

  const resolveWorkOrderLabel = useCallback((workOrderId?: string | null) => {
    if (!workOrderId) return "work order";
    const meta = workOrderMetaRef.current.get(workOrderId);
    if (meta?.title) return meta.title;
    return workOrderId;
  }, []);

  const formatEvent = useCallback(
    (event: NarrationEvent) => {
      switch (event.type) {
        case "run_started": {
          const label = resolveWorkOrderLabel(event.workOrderId);
          return `Starting work on ${label}.`;
        }
        case "phase_change": {
          const label = resolveWorkOrderLabel(event.workOrderId);
          return `Now ${formatPhase(event.phase)} for ${label}.`;
        }
        case "run_completed": {
          const label = resolveWorkOrderLabel(event.workOrderId);
          return `Run complete for ${label}. Status: ${formatStatus(event.status)}.`;
        }
        case "escalation": {
          const label = resolveWorkOrderLabel(event.workOrderId);
          if (event.escalationSummary) {
            return `Waiting for input on ${label}. ${event.escalationSummary}`;
          }
          return `Waiting for input on ${label}.`;
        }
        case "periodic": {
          const count = event.activeCount ?? 0;
          const label = event.workOrderId
            ? ` Current focus: ${resolveWorkOrderLabel(event.workOrderId)}.`
            : "";
          const plural = count === 1 ? "work order is" : "work orders are";
          return `${count} ${plural} active.${label}`;
        }
        default:
          return "Work is in progress.";
      }
    },
    [resolveWorkOrderLabel]
  );

  const speakText = useCallback((text: string, priority: NarrationPriority) => {
    const service = serviceRef.current;
    if (!service) return;
    service.speak(text, priority);
  }, []);

  const flushBurst = useCallback(() => {
    const events = burstBufferRef.current;
    if (!events.length) return;
    burstBufferRef.current = [];
    burstTimerRef.current = null;
    const priority: NarrationPriority = events.some((event) => event.priority === "high")
      ? "high"
      : "normal";
    const primary = events.find((event) => event.priority === "high") ?? events[0];
    let message = formatEvent(primary);
    if (events.length > 1) {
      const extra = events.length - 1;
      const suffix = extra === 1 ? "change" : "changes";
      message = `Multiple updates just landed. ${message} Also ${extra} more ${suffix}.`;
    }
    speakText(message, priority);
  }, [formatEvent, speakText]);

  const queueEvent = useCallback(
    (event: NarrationEvent) => {
      if (!enabledRef.current || !supportedRef.current) return false;
      const buffer = burstBufferRef.current;
      if (event.priority === "high") {
        burstBufferRef.current = buffer.filter((item) => item.priority === "high");
      }
      burstBufferRef.current.push(event);
      if (typeof window !== "undefined") {
        if (burstTimerRef.current !== null) {
          window.clearTimeout(burstTimerRef.current);
        }
        burstTimerRef.current = window.setTimeout(flushBurst, BURST_WINDOW_MS);
      }
      return true;
    },
    [flushBurst]
  );

  const resetPeriodicTimer = useCallback(() => {
    if (!enabledRef.current || !supportedRef.current) return;
    if (activeCountRef.current <= 0 || typeof window === "undefined") return;
    clearPeriodicTimer();
    const delay = randomBetween(PERIODIC_MIN_MS, PERIODIC_MAX_MS);
    periodicTimerRef.current = window.setTimeout(() => {
      if (!enabledRef.current || !supportedRef.current) return;
      if (activeCountRef.current <= 0) return;
      const focusRun = Array.from(previousRunsRef.current.values())[0];
      const focusWorkOrderId = focusRun?.work_order_id ?? undefined;
      const event: NarrationEvent = {
        type: "periodic",
        priority: "normal",
        activeCount: activeCountRef.current,
        workOrderId: focusWorkOrderId,
      };
      const queued = queueEvent(event);
      if (queued) resetPeriodicTimer();
    }, delay);
  }, [clearPeriodicTimer, queueEvent]);

  const hydrateWorkOrderMeta = useCallback(async (runId: string, workOrderId: string) => {
    if (!workOrderId) return;
    if (workOrderMetaRef.current.has(workOrderId)) return;
    if (workOrderFetchRef.current.has(workOrderId)) return;
    workOrderFetchRef.current.add(workOrderId);
    try {
      const runDetails = await fetchRunDetails(runId);
      const projectId = runDetails?.project_id;
      if (!projectId) return;
      const details = await fetchWorkOrderDetails(projectId, workOrderId);
      if (!details) return;
      workOrderMetaRef.current.set(workOrderId, {
        title: details.title,
        goal: details.goal,
        projectId,
      });
    } finally {
      workOrderFetchRef.current.delete(workOrderId);
    }
  }, []);

  const handleRunCompletion = useCallback(
    async (run: ActiveRun) => {
      if (completedRunsRef.current.has(run.id)) return;
      completedRunsRef.current.add(run.id);
      const details = await fetchRunDetails(run.id);
      if (details?.work_order_id) {
        await hydrateWorkOrderMeta(run.id, details.work_order_id);
      }
      const queued = queueEvent({
        type: "run_completed",
        priority: "high",
        workOrderId: details?.work_order_id ?? run.work_order_id,
        status: details?.status ?? run.status,
      });
      if (queued) resetPeriodicTimer();
    },
    [hydrateWorkOrderMeta, queueEvent, resetPeriodicTimer]
  );

  const handleEscalation = useCallback(
    async (run: ActiveRun) => {
      await hydrateWorkOrderMeta(run.id, run.work_order_id);
      const details = await fetchRunDetails(run.id);
      const summary = parseEscalationSummary(details?.escalation);
      const queued = queueEvent({
        type: "escalation",
        priority: "high",
        workOrderId: run.work_order_id,
        escalationSummary: summary ?? undefined,
      });
      if (queued) resetPeriodicTimer();
    },
    [hydrateWorkOrderMeta, queueEvent, resetPeriodicTimer]
  );

  const processSnapshot = useCallback(
    (runs: ActiveRun[]) => {
      const previous = previousRunsRef.current;
      const current = new Map<string, ActiveRun>();
      runs.forEach((run) => {
        current.set(run.id, run);
        void hydrateWorkOrderMeta(run.id, run.work_order_id);
      });

      const prevCount = activeCountRef.current;
      if (runs.length !== prevCount) {
        activeCountRef.current = runs.length;
        setActiveCount(runs.length);
        if (runs.length === 0) {
          clearPeriodicTimer();
        } else if (prevCount === 0) {
          resetPeriodicTimer();
        }
      }

      if (!baselineReadyRef.current) {
        baselineReadyRef.current = true;
        previousRunsRef.current = current;
        return;
      }

      let queued = false;
      runs.forEach((run) => {
        const prev = previous.get(run.id);
        if (!prev) {
          if (
            queueEvent({
              type: "run_started",
              priority: "high",
              workOrderId: run.work_order_id,
            })
          ) {
            queued = true;
          }
          return;
        }
        if (prev.status !== "waiting_for_input" && run.status === "waiting_for_input") {
          void handleEscalation(run);
          return;
        }
        if (run.phase !== prev.phase) {
          if (
            queueEvent({
              type: "phase_change",
              priority: "normal",
              workOrderId: run.work_order_id,
              phase: run.phase,
            })
          ) {
            queued = true;
          }
        }
      });

      if (queued) resetPeriodicTimer();

      previous.forEach((run) => {
        if (!current.has(run.id)) {
          void handleRunCompletion(run);
        }
      });

      previousRunsRef.current = current;
    },
    [
      clearPeriodicTimer,
      handleEscalation,
      handleRunCompletion,
      hydrateWorkOrderMeta,
      queueEvent,
      resetPeriodicTimer,
    ]
  );

  useEffect(() => {
    const service = new NarrationService({
      onStateChange: setState,
      onUtterance: appendTranscript,
    });
    serviceRef.current = service;
    setSupported(service.isSupported());
    return () => {
      service.destroy();
      serviceRef.current = null;
    };
  }, [appendTranscript]);

  useEffect(() => {
    return () => {
      clearPeriodicTimer();
      clearBurstBuffer();
    };
  }, [clearBurstBuffer, clearPeriodicTimer]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (readyRef.current) return;
    const storedEnabled = window.localStorage.getItem(ENABLE_KEY);
    const storedPrompt = window.localStorage.getItem(PROMPT_KEY);
    if (storedEnabled === "true") setEnabled(true);
    if (storedPrompt === "true") setPromptDismissed(true);
    readyRef.current = true;
  }, []);

  useEffect(() => {
    if (!readyRef.current || typeof window === "undefined") return;
    window.localStorage.setItem(ENABLE_KEY, enabled ? "true" : "false");
  }, [enabled]);

  useEffect(() => {
    if (!readyRef.current || typeof window === "undefined") return;
    window.localStorage.setItem(PROMPT_KEY, promptDismissed ? "true" : "false");
  }, [promptDismissed]);

  useEffect(() => {
    const service = serviceRef.current;
    if (!service) return;
    if (!enabled) {
      service.disable();
      baselineReadyRef.current = false;
      previousRunsRef.current.clear();
      completedRunsRef.current.clear();
      activeCountRef.current = 0;
      setActiveCount(0);
      clearPeriodicTimer();
      clearBurstBuffer();
      return;
    }
    service.enable();
  }, [enabled, clearBurstBuffer, clearPeriodicTimer]);

  useEffect(() => {
    const service = serviceRef.current;
    if (!service) return;
    if (!enabled) return;
    if (muted) {
      service.mute();
      return;
    }
    service.unmute();
    if (activeCountRef.current > 0) {
      resetPeriodicTimer();
    }
  }, [muted, enabled, resetPeriodicTimer]);

  useEffect(() => {
    if (!enabled || !supported) return;
    let cancelled = false;

    const poll = async () => {
      const res = await fetch("/api/observability/runs/active?limit=25", {
        cache: "no-store",
      }).catch(() => null);
      if (!res || !res.ok || cancelled) return;
      const json = (await res.json().catch(() => null)) as ActiveRun[] | null;
      if (!json || cancelled) return;
      processSnapshot(Array.isArray(json) ? json : []);
    };

    void poll();
    if (typeof window === "undefined") return;
    const interval = window.setInterval(poll, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [enabled, supported, processSnapshot]);

  return {
    activeCount,
    enabled,
    muted,
    promptDismissed,
    supported,
    state,
    transcript,
    setEnabled,
    setMuted,
    dismissPrompt: () => setPromptDismissed(true),
  };
}
