import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pcc-chat-threads-"));
const dbPath = path.join(tmpDir, "threads.db");
const originalDbPath = process.env.CONTROL_CENTER_DB_PATH;
const originalPccDbPath = process.env.PCC_DATABASE_PATH;
process.env.CONTROL_CENTER_DB_PATH = dbPath;
process.env.PCC_DATABASE_PATH = dbPath;

const originalCwd = process.cwd();

const { getDb } = await import("./db.ts");
const { createChatThread, getChatRunById, listChatThreads, updateChatThread } =
  await import("./chat_db.ts");
const { enqueueChatTurnForThread } = await import("./chat_agent.ts");

const db = getDb();

test("chat threads support defaults, overrides, and archiving", (t) => {
  t.after(() => {
    db.close();
    process.chdir(originalCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
    if (originalDbPath === undefined) delete process.env.CONTROL_CENTER_DB_PATH;
    else process.env.CONTROL_CENTER_DB_PATH = originalDbPath;
    if (originalPccDbPath === undefined) delete process.env.PCC_DATABASE_PATH;
    else process.env.PCC_DATABASE_PATH = originalPccDbPath;
  });

  process.chdir(tmpDir);

  const thread = createChatThread({
    scope: "global",
    name: "Ops thread",
    defaultContextDepth: "minimal",
    defaultAccess: { filesystem: "none", cli: "off", network: "none" },
  });

  assert.equal(thread.name, "Ops thread");
  assert.equal(thread.scope, "global");
  assert.equal(thread.default_context_depth, "minimal");
  assert.equal(thread.default_access_filesystem, "none");
  assert.equal(thread.default_access_cli, "off");

  const run1 = enqueueChatTurnForThread({
    threadId: thread.id,
    content: "hello",
    spawnWorker: false,
  });
  const loaded1 = getChatRunById(run1.id);
  assert.ok(loaded1);
  assert.equal(loaded1.context_depth, "minimal");
  assert.equal(loaded1.access_filesystem, "none");
  assert.equal(loaded1.access_cli, "off");
  assert.equal(loaded1.access_network, "none");

  const run2 = enqueueChatTurnForThread({
    threadId: thread.id,
    content: "inspect",
    context: { depth: "messages_tools" },
    access: { filesystem: "read-only", cli: "read-only", network: "localhost" },
    spawnWorker: false,
  });
  const loaded2 = getChatRunById(run2.id);
  assert.ok(loaded2);
  assert.equal(loaded2.context_depth, "messages_tools");
  assert.equal(loaded2.access_filesystem, "read-only");
  assert.equal(loaded2.access_cli, "read-only");
  assert.equal(loaded2.access_network, "localhost");

  const archivedAt = "2026-01-04T00:00:00.000Z";
  const updated = updateChatThread({ threadId: thread.id, archivedAt });
  assert.ok(updated);
  assert.equal(updated.archived_at, archivedAt);

  const visible = listChatThreads();
  assert.equal(
    visible.some((candidate) => candidate.id === thread.id),
    false
  );

  const all = listChatThreads({ includeArchived: true });
  assert.equal(all.some((candidate) => candidate.id === thread.id), true);
});
