"use client";

import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { attentionReasonLabel, type AttentionReasonCode } from "./chat_attention";

type ChatAction = {
  type:
    | "project_set_star"
    | "project_set_hidden"
    | "work_order_create"
    | "work_order_update"
    | "work_order_set_status"
    | "repos_rescan"
    | "work_order_start_run"
    | "worktree_merge";
  title: string;
  payload: Record<string, unknown>;
};

type WorkOrderMeta = {
  id: string;
  title: string;
  goal: string | null;
  status: string;
  priority: number;
};

type WorkOrdersResponse = {
  work_orders: unknown[];
};

type ChatContextDepth = "minimal" | "messages" | "messages_tools" | "messages_tools_outputs" | "blended";
type ChatFilesystemAccess = "none" | "read-only" | "read-write";
type ChatCliAccess = "off" | "read-only" | "read-write";
type ChatNetworkAccess = "none" | "localhost" | "allowlist" | "trusted";

type ChatThread = {
  id: string;
  name: string;
  scope: "global" | "project" | "work_order";
  project_id: string | null;
  work_order_id: string | null;
  summary: string;
  summarized_count: number;
  default_context_depth: ChatContextDepth;
  default_access_filesystem: ChatFilesystemAccess;
  default_access_cli: ChatCliAccess;
  default_access_network: ChatNetworkAccess;
  default_access_network_allowlist: string | null;
  last_read_at: string | null;
  last_ack_at: string | null;
  archived_at: string | null;
  worktree_path: string | null;
  has_pending_changes: number;
  created_at: string;
  updated_at: string;
  attention?: {
    needs_you: boolean;
    reason_codes: AttentionReasonCode[];
    reasons: Array<{
      code: AttentionReasonCode;
      created_at: string;
      count: number;
      action_titles?: string[];
    }>;
    last_event_at: string | null;
  };
};

type ChatRun = {
  id: string;
  thread_id: string;
  user_message_id: string;
  assistant_message_id: string | null;
  status: "queued" | "running" | "done" | "failed";
  model: string;
  cli_path: string;
  cwd: string;
  context_depth: ChatContextDepth;
  access_filesystem: ChatFilesystemAccess;
  access_cli: ChatCliAccess;
  access_network: ChatNetworkAccess;
  access_network_allowlist: string | null;
  suggestion_json: string | null;
  suggestion_accepted: number;
  log_path: string;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  error: string | null;
};

type ChatAccess = {
  filesystem: ChatFilesystemAccess;
  cli: ChatCliAccess;
  network: ChatNetworkAccess;
  network_allowlist?: string[];
};

type ChatSuggestion = {
  context_depth?: ChatContextDepth;
  access?: Partial<ChatAccess>;
  reason?: string;
};

type ChatMessage = {
  seq: number;
  id: string;
  thread_id: string;
  role: "user" | "assistant" | "system";
  content: string;
  actions_json: string | null;
  needs_user_input: number;
  run_id: string | null;
  created_at: string;
  run: ChatRun | null;
  run_duration_ms: number | null;
  actions: ChatAction[] | null;
};

type ChatActionLedger = {
  id: string;
  thread_id: string;
  run_id: string;
  message_id: string;
  action_index: number;
  action_type: string;
  action_payload_json: string;
  applied_at: string;
  undo_payload_json: string | null;
  undone_at: string | null;
  error: string | null;
};

type ThreadResponse = {
  thread: ChatThread;
  messages: ChatMessage[];
  action_ledger: ChatActionLedger[];
  error?: string;
};

type RunCommand = {
  id: string;
  run_id: string;
  seq: number;
  cwd: string;
  command: string;
  created_at: string;
};

type RunDetails = ChatRun & {
  log_tail: string;
  commands: RunCommand[];
};

type RunPreview = {
  details: RunDetails | null;
  fetchedAt: number | null;
  error: string | null;
};

function threadDetailsApiUrl(threadId: string): string {
  return `/api/chat/threads/${encodeURIComponent(threadId)}`;
}

function threadMessagesApiUrl(threadId: string): string {
  return `/api/chat/threads/${encodeURIComponent(threadId)}/messages`;
}

function threadSuggestionsApiUrl(threadId: string): string {
  return `/api/chat/threads/${encodeURIComponent(threadId)}/suggestions`;
}

function formatTime(value: string | null): string {
  if (!value) return "";
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return value;
  return new Date(ms).toLocaleString();
}

function isAfterAck(createdAt: string, lastAckAt: string | null): boolean {
  if (!lastAckAt) return true;
  const createdMs = Date.parse(createdAt);
  const ackMs = Date.parse(lastAckAt);
  if (!Number.isFinite(createdMs) || !Number.isFinite(ackMs)) {
    return createdAt > lastAckAt;
  }
  return createdMs > ackMs;
}

function formatDuration(ms: number | null): string {
  if (ms === null) return "";
  if (ms < 1000) return `${ms}ms`;
  const s = Math.round(ms / 100) / 10;
  return `${s}s`;
}

function formatAgo(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "0s";
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  return `${hr}h`;
}

function shortenPath(raw: string, segments = 3): string {
  const normalized = raw.replaceAll("\\", "/");
  const parts = normalized.split("/").filter(Boolean);
  if (parts.length <= segments) return raw;
  const tail = parts.slice(-segments).join("/");
  return `…/${tail}`;
}

function lastInterestingLogLine(tail: string): string {
  const lines = tail.split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i]?.trim();
    if (!line) continue;
    if (line.includes("codex exec end exit=") || line.includes("codex exec start")) continue;
    return line;
  }
  return "";
}

function truncateLine(line: string, maxChars = 140): string {
  const single = line.replace(/\s+/g, " ").trim();
  if (single.length <= maxChars) return single;
  return `${single.slice(0, Math.max(0, maxChars - 1))}…`;
}

function firstNonEmptyLine(text: string): string {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return lines[0] ?? "";
}

function summarizeGoal(goal: string | null): string {
  if (!goal) return "No goal set.";
  const line = firstNonEmptyLine(goal);
  return line ? truncateLine(line, 160) : "No goal set.";
}

function isWorkOrdersResponse(value: unknown): value is WorkOrdersResponse {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return Array.isArray(record.work_orders);
}

function getErrorMessage(value: unknown): string | null {
  if (!value || typeof value !== "object" || !("error" in value)) return null;
  const error = (value as { error?: unknown }).error;
  return typeof error === "string" ? error : null;
}

function extractWorkOrderRef(action: ChatAction): { projectId: string; workOrderId: string } | null {
  const payload = action.payload || {};
  const projectId = typeof payload.projectId === "string" ? payload.projectId : null;
  const workOrderId = typeof payload.workOrderId === "string" ? payload.workOrderId : null;
  if (!projectId || !workOrderId) return null;
  return { projectId, workOrderId };
}

function unwrapShellCommand(command: string): string {
  const trimmed = command.trim();
  const match = trimmed.match(/^(?:\/bin\/)?(?:zsh|bash|sh)\s+-lc\s+([\s\S]+)$/);
  if (!match) return trimmed;

  let inner = match[1]?.trim() ?? "";
  if (!inner) return trimmed;

  const quote = inner[0];
  if ((quote === "'" || quote === '"') && inner.endsWith(quote)) {
    inner = inner.slice(1, -1);
    if (quote === '"') inner = inner.replaceAll('\\"', '"');
    if (quote === "'") inner = inner.replaceAll("\\'", "'");
  }

  return inner.trim() || trimmed;
}

function formatCodexLogTailSummary(tail: string): string {
  const raw = lastInterestingLogLine(tail);
  if (!raw) return "";

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return truncateLine(raw);
    const record = parsed as Record<string, unknown>;
    const type = typeof record.type === "string" ? record.type : null;
    if (!type) return truncateLine(raw);

    if (type === "error") {
      const message = typeof record.message === "string" ? record.message : "";
      return truncateLine(message ? `Error: ${message}` : "Error");
    }

    if (type === "turn.failed") {
      const err = record.error;
      if (err && typeof err === "object") {
        const errRecord = err as Record<string, unknown>;
        const message = typeof errRecord.message === "string" ? errRecord.message : "";
        return truncateLine(message ? `Failed: ${message}` : "Failed");
      }
      return "Failed";
    }

    if (type === "turn.started") return "Starting…";
    if (type === "turn.completed") return "Turn completed";

    if (type.startsWith("item.")) {
      const item = record.item;
      if (!item || typeof item !== "object") return truncateLine(type.replaceAll(".", " "));

      const itemRecord = item as Record<string, unknown>;
      const itemType = typeof itemRecord.type === "string" ? itemRecord.type : null;

      if (itemType === "command_execution") {
        const commandRaw = typeof itemRecord.command === "string" ? itemRecord.command : "";
        const command = commandRaw ? unwrapShellCommand(commandRaw) : "";
        const verb = type === "item.started" ? "Running" : "Ran";
        return truncateLine(command ? `${verb}: ${command}` : `${verb} command`);
      }

      if (itemType === "reasoning") {
        const text = typeof itemRecord.text === "string" ? itemRecord.text : "";
        const line = text ? firstNonEmptyLine(text) : "";
        return truncateLine(line ? `Thinking: ${line}` : "Thinking…");
      }

      if (itemType === "agent_message") {
        return "Drafting reply…";
      }

      if (itemType) {
        return truncateLine(itemType.replaceAll("_", " "));
      }
    }

    return truncateLine(type.replaceAll(".", " "));
  } catch {
    return truncateLine(raw);
  }
}

const DEFAULT_CONTEXT_DEPTH: ChatContextDepth = "blended";
const DEFAULT_ACCESS: ChatAccess = {
  filesystem: "read-only",
  cli: "off",
  network: "none",
  network_allowlist: [],
};

function parseAllowlist(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.map((entry) => String(entry).trim()).filter(Boolean);
    }
  } catch {
    return [];
  }
  return [];
}

function defaultsFromThread(thread: ChatThread | null): {
  contextDepth: ChatContextDepth;
  access: ChatAccess;
  allowlistInput: string;
} {
  if (!thread) {
    return {
      contextDepth: DEFAULT_CONTEXT_DEPTH,
      access: { ...DEFAULT_ACCESS },
      allowlistInput: "",
    };
  }
  const allowlist = parseAllowlist(thread.default_access_network_allowlist);
  return {
    contextDepth: thread.default_context_depth || DEFAULT_CONTEXT_DEPTH,
    access: {
      filesystem: thread.default_access_filesystem,
      cli: thread.default_access_cli,
      network: thread.default_access_network,
      network_allowlist: allowlist,
    },
    allowlistInput: allowlist.join(", "),
  };
}

function formatContextDepth(depth: ChatContextDepth): string {
  switch (depth) {
    case "minimal":
      return "Minimal";
    case "messages":
      return "Messages";
    case "messages_tools":
      return "Messages + Tools";
    case "messages_tools_outputs":
      return "Messages + Tools + Outputs";
    case "blended":
      return "Blended";
    default:
      return depth;
  }
}

function formatNetworkAccess(network: ChatNetworkAccess, allowlist: string[]): string {
  if (network === "allowlist") {
    return allowlist.length ? `allowlist (${allowlist.join(", ")})` : "allowlist";
  }
  if (network === "trusted") return "trusted pack";
  return network;
}

function parseSuggestion(raw: string | null): ChatSuggestion | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as ChatSuggestion;
    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
}

function buildRunChips(run: ChatRun | null): { settings: string[]; suggestions: string[] } {
  if (!run) return { settings: [], suggestions: [] };
  const allowlist = parseAllowlist(run.access_network_allowlist);
  const settings = [
    `Context: ${formatContextDepth(run.context_depth)}`,
    `FS: ${run.access_filesystem}`,
    `CLI: ${run.access_cli}`,
    `Net: ${formatNetworkAccess(run.access_network, allowlist)}`,
  ];
  const suggestions: string[] = [];
  if (run.suggestion_accepted && run.suggestion_json) {
    const suggestion = parseSuggestion(run.suggestion_json);
    if (suggestion?.context_depth) {
      suggestions.push(`Suggested context: ${formatContextDepth(suggestion.context_depth)}`);
    }
    if (suggestion?.access?.filesystem) {
      suggestions.push(`Suggested FS: ${suggestion.access.filesystem}`);
    }
    if (suggestion?.access?.cli) {
      suggestions.push(`Suggested CLI: ${suggestion.access.cli}`);
    }
    if (suggestion?.access?.network) {
      const suggestedAllowlist = suggestion.access.network_allowlist || [];
      suggestions.push(
        `Suggested Net: ${formatNetworkAccess(suggestion.access.network, suggestedAllowlist)}`
      );
    }
  }
  return { settings, suggestions };
}

function normalizeAccessForRequest(access: ChatAccess): ChatAccess {
  const allowlist = (access.network_allowlist || [])
    .map((entry) => String(entry).trim())
    .filter(Boolean);
  if (access.network !== "allowlist") {
    return {
      filesystem: access.filesystem,
      cli: access.cli,
      network: access.network,
    };
  }
  return {
    ...access,
    network_allowlist: allowlist.length ? allowlist : undefined,
  };
}

function requiresWrite(access: ChatAccess): boolean {
  return access.filesystem === "read-write" || access.cli === "read-write";
}

function requiresNetworkConfirmation(access: ChatAccess): boolean {
  return access.network === "allowlist" || access.network === "trusted";
}

function requiresAllowlistInput(access: ChatAccess): boolean {
  return access.network === "allowlist";
}

function isUnsupportedAccess(access: ChatAccess): boolean {
  if (access.filesystem === "none" && access.cli !== "off") return true;
  if (access.network === "allowlist" && !access.network_allowlist?.length) return true;
  if (access.cli === "read-write" && access.filesystem !== "read-write") return true;
  if (access.cli === "read-only" && access.filesystem === "read-write") return true;
  return false;
}

function applySuggestion(
  base: { contextDepth: ChatContextDepth; access: ChatAccess },
  suggestion: ChatSuggestion | null
): { contextDepth: ChatContextDepth; access: ChatAccess } {
  if (!suggestion) return base;
  const nextAccess = { ...base.access, ...(suggestion.access || {}) };
  const normalized = normalizeAccessForRequest(nextAccess);
  return {
    contextDepth: suggestion.context_depth || base.contextDepth,
    access: normalized,
  };
}

function describeSuggestionChanges(
  base: { contextDepth: ChatContextDepth; access: ChatAccess },
  suggestion: ChatSuggestion | null
): string[] {
  if (!suggestion) return [];
  const changes: string[] = [];
  if (suggestion.context_depth && suggestion.context_depth !== base.contextDepth) {
    changes.push(
      `Context: ${formatContextDepth(base.contextDepth)} → ${formatContextDepth(suggestion.context_depth)}`
    );
  }
  if (suggestion.access?.filesystem && suggestion.access.filesystem !== base.access.filesystem) {
    changes.push(`Filesystem: ${base.access.filesystem} → ${suggestion.access.filesystem}`);
  }
  if (suggestion.access?.cli && suggestion.access.cli !== base.access.cli) {
    changes.push(`CLI: ${base.access.cli} → ${suggestion.access.cli}`);
  }
  if (suggestion.access?.network && suggestion.access.network !== base.access.network) {
    changes.push(`Network: ${base.access.network} → ${suggestion.access.network}`);
  }
  if (suggestion.access?.network_allowlist?.length) {
    changes.push(`Allowlist: ${suggestion.access.network_allowlist.join(", ")}`);
  }
  return changes;
}

function sanitizeSuggestionForUi(
  base: { contextDepth: ChatContextDepth; access: ChatAccess },
  suggestion: ChatSuggestion | null
): ChatSuggestion | null {
  if (!suggestion) return null;

  const mergedAccess = normalizeAccessForRequest({
    ...base.access,
    ...(suggestion.access || {}),
  });

  let coerced: ChatAccess = { ...mergedAccess };
  const notes: string[] = [];

  if (coerced.filesystem === "none" && coerced.cli !== "off") {
    coerced = { ...coerced, cli: "off" };
    notes.push("filesystem none requires CLI off.");
  }

  if (coerced.network === "allowlist" && !(coerced.network_allowlist || []).length) {
    coerced = { ...coerced, network: "none", network_allowlist: [] };
    notes.push("network allowlist requires at least one host.");
  }

  if (coerced.cli === "read-write" && coerced.filesystem !== "read-write") {
    coerced = { ...coerced, filesystem: "read-write" };
    notes.push("CLI read-write requires filesystem read-write.");
  }

  if (coerced.filesystem === "read-write" && coerced.cli === "read-only") {
    coerced = { ...coerced, cli: "read-write" };
    notes.push("filesystem read-write makes CLI read-only unenforceable.");
  }

  coerced = normalizeAccessForRequest(coerced);

  const accessDelta: Partial<ChatAccess> = {};
  if (coerced.filesystem !== base.access.filesystem) accessDelta.filesystem = coerced.filesystem;
  if (coerced.cli !== base.access.cli) accessDelta.cli = coerced.cli;
  if (coerced.network !== base.access.network) accessDelta.network = coerced.network;
  if (coerced.network === "allowlist") {
    accessDelta.network_allowlist = coerced.network_allowlist || [];
  }

  const baseReason = suggestion.reason?.trim() ?? "";
  const adjusted = notes.length ? `Adjusted: ${notes.join(" ")}` : "";
  const reason = (baseReason ? `${baseReason} ` : "") + adjusted;

  const out: ChatSuggestion = {};
  if (suggestion.context_depth && suggestion.context_depth !== base.contextDepth) {
    out.context_depth = suggestion.context_depth;
  }
  if (Object.keys(accessDelta).length) out.access = accessDelta;
  if (reason.trim()) out.reason = reason.trim();
  return out;
}

export function ChatThread({
  threadId,
  maxHeight,
  refreshToken,
  streamConnected,
}: {
  threadId: string;
  maxHeight?: number | string;
  refreshToken?: number | null;
  streamConnected?: boolean;
}) {
  const [data, setData] = useState<ThreadResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [clearingAttention, setClearingAttention] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [workOrdersByProject, setWorkOrdersByProject] = useState<
    Record<string, Record<string, WorkOrderMeta>>
  >({});
  const [workOrdersLoading, setWorkOrdersLoading] = useState<Record<string, boolean>>({});
  const [input, setInput] = useState("");
  const [controlsOpen, setControlsOpen] = useState(false);
  const [contextDepth, setContextDepth] = useState<ChatContextDepth>(DEFAULT_CONTEXT_DEPTH);
  const [access, setAccess] = useState<ChatAccess>(DEFAULT_ACCESS);
  const [networkAllowlistInput, setNetworkAllowlistInput] = useState("");
  const [confirmations, setConfirmations] = useState({ write: false, network_allowlist: false });
  const [suggestionLoading, setSuggestionLoading] = useState(false);
  const [suggestion, setSuggestion] = useState<ChatSuggestion | null>(null);
  const [suggestionError, setSuggestionError] = useState<string | null>(null);
  const [pendingMessage, setPendingMessage] = useState<string | null>(null);
  const [pendingSelection, setPendingSelection] = useState<{
    contextDepth: ChatContextDepth;
    access: ChatAccess;
  } | null>(null);
  const [sending, setSending] = useState(false);
  const [applying, setApplying] = useState<Record<string, boolean>>({});
  const [undoing, setUndoing] = useState<Record<string, boolean>>({});
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [runDetails, setRunDetails] = useState<RunDetails | null>(null);
  const [runDetailsFetchedAt, setRunDetailsFetchedAt] = useState<number | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [runPreviews, setRunPreviews] = useState<Record<string, RunPreview>>({});
  const [worktreeDiff, setWorktreeDiff] = useState<string | null>(null);
  const [worktreeDiffError, setWorktreeDiffError] = useState<string | null>(null);
  const [worktreeDiffLoading, setWorktreeDiffLoading] = useState(false);
  const [worktreeDiffOpenKey, setWorktreeDiffOpenKey] = useState<string | null>(null);
  const [worktreeDiffFetchedAt, setWorktreeDiffFetchedAt] = useState<number | null>(null);
  const [nowTick, setNowTick] = useState(() => Date.now());
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const stickToBottomRef = useRef(true);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const hasLoadedRef = useRef(false);
  const messageCountRef = useRef(0);
  const threadDefaultsRef = useRef(defaultsFromThread(null));
  const threadDefaultsAppliedRef = useRef<string | null>(null);
  const loadRequestRef = useRef(0);
  const activeThreadRef = useRef(threadId);

  activeThreadRef.current = threadId;

  const ledgerByKey = useMemo(() => {
    const map = new Map<string, ChatActionLedger>();
    for (const a of data?.action_ledger || []) {
      map.set(`${a.message_id}:${a.action_index}`, a);
    }
    return map;
  }, [data?.action_ledger]);

  const attention = data?.thread?.attention ?? null;
  const attentionReasons = attention?.reasons ?? [];
  const hasAttention = attention?.needs_you ?? false;
  const threadHasPendingChanges = (data?.thread?.has_pending_changes ?? 0) > 0;

  const neededProjectIds = useMemo(() => {
    const set = new Set<string>();
    for (const message of data?.messages || []) {
      for (const action of message.actions || []) {
        const ref = extractWorkOrderRef(action);
        if (ref) set.add(ref.projectId);
      }
    }
    return Array.from(set).sort();
  }, [data?.messages]);

  useEffect(() => {
    if (!neededProjectIds.length) return;
    let cancelled = false;

    const loadWorkOrders = async (projectId: string) => {
      setWorkOrdersLoading((prev) => ({ ...prev, [projectId]: true }));
      try {
        const res = await fetch(`/api/repos/${encodeURIComponent(projectId)}/work-orders`, {
          cache: "no-store",
        });
        const json = (await res.json().catch(() => null)) as unknown;
        if (!res.ok) throw new Error(getErrorMessage(json) || "failed to load work orders");
        const items = isWorkOrdersResponse(json) ? json.work_orders : [];
        const map: Record<string, WorkOrderMeta> = {};
        for (const item of items) {
          if (!item || typeof item !== "object") continue;
          const record = item as Record<string, unknown>;
          const id = typeof record.id === "string" ? record.id : null;
          const title = typeof record.title === "string" ? record.title : null;
          if (!id || !title) continue;
          map[id] = {
            id,
            title,
            goal: typeof record.goal === "string" ? record.goal : null,
            status: typeof record.status === "string" ? record.status : "unknown",
            priority: typeof record.priority === "number" ? record.priority : 0,
          };
        }
        if (!cancelled) {
          setWorkOrdersByProject((prev) => ({ ...prev, [projectId]: map }));
        }
      } catch {
        // best-effort only
      } finally {
        if (!cancelled) {
          setWorkOrdersLoading((prev) => ({ ...prev, [projectId]: false }));
        }
      }
    };

    for (const projectId of neededProjectIds) {
      if (workOrdersByProject[projectId]) continue;
      if (workOrdersLoading[projectId]) continue;
      void loadWorkOrders(projectId);
    }

    return () => {
      cancelled = true;
    };
  }, [neededProjectIds, workOrdersByProject, workOrdersLoading]);

  const hasActiveRuns = useMemo(() => {
    return (data?.messages || []).some((m) =>
      m.run ? m.run.status === "queued" || m.run.status === "running" : false
    );
  }, [data?.messages]);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "auto") => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior });
  }, []);

  const onMessagesScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const shouldStick = distanceFromBottom < 80;
    stickToBottomRef.current = shouldStick;
    setIsAtBottom((prev) => (prev === shouldStick ? prev : shouldStick));
  }, []);

  const applyThreadDefaults = useCallback((thread: ChatThread | null) => {
    if (!thread) return;
    if (threadDefaultsAppliedRef.current === thread.id) return;
    const defaults = defaultsFromThread(thread);
    threadDefaultsRef.current = defaults;
    threadDefaultsAppliedRef.current = thread.id;
    setContextDepth(defaults.contextDepth);
    setAccess({ ...defaults.access });
    setNetworkAllowlistInput(defaults.allowlistInput);
    setConfirmations({ write: false, network_allowlist: false });
  }, []);

  const load = useCallback(async () => {
    const requestId = (loadRequestRef.current += 1);
    const requestedThreadId = threadId;
    const isInitial = !hasLoadedRef.current;
    if (isInitial) setLoading(true);
    else setRefreshing(true);
    setError(null);
    try {
      const res = await fetch(threadDetailsApiUrl(requestedThreadId), { cache: "no-store" });
      const json = (await res.json().catch(() => null)) as ThreadResponse | null;
      if (!res.ok) throw new Error(json?.error || "failed to load chat");
      if (loadRequestRef.current !== requestId || activeThreadRef.current !== requestedThreadId) return;
      setData(json);
      applyThreadDefaults(json?.thread ?? null);
      hasLoadedRef.current = true;
    } catch (e) {
      if (loadRequestRef.current !== requestId || activeThreadRef.current !== requestedThreadId) return;
      setError(e instanceof Error ? e.message : "failed to load chat");
    } finally {
      if (loadRequestRef.current !== requestId || activeThreadRef.current !== requestedThreadId) return;
      setLoading(false);
      setRefreshing(false);
    }
  }, [applyThreadDefaults, threadId]);

  const clearAttention = useCallback(async () => {
    if (clearingAttention) return;
    setClearingAttention(true);
    setError(null);
    try {
      const res = await fetch(`/api/chat/threads/${encodeURIComponent(threadId)}/ack`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const json = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) throw new Error(json?.error || "failed to clear attention");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed to clear attention");
    } finally {
      setClearingAttention(false);
    }
  }, [clearingAttention, load, threadId]);

  useLayoutEffect(() => {
    const count = data?.messages?.length ?? 0;
    const prev = messageCountRef.current;
    messageCountRef.current = count;
    if (!count) return;
    if (!stickToBottomRef.current && prev) return;
    scrollToBottom("auto");
  }, [data?.messages?.length, scrollToBottom]);

  useLayoutEffect(() => {
    if (!data?.thread?.updated_at) return;
    if (!data?.messages?.length) return;
    if (!stickToBottomRef.current) return;
    scrollToBottom("auto");
  }, [data?.thread?.updated_at, data?.messages?.length, scrollToBottom]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (refreshToken === null || refreshToken === undefined) return;
    void load();
  }, [load, refreshToken]);

  useEffect(() => {
    if (!hasActiveRuns) return;
    const t = setInterval(() => void load(), 2000);
    return () => clearInterval(t);
  }, [hasActiveRuns, load]);

  useEffect(() => {
    if (streamConnected) return;
    if (hasActiveRuns) return;
    const t = setInterval(() => void load(), 15000);
    return () => clearInterval(t);
  }, [hasActiveRuns, load, streamConnected]);

  const activeRunIds = useMemo(() => {
    const ids: string[] = [];
    for (const m of data?.messages || []) {
      if (m.role !== "user") continue;
      if (!m.run) continue;
      if (m.run.assistant_message_id) continue;
      if (m.run.status !== "queued" && m.run.status !== "running") continue;
      ids.push(m.run.id);
    }
    return Array.from(new Set(ids));
  }, [data?.messages]);

  const activeRunKey = useMemo(() => activeRunIds.slice().sort().join("|"), [activeRunIds]);

  useEffect(() => {
    setRunPreviews((prev) => {
      const active = new Set(activeRunIds);
      let changed = false;
      const next: Record<string, RunPreview> = {};
      for (const [id, entry] of Object.entries(prev)) {
        if (!active.has(id)) {
          changed = true;
          continue;
        }
        next[id] = entry;
      }
      return changed ? next : prev;
    });
  }, [activeRunKey, activeRunIds]);

  const fetchRunPreview = useCallback(async (runId: string) => {
    const res = await fetch(`/api/chat/runs/${encodeURIComponent(runId)}`, { cache: "no-store" }).catch(
      () => null
    );
    const fetchedAt = Date.now();
    if (!res) {
      setRunPreviews((prev) => ({
        ...prev,
        [runId]: {
          details: prev[runId]?.details ?? null,
          fetchedAt,
          error: "Control Center server unreachable",
        },
      }));
      return;
    }
    const json = (await res.json().catch(() => null)) as RunDetails | { error?: string } | null;
    if (!res.ok) {
      setRunPreviews((prev) => ({
        ...prev,
        [runId]: {
          details: prev[runId]?.details ?? null,
          fetchedAt,
          error: (json as { error?: string } | null)?.error || "failed to load run",
        },
      }));
      return;
    }
    setRunPreviews((prev) => ({
      ...prev,
      [runId]: { details: json as RunDetails, fetchedAt, error: null },
    }));
  }, []);

  useEffect(() => {
    if (!activeRunIds.length) return;
    const ids = activeRunIds.slice();
    const refresh = () => Promise.all(ids.map((id) => fetchRunPreview(id)));
    void refresh();
    const t = setInterval(() => void refresh(), 1500);
    return () => clearInterval(t);
  }, [activeRunKey, activeRunIds, fetchRunPreview]);

  // Keep nowTick updated so relative timestamps ("X ago") stay accurate
  useEffect(() => {
    const t = setInterval(() => setNowTick(Date.now()), 5000);
    return () => clearInterval(t);
  }, []);

  const resetComposer = useCallback(() => {
    const defaults = threadDefaultsRef.current;
    setInput("");
    setControlsOpen(false);
    setContextDepth(defaults.contextDepth);
    setAccess({ ...defaults.access });
    setNetworkAllowlistInput(defaults.allowlistInput);
    setConfirmations({ write: false, network_allowlist: false });
    setSuggestion(null);
    setSuggestionError(null);
    setPendingMessage(null);
    setPendingSelection(null);
  }, []);

  useEffect(() => {
    hasLoadedRef.current = false;
    threadDefaultsAppliedRef.current = null;
    threadDefaultsRef.current = defaultsFromThread(null);
    messageCountRef.current = 0;
    stickToBottomRef.current = true;
    setIsAtBottom(true);
    setData(null);
    setLoading(true);
    setRefreshing(false);
    setError(null);
    setRunPreviews({});
    setSelectedRunId(null);
    setRunDetails(null);
    setRunDetailsFetchedAt(null);
    setRunError(null);
    setWorktreeDiff(null);
    setWorktreeDiffError(null);
    setWorktreeDiffLoading(false);
    setWorktreeDiffOpenKey(null);
    setWorktreeDiffFetchedAt(null);
    setApplying({});
    setUndoing({});
    setClearingAttention(false);
    resetComposer();
  }, [threadId, resetComposer]);

  const sendWithSettings = useCallback(
    async (params: {
      content: string;
      selection: { contextDepth: ChatContextDepth; access: ChatAccess };
      acceptedSuggestion?: ChatSuggestion | null;
    }) => {
      setSending(true);
      setError(null);
      try {
        const body = {
          content: params.content,
          context: { depth: params.selection.contextDepth },
          access: normalizeAccessForRequest(params.selection.access),
          suggestion: params.acceptedSuggestion ?? undefined,
          confirmations,
        };
        const res = await fetch(threadMessagesApiUrl(threadId), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const json = (await res.json().catch(() => null)) as { error?: string } | null;
        if (!res.ok) throw new Error(json?.error || "failed to send");
        resetComposer();
        await load();
      } catch (e) {
        setError(e instanceof Error ? e.message : "failed to send");
        setPendingMessage(null);
        setPendingSelection(null);
        setSuggestion(null);
      } finally {
        setSending(false);
      }
    },
    [confirmations, load, resetComposer, threadId]
  );

  const runSuggestion = useCallback(
    async (content: string, selection: { contextDepth: ChatContextDepth; access: ChatAccess }) => {
      setSuggestionLoading(true);
      setSuggestionError(null);
      setSuggestion(null);
      try {
        const res = await fetch(threadSuggestionsApiUrl(threadId), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            content,
            context: { depth: selection.contextDepth },
            access: selection.access,
          }),
        });
        const json = (await res.json().catch(() => null)) as
          | { error?: string; suggestion?: ChatSuggestion }
          | null;
        if (!res.ok) throw new Error(json?.error || "failed to suggest");
        setSuggestion(json?.suggestion ?? {});
      } catch (e) {
        setSuggestionError(e instanceof Error ? e.message : "failed to suggest");
        setSuggestion(null);
      } finally {
        setSuggestionLoading(false);
      }
    },
    [threadId]
  );

  const requestSuggestion = useCallback(async () => {
    const content = input.trim();
    if (!content) return;
    if (suggestionLoading || pendingMessage) return;
    const selection = {
      contextDepth,
      access: normalizeAccessForRequest(access),
    };
    setPendingMessage(content);
    setPendingSelection(selection);
    await runSuggestion(content, selection);
  }, [access, contextDepth, input, pendingMessage, runSuggestion, suggestionLoading]);

  const retrySuggestion = useCallback(async () => {
    if (!pendingMessage || !pendingSelection) return;
    if (suggestionLoading) return;
    await runSuggestion(pendingMessage, pendingSelection);
  }, [pendingMessage, pendingSelection, runSuggestion, suggestionLoading]);

  const normalizedAccess = useMemo(() => normalizeAccessForRequest(access), [access]);
  const accessUnsupported = isUnsupportedAccess(normalizedAccess);
  const baseSelection = pendingSelection ?? { contextDepth, access: normalizedAccess };
  const sanitizedSuggestion = pendingSelection
    ? sanitizeSuggestionForUi(pendingSelection, suggestion)
    : suggestion;
  const suggestionChanges = pendingSelection
    ? describeSuggestionChanges(pendingSelection, sanitizedSuggestion)
    : [];
  const appliedSelection = pendingSelection
    ? applySuggestion(pendingSelection, sanitizedSuggestion)
    : null;
  const baseNeedsWrite = requiresWrite(baseSelection.access);
  const baseNeedsNetwork = requiresNetworkConfirmation(baseSelection.access);
  const appliedNeedsWrite = appliedSelection ? requiresWrite(appliedSelection.access) : false;
  const appliedNeedsNetwork = appliedSelection
    ? requiresNetworkConfirmation(appliedSelection.access)
    : false;
  const baseUnsupported = isUnsupportedAccess(baseSelection.access);
  const appliedUnsupported = appliedSelection ? isUnsupportedAccess(appliedSelection.access) : false;
  const canApproveBase =
    !baseUnsupported &&
    (!baseNeedsWrite || confirmations.write) &&
    (!baseNeedsNetwork || confirmations.network_allowlist);
  const canApproveApplied =
    appliedSelection &&
    !appliedUnsupported &&
    (!appliedNeedsWrite || confirmations.write) &&
    (!appliedNeedsNetwork || confirmations.network_allowlist);
  const composerLocked = sending || suggestionLoading || !!pendingMessage;

  const fetchRunDetails = useCallback(async (runId: string) => {
    setRunError(null);
    const res = await fetch(`/api/chat/runs/${encodeURIComponent(runId)}`, { cache: "no-store" }).catch(
      () => null
    );
    if (!res) {
      setRunError("Control Center server unreachable");
      return;
    }
    const json = (await res.json().catch(() => null)) as RunDetails | { error?: string } | null;
    if (!res.ok) {
      setRunError((json as { error?: string } | null)?.error || "failed to load run");
      return;
    }
    setRunDetails(json as RunDetails);
    setRunDetailsFetchedAt(Date.now());
  }, []);

  const fetchWorktreeDiff = useCallback(async () => {
    setWorktreeDiffLoading(true);
    setWorktreeDiffError(null);
    try {
      const res = await fetch(
        `/api/chat/threads/${encodeURIComponent(threadId)}/worktree/diff`,
        { cache: "no-store" }
      );
      const json = (await res.json().catch(() => null)) as
        | { diff?: string; has_pending_changes?: boolean; error?: string }
        | null;
      if (!res.ok) throw new Error(json?.error || "failed to load diff");
      setWorktreeDiff(typeof json?.diff === "string" ? json.diff : "");
      setWorktreeDiffFetchedAt(Date.now());
    } catch (e) {
      setWorktreeDiffError(e instanceof Error ? e.message : "failed to load diff");
      setWorktreeDiff(null);
      setWorktreeDiffFetchedAt(null);
    } finally {
      setWorktreeDiffLoading(false);
    }
  }, [threadId]);

  useEffect(() => {
    if (!selectedRunId) {
      setRunDetails(null);
      setRunDetailsFetchedAt(null);
      setRunError(null);
      return;
    }
    void fetchRunDetails(selectedRunId);
  }, [fetchRunDetails, selectedRunId]);

  useEffect(() => {
    if (!selectedRunId) return;
    if (!runDetails) return;
    if (runDetails.status !== "queued" && runDetails.status !== "running") return;
    const t = setInterval(() => void fetchRunDetails(selectedRunId), 1500);
    return () => clearInterval(t);
  }, [fetchRunDetails, runDetails, selectedRunId]);

  useEffect(() => {
    setConfirmations((prev) => ({
      write: requiresWrite(normalizedAccess) ? prev.write : false,
      network_allowlist: requiresNetworkConfirmation(normalizedAccess)
        ? prev.network_allowlist
        : false,
    }));
  }, [normalizedAccess]);

  useEffect(() => {
    if (threadHasPendingChanges) return;
    setWorktreeDiffOpenKey(null);
    setWorktreeDiff(null);
    setWorktreeDiffError(null);
    setWorktreeDiffFetchedAt(null);
    setWorktreeDiffLoading(false);
  }, [threadHasPendingChanges]);

  const applyAction = useCallback(async (messageId: string, actionIndex: number) => {
    const key = `${messageId}:${actionIndex}`;
    setApplying((p) => ({ ...p, [key]: true }));
    setError(null);
    try {
      const res = await fetch("/api/chat/actions/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageId, actionIndex }),
      });
      const json = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) throw new Error(json?.error || "failed to apply action");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed to apply action");
    } finally {
      setApplying((p) => {
        const next = { ...p };
        delete next[key];
        return next;
      });
    }
  }, [load]);

  const undoAction = useCallback(async (ledgerId: string) => {
    setUndoing((p) => ({ ...p, [ledgerId]: true }));
    setError(null);
    try {
      const res = await fetch(`/api/chat/actions/${encodeURIComponent(ledgerId)}/undo`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const json = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) throw new Error(json?.error || "failed to undo action");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed to undo action");
    } finally {
      setUndoing((p) => {
        const next = { ...p };
        delete next[ledgerId];
        return next;
      });
    }
  }, [load]);

  const renderJson = useCallback((raw: string | null) => {
    if (!raw) return "(none)";
    try {
      return JSON.stringify(JSON.parse(raw), null, 2);
    } catch {
      return raw;
    }
  }, []);

  return (
    <section
      className="card"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 10,
        flex: maxHeight ? "1 1 auto" : undefined,
        minHeight: maxHeight ? 0 : undefined,
        overflow: maxHeight ? "hidden" : undefined,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
        <div>
          <div style={{ fontWeight: 700 }}>Chat</div>
          {!!data?.thread?.summary && (
            <div className="muted" style={{ fontSize: 12 }}>
              Summary included (through {data.thread.summarized_count} messages).
            </div>
          )}
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          {hasAttention && (
            <button
              className="btnSecondary"
              onClick={() => void clearAttention()}
              disabled={loading || refreshing || clearingAttention}
            >
              {clearingAttention ? "Clearing..." : "Clear attention"}
            </button>
          )}
          <button className="btnSecondary" onClick={() => void load()} disabled={loading || refreshing || sending}>
            Refresh
          </button>
        </div>
      </div>

      {hasAttention && (
        <div className="card" style={{ background: "rgba(255,255,255,0.02)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
            <div style={{ fontWeight: 700 }}>Needs you</div>
            {!!attention?.last_event_at && (
              <div className="muted" style={{ fontSize: 12 }}>
                Last event {formatTime(attention.last_event_at)}
              </div>
            )}
          </div>
          {!!attentionReasons.length && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
              {attentionReasons.map((reason) => (
                <span key={reason.code} className="badge">
                  {attentionReasonLabel(reason.code)}
                  {reason.count > 1 ? ` (${reason.count})` : ""}
                </span>
              ))}
            </div>
          )}
          {(() => {
            const pending = attentionReasons.find((reason) => reason.code === "pending_action");
            if (!pending?.action_titles?.length) return null;
            return (
              <div className="muted" style={{ fontSize: 12, marginTop: 6, lineHeight: 1.4 }}>
                Actions: {pending.action_titles.join(" / ")}
              </div>
            );
          })()}
        </div>
      )}

      {!!error && <div className="error">{error}</div>}
      {loading && <div className="muted">Loading…</div>}

      {!loading && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10, flex: 1, minHeight: 0, overflow: "hidden" }}>
          <div style={{ position: "relative", flex: 1, minHeight: 0, overflow: "hidden" }}>
            {!isAtBottom && (
              <div
                style={{
                  position: "absolute",
                  left: 0,
                  right: 0,
                  bottom: 10,
                  display: "flex",
                  justifyContent: "center",
                  pointerEvents: "none",
                  zIndex: 2,
                }}
              >
                <button
                  className="btnSecondary"
                  style={{ pointerEvents: "auto", background: "#1f2433" }}
                  onClick={() => scrollToBottom("smooth")}
                >
                  New activity ↓
                </button>
              </div>
            )}
            <div
              ref={scrollRef}
              onScroll={onMessagesScroll}
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 10,
                maxHeight: maxHeight ?? 520,
                overflow: "auto",
                paddingRight: 4,
                flex: "1 1 auto",
                minHeight: 160,
              }}
            >
              {(data?.messages || []).map((m) => {
                const showRunMeta = !!m.run;
                const showActions = m.role === "assistant";
                const needsInput =
                  m.needs_user_input === 1 && isAfterAck(m.created_at, data?.thread?.last_ack_at ?? null);
                const showAssistantPlaceholder =
                  m.role === "user" &&
                  !!m.run &&
                  !m.run.assistant_message_id &&
                  (m.run.status === "queued" || m.run.status === "running");
                const preview = showAssistantPlaceholder ? runPreviews[m.run!.id] : null;
                const previewDetails = preview?.details ?? null;
                const previewLastCommand = previewDetails?.commands?.length
                  ? previewDetails.commands[previewDetails.commands.length - 1]
                  : null;
                const previewLogSummary = previewDetails?.log_tail
                  ? formatCodexLogTailSummary(previewDetails.log_tail)
                  : "";
                const previewUpdatedAgo =
                  preview?.fetchedAt != null ? formatAgo(nowTick - preview.fetchedAt) : null;

                return (
                  <Fragment key={m.id}>
                    <div
                      style={{
                        border: "1px solid rgba(124,138,176,0.25)",
                        borderRadius: 10,
                        padding: 10,
                        background:
                          m.role === "assistant"
                            ? "rgba(124,138,176,0.06)"
                            : "rgba(255,255,255,0.03)",
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline" }}>
                        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                          <div style={{ fontWeight: 700, textTransform: "capitalize" }}>{m.role}</div>
                          {needsInput && <span className="badge">needs input</span>}
                        </div>
                        <div className="muted" style={{ fontSize: 12 }}>
                          {formatTime(m.created_at)}
                        </div>
                      </div>

                      <div style={{ whiteSpace: "pre-wrap", marginTop: 6, lineHeight: 1.4 }}>
                        {m.content}
                      </div>

                      {showRunMeta && !!m.run && (
                        <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 6 }}>
                          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                            <span className="badge">{m.run.status}</span>
                            {!!m.run_duration_ms && <span className="muted" style={{ fontSize: 12 }}>duration {formatDuration(m.run_duration_ms)}</span>}
                            {!!m.run.started_at && (
                              <span className="muted" style={{ fontSize: 12 }}>started {formatTime(m.run.started_at)}</span>
                            )}
                            {!!m.run.finished_at && (
                              <span className="muted" style={{ fontSize: 12 }}>finished {formatTime(m.run.finished_at)}</span>
                            )}
                            {!!m.run.error && (
                              <span className="error" style={{ padding: "2px 6px" }}>error: {m.run.error}</span>
                            )}
                            <button className="btnSecondary" onClick={() => setSelectedRunId(m.run!.id)}>
                              View run
                            </button>
                          </div>
                          {(() => {
                            const chips = buildRunChips(m.run);
                            if (!chips.settings.length && !chips.suggestions.length) return null;
                            return (
                              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                                {chips.settings.map((chip) => (
                                  <span key={chip} className="badge">{chip}</span>
                                ))}
                                {chips.suggestions.map((chip) => (
                                  <span key={chip} className="badge">{chip}</span>
                                ))}
                              </div>
                            );
                          })()}
                        </div>
                      )}

                      {showActions && !!m.actions?.length && (
                        <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
                          <div className="muted" style={{ fontSize: 12 }}>Proposed actions</div>
                          {m.actions.map((a, idx) => {
                            const key = `${m.id}:${idx}`;
                            const ledger = ledgerByKey.get(key) || null;
                            const applied = ledger && !ledger.undone_at;
                            const undoable = applied && !!ledger?.undo_payload_json;
                            const isWorktreeMerge = a.type === "worktree_merge";
                            const diffOpen = worktreeDiffOpenKey === key;
                            const ref = extractWorkOrderRef(a);
                            const workOrderMeta = ref
                              ? workOrdersByProject[ref.projectId]?.[ref.workOrderId] ?? null
                              : null;
                            const workOrderLoading = ref ? !!workOrdersLoading[ref.projectId] : false;
                            if (isWorktreeMerge) {
                              const canViewDiff = threadHasPendingChanges || diffOpen;
                              return (
                                <div key={key} style={{ display: "flex", flexDirection: "column", gap: 6, border: "1px solid rgba(124,138,176,0.2)", borderRadius: 10, padding: 10 }}>
                                  <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
                                    <div style={{ fontWeight: 700 }}>{a.title}</div>
                                    <div className="muted" style={{ fontSize: 12 }}>{a.type}</div>
                                  </div>
                                  <div className="muted" style={{ fontSize: 12 }}>
                                    {threadHasPendingChanges ? "Pending worktree changes ready to merge." : "No pending changes."}
                                  </div>
                                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                                    <button
                                      className="btnSecondary"
                                      onClick={() => {
                                        if (diffOpen) {
                                          setWorktreeDiffOpenKey(null);
                                          return;
                                        }
                                        setWorktreeDiffOpenKey(key);
                                        if (!worktreeDiffLoading) {
                                          void fetchWorktreeDiff();
                                        }
                                      }}
                                      disabled={!canViewDiff || worktreeDiffLoading}
                                    >
                                      {diffOpen ? "Hide diff" : "View diff"}
                                    </button>
                                    {!ledger && (
                                      <button
                                        className="btn"
                                        onClick={() => void applyAction(m.id, idx)}
                                        disabled={!!applying[key] || !threadHasPendingChanges}
                                      >
                                        {applying[key] ? "Merging…" : "Merge"}
                                      </button>
                                    )}
                                    {!!ledger && (
                                      <span className="badge">
                                        {ledger.undone_at ? "undone" : "merged"} @ {formatTime(ledger.applied_at)}
                                      </span>
                                    )}
                                  </div>
                                  {diffOpen && (
                                    <div style={{ marginTop: 6 }}>
                                      {worktreeDiffLoading && (
                                        <div className="muted" style={{ fontSize: 12 }}>Loading diff…</div>
                                      )}
                                      {!!worktreeDiffError && (
                                        <div className="error" style={{ marginTop: 6 }}>{worktreeDiffError}</div>
                                      )}
                                      {!worktreeDiffLoading && !worktreeDiffError && (
                                        <pre style={{ marginTop: 6, whiteSpace: "pre-wrap", maxHeight: 320, overflow: "auto" }}>
                                          {worktreeDiff || "(no diff available)"}
                                        </pre>
                                      )}
                                      {!!worktreeDiffFetchedAt && (
                                        <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
                                          Updated {formatAgo(nowTick - worktreeDiffFetchedAt)} ago
                                        </div>
                                      )}
                                    </div>
                                  )}
                                </div>
                              );
                            }
                            return (
                              <div key={key} style={{ display: "flex", flexDirection: "column", gap: 6, border: "1px solid rgba(124,138,176,0.2)", borderRadius: 10, padding: 10 }}>
                                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
                                  <div style={{ fontWeight: 700 }}>{a.title}</div>
                                  <div className="muted" style={{ fontSize: 12 }}>{a.type}</div>
                                </div>
                                {ref && (
                                  <div className="muted" style={{ fontSize: 12 }}>
                                    {workOrderMeta ? (
                                      <>
                                        <div>{workOrderMeta.title}</div>
                                        <div>{summarizeGoal(workOrderMeta.goal)}</div>
                                      </>
                                    ) : workOrderLoading ? (
                                      <div>Loading work order details…</div>
                                    ) : (
                                      <div>Work order details unavailable.</div>
                                    )}
                                  </div>
                                )}
                                <details>
                                  <summary className="muted" style={{ cursor: "pointer" }}>Payload</summary>
                                  <pre style={{ margin: "8px 0 0", whiteSpace: "pre-wrap" }}>{JSON.stringify(a.payload, null, 2)}</pre>
                                </details>

                                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                                  {!ledger && (
                                    <button
                                      className="btn"
                                      onClick={() => void applyAction(m.id, idx)}
                                      disabled={!!applying[key]}
                                    >
                                      {applying[key] ? "Applying…" : "Apply"}
                                    </button>
                                  )}
                                  {!!ledger && (
                                    <span className="badge">
                                      {ledger.undone_at ? "undone" : "applied"} @ {formatTime(ledger.applied_at)}
                                    </span>
                                  )}
                                  {undoable && (
                                    <button
                                      className="btnSecondary"
                                      onClick={() => void undoAction(ledger!.id)}
                                      disabled={!!undoing[ledger!.id]}
                                    >
                                      {undoing[ledger!.id] ? "Undoing…" : "Undo"}
                                    </button>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    {showAssistantPlaceholder && (
                      <div
                        style={{
                          border: "1px solid rgba(124,138,176,0.25)",
                          borderRadius: 10,
                          padding: 10,
                          background: "rgba(124,138,176,0.06)",
                        }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline" }}>
                          <div style={{ fontWeight: 700 }}>assistant</div>
                          <div className="muted" style={{ fontSize: 12 }}>
                            {m.run?.status === "queued" ? "queued" : "running"}
                          </div>
                        </div>

                        <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 8 }}>
                          <div className="spinner" aria-hidden />
                          <div className="muted" style={{ fontSize: 13 }}>
                            {m.run?.status === "queued" ? "Waiting to start…" : "Working…"}
                          </div>
                        </div>
                        <div className="loadingBar" style={{ marginTop: 10 }} />

                        {!!preview?.error && (
                          <div className="error" style={{ marginTop: 10 }}>
                            {preview.error}
                          </div>
                        )}

                        {!!previewLastCommand && (
                          <div style={{ marginTop: 10 }}>
                            <div className="muted" style={{ fontSize: 12 }}>
                              Now running <code>{shortenPath(previewLastCommand.cwd, 3)}</code>
                            </div>
                            <pre style={{ margin: "6px 0 0", whiteSpace: "pre-wrap" }}>
                              {unwrapShellCommand(previewLastCommand.command)}
                            </pre>
                          </div>
                        )}

                        <details style={{ marginTop: 10 }}>
                          <summary className="muted" style={{ cursor: "pointer" }}>
                            {(previewLogSummary ? previewLogSummary : "Log tail") +
                              (previewUpdatedAgo ? ` (updated ${previewUpdatedAgo} ago)` : "")}
                          </summary>
                          <pre style={{ marginTop: 8, whiteSpace: "pre-wrap", maxHeight: 240, overflow: "auto" }}>
                            {previewDetails?.log_tail || "(empty)"}
                          </pre>
                        </details>

                        <div style={{ marginTop: 10 }}>
                          <button className="btnSecondary" onClick={() => setSelectedRunId(m.run!.id)}>
                            View run
                          </button>
                        </div>
                      </div>
                    )}
                  </Fragment>
                );
              })}
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <input
                className="input"
                value={input}
                placeholder="Message…"
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    void requestSuggestion();
                  }
                }}
                disabled={composerLocked}
              />
              <button
                className="btn"
                onClick={() => void requestSuggestion()}
                disabled={composerLocked || !input.trim()}
              >
                {sending ? "Sending…" : suggestionLoading ? "Suggesting…" : "Send"}
              </button>
              <button
                className="btnSecondary"
                onClick={() => setControlsOpen((prev) => !prev)}
                disabled={composerLocked}
              >
                {controlsOpen ? "Hide Access + Context" : "Access + Context"}
              </button>
            </div>

            {controlsOpen && (
              <div className="card" style={{ background: "rgba(255,255,255,0.02)" }}>
                <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                  <label style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 180 }}>
                    <span className="muted" style={{ fontSize: 12 }}>Context depth</span>
                    <select
                      className="input"
                      value={contextDepth}
                      onChange={(e) => setContextDepth(e.target.value as ChatContextDepth)}
                      disabled={composerLocked}
                    >
                      <option value="blended">Blended (tiered recency)</option>
                      <option value="minimal">Minimal (summary + current message)</option>
                      <option value="messages">Messages (last 50)</option>
                      <option value="messages_tools">Messages + Tools</option>
                      <option value="messages_tools_outputs">Messages + Tools + Outputs</option>
                    </select>
                  </label>

                  <label style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 160 }}>
                    <span className="muted" style={{ fontSize: 12 }}>Filesystem</span>
                    <select
                      className="input"
                      value={access.filesystem}
                      onChange={(e) =>
                        setAccess((prev) => ({
                          ...prev,
                          filesystem: e.target.value as ChatFilesystemAccess,
                        }))
                      }
                      disabled={composerLocked}
                    >
                      <option value="none">None</option>
                      <option value="read-only">Read-only</option>
                      <option value="read-write">Read-write</option>
                    </select>
                  </label>

                  <label style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 160 }}>
                    <span className="muted" style={{ fontSize: 12 }}>CLI</span>
                    <select
                      className="input"
                      value={access.cli}
                      onChange={(e) =>
                        setAccess((prev) => ({
                          ...prev,
                          cli: e.target.value as ChatCliAccess,
                        }))
                      }
                      disabled={composerLocked}
                    >
                      <option value="off">Off</option>
                      <option value="read-only">Read-only</option>
                      <option value="read-write">Read-write</option>
                    </select>
                  </label>

                  <label style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 170 }}>
                    <span className="muted" style={{ fontSize: 12 }}>Network</span>
                    <select
                      className="input"
                      value={access.network}
                      onChange={(e) => {
                        const next = e.target.value as ChatNetworkAccess;
                        setAccess((prev) => ({
                          ...prev,
                          network: next,
                          network_allowlist: next === "allowlist" ? prev.network_allowlist : [],
                        }));
                        if (next !== "allowlist") setNetworkAllowlistInput("");
                      }}
                      disabled={composerLocked}
                    >
                      <option value="none">None</option>
                      <option value="localhost">Localhost</option>
                      <option value="allowlist">Allowlist</option>
                      <option value="trusted">Trusted pack</option>
                    </select>
                  </label>
                </div>

                {requiresAllowlistInput(access) && (
                  <div style={{ marginTop: 8 }}>
                    <div className="muted" style={{ fontSize: 12 }}>
                      Allowlist hosts (comma-separated)
                    </div>
                    <input
                      className="input"
                      value={networkAllowlistInput}
                      onChange={(e) => {
                        const next = e.target.value;
                        setNetworkAllowlistInput(next);
                        setAccess((prev) => ({
                          ...prev,
                          network_allowlist: next
                            .split(",")
                            .map((entry) => entry.trim())
                            .filter(Boolean),
                        }));
                      }}
                      disabled={composerLocked}
                      placeholder="localhost, 127.0.0.1"
                    />
                    <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                      Hostnames only (no wildcards).
                    </div>
                  </div>
                )}
                {access.network === "trusted" && (
                  <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
                    Uses the trusted host pack from Chat Settings.
                  </div>
                )}

                {(requiresWrite(normalizedAccess) || requiresNetworkConfirmation(normalizedAccess)) && (
                  <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
                    {requiresWrite(normalizedAccess) && (
                      <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12 }}>
                        <input
                          type="checkbox"
                          checked={confirmations.write}
                          onChange={(e) =>
                            setConfirmations((prev) => ({ ...prev, write: e.target.checked }))
                          }
                          disabled={composerLocked}
                        />
                        <span>I approve write access for this message.</span>
                      </label>
                    )}
                    {requiresNetworkConfirmation(normalizedAccess) && (
                      <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12 }}>
                        <input
                          type="checkbox"
                          checked={confirmations.network_allowlist}
                          onChange={(e) =>
                            setConfirmations((prev) => ({
                              ...prev,
                              network_allowlist: e.target.checked,
                            }))
                          }
                          disabled={composerLocked}
                        />
                        <span>I approve network access for this message.</span>
                      </label>
                    )}
                  </div>
                )}

                {accessUnsupported && (
                  <div className="error" style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 4 }}>
                    {normalizedAccess.filesystem === "none" && normalizedAccess.cli !== "off" && (
                      <div>Filesystem access &apos;none&apos; requires CLI access to be off.</div>
                    )}
                    {normalizedAccess.network === "allowlist" && !normalizedAccess.network_allowlist?.length && (
                      <div>Network allowlist requires at least one host.</div>
                    )}
                    {normalizedAccess.cli === "read-write" && normalizedAccess.filesystem !== "read-write" && (
                      <div>CLI read-write requires filesystem read-write.</div>
                    )}
                    {normalizedAccess.cli === "read-only" && normalizedAccess.filesystem === "read-write" && (
                      <div>CLI read-only is incompatible with filesystem read-write.</div>
                    )}
                  </div>
                )}
              </div>
            )}

            {suggestionLoading && (
              <div className="muted" style={{ fontSize: 12 }}>
                Analyzing context + access…
              </div>
            )}
            {!!suggestionError && !pendingMessage && <div className="error">{suggestionError}</div>}

            {!!pendingMessage && suggestion && (
              <div className="card" style={{ background: "rgba(255,255,255,0.02)" }}>
                <div style={{ fontWeight: 700 }}>Suggested settings</div>
                {!suggestionChanges.length && (
                  <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
                    No changes suggested.
                  </div>
                )}
                {!!suggestionChanges.length && (
                  <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 4 }}>
                    {suggestionChanges.map((change) => (
                      <div key={change} className="muted" style={{ fontSize: 12 }}>
                        {change}
                      </div>
                    ))}
                  </div>
                )}
                {!!(sanitizedSuggestion?.reason || suggestion.reason) && (
                  <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
                    Reason: {sanitizedSuggestion?.reason || suggestion.reason}
                  </div>
                )}

                {(baseNeedsWrite || baseNeedsNetwork || appliedNeedsWrite || appliedNeedsNetwork) && (
                  <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
                    {(baseNeedsWrite || appliedNeedsWrite) && (
                      <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12 }}>
                        <input
                          type="checkbox"
                          checked={confirmations.write}
                          onChange={(e) =>
                            setConfirmations((prev) => ({ ...prev, write: e.target.checked }))
                          }
                          disabled={sending}
                        />
                        <span>Approve write access for this message.</span>
                      </label>
                    )}
                    {(baseNeedsNetwork || appliedNeedsNetwork) && (
                      <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12 }}>
                        <input
                          type="checkbox"
                          checked={confirmations.network_allowlist}
                          onChange={(e) =>
                            setConfirmations((prev) => ({
                              ...prev,
                              network_allowlist: e.target.checked,
                            }))
                          }
                          disabled={sending}
                        />
                        <span>Approve network access for this message.</span>
                      </label>
                    )}
                  </div>
                )}

                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 10 }}>
                  <button
                    className="btn"
                    onClick={() => {
                      if (!pendingSelection || !pendingMessage || !appliedSelection) return;
                      const accepted = suggestionChanges.length ? sanitizedSuggestion : null;
                      void sendWithSettings({
                        content: pendingMessage,
                        selection: appliedSelection,
                        acceptedSuggestion: accepted,
                      });
                    }}
                    disabled={!canApproveApplied || sending}
                  >
                    Accept + Send
                  </button>
                  <button
                    className="btnSecondary"
                    onClick={() => {
                      if (!pendingSelection || !pendingMessage) return;
                      void sendWithSettings({
                        content: pendingMessage,
                        selection: pendingSelection,
                        acceptedSuggestion: null,
                      });
                    }}
                    disabled={!canApproveBase || sending}
                  >
                    Deny (send current)
                  </button>
                  <button
                    className="btnSecondary"
                    onClick={() => {
                      setPendingMessage(null);
                      setPendingSelection(null);
                      setSuggestion(null);
                      setSuggestionError(null);
                    }}
                    disabled={sending}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {!!pendingMessage && !suggestion && !!suggestionError && (
              <div className="card" style={{ background: "rgba(255,255,255,0.02)" }}>
                <div style={{ fontWeight: 700 }}>Suggestions unavailable</div>
                <div className="error" style={{ fontSize: 12, marginTop: 6 }}>
                  {suggestionError}
                </div>

                {(baseNeedsWrite || baseNeedsNetwork) && (
                  <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
                    {baseNeedsWrite && (
                      <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12 }}>
                        <input
                          type="checkbox"
                          checked={confirmations.write}
                          onChange={(e) =>
                            setConfirmations((prev) => ({ ...prev, write: e.target.checked }))
                          }
                          disabled={sending}
                        />
                        <span>Approve write access for this message.</span>
                      </label>
                    )}
                    {baseNeedsNetwork && (
                      <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12 }}>
                        <input
                          type="checkbox"
                          checked={confirmations.network_allowlist}
                          onChange={(e) =>
                            setConfirmations((prev) => ({
                              ...prev,
                              network_allowlist: e.target.checked,
                            }))
                          }
                          disabled={sending}
                        />
                        <span>Approve network access for this message.</span>
                      </label>
                    )}
                  </div>
                )}

                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 10 }}>
                  <button
                    className="btn"
                    onClick={() => {
                      if (!pendingSelection || !pendingMessage) return;
                      void sendWithSettings({
                        content: pendingMessage,
                        selection: pendingSelection,
                        acceptedSuggestion: null,
                      });
                    }}
                    disabled={!canApproveBase || sending}
                  >
                    Send without suggestion
                  </button>
                  <button
                    className="btnSecondary"
                    onClick={() => void retrySuggestion()}
                    disabled={suggestionLoading || sending}
                  >
                    Retry suggestion
                  </button>
                  <button
                    className="btnSecondary"
                    onClick={() => {
                      setPendingMessage(null);
                      setPendingSelection(null);
                      setSuggestion(null);
                      setSuggestionError(null);
                    }}
                    disabled={sending}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            <div className="muted" style={{ fontSize: 12 }}>
              Tip: <code>Ctrl</code>/<code>Cmd</code>+<code>Enter</code> sends.
            </div>
          </div>

          <details>
            <summary className="muted" style={{ cursor: "pointer" }}>Action ledger</summary>
            {!(data?.action_ledger || []).length && (
              <div className="muted" style={{ marginTop: 8 }}>
                No applied actions yet.
              </div>
            )}
            {!!(data?.action_ledger || []).length && (
              <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 8 }}>
                {(data?.action_ledger || []).map((entry) => {
                  const applied = !entry.undone_at;
                  const undoable = applied && !!entry.undo_payload_json;
                  return (
                    <div key={entry.id} style={{ border: "1px solid rgba(124,138,176,0.2)", borderRadius: 10, padding: 10 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
                        <div style={{ fontWeight: 700 }}>{entry.action_type}</div>
                        <div className="muted" style={{ fontSize: 12 }}>applied {formatTime(entry.applied_at)}</div>
                      </div>
                      <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                        message <code>{entry.message_id}</code> · action #{entry.action_index}
                      </div>
                      <details style={{ marginTop: 6 }}>
                        <summary className="muted" style={{ cursor: "pointer" }}>Payload</summary>
                        <pre style={{ margin: "8px 0 0", whiteSpace: "pre-wrap" }}>
                          {renderJson(entry.action_payload_json)}
                        </pre>
                      </details>
                      {!!entry.undo_payload_json && (
                        <details style={{ marginTop: 6 }}>
                          <summary className="muted" style={{ cursor: "pointer" }}>Undo payload</summary>
                          <pre style={{ margin: "8px 0 0", whiteSpace: "pre-wrap" }}>
                            {renderJson(entry.undo_payload_json)}
                          </pre>
                        </details>
                      )}
                      {!!entry.error && (
                        <div className="error" style={{ marginTop: 8 }}>
                          error: {entry.error}
                        </div>
                      )}
                      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 8 }}>
                        <span className="badge">
                          {entry.undone_at ? "undone" : "applied"}
                          {entry.undone_at ? ` @ ${formatTime(entry.undone_at)}` : ""}
                        </span>
                        {undoable && (
                          <button
                            className="btnSecondary"
                            onClick={() => void undoAction(entry.id)}
                            disabled={!!undoing[entry.id]}
                          >
                            {undoing[entry.id] ? "Undoing…" : "Undo"}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </details>

          {!!selectedRunId && (
            <div className="card" style={{ marginTop: 8, background: "rgba(255,255,255,0.02)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
                <div style={{ fontWeight: 700 }}>Run details</div>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <button className="btnSecondary" onClick={() => void fetchRunDetails(selectedRunId)} disabled={!selectedRunId}>
                    Refresh
                  </button>
                  <button className="btnSecondary" onClick={() => setSelectedRunId(null)}>
                    Close
                  </button>
                </div>
              </div>

              {!!runError && <div className="error" style={{ marginTop: 8 }}>{runError}</div>}

              {!!runDetails && (
                <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 10 }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <span className="badge">{runDetails.status}</span>
                    {!!runDetails.started_at && <span className="muted" style={{ fontSize: 12 }}>started {formatTime(runDetails.started_at)}</span>}
                    {!!runDetails.finished_at && <span className="muted" style={{ fontSize: 12 }}>finished {formatTime(runDetails.finished_at)}</span>}
                    <span className="muted" style={{ fontSize: 12 }}>cwd <code>{runDetails.cwd}</code></span>
                  </div>
                  {(() => {
                    const chips = buildRunChips(runDetails);
                    if (!chips.settings.length && !chips.suggestions.length) return null;
                    return (
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        {chips.settings.map((chip) => (
                          <span key={chip} className="badge">{chip}</span>
                        ))}
                        {chips.suggestions.map((chip) => (
                          <span key={chip} className="badge">{chip}</span>
                        ))}
                      </div>
                    );
                  })()}

                  <details open>
                    <summary className="muted" style={{ cursor: "pointer" }}>Command audit</summary>
                    {!runDetails.commands.length && <div className="muted" style={{ marginTop: 8 }}>No commands recorded.</div>}
                    {!!runDetails.commands.length && (
                      <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
                        {runDetails.commands.map((c) => (
                          <div key={c.id} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                            <div className="muted" style={{ fontSize: 12 }}>
                              <code>{c.cwd}</code>
                            </div>
                            <pre style={{ margin: 0, whiteSpace: "pre-wrap" }} title={c.command}>
                              {unwrapShellCommand(c.command)}
                            </pre>
                          </div>
                        ))}
                      </div>
                    )}
                  </details>

                  <details>
                    <summary className="muted" style={{ cursor: "pointer" }}>
                      {(() => {
                        const updatedAgo =
                          runDetailsFetchedAt != null ? formatAgo(nowTick - runDetailsFetchedAt) : null;
                        const label =
                          (runDetails.log_tail ? formatCodexLogTailSummary(runDetails.log_tail) : "") ||
                          "Raw Codex log (tail)";
                        return `${label}${updatedAgo ? ` (updated ${updatedAgo} ago)` : ""}`;
                      })()}
                    </summary>
                    <pre style={{ marginTop: 8, whiteSpace: "pre-wrap", maxHeight: 240, overflow: "auto" }}>
                      {runDetails.log_tail || "(empty)"}
                    </pre>
                  </details>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
