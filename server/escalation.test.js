import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pcc-escalation-"));
const dbPath = path.join(tmpDir, "runs.db");
const originalDbPath = process.env.CONTROL_CENTER_DB_PATH;
process.env.CONTROL_CENTER_DB_PATH = dbPath;

const { createRun, getRunById, getDb } = await import("./db.ts");
const { provideRunInput, __test__ } = await import("./runner_agent.ts");

const { findEscalationRequest } = __test__;

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

test("findEscalationRequest parses escalation marker", () => {
  const payload = `
prefix
<<<NEED_HELP>>>
what_i_tried: |
  Tried creating the account but got stuck.
what_i_need: |
  Provide the API token.
inputs:
  - key: api_token
    label: API Token
<<<END_HELP>>>
suffix
`;
  const request = findEscalationRequest([payload]);
  assert.deepEqual(request, {
    what_i_tried: "Tried creating the account but got stuck.",
    what_i_need: "Provide the API token.",
    inputs: [{ key: "api_token", label: "API Token" }],
  });
});

test("provideRunInput records escalation resolution", () => {
  const db = getDb();
  const now = new Date().toISOString();
  const runId = "run-escalation";
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
  createRun({
    id: runId,
    project_id: "project-1",
    work_order_id: "WO-1234",
    provider: "codex",
    triggered_by: "manual",
    status: "waiting_for_input",
    iteration: 1,
    builder_iteration: 1,
    reviewer_verdict: null,
    reviewer_notes: null,
    summary: null,
    estimated_iterations: null,
    estimated_minutes: null,
    estimate_confidence: null,
    estimate_reasoning: null,
    current_eta_minutes: null,
    estimated_completion_at: null,
    eta_history: null,
    branch_name: "run/WO-1234-escalation",
    source_branch: null,
    merge_status: null,
    conflict_with_run_id: null,
    run_dir: path.join(tmpDir, "run"),
    log_path: path.join(tmpDir, "run.log"),
    created_at: now,
    started_at: now,
    finished_at: null,
    error: null,
    failure_category: null,
    failure_reason: null,
    failure_detail: null,
    escalation: JSON.stringify({
      what_i_tried: "Attempted setup",
      what_i_need: "Need API token",
      inputs: [{ key: "api_token", label: "API Token" }],
      created_at: now,
    }),
  });

  const missing = provideRunInput(runId, { api_token: "" });
  assert.equal(missing.ok, false);

  const ok = provideRunInput(runId, { api_token: "token-123" });
  assert.deepEqual(ok, { ok: true });

  const updated = getRunById(runId);
  assert.equal(updated?.status, "building");
  const escalation = JSON.parse(updated?.escalation ?? "{}");
  assert.equal(escalation.resolution.api_token, "token-123");
  assert.ok(escalation.resolved_at);
});
