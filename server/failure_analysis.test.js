import assert from "node:assert/strict";
import { test } from "node:test";
import { classifyRunFailure } from "./failure_analysis.js";

const now = new Date().toISOString();

const baseRun = {
  id: "run-1",
  project_id: "project-1",
  work_order_id: "WO-1",
  provider: "codex",
  status: "failed",
  iteration: 1,
  builder_iteration: 1,
  reviewer_verdict: null,
  reviewer_notes: null,
  summary: null,
  branch_name: null,
  source_branch: null,
  merge_status: null,
  conflict_with_run_id: null,
  run_dir: "/tmp/run-1",
  log_path: "/tmp/run-1/run.log",
  created_at: now,
  started_at: null,
  finished_at: null,
  error: null,
  failure_category: null,
  failure_reason: null,
  failure_detail: null,
  escalation: null,
};

function buildContext(runOverrides, contextOverrides = {}) {
  return {
    run: { ...baseRun, ...runOverrides },
    log_tail: "",
    tests_log_tail: "",
    test_results: null,
    baseline_results: null,
    ...contextOverrides,
  };
}

test("classifyRunFailure tags baseline failures from status + results", () => {
  const context = buildContext(
    { status: "baseline_failed" },
    { baseline_results: [{ command: "npm test", passed: false }] }
  );
  const result = classifyRunFailure(context);
  assert.ok(result);
  assert.equal(result.category, "baseline_failure");
  assert.equal(result.pattern, "baseline_tests_failed");
  assert.equal(result.detail, "failed: npm test");
  assert.equal(result.source, "status");
});

test("classifyRunFailure detects TypeScript build failures from logs", () => {
  const context = buildContext(
    { status: "failed", error: null },
    { log_tail: "error TS2345: Argument of type 'x' is not assignable." }
  );
  const result = classifyRunFailure(context);
  assert.ok(result);
  assert.equal(result.category, "build_error");
  assert.equal(result.pattern, "typescript_error");
  assert.match(result.detail ?? "", /TS2345/);
  assert.equal(result.source, "log");
});
