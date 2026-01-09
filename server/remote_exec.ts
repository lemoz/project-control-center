import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import { getProjectVm } from "./db.js";

export type ExecResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

export type RemoteExecOptions = {
  cwd?: string;
  timeout?: number;
  env?: Record<string, string>;
  allowFailure?: boolean;
  allowAbsolute?: boolean;
};

export type RemoteSyncOptions = {
  allowDelete?: boolean;
  allowAbsolute?: boolean;
};

export type RemoteExecErrorCode =
  | "preflight"
  | "not_configured"
  | "not_running"
  | "invalid_path"
  | "invalid_env"
  | "invalid_command"
  | "timeout"
  | "command_failed"
  | "ssh_failed"
  | "sync_failed"
  | "tool_missing";

export class RemoteExecError extends Error {
  code: RemoteExecErrorCode;
  details?: Record<string, unknown>;

  constructor(code: RemoteExecErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

type CommandResult = {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
};

type SshConfig = {
  user: string;
  keyPath: string;
};

type VmTarget = {
  host: string;
  ssh: SshConfig;
};

type RemotePathOptions = {
  allowAbsolute?: boolean;
};

const SSH_COMMAND = process.env.CONTROL_CENTER_SSH_PATH || "ssh";
const RSYNC_COMMAND = process.env.CONTROL_CENTER_RSYNC_PATH || "rsync";
const SSH_USER_ENV = "CONTROL_CENTER_GCP_SSH_USER";
const SSH_KEY_ENV = "CONTROL_CENTER_GCP_SSH_KEY_PATH";
const SSH_SKIP_HOST_KEY_ENV = "CONTROL_CENTER_SSH_SKIP_HOST_KEY_CHECKING";
const DEFAULT_VM_REPO_ROOT = "/home/project/repo";
const DEFAULT_EXCLUDES = [
  ".env*",
  ".control-secrets*",
  ".git",
  "node_modules",
  "e2e/.tmp",
];

const ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const TRUE_ENV_VALUES = new Set(["1", "true", "yes", "on"]);

function parseNumberEnv(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function execTimeoutMs(override?: number): number {
  if (override && override > 0) return Math.round(override);
  const seconds = parseNumberEnv(process.env.CONTROL_CENTER_VM_SSH_TIMEOUT_SEC, 180);
  return Math.round(seconds * 1000);
}

function rsyncTimeoutMs(): number {
  const seconds = parseNumberEnv(process.env.CONTROL_CENTER_VM_RSYNC_TIMEOUT_SEC, 300);
  return Math.round(seconds * 1000);
}

function truncate(value: string, maxLength = 2000): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 3)}...`;
}

function isTruthyEnv(value: string | undefined): boolean {
  if (!value) return false;
  return TRUE_ENV_VALUES.has(value.trim().toLowerCase());
}

function commandSummary(result: CommandResult): string {
  const primary = result.stderr.trim() || result.stdout.trim();
  return truncate(primary.replace(/\s+/g, " ").trim());
}

const SSH_FAILURE_PATTERNS = [
  /Permission denied/i,
  /Could not resolve hostname/i,
  /Connection timed out/i,
  /Connection refused/i,
  /No route to host/i,
  /Host key verification failed/i,
  /REMOTE HOST IDENTIFICATION HAS CHANGED/i,
  /Operation timed out/i,
];

function isErrnoException(err: unknown): err is NodeJS.ErrnoException {
  return typeof err === "object" && err !== null && "code" in err;
}

function fsErrorDetails(err: unknown, filePath: string): Record<string, unknown> {
  if (isErrnoException(err)) {
    return {
      path: filePath,
      code: err.code ?? null,
      errno: err.errno ?? null,
      syscall: err.syscall ?? null,
      message: err.message,
    };
  }
  return {
    path: filePath,
    message: err instanceof Error ? err.message : String(err),
  };
}

function fsErrorCode(err: unknown): RemoteExecErrorCode {
  if (isErrnoException(err)) {
    if (err.code === "EACCES" || err.code === "EPERM") {
      return "preflight";
    }
  }
  return "invalid_path";
}

function looksLikeSshFailure(result: CommandResult): boolean {
  if (result.exitCode === 255 || result.exitCode === null) return true;
  const combined = `${result.stderr}\n${result.stdout}`;
  return SSH_FAILURE_PATTERNS.some((pattern) => pattern.test(combined));
}

function runCommand(
  command: string,
  args: string[],
  options?: { timeoutMs?: number }
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const timer =
      options?.timeoutMs && options.timeoutMs > 0
        ? setTimeout(() => {
            timedOut = true;
            child.kill("SIGKILL");
          }, options.timeoutMs)
        : null;

    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (err) => {
      if (timer) clearTimeout(timer);
      reject(err);
    });

    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      resolve({ stdout, stderr, exitCode: code, timedOut });
    });
  });
}

function resolveSshConfig(): SshConfig {
  const user = process.env[SSH_USER_ENV]?.trim();
  if (!user) {
    throw new RemoteExecError(
      "preflight",
      `SSH user not configured. Set ${SSH_USER_ENV} to the login user.`
    );
  }
  if (!/^[a-z][a-z0-9_-]{0,31}$/i.test(user)) {
    throw new RemoteExecError(
      "preflight",
      `SSH user "${user}" is invalid. Use a short UNIX-style username.`
    );
  }

  const keyPathRaw = process.env[SSH_KEY_ENV]?.trim();
  if (!keyPathRaw) {
    throw new RemoteExecError(
      "preflight",
      `SSH key path not configured. Set ${SSH_KEY_ENV} to a private key path.`
    );
  }

  const keyPath = path.resolve(keyPathRaw);
  if (!fs.existsSync(keyPath)) {
    throw new RemoteExecError(
      "preflight",
      `SSH key not found at ${keyPath}. Provide a valid private key path.`
    );
  }

  return { user, keyPath };
}

function resolveVmRepoRoot(): string {
  const root = (process.env.CONTROL_CENTER_VM_REPO_ROOT || DEFAULT_VM_REPO_ROOT).trim();
  if (!root.startsWith("/")) {
    throw new RemoteExecError(
      "preflight",
      `VM repo root must be an absolute POSIX path. Got "${root}".`
    );
  }
  const normalized = path.posix.normalize(root);
  if (normalized.includes("..")) {
    throw new RemoteExecError(
      "preflight",
      `VM repo root must not include traversal segments. Got "${root}".`
    );
  }
  return normalized.replace(/\/+$/g, "") || "/";
}

function resolveVmTarget(projectId: string): VmTarget {
  const vm = getProjectVm(projectId);
  if (!vm) {
    throw new RemoteExecError(
      "not_configured",
      "VM not configured for project. Provision a VM before remote operations."
    );
  }
  if (vm.status !== "running") {
    throw new RemoteExecError(
      "not_running",
      `VM is not running (status=${vm.status}). Start the VM first.`
    );
  }
  if (!vm.external_ip) {
    throw new RemoteExecError(
      "not_running",
      "VM is missing an external IP. Refresh the VM status before continuing."
    );
  }
  return { host: vm.external_ip, ssh: resolveSshConfig() };
}

function hasTraversal(value: string): boolean {
  return value
    .split("/")
    .filter(Boolean)
    .some((segment) => segment === "..");
}

function resolveRemotePath(
  input: string,
  options?: RemotePathOptions
): { root: string; fullPath: string; isDirHint: boolean; isAbsoluteInput: boolean } {
  const root = resolveVmRepoRoot();
  const trimmed = input.replace(/\\/g, "/").trim();
  if (!trimmed) {
    throw new RemoteExecError("invalid_path", "Remote path must be a non-empty string.");
  }
  const isAbsoluteInput = trimmed.startsWith("/");
  const isDirHint = trimmed.endsWith("/");
  const cleaned = trimmed.replace(/\/+$/g, "");
  const allowAbsolute = options?.allowAbsolute === true;

  if (isAbsoluteInput && !allowAbsolute) {
    throw new RemoteExecError(
      "invalid_path",
      `Remote path "${input}" must be relative to ${root}.`
    );
  }

  if (!cleaned || cleaned === ".") {
    return { root, fullPath: root, isDirHint, isAbsoluteInput };
  }

  if (isAbsoluteInput) {
    const withoutLeading = cleaned.replace(/^\/+/, "");
    if (hasTraversal(withoutLeading)) {
      throw new RemoteExecError(
        "invalid_path",
        `Remote path "${input}" contains traversal segments.`
      );
    }
    const normalized = path.posix.normalize(cleaned);
    if (normalized === "/" || normalized === root) {
      return { root, fullPath: root, isDirHint, isAbsoluteInput };
    }
    if (!normalized.startsWith(`${root}/`)) {
      throw new RemoteExecError(
        "invalid_path",
        `Remote path "${input}" must stay within ${root}.`
      );
    }
    return { root, fullPath: normalized, isDirHint, isAbsoluteInput };
  }

  if (hasTraversal(cleaned)) {
    throw new RemoteExecError(
      "invalid_path",
      `Remote path "${input}" contains traversal segments.`
    );
  }

  const normalizedRel = path.posix.normalize(cleaned);
  if (normalizedRel.startsWith("..")) {
    throw new RemoteExecError(
      "invalid_path",
      `Remote path "${input}" contains traversal segments.`
    );
  }
  const fullPath = path.posix.join(root, normalizedRel);
  if (!fullPath.startsWith(`${root}/`) && fullPath !== root) {
    throw new RemoteExecError(
      "invalid_path",
      `Remote path "${input}" must stay within ${root}.`
    );
  }
  return { root, fullPath, isDirHint, isAbsoluteInput };
}

function resolveLocalPath(localPath: string): { fullPath: string; isDir: boolean } {
  if (!localPath.trim()) {
    throw new RemoteExecError("invalid_path", "Local path must be a non-empty string.");
  }
  const fullPath = path.resolve(localPath);
  if (!fs.existsSync(fullPath)) {
    throw new RemoteExecError(
      "invalid_path",
      `Local path "${localPath}" does not exist.`
    );
  }
  const root = path.parse(fullPath).root;
  if (fullPath === root) {
    throw new RemoteExecError(
      "invalid_path",
      `Local path "${localPath}" resolves to filesystem root; refusing to sync.`
    );
  }
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(fullPath);
  } catch (err) {
    throw new RemoteExecError(
      fsErrorCode(err),
      `Failed to read local path "${localPath}".`,
      fsErrorDetails(err, fullPath)
    );
  }
  return { fullPath, isDir: stat.isDirectory() };
}

function ensureLocalDir(dirPath: string) {
  if (fs.existsSync(dirPath)) return;
  try {
    fs.mkdirSync(dirPath, { recursive: true });
  } catch (err) {
    throw new RemoteExecError(
      fsErrorCode(err),
      `Failed to create local directory "${dirPath}".`,
      fsErrorDetails(err, dirPath)
    );
  }
}

function buildSshArgs(config: VmTarget): string[] {
  const skipHostKeyCheck = isTruthyEnv(process.env[SSH_SKIP_HOST_KEY_ENV]);
  const args = [
    "-i",
    config.ssh.keyPath,
    "-o",
    "BatchMode=yes",
    "-o",
    `StrictHostKeyChecking=${skipHostKeyCheck ? "no" : "yes"}`,
    "-o",
    "ConnectTimeout=10",
  ];
  if (skipHostKeyCheck) {
    args.push("-o", "UserKnownHostsFile=/dev/null");
  }
  return args;
}

function shellEscape(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function buildEnvPrefix(env: Record<string, string> | undefined): string {
  if (!env || Object.keys(env).length === 0) return "";
  const assignments: string[] = [];
  for (const [key, value] of Object.entries(env)) {
    if (!ENV_KEY_PATTERN.test(key)) {
      throw new RemoteExecError("invalid_env", `Invalid env var name "${key}".`);
    }
    assignments.push(`${key}=${shellEscape(String(value))}`);
  }
  return `env ${assignments.join(" ")} -- `;
}

function resolveRemoteCwd(cwd: string | undefined, allowAbsolute?: boolean): string | null {
  if (!cwd) return null;
  const resolved = resolveRemotePath(cwd, { allowAbsolute });
  return resolved.fullPath;
}

function assertNoAbsoluteDelete(
  contextLabel: string,
  allowDelete: boolean | undefined,
  remote: { isAbsoluteInput: boolean }
): void {
  if (allowDelete && remote.isAbsoluteInput) {
    throw new RemoteExecError(
      "invalid_path",
      `${contextLabel} delete does not allow absolute paths.`
    );
  }
}

async function ensureRemoteTool(
  config: VmTarget,
  tool: "rsync" | "scp"
): Promise<void> {
  const args = [
    ...buildSshArgs(config),
    `${config.ssh.user}@${config.host}`,
    `command -v ${tool} >/dev/null 2>&1`,
  ];
  let result: CommandResult;
  try {
    result = await runCommand(SSH_COMMAND, args, { timeoutMs: execTimeoutMs() });
  } catch (err) {
    const message = isErrnoException(err) && err.code === "ENOENT"
      ? "ssh client not found. Install OpenSSH or set CONTROL_CENTER_SSH_PATH."
      : `Failed to run ssh. ${err instanceof Error ? err.message : String(err)}`;
    throw new RemoteExecError("preflight", message);
  }

  if (result.timedOut) {
    throw new RemoteExecError("timeout", `SSH timed out while checking ${tool}.`, {
      tool,
    });
  }
  if (result.exitCode !== 0) {
    if (looksLikeSshFailure(result)) {
      throw new RemoteExecError("ssh_failed", `SSH failed while checking ${tool}.`, {
        tool,
        exitCode: result.exitCode,
        stdout: truncate(result.stdout),
        stderr: truncate(result.stderr),
      });
    }
    throw new RemoteExecError("tool_missing", `${tool} not found on VM.`, {
      tool,
      stderr: truncate(result.stderr),
    });
  }
}

async function ensureLocalTool(command: string, label: string): Promise<void> {
  try {
    const result = await runCommand(command, ["--version"], { timeoutMs: 8000 });
    if (result.exitCode === 0) return;
    throw new RemoteExecError(
      "tool_missing",
      `${label} failed to run. ${commandSummary(result) || "Check your installation."}`
    );
  } catch (err) {
    const message = isErrnoException(err) && err.code === "ENOENT"
      ? `${label} not found. Install it or set the relevant path env var.`
      : `${label} failed to run. ${err instanceof Error ? err.message : String(err)}`;
    throw new RemoteExecError("tool_missing", message);
  }
}

function buildRsyncShell(config: VmTarget): string {
  const sshParts = [SSH_COMMAND, ...buildSshArgs(config)];
  return sshParts.map((part) => shellEscape(part)).join(" ");
}

function formatRsyncSource(sourcePath: string, isDir: boolean): string {
  if (!isDir) return sourcePath;
  return sourcePath.endsWith(path.sep) ? sourcePath : `${sourcePath}${path.sep}`;
}

function formatRsyncRemote(
  config: VmTarget,
  remotePath: string,
  isDir: boolean
): string {
  const suffix = isDir && !remotePath.endsWith("/") ? "/" : "";
  return `${config.ssh.user}@${config.host}:${remotePath}${suffix}`;
}

function buildDeleteArgs(
  allowDelete: boolean | undefined,
  sourceIsDir: boolean,
  destIsDir: boolean,
  contextLabel: string
): string[] {
  if (!allowDelete) return [];
  if (!sourceIsDir || !destIsDir) {
    throw new RemoteExecError(
      "invalid_path",
      `${contextLabel} delete requires directory-to-directory sync.`
    );
  }
  return ["--delete"];
}

async function ensureRemoteDir(config: VmTarget, dirPath: string): Promise<void> {
  const args = [
    ...buildSshArgs(config),
    `${config.ssh.user}@${config.host}`,
    `mkdir -p ${shellEscape(dirPath)}`,
  ];
  let result: CommandResult;
  try {
    result = await runCommand(SSH_COMMAND, args, { timeoutMs: execTimeoutMs() });
  } catch (err) {
    const message = isErrnoException(err) && err.code === "ENOENT"
      ? "ssh client not found. Install OpenSSH or set CONTROL_CENTER_SSH_PATH."
      : `Failed to run ssh. ${err instanceof Error ? err.message : String(err)}`;
    throw new RemoteExecError("preflight", message);
  }
  if (result.timedOut) {
    throw new RemoteExecError("timeout", "SSH timed out while preparing remote path.", {
      dirPath,
    });
  }
  if (result.exitCode !== 0) {
    throw new RemoteExecError("ssh_failed", "Failed to prepare remote path.", {
      dirPath,
      stdout: truncate(result.stdout),
      stderr: truncate(result.stderr),
    });
  }
}

export async function remoteExec(
  projectId: string,
  command: string,
  options?: RemoteExecOptions
): Promise<ExecResult> {
  if (!command.trim()) {
    throw new RemoteExecError("invalid_command", "Command must be a non-empty string.");
  }

  const target = resolveVmTarget(projectId);
  const timeoutMs = execTimeoutMs(options?.timeout);
  const envPrefix = buildEnvPrefix(options?.env);
  const cwd = resolveRemoteCwd(options?.cwd, options?.allowAbsolute);
  const baseCommand = `${envPrefix}${command}`;
  const remoteCommand = cwd
    ? `cd ${shellEscape(cwd)} && ${baseCommand}`
    : baseCommand;

  const args = [
    ...buildSshArgs(target),
    `${target.ssh.user}@${target.host}`,
    remoteCommand,
  ];

  let result: CommandResult;
  try {
    result = await runCommand(SSH_COMMAND, args, { timeoutMs });
  } catch (err) {
    const message = isErrnoException(err) && err.code === "ENOENT"
      ? "ssh client not found. Install OpenSSH or set CONTROL_CENTER_SSH_PATH."
      : `Failed to run ssh. ${err instanceof Error ? err.message : String(err)}`;
    throw new RemoteExecError("preflight", message);
  }

  if (result.timedOut) {
    throw new RemoteExecError("timeout", `Remote command timed out after ${timeoutMs}ms.`, {
      command,
      timeoutMs,
    });
  }

  const execResult: ExecResult = {
    exitCode: result.exitCode ?? 1,
    stdout: result.stdout,
    stderr: result.stderr,
  };

  if (execResult.exitCode !== 0 && !options?.allowFailure) {
    throw new RemoteExecError("command_failed", "Remote command failed.", {
      command,
      cwd: cwd ?? null,
      exitCode: execResult.exitCode,
      stdout: truncate(execResult.stdout),
      stderr: truncate(execResult.stderr),
    });
  }

  return execResult;
}

export async function remoteUpload(
  projectId: string,
  localPath: string,
  remotePath: string,
  options?: RemoteSyncOptions
): Promise<void> {
  const target = resolveVmTarget(projectId);
  await ensureLocalTool(RSYNC_COMMAND, "rsync");
  await ensureRemoteTool(target, "rsync");

  const local = resolveLocalPath(localPath);
  const remote = resolveRemotePath(remotePath, { allowAbsolute: options?.allowAbsolute });
  assertNoAbsoluteDelete("Remote upload", options?.allowDelete, remote);
  const remoteIsDir = local.isDir || remote.isDirHint;
  if (!remoteIsDir && remote.fullPath === remote.root) {
    throw new RemoteExecError(
      "invalid_path",
      "Remote upload path must include a file name when syncing a file."
    );
  }
  const remoteDir = remoteIsDir ? remote.fullPath : path.posix.dirname(remote.fullPath);

  await ensureRemoteDir(target, remoteDir);

  const deleteArgs = buildDeleteArgs(
    options?.allowDelete,
    local.isDir,
    remoteIsDir,
    "Remote upload"
  );
  const rsyncArgs = [
    "-az",
    ...deleteArgs,
    ...DEFAULT_EXCLUDES.flatMap((pattern) => ["--exclude", pattern]),
    "-e",
    buildRsyncShell(target),
    formatRsyncSource(local.fullPath, local.isDir),
    formatRsyncRemote(target, remote.fullPath, remoteIsDir),
  ];

  let result: CommandResult;
  try {
    result = await runCommand(RSYNC_COMMAND, rsyncArgs, { timeoutMs: rsyncTimeoutMs() });
  } catch (err) {
    const message = isErrnoException(err) && err.code === "ENOENT"
      ? "rsync not found. Install rsync or set CONTROL_CENTER_RSYNC_PATH."
      : `Failed to run rsync. ${err instanceof Error ? err.message : String(err)}`;
    throw new RemoteExecError("tool_missing", message);
  }

  if (result.timedOut) {
    throw new RemoteExecError("timeout", "Remote upload timed out.", {
      localPath,
      remotePath,
      timeoutMs: rsyncTimeoutMs(),
    });
  }
  if (result.exitCode !== 0) {
    throw new RemoteExecError("sync_failed", "Remote upload failed.", {
      localPath,
      remotePath,
      exitCode: result.exitCode,
      stdout: truncate(result.stdout),
      stderr: truncate(result.stderr),
    });
  }
}

export async function remoteDownload(
  projectId: string,
  remotePath: string,
  localPath: string,
  options?: RemoteSyncOptions
): Promise<void> {
  const target = resolveVmTarget(projectId);
  await ensureLocalTool(RSYNC_COMMAND, "rsync");
  await ensureRemoteTool(target, "rsync");

  const remote = resolveRemotePath(remotePath, { allowAbsolute: options?.allowAbsolute });
  assertNoAbsoluteDelete("Remote download", options?.allowDelete, remote);
  const localResolved = path.resolve(localPath);
  const localExists = fs.existsSync(localResolved);
  let localStat: fs.Stats | null = null;
  if (localExists) {
    try {
      localStat = fs.lstatSync(localResolved);
    } catch (err) {
      throw new RemoteExecError(
        fsErrorCode(err),
        `Failed to read local path "${localPath}".`,
        fsErrorDetails(err, localResolved)
      );
    }
  }
  const localIsDir = localStat?.isDirectory() ?? remote.isDirHint;
  const remoteIsDir = localIsDir || remote.isDirHint;

  if (localResolved === path.parse(localResolved).root) {
    throw new RemoteExecError(
      "invalid_path",
      `Local path "${localPath}" resolves to filesystem root; refusing to sync.`
    );
  }

  if (!localExists) {
    ensureLocalDir(localIsDir ? localResolved : path.dirname(localResolved));
  }

  if (!remoteIsDir && remote.fullPath === remote.root) {
    throw new RemoteExecError(
      "invalid_path",
      "Remote download path must include a file name when syncing a file."
    );
  }

  const deleteArgs = buildDeleteArgs(
    options?.allowDelete,
    remoteIsDir,
    localIsDir,
    "Remote download"
  );
  const rsyncArgs = [
    "-az",
    ...deleteArgs,
    ...DEFAULT_EXCLUDES.flatMap((pattern) => ["--exclude", pattern]),
    "-e",
    buildRsyncShell(target),
    formatRsyncRemote(target, remote.fullPath, remoteIsDir),
    formatRsyncSource(localResolved, localIsDir),
  ];

  let result: CommandResult;
  try {
    result = await runCommand(RSYNC_COMMAND, rsyncArgs, { timeoutMs: rsyncTimeoutMs() });
  } catch (err) {
    const message = isErrnoException(err) && err.code === "ENOENT"
      ? "rsync not found. Install rsync or set CONTROL_CENTER_RSYNC_PATH."
      : `Failed to run rsync. ${err instanceof Error ? err.message : String(err)}`;
    throw new RemoteExecError("tool_missing", message);
  }

  if (result.timedOut) {
    throw new RemoteExecError("timeout", "Remote download timed out.", {
      localPath,
      remotePath,
      timeoutMs: rsyncTimeoutMs(),
    });
  }
  if (result.exitCode !== 0) {
    throw new RemoteExecError("sync_failed", "Remote download failed.", {
      localPath,
      remotePath,
      exitCode: result.exitCode,
      stdout: truncate(result.stdout),
      stderr: truncate(result.stderr),
    });
  }
}

export const __test__ = {
  resolveRemotePath,
  resolveLocalPath,
  buildEnvPrefix,
  assertNoAbsoluteDelete,
};
