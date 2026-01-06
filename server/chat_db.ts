import crypto from "crypto";
import { getDb, type RunRow } from "./db.js";
import { type ChatAccess, type ChatContextDepth, type ChatSuggestion } from "./chat_contract.js";
import {
  emitChatActionAppliedEvent,
  emitChatActionUndoneEvent,
  emitChatAttentionIfChanged,
  emitChatMessageEvent,
  emitChatRunStatusEvent,
  emitChatThreadUpdatedEvent,
} from "./chat_events.js";

export type ChatScope = "global" | "project" | "work_order";

export type ChatThreadRow = {
  id: string;
  name: string;
  scope: ChatScope;
  project_id: string | null;
  work_order_id: string | null;
  summary: string;
  summarized_count: number;
  default_context_depth: ChatContextDepth;
  default_access_filesystem: ChatAccess["filesystem"];
  default_access_cli: ChatAccess["cli"];
  default_access_network: ChatAccess["network"];
  default_access_network_allowlist: string | null;
  last_read_at: string | null;
  last_ack_at: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
};

export type ChatMessageRole = "user" | "assistant" | "system";

export type ChatMessageRow = {
  seq: number;
  id: string;
  thread_id: string;
  role: ChatMessageRole;
  content: string;
  actions_json: string | null;
  needs_user_input: number;
  run_id: string | null;
  created_at: string;
};

export type ChatRunStatus = "queued" | "running" | "done" | "failed";

export type ChatThreadSummaryRow = ChatThreadRow & {
  last_message_at: string | null;
  last_run_status: ChatRunStatus | null;
  last_run_at: string | null;
};

export type ChatThreadActivity = {
  last_message_at: string | null;
  last_run_at: string | null;
  last_activity_at: string | null;
};

export type ChatRunRow = {
  id: string;
  thread_id: string;
  user_message_id: string;
  assistant_message_id: string | null;
  status: ChatRunStatus;
  model: string;
  cli_path: string;
  cwd: string;
  context_depth: ChatContextDepth;
  access_filesystem: ChatAccess["filesystem"];
  access_cli: ChatAccess["cli"];
  access_network: ChatAccess["network"];
  access_network_allowlist: string | null;
  suggestion_json: string | null;
  suggestion_accepted: number;
  log_path: string;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  error: string | null;
};

export type ChatRunCommandRow = {
  id: string;
  run_id: string;
  seq: number;
  cwd: string;
  command: string;
  created_at: string;
};

export type ChatActionLedgerRow = {
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
  error_at: string | null;
  work_order_run_id: string | null; // Links to runs.id when action creates a work order run
};

export type ChatPendingSendRow = {
  id: string;
  thread_id: string;
  content: string;
  context_depth: ChatContextDepth;
  access_filesystem: ChatAccess["filesystem"];
  access_cli: ChatAccess["cli"];
  access_network: ChatAccess["network"];
  access_network_allowlist: string | null;
  suggestion_json: string | null;
  created_at: string;
  resolved_at: string | null;
  canceled_at: string | null;
};

function nowIso(): string {
  return new Date().toISOString();
}

export function touchChatThread(threadId: string): void {
  const db = getDb();
  const now = nowIso();
  db.prepare("UPDATE chat_threads SET updated_at = ? WHERE id = ?").run(
    now,
    threadId
  );
}

export function threadIdForScope(params: {
  scope: ChatScope;
  projectId?: string;
  workOrderId?: string;
}): string {
  if (params.scope === "global") return "global";
  if (params.scope === "project") {
    if (!params.projectId) throw new Error("projectId required");
    return `project:${params.projectId}`;
  }
  if (!params.projectId || !params.workOrderId) {
    throw new Error("projectId + workOrderId required");
  }
  return `work_order:${params.projectId}:${params.workOrderId}`;
}

export function getChatThreadById(threadId: string): ChatThreadRow | null {
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM chat_threads WHERE id = ? LIMIT 1")
    .get(threadId) as ChatThreadRow | undefined;
  return row || null;
}

export function listChatThreads(params?: {
  limit?: number;
  includeArchived?: boolean;
}): ChatThreadSummaryRow[] {
  const db = getDb();
  const includeArchived = params?.includeArchived === true;
  const limit = Math.max(1, Math.min(500, Math.trunc(params?.limit ?? 200)));
  const where = includeArchived ? "" : "WHERE archived_at IS NULL";
  return db
    .prepare(
      `SELECT t.*,
        (SELECT created_at FROM chat_messages m WHERE m.thread_id = t.id ORDER BY seq DESC LIMIT 1) AS last_message_at,
        (SELECT status FROM chat_runs r WHERE r.thread_id = t.id ORDER BY created_at DESC LIMIT 1) AS last_run_status,
        (SELECT created_at FROM chat_runs r WHERE r.thread_id = t.id ORDER BY created_at DESC LIMIT 1) AS last_run_at
       FROM chat_threads t
       ${where}
       ORDER BY updated_at DESC
       LIMIT ?`
    )
    .all(limit) as ChatThreadSummaryRow[];
}

export function getChatThreadActivity(threadId: string): ChatThreadActivity {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT
        (SELECT created_at FROM chat_messages m WHERE m.thread_id = ? ORDER BY seq DESC LIMIT 1) AS last_message_at,
        (SELECT created_at FROM chat_runs r WHERE r.thread_id = ? ORDER BY created_at DESC LIMIT 1) AS last_run_at`
    )
    .get(threadId, threadId) as
    | { last_message_at: string | null; last_run_at: string | null }
    | undefined;

  const last_message_at = row?.last_message_at ?? null;
  const last_run_at = row?.last_run_at ?? null;
  const last_activity_at = (() => {
    if (last_message_at && last_run_at) {
      return last_message_at > last_run_at ? last_message_at : last_run_at;
    }
    return last_message_at ?? last_run_at ?? null;
  })();

  return { last_message_at, last_run_at, last_activity_at };
}

export function markChatThreadRead(threadId: string): ChatThreadRow | null {
  const thread = getChatThreadById(threadId);
  if (!thread) return null;
  const activity = getChatThreadActivity(threadId);
  const lastActivityAt = activity.last_activity_at;
  if (!lastActivityAt) return thread;
  if (thread.last_read_at && thread.last_read_at >= lastActivityAt) return thread;
  return updateChatThread({ threadId, lastReadAt: nowIso() }) ?? thread;
}

export function createChatThread(params: {
  scope: ChatScope;
  projectId?: string;
  workOrderId?: string;
  name?: string;
  defaultContextDepth?: ChatContextDepth;
  defaultAccess?: ChatAccess;
}): ChatThreadRow {
  const db = getDb();
  const id = crypto.randomUUID();
  const now = nowIso();
  const project_id = params.projectId ?? null;
  const work_order_id = params.workOrderId ?? null;
  const name = (params.name ?? "").trim();
  const defaultContextDepth = params.defaultContextDepth ?? "messages";
  const access = params.defaultAccess ?? {
    filesystem: "read-only",
    cli: "off",
    network: "none",
    network_allowlist: [],
  };
  const allowlistJson =
    access.network_allowlist && access.network_allowlist.length
      ? JSON.stringify(access.network_allowlist)
      : null;

  db.prepare(
    `INSERT INTO chat_threads (
      id,
      name,
      scope,
      project_id,
      work_order_id,
      summary,
      summarized_count,
      default_context_depth,
      default_access_filesystem,
      default_access_cli,
      default_access_network,
      default_access_network_allowlist,
      last_read_at,
      last_ack_at,
      archived_at,
      created_at,
      updated_at
    ) VALUES (
      @id,
      @name,
      @scope,
      @project_id,
      @work_order_id,
      '',
      0,
      @default_context_depth,
      @default_access_filesystem,
      @default_access_cli,
      @default_access_network,
      @default_access_network_allowlist,
      NULL,
      NULL,
      NULL,
      @created_at,
      @updated_at
    )`
  ).run({
    id,
    name,
    scope: params.scope,
    project_id,
    work_order_id,
    default_context_depth: defaultContextDepth,
    default_access_filesystem: access.filesystem,
    default_access_cli: access.cli,
    default_access_network: access.network,
    default_access_network_allowlist: allowlistJson,
    created_at: now,
    updated_at: now,
  });

  const row = getChatThreadById(id);
  if (!row) throw new Error("failed to load created chat thread");
  emitChatThreadUpdatedEvent(row);
  return row;
}

export function ensureChatThread(params: {
  scope: ChatScope;
  projectId?: string;
  workOrderId?: string;
}): ChatThreadRow {
  const db = getDb();
  const threadId = threadIdForScope(params);
  const now = nowIso();
  const scope = params.scope;
  const project_id = params.projectId ?? null;
  const work_order_id = params.workOrderId ?? null;

  db.prepare(
    `INSERT INTO chat_threads (id, scope, project_id, work_order_id, summary, summarized_count, created_at, updated_at)
     VALUES (@id, @scope, @project_id, @work_order_id, '', 0, @created_at, @updated_at)
     ON CONFLICT(id) DO NOTHING`
  ).run({
    id: threadId,
    scope,
    project_id,
    work_order_id,
    created_at: now,
    updated_at: now,
  });

  const loaded = getChatThreadById(threadId);
  if (!loaded) throw new Error("failed to load chat thread");
  return loaded;
}

export function updateChatThreadSummary(params: {
  threadId: string;
  summary: string;
  summarizedCount: number;
}): boolean {
  const db = getDb();
  const now = nowIso();
  const result = db
    .prepare(
      "UPDATE chat_threads SET summary = ?, summarized_count = ?, updated_at = ? WHERE id = ?"
    )
    .run(params.summary, params.summarizedCount, now, params.threadId);
  return result.changes > 0;
}

export function updateChatThread(params: {
  threadId: string;
  name?: string;
  scope?: ChatScope;
  projectId?: string | null;
  workOrderId?: string | null;
  defaultContextDepth?: ChatContextDepth;
  defaultAccess?: ChatAccess;
  lastReadAt?: string | null;
  lastAckAt?: string | null;
  archivedAt?: string | null;
}): ChatThreadRow | null {
  const db = getDb();
  const existing = getChatThreadById(params.threadId);
  if (!existing) return null;
  const now = nowIso();

  const name = params.name === undefined ? existing.name : params.name.trim();
  const scope = params.scope ?? existing.scope;
  const project_id =
    params.projectId === undefined ? existing.project_id : params.projectId;
  const work_order_id =
    params.workOrderId === undefined
      ? existing.work_order_id
      : params.workOrderId;

  const default_context_depth =
    params.defaultContextDepth ?? existing.default_context_depth;

  const access = params.defaultAccess ?? null;
  const default_access_filesystem = access?.filesystem ?? existing.default_access_filesystem;
  const default_access_cli = access?.cli ?? existing.default_access_cli;
  const default_access_network = access?.network ?? existing.default_access_network;
  const default_access_network_allowlist = (() => {
    if (!access) return existing.default_access_network_allowlist;
    const list = access.network_allowlist ?? [];
    return list.length ? JSON.stringify(list) : null;
  })();

  const last_read_at =
    params.lastReadAt === undefined ? existing.last_read_at : params.lastReadAt;
  const last_ack_at =
    params.lastAckAt === undefined ? existing.last_ack_at : params.lastAckAt;
  const archived_at =
    params.archivedAt === undefined ? existing.archived_at : params.archivedAt;

  const threadUpdated =
    name !== existing.name ||
    scope !== existing.scope ||
    project_id !== existing.project_id ||
    work_order_id !== existing.work_order_id ||
    default_context_depth !== existing.default_context_depth ||
    default_access_filesystem !== existing.default_access_filesystem ||
    default_access_cli !== existing.default_access_cli ||
    default_access_network !== existing.default_access_network ||
    default_access_network_allowlist !== existing.default_access_network_allowlist ||
    archived_at !== existing.archived_at;
  const ackChanged = last_ack_at !== existing.last_ack_at;

  db.prepare(
    `UPDATE chat_threads
     SET name = ?,
         scope = ?,
         project_id = ?,
         work_order_id = ?,
         default_context_depth = ?,
         default_access_filesystem = ?,
         default_access_cli = ?,
         default_access_network = ?,
         default_access_network_allowlist = ?,
         last_read_at = ?,
         last_ack_at = ?,
         archived_at = ?,
         updated_at = ?
     WHERE id = ?`
  ).run(
    name,
    scope,
    project_id,
    work_order_id,
    default_context_depth,
    default_access_filesystem,
    default_access_cli,
    default_access_network,
    default_access_network_allowlist,
    last_read_at,
    last_ack_at,
    archived_at,
    now,
    params.threadId
  );

  const updated = getChatThreadById(params.threadId);
  if (!updated) return null;
  if (threadUpdated) emitChatThreadUpdatedEvent(updated);
  if (ackChanged) emitChatAttentionIfChanged(updated.id);
  return updated;
}

export function countChatMessages(threadId: string): number {
  const db = getDb();
  const row = db
    .prepare("SELECT COUNT(*) as n FROM chat_messages WHERE thread_id = ?")
    .get(threadId) as { n: number } | undefined;
  return row?.n ?? 0;
}

export function listChatMessages(params: {
  threadId: string;
  limit: number;
  order: "asc" | "desc";
  offset?: number;
}): ChatMessageRow[] {
  const db = getDb();
  const offset = params.offset ?? 0;
  const limit = Math.max(0, Math.min(500, Math.trunc(params.limit)));
  const order = params.order === "asc" ? "ASC" : "DESC";
  return db
    .prepare(
      `SELECT seq, id, thread_id, role, content, actions_json, needs_user_input, run_id, created_at
       FROM chat_messages
       WHERE thread_id = ?
       ORDER BY seq ${order}
       LIMIT ?
       OFFSET ?`
    )
    .all(params.threadId, limit, offset) as ChatMessageRow[];
}

export function createChatMessage(params: {
  threadId: string;
  role: ChatMessageRole;
  content: string;
  actions?: unknown;
  needsUserInput?: boolean;
  runId?: string;
}): ChatMessageRow {
  const db = getDb();
  const id = crypto.randomUUID();
  const createdAt = nowIso();
  const actions_json =
    params.actions === undefined ? null : JSON.stringify(params.actions);
  const run_id = params.runId ?? null;
  const needs_user_input = params.needsUserInput ? 1 : 0;
  db.prepare(
    `INSERT INTO chat_messages (id, thread_id, role, content, actions_json, needs_user_input, run_id, created_at)
     VALUES (@id, @thread_id, @role, @content, @actions_json, @needs_user_input, @run_id, @created_at)`
  ).run({
    id,
    thread_id: params.threadId,
    role: params.role,
    content: params.content,
    actions_json,
    needs_user_input,
    run_id,
    created_at: createdAt,
  });
  touchChatThread(params.threadId);
  const row = db
    .prepare(
      "SELECT seq, id, thread_id, role, content, actions_json, needs_user_input, run_id, created_at FROM chat_messages WHERE id = ? LIMIT 1"
    )
    .get(id) as ChatMessageRow | undefined;
  if (!row) throw new Error("failed to load created chat message");
  emitChatMessageEvent(row);
  return row;
}

export function getChatMessageById(messageId: string): ChatMessageRow | null {
  const db = getDb();
  const row = db
    .prepare(
      "SELECT seq, id, thread_id, role, content, actions_json, needs_user_input, run_id, created_at FROM chat_messages WHERE id = ? LIMIT 1"
    )
    .get(messageId) as ChatMessageRow | undefined;
  return row || null;
}

export function createChatRun(params: {
  id: string;
  threadId: string;
  userMessageId: string;
  model: string;
  cliPath: string;
  cwd: string;
  logPath: string;
  contextDepth: ChatContextDepth;
  access: ChatAccess;
  suggestion?: ChatSuggestion | null;
}): ChatRunRow {
  const db = getDb();
  const id = params.id;
  const createdAt = nowIso();
  const run: ChatRunRow = {
    id,
    thread_id: params.threadId,
    user_message_id: params.userMessageId,
    assistant_message_id: null,
    status: "queued",
    model: params.model,
    cli_path: params.cliPath,
    cwd: params.cwd,
    context_depth: params.contextDepth,
    access_filesystem: params.access.filesystem,
    access_cli: params.access.cli,
    access_network: params.access.network,
    access_network_allowlist: params.access.network_allowlist
      ? JSON.stringify(params.access.network_allowlist)
      : null,
    suggestion_json: params.suggestion ? JSON.stringify(params.suggestion) : null,
    suggestion_accepted: params.suggestion ? 1 : 0,
    log_path: params.logPath,
    created_at: createdAt,
    started_at: null,
    finished_at: null,
    error: null,
  };

  db.prepare(
    `INSERT INTO chat_runs
      (id, thread_id, user_message_id, assistant_message_id, status, model, cli_path, cwd, context_depth, access_filesystem, access_cli, access_network, access_network_allowlist, suggestion_json, suggestion_accepted, log_path, created_at, started_at, finished_at, error)
     VALUES
      (@id, @thread_id, @user_message_id, @assistant_message_id, @status, @model, @cli_path, @cwd, @context_depth, @access_filesystem, @access_cli, @access_network, @access_network_allowlist, @suggestion_json, @suggestion_accepted, @log_path, @created_at, @started_at, @finished_at, @error)`
  ).run(run);

  emitChatRunStatusEvent(run);
  return run;
}

export function getChatRunById(runId: string): ChatRunRow | null {
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM chat_runs WHERE id = ? LIMIT 1")
    .get(runId) as ChatRunRow | undefined;
  return row || null;
}

export function listChatRunsForThread(threadId: string, limit = 200): ChatRunRow[] {
  const db = getDb();
  const safeLimit = Math.max(1, Math.min(500, Math.trunc(limit)));
  return db
    .prepare(
      "SELECT * FROM chat_runs WHERE thread_id = ? ORDER BY created_at DESC LIMIT ?"
    )
    .all(threadId, safeLimit) as ChatRunRow[];
}

export function updateChatRun(
  runId: string,
  patch: Partial<
    Pick<
      ChatRunRow,
      "assistant_message_id" | "status" | "started_at" | "finished_at" | "error"
    >
  >
): boolean {
  const db = getDb();
  const fields: Array<{ key: keyof typeof patch; column: string }> = [
    { key: "assistant_message_id", column: "assistant_message_id" },
    { key: "status", column: "status" },
    { key: "started_at", column: "started_at" },
    { key: "finished_at", column: "finished_at" },
    { key: "error", column: "error" },
  ];
  const sets = fields
    .filter((f) => patch[f.key] !== undefined)
    .map((f) => `${f.column} = @${String(f.key)}`);
  if (!sets.length) return false;
  const existing = getChatRunById(runId);
  if (!existing) return false;
  const statusChanged = patch.status !== undefined && patch.status !== existing.status;
  const result = db
    .prepare(`UPDATE chat_runs SET ${sets.join(", ")} WHERE id = @id`)
    .run({ id: runId, ...patch });
  if (result.changes > 0 && statusChanged) {
    const next = { ...existing, ...patch } as ChatRunRow;
    emitChatRunStatusEvent(next);
  }
  return result.changes > 0;
}

export function listChatRunCommands(runId: string): ChatRunCommandRow[] {
  const db = getDb();
  return db
    .prepare(
      "SELECT * FROM chat_run_commands WHERE run_id = ? ORDER BY seq ASC"
    )
    .all(runId) as ChatRunCommandRow[];
}

export function deleteChatRunCommands(runId: string): number {
  const db = getDb();
  const result = db
    .prepare("DELETE FROM chat_run_commands WHERE run_id = ?")
    .run(runId);
  return result.changes;
}

export function replaceChatRunCommands(params: {
  runId: string;
  commands: Array<{ cwd: string; command: string }>;
}): number {
  const db = getDb();
  const deleteStmt = db.prepare("DELETE FROM chat_run_commands WHERE run_id = ?");
  const insertStmt = db.prepare(
    `INSERT INTO chat_run_commands (id, run_id, seq, cwd, command, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  );

  const tx = db.transaction((commands: Array<{ cwd: string; command: string }>) => {
    deleteStmt.run(params.runId);
    let seq = 0;
    for (const cmd of commands) {
      seq += 1;
      insertStmt.run(
        crypto.randomUUID(),
        params.runId,
        seq,
        cmd.cwd,
        cmd.command,
        nowIso()
      );
    }
  });

  tx(params.commands);
  return params.commands.length;
}

export function insertChatRunCommand(params: {
  runId: string;
  seq: number;
  cwd: string;
  command: string;
}): ChatRunCommandRow {
  const db = getDb();
  const id = crypto.randomUUID();
  const createdAt = nowIso();
  const row: ChatRunCommandRow = {
    id,
    run_id: params.runId,
    seq: params.seq,
    cwd: params.cwd,
    command: params.command,
    created_at: createdAt,
  };
  db.prepare(
    `INSERT INTO chat_run_commands (id, run_id, seq, cwd, command, created_at)
     VALUES (@id, @run_id, @seq, @cwd, @command, @created_at)`
  ).run(row);
  return row;
}

export function createChatPendingSend(params: {
  threadId: string;
  content: string;
  contextDepth: ChatContextDepth;
  access: ChatAccess;
  suggestion?: ChatSuggestion | null;
}): ChatPendingSendRow {
  const db = getDb();
  const id = crypto.randomUUID();
  const createdAt = nowIso();
  const allowlistJson =
    params.access.network_allowlist && params.access.network_allowlist.length
      ? JSON.stringify(params.access.network_allowlist)
      : null;
  const suggestionJson = params.suggestion ? JSON.stringify(params.suggestion) : null;

  const row: ChatPendingSendRow = {
    id,
    thread_id: params.threadId,
    content: params.content,
    context_depth: params.contextDepth,
    access_filesystem: params.access.filesystem,
    access_cli: params.access.cli,
    access_network: params.access.network,
    access_network_allowlist: allowlistJson,
    suggestion_json: suggestionJson,
    created_at: createdAt,
    resolved_at: null,
    canceled_at: null,
  };

  db.prepare(
    `INSERT INTO chat_pending_sends
      (id, thread_id, content, context_depth, access_filesystem, access_cli, access_network, access_network_allowlist, suggestion_json, created_at, resolved_at, canceled_at)
     VALUES
      (@id, @thread_id, @content, @context_depth, @access_filesystem, @access_cli, @access_network, @access_network_allowlist, @suggestion_json, @created_at, @resolved_at, @canceled_at)`
  ).run(row);
  touchChatThread(params.threadId);
  emitChatAttentionIfChanged(params.threadId);

  return row;
}

export function getChatPendingSendById(pendingSendId: string): ChatPendingSendRow | null {
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM chat_pending_sends WHERE id = ? LIMIT 1")
    .get(pendingSendId) as ChatPendingSendRow | undefined;
  return row ?? null;
}

export function listChatPendingSends(params?: {
  threadId?: string;
  includeResolved?: boolean;
  limit?: number | null;
}): ChatPendingSendRow[] {
  const db = getDb();
  const includeResolved = params?.includeResolved === true;
  const limitRaw = params?.limit;
  const limit =
    limitRaw === null
      ? null
      : Math.max(1, Math.min(500, Math.trunc(limitRaw ?? 200)));
  const where: string[] = [];
  const values: unknown[] = [];
  if (params?.threadId) {
    where.push("thread_id = ?");
    values.push(params.threadId);
  }
  if (!includeResolved) {
    where.push("resolved_at IS NULL AND canceled_at IS NULL");
  }
  const whereClause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const limitClause = limit === null ? "" : "LIMIT ?";
  const rows = db
    .prepare(
      `SELECT * FROM chat_pending_sends ${whereClause} ORDER BY created_at DESC ${limitClause}`
    )
    .all(...values, ...(limit === null ? [] : [limit])) as ChatPendingSendRow[];
  return rows;
}

export function markChatPendingSendResolved(pendingSendId: string): boolean {
  const db = getDb();
  const now = nowIso();
  const pending = getChatPendingSendById(pendingSendId);
  const result = db
    .prepare(
      "UPDATE chat_pending_sends SET resolved_at = ? WHERE id = ? AND resolved_at IS NULL AND canceled_at IS NULL"
    )
    .run(now, pendingSendId);
  if (result.changes > 0 && pending) {
    emitChatAttentionIfChanged(pending.thread_id);
  }
  return result.changes > 0;
}

export function markChatPendingSendCanceled(pendingSendId: string): boolean {
  const db = getDb();
  const now = nowIso();
  const pending = getChatPendingSendById(pendingSendId);
  const result = db
    .prepare(
      "UPDATE chat_pending_sends SET canceled_at = ? WHERE id = ? AND resolved_at IS NULL AND canceled_at IS NULL"
    )
    .run(now, pendingSendId);
  if (result.changes > 0 && pending) {
    emitChatAttentionIfChanged(pending.thread_id);
  }
  return result.changes > 0;
}

export function createChatActionLedgerEntry(params: {
  threadId: string;
  runId: string;
  messageId: string;
  actionIndex: number;
  actionType: string;
  actionPayload: unknown;
  undoPayload: unknown | null;
  error: string | null;
  workOrderRunId?: string | null; // Links to runs.id when action creates a work order run
}): ChatActionLedgerRow {
  const db = getDb();
  const id = crypto.randomUUID();
  const appliedAt = nowIso();
  const row: ChatActionLedgerRow = {
    id,
    thread_id: params.threadId,
    run_id: params.runId,
    message_id: params.messageId,
    action_index: params.actionIndex,
    action_type: params.actionType,
    action_payload_json: JSON.stringify(params.actionPayload ?? null),
    applied_at: appliedAt,
    undo_payload_json:
      params.undoPayload === null ? null : JSON.stringify(params.undoPayload),
    undone_at: null,
    error: params.error,
    error_at: params.error ? appliedAt : null,
    work_order_run_id: params.workOrderRunId ?? null,
  };
  db.prepare(
    `INSERT INTO chat_action_ledger
      (id, thread_id, run_id, message_id, action_index, action_type, action_payload_json, applied_at, undo_payload_json, undone_at, error, error_at, work_order_run_id)
     VALUES
      (@id, @thread_id, @run_id, @message_id, @action_index, @action_type, @action_payload_json, @applied_at, @undo_payload_json, @undone_at, @error, @error_at, @work_order_run_id)`
  ).run(row);
  emitChatActionAppliedEvent(row);
  return row;
}

export function listChatActionLedger(params: {
  threadId: string;
  limit?: number;
}): ChatActionLedgerRow[] {
  const db = getDb();
  const limit = Math.max(1, Math.min(500, Math.trunc(params.limit ?? 200)));
  return db
    .prepare(
      "SELECT * FROM chat_action_ledger WHERE thread_id = ? ORDER BY applied_at DESC LIMIT ?"
    )
    .all(params.threadId, limit) as ChatActionLedgerRow[];
}

export function getChatActionLedgerEntry(id: string): ChatActionLedgerRow | null {
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM chat_action_ledger WHERE id = ? LIMIT 1")
    .get(id) as ChatActionLedgerRow | undefined;
  return row || null;
}

export function markChatActionUndone(params: {
  ledgerId: string;
  error: string | null;
}): boolean {
  const db = getDb();
  const now = nowIso();
  if (params.error) {
    const result = db
      .prepare(
        "UPDATE chat_action_ledger SET error = ?, error_at = COALESCE(error_at, ?) WHERE id = ? AND undone_at IS NULL"
      )
      .run(params.error, now, params.ledgerId);
    if (result.changes > 0) {
      const updated = getChatActionLedgerEntry(params.ledgerId);
      if (updated) emitChatActionUndoneEvent(updated);
    }
    return result.changes > 0;
  }

  const result = db
    .prepare("UPDATE chat_action_ledger SET undone_at = ? WHERE id = ? AND undone_at IS NULL")
    .run(now, params.ledgerId);
  if (result.changes > 0) {
    const updated = getChatActionLedgerEntry(params.ledgerId);
    if (updated) emitChatActionUndoneEvent(updated);
  }
  return result.changes > 0;
}

/**
 * List work order runs that were triggered from a chat thread via chat actions.
 * This joins chat_action_ledger with runs table to find builder/reviewer runs
 * that were started from this chat conversation.
 */
export function listWorkOrderRunsForThread(threadId: string, limit = 10): RunRow[] {
  const db = getDb();
  return db
    .prepare(
      `SELECT r.* FROM runs r
       JOIN chat_action_ledger cal ON cal.work_order_run_id = r.id
       WHERE cal.thread_id = ?
       ORDER BY r.created_at DESC
       LIMIT ?`
    )
    .all(threadId, limit) as RunRow[];
}
