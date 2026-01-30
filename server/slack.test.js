import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pcc-slack-"));
const dbPath = path.join(tmpDir, "slack.db");
const originalDbPath = process.env.CONTROL_CENTER_DB_PATH;
const originalPccDbPath = process.env.PCC_DATABASE_PATH;
const originalSlackClientId = process.env.CONTROL_CENTER_SLACK_CLIENT_ID;

process.env.CONTROL_CENTER_DB_PATH = dbPath;
process.env.PCC_DATABASE_PATH = dbPath;
process.env.CONTROL_CENTER_SLACK_CLIENT_ID = "test-client";

const { getDb } = await import("./db.ts");
const { buildSlackInstallUrl, handleSlackEventEnvelope } = await import("./slack.ts");
const {
  consumeSlackOAuthState,
  createSlackConversation,
  listSlackConversationMessages,
} = await import("./slack_db.ts");

after(() => {
  const db = getDb();
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
  if (originalDbPath === undefined) {
    delete process.env.CONTROL_CENTER_DB_PATH;
  } else {
    process.env.CONTROL_CENTER_DB_PATH = originalDbPath;
  }
  if (originalPccDbPath === undefined) {
    delete process.env.PCC_DATABASE_PATH;
  } else {
    process.env.PCC_DATABASE_PATH = originalPccDbPath;
  }
  if (originalSlackClientId === undefined) {
    delete process.env.CONTROL_CENTER_SLACK_CLIENT_ID;
  } else {
    process.env.CONTROL_CENTER_SLACK_CLIENT_ID = originalSlackClientId;
  }
});

test("buildSlackInstallUrl includes a usable state", () => {
  const result = buildSlackInstallUrl();
  assert.equal(result.ok, true);
  assert.ok(result.url);
  const url = new URL(result.url);
  const state = url.searchParams.get("state");
  assert.ok(state);
  const first = consumeSlackOAuthState(state);
  assert.equal(first.ok, true);
  const second = consumeSlackOAuthState(state);
  assert.equal(second.ok, false);
});

test("channel thread replies continue active conversation", async () => {
  const threadTs = "1717000000.0001";
  const conversation = createSlackConversation({
    team_id: "T123",
    channel_id: "C123",
    user_id: "U123",
    thread_ts: threadTs,
    started_at: new Date().toISOString(),
    last_message_at: new Date().toISOString(),
  });

  const before = listSlackConversationMessages(conversation.id).length;

  await handleSlackEventEnvelope({
    type: "event_callback",
    team_id: "T123",
    event: {
      type: "message",
      channel: "C123",
      channel_type: "channel",
      user: "U123",
      text: "Continuing the thread.",
      ts: "1717000000.0002",
      thread_ts: threadTs,
    },
  });

  const after = listSlackConversationMessages(conversation.id);
  assert.equal(after.length, before + 1);
  assert.equal(after[after.length - 1].content, "Continuing the thread.");
});
