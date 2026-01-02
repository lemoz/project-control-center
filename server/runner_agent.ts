import { spawn, spawnSync } from "child_process";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import {
  createRun,
  findProjectById,
  getRunById,
  listRunsByProject,
  type RunRow,
  updateRun,
} from "./db.js";
import {
  listWorkOrders,
  patchWorkOrder,
  readWorkOrderMarkdown,
  type WorkOrder,
} from "./work_orders.js";
import { resolveRunnerSettingsForRepo } from "./settings.js";

const DEFAULT_MAX_ITERATIONS = 5;

const IGNORE_DIRS = new Set([
  ".git",
  ".system",
  "node_modules",
  ".next",
  ".next-dev",
  "dist",
  "build",
  "out",
  ".venv",
  "venv",
  "__pycache__",
  ".pytest_cache",
  ".mypy_cache",
  ".ruff_cache",
  ".cache",
  "cache",
  "tmp",
  "temp",
  "logs",
  "output",
  "archive",
  ".idea",
  ".vscode",
  "test-results",
  "playwright-report",
]);

const IGNORE_FILE_NAMES = new Set([
  "control-center.db",
  "control-center.db-wal",
  "control-center.db-shm",
]);

const IGNORE_FILE_REGEX = /\.(db|sqlite|sqlite3)-(wal|shm|journal)$/i;

const DENY_BASENAME_PREFIXES = [".env"];
const DENY_BASENAMES = new Set([
  "id_rsa",
  "id_rsa.pub",
  "id_ed25519",
  "id_ed25519.pub",
  "id_ecdsa",
  "id_ecdsa.pub",
  "id_dsa",
  "id_dsa.pub",
]);
const DENY_EXTS = new Set([".pem", ".key", ".p12", ".pfx"]);

function nowIso(): string {
  return new Date().toISOString();
}

function ensureDir(dir: string) {
  if (fs.existsSync(dir)) return;
  fs.mkdirSync(dir, { recursive: true });
}

function npmCommand(): string {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

function writeJson(filePath: string, data: unknown) {
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function safeSymlink(target: string, linkPath: string) {
  try {
    if (fs.existsSync(linkPath) || fs.lstatSync(linkPath).isSymbolicLink()) {
      fs.rmSync(linkPath, { force: true, recursive: true });
    }
  } catch {
    // ignore
  }
  fs.symlinkSync(target, linkPath, "dir");
}

function isDeniedRelPath(relPath: string): boolean {
  const normalized = relPath.replace(/\\/g, "/");
  const base = path.posix.basename(normalized);

  if (DENY_BASENAME_PREFIXES.some((p) => base.startsWith(p))) return true;
  if (DENY_BASENAMES.has(base)) return true;
  const ext = path.posix.extname(base).toLowerCase();
  if (DENY_EXTS.has(ext)) return true;

  return false;
}

function listGitTrackedFiles(repoPath: string): string[] {
  const res = spawnSync("git", ["ls-files", "-z"], {
    cwd: repoPath,
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "buffer",
    maxBuffer: 25 * 1024 * 1024,
  });
  if ((res.status ?? 1) !== 0) return [];
  const stdout = (res.stdout as Buffer | undefined) ?? Buffer.from([]);
  return stdout
    .toString("utf8")
    .split("\u0000")
    .map((s) => s.trim())
    .filter(Boolean);
}

function copyGitTrackedSnapshot(repoPath: string, dstRoot: string): number {
  fs.rmSync(dstRoot, { recursive: true, force: true });
  ensureDir(dstRoot);

  const repoResolved = path.resolve(repoPath);
  const tracked = listGitTrackedFiles(repoPath);
  let copied = 0;

  for (const rel of tracked) {
    if (!rel || rel.includes("\u0000")) continue;
    if (rel.startsWith("/") || rel.includes("..")) continue;
    if (isDeniedRelPath(rel)) continue;

    const srcPath = path.join(repoPath, rel);
    const srcResolved = path.resolve(srcPath);
    if (!srcResolved.startsWith(repoResolved + path.sep)) continue;

    let stat: fs.Stats;
    try {
      stat = fs.lstatSync(srcPath);
    } catch {
      continue;
    }
    if (stat.isSymbolicLink() || stat.isDirectory() || !stat.isFile()) continue;

    const dstPath = path.join(dstRoot, rel);
    ensureDir(path.dirname(dstPath));
    try {
      fs.copyFileSync(srcPath, dstPath);
      copied += 1;
    } catch {
      // best-effort
    }
  }

  return copied;
}

function shouldPreferTsWorker(): boolean {
  if (process.env.CONTROL_CENTER_USE_TS_WORKER === "1") return true;
  const entry = process.argv[1] || "";
  if (entry.endsWith(".ts")) return true;
  return process.execArgv.some((arg) => arg.includes("tsx"));
}

function spawnRunWorker(runId: string) {
  const repoRoot = process.cwd();
  const distWorkerPath = path.join(repoRoot, "server", "dist", "runner_worker.js");
  const tsWorkerPath = path.join(repoRoot, "server", "runner_worker.ts");

  const preferTsWorker = shouldPreferTsWorker();

  let command: string;
  let args: string[];

  if (preferTsWorker) {
    const tsxBin = path.join(
      repoRoot,
      "node_modules",
      ".bin",
      process.platform === "win32" ? "tsx.cmd" : "tsx"
    );
    if (fs.existsSync(tsxBin)) {
      command = tsxBin;
      args = [tsWorkerPath, runId];
    } else if (fs.existsSync(distWorkerPath)) {
      command = process.execPath;
      args = [distWorkerPath, runId];
    } else {
      throw new Error("tsx not found; run `npm install`");
    }
  } else if (fs.existsSync(distWorkerPath)) {
    command = process.execPath;
    args = [distWorkerPath, runId];
  } else {
    const tsxBin = path.join(
      repoRoot,
      "node_modules",
      ".bin",
      process.platform === "win32" ? "tsx.cmd" : "tsx"
    );
    if (!fs.existsSync(tsxBin)) {
      throw new Error("tsx not found; run `npm install`");
    }
    command = tsxBin;
    args = [tsWorkerPath, runId];
  }

  const child = spawn(command, args, {
    cwd: repoRoot,
    env: process.env,
    stdio: "ignore",
    detached: true,
  });
  child.unref();
}

function tailFile(filePath: string, maxBytes = 24_000): string {
  try {
    const stat = fs.statSync(filePath);
    const start = Math.max(0, stat.size - maxBytes);
    const fd = fs.openSync(filePath, "r");
    const buf = Buffer.alloc(stat.size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    fs.closeSync(fd);
    return buf.toString("utf8");
  } catch {
    return "";
  }
}

function copySnapshot(srcRoot: string, dstRoot: string) {
  ensureDir(dstRoot);

  const walk = (srcDir: string, relDir: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(srcDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const name = entry.name;
      if (IGNORE_DIRS.has(name)) continue;
      if (name.startsWith(".DS_Store")) continue;

      const srcPath = path.join(srcDir, name);
      const relPath = relDir ? path.join(relDir, name) : name;
      const dstPath = path.join(dstRoot, relPath);

      let stat: fs.Stats;
      try {
        stat = fs.lstatSync(srcPath);
      } catch {
        continue;
      }
      if (stat.isSymbolicLink()) continue;

      if (stat.isDirectory()) {
        walk(srcPath, relPath);
        continue;
      }

      if (!stat.isFile()) continue;
      if (IGNORE_FILE_NAMES.has(name) || IGNORE_FILE_REGEX.test(name)) continue;
      if (isDeniedRelPath(relPath)) continue;
      ensureDir(path.dirname(dstPath));
      try {
        fs.copyFileSync(srcPath, dstPath);
      } catch {
        // ignore best-effort snapshot
      }
    }
  };

  walk(srcRoot, "");
}

function listFiles(root: string): string[] {
  const results: string[] = [];

  const walk = (dir: string, relDir: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const name = entry.name;
      if (IGNORE_DIRS.has(name)) continue;
      if (name === ".DS_Store") continue;
      const abs = path.join(dir, name);
      const rel = relDir ? path.join(relDir, name) : name;
      let stat: fs.Stats;
      try {
        stat = fs.lstatSync(abs);
      } catch {
        continue;
      }
      if (stat.isSymbolicLink()) continue;
      if (stat.isDirectory()) {
        walk(abs, rel);
        continue;
      }
      if (!stat.isFile()) continue;
      if (IGNORE_FILE_NAMES.has(name) || IGNORE_FILE_REGEX.test(name)) continue;
      if (isDeniedRelPath(rel)) continue;
      results.push(rel);
    }
  };

  walk(root, "");
  results.sort();
  return results;
}

function fileHash(filePath: string): string {
  const hash = crypto.createHash("sha1");
  const data = fs.readFileSync(filePath);
  hash.update(data);
  return hash.digest("hex");
}

function computeChangedFiles(baselineRoot: string, repoRoot: string): string[] {
  const baselineFiles = new Set(listFiles(baselineRoot));
  const repoFiles = new Set(listFiles(repoRoot));

  const all = new Set<string>([...baselineFiles, ...repoFiles]);
  const changed: string[] = [];

  for (const rel of all) {
    const aExists = baselineFiles.has(rel);
    const bExists = repoFiles.has(rel);
    if (!aExists || !bExists) {
      changed.push(rel);
      continue;
    }
    const aPath = path.join(baselineRoot, rel);
    const bPath = path.join(repoRoot, rel);
    let aStat: fs.Stats;
    let bStat: fs.Stats;
    try {
      aStat = fs.statSync(aPath);
      bStat = fs.statSync(bPath);
    } catch {
      changed.push(rel);
      continue;
    }
    if (aStat.size !== bStat.size) {
      changed.push(rel);
      continue;
    }
    try {
      if (fileHash(aPath) !== fileHash(bPath)) changed.push(rel);
    } catch {
      changed.push(rel);
    }
  }

  changed.sort();
  return changed;
}

function buildPatchForChangedFiles(
  runDir: string,
  baselineRoot: string,
  repoRoot: string,
  changedFiles: string[]
): string {
  const patchParts: string[] = [];
  const git = "git";

  // Create stable symlinks so diffs have clean paths.
  safeSymlink(baselineRoot, path.join(runDir, "a"));
  safeSymlink(repoRoot, path.join(runDir, "b"));

  for (const rel of changedFiles) {
    const aRel = path.join("a", rel);
    const bRel = path.join("b", rel);
    const aPath = path.join(baselineRoot, rel);
    const bPath = path.join(repoRoot, rel);
    const aExists = fs.existsSync(aPath);
    const bExists = fs.existsSync(bPath);

    const args = ["diff", "--no-index", "--relative", "--no-prefix", "--binary"];
    if (aExists && bExists) args.push(aRel, bRel);
    else if (!aExists && bExists) args.push("/dev/null", bRel);
    else if (aExists && !bExists) args.push(aRel, "/dev/null");
    else continue;

    const out = spawnSyncText(git, args, { cwd: runDir });
    if (out.trim()) patchParts.push(out.trimEnd());
  }

  return patchParts.length ? `${patchParts.join("\n\n")}\n` : "";
}

function spawnSyncText(
  command: string,
  args: string[],
  opts: { cwd: string }
): string {
  const res = spawnSync(command, args, {
    cwd: opts.cwd,
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });

  const stdout = res.stdout || "";
  const stderr = res.stderr || "";
  if ((res.status ?? 0) !== 0 && !stdout.trim() && stderr.trim()) return stderr;
  return stdout;
}

async function runCodexExec(params: {
  cwd: string;
  prompt: string;
  schemaPath: string;
  outputPath: string;
  logPath: string;
  sandbox: "read-only" | "workspace-write";
  skipGitRepoCheck?: boolean;
  model?: string;
  cliPath?: string;
}) {
  const args: string[] = ["--ask-for-approval", "never", "exec"];
  const model = params.model?.trim();
  if (model) args.push("--model", model);

  args.push(
    "--sandbox",
    params.sandbox,
    "--output-schema",
    params.schemaPath,
    "--output-last-message",
    params.outputPath,
    "--color",
    "never"
  );

  if (params.skipGitRepoCheck) args.push("--skip-git-repo-check");

  args.push("-");

  const cmd =
    params.cliPath?.trim() ||
    process.env.CONTROL_CENTER_CODEX_PATH ||
    "codex";

  ensureDir(path.dirname(params.logPath));
  const logStream = fs.createWriteStream(params.logPath, { flags: "a" });
  logStream.write(`[${nowIso()}] codex exec start (${params.sandbox})\n`);

  const child = spawn(cmd, args, {
    cwd: params.cwd,
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env },
  });

  child.stdout?.on("data", (buf) => logStream.write(buf));
  child.stderr?.on("data", (buf) => logStream.write(buf));
  child.stdin?.write(params.prompt);
  child.stdin?.end();

  const exitCode: number = await new Promise((resolve) => {
    child.on("close", (code) => resolve(code ?? 1));
    child.on("error", () => resolve(1));
  });

  logStream.write(`[${nowIso()}] codex exec end exit=${exitCode}\n`);
  logStream.end();

  if (exitCode !== 0) {
    throw new Error(`codex exec failed (exit ${exitCode})`);
  }
}

function builderSchema(): object {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      summary: { type: "string" },
      risks: { type: "array", items: { type: "string" } },
      tests: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            command: { type: "string" },
            passed: { type: "boolean" },
            output: { type: "string" },
          },
          required: ["command", "passed", "output"],
        },
      },
    },
    required: ["summary", "risks", "tests"],
  };
}

function reviewerSchema(): object {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      status: { type: "string", enum: ["approved", "changes_requested"] },
      notes: { type: "array", items: { type: "string" } },
    },
    required: ["status", "notes"],
  };
}

function loadWorkOrder(repoPath: string, workOrderId: string): WorkOrder {
  const all = listWorkOrders(repoPath);
  const found = all.find((w) => w.id === workOrderId);
  if (!found) throw new Error("Work Order not found");
  return found;
}

function buildBuilderPrompt(params: {
  workOrderMarkdown: string;
  workOrder: WorkOrder;
  iteration: number;
  reviewerFeedback?: string;
}) {
  const feedback = params.reviewerFeedback?.trim();
  return `You are the Builder agent.\n\n` +
    `Task: Implement the Work Order in this repository.\n\n` +
    `Rules:\n` +
    `- Follow the Work Order contract (goal + acceptance criteria + stop conditions).\n` +
    `- Implement only what is needed for this Work Order.\n` +
    `- Do NOT edit the Work Order file itself.\n` +
    `- Prefer minimal, high-quality changes; update docs/tests if needed.\n` +
    `- At the end, output a JSON object matching the required schema.\n\n` +
    (feedback ? `Reviewer feedback to address:\n${feedback}\n\n` : "") +
    `Work Order (${params.workOrder.id}):\n\n` +
    `${params.workOrderMarkdown}\n`;
}

function buildReviewerPrompt(params: {
  workOrderId: string;
  workOrderMarkdown: string;
  diffPatch: string;
}) {
  return (
    `You are a fresh Reviewer agent.\n\n` +
    `Task:\n` +
    `- Review the Work Order + diff.\n` +
    `- If needed, run READ-ONLY shell commands to inspect the provided repo snapshot at ./repo/.\n\n` +
    `Instructions:\n` +
    `- Be strict and practical. Assume you cannot run the code.\n` +
    `- Prefer lightweight inspection commands (ls/cat/rg/sed) and avoid anything that writes.\n` +
    `- Verify the diff matches the Work Order goal + acceptance criteria.\n` +
    `- Call out correctness, security, edge cases, tests, and scope creep.\n` +
    `- If changes are needed, return status=changes_requested with actionable notes.\n` +
    `- Otherwise return status=approved.\n` +
    `- Output JSON matching the required schema.\n\n` +
    `Work Order (${params.workOrderId}):\n\n` +
    `${params.workOrderMarkdown}\n\n` +
    `Diff:\n\n` +
    `${params.diffPatch}\n`
  );
}

async function runRepoTests(repoPath: string, runDir: string) {
  const pkgPath = path.join(repoPath, "package.json");
  if (!fs.existsSync(pkgPath)) {
    return [{ command: "(no tests)", passed: true, output: "No package.json found." }];
  }

  let pkg: unknown;
  try {
    pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  } catch {
    return [{ command: "(no tests)", passed: true, output: "package.json unreadable; skipping." }];
  }

  const scripts =
    typeof pkg === "object" && pkg && "scripts" in pkg
      ? (pkg as { scripts?: Record<string, string> }).scripts
      : undefined;
  const hasTest = !!scripts?.test;
  if (!hasTest) {
    return [{ command: "(no tests)", passed: true, output: "No test script; skipping." }];
  }

  const logPath = path.join(runDir, "tests", "npm-test.log");
  ensureDir(path.dirname(logPath));
  const logStream = fs.createWriteStream(logPath, { flags: "a" });
  logStream.write(`[${nowIso()}] npm test start\n`);

  const child = spawn(npmCommand(), ["test"], {
    cwd: repoPath,
    env: {
      ...process.env,
      CI: "1",
      NEXT_DIST_DIR: ".system/next-run-tests",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.stdout?.on("data", (buf) => logStream.write(buf));
  child.stderr?.on("data", (buf) => logStream.write(buf));

  const exitCode: number = await new Promise((resolve) => {
    child.on("close", (code) => resolve(code ?? 1));
    child.on("error", () => resolve(1));
  });

  logStream.write(`[${nowIso()}] npm test end exit=${exitCode}\n`);
  logStream.end();

  const outputTail = tailFile(logPath, 12_000);
  return [
    {
      command: "npm test",
      passed: exitCode === 0,
      output: outputTail,
    },
  ];
}

export async function runRun(runId: string) {
  const run = getRunById(runId);
  if (!run) return;

  let runLog: fs.WriteStream | null = null;
  const log = (line: string) => {
    if (!runLog) return;
    runLog.write(`[${nowIso()}] ${line}\n`);
  };

  try {
    const project = findProjectById(run.project_id);
    if (!project) {
      updateRun(runId, {
        status: "failed",
        error: "project not found",
        finished_at: nowIso(),
      });
      return;
    }

    const repoPath = project.path;
    const runnerSettings = resolveRunnerSettingsForRepo(repoPath).effective;
    const runDir = run.run_dir;
    ensureDir(runDir);
    ensureDir(path.join(runDir, "builder"));
    ensureDir(path.join(runDir, "reviewer"));
    ensureDir(path.join(runDir, "tests"));

    const logPath = run.log_path;
    ensureDir(path.dirname(logPath));
    runLog = fs.createWriteStream(logPath, { flags: "a" });

    const startedAt = nowIso();
    updateRun(runId, {
      status: "building",
      started_at: startedAt,
      error: null,
    });
    log(
      `Run ${runId} started for ${repoPath} work_order=${run.work_order_id}`
    );

    let workOrder: WorkOrder;
    let workOrderMarkdown: string;
    try {
      workOrder = loadWorkOrder(repoPath, run.work_order_id);
      workOrderMarkdown = readWorkOrderMarkdown(repoPath, run.work_order_id);
    } catch (err) {
      log(`Failed to load Work Order: ${String(err)}`);
      updateRun(runId, {
        status: "failed",
        error: "work order not found",
        finished_at: nowIso(),
      });
      return;
    }

    const workOrderFilePath = path.join(runDir, "work_order.md");
    fs.writeFileSync(workOrderFilePath, workOrderMarkdown, "utf8");

    // Move Work Order into building to reflect the run.
    try {
      if (workOrder.status === "ready") {
        patchWorkOrder(repoPath, run.work_order_id, { status: "building" });
      }
    } catch {
      // ignore; contract enforcement happens elsewhere
    }

    const baselineRoot = path.join(runDir, "baseline");
    if (!fs.existsSync(baselineRoot)) {
      log("Creating baseline snapshot");
      copySnapshot(repoPath, baselineRoot);
    }

    const builderSchemaPath = path.join(runDir, "builder.schema.json");
    const reviewerSchemaPath = path.join(runDir, "reviewer.schema.json");
    if (!fs.existsSync(builderSchemaPath))
      writeJson(builderSchemaPath, builderSchema());
    if (!fs.existsSync(reviewerSchemaPath))
      writeJson(reviewerSchemaPath, reviewerSchema());

    const maxIterations = Number(
      process.env.CONTROL_CENTER_MAX_RUN_ITERATIONS || DEFAULT_MAX_ITERATIONS
    );
    let reviewerFeedback: string | undefined;
    let approvedSummary: string | null = null;
    let reviewerVerdict: "approved" | "changes_requested" | null = null;
    let reviewerNotes: string[] = [];

    for (let iteration = 1; iteration <= maxIterations; iteration++) {
      updateRun(runId, {
        status: "building",
        iteration,
        reviewer_verdict: null,
        reviewer_notes: null,
      });
      log(`Builder iteration ${iteration} starting`);

      const builderDir = path.join(runDir, "builder", `iter-${iteration}`);
      const reviewerDir = path.join(runDir, "reviewer", `iter-${iteration}`);
      ensureDir(builderDir);
      ensureDir(reviewerDir);

      const builderPrompt = buildBuilderPrompt({
        workOrderMarkdown,
        workOrder,
        iteration,
        reviewerFeedback,
      });
      fs.writeFileSync(path.join(builderDir, "prompt.txt"), builderPrompt, "utf8");

      const builderOutputPath = path.join(builderDir, "result.json");
      const builderLogPath = path.join(builderDir, "codex.log");

      try {
        await runCodexExec({
          cwd: repoPath,
          prompt: builderPrompt,
          schemaPath: builderSchemaPath,
          outputPath: builderOutputPath,
          logPath: builderLogPath,
          sandbox: "workspace-write",
          model: runnerSettings.builder.model,
          cliPath: runnerSettings.builder.cliPath,
        });
      } catch (err) {
        log(`Builder failed: ${String(err)}`);
        updateRun(runId, {
          status: "failed",
          error: `builder failed: ${String(err)}`,
          finished_at: nowIso(),
        });
        return;
      }

      let builderResult:
        | { summary: string; risks: string[]; tests: unknown[] }
        | null = null;
      try {
        builderResult = JSON.parse(fs.readFileSync(builderOutputPath, "utf8")) as {
          summary: string;
          risks: string[];
          tests: unknown[];
        };
      } catch {
        // keep going; reviewer can still evaluate diff
      }

      const changedFiles = computeChangedFiles(baselineRoot, repoPath);
      const diffPatch = buildPatchForChangedFiles(
        runDir,
        baselineRoot,
        repoPath,
        changedFiles
      );
      fs.writeFileSync(
        path.join(runDir, "files_changed.json"),
        `${JSON.stringify(changedFiles, null, 2)}\n`,
        "utf8"
      );
      fs.writeFileSync(path.join(runDir, "diff.patch"), diffPatch, "utf8");
      fs.writeFileSync(
        path.join(runDir, `diff-iter-${iteration}.patch`),
        diffPatch,
        "utf8"
      );

      updateRun(runId, { status: "ai_review" });
      log(`Reviewer iteration ${iteration} starting`);

      const reviewerRepoSnapshot = path.join(reviewerDir, "repo");
      try {
        const copied = copyGitTrackedSnapshot(repoPath, reviewerRepoSnapshot);
        if (copied === 0) {
          fs.rmSync(reviewerRepoSnapshot, { recursive: true, force: true });
          copySnapshot(repoPath, reviewerRepoSnapshot);
        }
      } catch {
        // ignore; reviewer can still use diff-only review
      }

      const reviewerPrompt = buildReviewerPrompt({
        workOrderId: workOrder.id,
        workOrderMarkdown,
        diffPatch: diffPatch || "(no changes detected)",
      });
      fs.writeFileSync(
        path.join(reviewerDir, "prompt.txt"),
        reviewerPrompt,
        "utf8"
      );
      fs.copyFileSync(workOrderFilePath, path.join(reviewerDir, "work_order.md"));
      fs.writeFileSync(path.join(reviewerDir, "diff.patch"), diffPatch, "utf8");

      const reviewerOutputPath = path.join(reviewerDir, "verdict.json");
      const reviewerLogPath = path.join(reviewerDir, "codex.log");

      try {
        await runCodexExec({
          cwd: reviewerDir,
          prompt: reviewerPrompt,
          schemaPath: reviewerSchemaPath,
          outputPath: reviewerOutputPath,
          logPath: reviewerLogPath,
          sandbox: "read-only",
          skipGitRepoCheck: true,
          model: runnerSettings.reviewer.model,
          cliPath: runnerSettings.reviewer.cliPath,
        });
      } catch (err) {
        log(`Reviewer failed: ${String(err)}`);
        updateRun(runId, {
          status: "failed",
          error: `reviewer failed: ${String(err)}`,
          finished_at: nowIso(),
        });
        return;
      }

      let verdict:
        | { status: "approved" | "changes_requested"; notes: string[] }
        | null = null;
      try {
        verdict = JSON.parse(fs.readFileSync(reviewerOutputPath, "utf8")) as {
          status: "approved" | "changes_requested";
          notes: string[];
        };
      } catch {
        verdict = {
          status: "changes_requested",
          notes: ["Reviewer did not return valid JSON."],
        };
      }

      reviewerVerdict = verdict.status;
      reviewerNotes = verdict.notes || [];
      updateRun(runId, {
        reviewer_verdict: reviewerVerdict,
        reviewer_notes: JSON.stringify(reviewerNotes),
      });

      if (verdict.status === "approved") {
        approvedSummary = builderResult?.summary || "(no builder summary)";
        log(`Reviewer approved on iteration ${iteration}`);
        break;
      }

      log(`Reviewer requested changes on iteration ${iteration}`);
      reviewerFeedback = verdict.notes.join("\n");
    }

    if (reviewerVerdict !== "approved") {
      updateRun(runId, {
        status: "failed",
        error: "Reviewer did not approve within max iterations",
        finished_at: nowIso(),
        reviewer_verdict: reviewerVerdict,
        reviewer_notes: JSON.stringify(reviewerNotes),
      });
      return;
    }

    updateRun(runId, { status: "testing" });
    log("Running tests");
    let tests: Array<{ command: string; passed: boolean; output?: string }> = [];
    try {
      tests = await runRepoTests(repoPath, runDir);
      writeJson(path.join(runDir, "tests", "results.json"), tests);
    } catch (err) {
      tests = [{ command: "tests", passed: false, output: String(err) }];
      writeJson(path.join(runDir, "tests", "results.json"), tests);
    }

    const anyFailed = tests.some((t) => !t.passed);
    if (anyFailed) {
      updateRun(runId, {
        status: "failed",
        error: "Tests failed",
        finished_at: nowIso(),
        reviewer_verdict: "approved",
        reviewer_notes: JSON.stringify(reviewerNotes),
        summary: approvedSummary,
      });
      log("Tests failed; run marked failed");
      return;
    }

    const finishedAt = nowIso();
    updateRun(runId, {
      status: "you_review",
      finished_at: finishedAt,
      reviewer_verdict: "approved",
      reviewer_notes: JSON.stringify(reviewerNotes),
      summary: approvedSummary,
    });

    log("Run completed and approved");

    try {
      patchWorkOrder(repoPath, run.work_order_id, { status: "you_review" });
    } catch {
      // ignore
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log(`Unhandled error: ${message}`);
    updateRun(runId, {
      status: "failed",
      error: `unhandled error: ${message}`,
      finished_at: nowIso(),
    });
  } finally {
    try {
      runLog?.end();
    } catch {
      // ignore
    }
  }
}

export function enqueueCodexRun(projectId: string, workOrderId: string): RunRow {
  const project = findProjectById(projectId);
  if (!project) {
    throw new Error("project not found");
  }

  const runnerSettings = resolveRunnerSettingsForRepo(project.path).effective;
  if (runnerSettings.builder.provider !== "codex" || runnerSettings.reviewer.provider !== "codex") {
    throw new Error("Only the Codex provider is supported in v0; update Settings to use Codex.");
  }

  const workOrder = loadWorkOrder(project.path, workOrderId);
  if (workOrder.status !== "ready") {
    throw new Error("work order must be ready to run");
  }

  const id = crypto.randomUUID();
  const createdAt = nowIso();
  const runDir = path.join(project.path, ".system", "runs", id);
  const logPath = path.join(runDir, "run.log");

  ensureDir(runDir);

  const run: RunRow = {
    id,
    project_id: projectId,
    work_order_id: workOrderId,
    provider: "codex",
    status: "queued",
    iteration: 1,
    reviewer_verdict: null,
    reviewer_notes: null,
    summary: null,
    run_dir: runDir,
    log_path: logPath,
    created_at: createdAt,
    started_at: null,
    finished_at: null,
    error: null,
  };

  createRun(run);
  try {
    spawnRunWorker(id);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    updateRun(id, {
      status: "failed",
      error: `failed to start worker: ${message}`,
      finished_at: nowIso(),
    });
    throw err instanceof Error ? err : new Error(message);
  }
  return run;
}

export function getRunsForProject(projectId: string, limit = 50): RunRow[] {
  return listRunsByProject(projectId, limit);
}

export type RunDetails = RunRow & {
  log_tail: string;
  builder_log_tail: string;
  reviewer_log_tail: string;
  tests_log_tail: string;
};

export function getRun(runId: string): RunDetails | null {
  const run = getRunById(runId);
  if (!run) return null;
  const builderLogPath = path.join(
    run.run_dir,
    "builder",
    `iter-${run.iteration}`,
    "codex.log"
  );
  const reviewerLogPath = path.join(
    run.run_dir,
    "reviewer",
    `iter-${run.iteration}`,
    "codex.log"
  );
  const testsLogPath = path.join(run.run_dir, "tests", "npm-test.log");

  return {
    ...run,
    log_tail: tailFile(run.log_path),
    builder_log_tail: tailFile(builderLogPath),
    reviewer_log_tail: tailFile(reviewerLogPath),
    tests_log_tail: tailFile(testsLogPath),
  };
}
