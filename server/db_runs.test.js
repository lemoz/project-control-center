import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pcc-runs-"));
const dbPath = path.join(tmpDir, "runs.db");
const originalDbPath = process.env.CONTROL_CENTER_DB_PATH;
process.env.CONTROL_CENTER_DB_PATH = dbPath;

const { getDb, markWorkOrderRunsMerged } = await import("./db.ts");

const db = getDb();

test("markWorkOrderRunsMerged scopes updates to project_id", (t) => {
  t.after(() => {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
    if (originalDbPath === undefined) delete process.env.CONTROL_CENTER_DB_PATH;
    else process.env.CONTROL_CENTER_DB_PATH = originalDbPath;
  });

  const now = new Date().toISOString();
  const insertProject = db.prepare(
    `INSERT INTO projects (
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
  );

  insertProject.run(
    "project-a",
    "/tmp/project-a",
    "Project A",
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
  insertProject.run(
    "project-b",
    "/tmp/project-b",
    "Project B",
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

  const insertRun = db.prepare(
    `INSERT INTO runs (
      id,
      project_id,
      work_order_id,
      provider,
      status,
      run_dir,
      log_path,
      created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );

  insertRun.run(
    "run-a",
    "project-a",
    "WO-1234",
    "codex",
    "you_review",
    "/tmp/run-a",
    "/tmp/run-a.log",
    now
  );
  insertRun.run(
    "run-a2",
    "project-a",
    "WO-1234",
    "codex",
    "building",
    "/tmp/run-a2",
    "/tmp/run-a2.log",
    now
  );
  insertRun.run(
    "run-b",
    "project-b",
    "WO-1234",
    "codex",
    "you_review",
    "/tmp/run-b",
    "/tmp/run-b.log",
    now
  );

  const updated = markWorkOrderRunsMerged("project-a", "WO-1234");
  assert.equal(updated, 1);

  const rows = db
    .prepare("SELECT id, project_id, status FROM runs ORDER BY id")
    .all();
  const byId = new Map(rows.map((row) => [row.id, row]));

  assert.equal(byId.get("run-a").status, "merged");
  assert.equal(byId.get("run-a2").status, "building");
  assert.equal(byId.get("run-b").status, "you_review");
});
