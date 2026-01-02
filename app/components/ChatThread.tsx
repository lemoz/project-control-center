"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

type ChatScopeParams =
  | { scope: "global" }
  | { scope: "project"; projectId: string }
  | { scope: "work_order"; projectId: string; workOrderId: string };

type ChatAction = {
  type:
    | "project_set_star"
    | "project_set_hidden"
    | "work_order_create"
    | "work_order_update"
    | "work_order_set_status"
    | "repos_rescan"
    | "work_order_start_run";
  title: string;
  payload: Record<string, unknown>;
};

type ChatThread = {
  id: string;
  scope: "global" | "project" | "work_order";
  project_id: string | null;
  work_order_id: string | null;
  summary: string;
  summarized_count: number;
  created_at: string;
  updated_at: string;
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
  log_path: string;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  error: string | null;
};

type ChatMessage = {
  seq: number;
  id: string;
  thread_id: string;
  role: "user" | "assistant" | "system";
  content: string;
  actions_json: string | null;
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

function threadApiUrl(params: ChatScopeParams): string {
  if (params.scope === "global") return "/api/chat/global";
  if (params.scope === "project") {
    return `/api/chat/projects/${encodeURIComponent(params.projectId)}`;
  }
  return `/api/chat/projects/${encodeURIComponent(params.projectId)}/work-orders/${encodeURIComponent(params.workOrderId)}`;
}

function formatTime(value: string | null): string {
  if (!value) return "";
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return value;
  return new Date(ms).toLocaleString();
}

function formatDuration(ms: number | null): string {
  if (ms === null) return "";
  if (ms < 1000) return `${ms}ms`;
  const s = Math.round(ms / 100) / 10;
  return `${s}s`;
}

export function ChatThread({ scope }: { scope: ChatScopeParams }) {
  const [data, setData] = useState<ThreadResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [applying, setApplying] = useState<Record<string, boolean>>({});
  const [undoing, setUndoing] = useState<Record<string, boolean>>({});
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [runDetails, setRunDetails] = useState<RunDetails | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const stickToBottomRef = useRef(true);
  const hasLoadedRef = useRef(false);
  const messageCountRef = useRef(0);

  const ledgerByKey = useMemo(() => {
    const map = new Map<string, ChatActionLedger>();
    for (const a of data?.action_ledger || []) {
      map.set(`${a.message_id}:${a.action_index}`, a);
    }
    return map;
  }, [data?.action_ledger]);

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
    stickToBottomRef.current = distanceFromBottom < 80;
  }, []);

  const load = useCallback(async () => {
    const isInitial = !hasLoadedRef.current;
    if (isInitial) setLoading(true);
    else setRefreshing(true);
    setError(null);
    try {
      const res = await fetch(threadApiUrl(scope), { cache: "no-store" });
      const json = (await res.json().catch(() => null)) as ThreadResponse | null;
      if (!res.ok) throw new Error(json?.error || "failed to load chat");
      setData(json);
      hasLoadedRef.current = true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed to load chat");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [scope]);

  useLayoutEffect(() => {
    const count = data?.messages?.length ?? 0;
    const prev = messageCountRef.current;
    messageCountRef.current = count;
    if (!count) return;
    if (!stickToBottomRef.current && prev) return;
    scrollToBottom("auto");
  }, [data?.messages?.length, scrollToBottom]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!hasActiveRuns) return;
    const t = setInterval(() => void load(), 2000);
    return () => clearInterval(t);
  }, [hasActiveRuns, load]);

  const send = useCallback(async () => {
    const content = input.trim();
    if (!content) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch(threadApiUrl(scope), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      const json = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) throw new Error(json?.error || "failed to send");
      setInput("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed to send");
    } finally {
      setSending(false);
    }
  }, [input, load, scope]);

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
  }, []);

  useEffect(() => {
    if (!selectedRunId) {
      setRunDetails(null);
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
    <section className="card" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
        <div>
          <div style={{ fontWeight: 700 }}>Chat</div>
          {!!data?.thread?.summary && (
            <div className="muted" style={{ fontSize: 12 }}>
              Summary included (through {data.thread.summarized_count} messages).
            </div>
          )}
        </div>
        <button className="btnSecondary" onClick={() => void load()} disabled={loading || refreshing || sending}>
          Refresh
        </button>
      </div>

      {!!error && <div className="error">{error}</div>}
      {loading && <div className="muted">Loading…</div>}

      {!loading && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div
            ref={scrollRef}
            onScroll={onMessagesScroll}
            style={{ display: "flex", flexDirection: "column", gap: 10, maxHeight: 520, overflow: "auto", paddingRight: 4 }}
          >
            {(data?.messages || []).map((m) => (
              <div
                key={m.id}
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
                  <div style={{ fontWeight: 700, textTransform: "capitalize" }}>{m.role}</div>
                  <div className="muted" style={{ fontSize: 12 }}>
                    {formatTime(m.created_at)}
                  </div>
                </div>

                <div style={{ whiteSpace: "pre-wrap", marginTop: 6, lineHeight: 1.4 }}>
                  {m.content}
                </div>

                {!!m.run && (
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 10 }}>
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
                )}

                {!!m.actions?.length && (
                  <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
                    <div className="muted" style={{ fontSize: 12 }}>Proposed actions</div>
                    {m.actions.map((a, idx) => {
                      const key = `${m.id}:${idx}`;
                      const ledger = ledgerByKey.get(key) || null;
                      const applied = ledger && !ledger.undone_at;
                      const undoable = applied && !!ledger?.undo_payload_json;
                      return (
                        <div key={key} style={{ display: "flex", flexDirection: "column", gap: 6, border: "1px solid rgba(124,138,176,0.2)", borderRadius: 10, padding: 10 }}>
                          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
                            <div style={{ fontWeight: 700 }}>{a.title}</div>
                            <div className="muted" style={{ fontSize: 12 }}>{a.type}</div>
                          </div>
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
            ))}
            <div ref={bottomRef} />
          </div>

          <div style={{ display: "flex", gap: 8 }}>
            <input
              className="input"
              value={input}
              placeholder="Message…"
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  void send();
                }
              }}
              disabled={sending}
            />
            <button className="btn" onClick={() => void send()} disabled={sending || !input.trim()}>
              {sending ? "Sending…" : "Send"}
            </button>
          </div>
          <div className="muted" style={{ fontSize: 12 }}>
            Tip: <code>Ctrl</code>/<code>Cmd</code>+<code>Enter</code> sends.
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
                            <pre style={{ margin: 0, whiteSpace: "pre-wrap" }}>{c.command}</pre>
                          </div>
                        ))}
                      </div>
                    )}
                  </details>

                  <details open>
                    <summary className="muted" style={{ cursor: "pointer" }}>Raw Codex log (tail)</summary>
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
