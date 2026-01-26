import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { getShiftByProjectId, updateShift, type ShiftRow } from "./db.js";

type ShiftLogTail = { lines: string[]; has_more: boolean; log_path: string };

const DEFAULT_ALLOWED_TOOLS =
  "Read,Edit,Bash,Glob,Grep,WebFetch,WebSearch";
const DEFAULT_SHIFT_TIMEOUT_MINUTES = 120;

function resolveApiBaseUrl(): string {
  const baseUrl = (process.env.CONTROL_CENTER_API_URL || "").trim();
  if (baseUrl) return baseUrl;
  const port = Number(process.env.CONTROL_CENTER_PORT || 4010);
  return `http://localhost:${port}`;
}

function resolveClaudePath(): string {
  const cliPath = (process.env.CONTROL_CENTER_SHIFT_CLAUDE_PATH || "").trim();
  return cliPath || "claude";
}

function resolveAllowedTools(): string {
  const allowed = (process.env.CONTROL_CENTER_SHIFT_ALLOWED_TOOLS || "").trim();
  return allowed || DEFAULT_ALLOWED_TOOLS;
}

function resolveModel(): string | null {
  const model = (process.env.CONTROL_CENTER_SHIFT_MODEL || "").trim();
  return model || null;
}

function resolvePromptPath(projectPath: string): string {
  const override = (process.env.CONTROL_CENTER_SHIFT_PROMPT_FILE || "").trim();
  if (override) return override;
  const projectPrompt = path.join(projectPath, "prompts", "shift_agent.md");
  if (fs.existsSync(projectPrompt)) return projectPrompt;
  return path.join(process.cwd(), "prompts", "shift_agent.md");
}

function renderShiftPrompt(params: {
  projectId: string;
  baseUrl: string;
  timeoutMinutes: number;
  promptPath: string;
}): string {
  const template = fs.readFileSync(params.promptPath, "utf8");
  return template
    .replaceAll("{project_id}", params.projectId)
    .replaceAll("{base_url}", params.baseUrl)
    .replaceAll("{shift_timeout_minutes}", String(params.timeoutMinutes));
}

function resolveShiftTimeoutMinutes(shift: ShiftRow): number {
  if (!shift.expires_at) return DEFAULT_SHIFT_TIMEOUT_MINUTES;
  const startedAt = Date.parse(shift.started_at);
  const expiresAt = Date.parse(shift.expires_at);
  if (!Number.isFinite(startedAt) || !Number.isFinite(expiresAt)) {
    return DEFAULT_SHIFT_TIMEOUT_MINUTES;
  }
  const minutes = Math.round((expiresAt - startedAt) / 60_000);
  return minutes > 0 ? minutes : DEFAULT_SHIFT_TIMEOUT_MINUTES;
}

export function resolveShiftLogPaths(projectPath: string, shiftId: string): {
  absolutePath: string;
  relativePath: string;
} {
  const relativePath = path.join(".system", "shifts", shiftId, "agent.log");
  return {
    relativePath,
    absolutePath: path.join(projectPath, relativePath),
  };
}

function appendShiftLog(logPath: string, message: string): void {
  try {
    fs.appendFileSync(logPath, `${message}\n`);
  } catch {
    // Best-effort logging only.
  }
}

function recordSpawnFailure(params: {
  projectId: string;
  shiftId: string;
  logPath: string;
  error: unknown;
}): void {
  const message =
    params.error instanceof Error ? params.error.message : String(params.error);
  appendShiftLog(params.logPath, `[spawn-error] ${message}`);
  const shift = getShiftByProjectId(params.projectId, params.shiftId);
  if (!shift || shift.status !== "active") return;
  updateShift(shift.id, {
    status: "failed",
    completed_at: new Date().toISOString(),
    error: message,
  });
}

function terminateProcess(pid: number): void {
  try {
    if (process.platform === "win32") {
      process.kill(pid);
    } else {
      process.kill(-pid, "SIGTERM");
    }
  } catch {
    // Ignore if process already exited.
  }
}

function scheduleShiftTimeout(params: {
  projectId: string;
  shiftId: string;
  pid: number;
  expiresAt: string | null;
  logPath: string;
}): void {
  if (!params.expiresAt) return;
  const expiresAtMs = Date.parse(params.expiresAt);
  if (!Number.isFinite(expiresAtMs)) return;
  const delayMs = Math.max(0, expiresAtMs - Date.now());
  const timer = setTimeout(() => {
    const shift = getShiftByProjectId(params.projectId, params.shiftId);
    if (!shift || shift.status !== "active") return;
    updateShift(shift.id, {
      status: "expired",
      completed_at: new Date().toISOString(),
      error: "Shift expired",
    });
    appendShiftLog(
      params.logPath,
      `[timeout] Shift expired; terminating pid ${params.pid}`
    );
    terminateProcess(params.pid);
  }, delayMs);
  if (typeof timer.unref === "function") timer.unref();
}

export function spawnShiftAgent(params: {
  projectId: string;
  projectPath: string;
  shift: ShiftRow;
}): { pid: number; log_path: string } {
  const { absolutePath, relativePath } = resolveShiftLogPaths(
    params.projectPath,
    params.shift.id
  );
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  const promptPath = resolvePromptPath(params.projectPath);
  if (!fs.existsSync(promptPath)) {
    throw new Error(`Shift prompt not found at ${promptPath}`);
  }
  const baseUrl = resolveApiBaseUrl();
  const prompt = renderShiftPrompt({
    projectId: params.projectId,
    baseUrl,
    timeoutMinutes: resolveShiftTimeoutMinutes(params.shift),
    promptPath,
  });
  const logFd = fs.openSync(absolutePath, "a");
  const model = resolveModel();
  const args = [
    "--dangerously-skip-permissions",
    "--allowedTools",
    resolveAllowedTools(),
    "--output-format",
    "stream-json",
  ];
  if (model) {
    args.push("--model", model);
  }
  args.push("-p", prompt);
  const child = spawn(
    resolveClaudePath(),
    args,
    {
      cwd: params.projectPath,
      env: {
        ...process.env,
        CONTROL_CENTER_API_URL: baseUrl,
        PCC_SHIFT_ID: params.shift.id,
      },
      stdio: ["ignore", logFd, logFd],
      detached: true,
    }
  );
  fs.closeSync(logFd);
  child.once("error", (error) => {
    recordSpawnFailure({
      projectId: params.projectId,
      shiftId: params.shift.id,
      logPath: absolutePath,
      error,
    });
  });
  if (!child.pid) {
    const error = new Error("Shift agent failed to start");
    recordSpawnFailure({
      projectId: params.projectId,
      shiftId: params.shift.id,
      logPath: absolutePath,
      error,
    });
    throw error;
  }
  scheduleShiftTimeout({
    projectId: params.projectId,
    shiftId: params.shift.id,
    pid: child.pid,
    expiresAt: params.shift.expires_at,
    logPath: absolutePath,
  });
  child.unref();
  return { pid: child.pid, log_path: relativePath };
}

function tailLines(
  filePath: string,
  maxLines: number,
  maxBytes = 24_000
): { lines: string[]; has_more: boolean } {
  try {
    const stat = fs.statSync(filePath);
    const start = Math.max(0, stat.size - maxBytes);
    const fd = fs.openSync(filePath, "r");
    const buf = Buffer.alloc(stat.size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    fs.closeSync(fd);
    const text = buf.toString("utf8");
    let lines = text.split(/\r?\n/);
    if (lines.length && lines[lines.length - 1] === "") {
      lines = lines.slice(0, -1);
    }
    const hasMore = stat.size > maxBytes || lines.length > maxLines;
    return { lines: lines.slice(-maxLines), has_more: hasMore };
  } catch {
    return { lines: [], has_more: false };
  }
}

export function tailShiftLog(
  projectPath: string,
  shiftId: string,
  lineCount: number
): ShiftLogTail {
  const { absolutePath, relativePath } = resolveShiftLogPaths(projectPath, shiftId);
  const safeLines = Math.max(1, Math.min(500, Math.trunc(lineCount)));
  const tail = tailLines(absolutePath, safeLines);
  return { ...tail, log_path: relativePath };
}
