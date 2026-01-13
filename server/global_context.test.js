import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pcc-global-context-"));
const dbPath = path.join(tmpDir, "context.db");
const repoRoot = path.join(tmpDir, "repos");
fs.mkdirSync(repoRoot, { recursive: true });

const originalDbPath = process.env.CONTROL_CENTER_DB_PATH;
const originalScanRoots = process.env.CONTROL_CENTER_SCAN_ROOTS;
const originalScanTtl = process.env.CONTROL_CENTER_SCAN_TTL_MS;
const originalBudget = process.env.CONTROL_CENTER_BUDGET_USED_TODAY;

process.env.CONTROL_CENTER_DB_PATH = dbPath;
process.env.CONTROL_CENTER_SCAN_ROOTS = repoRoot;
process.env.CONTROL_CENTER_SCAN_TTL_MS = "0";
process.env.CONTROL_CENTER_BUDGET_USED_TODAY = "12.5";

const { createRun, getDb, startShift, upsertProjectVm } = await import("./db.ts");
const { buildGlobalContextResponse } = await import("./global_context.ts");
const { invalidateDiscoveryCache, syncAndListRepoSummaries } = await import(
  "./projects_catalog.ts"
);

function writeControlFile(repoPath, data) {
  const lines = [
    `id: ${data.id}`,
    `name: "${data.name}"`,
    `status: ${data.status}`,
    `priority: ${data.priority}`,
  ];
  fs.writeFileSync(path.join(repoPath, ".control.yml"), `${lines.join("\n")}\n`, "utf8");
}

function writeWorkOrder(repoPath, workOrder) {
  const contents = [
    "---",
    `id: ${workOrder.id}`,
    `title: "${workOrder.title}"`,
    `status: ${workOrder.status}`,
    `priority: ${workOrder.priority}`,
    "---",
    "",
  ].join("\n");
  const workOrdersDir = path.join(repoPath, "work_orders");
  fs.mkdirSync(workOrdersDir, { recursive: true });
  fs.writeFileSync(path.join(workOrdersDir, `${workOrder.id}.md`), contents, "utf8");
}

function createRepo(params) {
  const repoPath = path.join(repoRoot, params.dirName);
  fs.mkdirSync(repoPath, { recursive: true });
  fs.mkdirSync(path.join(repoPath, ".git"), { recursive: true });
  writeControlFile(repoPath, params.control);
  for (const workOrder of params.workOrders) {
    writeWorkOrder(repoPath, workOrder);
  }
  return repoPath;
}

function escalationRecord({ tried, need, createdAt }) {
  return JSON.stringify({
    what_i_tried: tried,
    what_i_need: need,
    inputs: [{ key: "token", label: "Token" }],
    created_at: createdAt,
  });
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

  if (originalScanRoots === undefined) {
    delete process.env.CONTROL_CENTER_SCAN_ROOTS;
  } else {
    process.env.CONTROL_CENTER_SCAN_ROOTS = originalScanRoots;
  }

  if (originalScanTtl === undefined) {
    delete process.env.CONTROL_CENTER_SCAN_TTL_MS;
  } else {
    process.env.CONTROL_CENTER_SCAN_TTL_MS = originalScanTtl;
  }

  if (originalBudget === undefined) {
    delete process.env.CONTROL_CENTER_BUDGET_USED_TODAY;
  } else {
    process.env.CONTROL_CENTER_BUDGET_USED_TODAY = originalBudget;
  }
});

test("buildGlobalContextResponse aggregates and sorts projects", () => {
  createRepo({
    dirName: "alpha-repo",
    control: { id: "alpha", name: "Alpha Project", status: "active", priority: 2 },
    workOrders: [
      { id: "WO-ALPHA-1", title: "Alpha Ready", status: "ready", priority: 2 },
    ],
  });
  createRepo({
    dirName: "beta-repo",
    control: { id: "beta", name: "Beta Project", status: "active", priority: 1 },
    workOrders: [
      { id: "WO-BETA-1", title: "Beta Ready", status: "ready", priority: 1 },
    ],
  });
  createRepo({
    dirName: "gamma-repo",
    control: { id: "gamma", name: "Gamma Project", status: "active", priority: 1 },
    workOrders: [
      { id: "WO-GAMMA-1", title: "Gamma Done", status: "done", priority: 3 },
    ],
  });

  invalidateDiscoveryCache();
  syncAndListRepoSummaries();

  const alphaCreatedAt = "2026-01-12T12:00:00.000Z";
  const betaCreatedAt = "2026-01-12T11:00:00.000Z";

  createRun({
    id: "run-alpha",
    project_id: "alpha",
    work_order_id: "WO-ALPHA-1",
    provider: "codex",
    status: "waiting_for_input",
    iteration: 1,
    builder_iteration: 1,
    reviewer_verdict: null,
    reviewer_notes: null,
    summary: null,
    branch_name: "run/alpha",
    merge_status: null,
    conflict_with_run_id: null,
    run_dir: path.join(tmpDir, "run-alpha"),
    log_path: path.join(tmpDir, "run-alpha.log"),
    created_at: alphaCreatedAt,
    started_at: alphaCreatedAt,
    finished_at: null,
    error: null,
    escalation: escalationRecord({
      tried: "Alpha setup attempt",
      need: "Need alpha token",
      createdAt: alphaCreatedAt,
    }),
  });

  createRun({
    id: "run-beta",
    project_id: "beta",
    work_order_id: "WO-BETA-1",
    provider: "codex",
    status: "waiting_for_input",
    iteration: 1,
    builder_iteration: 1,
    reviewer_verdict: null,
    reviewer_notes: null,
    summary: null,
    branch_name: "run/beta",
    merge_status: null,
    conflict_with_run_id: null,
    run_dir: path.join(tmpDir, "run-beta"),
    log_path: path.join(tmpDir, "run-beta.log"),
    created_at: betaCreatedAt,
    started_at: betaCreatedAt,
    finished_at: null,
    error: null,
    escalation: escalationRecord({
      tried: "Beta setup attempt",
      need: "Need beta token",
      createdAt: betaCreatedAt,
    }),
  });

  startShift({ projectId: "beta", agentType: "global", agentId: "agent-1" });

  upsertProjectVm({
    project_id: "beta",
    provider: null,
    repo_path: null,
    gcp_instance_id: null,
    gcp_instance_name: null,
    gcp_project: null,
    gcp_zone: null,
    external_ip: null,
    internal_ip: null,
    status: "running",
    size: "medium",
    created_at: betaCreatedAt,
    last_started_at: betaCreatedAt,
    last_activity_at: betaCreatedAt,
    last_error: null,
    total_hours_used: 1,
  });

  upsertProjectVm({
    project_id: "gamma",
    provider: null,
    repo_path: null,
    gcp_instance_id: null,
    gcp_instance_name: null,
    gcp_project: null,
    gcp_zone: null,
    external_ip: null,
    internal_ip: null,
    status: "stopped",
    size: "medium",
    created_at: betaCreatedAt,
    last_started_at: null,
    last_activity_at: null,
    last_error: null,
    total_hours_used: 0,
  });

  const response = buildGlobalContextResponse();

  assert.equal(response.projects.length, 3);
  assert.deepEqual(
    response.projects.map((project) => project.id),
    ["beta", "alpha", "gamma"]
  );
  assert.equal(response.projects[0].active_shift?.agent_id, "agent-1");
  assert.equal(response.projects[0].escalations.length, 1);
  assert.equal(response.projects[1].escalations[0].summary, "Need alpha token");
  assert.equal(response.projects[2].health, "healthy");

  assert.equal(response.escalation_queue.length, 2);
  assert.deepEqual(
    response.escalation_queue.map((entry) => entry.project_id),
    ["beta", "alpha"]
  );
  assert.equal(response.escalation_queue[0].priority, 1);

  assert.equal(response.resources.vms_running, 1);
  assert.equal(response.resources.vms_available, 1);
  assert.equal(response.resources.budget_used_today, 12.5);
  assert.ok(response.economy);
  assert.ok(Number.isFinite(response.economy.monthly_budget_usd));
  assert.ok(Number.isFinite(response.economy.total_remaining_usd));
  assert.ok(Number.isFinite(response.economy.portfolio_burn_rate_daily_usd));
  const statusTotal =
    response.economy.projects_healthy +
    response.economy.projects_warning +
    response.economy.projects_critical +
    response.economy.projects_exhausted;
  assert.equal(statusTotal, response.projects.length);
  assert.ok(Number.isFinite(Date.parse(response.assembled_at)));
});
