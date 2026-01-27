import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pcc-merge-locks-"));
const dbPath = path.join(tmpDir, "merge-locks.db");
const originalDbPath = process.env.CONTROL_CENTER_DB_PATH;
const originalPccDbPath = process.env.PCC_DATABASE_PATH;
process.env.CONTROL_CENTER_DB_PATH = dbPath;
process.env.PCC_DATABASE_PATH = dbPath;

const {
  acquireMergeLock,
  getDb,
  getMergeLock,
  releaseMergeLock,
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
    "app",
    "active",
    "ok",
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
  if (originalPccDbPath === undefined) {
    delete process.env.PCC_DATABASE_PATH;
  } else {
    process.env.PCC_DATABASE_PATH = originalPccDbPath;
  }
});

test("merge locks serialize acquisition across runs", () => {
  seedProject();
  const projectId = "project-1";
  const runA = "run-a";
  const runB = "run-b";

  assert.equal(acquireMergeLock(projectId, runA), true);
  assert.equal(getMergeLock(projectId)?.run_id, runA);

  assert.equal(acquireMergeLock(projectId, runB), false);
  assert.equal(getMergeLock(projectId)?.run_id, runA);

  releaseMergeLock(projectId, runB);
  assert.equal(getMergeLock(projectId)?.run_id, runA);

  releaseMergeLock(projectId, runA);
  assert.equal(getMergeLock(projectId), null);

  assert.equal(acquireMergeLock(projectId, runB), true);
  assert.equal(getMergeLock(projectId)?.run_id, runB);

  releaseMergeLock(projectId, runB);
  assert.equal(getMergeLock(projectId), null);
});

test("acquireMergeLock clears stale locks", () => {
  seedProject();
  const projectId = "project-1";
  const db = getDb();
  const staleAt = new Date(Date.now() - 11 * 60 * 1000).toISOString();
  db.prepare(
    "INSERT OR REPLACE INTO merge_locks (project_id, run_id, acquired_at) VALUES (?, ?, ?)"
  ).run(projectId, "run-stale", staleAt);

  assert.equal(getMergeLock(projectId)?.run_id, "run-stale");
  assert.equal(acquireMergeLock(projectId, "run-fresh"), true);
  assert.equal(getMergeLock(projectId)?.run_id, "run-fresh");

  releaseMergeLock(projectId, "run-fresh");
  assert.equal(getMergeLock(projectId), null);
});
