import { spawn } from "child_process";
import path from "path";
import { getControlCenterApiUrl, getProcessEnv } from "./config.js";
import {
  countReadyWorkOrders,
  countShiftsSince,
  expireStaleShifts,
  getActiveShift,
  getLatestShift,
  listAutoShiftProjects,
  startShift,
  updateShift,
  type ProjectRow,
  type ShiftRow,
} from "./db.js";
import { spawnShiftAgent } from "./shift_agent.js";
import { getShiftSchedulerSettings, type ShiftSchedulerSettings } from "./settings.js";

export type ShiftSchedulerActivity = {
  timestamp: string;
  message: string;
  project_id?: string;
};

export type ShiftSchedulerStatus = {
  state: "running" | "paused";
  enabled: boolean;
  last_check_at: string | null;
  next_check_at: string | null;
  recent_activity: ShiftSchedulerActivity[];
};

const CHECK_INTERVAL_MS = 60_000;
const ACTIVITY_LIMIT = 12;

const status: ShiftSchedulerStatus = {
  state: "paused",
  enabled: false,
  last_check_at: null,
  next_check_at: null,
  recent_activity: [],
};

let schedulerTimer: NodeJS.Timeout | null = null;
let inFlight = false;

function recordActivity(message: string, projectId?: string): void {
  status.recent_activity.unshift({
    timestamp: new Date().toISOString(),
    message,
    ...(projectId ? { project_id: projectId } : {}),
  });
  if (status.recent_activity.length > ACTIVITY_LIMIT) {
    status.recent_activity = status.recent_activity.slice(0, ACTIVITY_LIMIT);
  }
}

function parseTimeOfDay(value: string): number | null {
  const match = value.match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  if (!match) return null;
  const hours = Number.parseInt(match[1], 10);
  const minutes = Number.parseInt(match[2], 10);
  return hours * 60 + minutes;
}

function isQuietHours(now: Date, start: string, end: string): boolean {
  const startMinutes = parseTimeOfDay(start);
  const endMinutes = parseTimeOfDay(end);
  if (startMinutes === null || endMinutes === null) return false;
  if (startMinutes === endMinutes) return false;
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  if (startMinutes < endMinutes) {
    return currentMinutes >= startMinutes && currentMinutes < endMinutes;
  }
  return currentMinutes >= startMinutes || currentMinutes < endMinutes;
}

function minutesSince(value: string | null | undefined, nowMs: number): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.floor((nowMs - parsed) / 60_000);
}

function startOfDayIso(now: Date): string {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return start.toISOString();
}

function projectLabel(project: ProjectRow): string {
  return project.name ? `${project.name} (${project.id})` : project.id;
}

async function spawnVmShiftAgent(projectId: string): Promise<void> {
  const scriptPath = path.join(process.cwd(), "scripts", "start-shift-vm.sh");
  if (!getControlCenterApiUrl()) {
    throw new Error("CONTROL_CENTER_API_URL is required to start VM shifts");
  }
  await new Promise<void>((resolve, reject) => {
    const child = spawn("bash", [scriptPath, projectId], {
      stdio: ["ignore", "pipe", "pipe"],
      env: getProcessEnv(),
    });
    let stderr = "";
    child.stdout?.on("data", () => {
      // Drain stdout to avoid backpressure.
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (err) => reject(err));
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      const suffix = stderr.trim() ? `: ${stderr.trim()}` : "";
      reject(new Error(`start-shift-vm failed (code ${code ?? "unknown"})${suffix}`));
    });
  });
}

async function spawnShiftAgentForProject(
  project: ProjectRow,
  shift: ShiftRow
): Promise<void> {
  if (project.isolation_mode === "vm" || project.isolation_mode === "vm+container") {
    await spawnVmShiftAgent(project.id);
    return;
  }
  spawnShiftAgent({ projectId: project.id, projectPath: project.path, shift });
}

async function spawnShiftAgentWithRetry(
  project: ProjectRow,
  shift: ShiftRow,
  attempts = 2
): Promise<void> {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await spawnShiftAgentForProject(project, shift);
      return;
    } catch (err) {
      lastError = err;
      if (attempt < attempts) {
        recordActivity(`Retrying shift spawn for ${projectLabel(project)}.`, project.id);
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function maybeStartShift(
  project: ProjectRow,
  settings: ShiftSchedulerSettings,
  now: Date
): Promise<"started" | "skipped" | "error"> {
  const requiresVm =
    project.isolation_mode === "vm" || project.isolation_mode === "vm+container";
  expireStaleShifts(project.id);
  const activeShift = getActiveShift(project.id);
  if (activeShift) return "skipped";

  const readyCount = countReadyWorkOrders(project.id);
  if (readyCount <= 0) return "skipped";

  if (isQuietHours(now, settings.quiet_hours_start, settings.quiet_hours_end)) {
    return "skipped";
  }

  const shiftsToday = countShiftsSince(project.id, startOfDayIso(now));
  if (shiftsToday >= settings.max_shifts_per_day) return "skipped";

  const lastShift = getLatestShift(project.id);
  const nowMs = now.getTime();
  if (lastShift) {
    const sinceStart = minutesSince(lastShift.started_at, nowMs);
    if (sinceStart !== null && sinceStart < settings.interval_minutes) return "skipped";

    const cooldownAnchor = lastShift.completed_at ?? lastShift.started_at;
    const sinceCooldown = minutesSince(cooldownAnchor, nowMs);
    if (sinceCooldown !== null && sinceCooldown < settings.cooldown_minutes) return "skipped";
  }

  if (requiresVm && !getControlCenterApiUrl()) {
    recordActivity(
      `Skipping ${projectLabel(project)}: CONTROL_CENTER_API_URL not set for VM shifts.`,
      project.id
    );
    return "error";
  }

  const result = startShift({
    projectId: project.id,
    agentType: "claude_cli",
    agentId: "shift-scheduler",
  });
  if (!result.ok) return "skipped";

  const shift = result.shift;
  try {
    await spawnShiftAgentWithRetry(project, shift);
    recordActivity(`Started shift for ${projectLabel(project)}.`, project.id);
    return "started";
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    updateShift(shift.id, {
      status: "failed",
      completed_at: new Date().toISOString(),
      error: message,
    });
    recordActivity(`Failed to start shift for ${projectLabel(project)}: ${message}`, project.id);
    return "error";
  }
}

function updateStatusForSettings(settings: ShiftSchedulerSettings): void {
  status.enabled = settings.enabled;
  status.state = settings.enabled ? "running" : "paused";
  if (!settings.enabled) {
    status.next_check_at = null;
  } else if (!status.next_check_at) {
    status.next_check_at = new Date(Date.now() + CHECK_INTERVAL_MS).toISOString();
  }
}

async function runSchedulerTick(): Promise<void> {
  if (inFlight) return;
  inFlight = true;
  try {
    const now = new Date();
    const settings = getShiftSchedulerSettings();
    updateStatusForSettings(settings);
    status.last_check_at = now.toISOString();
    if (!settings.enabled) return;

    status.next_check_at = new Date(now.getTime() + CHECK_INTERVAL_MS).toISOString();
    const projects = listAutoShiftProjects();
    let started = 0;
    let skipped = 0;
    let failed = 0;

    for (const project of projects) {
      const outcome = await maybeStartShift(project, settings, now);
      if (outcome === "started") started += 1;
      else if (outcome === "error") failed += 1;
      else skipped += 1;
    }

    recordActivity(
      `Checked ${projects.length} project(s): ${started} started, ${skipped} skipped${
        failed ? `, ${failed} failed` : ""
      }.`
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    recordActivity(`Scheduler error: ${message}`);
  } finally {
    inFlight = false;
  }
}

export function startShiftScheduler(): void {
  if (schedulerTimer) return;
  const settings = getShiftSchedulerSettings();
  updateStatusForSettings(settings);
  if (settings.enabled) {
    status.next_check_at = new Date(Date.now() + CHECK_INTERVAL_MS).toISOString();
  }
  schedulerTimer = setInterval(() => {
    void runSchedulerTick();
  }, CHECK_INTERVAL_MS);
  void runSchedulerTick();
}

export function notifyShiftSchedulerSettingsUpdated(
  settings: ShiftSchedulerSettings
): void {
  updateStatusForSettings(settings);
  if (settings.enabled) {
    status.next_check_at = new Date(Date.now() + CHECK_INTERVAL_MS).toISOString();
  }
}

export function getShiftSchedulerStatus(): ShiftSchedulerStatus {
  return {
    ...status,
    recent_activity: [...status.recent_activity],
  };
}
