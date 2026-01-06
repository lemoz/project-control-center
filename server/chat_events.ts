import { EventEmitter } from "events";
import { listChatAttentionSummaries, type ChatAttentionSummary } from "./chat_attention.js";
import type {
  ChatActionLedgerRow,
  ChatMessageRow,
  ChatRunRow,
  ChatThreadRow,
} from "./chat_db.js";

export type ChatStreamEvent =
  | {
      type: "chat.message.new";
      thread_id: string;
      message_id: string;
      role: ChatMessageRow["role"];
      created_at: string;
      run_id: string | null;
    }
  | {
      type: "chat.run.status";
      thread_id: string;
      run_id: string;
      status: ChatRunRow["status"];
      started_at: string | null;
      finished_at: string | null;
      error: string | null;
    }
  | {
      type: "chat.action.applied";
      thread_id: string;
      ledger_id: string;
      run_id: string;
      message_id: string;
      action_index: number;
      action_type: string;
      applied_at: string;
    }
  | {
      type: "chat.action.undone";
      thread_id: string;
      ledger_id: string;
      run_id: string;
      message_id: string;
      action_index: number;
      action_type: string;
      undone_at: string | null;
      error: string | null;
    }
  | {
      type: "chat.thread.updated";
      thread_id: string;
      updated_at: string;
    }
  | {
      type: "chat.attention.updated";
      thread_id: string;
      attention: ChatAttentionSummary;
    };

type ChatStreamListener = (event: ChatStreamEvent) => void;

const EMPTY_ATTENTION: ChatAttentionSummary = {
  needs_you: false,
  reason_codes: [],
  reasons: [],
  last_event_at: null,
};

const emitter = new EventEmitter();
emitter.setMaxListeners(0);

const attentionCache = new Map<string, string>();

function hasListeners(): boolean {
  return emitter.listenerCount("chat") > 0;
}

function emitEvent(event: ChatStreamEvent): void {
  if (!hasListeners()) return;
  emitter.emit("chat", event);
}

export function onChatStreamEvent(listener: ChatStreamListener): () => void {
  emitter.on("chat", listener);
  return () => {
    emitter.off("chat", listener);
    if (!hasListeners()) attentionCache.clear();
  };
}

export function emitChatAttentionIfChanged(threadId: string): void {
  if (!hasListeners()) return;
  const summary =
    listChatAttentionSummaries({ threadIds: [threadId] }).get(threadId) ?? EMPTY_ATTENTION;
  const serialized = JSON.stringify(summary);
  if (attentionCache.get(threadId) === serialized) return;
  attentionCache.set(threadId, serialized);
  emitEvent({ type: "chat.attention.updated", thread_id: threadId, attention: summary });
}

export function emitChatMessageEvent(message: ChatMessageRow): void {
  emitEvent({
    type: "chat.message.new",
    thread_id: message.thread_id,
    message_id: message.id,
    role: message.role,
    created_at: message.created_at,
    run_id: message.run_id,
  });
  if (message.role === "assistant") {
    emitChatAttentionIfChanged(message.thread_id);
  }
}

export function emitChatRunStatusEvent(run: ChatRunRow): void {
  emitEvent({
    type: "chat.run.status",
    thread_id: run.thread_id,
    run_id: run.id,
    status: run.status,
    started_at: run.started_at,
    finished_at: run.finished_at,
    error: run.error,
  });
  emitChatAttentionIfChanged(run.thread_id);
}

export function emitChatActionAppliedEvent(ledger: ChatActionLedgerRow): void {
  emitEvent({
    type: "chat.action.applied",
    thread_id: ledger.thread_id,
    ledger_id: ledger.id,
    run_id: ledger.run_id,
    message_id: ledger.message_id,
    action_index: ledger.action_index,
    action_type: ledger.action_type,
    applied_at: ledger.applied_at,
  });
  emitChatAttentionIfChanged(ledger.thread_id);
}

export function emitChatActionUndoneEvent(ledger: ChatActionLedgerRow): void {
  emitEvent({
    type: "chat.action.undone",
    thread_id: ledger.thread_id,
    ledger_id: ledger.id,
    run_id: ledger.run_id,
    message_id: ledger.message_id,
    action_index: ledger.action_index,
    action_type: ledger.action_type,
    undone_at: ledger.undone_at,
    error: ledger.error,
  });
  emitChatAttentionIfChanged(ledger.thread_id);
}

export function emitChatThreadUpdatedEvent(thread: ChatThreadRow): void {
  emitEvent({
    type: "chat.thread.updated",
    thread_id: thread.id,
    updated_at: thread.updated_at,
  });
}
