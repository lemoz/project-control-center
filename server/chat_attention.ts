import { getDb } from "./db.js";
import { ChatActionSchema } from "./chat_contract.js";
import { type ChatScope } from "./chat_db.js";

export type AttentionReasonCode =
  | "pending_action"
  | "pending_approval"
  | "needs_user_input"
  | "run_failed"
  | "undo_failed";

export type ChatAttentionReason = {
  code: AttentionReasonCode;
  created_at: string;
  count: number;
  action_titles?: string[];
};

export type ChatAttentionSummary = {
  needs_you: boolean;
  reason_codes: AttentionReasonCode[];
  reasons: ChatAttentionReason[];
  last_event_at: string | null;
};

export type ChatAttentionItem = {
  thread_id: string;
  scope: ChatScope;
  project_id: string | null;
  work_order_id: string | null;
  project_name: string | null;
  work_order_title: string | null;
  attention: ChatAttentionSummary;
};

export type ChatAttentionResponse = {
  items: ChatAttentionItem[];
  limited: boolean;
  scan_limit: number | null;
};

type ChatMessageActionRow = {
  id: string;
  thread_id: string;
  actions_json: string;
  created_at: string;
};

type ChatMessageNeedsInputRow = {
  thread_id: string;
  created_at: string;
};

type ChatPendingSendRow = {
  thread_id: string;
  created_at: string;
};

type ChatRunFailureRow = {
  thread_id: string;
  failed_at: string;
};

type ChatActionErrorRow = {
  thread_id: string;
  error_at: string;
};

type ChatThreadMetaRow = {
  id: string;
  scope: ChatScope;
  project_id: string | null;
  work_order_id: string | null;
  last_ack_at: string | null;
};

type ActionWithIndex = {
  index: number;
  title: string;
};

const reasonOrder: AttentionReasonCode[] = [
  "pending_approval",
  "pending_action",
  "needs_user_input",
  "run_failed",
  "undo_failed",
];
const SQLITE_MAX_VARS = 900;

function buildInClause(ids: string[]): string {
  return ids.map(() => "?").join(", ");
}

function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}
function parseActionTitles(raw: string): ActionWithIndex[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const items: ActionWithIndex[] = [];
  parsed.forEach((item, index) => {
    const parsedAction = ChatActionSchema.safeParse(item);
    if (parsedAction.success) {
      items.push({ index, title: parsedAction.data.title });
      return;
    }
    const fallbackTitle =
      typeof (item as { title?: unknown })?.title === "string"
        ? String((item as { title?: unknown }).title || "").trim()
        : "";
    items.push({
      index,
      title: fallbackTitle || `Action ${index + 1}`,
    });
  });
  return items;
}

function isAfterAck(lastAckAt: string | null, eventAt: string): boolean {
  if (!lastAckAt) return true;
  return eventAt > lastAckAt;
}

function loadThreads(threadIds?: string[]): ChatThreadMetaRow[] {
  const db = getDb();
  if (threadIds?.length) {
    return db
      .prepare(
        `SELECT id, scope, project_id, work_order_id, last_ack_at
         FROM chat_threads WHERE id IN (${buildInClause(threadIds)})`
      )
      .all(...threadIds) as ChatThreadMetaRow[];
  }
  return db
    .prepare(
      "SELECT id, scope, project_id, work_order_id, last_ack_at FROM chat_threads"
    )
    .all() as ChatThreadMetaRow[];
}

function buildAttentionSummaries(
  threads: ChatThreadMetaRow[]
): Map<string, ChatAttentionSummary> {
  const db = getDb();
  const ackByThreadId = new Map(threads.map((t) => [t.id, t.last_ack_at]));

  const pendingActionsByThread = new Map<
    string,
    { count: number; last_event_at: string; action_titles: string[] }
  >();
  const needsInputByThread = new Map<string, { count: number; last_event_at: string }>();
  const pendingApprovalByThread = new Map<string, { count: number; last_event_at: string }>();
  const runFailedByThread = new Map<string, { count: number; last_event_at: string }>();
  const undoFailedByThread = new Map<string, { count: number; last_event_at: string }>();

  const messages = db
    .prepare(
      `SELECT id, thread_id, actions_json, created_at
       FROM chat_messages
       WHERE role = 'assistant'
         AND actions_json IS NOT NULL
         AND actions_json != '[]'`
    )
    .all() as ChatMessageActionRow[];

  const messageIds = Array.from(new Set(messages.map((message) => message.id)));
  const ledgerRows: Array<{ message_id: string; action_index: number }> = [];
  if (messageIds.length) {
    for (const chunk of chunkArray(messageIds, SQLITE_MAX_VARS)) {
      const rows = db
        .prepare(
          `SELECT message_id, action_index FROM chat_action_ledger WHERE message_id IN (${buildInClause(
            chunk
          )})`
        )
        .all(...chunk) as Array<{ message_id: string; action_index: number }>;
      ledgerRows.push(...rows);
    }
  }
  const ledgerKeys = new Set(
    ledgerRows.map((row) => `${row.message_id}:${row.action_index}`)
  );

  for (const message of messages) {
    const lastAckAt = ackByThreadId.get(message.thread_id) ?? null;
    if (!isAfterAck(lastAckAt, message.created_at)) continue;
    const actions = parseActionTitles(message.actions_json);
    if (!actions.length) continue;
    const pendingTitles = actions
      .filter((action) => !ledgerKeys.has(`${message.id}:${action.index}`))
      .map((action) => action.title)
      .filter((title) => title.trim());
    if (!pendingTitles.length) continue;

    const existing =
      pendingActionsByThread.get(message.thread_id) ??
      {
        count: 0,
        last_event_at: message.created_at,
        action_titles: [],
      };
    existing.count += pendingTitles.length;
    existing.action_titles.push(...pendingTitles);
    if (message.created_at > existing.last_event_at) {
      existing.last_event_at = message.created_at;
    }
    pendingActionsByThread.set(message.thread_id, existing);
  }

  const needsInputRows = db
    .prepare(
      `SELECT thread_id, created_at
       FROM chat_messages
       WHERE role = 'assistant'
         AND needs_user_input = 1`
    )
    .all() as ChatMessageNeedsInputRow[];
  for (const row of needsInputRows) {
    const lastAckAt = ackByThreadId.get(row.thread_id) ?? null;
    if (!isAfterAck(lastAckAt, row.created_at)) continue;
    const existing =
      needsInputByThread.get(row.thread_id) ??
      { count: 0, last_event_at: row.created_at };
    existing.count += 1;
    if (row.created_at > existing.last_event_at) {
      existing.last_event_at = row.created_at;
    }
    needsInputByThread.set(row.thread_id, existing);
  }

  const pendingRows = db
    .prepare(
      `SELECT thread_id, created_at
       FROM chat_pending_sends
       WHERE resolved_at IS NULL
         AND canceled_at IS NULL`
    )
    .all() as ChatPendingSendRow[];
  for (const row of pendingRows) {
    const lastAckAt = ackByThreadId.get(row.thread_id) ?? null;
    if (!isAfterAck(lastAckAt, row.created_at)) continue;
    const existing =
      pendingApprovalByThread.get(row.thread_id) ??
      { count: 0, last_event_at: row.created_at };
    existing.count += 1;
    if (row.created_at > existing.last_event_at) {
      existing.last_event_at = row.created_at;
    }
    pendingApprovalByThread.set(row.thread_id, existing);
  }

  const runFailedRows = db
    .prepare(
      `SELECT thread_id, COALESCE(finished_at, created_at) AS failed_at
       FROM chat_runs
       WHERE status = 'failed'`
    )
    .all() as ChatRunFailureRow[];
  for (const row of runFailedRows) {
    if (!row.failed_at) continue;
    const lastAckAt = ackByThreadId.get(row.thread_id) ?? null;
    if (!isAfterAck(lastAckAt, row.failed_at)) continue;
    const existing =
      runFailedByThread.get(row.thread_id) ??
      { count: 0, last_event_at: row.failed_at };
    existing.count += 1;
    if (row.failed_at > existing.last_event_at) {
      existing.last_event_at = row.failed_at;
    }
    runFailedByThread.set(row.thread_id, existing);
  }

  const undoFailedRows = db
    .prepare(
      `SELECT thread_id, COALESCE(error_at, applied_at) AS error_at
       FROM chat_action_ledger
       WHERE undone_at IS NULL
         AND (error_at IS NOT NULL OR error IS NOT NULL)`
    )
    .all() as ChatActionErrorRow[];
  for (const row of undoFailedRows) {
    const lastAckAt = ackByThreadId.get(row.thread_id) ?? null;
    if (!isAfterAck(lastAckAt, row.error_at)) continue;
    const existing =
      undoFailedByThread.get(row.thread_id) ??
      { count: 0, last_event_at: row.error_at };
    existing.count += 1;
    if (row.error_at > existing.last_event_at) {
      existing.last_event_at = row.error_at;
    }
    undoFailedByThread.set(row.thread_id, existing);
  }

  const summaryByThread = new Map<string, ChatAttentionSummary>();

  for (const thread of threads) {
    const reasons: ChatAttentionReason[] = [];

    const pendingActions = pendingActionsByThread.get(thread.id);
    if (pendingActions) {
      reasons.push({
        code: "pending_action",
        created_at: pendingActions.last_event_at,
        count: pendingActions.count,
        action_titles: pendingActions.action_titles,
      });
    }

    const pendingApprovals = pendingApprovalByThread.get(thread.id);
    if (pendingApprovals) {
      reasons.push({
        code: "pending_approval",
        created_at: pendingApprovals.last_event_at,
        count: pendingApprovals.count,
      });
    }

    const needsInput = needsInputByThread.get(thread.id);
    if (needsInput) {
      reasons.push({
        code: "needs_user_input",
        created_at: needsInput.last_event_at,
        count: needsInput.count,
      });
    }

    const runFailed = runFailedByThread.get(thread.id);
    if (runFailed) {
      reasons.push({
        code: "run_failed",
        created_at: runFailed.last_event_at,
        count: runFailed.count,
      });
    }

    const undoFailed = undoFailedByThread.get(thread.id);
    if (undoFailed) {
      reasons.push({
        code: "undo_failed",
        created_at: undoFailed.last_event_at,
        count: undoFailed.count,
      });
    }

    reasons.sort((a, b) => {
      if (a.created_at !== b.created_at) {
        return b.created_at.localeCompare(a.created_at);
      }
      return reasonOrder.indexOf(a.code) - reasonOrder.indexOf(b.code);
    });

    const lastEventAt = reasons.length
      ? reasons.reduce(
          (latest, reason) =>
            reason.created_at > latest ? reason.created_at : latest,
          reasons[0].created_at
        )
      : null;

    summaryByThread.set(thread.id, {
      needs_you: reasons.length > 0,
      reason_codes: reasons.map((reason) => reason.code),
      reasons,
      last_event_at: lastEventAt,
    });
  }

  return summaryByThread;
}

export function listChatAttentionSummaries(params?: {
  threadIds?: string[];
}): Map<string, ChatAttentionSummary> {
  const threads = loadThreads(params?.threadIds);
  return buildAttentionSummaries(threads);
}

export function listChatAttention(): ChatAttentionResponse {
  const threads = loadThreads();
  const summaryByThread = buildAttentionSummaries(threads);
  const threadById = new Map(threads.map((row) => [row.id, row]));

  const projectIds = Array.from(
    new Set(threads.map((row) => row.project_id).filter((id): id is string => Boolean(id)))
  );
  const db = getDb();
  const projectRows = projectIds.length
    ? (db
        .prepare(
          `SELECT id, name FROM projects WHERE id IN (${buildInClause(projectIds)})`
        )
        .all(...projectIds) as Array<{ id: string; name: string }>)
    : [];
  const projectNameById = new Map(projectRows.map((row) => [row.id, row.name]));

  const workOrderIds = Array.from(
    new Set(threads.map((row) => row.work_order_id).filter((id): id is string => Boolean(id)))
  );
  const workOrderRows = workOrderIds.length
    ? (db
        .prepare(
          `SELECT id, title FROM work_orders WHERE id IN (${buildInClause(workOrderIds)})`
        )
        .all(...workOrderIds) as Array<{ id: string; title: string }>)
    : [];
  const workOrderTitleById = new Map(
    workOrderRows.map((row) => [row.id, row.title])
  );

  const items: ChatAttentionItem[] = [];
  for (const [threadId, attention] of summaryByThread.entries()) {
    if (!attention.needs_you) continue;
    const thread = threadById.get(threadId);
    if (!thread) continue;
    items.push({
      thread_id: thread.id,
      scope: thread.scope,
      project_id: thread.project_id ?? null,
      work_order_id: thread.work_order_id ?? null,
      project_name: thread.project_id ? projectNameById.get(thread.project_id) ?? null : null,
      work_order_title: thread.work_order_id
        ? workOrderTitleById.get(thread.work_order_id) ?? null
        : null,
      attention,
    });
  }

  items.sort((a, b) => {
    const aTime = a.attention.last_event_at ?? "";
    const bTime = b.attention.last_event_at ?? "";
    return bTime.localeCompare(aTime);
  });

  return { items, limited: false, scan_limit: null };
}
