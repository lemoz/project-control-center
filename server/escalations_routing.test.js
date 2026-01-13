import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pcc-escalations-routing-"));
const dbPath = path.join(tmpDir, "escalations.db");
const originalDbPath = process.env.CONTROL_CENTER_DB_PATH;
process.env.CONTROL_CENTER_DB_PATH = dbPath;

const {
  createEscalation,
  getEscalationById,
  getOpenEscalationForProject,
  getDb,
  listEscalations,
  updateEscalation,
} = await import("./db.ts");

function seedProject() {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT OR IGNORE INTO projects (
      id,
      path,
      name,
      description,
      type,
      stage,
      status,
      priority,
      starred,
      hidden,
      tags,
      isolation_mode,
      vm_size,
      last_run_at,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    "project-1",
    "/tmp/project-1",
    "Project 1",
    null,
    "prototype",
    "active",
    "active",
    1,
    0,
    0,
    "[]",
    "local",
    "medium",
    null,
    now,
    now
  );
}

after(() => {
  const db = getDb();
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
  if (originalDbPath === undefined) {
    delete process.env.CONTROL_CENTER_DB_PATH;
  } else {
    process.env.CONTROL_CENTER_DB_PATH = originalDbPath;
  }
});

test("escalation lifecycle stores and updates rows", () => {
  seedProject();
  const escalation = createEscalation({
    project_id: "project-1",
    type: "blocked",
    summary: "Need access token",
    payload: JSON.stringify({ reason: "missing_token" }),
  });

  assert.equal(escalation.status, "pending");
  const pending = listEscalations({ statuses: ["pending"] });
  assert.equal(pending.length, 1);

  const claimed = updateEscalation(escalation.id, {
    status: "claimed",
    claimed_by: "global_agent",
  });
  assert.equal(claimed, true);
  const claimedRow = getEscalationById(escalation.id);
  assert.equal(claimedRow?.status, "claimed");
  assert.equal(claimedRow?.claimed_by, "global_agent");

  const resolvedAt = new Date().toISOString();
  const resolved = updateEscalation(escalation.id, {
    status: "resolved",
    resolution: JSON.stringify({ ok: true }),
    resolved_at: resolvedAt,
  });
  assert.equal(resolved, true);
  const resolvedRow = getEscalationById(escalation.id);
  assert.equal(resolvedRow?.status, "resolved");
  assert.equal(resolvedRow?.resolved_at, resolvedAt);
});

test("getOpenEscalationForProject returns active user escalations", () => {
  seedProject();
  const escalation = createEscalation({
    project_id: "project-1",
    type: "need_input",
    summary: "Need approval",
  });

  const none = getOpenEscalationForProject("project-1");
  assert.equal(none, null);

  updateEscalation(escalation.id, { status: "escalated_to_user" });
  const active = getOpenEscalationForProject("project-1");
  assert.equal(active?.id, escalation.id);
  assert.equal(active?.status, "escalated_to_user");
});
