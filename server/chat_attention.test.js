import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pcc-attention-"));
const dbPath = path.join(tmpDir, "attention.db");
const originalDbPath = process.env.CONTROL_CENTER_DB_PATH;
const originalPccDbPath = process.env.PCC_DATABASE_PATH;
process.env.CONTROL_CENTER_DB_PATH = dbPath;
process.env.PCC_DATABASE_PATH = dbPath;

const { getDb } = await import("./db.ts");
const { listChatAttention } = await import("./chat_attention.ts");
const { markChatThreadRead } = await import("./chat_db.ts");

const db = getDb();

test("listChatAttention respects ack + read activity", (t) => {
  t.after(() => {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
    if (originalDbPath === undefined) delete process.env.CONTROL_CENTER_DB_PATH;
    else process.env.CONTROL_CENTER_DB_PATH = originalDbPath;
    if (originalPccDbPath === undefined) delete process.env.PCC_DATABASE_PATH;
    else process.env.PCC_DATABASE_PATH = originalPccDbPath;
  });

  const base = Date.now();
  const t0 = new Date(base - 50_000).toISOString();
  const t1 = new Date(base - 40_000).toISOString();
  const t2 = new Date(base - 30_000).toISOString();
  const t3 = new Date(base - 20_000).toISOString();
  const t4 = new Date(base - 10_000).toISOString();
  const globalThreadId = "global";

  db.prepare(
    `INSERT INTO chat_threads (id, scope, project_id, work_order_id, summary, summarized_count, created_at, updated_at)
     VALUES (?, ?, ?, ?, '', 0, ?, ?)`
  ).run(globalThreadId, "global", null, null, t0, t0);

  db.prepare(
    `INSERT INTO chat_messages (id, thread_id, role, content, actions_json, needs_user_input, run_id, created_at)
     VALUES (?, ?, ?, ?, NULL, ?, NULL, ?)`
  ).run("msg-needs-input", globalThreadId, "assistant", "Need input", 1, t1);

  db.prepare(
    `INSERT INTO chat_pending_sends
      (id, thread_id, content, context_depth, access_filesystem, access_cli, access_network, access_network_allowlist, suggestion_json, created_at, resolved_at, canceled_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, NULL, NULL)`
  ).run("pending-1", globalThreadId, "Hello", "messages", "read-only", "off", "none", t2);

  const result = listChatAttention();
  assert.equal(result.limited, false);
  assert.equal(result.scan_limit, null);
  assert.equal(result.items.length, 1);

  const item = result.items[0];
  assert.equal(item.thread_id, globalThreadId);
  assert.equal(item.attention.needs_you, true);
  assert.ok(item.attention.reason_codes.includes("pending_approval"));
  assert.ok(item.attention.reason_codes.includes("needs_user_input"));

  const pendingApproval = item.attention.reasons.find(
    (reason) => reason.code === "pending_approval"
  );
  assert.ok(pendingApproval);
  assert.equal(pendingApproval.count, 1);

  const needsInput = item.attention.reasons.find(
    (reason) => reason.code === "needs_user_input"
  );
  assert.ok(needsInput);
  assert.equal(needsInput.count, 1);

  db.prepare("UPDATE chat_threads SET last_ack_at = ? WHERE id = ?").run(t2, globalThreadId);
  const afterAck = listChatAttention();
  assert.equal(afterAck.items.length, 0);

  db.prepare(
    `INSERT INTO chat_pending_sends
      (id, thread_id, content, context_depth, access_filesystem, access_cli, access_network, access_network_allowlist, suggestion_json, created_at, resolved_at, canceled_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, NULL, NULL)`
  ).run("pending-2", globalThreadId, "Followup", "messages", "read-only", "off", "none", t3);

  db.prepare(
    `INSERT INTO chat_runs (id, thread_id, user_message_id, assistant_message_id, status, model, cli_path, cwd, log_path, created_at, started_at, finished_at, error)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL)`
  ).run("run-undo", globalThreadId, "user-undo", null, "done", "test", "codex", "/tmp", "log", t3);

  db.prepare(
    `INSERT INTO chat_action_ledger
      (id, thread_id, run_id, message_id, action_index, action_type, action_payload_json, applied_at, undo_payload_json, undone_at, error, error_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, NULL)`
  ).run("ledger-undo-1", globalThreadId, "run-undo", "msg-needs-input", 0, "project_set_star", "{}", t3, "undo failed");

  const afterNewPending = listChatAttention();
  assert.equal(afterNewPending.items.length, 1);
  const pendingItem = afterNewPending.items[0];
  assert.ok(pendingItem.attention.reason_codes.includes("pending_approval"));
  assert.ok(pendingItem.attention.reason_codes.includes("undo_failed"));
  assert.ok(!pendingItem.attention.reason_codes.includes("needs_user_input"));
  const undoFailed = pendingItem.attention.reasons.find(
    (reason) => reason.code === "undo_failed"
  );
  assert.ok(undoFailed);
  assert.equal(undoFailed.count, 1);

  db.prepare(
    `INSERT INTO chat_runs (id, thread_id, user_message_id, assistant_message_id, status, model, cli_path, cwd, log_path, created_at, started_at, finished_at, error)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL)`
  ).run("run-1", globalThreadId, "user-1", null, "done", "test", "codex", "/tmp", "log", t4);

  db.prepare("UPDATE chat_threads SET last_read_at = ? WHERE id = ?").run(t1, globalThreadId);
  const updated = markChatThreadRead(globalThreadId);
  assert.ok(updated?.last_read_at);
  assert.ok(updated.last_read_at > t1);
});
