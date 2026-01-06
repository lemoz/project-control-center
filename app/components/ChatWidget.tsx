"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChatThread } from "./ChatThread";
import { scopeLabel, type AttentionItem, type AttentionResponse } from "./chat_attention";

type ChatScope = "global" | "project" | "work_order";
type ChatRunStatus = "queued" | "running" | "done" | "failed";

type ChatThreadSummary = {
  id: string;
  name: string;
  scope: ChatScope;
  project_id: string | null;
  work_order_id: string | null;
  summary: string;
  summarized_count: number;
  default_context_depth: string;
  default_access_filesystem: string;
  default_access_cli: string;
  default_access_network: string;
  default_access_network_allowlist: string | null;
  last_read_at: string | null;
  last_ack_at: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
  last_message_at?: string | null;
  last_run_status?: ChatRunStatus | null;
  last_run_at?: string | null;
  attention?: {
    needs_you: boolean;
    reason_codes: string[];
    reasons: Array<{ code: string; created_at: string; count: number }>;
    last_event_at: string | null;
  };
};

type ThreadsResponse = {
  threads: ChatThreadSummary[];
  error?: string;
};

type ThreadDetailsResponse = {
  thread: ChatThreadSummary;
  messages: { created_at: string }[];
  error?: string;
};

type DerivedScope =
  | { scope: "global" }
  | { scope: "project"; projectId: string }
  | { scope: "work_order"; projectId: string; workOrderId: string };

function deriveScopeFromPath(pathname: string): DerivedScope {
  const parts = pathname.split("/").filter(Boolean);
  if (parts[0] !== "projects" || !parts[1]) return { scope: "global" };
  const projectId = decodeURIComponent(parts[1]);
  if (parts[2] === "work-orders" && parts[3]) {
    return { scope: "work_order", projectId, workOrderId: decodeURIComponent(parts[3]) };
  }
  return { scope: "project", projectId };
}

function formatScopeHint(scope: DerivedScope): string {
  if (scope.scope === "global") return "Global";
  if (scope.scope === "project") return `Project - ${scope.projectId}`;
  return `Work order - ${scope.projectId} / ${scope.workOrderId}`;
}

function threadDisplayName(thread: ChatThreadSummary): string {
  const name = thread.name?.trim();
  if (name) return name;
  if (thread.scope === "global") return "Global chat";
  if (thread.scope === "project") return `Project ${thread.project_id ?? "thread"}`;
  return `Work order ${thread.work_order_id ?? "thread"}`;
}

function threadContextLabel(thread: ChatThreadSummary): string {
  if (thread.scope === "global") return "Global";
  if (thread.scope === "project") return thread.project_id ?? "Project";
  return `${thread.project_id ?? "Project"} / ${thread.work_order_id ?? "Work order"}`;
}

function latestTimestamp(thread: ChatThreadSummary): string {
  return thread.last_message_at || thread.updated_at || thread.created_at;
}

function lastActivityAt(thread: ChatThreadSummary): string | null {
  const lastMessageAt = thread.last_message_at ?? null;
  const lastRunAt = thread.last_run_at ?? null;
  if (lastMessageAt && lastRunAt) {
    return lastMessageAt > lastRunAt ? lastMessageAt : lastRunAt;
  }
  return lastMessageAt ?? lastRunAt ?? null;
}

function compareIsoDesc(a: string, b: string): number {
  if (a === b) return 0;
  return a > b ? -1 : 1;
}

function parseStreamThreadId(raw: string): string | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const record = parsed as Record<string, unknown>;
    return typeof record.thread_id === "string" ? record.thread_id : null;
  } catch {
    return null;
  }
}

function threadBaseRank(
  thread: ChatThreadSummary,
  attention: AttentionItem | undefined
): number {
  if (attention?.attention.needs_you) return 0;
  if (thread.last_run_status === "failed") return 1;
  if (thread.last_run_status === "running" || thread.last_run_status === "queued") return 2;
  const latest = lastActivityAt(thread);
  if (latest && (!thread.last_read_at || latest > thread.last_read_at)) {
    return 3;
  }
  return 4;
}

function threadSortRank(
  thread: ChatThreadSummary,
  attention: AttentionItem | undefined
): number {
  const base = threadBaseRank(thread, attention);
  return thread.archived_at ? base + 10 : base;
}

export function ChatWidget() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const chatOpen = searchParams.get("chat") === "1";
  const threadParam = searchParams.get("thread");
  const [threads, setThreads] = useState<ChatThreadSummary[]>([]);
  const [threadsLoading, setThreadsLoading] = useState(true);
  const [threadsRefreshing, setThreadsRefreshing] = useState(false);
  const [threadsError, setThreadsError] = useState<string | null>(null);
  const [attentionItems, setAttentionItems] = useState<AttentionItem[]>([]);
  const [attentionError, setAttentionError] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [newThreadName, setNewThreadName] = useState("");
  const [creating, setCreating] = useState(false);
  const [threadActionError, setThreadActionError] = useState<string | null>(null);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [savingRename, setSavingRename] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [streamConnected, setStreamConnected] = useState(false);
  const [threadRefreshToken, setThreadRefreshToken] = useState<number | null>(null);
  const hasLoadedThreadsRef = useRef(false);
  const loadingThreadRef = useRef<string | null>(null);
  const streamRefreshTimerRef = useRef<number | null>(null);
  const streamRefreshActiveRef = useRef(false);

  const derivedScope = useMemo(() => deriveScopeFromPath(pathname), [pathname]);

  const attentionByThread = useMemo(() => {
    return new Map(attentionItems.map((item) => [item.thread_id, item]));
  }, [attentionItems]);

  const activeThreadId = threadParam || null;
  const activeThread = useMemo(
    () => (activeThreadId ? threads.find((thread) => thread.id === activeThreadId) ?? null : null),
    [activeThreadId, threads]
  );

  useEffect(() => {
    if (!activeThread) {
      setRenameOpen(false);
      setRenameValue("");
      return;
    }
    setRenameOpen(false);
    setRenameValue(activeThread.name || "");
  }, [activeThread?.id]);

  useEffect(() => {
    setThreadRefreshToken(null);
  }, [activeThreadId]);

  useEffect(() => {
    setThreadActionError(null);
  }, [activeThreadId]);

  const visibleThreads = useMemo(() => {
    const filtered = threads.filter((thread) =>
      showArchived || !thread.archived_at || thread.id === activeThreadId
    );
    return filtered.sort((a, b) => {
      const rankA = threadSortRank(a, attentionByThread.get(a.id));
      const rankB = threadSortRank(b, attentionByThread.get(b.id));
      if (rankA !== rankB) return rankA - rankB;
      const timeOrder = compareIsoDesc(latestTimestamp(a), latestTimestamp(b));
      if (timeOrder !== 0) return timeOrder;
      return a.id.localeCompare(b.id);
    });
  }, [threads, showArchived, activeThreadId, attentionByThread]);

  const attentionCount = attentionItems.length;
  const attentionBadge = attentionCount > 99 ? "99+" : String(attentionCount);

  const updateQuery = useCallback(
    (
      updates: Record<string, string | null>,
      options?: { replace?: boolean }
    ) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(updates)) {
        if (value === null) params.delete(key);
        else params.set(key, value);
      }
      const query = params.toString();
      const href = query ? `${pathname}?${query}` : pathname;
      if (options?.replace) router.replace(href, { scroll: false });
      else router.push(href, { scroll: false });
    },
    [pathname, router, searchParams]
  );

  const loadAttention = useCallback(async () => {
    setAttentionError(null);
    try {
      const res = await fetch("/api/chat/attention", { cache: "no-store" });
      const json = (await res.json().catch(() => null)) as AttentionResponse | null;
      if (!res.ok) throw new Error(json?.error || "failed to load attention");
      setAttentionItems(json?.items ?? []);
    } catch (e) {
      setAttentionError(e instanceof Error ? e.message : "failed to load attention");
    }
  }, []);

  const loadThreads = useCallback(async () => {
    const isInitial = !hasLoadedThreadsRef.current;
    if (isInitial) setThreadsLoading(true);
    else setThreadsRefreshing(true);
    setThreadsError(null);
    try {
      const res = await fetch("/api/chat/threads?include_archived=1&limit=200", {
        cache: "no-store",
      });
      const json = (await res.json().catch(() => null)) as ThreadsResponse | null;
      if (!res.ok) throw new Error(json?.error || "failed to load threads");
      const nextThreads = json?.threads ?? [];
      setThreads((prev) => {
        if (!activeThreadId) return nextThreads;
        if (nextThreads.some((thread) => thread.id === activeThreadId)) return nextThreads;
        const existing = prev.find((thread) => thread.id === activeThreadId);
        return existing ? [...nextThreads, existing] : nextThreads;
      });
      hasLoadedThreadsRef.current = true;
    } catch (e) {
      setThreadsError(e instanceof Error ? e.message : "failed to load threads");
    } finally {
      setThreadsLoading(false);
      setThreadsRefreshing(false);
    }
  }, [activeThreadId]);

  const scheduleStreamRefresh = useCallback(
    (threadId: string | null) => {
      if (threadId && threadId === activeThreadId) {
        streamRefreshActiveRef.current = true;
      }
      if (streamRefreshTimerRef.current !== null) return;
      streamRefreshTimerRef.current = window.setTimeout(() => {
        streamRefreshTimerRef.current = null;
        const refreshActive = streamRefreshActiveRef.current;
        streamRefreshActiveRef.current = false;
        void loadThreads();
        void loadAttention();
        if (refreshActive) {
          setThreadRefreshToken((prev) => (prev ?? 0) + 1);
        }
      }, 200);
    },
    [activeThreadId, loadAttention, loadThreads]
  );

  const loadMissingThread = useCallback(async (threadId: string) => {
    if (!threadId) return;
    if (loadingThreadRef.current === threadId) return;
    loadingThreadRef.current = threadId;
    try {
      const res = await fetch(`/api/chat/threads/${encodeURIComponent(threadId)}`, {
        cache: "no-store",
      });
      const json = (await res.json().catch(() => null)) as ThreadDetailsResponse | null;
      if (!res.ok) throw new Error(json?.error || "failed to load thread");
      const thread = json?.thread;
      if (!thread) return;
      const messages = Array.isArray(json?.messages) ? json?.messages : [];
      const lastMessageAt = messages.length ? messages[messages.length - 1]?.created_at ?? null : null;
      const summary: ChatThreadSummary = {
        ...thread,
        last_message_at: lastMessageAt,
      };
      setThreads((prev) => (prev.some((item) => item.id === summary.id) ? prev : [...prev, summary]));
    } catch {
      // best-effort only; ChatThread handles missing thread errors
    } finally {
      if (loadingThreadRef.current === threadId) {
        loadingThreadRef.current = null;
      }
    }
  }, []);

  useEffect(() => {
    void loadAttention();
    if (chatOpen && streamConnected) return;
    const t = setInterval(() => void loadAttention(), 15000);
    return () => clearInterval(t);
  }, [chatOpen, loadAttention, streamConnected]);

  useEffect(() => {
    if (!chatOpen) return;
    void loadThreads();
    if (streamConnected) return;
    const t = setInterval(() => void loadThreads(), 15000);
    return () => clearInterval(t);
  }, [chatOpen, loadThreads, streamConnected]);

  useEffect(() => {
    if (!chatOpen) return;
    if (typeof EventSource === "undefined") {
      setStreamConnected(false);
      return;
    }
    const stream = new EventSource("/api/chat/stream");
    const eventTypes = [
      "chat.message.new",
      "chat.run.status",
      "chat.action.applied",
      "chat.action.undone",
      "chat.thread.updated",
      "chat.attention.updated",
    ];
    const handleEvent = (event: MessageEvent) => {
      const threadId = parseStreamThreadId(event.data);
      scheduleStreamRefresh(threadId);
    };
    eventTypes.forEach((type) => stream.addEventListener(type, handleEvent));
    stream.onopen = () => {
      setStreamConnected(true);
      scheduleStreamRefresh(activeThreadId ?? null);
    };
    stream.onerror = () => {
      setStreamConnected(false);
    };

    return () => {
      eventTypes.forEach((type) => stream.removeEventListener(type, handleEvent));
      stream.close();
      setStreamConnected(false);
      if (streamRefreshTimerRef.current !== null) {
        window.clearTimeout(streamRefreshTimerRef.current);
        streamRefreshTimerRef.current = null;
        streamRefreshActiveRef.current = false;
      }
    };
  }, [activeThreadId, chatOpen, scheduleStreamRefresh]);

  useEffect(() => {
    if (!chatOpen) return;
    if (!activeThreadId) return;
    const threadExists = threads.some((thread) => thread.id === activeThreadId);
    if (threadExists) return;
    void loadMissingThread(activeThreadId);
  }, [activeThreadId, chatOpen, loadMissingThread, threads]);

  useEffect(() => {
    if (!chatOpen) return;
    if (activeThreadId) return;
    if (!threads.length) return;
    const scopeMatch = threads.find((thread) => {
      if (thread.archived_at) return false;
      if (derivedScope.scope === "global") return thread.scope === "global";
      if (derivedScope.scope === "project") {
        return thread.scope === "project" && thread.project_id === derivedScope.projectId;
      }
      return (
        thread.scope === "work_order" &&
        thread.project_id === derivedScope.projectId &&
        thread.work_order_id === derivedScope.workOrderId
      );
    });
    const fallback = scopeMatch || visibleThreads[0];
    if (fallback) {
      updateQuery({ chat: "1", thread: fallback.id }, { replace: true });
    }
  }, [activeThreadId, chatOpen, derivedScope, threads, updateQuery, visibleThreads]);

  useEffect(() => {
    if (!chatOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") updateQuery({ chat: null }, { replace: false });
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [chatOpen, updateQuery]);

  useEffect(() => {
    if (!chatOpen) return;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, [chatOpen]);

  const openOverlay = useCallback(() => {
    if (chatOpen) return;
    updateQuery({ chat: "1", thread: activeThreadId }, { replace: false });
  }, [activeThreadId, chatOpen, updateQuery]);

  const minimizeOverlay = useCallback(() => {
    updateQuery({ chat: null }, { replace: false });
  }, [updateQuery]);

  const closeOverlay = useCallback(() => {
    updateQuery({ chat: null, thread: null }, { replace: false });
  }, [updateQuery]);

  const createThread = useCallback(async () => {
    if (creating) return;
    const name = newThreadName.trim();
    setCreating(true);
    setThreadActionError(null);
    try {
      const payload: Record<string, unknown> = {
        scope: derivedScope.scope,
        name: name || undefined,
      };
      if (derivedScope.scope === "project") {
        payload.projectId = derivedScope.projectId;
      } else if (derivedScope.scope === "work_order") {
        payload.projectId = derivedScope.projectId;
        payload.workOrderId = derivedScope.workOrderId;
      }
      const res = await fetch("/api/chat/threads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = (await res.json().catch(() => null)) as ChatThreadSummary | { error?: string } | null;
      if (!res.ok) throw new Error((json as { error?: string } | null)?.error || "failed to create thread");
      const created = json as ChatThreadSummary;
      setNewThreadName("");
      await loadThreads();
      updateQuery({ chat: "1", thread: created.id }, { replace: false });
    } catch (e) {
      setThreadActionError(e instanceof Error ? e.message : "failed to create thread");
    } finally {
      setCreating(false);
    }
  }, [creating, derivedScope, loadThreads, newThreadName, updateQuery]);

  const updateThread = useCallback(
    async (threadId: string, patch: Record<string, unknown>) => {
      const res = await fetch(`/api/chat/threads/${encodeURIComponent(threadId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const json = (await res.json().catch(() => null)) as ChatThreadSummary | { error?: string } | null;
      if (!res.ok) throw new Error((json as { error?: string } | null)?.error || "failed to update thread");
      await loadThreads();
      return json as ChatThreadSummary;
    },
    [loadThreads]
  );

  const saveRename = useCallback(async () => {
    if (!activeThread) return;
    const name = renameValue.trim();
    if (!name) {
      setThreadActionError("Thread name is required.");
      return;
    }
    setSavingRename(true);
    setThreadActionError(null);
    try {
      await updateThread(activeThread.id, { name });
      setRenameOpen(false);
    } catch (e) {
      setThreadActionError(e instanceof Error ? e.message : "failed to rename thread");
    } finally {
      setSavingRename(false);
    }
  }, [activeThread, renameValue, updateThread]);

  const toggleArchive = useCallback(async () => {
    if (!activeThread) return;
    setArchiving(true);
    setThreadActionError(null);
    try {
      const archived = !activeThread.archived_at;
      await updateThread(activeThread.id, { archived });
    } catch (e) {
      setThreadActionError(e instanceof Error ? e.message : "failed to update thread");
    } finally {
      setArchiving(false);
    }
  }, [activeThread, updateThread]);

  return (
    <>
      {!chatOpen && (
        <div className="chat-widget">
          <button className="chat-widget-btn" onClick={openOverlay} type="button">
            <span>Chat</span>
            {attentionCount > 0 && (
              <span className="chat-widget-badge" aria-label={`${attentionCount} threads need attention`}>
                {attentionBadge}
              </span>
            )}
          </button>
          {!!attentionError && (
            <div className="chat-widget-error">Chat offline</div>
          )}
        </div>
      )}

      {chatOpen && (
        <div className="chat-overlay" role="dialog" aria-modal="true">
          <button
            type="button"
            className="chat-overlay-backdrop"
            onClick={minimizeOverlay}
            aria-label="Minimize chat"
          />
          <div className="chat-overlay-panel">
            <div className="chat-overlay-top">
              <div>
                <div style={{ fontWeight: 700 }}>Chat</div>
                <div className="muted" style={{ fontSize: 12 }}>
                  {attentionCount ? `${attentionCount} threads need attention` : "All caught up"}
                </div>
              </div>
              <div className="chat-overlay-actions">
                <button className="btnSecondary" onClick={minimizeOverlay} type="button">
                  Minimize
                </button>
                <button className="btnSecondary" onClick={closeOverlay} type="button">
                  Close
                </button>
              </div>
            </div>

            <div className="chat-overlay-body">
              <aside className="chat-thread-list">
                <div className="chat-thread-list-header">
                  <div>
                    <div style={{ fontWeight: 700 }}>Threads</div>
                    <div className="muted" style={{ fontSize: 12 }}>{formatScopeHint(derivedScope)}</div>
                  </div>
                  <button
                    className="btnSecondary"
                    onClick={() => void loadThreads()}
                    disabled={threadsLoading || threadsRefreshing}
                    type="button"
                  >
                    {threadsRefreshing ? "Refreshing..." : "Refresh"}
                  </button>
                </div>

                <div className="chat-new-thread">
                  <input
                    className="input"
                    placeholder="New thread name (optional)"
                    value={newThreadName}
                    onChange={(event) => setNewThreadName(event.target.value)}
                  />
                  <button className="btn" onClick={() => void createThread()} disabled={creating} type="button">
                    {creating ? "Creating..." : "New thread"}
                  </button>
                </div>

                {threadsError && <div className="error">{threadsError}</div>}

                <label className="chat-toggle">
                  <input
                    type="checkbox"
                    checked={showArchived}
                    onChange={(event) => setShowArchived(event.target.checked)}
                  />
                  <span>Show archived</span>
                </label>

                {threadsLoading && <div className="muted">Loading threads...</div>}
                {!threadsLoading && !visibleThreads.length && (
                  <div className="muted">No threads yet. Start one above.</div>
                )}

                {!threadsLoading && visibleThreads.length > 0 && (
                  <div className="chat-thread-items">
                    {visibleThreads.map((thread) => {
                      const attention = attentionByThread.get(thread.id);
                      const statusRank = threadBaseRank(thread, attention);
                      const primaryStatus = attention
                        ? "Needs you"
                        : statusRank === 1
                          ? "Failed"
                          : statusRank === 2
                            ? "Running"
                            : statusRank === 3
                              ? "Unread"
                              : "Recent";
                      return (
                        <button
                          key={thread.id}
                          className={`chat-thread-item${thread.id === activeThreadId ? " active" : ""}`}
                          onClick={() => updateQuery({ chat: "1", thread: thread.id }, { replace: false })}
                          type="button"
                        >
                          <div className="chat-thread-item-title">{threadDisplayName(thread)}</div>
                          <div className="muted" style={{ fontSize: 12 }}>
                            {threadContextLabel(thread)}
                          </div>
                          <div className="chat-thread-pills">
                            <span className="chat-pill">{scopeLabel(thread.scope)}</span>
                            <span className="chat-pill">{primaryStatus}</span>
                            {thread.archived_at && <span className="chat-pill">Archived</span>}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </aside>

              <section className="chat-thread-panel">
                {threadActionError && <div className="error">{threadActionError}</div>}
                {!activeThreadId && (
                  <div className="card">
                    <div style={{ fontWeight: 700 }}>No thread selected</div>
                    <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
                      Pick a thread on the left or create a new one.
                    </div>
                  </div>
                )}
                    {activeThreadId && (
                      <div className="chat-thread-active">
                    <div className="chat-thread-active-header">
                      <div>
                        <div style={{ fontWeight: 700 }}>{activeThread ? threadDisplayName(activeThread) : "Thread"}</div>
                        <div className="muted" style={{ fontSize: 12 }}>
                          {activeThread ? threadContextLabel(activeThread) : ""}
                        </div>
                      </div>
                      <div className="chat-thread-active-actions">
                        <button
                          className="btnSecondary"
                          type="button"
                          onClick={() => setRenameOpen((prev) => !prev)}
                          disabled={!activeThread || savingRename}
                        >
                          Rename
                        </button>
                        <button
                          className="btnSecondary"
                          type="button"
                          onClick={() => void toggleArchive()}
                          disabled={!activeThread || archiving}
                        >
                          {activeThread?.archived_at ? "Unarchive" : "Archive"}
                        </button>
                      </div>
                    </div>

                    {renameOpen && activeThread && (
                      <div className="chat-thread-rename">
                        <input
                          className="input"
                          value={renameValue}
                          onChange={(event) => setRenameValue(event.target.value)}
                          placeholder="Thread name"
                        />
                        <button
                          className="btn"
                          type="button"
                          onClick={() => void saveRename()}
                          disabled={savingRename || !renameValue.trim()}
                        >
                          {savingRename ? "Saving..." : "Save"}
                        </button>
                        <button
                          className="btnSecondary"
                          type="button"
                          onClick={() => setRenameOpen(false)}
                          disabled={savingRename}
                        >
                          Cancel
                        </button>
                      </div>
                    )}

                    <ChatThread
                      threadId={activeThreadId}
                      maxHeight="100%"
                      refreshToken={threadRefreshToken}
                      streamConnected={streamConnected}
                    />
                  </div>
                )}
              </section>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
