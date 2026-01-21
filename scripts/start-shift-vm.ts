import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { findProjectById, getProjectVm } from "../server/db.js";
import { startVM } from "../server/vm_manager.js";
import { remoteExec } from "../server/remote_exec.js";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");
const LOCAL_VM_PROMPT_PATH = path.join(REPO_ROOT, "prompts", "shift_agent_vm.md");
const LOCAL_START_SHIFT_PATH = path.join(REPO_ROOT, "scripts", "start-shift.sh");
const LOCAL_HEADLESS_HELPER_PATH = path.join(REPO_ROOT, "scripts", "headless-browser.mjs");
const REMOTE_SHIFT_DIR = ".pcc/shift-agent";
const REMOTE_HEADLESS_DIR = ".system/shift-agent";

function nowStamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function shellEscape(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function buildEnvAssignments(env: Record<string, string>): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(env)) {
    if (!value) continue;
    parts.push(`${key}=${shellEscape(value)}`);
  }
  return parts.join(" ");
}

function readLocalFile(filePath: string, label: string): string {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Unable to read ${label} at ${filePath}. ${message}`);
  }
}

function normalizeHereDocContent(content: string): string {
  return content.endsWith("\n") ? content.slice(0, -1) : content;
}

function pickHereDocLabel(content: string): string {
  const base = "PCC_SHIFT_EOF";
  if (!content.includes(base)) return base;
  let idx = 1;
  while (content.includes(`${base}_${idx}`)) {
    idx += 1;
  }
  return `${base}_${idx}`;
}

async function resolveRemoteHomeDir(projectId: string): Promise<string> {
  const result = await remoteExec(projectId, "bash -lc 'printf %s \"$HOME\"'", {
    cwd: ".",
  });
  const home = result.stdout.trim();
  if (!home || !home.startsWith("/")) {
    throw new Error(`Unable to resolve VM home directory (got "${home || "empty"}").`);
  }
  return home;
}

async function resolveRemoteRepoRoot(projectId: string): Promise<string> {
  const result = await remoteExec(projectId, "pwd", { cwd: "." });
  const root = result.stdout.trim();
  if (!root || !root.startsWith("/")) {
    throw new Error(`Unable to resolve VM repo root (got "${root || "empty"}").`);
  }
  return root;
}

async function writeRemoteFile(
  projectId: string,
  remotePath: string,
  content: string,
  mode?: string
): Promise<void> {
  const trimmed = normalizeHereDocContent(content);
  const label = pickHereDocLabel(trimmed);
  const dir = path.posix.dirname(remotePath);
  const lines = [
    "set -e",
    `mkdir -p ${shellEscape(dir)}`,
    `cat <<'${label}' > ${shellEscape(remotePath)}`,
    trimmed,
    label,
  ];
  if (mode) {
    lines.push(`chmod ${shellEscape(mode)} ${shellEscape(remotePath)}`);
  }
  const script = lines.join("\n");
  await remoteExec(projectId, `bash -lc ${shellEscape(script)}`, { cwd: "." });
}

async function remoteFileExists(projectId: string, filePath: string): Promise<boolean> {
  const result = await remoteExec(projectId, `test -f ${shellEscape(filePath)}`, {
    cwd: ".",
    allowFailure: true,
  });
  return result.exitCode === 0;
}

async function ensureVmRunning(projectId: string): Promise<void> {
  const vm = getProjectVm(projectId);
  if (vm?.status === "running") return;
  await startVM(projectId);
}

async function ensureClaudeAvailable(projectId: string, claudePath: string): Promise<void> {
  const command = claudePath
    ? `test -x ${shellEscape(claudePath)}`
    : "command -v claude >/dev/null 2>&1";
  const result = await remoteExec(projectId, command, {
    cwd: ".",
    allowFailure: true,
  });
  if (result.exitCode === 0) return;
  const hint = claudePath
    ? `Ensure ${claudePath} is executable on the VM.`
    : "Install the claude CLI or set CONTROL_CENTER_SHIFT_CLAUDE_PATH.";
  throw new Error(`Claude CLI unavailable on VM. ${hint}`);
}

async function ensurePlaywrightReady(projectId: string): Promise<void> {
  const check = await remoteExec(projectId, "node -e \"require.resolve('playwright')\"", {
    cwd: ".",
    allowFailure: true,
  });
  if (check.exitCode !== 0) {
    await remoteExec(
      projectId,
      "npm install --no-save --no-package-lock playwright",
      { cwd: "." }
    );
  }
  await remoteExec(projectId, "npx playwright install chromium", { cwd: "." });
}

async function run() {
  const projectId = process.argv[2] ?? "project-control-center";
  const project = findProjectById(projectId);
  if (!project) {
    throw new Error(`Project not found: ${projectId}`);
  }

  await ensureVmRunning(project.id);
  const claudePath = process.env.CONTROL_CENTER_SHIFT_CLAUDE_PATH || "";
  await ensureClaudeAvailable(project.id, claudePath);

  const timestamp = nowStamp();
  const logDir = ".system/shift-agent";
  const logPath = `${logDir}/shift-${timestamp}.log`;
  const pidPath = `${logDir}/shift-${timestamp}.pid`;

  const baseUrl = (process.env.CONTROL_CENTER_API_URL || "").trim();
  if (!baseUrl) {
    throw new Error(
      "CONTROL_CENTER_API_URL is required for VM shifts. Set it to the API base URL reachable from the VM.",
    );
  }
  const promptOverride = (process.env.CONTROL_CENTER_SHIFT_PROMPT_FILE || "").trim();
  const headlessOverride = (
    process.env.CONTROL_CENTER_SHIFT_HEADLESS_BROWSER_PATH || ""
  ).trim();
  const remoteHome = await resolveRemoteHomeDir(project.id);
  const remoteRepoRoot = await resolveRemoteRepoRoot(project.id);
  const remoteShiftDir = path.posix.join(remoteHome, REMOTE_SHIFT_DIR);
  const defaultPromptPath = path.posix.join(remoteShiftDir, "shift_agent_vm.md");
  const defaultStartShiftPath = path.posix.join(remoteShiftDir, "start-shift.sh");
  const defaultHeadlessPath = path.posix.join(
    remoteRepoRoot,
    REMOTE_HEADLESS_DIR,
    "headless-browser.mjs",
  );

  let promptFile = "";
  if (promptOverride) {
    if (await remoteFileExists(project.id, promptOverride)) {
      promptFile = promptOverride;
    } else {
      // eslint-disable-next-line no-console
      console.warn(
        `Prompt override not found on VM (${promptOverride}); falling back to default VM prompt.`,
      );
    }
  }
  if (!promptFile) {
    const promptContent = readLocalFile(LOCAL_VM_PROMPT_PATH, "VM shift prompt");
    await writeRemoteFile(project.id, defaultPromptPath, promptContent, "644");
    promptFile = defaultPromptPath;
  }

  const startShiftContent = readLocalFile(LOCAL_START_SHIFT_PATH, "start-shift script");
  await writeRemoteFile(project.id, defaultStartShiftPath, startShiftContent, "755");

  let headlessHelperPath = "";
  if (headlessOverride) {
    if (await remoteFileExists(project.id, headlessOverride)) {
      headlessHelperPath = headlessOverride;
    } else {
      // eslint-disable-next-line no-console
      console.warn(
        `Headless helper override not found on VM (${headlessOverride}); falling back to default helper.`,
      );
    }
  }
  if (!headlessHelperPath) {
    const helperContent = readLocalFile(
      LOCAL_HEADLESS_HELPER_PATH,
      "headless browser helper",
    );
    await writeRemoteFile(project.id, defaultHeadlessPath, helperContent, "755");
    headlessHelperPath = defaultHeadlessPath;
  }

  await ensurePlaywrightReady(project.id);
  const timeoutMinutes = process.env.CONTROL_CENTER_SHIFT_TIMEOUT_MINUTES || "120";
  const autoShutdownRaw = process.env.CONTROL_CENTER_SHIFT_AUTO_SHUTDOWN_MINUTES || "";
  const autoShutdownMinutes = Number.parseInt(autoShutdownRaw, 10);
  const shouldAutoShutdown =
    Number.isFinite(autoShutdownMinutes) && autoShutdownMinutes > 0;
  const allowedTools =
    process.env.CONTROL_CENTER_SHIFT_ALLOWED_TOOLS ||
    "Read,Edit,Bash,Glob,Grep,WebFetch,WebSearch";

  const envAssignments = buildEnvAssignments({
    CONTROL_CENTER_API_URL: baseUrl,
    CONTROL_CENTER_SHIFT_PROMPT_FILE: promptFile,
    CONTROL_CENTER_SHIFT_HEADLESS_BROWSER_PATH: headlessHelperPath,
    CONTROL_CENTER_SHIFT_TIMEOUT_MINUTES: timeoutMinutes,
    CONTROL_CENTER_SHIFT_ALLOWED_TOOLS: allowedTools,
    CONTROL_CENTER_SHIFT_CLAUDE_PATH: claudePath,
  });

  const autoShutdownBlock = shouldAutoShutdown
    ? [
        `if command -v shutdown >/dev/null 2>&1; then`,
        `  sudo -n shutdown -h +${autoShutdownMinutes} || true`,
        "fi",
      ].join("\n")
    : "";

  const shiftCommand = [
    envAssignments,
    shellEscape(defaultStartShiftPath),
    shellEscape(projectId),
    shellEscape(remoteRepoRoot),
  ]
    .filter(Boolean)
    .join(" ");

  const wrapped = ["set -e", autoShutdownBlock, shiftCommand]
    .filter(Boolean)
    .join("\n");

  const launchScript = [
    `mkdir -p ${shellEscape(logDir)}`,
    `nohup bash -lc ${shellEscape(wrapped)} > ${shellEscape(logPath)} 2>&1 &`,
    `echo $! > ${shellEscape(pidPath)}`,
    `echo ${shellEscape(logPath)}`,
  ].join(" && ");

  const result = await remoteExec(project.id, `bash -lc ${shellEscape(launchScript)}`, {
    cwd: ".",
  });

  const remoteLog = result.stdout.trim() || logPath;
  // eslint-disable-next-line no-console
  console.log(`Shift agent launched on VM for ${project.id}.`);
  // eslint-disable-next-line no-console
  console.log(`Remote log: ${remoteLog}`);
  // eslint-disable-next-line no-console
  console.log(`Remote pid: ${pidPath}`);
}

run().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  // eslint-disable-next-line no-console
  console.error(`Failed to start VM shift: ${message}`);
  process.exit(1);
});
