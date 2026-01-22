import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pcc-observability-"));
const dbPath = path.join(tmpDir, "observability.db");
const originalDbPath = process.env.CONTROL_CENTER_DB_PATH;
process.env.CONTROL_CENTER_DB_PATH = dbPath;

const { getDb } = await import("./db.ts");
const { listRunFailureBreakdown } = await import("./observability.ts");

const db = getDb();

test("listRunFailureBreakdown uses terminal runs for success/failure rates", (t) => {
  t.after(() => {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
    if (originalDbPath === undefined) delete process.env.CONTROL_CENTER_DB_PATH;
    else process.env.CONTROL_CENTER_DB_PATH = originalDbPath;
  });

  const now = new Date().toISOString();
  db.prepare(
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

  const insertRun = db.prepare(
    `INSERT INTO runs (
      id,
      project_id,
      work_order_id,
      provider,
      status,
      run_dir,
      log_path,
      created_at,
      failure_category,
      failure_reason,
      failure_detail
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  insertRun.run(
    "run-merged",
    "project-1",
    "WO-1",
    "codex",
    "merged",
    "/tmp/run-merged",
    "/tmp/run-merged/run.log",
    now,
    null,
    null,
    null
  );
  insertRun.run(
    "run-failed",
    "project-1",
    "WO-2",
    "codex",
    "failed",
    "/tmp/run-failed",
    "/tmp/run-failed/run.log",
    now,
    "build_error",
    "typescript_error",
    "TS2345"
  );
  insertRun.run(
    "run-building",
    "project-1",
    "WO-3",
    "codex",
    "building",
    "/tmp/run-building",
    "/tmp/run-building/run.log",
    now,
    null,
    null,
    null
  );

  const breakdown = listRunFailureBreakdown(10, "project-1");
  assert.equal(breakdown.total_runs, 3);
  assert.equal(breakdown.total_terminal, 2);
  assert.equal(breakdown.total_failed, 1);
  assert.equal(breakdown.success_rate, 50);
  assert.equal(breakdown.failure_rate, 50);
});
