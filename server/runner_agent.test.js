import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { __test__ } from "./runner_agent.ts";

const {
  buildConflictContext,
  ensureWorktreeLink,
  removeWorktreeLink,
  resolveWorktreePaths,
  shouldFallbackToLocalVm,
} = __test__;

test("resolveWorktreePaths places worktree under run dir without a symlink", (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pcc-worktree-"));
  t.after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const repoPath = path.join(tmpDir, "repo");
  const runId = "run-123";
  const runDir = path.join(repoPath, ".system", "runs", runId);
  fs.mkdirSync(runDir, { recursive: true });

  const { worktreePath, worktreeRealPath } = resolveWorktreePaths(runDir);
  assert.equal(worktreePath, path.join(runDir, "worktree"));
  assert.equal(worktreeRealPath, worktreePath);

  fs.mkdirSync(worktreePath, { recursive: true });
  ensureWorktreeLink(worktreePath, worktreeRealPath);
  assert.ok(!fs.lstatSync(worktreePath).isSymbolicLink());

  removeWorktreeLink(worktreePath);
  assert.ok(fs.existsSync(worktreePath));
});

test("buildConflictContext reconstructs conflict run context from artifacts", (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pcc-conflict-"));
  t.after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const repoPath = path.join(tmpDir, "repo");
  const runId = "run-current";
  const conflictRunId = "run-conflict";
  const runDir = path.join(repoPath, ".system", "runs", runId);
  const conflictDir = path.join(repoPath, ".system", "runs", conflictRunId);
  fs.mkdirSync(runDir, { recursive: true });
  fs.mkdirSync(conflictDir, { recursive: true });

  fs.writeFileSync(path.join(runDir, "diff.patch"), "current-diff\n", "utf8");
  fs.writeFileSync(
    path.join(conflictDir, "diff.patch"),
    "conflict-diff\n",
    "utf8"
  );
  fs.writeFileSync(
    path.join(conflictDir, "diff-merge.patch"),
    "merge-diff\n",
    "utf8"
  );
  fs.writeFileSync(
    path.join(conflictDir, "work_order.md"),
    "---\nid: WO-0001\n---\nConflicting work order\n",
    "utf8"
  );

  const workOrder = {
    id: "WO-9999",
    title: "Current work order",
    goal: null,
    context: [],
    acceptance_criteria: [],
    non_goals: [],
    stop_conditions: [],
    priority: 1,
    tags: [],
    estimate_hours: null,
    status: "ready",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ready_check: { ok: true, errors: [] },
  };

  const conflictDetails = buildConflictContext({
    repoPath,
    runId,
    runDir,
    workOrder,
    approvedSummary: "current summary",
    conflictFiles: ["server/runner_agent.ts"],
    gitConflictOutput: "conflict output",
    conflictingRun: {
      run: {
        id: conflictRunId,
        project_id: "project-1",
        work_order_id: "WO-0001",
        provider: "codex",
        status: "you_review",
        iteration: 1,
        reviewer_verdict: "approved",
        reviewer_notes: null,
        summary: "conflicting summary",
        branch_name: "run/WO-0001-1234",
        merge_status: "merged",
        conflict_with_run_id: null,
        run_dir: conflictDir,
        log_path: path.join(conflictDir, "run.log"),
        created_at: "2026-01-02T00:00:00.000Z",
        started_at: null,
        finished_at: "2026-01-03T00:00:00.000Z",
        error: null,
      },
      runDir: conflictDir,
    },
  });

  assert.equal(conflictDetails.currentDiff, "current-diff\n");
  assert.equal(conflictDetails.conflictingDiff, "merge-diff\n");
  assert.equal(
    conflictDetails.conflictingWorkOrderMarkdown.includes("Conflicting work order"),
    true
  );
  assert.equal(conflictDetails.conflictContext.currentRun.id, runId);
  assert.equal(conflictDetails.conflictContext.currentRun.builderSummary, "current summary");
  assert.equal(conflictDetails.conflictContext.conflictingRun?.id, conflictRunId);
  assert.equal(
    conflictDetails.conflictContext.conflictingRun?.builderSummary,
    "conflicting summary"
  );
});

test("shouldFallbackToLocalVm allows unprovisioned or missing VMs", () => {
  assert.equal(shouldFallbackToLocalVm(null), true);
  assert.equal(shouldFallbackToLocalVm({ status: "not_provisioned" }), true);
  assert.equal(shouldFallbackToLocalVm({ status: "deleted" }), true);
  assert.equal(shouldFallbackToLocalVm({ status: "stopped" }), false);
  assert.equal(shouldFallbackToLocalVm({ status: "running" }), false);
});
