import { spawn, spawnSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import {
  findProjectById,
  getProjectVm,
  updateProjectVm,
  upsertProjectVm,
  type ProjectVmProvider,
  type ProjectVmPatch,
  type ProjectVmRow,
  type ProjectVmSize,
  type ProjectVmStatus,
} from "./db.js";
import { RemoteExecError, remoteExec, remoteUpload } from "./remote_exec.js";
import { slugify } from "./utils.js";

export type VMConfig = {
  projectId: string;
  size: ProjectVmSize;
  zone?: string;
  image?: string;
  gcpProject?: string;
  repoPath?: string;
};

export type VMInstance = {
  id: string;
  projectId: string;
  gcpInstanceName: string;
  externalIp: string | null;
  internalIp: string | null;
  status: ProjectVmStatus;
  size: ProjectVmSize;
  createdAt: string;
};

type CommandResult = {
  stdout: string;
  stderr: string;
  exitCode: number | null;
};

type SshConfig = {
  user: string;
  keyPath: string;
  publicKey: string;
};

type GcpConfig = {
  project: string;
  zone: string;
  image: {
    name: string | null;
    family: string;
    project: string;
  };
  ssh: SshConfig | null;
};

type InstanceDetails = {
  id: string;
  name: string;
  status: string;
  externalIp: string | null;
  internalIp: string | null;
};

export class VmManagerError extends Error {
  code: "preflight" | "not_provisioned" | "command_failed" | "ssh_failed" | "not_found";

  constructor(code: VmManagerError["code"], message: string) {
    super(message);
    this.code = code;
  }
}

const MACHINE_TYPES: Record<ProjectVmSize, string> = {
  small: "e2-small",
  medium: "e2-medium",
  large: "e2-standard-4",
  xlarge: "e2-standard-8",
};

const GCLOUD_COMMAND = process.env.CONTROL_CENTER_GCLOUD_PATH || "gcloud";
const SSH_COMMAND = process.env.CONTROL_CENTER_SSH_PATH || "ssh";
const DEFAULT_VM_REPO_ROOT = "/home/project/repo";
const VM_PROVIDER: ProjectVmProvider = "gcp";
const PROVISIONING_ALLOWED_VM_STATUSES: ProjectVmStatus[] = [
  "provisioning",
  "installing",
  "syncing",
  "installing_deps",
  "running",
];
const SSH_USER_ENV = "CONTROL_CENTER_GCP_SSH_USER";
const SSH_KEY_ENV = "CONTROL_CENTER_GCP_SSH_KEY_PATH";
const GCP_PROJECT_ENV = "CONTROL_CENTER_GCP_PROJECT";
const GCP_ZONE_ENV = "CONTROL_CENTER_GCP_ZONE";
const GCP_IMAGE_ENV = "CONTROL_CENTER_GCP_IMAGE";
const DEFAULT_IMAGE_FAMILY =
  process.env.CONTROL_CENTER_GCP_IMAGE_FAMILY || "ubuntu-2204-lts";
const IMAGE_PROJECT_OVERRIDE = process.env.CONTROL_CENTER_GCP_IMAGE_PROJECT?.trim() || "";
const DEFAULT_IMAGE_PROJECT = IMAGE_PROJECT_OVERRIDE || "ubuntu-os-cloud";

function nowIso(): string {
  return new Date().toISOString();
}

function resolveVmRepoRoot(): string {
  const root = (process.env.CONTROL_CENTER_VM_REPO_ROOT || DEFAULT_VM_REPO_ROOT).trim();
  if (!root.startsWith("/")) {
    throw new VmManagerError(
      "preflight",
      `VM repo root must be an absolute POSIX path. Got "${root}".`
    );
  }
  const normalized = path.posix.normalize(root);
  if (normalized.includes("..")) {
    throw new VmManagerError(
      "preflight",
      `VM repo root must not include traversal segments. Got "${root}".`
    );
  }
  return normalized.replace(/\/+$/g, "") || "/";
}

function truncate(value: string, maxLength = 500): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 3)}...`;
}

function commandOutput(result: CommandResult): string {
  const primary = result.stderr.trim() || result.stdout.trim();
  return truncate(primary.replace(/\s+/g, " ").trim());
}

function buildCommandLabel(command: string, args: string[]): string {
  return `${command} ${args.join(" ")}`.trim();
}

function shellEscape(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function isErrnoException(err: unknown): err is NodeJS.ErrnoException {
  return typeof err === "object" && err !== null && "code" in err;
}

function isNotFoundOutput(message: string): boolean {
  const lowered = message.toLowerCase();
  return lowered.includes("not found") || lowered.includes("was not found");
}

function isAlreadyExistsOutput(message: string): boolean {
  const lowered = message.toLowerCase();
  return lowered.includes("already exists");
}

function defaultVmRow(projectId: string): ProjectVmRow {
  return {
    project_id: projectId,
    provider: null,
    repo_path: null,
    gcp_instance_id: null,
    gcp_instance_name: null,
    gcp_project: null,
    gcp_zone: null,
    external_ip: null,
    internal_ip: null,
    status: "not_provisioned",
    size: null,
    created_at: null,
    last_started_at: null,
    last_activity_at: null,
    last_error: null,
    total_hours_used: 0,
  };
}

function ensureVmRow(projectId: string): ProjectVmRow {
  const existing = getProjectVm(projectId);
  if (existing) return existing;
  const row = defaultVmRow(projectId);
  upsertProjectVm(row);
  return row;
}

function resolveProjectRepoPath(config: VMConfig): string {
  if (config.repoPath?.trim()) return config.repoPath;
  const project = findProjectById(config.projectId);
  if (!project?.path) {
    throw new VmManagerError(
      "preflight",
      "Project repo path not found. Re-scan the project before provisioning."
    );
  }
  return project.path;
}

function ensureLocalRepoPath(repoPath: string): string {
  const resolved = path.resolve(repoPath);
  let stats: fs.Stats;
  try {
    stats = fs.statSync(resolved);
  } catch {
    throw new VmManagerError("preflight", `Project repo path not found at ${resolved}.`);
  }
  if (!stats.isDirectory()) {
    throw new VmManagerError(
      "preflight",
      `Project repo path ${resolved} must be a directory.`
    );
  }
  return resolved;
}

function buildInstanceName(projectId: string): string {
  const safe = slugify(projectId) || "project";
  const suffix = safe.split("-").at(-1) || safe.slice(-6) || "vm";
  const prefixBase = safe.slice(0, Math.max(0, safe.length - suffix.length)).replace(/-+$/g, "");
  const maxPrefix = 63 - ("pcc-".length + 1 + suffix.length);
  const trimmedPrefix =
    maxPrefix > 0 ? (prefixBase || "project").slice(0, maxPrefix).replace(/-+$/g, "") : "";
  const parts = ["pcc", trimmedPrefix, suffix].filter(Boolean);
  return parts.join("-").slice(0, 63);
}

function mapInstanceStatus(status: string): ProjectVmStatus {
  const normalized = status.toUpperCase();
  if (normalized === "RUNNING") return "running";
  if (normalized === "TERMINATED" || normalized === "STOPPED") return "stopped";
  if (
    normalized === "PROVISIONING" ||
    normalized === "STAGING" ||
    normalized === "REPAIRING" ||
    normalized === "STOPPING" ||
    normalized === "SUSPENDING"
  ) {
    return "provisioning";
  }
  return "error";
}

function parseNumberEnv(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function sshTimeoutMs(): number {
  const seconds = parseNumberEnv(process.env.CONTROL_CENTER_VM_SSH_TIMEOUT_SEC, 180);
  return Math.round(seconds * 1000);
}

function sshRetryMs(): number {
  return parseNumberEnv(process.env.CONTROL_CENTER_VM_SSH_RETRY_MS, 2500);
}

function extractRemoteDetail(details: Record<string, unknown> | undefined, key: string): string | null {
  if (!details) return null;
  const value = details[key];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function wrapRemoteError(context: string, err: unknown): VmManagerError {
  if (err instanceof RemoteExecError) {
    const stderr = extractRemoteDetail(err.details, "stderr");
    const stdout = extractRemoteDetail(err.details, "stdout");
    const detail = stderr || stdout;
    const suffix = detail ? ` ${detail}` : "";
    const code: VmManagerError["code"] =
      err.code === "ssh_failed"
        ? "ssh_failed"
        : err.code === "not_running" || err.code === "not_configured"
          ? "not_provisioned"
          : err.code === "preflight" || err.code === "tool_missing"
            ? "preflight"
            : "command_failed";
    return new VmManagerError(code, `${context}: ${err.message}${suffix}`);
  }
  const message = err instanceof Error ? err.message : String(err);
  return new VmManagerError("command_failed", `${context}: ${message}`);
}

function buildPrereqInstallScript(): string {
  return [
    "set -e",
    // Create project directory with proper permissions
    "if [ ! -d /home/project ]; then",
    "  sudo -n mkdir -p /home/project",
    "  sudo -n chown $(whoami):$(whoami) /home/project",
    "fi",
    // Check for missing tools
    "missing=''",
    "for tool in git rsync node npm python3 docker; do",
    "  if ! command -v \"$tool\" >/dev/null 2>&1; then",
    "    missing=\"$missing $tool\"",
    "  fi",
    "done",
    "if [ -z \"$missing\" ]; then",
    "  exit 0",
    "fi",
    // Install missing tools
    "if command -v apt-get >/dev/null 2>&1; then",
    "  sudo -n apt-get update -y",
    "  sudo -n apt-get install -y git rsync nodejs python3 docker.io",
    "  if command -v systemctl >/dev/null 2>&1; then sudo -n systemctl enable --now docker >/dev/null 2>&1 || true; fi",
    "elif command -v yum >/dev/null 2>&1; then",
    "  sudo -n yum install -y git rsync nodejs npm python3 docker",
    "  if command -v systemctl >/dev/null 2>&1; then sudo -n systemctl enable --now docker >/dev/null 2>&1 || true; fi",
    "elif command -v dnf >/dev/null 2>&1; then",
    "  sudo -n dnf install -y git rsync nodejs npm python3 docker",
    "  if command -v systemctl >/dev/null 2>&1; then sudo -n systemctl enable --now docker >/dev/null 2>&1 || true; fi",
    "else",
    "  echo \"Missing tools:$missing. Install git, rsync, node, npm, python3, docker manually.\" >&2",
    "  exit 1",
    "fi",
  ].join("\n");
}

async function ensureVmPrereqs(projectId: string): Promise<void> {
  const script = buildPrereqInstallScript();
  try {
    await remoteExec(projectId, `bash -lc ${shellEscape(script)}`, {
      allowVmStatuses: PROVISIONING_ALLOWED_VM_STATUSES,
    });
  } catch (err) {
    throw wrapRemoteError("Failed to install VM prerequisites", err);
  }
}

async function syncVmRepo(projectId: string, repoPath: string): Promise<void> {
  try {
    await remoteUpload(projectId, repoPath, ".", {
      allowDelete: true,
      exclude: [".system", "*.db*"],
      allowVmStatuses: PROVISIONING_ALLOWED_VM_STATUSES,
    });
  } catch (err) {
    throw wrapRemoteError("Failed to sync repo to VM", err);
  }
}

async function installVmDependencies(projectId: string): Promise<void> {
  try {
    await remoteExec(projectId, "npm ci", {
      allowVmStatuses: PROVISIONING_ALLOWED_VM_STATUSES,
    });
  } catch (err) {
    throw wrapRemoteError("Failed to install dependencies on VM", err);
  }
}

function resolveSshConfig(): SshConfig {
  const user = process.env[SSH_USER_ENV]?.trim();
  if (!user) {
    throw new VmManagerError(
      "preflight",
      `SSH user not configured. Set ${SSH_USER_ENV} to the login user.`
    );
  }
  if (!/^[a-z][a-z0-9_-]{0,31}$/i.test(user)) {
    throw new VmManagerError(
      "preflight",
      `SSH user "${user}" is invalid. Use a short UNIX-style username.`
    );
  }

  const keyPathRaw = process.env[SSH_KEY_ENV]?.trim();
  if (!keyPathRaw) {
    throw new VmManagerError(
      "preflight",
      `SSH key path not configured. Set ${SSH_KEY_ENV} to a private key path.`
    );
  }

  const keyPath = path.resolve(keyPathRaw);
  if (!fs.existsSync(keyPath)) {
    throw new VmManagerError(
      "preflight",
      `SSH key not found at ${keyPath}. Provide a valid private key path.`
    );
  }

  const pubPath = fs.existsSync(`${keyPath}.pub`) ? `${keyPath}.pub` : null;
  if (!pubPath || !fs.existsSync(pubPath)) {
    throw new VmManagerError(
      "preflight",
      `SSH public key not found at ${keyPath}.pub. Generate the public key before provisioning.`
    );
  }

  const publicKey = fs.readFileSync(pubPath, "utf8").trim();
  if (!publicKey) {
    throw new VmManagerError("preflight", `SSH public key at ${pubPath} is empty.`);
  }

  return { user, keyPath, publicKey };
}

async function runCommand(
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
      if (timedOut) {
        reject(new Error(`Command timed out after ${options?.timeoutMs}ms`));
        return;
      }
      resolve({ stdout, stderr, exitCode: code });
    });
  });
}

async function ensureGcloudInstalled(): Promise<void> {
  try {
    const result = await runCommand(GCLOUD_COMMAND, ["--version"], { timeoutMs: 8000 });
    if (result.exitCode !== 0) {
      throw new VmManagerError(
        "preflight",
        `Unable to run gcloud. ${commandOutput(result) || "Check your installation."}`
      );
    }
  } catch (err) {
    const message = isErrnoException(err) && err.code === "ENOENT"
      ? "gcloud CLI not found. Install the Google Cloud SDK and ensure `gcloud` is on PATH."
      : `Failed to run gcloud. ${err instanceof Error ? err.message : String(err)}`;
    throw new VmManagerError("preflight", message);
  }
}

async function ensureGcloudAuth(): Promise<void> {
  const args = ["auth", "list", "--filter=status:ACTIVE", "--format=value(account)"];
  const result = await runCommand(GCLOUD_COMMAND, args, { timeoutMs: 8000 });
  if (result.exitCode !== 0) {
    throw new VmManagerError(
      "preflight",
      `Unable to check gcloud auth. ${commandOutput(result) || "Run gcloud auth login."}`
    );
  }
  if (!result.stdout.trim()) {
    throw new VmManagerError(
      "preflight",
      "No active gcloud credentials. Run `gcloud auth login` and retry."
    );
  }
}

async function gcloudConfigValue(key: string): Promise<string | null> {
  const result = await runCommand(GCLOUD_COMMAND, ["config", "get-value", key, "--quiet"], {
    timeoutMs: 8000,
  });
  if (result.exitCode !== 0) return null;
  const value = result.stdout.trim();
  if (!value || value === "(unset)") return null;
  return value;
}

async function resolveGcpProject(override?: string): Promise<string> {
  const fromEnv = override?.trim() || process.env[GCP_PROJECT_ENV]?.trim();
  if (fromEnv) return fromEnv;
  const fromConfig = await gcloudConfigValue("project");
  if (fromConfig) return fromConfig;
  throw new VmManagerError(
    "preflight",
    `GCP project not configured. Set ${GCP_PROJECT_ENV} or run \`gcloud config set project <id>\`.`
  );
}

async function resolveGcpZone(override?: string): Promise<string> {
  const fromEnv = override?.trim() || process.env[GCP_ZONE_ENV]?.trim();
  if (fromEnv) return fromEnv;
  const fromConfig = await gcloudConfigValue("compute/zone");
  if (fromConfig) return fromConfig;
  throw new VmManagerError(
    "preflight",
    `GCP zone not configured. Set ${GCP_ZONE_ENV} or run \`gcloud config set compute/zone <zone>\`.`
  );
}

function resolveImageConfig(override?: string): GcpConfig["image"] {
  const imageName = override?.trim() || process.env[GCP_IMAGE_ENV]?.trim() || null;
  return {
    name: imageName,
    family: DEFAULT_IMAGE_FAMILY,
    project: imageName ? IMAGE_PROJECT_OVERRIDE : DEFAULT_IMAGE_PROJECT,
  };
}

async function resolveGcpConfig(params: {
  zoneOverride?: string;
  imageOverride?: string;
  projectOverride?: string;
  requireSsh?: boolean;
}): Promise<GcpConfig> {
  await ensureGcloudInstalled();
  await ensureGcloudAuth();
  const project = await resolveGcpProject(params.projectOverride);
  const zone = await resolveGcpZone(params.zoneOverride);
  const image = resolveImageConfig(params.imageOverride);
  const ssh = params.requireSsh ? resolveSshConfig() : null;
  return { project, zone, image, ssh };
}

async function describeInstance(params: {
  instanceName: string;
  zone: string;
  project: string;
}): Promise<InstanceDetails | null> {
  const args = [
    "compute",
    "instances",
    "describe",
    params.instanceName,
    "--project",
    params.project,
    "--zone",
    params.zone,
    "--format=json",
  ];
  const result = await runCommand(GCLOUD_COMMAND, args, { timeoutMs: 15000 });
  if (result.exitCode !== 0) {
    const output = commandOutput(result);
    if (isNotFoundOutput(output)) return null;
    throw new VmManagerError(
      "command_failed",
      `Failed to describe instance. ${output || buildCommandLabel(GCLOUD_COMMAND, args)}`
    );
  }

  let data: Record<string, unknown>;
  try {
    data = JSON.parse(result.stdout);
  } catch (err) {
    throw new VmManagerError(
      "command_failed",
      `Unable to parse gcloud response. ${err instanceof Error ? err.message : String(err)}`
    );
  }

  const networkInterfaces = Array.isArray(data.networkInterfaces)
    ? (data.networkInterfaces as Array<Record<string, unknown>>)
    : [];
  const nic = networkInterfaces[0] ?? {};
  const accessConfigs = Array.isArray(nic.accessConfigs)
    ? (nic.accessConfigs as Array<Record<string, unknown>>)
    : [];
  const accessConfig = accessConfigs[0] ?? {};

  return {
    id: String(data.id ?? ""),
    name: String(data.name ?? params.instanceName),
    status: String(data.status ?? ""),
    externalIp: typeof accessConfig.natIP === "string" ? accessConfig.natIP : null,
    internalIp: typeof nic.networkIP === "string" ? nic.networkIP : null,
  };
}

function updateKnownHosts(host: string): void {
  const knownHostsPath = path.join(os.homedir(), ".ssh", "known_hosts");

  // Remove old entries for this host
  if (fs.existsSync(knownHostsPath)) {
    try {
      const content = fs.readFileSync(knownHostsPath, "utf8");
      const lines = content.split("\n");
      const filtered = lines.filter((line) => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) return true;
        // Line format: "host key-type key [comment]" or "[host]:port key-type key"
        const hostPart = trimmed.split(/\s+/)[0] || "";
        return hostPart !== host && !hostPart.startsWith(`${host},`) && hostPart !== `[${host}]`;
      });
      fs.writeFileSync(knownHostsPath, filtered.join("\n"), "utf8");
    } catch {
      // Ignore errors removing old entries
    }
  }

  // Get new host key via ssh-keyscan
  const keyscan = spawnSync("ssh-keyscan", ["-t", "ed25519,rsa", "-H", host], {
    timeout: 10000,
    encoding: "utf8",
  });

  if (keyscan.status !== 0 || !keyscan.stdout?.trim()) {
    // Fall back to non-hashed scan
    const keyscanUnhashed = spawnSync("ssh-keyscan", ["-t", "ed25519,rsa", host], {
      timeout: 10000,
      encoding: "utf8",
    });
    if (keyscanUnhashed.status !== 0 || !keyscanUnhashed.stdout?.trim()) {
      // ssh-keyscan failed, but don't fail provisioning - SSH might still work
      return;
    }
    fs.appendFileSync(knownHostsPath, keyscanUnhashed.stdout);
    return;
  }

  fs.appendFileSync(knownHostsPath, keyscan.stdout);
}

async function waitForSshReady(params: { host: string; ssh: SshConfig }): Promise<void> {
  const deadline = Date.now() + sshTimeoutMs();
  const retryDelay = sshRetryMs();
  let lastOutput = "";

  while (Date.now() < deadline) {
    const args = [
      "-i",
      params.ssh.keyPath,
      "-o",
      "BatchMode=yes",
      "-o",
      "StrictHostKeyChecking=no",
      "-o",
      "UserKnownHostsFile=/dev/null",
      "-o",
      "ConnectTimeout=10",
      `${params.ssh.user}@${params.host}`,
      "echo",
      "ready",
    ];
    let result: CommandResult;
    try {
      result = await runCommand(SSH_COMMAND, args, { timeoutMs: 15000 });
    } catch (err) {
      if (isErrnoException(err) && err.code === "ENOENT") {
        throw new VmManagerError(
          "preflight",
          "ssh client not found. Install OpenSSH or set CONTROL_CENTER_SSH_PATH."
        );
      }
      throw err;
    }
    if (result.exitCode === 0) return;
    lastOutput = commandOutput(result);
    if (retryDelay > 0) {
      await new Promise((resolve) => setTimeout(resolve, retryDelay));
    }
  }

  const details = lastOutput ? ` Last error: ${lastOutput}.` : "";
  throw new VmManagerError(
    "ssh_failed",
    `SSH did not become ready in time.${details} Check firewall rules and SSH credentials.`
  );
}

function updateVm(projectId: string, patch: ProjectVmPatch): ProjectVmRow | null {
  return updateProjectVm(projectId, patch);
}

function recordVmError(projectId: string, err: unknown): void {
  const vm = ensureVmRow(projectId);
  const message = err instanceof Error ? err.message : String(err);
  const now = nowIso();
  const patch: ProjectVmPatch = { last_error: message, last_activity_at: now };

  if (err instanceof VmManagerError) {
    if (err.code === "not_found") {
      patch.status = "deleted";
      patch.external_ip = null;
      patch.internal_ip = null;
    } else if (err.code === "not_provisioned") {
      patch.status = vm.status;
    } else {
      patch.status = "error";
    }
  } else {
    patch.status = "error";
  }

  updateVm(projectId, patch);
}

async function withVmAction<T>(projectId: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    recordVmError(projectId, err);
    throw err;
  }
}

async function requireInstanceDetails(params: {
  instanceName: string;
  zone: string;
  project: string;
}): Promise<InstanceDetails> {
  const details = await describeInstance(params);
  if (!details) {
    throw new VmManagerError(
      "not_found",
      "VM instance not found. It may have been deleted; reprovision to continue."
    );
  }
  return details;
}

async function createInstance(params: {
  instanceName: string;
  size: ProjectVmSize;
  gcp: GcpConfig;
}): Promise<void> {
  const args = [
    "compute",
    "instances",
    "create",
    params.instanceName,
    "--project",
    params.gcp.project,
    "--zone",
    params.gcp.zone,
    "--machine-type",
    MACHINE_TYPES[params.size],
    "--quiet",
  ];

  if (params.gcp.image.name) {
    args.push("--image", params.gcp.image.name);
    if (params.gcp.image.project) {
      args.push("--image-project", params.gcp.image.project);
    }
  } else {
    args.push("--image-family", params.gcp.image.family);
    args.push("--image-project", params.gcp.image.project);
  }

  if (params.gcp.ssh) {
    args.push(`--metadata=ssh-keys=${params.gcp.ssh.user}:${params.gcp.ssh.publicKey}`);
  }

  const result = await runCommand(GCLOUD_COMMAND, args, { timeoutMs: 180000 });
  if (result.exitCode !== 0) {
    const output = commandOutput(result);
    if (isAlreadyExistsOutput(output)) return;
    throw new VmManagerError(
      "command_failed",
      `Failed to create instance. ${output || buildCommandLabel(GCLOUD_COMMAND, args)}`
    );
  }
}

export async function provisionVM(config: VMConfig): Promise<ProjectVmRow> {
  return withVmAction(config.projectId, async () => {
    const repoPath = ensureLocalRepoPath(resolveProjectRepoPath(config));
    const vm = ensureVmRow(config.projectId);
    const gcp = await resolveGcpConfig({
      zoneOverride: config.zone,
      imageOverride: config.image,
      projectOverride: config.gcpProject,
      requireSsh: true,
    });
    const instanceName = vm.gcp_instance_name || buildInstanceName(config.projectId);
    const repoRoot = resolveVmRepoRoot();
    const now = nowIso();

    updateVm(config.projectId, {
      status: "provisioning",
      size: config.size,
      gcp_instance_name: instanceName,
      gcp_project: gcp.project,
      gcp_zone: gcp.zone,
      provider: VM_PROVIDER,
      repo_path: repoRoot,
      created_at: vm.created_at ?? now,
      last_activity_at: now,
      last_error: null,
    });

    await createInstance({ instanceName, size: config.size, gcp });

    const details = await requireInstanceDetails({
      instanceName,
      zone: gcp.zone,
      project: gcp.project,
    });

    if (!details.externalIp) {
      throw new VmManagerError(
        "command_failed",
        "Instance is missing an external IP. Ensure the network allows external access."
      );
    }

    if (!gcp.ssh) {
      throw new VmManagerError("preflight", "SSH config unavailable for readiness check.");
    }

    await waitForSshReady({ host: details.externalIp, ssh: gcp.ssh });
    updateKnownHosts(details.externalIp);

    const startedAt = nowIso();
    updateVm(config.projectId, {
      status: "installing",
      gcp_instance_id: details.id,
      external_ip: details.externalIp,
      internal_ip: details.internalIp,
      last_started_at: startedAt,
      last_activity_at: startedAt,
      last_error: null,
      size: config.size,
      gcp_instance_name: instanceName,
      gcp_project: gcp.project,
      gcp_zone: gcp.zone,
      provider: VM_PROVIDER,
      repo_path: repoRoot,
    });

    await ensureVmPrereqs(config.projectId);
    updateVm(config.projectId, {
      status: "syncing",
      last_activity_at: nowIso(),
      last_error: null,
      provider: VM_PROVIDER,
      repo_path: repoRoot,
    });
    await syncVmRepo(config.projectId, repoPath);
    updateVm(config.projectId, {
      status: "installing_deps",
      last_activity_at: nowIso(),
      last_error: null,
      provider: VM_PROVIDER,
      repo_path: repoRoot,
    });
    await installVmDependencies(config.projectId);
    updateVm(config.projectId, {
      status: "running",
      last_activity_at: nowIso(),
      last_error: null,
      provider: VM_PROVIDER,
      repo_path: repoRoot,
    });

    return getProjectVm(config.projectId) ?? defaultVmRow(config.projectId);
  });
}

export async function startVM(projectId: string): Promise<ProjectVmRow> {
  return withVmAction(projectId, async () => {
    const vm = ensureVmRow(projectId);
    const instanceName = vm.gcp_instance_name || buildInstanceName(projectId);
    if (vm.status === "not_provisioned" || vm.status === "deleted") {
      updateVm(projectId, { last_error: "VM not provisioned.", last_activity_at: nowIso() });
      throw new VmManagerError("not_provisioned", "VM not provisioned. Provision it first.");
    }

    const gcp = await resolveGcpConfig({
      zoneOverride: vm.gcp_zone ?? undefined,
      projectOverride: vm.gcp_project ?? undefined,
      requireSsh: true,
    });

    const existing = await describeInstance({
      instanceName,
      zone: gcp.zone,
      project: gcp.project,
    });
    if (existing && mapInstanceStatus(existing.status) === "running") {
      if (!existing.externalIp) {
        throw new VmManagerError(
          "command_failed",
          "Instance is running but missing an external IP."
        );
      }
      if (!gcp.ssh) {
        throw new VmManagerError("preflight", "SSH config unavailable for readiness check.");
      }
      await waitForSshReady({ host: existing.externalIp, ssh: gcp.ssh });
      updateKnownHosts(existing.externalIp);
      updateVm(projectId, {
        status: "running",
        gcp_instance_id: existing.id,
        external_ip: existing.externalIp,
        internal_ip: existing.internalIp,
        last_started_at: nowIso(),
        last_activity_at: nowIso(),
        last_error: null,
        gcp_instance_name: instanceName,
        gcp_project: gcp.project,
        gcp_zone: gcp.zone,
      });
      return getProjectVm(projectId) ?? defaultVmRow(projectId);
    }

    const now = nowIso();
    updateVm(projectId, {
      status: "provisioning",
      last_activity_at: now,
      last_error: null,
      gcp_instance_name: instanceName,
      gcp_instance_id: existing?.id,
      gcp_project: gcp.project,
      gcp_zone: gcp.zone,
    });

    const args = [
      "compute",
      "instances",
      "start",
      instanceName,
      "--project",
      gcp.project,
      "--zone",
      gcp.zone,
      "--quiet",
    ];
    const result = await runCommand(GCLOUD_COMMAND, args, { timeoutMs: 120000 });
    if (result.exitCode !== 0) {
      const output = commandOutput(result);
      if (isNotFoundOutput(output)) {
        throw new VmManagerError(
          "not_found",
          "VM instance not found. It may have been deleted; reprovision to continue."
        );
      }
      throw new VmManagerError(
        "command_failed",
        `Failed to start instance. ${output || buildCommandLabel(GCLOUD_COMMAND, args)}`
      );
    }

    const details = await requireInstanceDetails({
      instanceName,
      zone: gcp.zone,
      project: gcp.project,
    });
    if (!details.externalIp) {
      throw new VmManagerError(
        "command_failed",
        "Instance is missing an external IP. Ensure the network allows external access."
      );
    }
    if (!gcp.ssh) {
      throw new VmManagerError("preflight", "SSH config unavailable for readiness check.");
    }

    await waitForSshReady({ host: details.externalIp, ssh: gcp.ssh });
    updateKnownHosts(details.externalIp);

    const startedAt = nowIso();
    updateVm(projectId, {
      status: "running",
      gcp_instance_id: details.id,
      external_ip: details.externalIp,
      internal_ip: details.internalIp,
      last_started_at: startedAt,
      last_activity_at: startedAt,
      last_error: null,
      gcp_instance_name: instanceName,
      gcp_project: gcp.project,
      gcp_zone: gcp.zone,
    });

    return getProjectVm(projectId) ?? defaultVmRow(projectId);
  });
}

export async function stopVM(projectId: string): Promise<ProjectVmRow> {
  return withVmAction(projectId, async () => {
    const vm = ensureVmRow(projectId);
    const instanceName = vm.gcp_instance_name || buildInstanceName(projectId);
    if (vm.status === "not_provisioned" || vm.status === "deleted") {
      updateVm(projectId, { last_error: "VM not provisioned.", last_activity_at: nowIso() });
      throw new VmManagerError("not_provisioned", "VM not provisioned.");
    }

    const gcp = await resolveGcpConfig({
      zoneOverride: vm.gcp_zone ?? undefined,
      projectOverride: vm.gcp_project ?? undefined,
    });

    const existing = await describeInstance({
      instanceName,
      zone: gcp.zone,
      project: gcp.project,
    });
    if (existing) {
      updateVm(projectId, {
        gcp_instance_id: existing.id,
        gcp_project: gcp.project,
        gcp_zone: gcp.zone,
        gcp_instance_name: instanceName,
      });
    }
    if (existing && mapInstanceStatus(existing.status) === "stopped") {
      updateVm(projectId, {
        status: "stopped",
        last_activity_at: nowIso(),
        last_error: null,
        gcp_instance_name: instanceName,
        gcp_instance_id: existing.id,
        gcp_project: gcp.project,
        gcp_zone: gcp.zone,
      });
      return getProjectVm(projectId) ?? defaultVmRow(projectId);
    }

    const args = [
      "compute",
      "instances",
      "stop",
      instanceName,
      "--project",
      gcp.project,
      "--zone",
      gcp.zone,
      "--quiet",
    ];
    const result = await runCommand(GCLOUD_COMMAND, args, { timeoutMs: 120000 });
    if (result.exitCode !== 0) {
      const output = commandOutput(result);
      if (isNotFoundOutput(output)) {
        throw new VmManagerError("not_found", "VM instance not found.");
      }
      throw new VmManagerError(
        "command_failed",
        `Failed to stop instance. ${output || buildCommandLabel(GCLOUD_COMMAND, args)}`
      );
    }

    updateVm(projectId, {
      status: "stopped",
      last_activity_at: nowIso(),
      last_error: null,
      gcp_instance_name: instanceName,
      gcp_project: gcp.project,
      gcp_zone: gcp.zone,
    });

    return getProjectVm(projectId) ?? defaultVmRow(projectId);
  });
}

export async function deleteVM(projectId: string): Promise<ProjectVmRow> {
  return withVmAction(projectId, async () => {
    const vm = ensureVmRow(projectId);
    const instanceName = vm.gcp_instance_name || buildInstanceName(projectId);
    if (vm.status === "not_provisioned" || vm.status === "deleted") {
      updateVm(projectId, {
        status: "deleted",
        external_ip: null,
        internal_ip: null,
        last_activity_at: nowIso(),
        last_error: null,
      });
      return getProjectVm(projectId) ?? defaultVmRow(projectId);
    }

    const gcp = await resolveGcpConfig({
      zoneOverride: vm.gcp_zone ?? undefined,
      projectOverride: vm.gcp_project ?? undefined,
    });
    const args = [
      "compute",
      "instances",
      "delete",
      instanceName,
      "--project",
      gcp.project,
      "--zone",
      gcp.zone,
      "--quiet",
    ];
    const result = await runCommand(GCLOUD_COMMAND, args, { timeoutMs: 120000 });
    if (result.exitCode !== 0) {
      const output = commandOutput(result);
      if (!isNotFoundOutput(output)) {
        throw new VmManagerError(
          "command_failed",
          `Failed to delete instance. ${output || buildCommandLabel(GCLOUD_COMMAND, args)}`
        );
      }
    }

    updateVm(projectId, {
      status: "deleted",
      external_ip: null,
      internal_ip: null,
      last_activity_at: nowIso(),
      last_error: null,
      gcp_instance_name: instanceName,
      gcp_project: gcp.project,
      gcp_zone: gcp.zone,
    });

    return getProjectVm(projectId) ?? defaultVmRow(projectId);
  });
}

export async function resizeVM(projectId: string, newSize: ProjectVmSize): Promise<ProjectVmRow> {
  return withVmAction(projectId, async () => {
    const vm = ensureVmRow(projectId);
    const instanceName = vm.gcp_instance_name || buildInstanceName(projectId);
    if (vm.status === "not_provisioned" || vm.status === "deleted") {
      updateVm(projectId, { last_error: "VM not provisioned.", last_activity_at: nowIso() });
      throw new VmManagerError("not_provisioned", "VM not provisioned.");
    }

    const gcp = await resolveGcpConfig({
      zoneOverride: vm.gcp_zone ?? undefined,
      projectOverride: vm.gcp_project ?? undefined,
    });

    const args = [
      "compute",
      "instances",
      "set-machine-type",
      instanceName,
      "--project",
      gcp.project,
      "--zone",
      gcp.zone,
      "--machine-type",
      MACHINE_TYPES[newSize],
      "--allow-stopping-for-update",
      "--quiet",
    ];
    const result = await runCommand(GCLOUD_COMMAND, args, { timeoutMs: 180000 });
    if (result.exitCode !== 0) {
      const output = commandOutput(result);
      if (isNotFoundOutput(output)) {
        throw new VmManagerError("not_found", "VM instance not found.");
      }
      throw new VmManagerError(
        "command_failed",
        `Failed to resize instance. ${output || buildCommandLabel(GCLOUD_COMMAND, args)}`
      );
    }

    const details = await requireInstanceDetails({
      instanceName,
      zone: gcp.zone,
      project: gcp.project,
    });

    const status = mapInstanceStatus(details.status);
    const patch: ProjectVmPatch = {
      status,
      size: newSize,
      gcp_instance_id: details.id,
      external_ip: details.externalIp,
      internal_ip: details.internalIp,
      last_activity_at: nowIso(),
      last_error: null,
      gcp_instance_name: instanceName,
      gcp_project: gcp.project,
      gcp_zone: gcp.zone,
    };

    if (status === "running" && details.externalIp) {
      const ssh = resolveSshConfig();
      await waitForSshReady({ host: details.externalIp, ssh });
      updateKnownHosts(details.externalIp);
      patch.last_started_at = nowIso();
    }

    updateVm(projectId, patch);

    return getProjectVm(projectId) ?? defaultVmRow(projectId);
  });
}

export async function getVMStatus(projectId: string): Promise<ProjectVmRow | null> {
  return getProjectVm(projectId);
}
