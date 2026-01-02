import crypto from "crypto";
import { getDb } from "./db.js";

export type ChatScope = "global" | "project" | "work_order";

export type ChatThreadRow = {
  id: string;
  scope: ChatScope;
  project_id: string | null;
  work_order_id: string | null;
  summary: string;
  summarized_count: number;
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
  run_id: string | null;
  created_at: string;
};

export type ChatRunStatus = "queued" | "running" | "done" | "failed";

export type ChatRunRow = {
  id: string;
  thread_id: string;
  user_message_id: string;
  assistant_message_id: string | null;
  status: ChatRunStatus;
  model: string;
  cli_path: string;
  cwd: string;
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
};

function nowIso(): string {
  return new Date().toISOString();
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
      `SELECT seq, id, thread_id, role, content, actions_json, run_id, created_at
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
  runId?: string;
}): ChatMessageRow {
  const db = getDb();
  const id = crypto.randomUUID();
  const createdAt = nowIso();
  const actions_json =
    params.actions === undefined ? null : JSON.stringify(params.actions);
  const run_id = params.runId ?? null;
  db.prepare(
    `INSERT INTO chat_messages (id, thread_id, role, content, actions_json, run_id, created_at)
     VALUES (@id, @thread_id, @role, @content, @actions_json, @run_id, @created_at)`
  ).run({
    id,
    thread_id: params.threadId,
    role: params.role,
    content: params.content,
    actions_json,
    run_id,
    created_at: createdAt,
  });
  const row = db
    .prepare(
      "SELECT seq, id, thread_id, role, content, actions_json, run_id, created_at FROM chat_messages WHERE id = ? LIMIT 1"
    )
    .get(id) as ChatMessageRow | undefined;
  if (!row) throw new Error("failed to load created chat message");
  return row;
}

export function getChatMessageById(messageId: string): ChatMessageRow | null {
  const db = getDb();
  const row = db
    .prepare(
      "SELECT seq, id, thread_id, role, content, actions_json, run_id, created_at FROM chat_messages WHERE id = ? LIMIT 1"
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
    log_path: params.logPath,
    created_at: createdAt,
    started_at: null,
    finished_at: null,
    error: null,
  };

  db.prepare(
    `INSERT INTO chat_runs
      (id, thread_id, user_message_id, assistant_message_id, status, model, cli_path, cwd, log_path, created_at, started_at, finished_at, error)
     VALUES
      (@id, @thread_id, @user_message_id, @assistant_message_id, @status, @model, @cli_path, @cwd, @log_path, @created_at, @started_at, @finished_at, @error)`
  ).run(run);

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
  const result = db
    .prepare(`UPDATE chat_runs SET ${sets.join(", ")} WHERE id = @id`)
    .run({ id: runId, ...patch });
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

export function createChatActionLedgerEntry(params: {
  threadId: string;
  runId: string;
  messageId: string;
  actionIndex: number;
  actionType: string;
  actionPayload: unknown;
  undoPayload: unknown | null;
  error: string | null;
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
  };
  db.prepare(
    `INSERT INTO chat_action_ledger
      (id, thread_id, run_id, message_id, action_index, action_type, action_payload_json, applied_at, undo_payload_json, undone_at, error)
     VALUES
      (@id, @thread_id, @run_id, @message_id, @action_index, @action_type, @action_payload_json, @applied_at, @undo_payload_json, @undone_at, @error)`
  ).run(row);
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
  const result = db
    .prepare(
      "UPDATE chat_action_ledger SET undone_at = ?, error = COALESCE(?, error) WHERE id = ? AND undone_at IS NULL"
    )
    .run(now, params.error, params.ledgerId);
  return result.changes > 0;
}
