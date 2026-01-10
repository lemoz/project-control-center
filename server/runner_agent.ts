import { spawn, spawnSync } from "child_process";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import {
  createRun,
  findProjectById,
  getProjectVm,
  getRunById,
  listRunsByProject,
  type ProjectVmRow,
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
const DEFAULT_REMOTE_TEST_TIMEOUT_SEC = 900;
const REMOTE_TEST_TIMEOUT_MS = Math.round(
  parseNumberEnv(
    process.env.CONTROL_CENTER_REMOTE_TEST_TIMEOUT_SEC,
    DEFAULT_REMOTE_TEST_TIMEOUT_SEC
  ) * 1000
);

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

function parseNumberEnv(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

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

  // Enable full network access for agent runs (will be properly isolated when moved to VMs)
  args.push("-c", 'sandbox_permissions=["network-full-access"]');

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
      changes: {
        type: "array",
        items: {
          oneOf: [
            {
              type: "object",
              additionalProperties: false,
              properties: {
                file: { type: "string" },
                type: { const: "wo_implementation" },
                reason: { type: "string" },
              },
              required: ["file", "type"],
            },
            {
              type: "object",
              additionalProperties: false,
              properties: {
                file: { type: "string" },
                type: { const: "blocking_fix" },
                reason: { type: "string", minLength: 1, pattern: "\\S" },
              },
              required: ["file", "type", "reason"],
            },
          ],
        },
      },
    },
    required: ["summary", "risks", "tests", "changes"],
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
}) {
  const feedback = params.reviewerFeedback?.trim();
  const testFailureOutput = params.testFailureOutput?.trim();
  const constitutionBlock = formatConstitutionBlock(params.constitution ?? "");
  const iterationLine = `This is iteration ${params.iteration} of ${params.maxIterations}.\n\n`;
  const historyBlock = formatIterationHistory(
    params.iterationHistory ?? [],
    params.iteration
  );
  const failureBlock = testFailureOutput
    ? `## Previous Attempt Failed\n\n` +
      `Your previous implementation failed tests. Here's the output:\n\n` +
      "```\n" +
      `${testFailureOutput}\n` +
      "```\n\n" +
      "Please analyze the failure and fix the issues.\n\n"
    : "";
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
    `For each file you modify, classify the change:\n` +
    `- wo_implementation: Directly implements the Work Order\n` +
    `- blocking_fix: Fixes an issue that blocks WO completion (not part of WO scope, but necessary)\n` +
    `For blocking_fix changes, explain WHY it's necessary:\n` +
    `- What breaks without this fix?\n` +
    `- Why can't the WO be completed without it?\n` +
    `Only use blocking_fix for genuine blockers, not nice-to-have improvements.\n` +
    `\n` +
    `- At the end, output a JSON object matching the required schema.\n\n` +
    iterationLine +
    historyBlock +
    failureBlock +
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
    `For each file you modify, classify the change:\n` +
    `- wo_implementation: Directly implements the Work Order\n` +
    `- blocking_fix: Required to resolve the conflict or unblock the merge\n` +
    `For blocking_fix changes, explain WHY it's necessary.\n\n` +
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

async function runRepoTests(repoPath: string, runDir: string, iteration: number) {
  const testInfo = getTestScriptInfo(repoPath);
  if (!testInfo.hasTests) {
    return [{ command: "(no tests)", passed: true, output: testInfo.message }];
  }

  const logPath = path.join(runDir, "tests", "npm-test.log");
  ensureDir(path.dirname(logPath));
  const logStream = fs.createWriteStream(logPath, { flags: "a" });
  logStream.write(`[${nowIso()}] npm test start (iter ${iteration})\n`);
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

  logStream.write(`[${nowIso()}] npm test end exit=${exitCode}\n`);
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
  log(`Syncing worktree to VM workspace ${config.workspacePath}`);
  await remoteUpload(config.projectId, localPath, config.workspacePath, {
    allowDelete: true,
  });
}

async function runRemoteTests(params: {
  repoPath: string;
  runDir: string;
  iteration: number;
  remote: RemoteRunConfig;
}) {
  const testInfo = getTestScriptInfo(params.repoPath);
  if (!testInfo.hasTests) {
    return [{ command: "(no tests)", passed: true, output: testInfo.message }];
  }

  const logPath = path.join(params.runDir, "tests", "npm-test.log");
  ensureDir(path.dirname(logPath));
  const logStream = fs.createWriteStream(logPath, { flags: "a" });
  const env = { CI: "1", NEXT_DIST_DIR: ".system/next-run-tests" };

  const runRemoteCommand = async (label: string, command: string) => {
    logStream.write(`[${nowIso()}] ${label} start (iter ${params.iteration})\n`);
    const result = await remoteExec(params.remote.projectId, command, {
      cwd: params.remote.workspacePath,
      env,
      allowFailure: true,
      timeout: REMOTE_TEST_TIMEOUT_MS,
    });

    if (result.stdout) logStream.write(result.stdout);
    if (result.stderr) logStream.write(result.stderr);
    logStream.write(`[${nowIso()}] ${label} end exit=${result.exitCode}\n`);

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
    let vm = getProjectVm(project.id);
    const wantsVmIsolation = VM_ISOLATION_MODES.has(isolationMode);
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

    const requiresRemote = wantsVmIsolation && !fallbackToLocal;
    if (remoteFallbackReason && wantsVmIsolation) {
      if (requiresRemote) {
        log(`VM isolation required but unavailable: ${remoteFallbackReason}`);
      } else {
        log(`VM isolation unavailable; running locally: ${remoteFallbackReason}`);
      }
    }

    writeJson(path.join(runDir, "execution.json"), {
      requested_isolation_mode: isolationMode,
      vm_status: vm?.status ?? null,
      execution_mode: remoteConfig ? "remote" : requiresRemote ? "blocked" : "local",
      fallback_reason: remoteFallbackReason,
      remote_workspace_path: remoteConfig?.workspacePath ?? null,
      remote_artifacts_path: remoteConfig?.artifactsPath ?? null,
      recorded_at: nowIso(),
    });

    if (requiresRemote && !remoteConfig) {
      const message = `VM isolation required but unavailable: ${remoteFallbackReason || "unknown error"}`;
      updateRun(runId, {
        status: "failed",
        error: message,
        finished_at: nowIso(),
      });
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
        return;
      }
    }

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
    const iterationHistory: RunIterationHistoryEntry[] = [];
    const iterationHistoryPath = path.join(runDir, "iteration_history.json");
    const writeIterationHistory = () => {
      writeJson(iterationHistoryPath, iterationHistory);
    };

    for (let iteration = 1; iteration <= maxIterations; iteration++) {
      updateRun(runId, {
        status: "building",
        iteration,
        builder_iteration: iteration,
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
        maxIterations,
        reviewerFeedback,
        testFailureOutput,
        constitution: builderConstitution.content,
        iterationHistory,
      });
      fs.writeFileSync(path.join(builderDir, "prompt.txt"), builderPrompt, "utf8");

      const builderOutputPath = path.join(builderDir, "result.json");
      const builderLogPath = path.join(builderDir, "codex.log");

      try {
        await runCodexExec({
          cwd: worktreePath,
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
        | { summary: string; risks: string[]; tests: unknown[]; changes?: unknown }
        | null = null;
      let builderChanges: BuilderChange[] = [];
      try {
        builderResult = JSON.parse(fs.readFileSync(builderOutputPath, "utf8")) as {
          summary: string;
          risks: string[];
          tests: unknown[];
          changes?: unknown;
        };
        builderChanges = normalizeBuilderChanges(builderResult?.changes);
      } catch {
        // keep going; reviewer can still evaluate diff
      }

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
          return;
        }
      }
      try {
        tests = remoteConfig
          ? await runRemoteTests({ repoPath: worktreePath, runDir, iteration, remote: remoteConfig })
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

      testFailureOutput = null;

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
      try {
        await runCodexExec({
          cwd: worktreePath,
          prompt: conflictPrompt,
          schemaPath: builderSchemaPath,
          outputPath: mergeBuilderOutputPath,
          logPath: mergeBuilderLogPath,
          sandbox: "workspace-write",
          model: runnerSettings.builder.model,
          cliPath: runnerSettings.builder.cliPath,
        });
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

      const mergeReviewerPrompt = buildReviewerPrompt({
        workOrderId: workOrder.id,
        workOrderMarkdown,
        diffPatch: resolvedDiff || "(no changes detected)",
        constitution: reviewerConstitution.content,
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
      try {
        await runCodexExec({
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

  return {
    ...run,
    log_tail: tailFile(run.log_path),
    builder_log_tail: tailFile(builderLogPath),
    reviewer_log_tail: tailFile(reviewerLogPath),
    tests_log_tail: tailFile(testsLogPath),
    iteration_history: iterationHistory,
  };
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
  removeWorktreeLink,
  resolveWorktreePaths,
  shouldFallbackToLocalVm,
};
