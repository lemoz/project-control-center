import { spawn, spawnSync, type ChildProcess } from "child_process";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import YAML from "yaml";
import {
  createRun,
  createRunPhaseMetric,
  findProjectById,
  getProjectVm,
  getRunById,
  listRunsByProject,
  type ProjectVmRow,
  type RunPhaseMetricOutcome,
  type RunPhaseMetricPhase,
  type RunRow,
  updateProjectVm,
  updateRun,
} from "./db.js";
import { VmManagerError, startVM } from "./vm_manager.js";
import {
  listWorkOrders,
  patchWorkOrder,
  readWorkOrderMarkdown,
  type WorkOrder,
} from "./work_orders.js";
import { generateAndStoreHandoff, type RunOutcome } from "./handoff_generator.js";
import { resolveRunnerSettingsForRepo } from "./settings.js";
import {
  formatConstitutionBlock,
  getConstitutionForProject,
  selectRelevantConstitutionSections,
  type ConstitutionSelection,
} from "./constitution.js";
import {
  remoteDownload,
  remoteExec,
  remoteUpload,
  type ExecResult,
  type RemoteExecOptions,
  type RemoteSyncOptions,
} from "./remote_exec.js";

const DEFAULT_MAX_BUILDER_ITERATIONS = 10;
const MAX_TEST_OUTPUT_LINES = 200;
const VM_ISOLATION_MODES = new Set(["vm", "vm+container"]);
const REMOTE_RUN_WORKSPACES_ROOT = ".system/run-workspaces";
const REMOTE_RUN_ARTIFACTS_ROOT = ".system/run-artifacts";
const TEST_ARTIFACT_DIRS = ["test-results", "playwright-report"];
const DEFAULT_CONTAINER_MEMORY = "4g";
const DEFAULT_CONTAINER_CPUS = 2;
const DEFAULT_CONTAINER_TIMEOUT_SEC = 3600;
const DEFAULT_CONTAINER_IMAGE = "pcc-runner:latest";
const DEFAULT_REMOTE_TEST_TIMEOUT_SEC = 900;
const REMOTE_TEST_TIMEOUT_MS = Math.round(
  parseNumberEnv(
    process.env.CONTROL_CENTER_REMOTE_TEST_TIMEOUT_SEC,
    DEFAULT_REMOTE_TEST_TIMEOUT_SEC
  ) * 1000
);
const E2E_WEB_PORT_BASE = 3012;
const E2E_OFFLINE_WEB_PORT_BASE = 3013;
const E2E_API_PORT_BASE = 4011;
const E2E_PORT_OFFSET_MOD = 90;
const E2E_PORT_OFFSET_STEP = 10;

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
  ...TEST_ARTIFACT_DIRS,
]);

const IGNORE_FILE_NAMES = new Set([
  "control-center.db",
  "control-center.db-wal",
  "control-center.db-shm",
]);

const IGNORE_FILE_REGEX = /\.(db|sqlite|sqlite3)-(wal|shm|journal)$/i;
const ESCALATION_REGEX = /<<<NEED_HELP>>>([\s\S]*?)<<<END_HELP>>>/;
const ESCALATION_OUTPUT_BUFFER_MAX = 200_000;
const ESCALATION_RESOLUTION_RELATIVE_PATH = ".system/escalation/resolution.json";
const ESCALATION_POLL_INTERVAL_MS = 250;
const RUNNER_PID_FILENAME = "runner.pid";
const RUNNER_TERMINATE_TIMEOUT_MS = 4000;
const RUNNER_KILL_TIMEOUT_MS = 2000;
const RUNNER_KILL_POLL_MS = 200;
const ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

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

type RunPhaseMetricMetadata = Record<string, unknown>;

function recordPhaseMetric(params: {
  runId: string;
  phase: RunPhaseMetricPhase;
  iteration: number;
  outcome: RunPhaseMetricOutcome;
  startedAt: Date;
  endedAt?: Date;
  metadata?: RunPhaseMetricMetadata;
  log?: (line: string) => void;
}): void {
  const endedAt = params.endedAt ?? new Date();
  const durationSeconds = Math.max(
    0,
    Math.round((endedAt.getTime() - params.startedAt.getTime()) / 1000)
  );
  let metadata: string | null = null;
  if (params.metadata && Object.keys(params.metadata).length) {
    try {
      metadata = JSON.stringify(params.metadata);
    } catch {
      metadata = null;
    }
  }
  try {
    createRunPhaseMetric({
      run_id: params.runId,
      phase: params.phase,
      iteration: params.iteration,
      started_at: params.startedAt.toISOString(),
      ended_at: endedAt.toISOString(),
      duration_seconds: durationSeconds,
      outcome: params.outcome,
      metadata,
    });
  } catch (err) {
    params.log?.(`Phase metric write failed (${params.phase}): ${String(err)}`);
  }
}

function parseNumberEnv(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function getPortOffset(runId: string): number {
  const prefix = runId.slice(0, 4);
  const hash = Number.parseInt(prefix, 16);
  if (!Number.isFinite(hash)) return 0;
  return (hash % E2E_PORT_OFFSET_MOD) * E2E_PORT_OFFSET_STEP;
}

type ContainerResourceLimits = {
  memory: string;
  cpus: number;
  timeoutSec: number;
};

type ContainerConfig = {
  image: string;
  resources: ContainerResourceLimits;
};

type VmStatusView = Pick<ProjectVmRow, "status">;

function shouldFallbackToLocalVm(vm: VmStatusView | null): boolean {
  if (!vm) return true;
  return vm.status === "not_provisioned" || vm.status === "deleted";
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

function appendLog(filePath: string, line: string) {
  const timestamp = new Date().toISOString();
  fs.appendFileSync(filePath, `[${timestamp}] ${line}\n`, "utf8");
}

function runnerPidPath(runDir: string): string {
  return path.join(runDir, RUNNER_PID_FILENAME);
}

function writeRunnerPid(runDir: string, pid: number): void {
  fs.writeFileSync(runnerPidPath(runDir), `${pid}\n`, "utf8");
}

function readRunnerPid(runDir: string): number | null {
  try {
    const raw = fs.readFileSync(runnerPidPath(runDir), "utf8").trim();
    if (!raw) return null;
    const pid = Number.parseInt(raw, 10);
    return Number.isFinite(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

function clearRunnerPid(runDir: string): void {
  try {
    fs.rmSync(runnerPidPath(runDir), { force: true });
  } catch {
    // ignore
  }
}

function removePathIfExists(targetPath: string) {
  try {
    if (fs.existsSync(targetPath) || fs.lstatSync(targetPath).isSymbolicLink()) {
      fs.rmSync(targetPath, { force: true, recursive: true });
    }
  } catch {
    // ignore
  }
}

function safeSymlink(target: string, linkPath: string) {
  removePathIfExists(linkPath);
  fs.symlinkSync(target, linkPath, "dir");
}

function normalizeRelPath(relPath: string): string {
  return relPath.replace(/\\/g, "/");
}

function isIgnoredRelDir(relPath: string): boolean {
  const normalized = normalizeRelPath(relPath);
  return normalized === "e2e/.tmp" || normalized.startsWith("e2e/.tmp/");
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
  // Include --others to capture new untracked files (e.g., created by builder)
  // --exclude-standard respects .gitignore
  const res = spawnSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], {
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

function spawnRunWorker(runId: string): ChildProcess {
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
  return child;
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

function createOutputCapture(maxLines: number) {
  let buffer = "";
  const lines: string[] = [];
  let truncated = false;

  const pushChunk = (buf: Buffer) => {
    buffer += buf.toString("utf8");
    const parts = buffer.split(/\r?\n/);
    buffer = parts.pop() ?? "";
    for (const line of parts) {
      lines.push(line);
      if (lines.length > maxLines) {
        lines.shift();
        truncated = true;
      }
    }
  };

  const finalize = () => {
    if (buffer) {
      lines.push(buffer);
      buffer = "";
      if (lines.length > maxLines) {
        lines.splice(0, lines.length - maxLines);
        truncated = true;
      }
    }
    return { text: lines.join("\n").trimEnd(), truncated };
  };

  return { pushChunk, finalize };
}

function shellEscape(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function buildContainerConfig(): ContainerConfig {
  return {
    image: DEFAULT_CONTAINER_IMAGE,
    resources: {
      memory: DEFAULT_CONTAINER_MEMORY,
      cpus: DEFAULT_CONTAINER_CPUS,
      timeoutSec: DEFAULT_CONTAINER_TIMEOUT_SEC,
    },
  };
}

function resolveVmRepoRootLocal(): string {
  const root = (process.env.CONTROL_CENTER_VM_REPO_ROOT || "/home/project/repo").trim();
  if (!root.startsWith("/")) {
    throw new Error(`VM repo root must be an absolute POSIX path. Got "${root}".`);
  }
  const normalized = path.posix.normalize(root);
  if (normalized.includes("..")) {
    throw new Error(`VM repo root must not include traversal segments. Got "${root}".`);
  }
  return normalized.replace(/\/+$/g, "") || "/";
}

function resolveVmAbsolutePath(remotePath: string): string {
  if (path.posix.isAbsolute(remotePath)) {
    return path.posix.normalize(remotePath);
  }
  const root = resolveVmRepoRootLocal();
  const normalized = path.posix.normalize(remotePath);
  if (normalized.includes("..")) {
    throw new Error(`VM path must not include traversal segments. Got "${remotePath}".`);
  }
  const joined = path.posix.join(root, normalized);
  if (!joined.startsWith(`${root}/`) && joined !== root) {
    throw new Error(`VM path must stay within ${root}. Got "${remotePath}".`);
  }
  return joined;
}

function buildContainerName(runId: string, label: string): string {
  const shortId = runId.slice(0, 8);
  const safeLabel = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const base = safeLabel ? `pcc-run-${shortId}-${safeLabel}` : `pcc-run-${shortId}`;
  return base.slice(0, 63);
}

function formatTestOutput(output: string, truncated: boolean, maxLines: number): string {
  const trimmed = output.trim();
  if (!trimmed) return "(no test output captured)";
  if (!truncated) return output.trimEnd();
  return `...(truncated to last ${maxLines} lines)\n${output.trimEnd()}`;
}

function buildTestFailureOutput(
  tests: Array<{ command: string; passed: boolean; output?: string }>
): string | null {
  const failures = tests.filter((t) => !t.passed);
  if (!failures.length) return null;
  return failures
    .map((test) => {
      const output = test.output?.trim();
      return `Command: ${test.command}\n${output || "(no output)"}`;
    })
    .join("\n\n");
}

function buildVmTestResults(
  tests: Array<{ command: string; passed: boolean }>
): {
  passed: boolean;
  total: number;
  failed: number;
  summary: string;
  failedTests: string[];
} {
  const total = tests.length;
  const failedTests = tests.filter((test) => !test.passed).map((test) => test.command);
  const failed = failedTests.length;
  const passedCount = Math.max(0, total - failed);
  const summary =
    total > 0
      ? `${passedCount}/${total} commands passed${failed ? `, ${failed} failed` : ""}`
      : "0/0 commands passed (no tests reported)";
  return {
    passed: failed === 0,
    total,
    failed,
    summary,
    failedTests,
  };
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
      if (entry.isDirectory() && isIgnoredRelDir(relPath)) continue;

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
      if (entry.isDirectory() && isIgnoredRelDir(rel)) continue;
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

type CommandResult = {
  status: number;
  stdout: string;
  stderr: string;
};

function spawnSyncResult(
  command: string,
  args: string[],
  opts: { cwd: string; env?: NodeJS.ProcessEnv }
): CommandResult {
  const res = spawnSync(command, args, {
    cwd: opts.cwd,
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
    env: { ...process.env, ...(opts.env || {}) },
  });

  return {
    status: res.status ?? 1,
    stdout: res.stdout || "",
    stderr: res.stderr || "",
  };
}

function runGit(
  args: string[],
  opts: { cwd: string; allowFailure?: boolean; log?: (line: string) => void }
): CommandResult {
  opts.log?.(`git ${args.join(" ")}`);
  const result = spawnSyncResult("git", args, { cwd: opts.cwd });
  if (!opts.allowFailure && result.status !== 0) {
    const message = result.stderr.trim() || result.stdout.trim() || "git failed";
    throw new Error(message);
  }
  return result;
}

function gitBranchExists(repoPath: string, branchName: string): boolean {
  const result = runGit(
    ["show-ref", "--verify", `refs/heads/${branchName}`],
    { cwd: repoPath, allowFailure: true }
  );
  return result.status === 0;
}

function resolveBaseBranch(repoPath: string, log: (line: string) => void): string {
  for (const candidate of ["main", "master"]) {
    if (gitBranchExists(repoPath, candidate)) return candidate;
  }
  const current = runGit(["rev-parse", "--abbrev-ref", "HEAD"], {
    cwd: repoPath,
    allowFailure: true,
  }).stdout.trim();
  if (current && current !== "HEAD") {
    log(`Base branch fallback to ${current}`);
    return current;
  }
  throw new Error("Unable to resolve base branch");
}

function buildRunBranchName(workOrderId: string, runId: string): string {
  const shortId = runId.replace(/-/g, "").slice(0, 8) || runId.slice(0, 8);
  const safeWorkOrder = workOrderId.replace(/[^A-Za-z0-9._-]/g, "-");
  return `run/${safeWorkOrder}-${shortId}`;
}

function resolveWorktreePaths(runDir: string) {
  const worktreePath = path.join(runDir, "worktree");
  return {
    worktreeRealPath: worktreePath,
    worktreePath,
  };
}

function ensureWorktreeLink(linkPath: string, realPath: string) {
  if (path.resolve(linkPath) === path.resolve(realPath)) return;
  ensureDir(path.dirname(linkPath));
  safeSymlink(realPath, linkPath);
}

function removeWorktreeLink(linkPath: string) {
  try {
    if (fs.lstatSync(linkPath).isSymbolicLink()) {
      fs.rmSync(linkPath, { force: true, recursive: true });
    }
  } catch {
    // ignore
  }
}

function ensureWorktree(params: {
  repoPath: string;
  worktreePath: string;
  worktreeRealPath: string;
  branchName: string;
  baseBranch: string;
  log: (line: string) => void;
}) {
  removeWorktreeLink(params.worktreePath);
  if (fs.existsSync(params.worktreeRealPath)) {
    runGit(["worktree", "remove", "--force", params.worktreeRealPath], {
      cwd: params.repoPath,
      allowFailure: true,
      log: params.log,
    });
    fs.rmSync(params.worktreeRealPath, { recursive: true, force: true });
  }

  if (gitBranchExists(params.repoPath, params.branchName)) {
    runGit(["branch", "-D", params.branchName], {
      cwd: params.repoPath,
      allowFailure: true,
      log: params.log,
    });
  }

  ensureDir(path.dirname(params.worktreeRealPath));
  runGit(
    [
      "worktree",
      "add",
      "-b",
      params.branchName,
      params.worktreeRealPath,
      params.baseBranch,
    ],
    { cwd: params.repoPath, log: params.log }
  );
  ensureWorktreeLink(params.worktreePath, params.worktreeRealPath);
}

function cleanupWorktree(params: {
  repoPath: string;
  worktreePath: string;
  worktreeRealPath: string;
  branchName: string;
  log: (line: string) => void;
}) {
  runGit(["worktree", "remove", "--force", params.worktreeRealPath], {
    cwd: params.repoPath,
    allowFailure: true,
    log: params.log,
  });
  removeWorktreeLink(params.worktreePath);
  fs.rmSync(params.worktreeRealPath, { recursive: true, force: true });
  runGit(["branch", "-d", params.branchName], {
    cwd: params.repoPath,
    allowFailure: true,
    log: params.log,
  });
}

function ensureNodeModulesSymlink(repoPath: string, worktreePath: string) {
  const source = path.join(repoPath, "node_modules");
  const dest = path.join(worktreePath, "node_modules");
  if (!fs.existsSync(source)) return;
  safeSymlink(source, dest);
}

function listUnmergedFiles(repoPath: string): string[] {
  const result = runGit(
    ["diff", "--name-only", "--diff-filter=U"],
    { cwd: repoPath, allowFailure: true }
  );
  return result.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .sort();
}

function listChangedFilesFromGit(repoPath: string, baseRef: string, headRef: string): string[] {
  const result = runGit(["diff", "--name-only", `${baseRef}...${headRef}`], {
    cwd: repoPath,
    allowFailure: true,
  });
  return result.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .sort();
}

function buildGitDiffPatch(repoPath: string, baseRef: string, headRef: string): string {
  const result = runGit(["diff", "--no-prefix", "--binary", `${baseRef}...${headRef}`], {
    cwd: repoPath,
    allowFailure: true,
  });
  return result.stdout.trim() ? `${result.stdout.trimEnd()}\n` : "";
}

function readTextIfExists(filePath: string): string {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return "";
  }
}

function readJsonIfExists<T>(filePath: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
  } catch {
    return null;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const SYNC_RETRY_BACKOFF_MS = [1000, 3000, 10000];
const SYNC_MAX_RETRIES = 3;

function formatRetryError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return message.replace(/\s+/g, " ").trim();
}

async function withRetry<T>(
  operation: () => Promise<T>,
  name: string,
  log: (line: string) => void
): Promise<T> {
  for (let attempt = 1; attempt <= SYNC_MAX_RETRIES; attempt++) {
    try {
      return await operation();
    } catch (err) {
      const detail = formatRetryError(err);
      const suffix = detail ? `: ${detail}` : "";
      const backoffMs = SYNC_RETRY_BACKOFF_MS[Math.min(attempt - 1, SYNC_RETRY_BACKOFF_MS.length - 1)];
      if (attempt === SYNC_MAX_RETRIES) {
        log(`${name} failed after ${SYNC_MAX_RETRIES} attempts${suffix}`);
        throw err;
      }
      log(`${name} failed (attempt ${attempt}/${SYNC_MAX_RETRIES})${suffix}, retrying in ${backoffMs}ms...`);
      await sleep(backoffMs);
    }
  }
  throw new Error(`${name} failed after ${SYNC_MAX_RETRIES} attempts`);
}

type EscalationInput = { key: string; label: string };
type EscalationRequest = {
  what_i_tried: string;
  what_i_need: string;
  inputs: EscalationInput[];
};
type EscalationRecord = EscalationRequest & {
  created_at: string;
  resolved_at?: string;
  resolution?: Record<string, string>;
};

function normalizeEscalationObject(value: unknown): EscalationRequest | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const whatTried =
    typeof record.what_i_tried === "string" ? record.what_i_tried.trim() : "";
  const whatNeed =
    typeof record.what_i_need === "string" ? record.what_i_need.trim() : "";
  const inputsRaw = Array.isArray(record.inputs) ? record.inputs : [];
  const inputs = inputsRaw
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const input = entry as Record<string, unknown>;
      const key = typeof input.key === "string" ? input.key.trim() : "";
      const label = typeof input.label === "string" ? input.label.trim() : "";
      if (!key || !label) return null;
      return { key, label };
    })
    .filter((entry): entry is EscalationInput => Boolean(entry));
  if (!whatTried || !whatNeed || inputs.length === 0) return null;
  return { what_i_tried: whatTried, what_i_need: whatNeed, inputs };
}

function parseEscalationPayload(raw: string): EscalationRequest | null {
  if (!raw.trim()) return null;
  let parsed: unknown;
  try {
    parsed = YAML.parse(raw);
  } catch {
    return null;
  }
  return normalizeEscalationObject(parsed);
}

function parseEscalationRecord(raw: string | null): EscalationRecord | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const base = normalizeEscalationObject(parsed);
  if (!base) return null;
  const record = parsed as Record<string, unknown>;
  const createdAt =
    typeof record.created_at === "string" ? record.created_at : "";
  if (!createdAt) return null;
  const resolvedAt =
    typeof record.resolved_at === "string" ? record.resolved_at : undefined;
  const resolutionRaw =
    record.resolution && typeof record.resolution === "object"
      ? (record.resolution as Record<string, unknown>)
      : null;
  const resolution =
    resolutionRaw &&
    Object.entries(resolutionRaw).reduce<Record<string, string>>((acc, [key, value]) => {
      if (typeof value === "string") acc[key] = value;
      return acc;
    }, {});
  return {
    ...base,
    created_at: createdAt,
    resolved_at: resolvedAt,
    resolution: resolution && Object.keys(resolution).length ? resolution : undefined,
  };
}

function getEscalationResolutionPath(runDir: string): string {
  const { worktreePath } = resolveWorktreePaths(runDir);
  return path.join(worktreePath, ESCALATION_RESOLUTION_RELATIVE_PATH);
}

function writeEscalationResolution(runDir: string, record: EscalationRecord): void {
  const resolutionPath = getEscalationResolutionPath(runDir);
  ensureDir(path.dirname(resolutionPath));
  writeJson(resolutionPath, record);
}

function findEscalationRequest(texts: Array<string | null | undefined>): EscalationRequest | null {
  for (const text of texts) {
    if (!text) continue;
    const match = text.match(ESCALATION_REGEX);
    if (!match) continue;
    const payload = parseEscalationPayload(match[1]);
    if (payload) return payload;
  }
  return null;
}

function appendEscalationBuffer(buffer: string, chunk: string): string {
  const combined = buffer + chunk;
  if (combined.length <= ESCALATION_OUTPUT_BUFFER_MAX) return combined;
  return combined.slice(combined.length - ESCALATION_OUTPUT_BUFFER_MAX);
}

function pauseChildProcess(child: ChildProcess, log?: (line: string) => void): void {
  if (process.platform === "win32") {
    throw new Error("Escalation pause/resume is not supported on Windows.");
  }
  if (child.exitCode !== null) {
    throw new Error("Builder subprocess already exited before escalation pause.");
  }
  const paused = child.kill("SIGSTOP");
  if (!paused) {
    throw new Error("Failed to pause builder subprocess for escalation.");
  }
  log?.("Paused builder subprocess for escalation input.");
}

function resumeChildProcess(child: ChildProcess, log?: (line: string) => void): void {
  if (process.platform === "win32") {
    throw new Error("Escalation pause/resume is not supported on Windows.");
  }
  if (child.exitCode !== null) {
    throw new Error("Builder subprocess exited before escalation resume.");
  }
  const resumed = child.kill("SIGCONT");
  if (!resumed) {
    throw new Error("Failed to resume builder subprocess after escalation.");
  }
  log?.("Resumed builder subprocess after escalation input.");
}

function formatEscalationContext(
  request: EscalationRequest,
  resolution?: Record<string, string>
): string {
  const lines = [
    "## Escalation Context",
    "",
    "What was tried:",
    request.what_i_tried,
    "",
    "What's needed:",
    request.what_i_need,
  ];
  if (resolution && Object.keys(resolution).length) {
    lines.push("", "User provided inputs:");
    for (const [key, value] of Object.entries(resolution)) {
      lines.push(`- ${key}: ${value}`);
    }
  }
  return `${lines.join("\n")}\n\n`;
}

async function waitForEscalationResolution(
  runId: string,
  log: (line: string) => void
): Promise<EscalationRecord | null> {
  log("Run waiting for user input");
  while (true) {
    await sleep(1000);
    const run = getRunById(runId);
    if (!run) return null;
    if (run.status === "canceled" || run.status === "failed") return null;
    const record = parseEscalationRecord(run.escalation);
    if (record?.resolved_at && record.resolution) return record;
  }
}

type CodexExecResult = {
  escalationRequested: boolean;
  escalationResolved: EscalationRecord | null;
};

function buildCodexExecArgs(params: {
  sandbox: "read-only" | "workspace-write";
  schemaPath: string;
  outputPath: string;
  skipGitRepoCheck?: boolean;
  model?: string;
  reasoningEffort?: string;
}): string[] {
  const args: string[] = ["--ask-for-approval", "never", "exec"];
  const model = params.model?.trim() || "gpt-5.2-codex";
  args.push("--model", model);

  // Enable full network access for agent runs (will be properly isolated when moved to VMs)
  args.push("-c", 'sandbox_permissions=["network-full-access"]');

  // Set reasoning effort level (xhigh for maximum thinking)
  const reasoningEffort = params.reasoningEffort?.trim() || "xhigh";
  args.push("-c", `model_reasoning_effort=${reasoningEffort}`);

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
  return args;
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
  onEscalation?: (request: EscalationRequest) => Promise<EscalationRecord | null>;
  log?: (line: string) => void;
}): Promise<CodexExecResult> {
  const args = buildCodexExecArgs({
    sandbox: params.sandbox,
    schemaPath: params.schemaPath,
    outputPath: params.outputPath,
    skipGitRepoCheck: params.skipGitRepoCheck,
    model: params.model,
  });

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

  let escalationBuffer = "";
  let escalationRequested = false;
  let escalationResolved: EscalationRecord | null = null;
  let escalationPromise: Promise<void> | null = null;
  let escalationError: Error | null = null;
  let outputSize = 0;
  let outputMtimeMs = 0;
  let outputPoller: NodeJS.Timeout | null = null;

  const startEscalation = (request: EscalationRequest) => {
    if (!params.onEscalation || escalationRequested) return;
    escalationRequested = true;
    escalationPromise = (async () => {
      try {
        pauseChildProcess(child, params.log);
        const resolved = await params.onEscalation?.(request);
        escalationResolved = resolved ?? null;
        if (!resolved) {
          if (child.exitCode === null) {
            child.kill("SIGTERM");
          }
          return;
        }
        resumeChildProcess(child, params.log);
      } catch (err) {
        escalationError = err instanceof Error ? err : new Error(String(err));
        if (child.exitCode === null) {
          child.kill("SIGTERM");
        }
      }
    })();
  };

  const handleChunk = (buf: Buffer) => {
    if (!params.onEscalation || escalationRequested) return;
    escalationBuffer = appendEscalationBuffer(escalationBuffer, buf.toString("utf8"));
    const request = findEscalationRequest([escalationBuffer]);
    if (!request) return;
    startEscalation(request);
  };

  const checkOutputFile = () => {
    if (!params.onEscalation || escalationRequested) return;
    if (child.exitCode !== null) return;
    let stat: fs.Stats;
    try {
      stat = fs.statSync(params.outputPath);
    } catch {
      return;
    }
    if (stat.size === outputSize && stat.mtimeMs === outputMtimeMs) return;
    outputSize = stat.size;
    outputMtimeMs = stat.mtimeMs;
    const outputText = readTextIfExists(params.outputPath);
    let request: EscalationRequest | null = null;
    try {
      const parsed = JSON.parse(outputText) as Record<string, unknown>;
      if (parsed && typeof parsed === "object") {
        const escalationText =
          typeof parsed.escalation === "string" ? parsed.escalation : null;
        const summaryText = typeof parsed.summary === "string" ? parsed.summary : null;
        request = findEscalationRequest([escalationText, summaryText]);
      }
    } catch {
      // ignore parse errors; fallback to raw output scan
    }
    if (!request) {
      request = findEscalationRequest([
        appendEscalationBuffer("", outputText),
      ]);
    }
    if (request) {
      startEscalation(request);
    }
  };

  child.stdout?.on("data", (buf) => {
    logStream.write(buf);
    handleChunk(buf);
  });
  child.stderr?.on("data", (buf) => {
    logStream.write(buf);
    handleChunk(buf);
  });
  if (params.onEscalation) {
    checkOutputFile();
    outputPoller = setInterval(checkOutputFile, ESCALATION_POLL_INTERVAL_MS);
  }
  child.stdin?.write(params.prompt);
  child.stdin?.end();

  const exitCode: number = await new Promise((resolve) => {
    child.on("close", (code) => resolve(code ?? 1));
    child.on("error", () => resolve(1));
  });

  if (outputPoller) {
    clearInterval(outputPoller);
  }

  if (escalationPromise) {
    await escalationPromise;
  }

  logStream.write(`[${nowIso()}] codex exec end exit=${exitCode}\n`);
  logStream.end();

  if (escalationError) {
    throw escalationError;
  }

  if (exitCode !== 0) {
    throw new Error(`codex exec failed (exit ${exitCode})`);
  }

  return { escalationRequested, escalationResolved };
}

type RemoteCodexExecParams = {
  projectId: string;
  runId: string;
  workspacePath: string;
  artifactsDir: string;
  localPromptPath: string;
  localSchemaPath: string;
  localOutputPath: string;
  localLogPath: string;
  sandbox: "read-only" | "workspace-write";
  skipGitRepoCheck?: boolean;
  model?: string;
  containerConfig: ContainerConfig;
  containerName: string;
  workingDir?: string;
  log?: (line: string) => void;
};

const DOCKER_FALLBACK_PATTERNS = [
  /Cannot connect to the Docker daemon/i,
  /docker: command not found/i,
  /Is the docker daemon running/i,
  /permission denied/i,
];

class ContainerFallbackError extends Error {
  reason: string;

  constructor(reason: string) {
    super(reason);
    this.reason = reason;
  }
}

function summarizeExecOutput(result: ExecResult): string {
  const combined = `${result.stderr}\n${result.stdout}`.trim();
  if (!combined) return "unknown error";
  return combined.replace(/\s+/g, " ").slice(0, 200);
}

function buildCodexShellCommand(cmd: string, args: string[], promptPath: string): string {
  const argString = args.map(shellEscape).join(" ");
  return `cat ${shellEscape(promptPath)} | ${cmd} ${argString}`;
}

async function checkDockerRuntime(projectId: string): Promise<{ ok: boolean; detail?: string }> {
  const result = await remoteExec(projectId, "docker info >/dev/null 2>&1", {
    allowFailure: true,
    timeout: 15000,
  });
  if (result.exitCode === 0) return { ok: true };
  const detail = summarizeExecOutput(result);
  return { ok: false, detail };
}

function shouldFallbackFromContainer(result: ExecResult): string | null {
  if (result.exitCode === 125) {
    return `docker run failed: ${summarizeExecOutput(result)}`;
  }
  const combined = `${result.stderr}\n${result.stdout}`;
  if (DOCKER_FALLBACK_PATTERNS.some((pattern) => pattern.test(combined))) {
    return `docker run failed: ${summarizeExecOutput(result)}`;
  }
  return null;
}

function isCodexMissingInContainer(result: ExecResult): boolean {
  if (result.exitCode !== 127) return false;
  const combined = `${result.stderr}\n${result.stdout}`;
  return /codex: not found/i.test(combined) || /codex.*not found/i.test(combined);
}

async function runCodexExecInContainer(params: {
  projectId: string;
  containerName: string;
  image: string;
  workspacePath: string;
  artifactsDir: string;
  env: Record<string, string>;
  resources: ContainerResourceLimits;
  command: string;
  workingDir?: string;
}): Promise<ExecResult> {
  const workspaceHostPath = resolveVmAbsolutePath(params.workspacePath);
  const artifactsHostPath = resolveVmAbsolutePath(params.artifactsDir);
  const workingDir = params.workingDir?.trim() || "/workspace";

  // Get SSH user for home directory path on VM
  const sshUser = process.env.CONTROL_CENTER_GCP_SSH_USER?.trim() || "cdossman";
  const codexAuthPath = `/home/${sshUser}/.codex`;

  // When running as non-root user, use /workspace as HOME (always exists and writable)
  const containerHome = "/workspace";
  const mountFlags = [
    `-v ${shellEscape(`${workspaceHostPath}:/workspace`)}`,
    `-v ${shellEscape(`${artifactsHostPath}:/artifacts`)}`,
    // Mount codex auth directory to workspace (writable by non-root user)
    `-v ${shellEscape(`${codexAuthPath}:${containerHome}/.codex`)}`,
  ];

  // Set HOME so codex finds its config in the writable location
  const envFlags = [
    `-e HOME=${containerHome}`,
    ...Object.entries(params.env)
      .filter(([key]) => ENV_KEY_PATTERN.test(key))
      .map(([key, value]) => `-e ${key}=${shellEscape(value)}`),
  ];

  const resourceFlags: string[] = [];
  if (params.resources.cpus > 0) resourceFlags.push(`--cpus=${params.resources.cpus}`);
  if (params.resources.memory.trim())
    resourceFlags.push(`--memory=${shellEscape(params.resources.memory.trim())}`);

  const dockerCmd = [
    "docker run --rm",
    `--name ${shellEscape(params.containerName)}`,
    "--network host",
    "--user $(id -u):$(id -g)",  // Run as host user to avoid root-owned files
    ...resourceFlags,
    ...mountFlags,
    ...envFlags,
    `-w ${shellEscape(workingDir)}`,
    shellEscape(params.image),
    "sh -lc",
    shellEscape(params.command),
  ].join(" ");

  // Debug: Log env flags (mask the actual key value)
  const maskedEnvFlags = envFlags.map((f) => f.replace(/='.+'/, "='***'"));
  console.log(`[DEBUG] Docker env flags: ${maskedEnvFlags.join(" ")}`);

  try {
    return await remoteExec(params.projectId, dockerCmd, {
      allowFailure: true,
      timeout: Math.round(params.resources.timeoutSec * 1000),
    });
  } finally {
    await remoteExec(params.projectId, `docker rm -f ${shellEscape(params.containerName)}`, {
      allowFailure: true,
    });
  }
}

async function runCodexExecRemote(params: RemoteCodexExecParams): Promise<CodexExecResult> {
  params.log?.(
    `Running codex in container ${params.containerName} (${params.containerConfig.image})`
  );
  const promptName = path.posix.basename(params.localPromptPath);
  const schemaName = path.posix.basename(params.localSchemaPath);
  const outputName = path.posix.basename(params.localOutputPath);
  const remotePromptPath = path.posix.join(params.artifactsDir, promptName);
  const remoteSchemaPath = path.posix.join(params.artifactsDir, schemaName);
  const remoteOutputPath = path.posix.join(params.artifactsDir, outputName);

  await remoteExec(
    params.projectId,
    `mkdir -p ${shellEscape(params.artifactsDir)}`,
    { cwd: "." }
  );
  await remoteUpload(params.projectId, params.localPromptPath, remotePromptPath);
  await remoteUpload(params.projectId, params.localSchemaPath, remoteSchemaPath);

  const env = {
    OPENAI_API_KEY: process.env.OPENAI_API_KEY || "",
  };

  // Debug: log API key status
  params.log?.(`[DEBUG] OPENAI_API_KEY length: ${env.OPENAI_API_KEY.length}`);

  ensureDir(path.dirname(params.localLogPath));
  const logStream = fs.createWriteStream(params.localLogPath, { flags: "a" });
  logStream.write(`[${nowIso()}] codex exec start (${params.sandbox})\n`);

  let logFinalized = false;
  const writeExecOutput = (result: ExecResult) => {
    if (result.stdout) logStream.write(result.stdout);
    if (result.stderr) logStream.write(result.stderr);
  };
  const finalizeLog = (exitCode: number, note?: string, result?: ExecResult) => {
    if (logFinalized) return;
    if (result) writeExecOutput(result);
    if (note) logStream.write(`[${nowIso()}] ${note}\n`);
    logStream.write(`[${nowIso()}] codex exec end exit=${exitCode}\n`);
    logStream.end();
    logFinalized = true;
  };

  try {
    const dockerReady = await checkDockerRuntime(params.projectId);
    if (!dockerReady.ok) {
      const reason = dockerReady.detail
        ? `docker unavailable: ${dockerReady.detail}`
        : "docker unavailable";
      finalizeLog(1, `container fallback: ${reason}`);
      throw new ContainerFallbackError(reason);
    }

    const codexArgs = buildCodexExecArgs({
      sandbox: params.sandbox,
      schemaPath: `/artifacts/${schemaName}`,
      outputPath: `/artifacts/${outputName}`,
      skipGitRepoCheck: params.skipGitRepoCheck,
      model: params.model,
    });
    const command = buildCodexShellCommand("codex", codexArgs, `/artifacts/${promptName}`);

    const containerResult = await runCodexExecInContainer({
      projectId: params.projectId,
      containerName: params.containerName,
      image: params.containerConfig.image,
      workspacePath: params.workspacePath,
      artifactsDir: params.artifactsDir,
      env,
      resources: params.containerConfig.resources,
      command,
      workingDir: params.workingDir,
    });

    if (isCodexMissingInContainer(containerResult)) {
      finalizeLog(containerResult.exitCode, undefined, containerResult);
      throw new Error("codex CLI missing inside container");
    }

    const fallbackReason = shouldFallbackFromContainer(containerResult);
    if (fallbackReason) {
      finalizeLog(containerResult.exitCode, `container fallback: ${fallbackReason}`, containerResult);
      throw new ContainerFallbackError(fallbackReason);
    }

    finalizeLog(containerResult.exitCode, undefined, containerResult);

    if (containerResult.exitCode !== 0) {
      throw new Error(`codex exec failed (exit ${containerResult.exitCode})`);
    }
  } catch (err) {
    if (!logFinalized) {
      finalizeLog(1);
    }
    throw err;
  }

  await remoteDownload(params.projectId, remoteOutputPath, params.localOutputPath);

  return { escalationRequested: false, escalationResolved: null };
}

function builderSchema(): object {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      summary: { type: "string" },
      risks: { type: "array", items: { type: "string" } },
      escalation: { type: "string" },
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
      changes: {
        type: "array",
        items: {
          // Note: OpenAI requires all properties in required array when additionalProperties: false
          type: "object",
          additionalProperties: false,
          properties: {
            file: { type: "string" },
            type: { type: "string", enum: ["wo_implementation", "blocking_fix"] },
            reason: { type: "string" },
          },
          required: ["file", "type", "reason"],
        },
      },
    },
    // Note: OpenAI requires all properties in required array when additionalProperties: false
    required: ["summary", "risks", "escalation", "tests", "changes"],
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

function logConstitutionSelection(
  log: (line: string) => void,
  context: string,
  selection: ConstitutionSelection
) {
  if (!selection.content.trim()) {
    log(`[constitution] ${context}: none found, proceeding without`);
    return;
  }
  const sections = selection.sectionTitles.length
    ? selection.sectionTitles.join(", ")
    : "(none)";
  const strategy = selection.usedSelection ? "selected" : "full";
  const truncated = selection.truncated ? " truncated" : "";
  log(
    `[constitution] ${context}: injecting ${selection.content.length} chars (${strategy}${truncated}); sections: ${sections}`
  );
}

function loadWorkOrder(repoPath: string, workOrderId: string): WorkOrder {
  const all = listWorkOrders(repoPath);
  const found = all.find((w) => w.id === workOrderId);
  if (!found) throw new Error("Work Order not found");
  return found;
}

function formatIterationHistory(
  history: RunIterationHistoryEntry[],
  currentIteration: number
): string {
  // Only include completed iterations (not the current one)
  const completed = history.filter((h) => h.iteration < currentIteration);
  if (completed.length === 0) return "";

  const lines: string[] = ["## Previous Iterations\n"];
  for (const entry of completed) {
    lines.push(`### Iteration ${entry.iteration}`);
    if (entry.builder_summary) {
      lines.push(`**Builder:** ${entry.builder_summary}`);
    }
    if (entry.tests.length > 0) {
      const testStatus = entry.tests.every((t) => t.passed)
        ? "✓ passed"
        : "✗ failed";
      lines.push(`**Tests:** ${testStatus}`);
    }
    if (entry.reviewer_verdict) {
      lines.push(`**Reviewer:** ${entry.reviewer_verdict}`);
      if (entry.reviewer_notes && entry.reviewer_notes.length > 0) {
        for (const note of entry.reviewer_notes) {
          lines.push(`- ${note}`);
        }
      }
    }
    lines.push("");
  }
  return lines.join("\n") + "\n";
}

function buildBuilderPrompt(params: {
  workOrderMarkdown: string;
  workOrder: WorkOrder;
  iteration: number;
  maxIterations: number;
  reviewerFeedback?: string;
  testFailureOutput?: string | null;
  constitution?: string;
  iterationHistory?: RunIterationHistoryEntry[];
  escalationContext?: EscalationRecord | null;
}) {
  const feedback = params.reviewerFeedback?.trim();
  const testFailureOutput = params.testFailureOutput?.trim();
  const constitutionBlock = formatConstitutionBlock(params.constitution ?? "");
  const iterationLine = `This is iteration ${params.iteration} of ${params.maxIterations}.\n\n`;
  const historyBlock = formatIterationHistory(
    params.iterationHistory ?? [],
    params.iteration
  );
  const escalationContextBlock = params.escalationContext
    ? formatEscalationContext(
        params.escalationContext,
        params.escalationContext.resolution
      )
    : "";
  const failureBlock = testFailureOutput
    ? `## Previous Attempt Failed\n\n` +
      `Your previous implementation failed tests. Here's the output:\n\n` +
      "```\n" +
      `${testFailureOutput}\n` +
      "```\n\n" +
      "Please analyze the failure and fix the issues.\n\n"
    : "";
  const resourcefulPostureBlock =
    `## Completing Tasks (Resourceful Posture)\n\n` +
    `Your default stance is: "I can do this."\n\n` +
    `When you encounter a task - including external services, account creation, API setup:\n\n` +
    `1. **Attempt it** - Use browser automation, APIs, available tools. Actually try.\n\n` +
    `2. **Be resourceful** - If one approach doesn't work, try another:\n` +
    `   - Need an account? Create an email, sign up.\n` +
    `   - Need verification? Look for alternatives.\n` +
    `   - Hit a wall? Try a different angle.\n\n` +
    `3. **Never fabricate completions**:\n` +
    `   - No fake URLs, invite links, or endpoints\n` +
    `   - No invented IDs, API keys, or credentials\n` +
    `   - No marking tasks "complete" without actually completing them\n` +
    `   - Fabricating completions is a critical safety violation\n\n` +
    `4. **Fail honestly** - If you genuinely tried and couldn't complete something:\n` +
    `   - Say what you attempted\n` +
    `   - Explain what blocked you\n` +
    `   - Don't pretend it's done\n\n` +
    `5. **Escalate only when genuinely stuck** - After trying multiple approaches, you can request user help (see escalation format). But exhaust reasonable options first.\n\n` +
    `The industry is moving toward agent-friendly interfaces. Don't assume things are impossible. Try first, be creative, be persistent.\n\n`;
  const escalationRuntimeBlock =
    `## Escalation Runtime\n\n` +
    `If you must request help:\n` +
    `- Immediately emit the escalation block below to stdout (use a shell command like printf if needed) so the runner can pause you.\n` +
    `- Then wait for ${ESCALATION_RESOLUTION_RELATIVE_PATH} to appear.\n` +
    `- After resume, read the JSON file and use its "resolution" values to continue from where you paused.\n` +
    `- Do not exit while waiting for input.\n\n`;
  // Note: We use markers with spaces (< < < and > > >) in the example to avoid
  // the escalation regex matching the example itself from the prompt in the log.
  const escalationFormatBlock =
    `## Escalation Format\n\n` +
    `If you are genuinely stuck after exhausting reasonable options, include the following block inside the "escalation" field of your JSON output:\n\n` +
    `\`\`\`\n` +
    `< < <NEED_HELP> > >\n` +
    `what_i_tried: |\n` +
    `  1. Describe what you tried\n` +
    `what_i_need: |\n` +
    `  Describe what you need from the user\n` +
    `inputs:\n` +
    `  - key: some_key\n` +
    `    label: Human-readable label\n` +
    `< < <END_HELP> > >\n` +
    `\`\`\`\n\n` +
    `Replace the spaces in the markers: \`< < <NEED_HELP> > >\` becomes \`<<<NEED_HELP>>>\` (no spaces).\n\n` +
    `When escalating, still output valid JSON and keep summary/risks/tests populated (use empty arrays if needed).\n\n`;
  return `You are the Builder agent.\n\n` +
    constitutionBlock +
    `Task: Implement the Work Order in this repository.\n\n` +
    `Rules:\n` +
    `- Follow the Work Order contract (goal + acceptance criteria + stop conditions).\n` +
    `- Implement only what is needed for this Work Order.\n` +
    `- Do NOT edit the Work Order file itself.\n` +
    `- Prefer minimal, high-quality changes; update docs/tests if needed.\n` +
    `- Learn from previous iteration feedback - do not repeat the same mistakes.\n` +
    `\n` +
    `## Change Classification\n` +
    `For each file you modify, classify the change with type and reason:\n` +
    `- wo_implementation: Directly implements the Work Order (reason can be brief, e.g. "implements WO")\n` +
    `- blocking_fix: Fixes an issue that blocks WO completion (reason must explain WHY it's necessary)\n` +
    `For blocking_fix changes, the reason must explain:\n` +
    `- What breaks without this fix?\n` +
    `- Why can't the WO be completed without it?\n` +
    `Only use blocking_fix for genuine blockers, not nice-to-have improvements.\n` +
    `\n` +
    `- At the end, output a JSON object matching the required schema.\n\n` +
    resourcefulPostureBlock +
    escalationRuntimeBlock +
    escalationFormatBlock +
    iterationLine +
    historyBlock +
    failureBlock +
    escalationContextBlock +
    (feedback ? `Reviewer feedback to address:\n${feedback}\n\n` : "") +
    `Work Order (${params.workOrder.id}):\n\n` +
    `${params.workOrderMarkdown}\n`;
}

function buildReviewerPrompt(params: {
  workOrderId: string;
  workOrderMarkdown: string;
  diffPatch: string;
  constitution?: string;
  builderChanges?: BuilderChange[];
  builderChangesPath?: string;
  vmTestResults?: {
    passed: boolean;
    total: number;
    failed: number;
    summary: string;
    failedTests: string[];
  };
}) {
  const constitutionBlock = formatConstitutionBlock(params.constitution ?? "");
  const builderChanges = params.builderChanges ?? [];
  const builderChangesPath = params.builderChangesPath?.trim();
  const builderChangesLines = builderChanges.length
    ? builderChanges.map((change) => {
        const label =
          change.type === "blocking_fix"
            ? `blocking_fix: ${change.reason || "(reason missing)"}`
            : "wo_implementation";
        return `- ${change.file} (${label})`;
      })
    : ["- (no change classifications available)"];
  const builderChangesBlock =
    builderChanges.length || builderChangesPath
      ? `## Builder Change Classification\n` +
        `${builderChangesLines.join("\n")}\n` +
        (builderChangesPath ? `\nBuilder output file: ${builderChangesPath}\n` : "") +
        `\n`
      : "";
  const vmTests = params.vmTestResults;
  const vmTestsBlock = vmTests
    ? `## Test Results (VM)\n` +
      `Tests were executed on the VM and ${vmTests.passed ? "**passed**" : "**failed**"}: ${vmTests.summary}\n` +
      (vmTests.failedTests.length
        ? `Failed tests:\n${vmTests.failedTests.map((name) => `- ${name}`).join("\n")}\n`
        : "") +
      `\n` +
      `Note: Builder's local test attempt may show failures due to Codex sandbox restrictions (e.g., EPERM on port binding). The VM results above are authoritative.\n\n`
    : "";
  return (
    `You are a fresh Reviewer agent.\n\n` +
    constitutionBlock +
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
    builderChangesBlock +
    vmTestsBlock +
    `## Evaluating Blocking Fixes\n` +
    `When builder claims a change is a "blocking_fix":\n` +
    `1. Verify the claim - is it actually blocking?\n` +
    `   - Would tests fail without this change?\n` +
    `   - Is there a type error or import issue?\n` +
    `2. Check the reason - does it make sense?\n` +
    `   - Is the explanation specific and verifiable?\n` +
    `   - Can you confirm by inspection?\n` +
    `3. Decide:\n` +
    `   - If legitimate blocker -> allow\n` +
    `   - If disguised scope creep -> reject with note: "This doesn't appear to be a true blocker because..."\n\n` +
    `Work Order (${params.workOrderId}):\n\n` +
    `${params.workOrderMarkdown}\n\n` +
    `Diff:\n\n` +
      `${params.diffPatch}\n`
  );
}

function buildConflictResolutionPrompt(params: {
  currentRunId: string;
  currentWorkOrderId: string;
  currentWorkOrderMarkdown: string;
  currentSummary: string;
  currentDiff: string;
  conflictingRunId: string | null;
  conflictingWorkOrderId: string | null;
  conflictingWorkOrderMarkdown: string;
  conflictingSummary: string;
  conflictingDiff: string;
  conflictFiles: string[];
  gitConflictOutput: string;
}) {
  const conflictList = params.conflictFiles.length
    ? params.conflictFiles.map((f) => `- ${f}`).join("\n")
    : "- (none detected)";
  const conflictingLabel = params.conflictingWorkOrderId
    ? `${params.conflictingWorkOrderId}${params.conflictingRunId ? ` (${params.conflictingRunId})` : ""}`
    : params.conflictingRunId
      ? params.conflictingRunId
      : "unknown";
  return (
    `You are resolving a merge conflict.\n\n` +
    `Your run (${params.currentWorkOrderId}, ${params.currentRunId}): ${params.currentSummary}\n` +
    `Conflicting run (${conflictingLabel}): ${params.conflictingSummary}\n\n` +
    `Conflicting files:\n${conflictList}\n\n` +
    `Git conflict output:\n${params.gitConflictOutput || "(no conflict output captured)"}\n\n` +
    `Your task:\n` +
    `- Understand both intents\n` +
    `- Resolve the conflict preserving both goals where possible\n` +
    `- If goals are mutually exclusive, preserve the higher-priority Work Order's intent\n` +
    `- Document your resolution reasoning in the summary\n\n` +
    `## Change Classification\n` +
    `For each file you modify, classify the change with type and reason:\n` +
    `- wo_implementation: Directly implements the Work Order (reason can be brief, e.g. "implements WO")\n` +
    `- blocking_fix: Required to resolve the conflict or unblock the merge (reason must explain WHY)\n\n` +
    `Current Work Order:\n\n${params.currentWorkOrderMarkdown}\n\n` +
    `Conflicting Work Order:\n\n${params.conflictingWorkOrderMarkdown}\n\n` +
    `Current diff:\n\n${params.currentDiff || "(no diff available)"}\n\n` +
    `Conflicting diff:\n\n${params.conflictingDiff || "(no diff available)"}\n`
  );
}

type ConflictContext = {
  currentRun: {
    id: string;
    workOrder: WorkOrder;
    diff: string;
    builderSummary: string;
  };
  conflictingRun: {
    id: string;
    workOrder: WorkOrder | null;
    diff: string;
    builderSummary: string;
    mergedAt: string;
  } | null;
  conflictFiles: string[];
  gitConflictOutput: string;
};

type BuilderChangeType = "wo_implementation" | "blocking_fix";

type BuilderChange = {
  file: string;
  type: BuilderChangeType;
  reason?: string;
};

type RunIterationHistoryEntry = {
  iteration: number;
  builder_summary: string | null;
  builder_risks: string[];
  builder_changes?: BuilderChange[];
  tests: Array<{ command: string; passed: boolean; output: string }>;
  reviewer_verdict: "approved" | "changes_requested" | null;
  reviewer_notes: string[] | null;
};

function normalizeBuilderChanges(value: unknown): BuilderChange[] {
  if (!Array.isArray(value)) return [];
  const changes: BuilderChange[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const record = item as { file?: unknown; type?: unknown; reason?: unknown };
    const file = typeof record.file === "string" ? record.file.trim() : "";
    const type =
      record.type === "wo_implementation" || record.type === "blocking_fix"
        ? record.type
        : null;
    if (!file || !type) continue;
    const reason = typeof record.reason === "string" ? record.reason.trim() : "";
    if (type === "blocking_fix" && !reason) continue;
    const change: BuilderChange = { file, type };
    if (reason) change.reason = reason;
    changes.push(change);
  }
  return changes;
}

function buildConflictContext(params: {
  repoPath: string;
  runId: string;
  runDir: string;
  workOrder: WorkOrder;
  approvedSummary: string | null;
  conflictFiles: string[];
  gitConflictOutput: string;
  conflictingRun?: { run: RunRow; runDir: string } | null;
}): {
  conflictContext: ConflictContext;
  currentDiff: string;
  conflictingRunId: string | null;
  conflictingWorkOrderId: string | null;
  conflictingWorkOrderMarkdown: string;
  conflictingSummary: string;
  conflictingDiff: string;
} {
  const currentDiff = readTextIfExists(path.join(params.runDir, "diff.patch"));
  const conflictingRun =
    params.conflictingRun ??
    findConflictingRun({
      repoPath: params.repoPath,
      currentRunId: params.runId,
      conflictFiles: params.conflictFiles,
    });
  const conflictingRunId = conflictingRun?.run.id ?? null;
  const conflictingWorkOrderId = conflictingRun?.run.work_order_id ?? null;
  const conflictingSummary =
    conflictingRun?.run.summary || "(summary unavailable)";
  let conflictingWorkOrderMarkdown = "";
  if (conflictingRun) {
    conflictingWorkOrderMarkdown = readTextIfExists(
      path.join(conflictingRun.runDir, "work_order.md")
    );
    if (!conflictingWorkOrderMarkdown && conflictingWorkOrderId) {
      try {
        conflictingWorkOrderMarkdown = readWorkOrderMarkdown(
          params.repoPath,
          conflictingWorkOrderId
        );
      } catch {
        // ignore
      }
    }
  }
  if (!conflictingWorkOrderMarkdown) {
    conflictingWorkOrderMarkdown = "(conflicting work order not found)";
  }
  const conflictingDiff = conflictingRun
    ? readTextIfExists(path.join(conflictingRun.runDir, "diff-merge.patch")) ||
      readTextIfExists(path.join(conflictingRun.runDir, "diff.patch"))
    : "";

  const conflictContext: ConflictContext = {
    currentRun: {
      id: params.runId,
      workOrder: params.workOrder,
      diff: currentDiff,
      builderSummary: params.approvedSummary || "(no summary)",
    },
    conflictingRun: conflictingRun
      ? {
          id: conflictingRun.run.id,
          workOrder: (() => {
            try {
              return loadWorkOrder(params.repoPath, conflictingRun.run.work_order_id);
            } catch {
              return null;
            }
          })(),
          diff: conflictingDiff,
          builderSummary: conflictingSummary,
          mergedAt: conflictingRun.run.finished_at || conflictingRun.run.created_at,
        }
      : null,
    conflictFiles: params.conflictFiles,
    gitConflictOutput: params.gitConflictOutput,
  };

  return {
    conflictContext,
    currentDiff,
    conflictingRunId,
    conflictingWorkOrderId,
    conflictingWorkOrderMarkdown,
    conflictingSummary,
    conflictingDiff,
  };
}

function loadRunFilesChanged(runDir: string): string[] {
  const merged = readJsonIfExists<string[]>(
    path.join(runDir, "files_changed.merge.json")
  );
  if (Array.isArray(merged)) return merged;
  const original = readJsonIfExists<string[]>(
    path.join(runDir, "files_changed.json")
  );
  if (Array.isArray(original)) return original;
  return [];
}

function findConflictingRun(params: {
  repoPath: string;
  currentRunId: string;
  conflictFiles: string[];
}): { run: RunRow; runDir: string } | null {
  if (!params.conflictFiles.length) return null;
  const runsRoot = path.join(params.repoPath, ".system", "runs");
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(runsRoot, { withFileTypes: true });
  } catch {
    return null;
  }

  const conflictSet = new Set(params.conflictFiles);
  const candidates: Array<{ run: RunRow; runDir: string }> = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const runId = entry.name;
    if (runId === params.currentRunId) continue;
    const runDir = path.join(runsRoot, runId);
    const changedFiles = loadRunFilesChanged(runDir);
    if (!changedFiles.some((file) => conflictSet.has(file))) continue;
    const run = getRunById(runId);
    if (!run) continue;
    candidates.push({ run, runDir });
  }

  if (!candidates.length) return null;
  const preferred = candidates.filter(
    (c) =>
      c.run.merge_status === "merged" ||
      c.run.status === "you_review" ||
      c.run.status === "merged"
  );
  const pool = preferred.length ? preferred : candidates;
  pool.sort((a, b) => {
    const aTime = a.run.finished_at || a.run.started_at || a.run.created_at;
    const bTime = b.run.finished_at || b.run.started_at || b.run.created_at;
    return bTime.localeCompare(aTime);
  });
  return pool[0] || null;
}

function getTestScriptInfo(repoPath: string): { hasTests: boolean; message: string } {
  const pkgPath = path.join(repoPath, "package.json");
  if (!fs.existsSync(pkgPath)) {
    return { hasTests: false, message: "No package.json found." };
  }

  let pkg: unknown;
  try {
    pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  } catch {
    return { hasTests: false, message: "package.json unreadable; skipping." };
  }

  const scripts =
    typeof pkg === "object" && pkg && "scripts" in pkg
      ? (pkg as { scripts?: Record<string, string> }).scripts
      : undefined;
  const hasTest = !!scripts?.test;
  if (!hasTest) {
    return { hasTests: false, message: "No test script; skipping." };
  }

  return { hasTests: true, message: "test script present" };
}

async function runRepoTests(
  repoPath: string,
  runDir: string,
  iteration: number,
  options?: { logPath?: string; label?: string }
) {
  const testInfo = getTestScriptInfo(repoPath);
  if (!testInfo.hasTests) {
    return [{ command: "(no tests)", passed: true, output: testInfo.message }];
  }

  const logPath = options?.logPath ?? path.join(runDir, "tests", "npm-test.log");
  const label = options?.label ?? "npm test";
  ensureDir(path.dirname(logPath));
  const logStream = fs.createWriteStream(logPath, { flags: "a" });
  logStream.write(`[${nowIso()}] ${label} start (iter ${iteration})\n`);
  const outputCapture = createOutputCapture(MAX_TEST_OUTPUT_LINES);

  const child = spawn(npmCommand(), ["test"], {
    cwd: repoPath,
    env: {
      ...process.env,
      CI: "1",
      NEXT_DIST_DIR: ".system/next-run-tests",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.stdout?.on("data", (buf) => {
    logStream.write(buf);
    outputCapture.pushChunk(buf);
  });
  child.stderr?.on("data", (buf) => {
    logStream.write(buf);
    outputCapture.pushChunk(buf);
  });

  const exitCode: number = await new Promise((resolve) => {
    child.on("close", (code) => resolve(code ?? 1));
    child.on("error", () => resolve(1));
  });

  const captured = outputCapture.finalize();
  const outputTail = formatTestOutput(
    captured.text,
    captured.truncated,
    MAX_TEST_OUTPUT_LINES
  );

  logStream.write(`[${nowIso()}] ${label} end exit=${exitCode}\n`);
  logStream.end();

  return [
    {
      command: "npm test",
      passed: exitCode === 0,
      output: outputTail,
    },
  ];
}

type RemoteRunConfig = {
  projectId: string;
  workspacePath: string;
  artifactsPath: string;
};

function buildRemoteRunPaths(runId: string): { workspacePath: string; artifactsPath: string } {
  return {
    workspacePath: path.posix.join(REMOTE_RUN_WORKSPACES_ROOT, runId),
    artifactsPath: path.posix.join(REMOTE_RUN_ARTIFACTS_ROOT, runId),
  };
}

async function prepareRemoteRun(config: RemoteRunConfig, log: (line: string) => void) {
  log(`Preparing remote run workspace at ${config.workspacePath}`);
  await remoteExec(config.projectId, `rm -rf ${shellEscape(config.workspacePath)} ${shellEscape(config.artifactsPath)}`, {
    cwd: ".",
    allowFailure: true,
  });
  await remoteExec(
    config.projectId,
    `mkdir -p ${shellEscape(config.workspacePath)} ${shellEscape(config.artifactsPath)} ${shellEscape(
      path.posix.join(config.artifactsPath, "tests")
    )}`,
    { cwd: "." }
  );
}

async function syncRemoteWorkspaceFiles(
  config: RemoteRunConfig,
  localPath: string,
  log: (line: string) => void
) {
  log(`Syncing worktree to VM workspace ${config.workspacePath}`);
  await withRetry(
    () => remoteUpload(config.projectId, localPath, config.workspacePath, {
      allowDelete: true,
    }),
    "remote upload",
    log
  );
}

async function syncRemoteWorkspaceToLocal(
  config: RemoteRunConfig,
  localPath: string,
  log: (line: string) => void
) {
  log(`Syncing VM workspace ${config.workspacePath} back to worktree`);
  await withRetry(
    () => remoteDownload(config.projectId, config.workspacePath, localPath, {
      allowDelete: true,
    }),
    "remote download",
    log
  );
}

async function cleanupRemoteRun(config: RemoteRunConfig, log: (line: string) => void) {
  log(`Cleaning up remote run workspace at ${config.workspacePath}`);
  await remoteExec(config.projectId, `rm -rf ${shellEscape(config.workspacePath)} ${shellEscape(config.artifactsPath)}`, {
    cwd: ".",
    allowFailure: true,
  });
}

async function syncRemoteWorkspace(
  config: RemoteRunConfig,
  localPath: string,
  log: (line: string) => void
) {
  await syncRemoteWorkspaceFiles(config, localPath, log);
  log(`Installing dependencies in VM workspace...`);
  await remoteExec(config.projectId, "npm ci", {
    cwd: config.workspacePath,
    allowAbsolute: true,
  });
  log(`Installing Playwright browsers...`);
  await remoteExec(config.projectId, "npx playwright install chromium", {
    cwd: config.workspacePath,
    allowAbsolute: true,
  });
}

async function runRemoteTests(params: {
  repoPath: string;
  runDir: string;
  iteration: number;
  runId: string;
  remote: RemoteRunConfig;
  logPath?: string;
  labelPrefix?: string;
}) {
  const testInfo = getTestScriptInfo(params.repoPath);
  if (!testInfo.hasTests) {
    return [{ command: "(no tests)", passed: true, output: testInfo.message }];
  }

  const logPath = params.logPath ?? path.join(params.runDir, "tests", "npm-test.log");
  const labelPrefix = params.labelPrefix ? `${params.labelPrefix} ` : "";
  ensureDir(path.dirname(logPath));
  const logStream = fs.createWriteStream(logPath, { flags: "a" });
  const portOffset = getPortOffset(params.runId);
  const env = {
    CI: "1",
    NEXT_DIST_DIR: ".system/next-run-tests",
    E2E_WEB_PORT: String(E2E_WEB_PORT_BASE + portOffset),
    E2E_OFFLINE_WEB_PORT: String(E2E_OFFLINE_WEB_PORT_BASE + portOffset),
    E2E_API_PORT: String(E2E_API_PORT_BASE + portOffset),
  };

  const runRemoteCommand = async (label: string, command: string) => {
    logStream.write(`[${nowIso()}] ${labelPrefix}${label} start (iter ${params.iteration})\n`);
    const result = await remoteExec(params.remote.projectId, command, {
      cwd: params.remote.workspacePath,
      env,
      allowFailure: true,
      timeout: REMOTE_TEST_TIMEOUT_MS,
    });

    if (result.stdout) logStream.write(result.stdout);
    if (result.stderr) logStream.write(result.stderr);
    logStream.write(`[${nowIso()}] ${labelPrefix}${label} end exit=${result.exitCode}\n`);

    const outputCapture = createOutputCapture(MAX_TEST_OUTPUT_LINES);
    outputCapture.pushChunk(Buffer.from(result.stdout));
    outputCapture.pushChunk(Buffer.from(result.stderr));
    const captured = outputCapture.finalize();

    return {
      exitCode: result.exitCode,
      output: formatTestOutput(captured.text, captured.truncated, MAX_TEST_OUTPUT_LINES),
    };
  };

  try {
    const ciResult = await runRemoteCommand("npm ci", "npm ci");
    if (ciResult.exitCode !== 0) {
      return [{ command: "npm ci", passed: false, output: ciResult.output }];
    }

    const testResult = await runRemoteCommand("npm test", "npm test");
    return [
      { command: "npm ci", passed: true, output: ciResult.output },
      { command: "npm test", passed: testResult.exitCode === 0, output: testResult.output },
    ];
  } finally {
    logStream.end();
  }
}

async function remoteDirExists(
  config: RemoteRunConfig,
  cwd: string,
  dirName: string
): Promise<boolean> {
  const result = await remoteExec(config.projectId, `test -d ${shellEscape(dirName)}`, {
    cwd,
    allowFailure: true,
  });
  return result.exitCode === 0;
}

function buildRemoteTestArtifactsRoot(remote: RemoteRunConfig, iteration: number): string {
  return path.posix.join(remote.artifactsPath, "tests", `iter-${iteration}`);
}

function buildLocalTestArtifactsRoot(runDir: string, iteration: number): string {
  return path.join(runDir, "tests", "artifacts", `iter-${iteration}`);
}

function copyLocalTestArtifacts(params: {
  worktreePath: string;
  runDir: string;
  iteration: number;
  log: (line: string) => void;
}) {
  const artifactsRoot = buildLocalTestArtifactsRoot(params.runDir, params.iteration);
  let wroteAny = false;

  for (const dir of TEST_ARTIFACT_DIRS) {
    const srcPath = path.join(params.worktreePath, dir);
    let stat: fs.Stats;
    try {
      stat = fs.lstatSync(srcPath);
    } catch {
      continue;
    }
    if (!stat.isDirectory()) continue;

    if (!wroteAny) {
      ensureDir(artifactsRoot);
      wroteAny = true;
    }

    const destPath = path.join(artifactsRoot, dir);
    removePathIfExists(destPath);
    try {
      fs.cpSync(srcPath, destPath, { recursive: true, dereference: true });
      params.log(`Copied test artifacts from ${dir} to ${destPath}`);
    } catch (err) {
      params.log(`Failed to copy test artifacts from ${dir}: ${String(err)}`);
    }
  }
}

async function stageRemoteTestArtifacts(params: {
  remote: RemoteRunConfig;
  iteration: number;
  log: (line: string) => void;
}) {
  const remoteArtifactsRoot = buildRemoteTestArtifactsRoot(params.remote, params.iteration);
  await remoteExec(
    params.remote.projectId,
    `rm -rf ${shellEscape(remoteArtifactsRoot)} && mkdir -p ${shellEscape(remoteArtifactsRoot)}`,
    { cwd: "." }
  );

  for (const dir of TEST_ARTIFACT_DIRS) {
    const exists = await remoteDirExists(params.remote, params.remote.workspacePath, dir);
    if (!exists) continue;
    params.log(`Staging remote test artifacts from ${dir} into ${remoteArtifactsRoot}`);
    await remoteExec(
      params.remote.projectId,
      `cp -R ${shellEscape(path.posix.join(params.remote.workspacePath, dir))} ${shellEscape(
        remoteArtifactsRoot
      )}`,
      { cwd: "." }
    );
  }
}

async function syncRemoteTestArtifacts(params: {
  remote: RemoteRunConfig;
  runDir: string;
  iteration: number;
  log: (line: string) => void;
}) {
  const remoteArtifactsRoot = buildRemoteTestArtifactsRoot(params.remote, params.iteration);
  const localArtifactsRoot = buildLocalTestArtifactsRoot(params.runDir, params.iteration);
  ensureDir(localArtifactsRoot);

  for (const dir of TEST_ARTIFACT_DIRS) {
    const exists = await remoteDirExists(params.remote, remoteArtifactsRoot, dir);
    if (!exists) continue;
    const remotePath = path.posix.join(remoteArtifactsRoot, dir);
    const localPath = path.join(localArtifactsRoot, dir);
    removePathIfExists(localPath);
    params.log(`Downloading remote test artifacts from ${remotePath}`);
    await remoteDownload(params.remote.projectId, remotePath, localPath);
  }
}

export async function runRun(runId: string) {
  const run = getRunById(runId);
  if (!run) return;

  let runLog: fs.WriteStream | null = null;
  let remoteConfig: RemoteRunConfig | null = null;
  let remoteFallbackReason: string | null = null;
  let containerConfig: ContainerConfig | null = null;
  let containerEnabled = false;
  let containerFallbackReason: string | null = null;
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

    const mergedConstitution = getConstitutionForProject(repoPath);
    const builderConstitution = selectRelevantConstitutionSections({
      constitution: mergedConstitution,
      context: "builder",
      workOrderTags: workOrder.tags,
    });
    const reviewerConstitution = selectRelevantConstitutionSections({
      constitution: mergedConstitution,
      context: "reviewer",
      workOrderTags: workOrder.tags,
    });
    logConstitutionSelection(log, "builder", builderConstitution);
    logConstitutionSelection(log, "reviewer", reviewerConstitution);

    const baseBranch = resolveBaseBranch(repoPath, log);
    const branchName =
      run.branch_name?.trim() || buildRunBranchName(workOrder.id, runId);
    if (branchName !== run.branch_name) {
      updateRun(runId, { branch_name: branchName });
    }
    const { worktreePath, worktreeRealPath } = resolveWorktreePaths(runDir);
    try {
      ensureWorktree({
        repoPath,
        worktreePath,
        worktreeRealPath,
        branchName,
        baseBranch,
        log,
      });
    } catch (err) {
      log(`Failed to create worktree: ${String(err)}`);
      updateRun(runId, {
        status: "failed",
        error: `worktree creation failed: ${String(err)}`,
        finished_at: nowIso(),
      });
      return;
    }
    ensureNodeModulesSymlink(repoPath, worktreePath);

    const isolationMode = project.isolation_mode || "local";
    const wantsVmIsolation = VM_ISOLATION_MODES.has(isolationMode);
    const wantsContainerIsolation = wantsVmIsolation;
    if (wantsContainerIsolation) {
      containerConfig = buildContainerConfig();
    }
    let vm = getProjectVm(project.id);
    let fallbackToLocal = wantsVmIsolation && shouldFallbackToLocalVm(vm);
    if (wantsVmIsolation) {
      if (!vm) {
        remoteFallbackReason = "VM not configured";
      } else if (fallbackToLocal) {
        const statusLabel = vm.status.replace("_", " ");
        remoteFallbackReason = `VM ${statusLabel}`;
      } else {
        if (vm.status === "stopped") {
          log("VM is stopped; attempting to start before run");
          try {
            vm = await startVM(project.id);
          } catch (err) {
            if (
              err instanceof VmManagerError &&
              (err.code === "not_provisioned" || err.code === "not_found")
            ) {
              fallbackToLocal = true;
            }
            const message = err instanceof Error ? err.message : String(err);
            remoteFallbackReason = `Failed to start VM: ${message}`;
          }
        }
        if (!remoteFallbackReason) {
          if (vm.status !== "running") {
            const suffix = vm.last_error ? ` (${vm.last_error})` : "";
            remoteFallbackReason = `VM not running (status=${vm.status})${suffix}`;
          } else if (!vm.external_ip) {
            remoteFallbackReason = "VM missing external IP";
          } else {
            const remotePaths = buildRemoteRunPaths(runId);
            remoteConfig = {
              projectId: project.id,
              workspacePath: remotePaths.workspacePath,
              artifactsPath: remotePaths.artifactsPath,
            };
          }
        }
      }
    }

    containerEnabled = wantsContainerIsolation && !!remoteConfig;
    const executionPath = path.join(runDir, "execution.json");
    const updateExecutionMetadata = (patch: Record<string, unknown>) => {
      const current = readJsonIfExists<Record<string, unknown>>(executionPath) ?? {};
      writeJson(executionPath, { ...current, ...patch });
    };
    const recordContainerFallback = (reason: string) => {
      if (containerFallbackReason) return;
      containerFallbackReason = reason;
      containerEnabled = false;
      log(`Container runtime unavailable; falling back to local execution: ${reason}`);
      updateExecutionMetadata({
        container_execution_mode: "local",
        container_fallback_reason: reason,
      });
    };

    const requiresRemote = wantsVmIsolation && !fallbackToLocal;
    if (remoteFallbackReason && wantsVmIsolation) {
      if (requiresRemote) {
        log(`VM isolation required but unavailable: ${remoteFallbackReason}`);
      } else {
        log(`VM isolation unavailable; running locally: ${remoteFallbackReason}`);
      }
    }

    const containerExecutionMode = wantsContainerIsolation
      ? containerEnabled
        ? "container"
        : requiresRemote
          ? "blocked"
          : "local"
      : "disabled";
    writeJson(executionPath, {
      requested_isolation_mode: isolationMode,
      vm_status: vm?.status ?? null,
      execution_mode: remoteConfig ? "remote" : requiresRemote ? "blocked" : "local",
      fallback_reason: remoteFallbackReason,
      remote_workspace_path: remoteConfig?.workspacePath ?? null,
      remote_artifacts_path: remoteConfig?.artifactsPath ?? null,
      container_requested: wantsContainerIsolation,
      container_execution_mode: containerExecutionMode,
      container_image: containerConfig?.image ?? null,
      container_fallback_reason: containerFallbackReason,
      recorded_at: nowIso(),
    });

    const setupStartedAt = new Date();
    const recordSetupOutcome = (
      outcome: RunPhaseMetricOutcome,
      metadata?: RunPhaseMetricMetadata
    ) => {
      recordPhaseMetric({
        runId,
        phase: "setup",
        iteration: 1,
        outcome,
        startedAt: setupStartedAt,
        metadata,
        log,
      });
    };

    if (requiresRemote && !remoteConfig) {
      const message = `VM isolation required but unavailable: ${remoteFallbackReason || "unknown error"}`;
      updateRun(runId, {
        status: "failed",
        error: message,
        finished_at: nowIso(),
      });
      recordSetupOutcome("failed");
      log(message);
      return;
    }

    if (remoteConfig) {
      updateProjectVm(project.id, { last_activity_at: nowIso(), last_error: null });
      try {
        await prepareRemoteRun(remoteConfig, log);
      } catch (err) {
        const message = `remote workspace setup failed: ${String(err)}`;
        log(message);
        updateRun(runId, {
          status: "failed",
          error: message,
          finished_at: nowIso(),
        });
        recordSetupOutcome("failed");
        return;
      }
    }

    const baselineResultsPath = path.join(runDir, "tests", "baseline-results.json");
    const baselineLogPath = path.join(runDir, "tests", "baseline-npm-test.log");
    let baselineTests =
      readJsonIfExists<Array<{ command: string; passed: boolean; output?: string }>>(baselineResultsPath);
    const setupMetadataBase: RunPhaseMetricMetadata = {
      cached: Boolean(baselineTests),
    };
    if (!baselineTests) {
      log("Running baseline health check...");
      if (remoteConfig) {
        try {
          await syncRemoteWorkspace(remoteConfig, worktreePath, log);
        } catch (err) {
          const message = `remote workspace sync failed: ${String(err)}`;
          log(message);
          updateRun(runId, {
            status: "failed",
            error: message,
            finished_at: nowIso(),
          });
          recordSetupOutcome("failed", setupMetadataBase);
          return;
        }
      }
      try {
        baselineTests = remoteConfig
          ? await runRemoteTests({
              repoPath: worktreePath,
              runDir,
              iteration: 0,
              runId,
              remote: remoteConfig,
              logPath: baselineLogPath,
              labelPrefix: "baseline",
            })
          : await runRepoTests(worktreePath, runDir, 0, {
              logPath: baselineLogPath,
              label: "baseline npm test",
            });
        writeJson(baselineResultsPath, baselineTests);
      } catch (err) {
        baselineTests = [{ command: "tests", passed: false, output: String(err) }];
        writeJson(baselineResultsPath, baselineTests);
      }

      if (remoteConfig) {
        try {
          await stageRemoteTestArtifacts({ remote: remoteConfig, iteration: 0, log });
          await syncRemoteTestArtifacts({ remote: remoteConfig, runDir, iteration: 0, log });
        } catch (err) {
          const message = `remote artifact sync failed: ${String(err)}`;
          log(message);
          updateRun(runId, {
            status: "failed",
            error: message,
            finished_at: nowIso(),
          });
          recordSetupOutcome("failed", setupMetadataBase);
          return;
        }
      } else {
        copyLocalTestArtifacts({ worktreePath, runDir, iteration: 0, log });
      }
    } else {
      log("Using cached baseline test results");
    }

    if (!baselineTests) {
      const message = "baseline tests did not return results";
      updateRun(runId, {
        status: "failed",
        error: message,
        finished_at: nowIso(),
      });
      recordSetupOutcome("failed", setupMetadataBase);
      log(message);
      return;
    }

    const baselineFailures = baselineTests.filter((test) => !test.passed);
    if (baselineFailures.length) {
      const failedTests = baselineFailures.map((test) => test.command).join(", ");
      const message = `Cannot start run: baseline tests failing. Fix these first: ${failedTests}`;
      updateRun(runId, {
        status: "baseline_failed",
        error: message,
        finished_at: nowIso(),
      });
      recordSetupOutcome("failed", {
        ...setupMetadataBase,
        failed_tests: failedTests,
      });
      log(message);
      return;
    }

    recordSetupOutcome("success", setupMetadataBase);
    log("Baseline healthy, starting builder...");

    // Move Work Order into building inside the run branch.
    try {
      if (workOrder.status === "ready") {
        patchWorkOrder(worktreePath, run.work_order_id, { status: "building" });
      }
    } catch {
      // ignore; contract enforcement happens elsewhere
    }

    const baselineRoot = path.join(runDir, "baseline");
    if (!fs.existsSync(baselineRoot)) {
      log("Creating baseline snapshot");
      copySnapshot(worktreePath, baselineRoot);
    }

    const builderSchemaPath = path.join(runDir, "builder.schema.json");
    const reviewerSchemaPath = path.join(runDir, "reviewer.schema.json");
    if (!fs.existsSync(builderSchemaPath))
      writeJson(builderSchemaPath, builderSchema());
    if (!fs.existsSync(reviewerSchemaPath))
      writeJson(reviewerSchemaPath, reviewerSchema());

    const maxIterations = Math.max(
      1,
      Math.trunc(
        Number.isFinite(runnerSettings.maxBuilderIterations)
          ? runnerSettings.maxBuilderIterations
          : DEFAULT_MAX_BUILDER_ITERATIONS
      )
    );
    let reviewerFeedback: string | undefined;
    let approvedSummary: string | null = null;
    let reviewerVerdict: "approved" | "changes_requested" | null = null;
    let reviewerNotes: string[] = [];
    let testFailureOutput: string | null = null;
    let escalationContext: EscalationRecord | null = null;
    const iterationHistory: RunIterationHistoryEntry[] = [];
    const iterationHistoryPath = path.join(runDir, "iteration_history.json");
    const writeIterationHistory = () => {
      writeJson(iterationHistoryPath, iterationHistory);
    };

    let finalIteration = 1;

    for (let iteration = 1; iteration <= maxIterations; iteration++) {
      finalIteration = iteration;
      updateRun(runId, {
        status: "building",
        iteration,
        builder_iteration: iteration,
        reviewer_verdict: null,
        reviewer_notes: null,
      });
      log(`Builder iteration ${iteration} starting`);
      const builderStartedAt = new Date();

      const builderDir = path.join(runDir, "builder", `iter-${iteration}`);
      const reviewerDir = path.join(runDir, "reviewer", `iter-${iteration}`);
      ensureDir(builderDir);
      ensureDir(reviewerDir);

      const builderOutputPath = path.join(builderDir, "result.json");
      const builderLogPath = path.join(builderDir, "codex.log");
      let builderResult:
        | {
            summary: string;
            risks: string[];
            tests: unknown[];
            escalation?: string;
            changes?: unknown;
          }
        | null = null;
      let builderChanges: BuilderChange[] = [];

      while (true) {
        const builderPrompt = buildBuilderPrompt({
          workOrderMarkdown,
          workOrder,
          iteration,
          maxIterations,
          reviewerFeedback,
          testFailureOutput,
          constitution: builderConstitution.content,
          iterationHistory,
          escalationContext,
        });
        fs.writeFileSync(path.join(builderDir, "prompt.txt"), builderPrompt, "utf8");

        const runLocalBuilder = async (): Promise<CodexExecResult> =>
          runCodexExec({
            cwd: worktreePath,
            prompt: builderPrompt,
            schemaPath: builderSchemaPath,
            outputPath: builderOutputPath,
            logPath: builderLogPath,
            sandbox: "workspace-write",
            model: runnerSettings.builder.model,
            cliPath: runnerSettings.builder.cliPath,
            onEscalation: async (request) => {
              const escalationRecord: EscalationRecord = {
                ...request,
                created_at: nowIso(),
              };
              updateRun(runId, {
                status: "waiting_for_input",
                escalation: JSON.stringify(escalationRecord),
              });
              writeJson(path.join(runDir, "escalation.json"), escalationRecord);
              log("Escalation requested; waiting for user input");

              const resolved = await waitForEscalationResolution(runId, log);
              if (!resolved?.resolution) return null;
              try {
                writeEscalationResolution(runDir, resolved);
              } catch (err) {
                log(`Failed to persist escalation resolution: ${String(err)}`);
                return null;
              }
              return resolved;
            },
            log,
          });

        let builderExecResult: CodexExecResult;
        try {
          if (remoteConfig && containerConfig && containerEnabled) {
            try {
              await syncRemoteWorkspaceFiles(remoteConfig, worktreePath, log);
            } catch (err) {
              const message = `remote workspace sync failed: ${String(err)}`;
              log(message);
              recordPhaseMetric({
                runId,
                phase: "builder",
                iteration,
                outcome: "failed",
                startedAt: builderStartedAt,
                log,
              });
              updateRun(runId, {
                status: "failed",
                error: message,
                finished_at: nowIso(),
              });
              return;
            }
            let ranRemote = false;
            try {
              builderExecResult = await runCodexExecRemote({
                projectId: remoteConfig.projectId,
                runId,
                workspacePath: remoteConfig.workspacePath,
                artifactsDir: path.posix.join(
                  remoteConfig.artifactsPath,
                  "builder",
                  `iter-${iteration}`
                ),
                localPromptPath: path.join(builderDir, "prompt.txt"),
                localSchemaPath: builderSchemaPath,
                localOutputPath: builderOutputPath,
                localLogPath: builderLogPath,
                sandbox: "workspace-write",
                skipGitRepoCheck: true,
                model: runnerSettings.builder.model,
                containerConfig,
                containerName: buildContainerName(runId, `builder-${iteration}`),
                log,
              });
              ranRemote = true;
            } catch (err) {
              if (err instanceof ContainerFallbackError) {
                recordContainerFallback(err.reason);
                builderExecResult = await runLocalBuilder();
              } else {
                throw err;
              }
            }
            if (ranRemote) {
              try {
                await syncRemoteWorkspaceToLocal(remoteConfig, worktreePath, log);
              } catch (err) {
                const message = `remote workspace download failed: ${String(err)}`;
                log(message);
                recordPhaseMetric({
                  runId,
                  phase: "builder",
                  iteration,
                  outcome: "failed",
                  startedAt: builderStartedAt,
                  log,
                });
                updateRun(runId, {
                  status: "failed",
                  error: message,
                  finished_at: nowIso(),
                });
                return;
              }
            }
          } else {
            builderExecResult = await runLocalBuilder();
          }
        } catch (err) {
          log(`Builder failed: ${String(err)}`);
          recordPhaseMetric({
            runId,
            phase: "builder",
            iteration,
            outcome: "failed",
            startedAt: builderStartedAt,
            log,
          });
          updateRun(runId, {
            status: "failed",
            error: `builder failed: ${String(err)}`,
            finished_at: nowIso(),
          });
          return;
        }

        if (builderExecResult.escalationRequested && !builderExecResult.escalationResolved) {
          log("Escalation resolution missing; exiting run");
          return;
        }
        if (builderExecResult.escalationResolved) {
          escalationContext = builderExecResult.escalationResolved;
          log("Escalation resolved; continuing builder iteration with user input");
        }

        builderResult = null;
        builderChanges = [];
        try {
          builderResult = JSON.parse(fs.readFileSync(builderOutputPath, "utf8")) as {
            summary: string;
            risks: string[];
            tests: unknown[];
            escalation?: string;
            changes?: unknown;
          };
          builderChanges = normalizeBuilderChanges(builderResult?.changes);
        } catch {
          // keep going; reviewer can still evaluate diff
        }

        if (!builderExecResult.escalationRequested) {
          let escalationRequest = findEscalationRequest([
            builderResult?.escalation,
            builderResult?.summary,
          ]);
          if (!escalationRequest) {
            const builderOutputText = readTextIfExists(builderOutputPath);
            const builderLogText = readTextIfExists(builderLogPath);
            escalationRequest = findEscalationRequest([builderOutputText, builderLogText]);
          }
          if (escalationRequest) {
            const escalationRecord: EscalationRecord = {
              ...escalationRequest,
              created_at: nowIso(),
            };
            updateRun(runId, {
              status: "waiting_for_input",
              escalation: JSON.stringify(escalationRecord),
            });
            writeJson(path.join(runDir, "escalation.json"), escalationRecord);
            log("Escalation requested after builder output; waiting for user input");

            const resolved = await waitForEscalationResolution(runId, log);
            if (!resolved?.resolution) {
              log("Escalation resolution missing; exiting run");
              return;
            }
            escalationContext = resolved;
            try {
              fs.writeFileSync(builderOutputPath, "", "utf8");
              fs.writeFileSync(builderLogPath, "", "utf8");
            } catch (err) {
              log(`Failed to clear builder outputs before retry: ${String(err)}`);
            }
            continue;
          }
        }
        break;
      }

      recordPhaseMetric({
        runId,
        phase: "builder",
        iteration,
        outcome: "success",
        startedAt: builderStartedAt,
        log,
      });

      const changedFiles = computeChangedFiles(baselineRoot, worktreePath);
      const diffPatch = buildPatchForChangedFiles(
        runDir,
        baselineRoot,
        worktreePath,
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

      const historyEntry: RunIterationHistoryEntry = {
        iteration,
        builder_summary: builderResult?.summary ?? null,
        builder_risks: builderResult?.risks ?? [],
        builder_changes: builderChanges,
        tests: [],
        reviewer_verdict: null,
        reviewer_notes: null,
      };

      const testStartedAt = new Date();
      const recordTestOutcome = (outcome: RunPhaseMetricOutcome) => {
        recordPhaseMetric({
          runId,
          phase: "test",
          iteration,
          outcome,
          startedAt: testStartedAt,
          log,
        });
      };

      updateRun(runId, { status: "testing" });
      log(`Running tests (iter ${iteration})`);
      let tests: Array<{ command: string; passed: boolean; output?: string }> = [];
      if (remoteConfig) {
        try {
          await syncRemoteWorkspace(remoteConfig, worktreePath, log);
        } catch (err) {
          const message = `remote workspace sync failed: ${String(err)}`;
          log(message);
          updateRun(runId, {
            status: "failed",
            error: message,
            finished_at: nowIso(),
          });
          recordTestOutcome("failed");
          return;
        }
      }
      try {
        tests = remoteConfig
          ? await runRemoteTests({
              repoPath: worktreePath,
              runDir,
              iteration,
              runId,
              remote: remoteConfig,
            })
          : await runRepoTests(worktreePath, runDir, iteration);
        writeJson(path.join(runDir, "tests", "results.json"), tests);
      } catch (err) {
        tests = [{ command: "tests", passed: false, output: String(err) }];
        writeJson(path.join(runDir, "tests", "results.json"), tests);
      }

      if (remoteConfig) {
        try {
          await stageRemoteTestArtifacts({ remote: remoteConfig, iteration, log });
          await syncRemoteTestArtifacts({ remote: remoteConfig, runDir, iteration, log });
        } catch (err) {
          const message = `remote artifact sync failed: ${String(err)}`;
          log(message);
          updateRun(runId, {
            status: "failed",
            error: message,
            finished_at: nowIso(),
          });
          recordTestOutcome("failed");
          return;
        }
      } else {
        copyLocalTestArtifacts({ worktreePath, runDir, iteration, log });
      }

      historyEntry.tests = tests.map((test) => ({
        command: test.command,
        passed: test.passed,
        output: test.output ?? "",
      }));

      const anyFailed = tests.some((t) => !t.passed);
      if (anyFailed) {
        recordTestOutcome("failed");
        testFailureOutput = buildTestFailureOutput(tests);
        iterationHistory.push(historyEntry);
        writeIterationHistory();
        log(`Tests failed on iteration ${iteration}`);
        if (iteration >= maxIterations) {
          updateRun(runId, {
            status: "failed",
            error: `Tests failed after ${iteration} iterations`,
            finished_at: nowIso(),
            reviewer_verdict: reviewerVerdict,
            reviewer_notes: reviewerNotes.length ? JSON.stringify(reviewerNotes) : null,
            summary: builderResult?.summary || approvedSummary || null,
          });
          log("Tests failed; run marked failed");
          return;
        }
        continue;
      }

      recordTestOutcome("success");
      testFailureOutput = null;

      const reviewerStartedAt = new Date();
      const recordReviewerOutcome = (outcome: RunPhaseMetricOutcome) => {
        recordPhaseMetric({
          runId,
          phase: "reviewer",
          iteration,
          outcome,
          startedAt: reviewerStartedAt,
          log,
        });
      };

      updateRun(runId, { status: "ai_review" });
      log(`Reviewer iteration ${iteration} starting`);

      const reviewerRepoSnapshot = path.join(reviewerDir, "repo");
      try {
        const copied = copyGitTrackedSnapshot(worktreePath, reviewerRepoSnapshot);
        if (copied === 0) {
          fs.rmSync(reviewerRepoSnapshot, { recursive: true, force: true });
          copySnapshot(worktreePath, reviewerRepoSnapshot);
        }
      } catch {
        // ignore; reviewer can still use diff-only review
      }

      const reviewerBuilderResultPath = path.join(
        reviewerDir,
        "builder_result.json"
      );
      try {
        fs.copyFileSync(builderOutputPath, reviewerBuilderResultPath);
      } catch {
        // ignore; reviewer can still rely on prompt summary
      }

      const reviewerPrompt = buildReviewerPrompt({
        workOrderId: workOrder.id,
        workOrderMarkdown,
        diffPatch: diffPatch || "(no changes detected)",
        constitution: reviewerConstitution.content,
        builderChanges,
        builderChangesPath: fs.existsSync(reviewerBuilderResultPath)
          ? "builder_result.json"
          : undefined,
        vmTestResults: remoteConfig ? buildVmTestResults(tests) : undefined,
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
      const runLocalReviewer = () =>
        runCodexExec({
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

      try {
        if (remoteConfig && containerConfig && containerEnabled) {
          const remoteReviewerDir = path.posix.join(
            remoteConfig.artifactsPath,
            "reviewer",
            `iter-${iteration}`
          );
          try {
            await remoteUpload(
              remoteConfig.projectId,
              reviewerDir,
              remoteReviewerDir,
              { allowDelete: true }
            );
          } catch (err) {
            const message = `remote reviewer sync failed: ${String(err)}`;
            log(message);
            recordReviewerOutcome("failed");
            updateRun(runId, {
              status: "failed",
              error: message,
              finished_at: nowIso(),
            });
            return;
          }
          try {
            await runCodexExecRemote({
              projectId: remoteConfig.projectId,
              runId,
              workspacePath: remoteConfig.workspacePath,
              artifactsDir: remoteReviewerDir,
              localPromptPath: path.join(reviewerDir, "prompt.txt"),
              localSchemaPath: reviewerSchemaPath,
              localOutputPath: reviewerOutputPath,
              localLogPath: reviewerLogPath,
              sandbox: "read-only",
              skipGitRepoCheck: true,
              model: runnerSettings.reviewer.model,
              containerConfig,
              containerName: buildContainerName(runId, `reviewer-${iteration}`),
              workingDir: "/artifacts",
              log,
            });
          } catch (err) {
            if (err instanceof ContainerFallbackError) {
              recordContainerFallback(err.reason);
              await runLocalReviewer();
            } else {
              throw err;
            }
          }
        } else {
          await runLocalReviewer();
        }
      } catch (err) {
        log(`Reviewer failed: ${String(err)}`);
        recordReviewerOutcome("failed");
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

      recordReviewerOutcome(verdict.status);
      reviewerVerdict = verdict.status;
      reviewerNotes = verdict.notes || [];
      updateRun(runId, {
        reviewer_verdict: reviewerVerdict,
        reviewer_notes: JSON.stringify(reviewerNotes),
      });

      historyEntry.reviewer_verdict = reviewerVerdict;
      historyEntry.reviewer_notes = reviewerNotes;
      iterationHistory.push(historyEntry);
      writeIterationHistory();

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
        reviewer_notes: reviewerNotes.length ? JSON.stringify(reviewerNotes) : null,
      });
      return;
    }

    updateRun(runId, { merge_status: "pending" });
    log("Preparing merge to main");
    const mergeStartedAt = new Date();
    let mergeRecorded = false;
    const recordMergeOutcome = (
      outcome: RunPhaseMetricOutcome,
      metadata?: RunPhaseMetricMetadata
    ) => {
      if (mergeRecorded) return;
      mergeRecorded = true;
      recordPhaseMetric({
        runId,
        phase: "merge",
        iteration: finalIteration,
        outcome,
        startedAt: mergeStartedAt,
        metadata,
        log,
      });
    };

    try {
      patchWorkOrder(worktreePath, run.work_order_id, { status: "you_review" });
    } catch {
      // ignore
    }

    const finishMergeConflict = (
      message: string,
      conflictRunId: string | null,
      conflictFiles: string[]
    ) => {
      const finishedAt = nowIso();
      updateRun(runId, {
        status: "merge_conflict",
        merge_status: "conflict",
        conflict_with_run_id: conflictRunId,
        error: message,
        finished_at: finishedAt,
        reviewer_verdict: "approved",
        reviewer_notes: JSON.stringify(reviewerNotes),
        summary: approvedSummary,
      });
      recordMergeOutcome("failed", { reason: "merge_conflict" });
      log(`Merge conflict: ${message}`);
      if (conflictFiles.length) {
        writeJson(path.join(runDir, "conflict_files.json"), conflictFiles);
      }
    };

    const statusOutput = runGit(["status", "--porcelain"], {
      cwd: worktreePath,
      allowFailure: true,
    });
    if (!statusOutput.stdout.trim()) {
      log("No changes detected; skipping merge");
      cleanupWorktree({
        repoPath,
        worktreePath,
        worktreeRealPath,
        branchName,
        log,
      });

      const finishedAt = nowIso();
      updateRun(runId, {
        status: "you_review",
        finished_at: finishedAt,
        reviewer_verdict: "approved",
        reviewer_notes: JSON.stringify(reviewerNotes),
        summary: approvedSummary,
        merge_status: "merged",
        conflict_with_run_id: null,
      });

      recordMergeOutcome("skipped", { reason: "no_changes" });
      log("Run completed and approved");
      return;
    }

    runGit(["add", "-A"], { cwd: worktreePath, log });
    const commitTitle = workOrder.title.replace(/\s+/g, " ").trim();
    const commitMessage = `${workOrder.id}: ${commitTitle || "Update"}`;
    const commitResult = runGit(
      [
        "-c",
        "user.name=Control Center Runner",
        "-c",
        "user.email=runner@local",
        "commit",
        "-m",
        commitMessage,
      ],
      { cwd: worktreePath, allowFailure: true, log }
    );
    if (commitResult.status !== 0) {
      recordMergeOutcome("failed", { reason: "commit_failed" });
      updateRun(runId, {
        status: "failed",
        error: `git commit failed: ${commitResult.stderr || commitResult.stdout}`,
        finished_at: nowIso(),
        merge_status: null,
      });
      return;
    }

    let conflictRunId: string | null = null;
    let conflictFiles: string[] = [];

    const mergeBaseIntoBranch = async (): Promise<{
      ok: boolean;
      conflictRunId: string | null;
      conflictFiles: string[];
    }> => {
      const mergeIntoBranch = runGit(
        [
          "-c",
          "user.name=Control Center Runner",
          "-c",
          "user.email=runner@local",
          "merge",
          baseBranch,
          "--no-ff",
          "-m",
          `Merge ${baseBranch} into ${branchName}`,
        ],
        { cwd: worktreePath, allowFailure: true, log }
      );

      if (mergeIntoBranch.status === 0) {
        return { ok: true, conflictRunId: null, conflictFiles: [] };
      }

      const conflictFiles = listUnmergedFiles(worktreePath);
      if (!conflictFiles.length) {
        runGit(["merge", "--abort"], { cwd: worktreePath, allowFailure: true, log });
        recordMergeOutcome("failed", { reason: "merge_into_branch_failed" });
        updateRun(runId, {
          status: "failed",
          error: `merge into branch failed: ${mergeIntoBranch.stderr || mergeIntoBranch.stdout}`,
          finished_at: nowIso(),
          merge_status: null,
        });
        return { ok: false, conflictRunId: null, conflictFiles: [] };
      }

      const gitConflictOutput = runGit(["diff"], {
        cwd: worktreePath,
        allowFailure: true,
      }).stdout;

      const conflictDetails = buildConflictContext({
        repoPath,
        runId,
        runDir,
        workOrder,
        approvedSummary,
        conflictFiles,
        gitConflictOutput,
      });
      writeJson(path.join(runDir, "merge_conflict.json"), conflictDetails.conflictContext);

      const mergeDir = path.join(runDir, "merge");
      ensureDir(mergeDir);

      const conflictPrompt = buildConflictResolutionPrompt({
        currentRunId: runId,
        currentWorkOrderId: workOrder.id,
        currentWorkOrderMarkdown: workOrderMarkdown,
        currentSummary: approvedSummary || "(no summary)",
        currentDiff: conflictDetails.currentDiff,
        conflictingRunId: conflictDetails.conflictingRunId,
        conflictingWorkOrderId: conflictDetails.conflictingWorkOrderId,
        conflictingWorkOrderMarkdown: conflictDetails.conflictingWorkOrderMarkdown,
        conflictingSummary: conflictDetails.conflictingSummary,
        conflictingDiff: conflictDetails.conflictingDiff,
        conflictFiles,
        gitConflictOutput,
      });
      fs.writeFileSync(path.join(mergeDir, "prompt.txt"), conflictPrompt, "utf8");

      const mergeBuilderOutputPath = path.join(mergeDir, "result.json");
      const mergeBuilderLogPath = path.join(mergeDir, "codex.log");
      const runLocalMergeBuilder = () =>
        runCodexExec({
          cwd: worktreePath,
          prompt: conflictPrompt,
          schemaPath: builderSchemaPath,
          outputPath: mergeBuilderOutputPath,
          logPath: mergeBuilderLogPath,
          sandbox: "workspace-write",
          model: runnerSettings.builder.model,
          cliPath: runnerSettings.builder.cliPath,
        });
      try {
        if (remoteConfig && containerConfig && containerEnabled) {
          try {
            await syncRemoteWorkspaceFiles(remoteConfig, worktreePath, log);
          } catch (err) {
            const message = `remote workspace sync failed: ${String(err)}`;
            log(message);
            finishMergeConflict(message, conflictDetails.conflictingRunId, conflictFiles);
            return {
              ok: false,
              conflictRunId: conflictDetails.conflictingRunId,
              conflictFiles,
            };
          }
          let ranRemote = false;
          try {
            await runCodexExecRemote({
              projectId: remoteConfig.projectId,
              runId,
              workspacePath: remoteConfig.workspacePath,
              artifactsDir: path.posix.join(remoteConfig.artifactsPath, "merge", "builder"),
              localPromptPath: path.join(mergeDir, "prompt.txt"),
              localSchemaPath: builderSchemaPath,
              localOutputPath: mergeBuilderOutputPath,
              localLogPath: mergeBuilderLogPath,
              sandbox: "workspace-write",
              skipGitRepoCheck: true,
              model: runnerSettings.builder.model,
              containerConfig,
              containerName: buildContainerName(runId, "merge-builder"),
              log,
            });
            ranRemote = true;
          } catch (err) {
            if (err instanceof ContainerFallbackError) {
              recordContainerFallback(err.reason);
              await runLocalMergeBuilder();
            } else {
              throw err;
            }
          }
          if (ranRemote) {
            try {
              await syncRemoteWorkspaceToLocal(remoteConfig, worktreePath, log);
            } catch (err) {
              const message = `remote workspace download failed: ${String(err)}`;
              log(message);
              finishMergeConflict(message, conflictDetails.conflictingRunId, conflictFiles);
              return {
                ok: false,
                conflictRunId: conflictDetails.conflictingRunId,
                conflictFiles,
              };
            }
          }
        } else {
          await runLocalMergeBuilder();
        }
      } catch (err) {
        const message = `merge builder failed: ${String(err)}`;
        log(`Merge builder failed: ${String(err)}`);
        finishMergeConflict(message, conflictDetails.conflictingRunId, conflictFiles);
        return {
          ok: false,
          conflictRunId: conflictDetails.conflictingRunId,
          conflictFiles,
        };
      }

      const mergeBuilderResult = readJsonIfExists<{
        summary: string;
        risks: string[];
        tests: unknown[];
      }>(mergeBuilderOutputPath);
      if (mergeBuilderResult?.summary) {
        approvedSummary = mergeBuilderResult.summary;
      }

      const remainingConflicts = listUnmergedFiles(worktreePath);
      if (remainingConflicts.length) {
        finishMergeConflict(
          `Unresolved conflicts: ${remainingConflicts.join(", ")}`,
          conflictDetails.conflictingRunId,
          remainingConflicts
        );
        return {
          ok: false,
          conflictRunId: conflictDetails.conflictingRunId,
          conflictFiles: remainingConflicts,
        };
      }

      runGit(["add", "-A"], { cwd: worktreePath, log });
      const mergeCommitResult = runGit(
        [
          "-c",
          "user.name=Control Center Runner",
          "-c",
          "user.email=runner@local",
          "commit",
          "-m",
          `Merge ${baseBranch} into ${branchName}`,
        ],
        { cwd: worktreePath, allowFailure: true, log }
      );
      if (mergeCommitResult.status !== 0) {
        finishMergeConflict(
          `merge commit failed: ${mergeCommitResult.stderr || mergeCommitResult.stdout}`,
          conflictDetails.conflictingRunId,
          conflictFiles
        );
        return {
          ok: false,
          conflictRunId: conflictDetails.conflictingRunId,
          conflictFiles,
        };
      }

      const resolvedDiff = buildGitDiffPatch(worktreePath, baseBranch, "HEAD");
      fs.writeFileSync(path.join(mergeDir, "diff.patch"), resolvedDiff, "utf8");

      const mergeReviewerDir = path.join(mergeDir, "reviewer");
      ensureDir(mergeReviewerDir);
      const mergeReviewerSnapshot = path.join(mergeReviewerDir, "repo");
      try {
        const copied = copyGitTrackedSnapshot(worktreePath, mergeReviewerSnapshot);
        if (copied === 0) {
          fs.rmSync(mergeReviewerSnapshot, { recursive: true, force: true });
          copySnapshot(worktreePath, mergeReviewerSnapshot);
        }
      } catch {
        // ignore
      }

      const mergeVmTests = remoteConfig
        ? readJsonIfExists<Array<{ command: string; passed: boolean }>>(
            path.join(runDir, "tests", "results.json")
          )
        : null;
      const mergeReviewerPrompt = buildReviewerPrompt({
        workOrderId: workOrder.id,
        workOrderMarkdown,
        diffPatch: resolvedDiff || "(no changes detected)",
        constitution: reviewerConstitution.content,
        vmTestResults:
          remoteConfig && mergeVmTests ? buildVmTestResults(mergeVmTests) : undefined,
      });
      fs.writeFileSync(
        path.join(mergeReviewerDir, "prompt.txt"),
        mergeReviewerPrompt,
        "utf8"
      );
      fs.copyFileSync(
        workOrderFilePath,
        path.join(mergeReviewerDir, "work_order.md")
      );
      fs.writeFileSync(
        path.join(mergeReviewerDir, "diff.patch"),
        resolvedDiff,
        "utf8"
      );

      const mergeReviewerOutputPath = path.join(mergeReviewerDir, "verdict.json");
      const mergeReviewerLogPath = path.join(mergeReviewerDir, "codex.log");
      const runLocalMergeReviewer = () =>
        runCodexExec({
          cwd: mergeReviewerDir,
          prompt: mergeReviewerPrompt,
          schemaPath: reviewerSchemaPath,
          outputPath: mergeReviewerOutputPath,
          logPath: mergeReviewerLogPath,
          sandbox: "read-only",
          skipGitRepoCheck: true,
          model: runnerSettings.reviewer.model,
          cliPath: runnerSettings.reviewer.cliPath,
        });
      try {
        if (remoteConfig && containerConfig && containerEnabled) {
          const remoteMergeReviewerDir = path.posix.join(
            remoteConfig.artifactsPath,
            "merge",
            "reviewer"
          );
          try {
            await remoteUpload(
              remoteConfig.projectId,
              mergeReviewerDir,
              remoteMergeReviewerDir,
              { allowDelete: true }
            );
          } catch (err) {
            const message = `remote merge reviewer sync failed: ${String(err)}`;
            log(message);
            finishMergeConflict(message, conflictDetails.conflictingRunId, conflictFiles);
            return {
              ok: false,
              conflictRunId: conflictDetails.conflictingRunId,
              conflictFiles,
            };
          }
          try {
            await runCodexExecRemote({
              projectId: remoteConfig.projectId,
              runId,
              workspacePath: remoteConfig.workspacePath,
              artifactsDir: remoteMergeReviewerDir,
              localPromptPath: path.join(mergeReviewerDir, "prompt.txt"),
              localSchemaPath: reviewerSchemaPath,
              localOutputPath: mergeReviewerOutputPath,
              localLogPath: mergeReviewerLogPath,
              sandbox: "read-only",
              skipGitRepoCheck: true,
              model: runnerSettings.reviewer.model,
              containerConfig,
              containerName: buildContainerName(runId, "merge-reviewer"),
              workingDir: "/artifacts",
              log,
            });
          } catch (err) {
            if (err instanceof ContainerFallbackError) {
              recordContainerFallback(err.reason);
              await runLocalMergeReviewer();
            } else {
              throw err;
            }
          }
        } else {
          await runLocalMergeReviewer();
        }
      } catch (err) {
        const message = `merge reviewer failed: ${String(err)}`;
        log(`Merge reviewer failed: ${String(err)}`);
        finishMergeConflict(message, conflictDetails.conflictingRunId, conflictFiles);
        return {
          ok: false,
          conflictRunId: conflictDetails.conflictingRunId,
          conflictFiles,
        };
      }

      let mergeVerdict:
        | { status: "approved" | "changes_requested"; notes: string[] }
        | null = null;
      try {
        mergeVerdict = JSON.parse(
          fs.readFileSync(mergeReviewerOutputPath, "utf8")
        ) as { status: "approved" | "changes_requested"; notes: string[] };
      } catch {
        mergeVerdict = {
          status: "changes_requested",
          notes: ["Merge reviewer did not return valid JSON."],
        };
      }

      if (mergeVerdict.status !== "approved") {
        reviewerNotes = mergeVerdict.notes || reviewerNotes;
        finishMergeConflict(
          `Merge reviewer requested changes: ${(mergeVerdict.notes || []).join("; ")}`,
          conflictDetails.conflictingRunId,
          conflictFiles
        );
        return {
          ok: false,
          conflictRunId: conflictDetails.conflictingRunId,
          conflictFiles,
        };
      }

      return {
        ok: true,
        conflictRunId: conflictDetails.conflictingRunId,
        conflictFiles,
      };
    };

    const mergeResult = await mergeBaseIntoBranch();
    if (!mergeResult.ok) {
      recordMergeOutcome("failed", { reason: "merge_failed" });
      return;
    }
    if (mergeResult.conflictRunId) conflictRunId = mergeResult.conflictRunId;
    if (mergeResult.conflictFiles.length) conflictFiles = mergeResult.conflictFiles;

    const writeMergeArtifacts = () => {
      const mergeChangedFiles = listChangedFilesFromGit(
        worktreePath,
        baseBranch,
        "HEAD"
      );
      const mergeDiff = buildGitDiffPatch(worktreePath, baseBranch, "HEAD");
      writeJson(path.join(runDir, "files_changed.merge.json"), mergeChangedFiles);
      fs.writeFileSync(path.join(runDir, "diff-merge.patch"), mergeDiff, "utf8");
    };
    writeMergeArtifacts();

    const mainStatus = runGit(["status", "--porcelain"], {
      cwd: repoPath,
      allowFailure: true,
    });
    if (mainStatus.stdout.trim()) {
      finishMergeConflict(
        "Main branch has uncommitted changes; merge aborted.",
        conflictRunId,
        conflictFiles
      );
      return;
    }

    try {
      runGit(["checkout", baseBranch], { cwd: repoPath, log });
    } catch (err) {
      recordMergeOutcome("failed", { reason: "checkout_failed" });
      updateRun(runId, {
        status: "failed",
        error: `git checkout failed: ${String(err)}`,
        finished_at: nowIso(),
        merge_status: null,
      });
      return;
    }

    const mergeTitle = workOrder.title.replace(/\s+/g, " ").trim();
    const mergeMessage = `Merge ${workOrder.id}: ${mergeTitle || "Update"}`;
    const mergeArgs = [
      "-c",
      "user.name=Control Center Runner",
      "-c",
      "user.email=runner@local",
      "merge",
      branchName,
      "--no-ff",
      "-m",
      mergeMessage,
    ];
    const mergeMain = runGit(mergeArgs, { cwd: repoPath, allowFailure: true, log });
    if (mergeMain.status !== 0) {
      const mainConflictFiles = listUnmergedFiles(repoPath);
      const mainConflictOutput = runGit(["diff"], {
        cwd: repoPath,
        allowFailure: true,
      }).stdout;
      runGit(["merge", "--abort"], { cwd: repoPath, allowFailure: true, log });
      log("Merge to base branch failed; retrying after syncing branch");

      const retryResult = await mergeBaseIntoBranch();
      if (!retryResult.ok) {
        recordMergeOutcome("failed", { reason: "merge_retry_failed" });
        return;
      }
      if (retryResult.conflictRunId) conflictRunId = retryResult.conflictRunId;
      if (retryResult.conflictFiles.length) conflictFiles = retryResult.conflictFiles;
      writeMergeArtifacts();

      const retryMainStatus = runGit(["status", "--porcelain"], {
        cwd: repoPath,
        allowFailure: true,
      });
      if (retryMainStatus.stdout.trim()) {
        finishMergeConflict(
          "Main branch has uncommitted changes; merge aborted.",
          conflictRunId,
          conflictFiles
        );
        return;
      }

      const retryMergeMain = runGit(mergeArgs, {
        cwd: repoPath,
        allowFailure: true,
        log,
      });
      if (retryMergeMain.status !== 0) {
        const retryConflictFiles = listUnmergedFiles(repoPath);
        const retryConflictOutput = runGit(["diff"], {
          cwd: repoPath,
          allowFailure: true,
        }).stdout;
        runGit(["merge", "--abort"], { cwd: repoPath, allowFailure: true, log });
        const finalConflictFiles = retryConflictFiles.length
          ? retryConflictFiles
          : mainConflictFiles;
        const finalConflictOutput = retryConflictOutput || mainConflictOutput;
        const conflictDetails = buildConflictContext({
          repoPath,
          runId,
          runDir,
          workOrder,
          approvedSummary,
          conflictFiles: finalConflictFiles.length ? finalConflictFiles : conflictFiles,
          gitConflictOutput: finalConflictOutput,
        });
        writeJson(path.join(runDir, "merge_conflict.json"), conflictDetails.conflictContext);
        if (conflictDetails.conflictingRunId) {
          conflictRunId = conflictDetails.conflictingRunId;
        }
        finishMergeConflict(
          `Merge to ${baseBranch} failed: ${retryMergeMain.stderr || retryMergeMain.stdout}`,
          conflictRunId,
          finalConflictFiles.length ? finalConflictFiles : conflictFiles
        );
        return;
      }
    }

    cleanupWorktree({
      repoPath,
      worktreePath,
      worktreeRealPath,
      branchName,
      log,
    });

    const finishedAt = nowIso();
    updateRun(runId, {
      status: "you_review",
      finished_at: finishedAt,
      reviewer_verdict: "approved",
      reviewer_notes: JSON.stringify(reviewerNotes),
      summary: approvedSummary,
      merge_status: "merged",
      conflict_with_run_id: null,
    });

    recordMergeOutcome("success");
    log("Run completed and approved");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log(`Unhandled error: ${message}`);
    updateRun(runId, {
      status: "failed",
      error: `unhandled error: ${message}`,
      finished_at: nowIso(),
    });
  } finally {
    const finalRun = getRunById(runId);
    if (
      finalRun &&
      (finalRun.status === "failed" ||
        finalRun.status === "you_review" ||
        finalRun.status === "baseline_failed" ||
        finalRun.status === "merge_conflict" ||
        finalRun.status === "merged")
    ) {
      const outcome: RunOutcome =
        finalRun.status === "you_review"
          ? finalRun.merge_status === "merged"
            ? "merged"
            : "approved"
          : finalRun.status === "merged"
            ? "merged"
            : "failed";
      const handoffLog = (line: string) => {
        if (runLog) {
          log(`[handoff] ${line}`);
        } else {
          appendLog(finalRun.log_path, `[handoff] ${line}`);
        }
      };
      await generateAndStoreHandoff({
        runId,
        projectId: finalRun.project_id,
        outcome,
        log: handoffLog,
      });
    }
    if (remoteConfig) {
      try {
        await cleanupRemoteRun(remoteConfig, log);
      } catch (err) {
        log(`Remote cleanup failed: ${String(err)}`);
      }
    }
    try {
      runLog?.end();
    } catch {
      // ignore
    }
    clearRunnerPid(run.run_dir);
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
  const branchName = buildRunBranchName(workOrder.id, id);
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
    builder_iteration: 1,
    reviewer_verdict: null,
    reviewer_notes: null,
    summary: null,
    branch_name: branchName,
    merge_status: null,
    conflict_with_run_id: null,
    run_dir: runDir,
    log_path: logPath,
    created_at: createdAt,
    started_at: null,
    finished_at: null,
    error: null,
    escalation: null,
  };

  createRun(run);
  let worker: ChildProcess | null = null;
  try {
    worker = spawnRunWorker(id);
    if (!worker.pid) {
      throw new Error("runner worker pid unavailable");
    }
    writeRunnerPid(runDir, worker.pid);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    updateRun(id, {
      status: "failed",
      error: `failed to start worker: ${message}`,
      finished_at: nowIso(),
    });
    if (worker?.pid) {
      try {
        process.kill(worker.pid, "SIGTERM");
      } catch {
        // ignore
      }
    }
    throw err instanceof Error ? err : new Error(message);
  }
  return run;
}

export function getRunsForProject(projectId: string, limit = 50): RunRow[] {
  return listRunsByProject(projectId, limit);
}

export type RunDetails = Omit<RunRow, "escalation"> & {
  escalation: EscalationRecord | null;
  log_tail: string;
  builder_log_tail: string;
  reviewer_log_tail: string;
  tests_log_tail: string;
  iteration_history: RunIterationHistoryEntry[];
};

export function getRun(runId: string): RunDetails | null {
  const run = getRunById(runId);
  if (!run) return null;
  const builderIteration = run.builder_iteration || run.iteration || 1;
  const reviewerIteration = run.iteration || builderIteration;
  const builderLogPath = path.join(
    run.run_dir,
    "builder",
    `iter-${builderIteration}`,
    "codex.log"
  );
  const reviewerLogPath = path.join(
    run.run_dir,
    "reviewer",
    `iter-${reviewerIteration}`,
    "codex.log"
  );
  const testsLogPath = path.join(run.run_dir, "tests", "npm-test.log");
  const iterationHistory =
    readJsonIfExists<RunIterationHistoryEntry[]>(
      path.join(run.run_dir, "iteration_history.json")
    ) || [];
  const escalation = parseEscalationRecord(run.escalation);

  return {
    ...run,
    escalation,
    log_tail: tailFile(run.log_path),
    builder_log_tail: tailFile(builderLogPath),
    reviewer_log_tail: tailFile(reviewerLogPath),
    tests_log_tail: tailFile(testsLogPath),
    iteration_history: iterationHistory,
  };
}

export function provideRunInput(
  runId: string,
  inputs: Record<string, unknown>
): { ok: true } | { ok: false; error: string } {
  const run = getRunById(runId);
  if (!run) return { ok: false, error: "Run not found" };
  if (run.status !== "waiting_for_input") {
    return { ok: false, error: `Run status is ${run.status}, expected waiting_for_input` };
  }
  const escalation = parseEscalationRecord(run.escalation);
  if (!escalation) return { ok: false, error: "Run has no escalation request" };
  if (escalation.resolved_at) return { ok: false, error: "Escalation already resolved" };

  const missing: string[] = [];
  const resolution: Record<string, string> = {};
  for (const input of escalation.inputs) {
    const value = inputs[input.key];
    if (typeof value !== "string" || !value.trim()) {
      missing.push(input.key);
      continue;
    }
    resolution[input.key] = value.trim();
  }
  if (missing.length) {
    return { ok: false, error: `Missing inputs: ${missing.join(", ")}` };
  }

  const updated: EscalationRecord = {
    ...escalation,
    resolved_at: nowIso(),
    resolution,
  };
  updateRun(runId, {
    status: "building",
    escalation: JSON.stringify(updated),
  });
  return { ok: true };
}

type CancelRunResult =
  | { ok: true; run: RunRow }
  | { ok: false; error: string; code: "not_found" | "not_cancelable" | "kill_failed" };

const CANCELABLE_RUN_STATUSES = new Set<RunRow["status"]>([
  "queued",
  "building",
  "waiting_for_input",
  "ai_review",
  "testing",
]);

function killTargetForPid(pid: number): number {
  return process.platform === "win32" ? pid : -pid;
}

function isProcessAlive(target: number): boolean {
  try {
    process.kill(target, 0);
    return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ESRCH") return false;
    if (code === "EPERM") return true;
    throw err;
  }
}

async function waitForExit(target: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isProcessAlive(target)) return true;
    await sleep(RUNNER_KILL_POLL_MS);
  }
  return !isProcessAlive(target);
}

async function terminateRunner(pid: number, log: (line: string) => void): Promise<{
  ok: boolean;
  error?: string;
}> {
  const target = killTargetForPid(pid);
  if (!isProcessAlive(target)) return { ok: true };

  log(`Sending SIGTERM to runner process ${pid}`);
  try {
    process.kill(target, "SIGTERM");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== "ESRCH") {
      return { ok: false, error: `failed to SIGTERM runner: ${String(err)}` };
    }
  }

  if (await waitForExit(target, RUNNER_TERMINATE_TIMEOUT_MS)) return { ok: true };

  log("Runner still alive after SIGTERM; sending SIGKILL");
  try {
    process.kill(target, "SIGKILL");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== "ESRCH") {
      return { ok: false, error: `failed to SIGKILL runner: ${String(err)}` };
    }
  }

  const killed = await waitForExit(target, RUNNER_KILL_TIMEOUT_MS);
  return killed ? { ok: true } : { ok: false, error: "runner did not exit after SIGKILL" };
}

export async function cancelRun(runId: string): Promise<CancelRunResult> {
  const run = getRunById(runId);
  if (!run) return { ok: false, error: "run not found", code: "not_found" };
  if (!CANCELABLE_RUN_STATUSES.has(run.status)) {
    return {
      ok: false,
      error: `run status is ${run.status}, expected in-progress`,
      code: "not_cancelable",
    };
  }

  const log = (line: string) => appendLog(run.log_path, line);
  const pid = readRunnerPid(run.run_dir);
  if (!pid) {
    log("Runner pid missing; marking run canceled.");
    const finishedAt = nowIso();
    updateRun(runId, { status: "canceled", finished_at: finishedAt, error: "canceled by user" });
    return { ok: true, run: getRunById(runId) ?? run };
  }

  const terminated = await terminateRunner(pid, log);
  if (!terminated.ok) {
    log(`Failed to cancel runner: ${terminated.error ?? "unknown error"}`);
    return {
      ok: false,
      error: terminated.error ?? "failed to cancel runner",
      code: "kill_failed",
    };
  }

  clearRunnerPid(run.run_dir);
  const finishedAt = nowIso();
  updateRun(runId, { status: "canceled", finished_at: finishedAt, error: "canceled by user" });
  return { ok: true, run: getRunById(runId) ?? run };
}

export function finalizeManualRunResolution(
  runId: string
): { ok: true } | { ok: false; error: string } {
  const run = getRunById(runId);
  if (!run) return { ok: false, error: "Run not found" };
  if (run.status !== "merge_conflict") {
    return { ok: false, error: `Run status is ${run.status}, expected merge_conflict` };
  }

  const project = findProjectById(run.project_id);
  if (!project) return { ok: false, error: "Project not found" };

  const repoPath = project.path;
  const branchName = run.branch_name;
  if (!branchName) return { ok: false, error: "Run has no branch_name" };

  const runDir = run.run_dir;
  const { worktreePath, worktreeRealPath } = resolveWorktreePaths(runDir);
  const log = (line: string) => appendLog(path.join(runDir, "run.log"), line);

  try {
    const baseBranch = resolveBaseBranch(repoPath, log);

    // Attempt merge after manual resolution
    log("Attempting merge after manual resolution");
    const mergeResult = runGit(
      ["merge", branchName, "--no-ff", "-m", `Merge ${run.work_order_id}: manual resolution`],
      { cwd: repoPath, allowFailure: true, log }
    );

    if (mergeResult.status !== 0) {
      log(`Merge still failing: ${mergeResult.stderr}`);
      return { ok: false, error: "Merge still has conflicts" };
    }

    // Success - update status and cleanup
    updateRun(runId, {
      status: "you_review",
      merge_status: "merged",
      finished_at: new Date().toISOString(),
    });

    cleanupWorktree({
      repoPath,
      worktreePath,
      worktreeRealPath,
      branchName,
      log,
    });

    log("Manual resolution completed successfully");
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log(`Manual resolution failed: ${msg}`);
    return { ok: false, error: msg };
  }
}

export async function remoteExecForProject(
  projectId: string,
  command: string,
  options?: RemoteExecOptions
): Promise<ExecResult> {
  return remoteExec(projectId, command, options);
}

export async function remoteUploadForProject(
  projectId: string,
  localPath: string,
  remotePath: string,
  options?: RemoteSyncOptions
): Promise<void> {
  return remoteUpload(projectId, localPath, remotePath, options);
}

export async function remoteDownloadForProject(
  projectId: string,
  remotePath: string,
  localPath: string,
  options?: RemoteSyncOptions
): Promise<void> {
  return remoteDownload(projectId, remotePath, localPath, options);
}

export const __test__ = {
  buildConflictContext,
  ensureWorktreeLink,
  findEscalationRequest,
  removeWorktreeLink,
  resolveWorktreePaths,
  shouldFallbackToLocalVm,
};
