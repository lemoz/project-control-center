import "./env.js";
import fs from "fs";
import express, { type Response } from "express";
import cors from "cors";
import {
  findProjectById,
  getProjectVm,
  markInProgressRunsFailed,
  markWorkOrderRunsMerged,
  setProjectStar,
  updateProjectIsolationSettings,
  syncWorkOrderDeps,
  listAllWorkOrderDeps,
  getWorkOrderDependents,
  type ProjectIsolationMode,
  type ProjectRow,
  type ProjectVmRow,
  type ProjectVmSize,
} from "./db.js";
import {
  deleteVM,
  provisionVM,
  resizeVM,
  startVM,
  stopVM,
  VmManagerError,
} from "./vm_manager.js";
import { getDiscoveredRepoPaths, syncAndListRepoSummaries } from "./projects_catalog.js";
import {
  cascadeAutoReady,
  createWorkOrder,
  getWorkOrder,
  listWorkOrders,
  patchWorkOrder,
  readWorkOrderMarkdown,
  WorkOrderError,
} from "./work_orders.js";
import {
  getChatSettingsResponse,
  getRunnerSettingsResponse,
  patchChatSettings,
  patchRunnerSettings,
} from "./settings.js";
import {
  listGlobalConstitutionVersions,
  listProjectConstitutionVersions,
  mergeConstitutions,
  readGlobalConstitution,
  readProjectConstitution,
  writeGlobalConstitution,
  writeProjectConstitution,
} from "./constitution.js";
import {
  enqueueCodexRun,
  finalizeManualRunResolution,
  getRun,
  getRunsForProject,
  remoteDownloadForProject,
  remoteExecForProject,
  remoteUploadForProject,
} from "./runner_agent.js";
import { RemoteExecError } from "./remote_exec.js";
import { readControlMetadata } from "./sidecar.js";
import {
  enqueueChatTurn,
  enqueueChatTurnForThread,
  getChatRunDetails,
  getChatThreadDetails,
  getChatThreadDetailsById,
  suggestChatSettings,
  suggestChatSettingsForThread,
  PendingSendError,
} from "./chat_agent.js";
import { applyChatAction, undoChatAction } from "./chat_actions.js";
import { listChatAttention, listChatAttentionSummaries } from "./chat_attention.js";
import { buildWorktreeDiff, cleanupChatWorktree, resolveChatWorktreeConfig } from "./chat_worktree.js";
import {
  createChatThread,
  getChatThreadById,
  getChatPendingSendById,
  listChatActionLedger,
  listChatThreads,
  markChatThreadRead,
  markChatPendingSendCanceled,
  updateChatThread,
} from "./chat_db.js";
import { onChatStreamEvent, type ChatStreamEvent } from "./chat_events.js";
import {
  ChatMessageRequestSchema,
  ChatSuggestRequestSchema,
  ChatThreadCreateRequestSchema,
  ChatThreadUpdateRequestSchema,
} from "./chat_contract.js";

const app = express();
const port = Number(process.env.CONTROL_CENTER_PORT || 4010);
const host = process.env.CONTROL_CENTER_HOST || "127.0.0.1";
const allowLan = process.env.CONTROL_CENTER_ALLOW_LAN === "1";

function isLoopbackHost(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return (
    normalized === "127.0.0.1" ||
    normalized === "localhost" ||
    normalized === "::1" ||
    normalized === "0:0:0:0:0:0:0:1"
  );
}

function isLoopbackAddress(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  if (normalized === "::1" || normalized === "0:0:0:0:0:0:0:1") return true;
  if (normalized.startsWith("::ffff:")) {
    const v4 = normalized.slice("::ffff:".length);
    return v4.startsWith("127.");
  }
  return normalized.startsWith("127.");
}

function cleanupThreadWorktree(thread: {
  id: string;
  scope: string;
  project_id: string | null;
  worktree_path: string | null;
}): void {
  if (thread.scope === "global") return;
  if (!thread.worktree_path) return;
  const projectId = thread.project_id;
  if (!projectId) return;
  const project = findProjectById(projectId);
  if (!project) return;
  const { worktreePath, branchName } = resolveChatWorktreeConfig(
    thread.id,
    thread.worktree_path
  );
  cleanupChatWorktree({
    repoPath: project.path,
    worktreePath,
    branchName,
  });
}

if (!allowLan && !isLoopbackHost(host)) {
  // eslint-disable-next-line no-console
  console.warn(
    `[security] CONTROL_CENTER_HOST=${host} exposes the server beyond loopback. Remote clients are blocked unless CONTROL_CENTER_ALLOW_LAN=1.`
  );
}

const allowAllCorsRequested = process.env.CONTROL_CENTER_CORS_ALLOW_ALL === "1";
const allowAllCors =
  allowAllCorsRequested &&
  process.env.NODE_ENV !== "production" &&
  isLoopbackHost(host);
if (allowAllCorsRequested && !allowAllCors) {
  // eslint-disable-next-line no-console
  console.warn(
    `[cors] ignoring CONTROL_CENTER_CORS_ALLOW_ALL=1 (NODE_ENV=${process.env.NODE_ENV ?? "unknown"}, host=${host}); CORS allow-all is dev-only and loopback-only.`
  );
}

const defaultDevPorts = [3000, 3010, 3011, 3012, 3013];
const allowedOrigins = new Set(
  defaultDevPorts
    .flatMap((p) => [`http://localhost:${p}`, `http://127.0.0.1:${p}`])
    .concat(
      (process.env.CONTROL_CENTER_ALLOWED_ORIGINS || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    )
);
app.use((req, res, next) => {
  if (allowLan) return next();
  const remote = req.socket.remoteAddress;
  if (isLoopbackAddress(remote)) return next();
  return res.status(403).json({
    error: "forbidden",
    message:
      "Control Center server is private-by-default and only accepts loopback clients.",
    hint: "Set CONTROL_CENTER_ALLOW_LAN=1 to allow remote clients.",
  });
});
app.use(
  cors({
    origin: allowAllCors
      ? true
      : (origin, callback) => {
          if (!origin) return callback(null, true);
          if (allowedOrigins.has(origin)) return callback(null, true);
          return callback(null, false);
        },
    methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
  })
);
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ ok: true, ts: new Date().toISOString() });
});

app.get("/settings", (_req, res) => {
  return res.json(getRunnerSettingsResponse());
});

app.patch("/settings", (req, res) => {
  try {
    const updated = patchRunnerSettings(req.body ?? {});
    return res.json(updated);
  } catch (err) {
    return res.status(400).json({
      error: err instanceof Error ? err.message : "invalid settings",
    });
  }
});

app.get("/chat/settings", (_req, res) => {
  return res.json(getChatSettingsResponse());
});

app.patch("/chat/settings", (req, res) => {
  try {
    const updated = patchChatSettings(req.body ?? {});
    return res.json(updated);
  } catch (err) {
    return res.status(400).json({
      error: err instanceof Error ? err.message : "invalid settings",
    });
  }
});

app.get("/constitution", (req, res) => {
  const projectId = typeof req.query.projectId === "string" ? req.query.projectId : null;
  const global = readGlobalConstitution();
  let local: string | null = null;

  if (projectId) {
    const project = findProjectById(projectId);
    if (!project) return res.status(404).json({ error: "project not found" });
    local = readProjectConstitution(project.path);
  }

  const merged = mergeConstitutions(global, local);
  return res.json({ global, local, merged });
});

app.put("/constitution/global", (req, res) => {
  const content = req.body?.content;
  if (typeof content !== "string") {
    return res.status(400).json({ error: "`content` must be string" });
  }
  const result = writeGlobalConstitution(content);
  return res.json({ ok: true, version: result.version });
});

app.get("/constitution/versions", (req, res) => {
  const scope = typeof req.query.scope === "string" ? req.query.scope : null;
  if (scope !== "global" && scope !== "project") {
    return res.status(400).json({ error: "`scope` must be global or project" });
  }
  if (scope === "global") {
    return res.json({ versions: listGlobalConstitutionVersions() });
  }

  const projectId = typeof req.query.projectId === "string" ? req.query.projectId : null;
  if (!projectId) {
    return res.status(400).json({ error: "`projectId` required for project scope" });
  }
  const project = findProjectById(projectId);
  if (!project) return res.status(404).json({ error: "project not found" });
  return res.json({ versions: listProjectConstitutionVersions(project.path) });
});

app.get("/repos", (_req, res) => {
  return res.json(syncAndListRepoSummaries());
});

type SuccessMetric = {
  name: string;
  target: number | string;
  current?: number | string | null;
};

function isSuccessMetric(value: unknown): value is SuccessMetric {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  if (typeof record.name !== "string" || !record.name.trim()) return false;
  if (!(typeof record.target === "number" || typeof record.target === "string")) return false;
  if ("current" in record) {
    if (
      !(
        record.current === null ||
        record.current === undefined ||
        typeof record.current === "number" ||
        typeof record.current === "string"
      )
    ) {
      return false;
    }
  }
  return true;
}

function safeParseSuccessMetrics(value: string | null | undefined): SuccessMetric[] {
  if (typeof value !== "string" || value.length === 0) return [];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isSuccessMetric);
  } catch {
    return [];
  }
}

app.get("/repos/:id", (req, res) => {
  const { id } = req.params;
  const project = findProjectById(id);
  if (!project) return res.status(404).json({ error: "project not found" });
  const meta = readControlMetadata(project.path);
  const successCriteria = meta?.success_criteria ?? project.success_criteria;
  const successMetrics =
    meta?.success_metrics ?? safeParseSuccessMetrics(project.success_metrics);
  return res.json({
    project: {
      id: project.id,
      name: project.name,
      success_criteria: successCriteria,
      success_metrics: successMetrics,
    },
  });
});

app.patch("/repos/:id/star", (req, res) => {
  const { id } = req.params;
  const starred = req.body?.starred;
  if (typeof starred !== "boolean") {
    return res.status(400).json({ error: "`starred` must be boolean" });
  }
  const ok = setProjectStar(id, starred);
  if (!ok) return res.status(404).json({ error: "project not found" });
  return res.json({ ok: true, id, starred });
});

app.put("/repos/:id/constitution", (req, res) => {
  const { id } = req.params;
  const project = findProjectById(id);
  if (!project) return res.status(404).json({ error: "project not found" });
  const content = req.body?.content;
  if (typeof content !== "string") {
    return res.status(400).json({ error: "`content` must be string" });
  }
  const result = writeProjectConstitution(project.path, content);
  return res.json({ ok: true, version: result.version });
});

const VM_ISOLATION_MODES = new Set(["local", "vm", "vm+container"]);
const VM_SIZES = new Set(["small", "medium", "large", "xlarge"]);

function buildVmResponse(project: ProjectRow, vm: ProjectVmRow | null) {
  const fallbackVm = {
    project_id: project.id,
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
  const mergedVm = { ...fallbackVm, ...(vm ?? {}) };
  return {
    project: {
      id: project.id,
      name: project.name,
      isolation_mode: project.isolation_mode || "local",
      vm_size: project.vm_size || "medium",
    },
    vm: mergedVm,
  };
}

function sendVmError(res: Response, err: unknown) {
  const message = err instanceof Error ? err.message : "vm action failed";
  if (err instanceof VmManagerError) {
    const status =
      err.code === "not_found" ? 404 : err.code === "not_provisioned" ? 409 : 400;
    return res.status(status).json({ error: message });
  }
  return res.status(500).json({ error: message });
}

function sendRemoteExecError(res: Response, err: unknown) {
  if (!(err instanceof RemoteExecError)) {
    const message = err instanceof Error ? err.message : "remote exec failed";
    return res.status(500).json({ error: message });
  }

  const status =
    err.code === "invalid_path" ||
    err.code === "invalid_env" ||
    err.code === "invalid_command" ||
    err.code === "preflight"
      ? 400
      : err.code === "not_configured" || err.code === "not_running"
        ? 409
        : err.code === "timeout"
          ? 504
          : err.code === "command_failed"
            ? 422
            : err.code === "tool_missing"
              ? 424
              : err.code === "ssh_failed" || err.code === "sync_failed"
                ? 502
                : 500;

  return res.status(status).json({
    error: err.message,
    code: err.code,
    details: err.details ?? null,
  });
}

app.get("/repos/:id/vm", (req, res) => {
  const { id } = req.params;
  const project = findProjectById(id);
  if (!project) return res.status(404).json({ error: "project not found" });
  const vm = getProjectVm(project.id);
  return res.json(buildVmResponse(project, vm));
});

app.patch("/repos/:id/vm", (req, res) => {
  const { id } = req.params;
  const project = findProjectById(id);
  if (!project) return res.status(404).json({ error: "project not found" });

  const isolation_mode = req.body?.isolation_mode;
  const vm_size = req.body?.vm_size;

  if (isolation_mode === undefined && vm_size === undefined) {
    return res.status(400).json({ error: "no vm settings provided" });
  }
  if (
    isolation_mode !== undefined &&
    (typeof isolation_mode !== "string" || !VM_ISOLATION_MODES.has(isolation_mode))
  ) {
    return res.status(400).json({
      error: "`isolation_mode` must be one of local, vm, vm+container",
    });
  }
  if (vm_size !== undefined && (typeof vm_size !== "string" || !VM_SIZES.has(vm_size))) {
    return res.status(400).json({
      error: "`vm_size` must be one of small, medium, large, xlarge",
    });
  }

  const patch: { isolation_mode?: ProjectIsolationMode; vm_size?: ProjectVmSize } = {};
  if (isolation_mode !== undefined) patch.isolation_mode = isolation_mode as ProjectIsolationMode;
  if (vm_size !== undefined) patch.vm_size = vm_size as ProjectVmSize;
  const updated = updateProjectIsolationSettings(project.id, patch);
  const vm = getProjectVm(project.id);
  return res.json(buildVmResponse(updated ?? project, vm));
});

app.post("/repos/:id/vm/provision", async (req, res) => {
  const { id } = req.params;
  const project = findProjectById(id);
  if (!project) return res.status(404).json({ error: "project not found" });
  const zone = typeof req.body?.zone === "string" ? req.body.zone : undefined;
  const image = typeof req.body?.image === "string" ? req.body.image : undefined;

  try {
    const vm = await provisionVM({
      projectId: project.id,
      size: project.vm_size || "medium",
      zone,
      image,
    });
    return res.json(buildVmResponse(project, vm));
  } catch (err) {
    return sendVmError(res, err);
  }
});

app.post("/repos/:id/vm/start", async (req, res) => {
  const { id } = req.params;
  const project = findProjectById(id);
  if (!project) return res.status(404).json({ error: "project not found" });
  try {
    const vm = await startVM(project.id);
    return res.json(buildVmResponse(project, vm));
  } catch (err) {
    return sendVmError(res, err);
  }
});

app.post("/repos/:id/vm/stop", async (req, res) => {
  const { id } = req.params;
  const project = findProjectById(id);
  if (!project) return res.status(404).json({ error: "project not found" });
  try {
    const vm = await stopVM(project.id);
    return res.json(buildVmResponse(project, vm));
  } catch (err) {
    return sendVmError(res, err);
  }
});

app.put("/repos/:id/vm/resize", async (req, res) => {
  const { id } = req.params;
  const project = findProjectById(id);
  if (!project) return res.status(404).json({ error: "project not found" });
  const requestedSize = req.body?.vm_size ?? req.body?.size ?? project.vm_size;
  if (typeof requestedSize !== "string" || !VM_SIZES.has(requestedSize)) {
    return res.status(400).json({
      error: "`vm_size` must be one of small, medium, large, xlarge",
    });
  }

  try {
    const vm = await resizeVM(project.id, requestedSize as ProjectVmSize);
    return res.json(buildVmResponse(project, vm));
  } catch (err) {
    return sendVmError(res, err);
  }
});

app.delete("/repos/:id/vm", async (req, res) => {
  const { id } = req.params;
  const project = findProjectById(id);
  if (!project) return res.status(404).json({ error: "project not found" });
  try {
    const vm = await deleteVM(project.id);
    return res.json(buildVmResponse(project, vm));
  } catch (err) {
    return sendVmError(res, err);
  }
});

app.post("/repos/:id/remote/exec", async (req, res) => {
  const { id } = req.params;
  const project = findProjectById(id);
  if (!project) return res.status(404).json({ error: "project not found" });

  const payload = req.body ?? {};
  const command = payload.command;
  if (typeof command !== "string" || !command.trim()) {
    return res.status(400).json({ error: "`command` must be a non-empty string" });
  }

  const cwd = typeof payload.cwd === "string" ? payload.cwd : undefined;
  const timeout = typeof payload.timeout === "number" ? payload.timeout : undefined;
  if (payload.timeout !== undefined && typeof payload.timeout !== "number") {
    return res.status(400).json({ error: "`timeout` must be a number" });
  }

  const allowFailureValue = payload.allow_failure ?? payload.allowFailure;
  if (allowFailureValue !== undefined && typeof allowFailureValue !== "boolean") {
    return res.status(400).json({ error: "`allow_failure` must be boolean" });
  }
  const allowAbsoluteValue = payload.allow_absolute ?? payload.allowAbsolute;
  if (allowAbsoluteValue !== undefined && typeof allowAbsoluteValue !== "boolean") {
    return res.status(400).json({ error: "`allow_absolute` must be boolean" });
  }

  let env: Record<string, string> | undefined;
  if (payload.env !== undefined) {
    if (!payload.env || typeof payload.env !== "object" || Array.isArray(payload.env)) {
      return res.status(400).json({ error: "`env` must be an object" });
    }
    env = {};
    for (const [key, value] of Object.entries(payload.env as Record<string, unknown>)) {
      if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
        env[key] = String(value);
      } else {
        return res.status(400).json({
          error: "`env` values must be strings, numbers, or booleans",
        });
      }
    }
  }

  try {
    const result = await remoteExecForProject(project.id, command, {
      cwd,
      timeout,
      env,
      allowFailure: allowFailureValue,
      allowAbsolute: allowAbsoluteValue,
    });
    return res.json(result);
  } catch (err) {
    return sendRemoteExecError(res, err);
  }
});

app.post("/repos/:id/remote/upload", async (req, res) => {
  const { id } = req.params;
  const project = findProjectById(id);
  if (!project) return res.status(404).json({ error: "project not found" });

  const payload = req.body ?? {};
  const localPathRaw = typeof payload.local_path === "string"
    ? payload.local_path
    : payload.localPath;
  const remotePathRaw = typeof payload.remote_path === "string"
    ? payload.remote_path
    : payload.remotePath;
  if (typeof localPathRaw !== "string" || typeof remotePathRaw !== "string") {
    return res.status(400).json({ error: "`local_path` and `remote_path` are required" });
  }
  if (!localPathRaw.trim() || !remotePathRaw.trim()) {
    return res.status(400).json({
      error: "`local_path` and `remote_path` must be non-empty strings",
    });
  }
  const localPath = localPathRaw;
  const remotePath = remotePathRaw;

  const allowDeleteValue = payload.allow_delete ?? payload.allowDelete;
  if (allowDeleteValue !== undefined && typeof allowDeleteValue !== "boolean") {
    return res.status(400).json({ error: "`allow_delete` must be boolean" });
  }
  const allowAbsoluteValue = payload.allow_absolute ?? payload.allowAbsolute;
  if (allowAbsoluteValue !== undefined && typeof allowAbsoluteValue !== "boolean") {
    return res.status(400).json({ error: "`allow_absolute` must be boolean" });
  }

  try {
    await remoteUploadForProject(project.id, localPath, remotePath, {
      allowDelete: allowDeleteValue,
      allowAbsolute: allowAbsoluteValue,
    });
    return res.json({ ok: true });
  } catch (err) {
    return sendRemoteExecError(res, err);
  }
});

app.post("/repos/:id/remote/download", async (req, res) => {
  const { id } = req.params;
  const project = findProjectById(id);
  if (!project) return res.status(404).json({ error: "project not found" });

  const payload = req.body ?? {};
  const localPathRaw = typeof payload.local_path === "string"
    ? payload.local_path
    : payload.localPath;
  const remotePathRaw = typeof payload.remote_path === "string"
    ? payload.remote_path
    : payload.remotePath;
  if (typeof localPathRaw !== "string" || typeof remotePathRaw !== "string") {
    return res.status(400).json({ error: "`local_path` and `remote_path` are required" });
  }
  if (!localPathRaw.trim() || !remotePathRaw.trim()) {
    return res.status(400).json({
      error: "`local_path` and `remote_path` must be non-empty strings",
    });
  }
  const localPath = localPathRaw;
  const remotePath = remotePathRaw;

  const allowDeleteValue = payload.allow_delete ?? payload.allowDelete;
  if (allowDeleteValue !== undefined && typeof allowDeleteValue !== "boolean") {
    return res.status(400).json({ error: "`allow_delete` must be boolean" });
  }
  const allowAbsoluteValue = payload.allow_absolute ?? payload.allowAbsolute;
  if (allowAbsoluteValue !== undefined && typeof allowAbsoluteValue !== "boolean") {
    return res.status(400).json({ error: "`allow_absolute` must be boolean" });
  }

  try {
    await remoteDownloadForProject(project.id, remotePath, localPath, {
      allowDelete: allowDeleteValue,
      allowAbsolute: allowAbsoluteValue,
    });
    return res.json({ ok: true });
  } catch (err) {
    return sendRemoteExecError(res, err);
  }
});

function sendWorkOrderError(res: Response, err: unknown) {
  if (!(err instanceof WorkOrderError)) {
    return res.status(500).json({ error: "internal error" });
  }
  const status =
    err.code === "not_found" ? 404 : err.code === "invalid" ? 400 : 500;
  return res.status(status).json({ error: err.message, details: err.details });
}

app.get("/repos/:id/work-orders", (req, res) => {
  const { id } = req.params;
  const project = findProjectById(id);
  if (!project) return res.status(404).json({ error: "project not found" });

  const workOrders = listWorkOrders(project.path);
  return res.json({
    project: { id: project.id, name: project.name, path: project.path },
    work_orders: workOrders,
  });
});

app.get("/repos/:id/work-orders/:workOrderId", (req, res) => {
  const { id, workOrderId } = req.params;
  const project = findProjectById(id);
  if (!project) return res.status(404).json({ error: "project not found" });

  try {
    const workOrder = getWorkOrder(project.path, workOrderId);
    const markdown = readWorkOrderMarkdown(project.path, workOrderId);
    return res.json({
      project: { id: project.id, name: project.name, path: project.path },
      work_order: workOrder,
      markdown,
    });
  } catch (err) {
    return sendWorkOrderError(res, err);
  }
});

app.post("/repos/:id/work-orders", (req, res) => {
  const { id } = req.params;
  const project = findProjectById(id);
  if (!project) return res.status(404).json({ error: "project not found" });

  try {
    const workOrder = createWorkOrder(project.path, req.body ?? {});
    return res.status(201).json(workOrder);
  } catch (err) {
    return sendWorkOrderError(res, err);
  }
});

app.patch("/repos/:id/work-orders/:workOrderId", (req, res) => {
  const { id, workOrderId } = req.params;
  const project = findProjectById(id);
  if (!project) return res.status(404).json({ error: "project not found" });

  try {
    const before = getWorkOrder(project.path, workOrderId);
    const updated = patchWorkOrder(project.path, workOrderId, req.body ?? {});
    if (before.status !== "done" && updated.status === "done") {
      markWorkOrderRunsMerged(project.id, workOrderId);
    }

    // If work order was marked as done, trigger auto-ready cascade
    if (updated.status === "done") {
      // First sync dependencies to ensure the database is up to date
      const allWorkOrders = listWorkOrders(project.path);
      for (const wo of allWorkOrders) {
        syncWorkOrderDeps(id, wo.id, wo.depends_on);
      }

      // Run cascade
      const cascaded = cascadeAutoReady(project.path, workOrderId, (woId) =>
        getWorkOrderDependents(id, woId)
      );

      if (cascaded.length > 0) {
        return res.json({ ...updated, cascaded_to_ready: cascaded });
      }
    }

    return res.json(updated);
  } catch (err) {
    return sendWorkOrderError(res, err);
  }
});

app.get("/repos/:id/tech-tree", (req, res) => {
  const { id } = req.params;
  const project = findProjectById(id);
  if (!project) return res.status(404).json({ error: "project not found" });

  const workOrders = listWorkOrders(project.path);

  // Sync dependencies from file frontmatter to database
  for (const wo of workOrders) {
    syncWorkOrderDeps(id, wo.id, wo.depends_on);
  }

  // Build lookup maps
  const woMap = new Map(workOrders.map((wo) => [wo.id, wo]));
  const deps = listAllWorkOrderDeps(id);

  // Build dependents map (reverse lookup)
  const dependentsMap = new Map<string, string[]>();
  for (const dep of deps) {
    const list = dependentsMap.get(dep.depends_on_id) ?? [];
    list.push(dep.work_order_id);
    dependentsMap.set(dep.depends_on_id, list);
  }

  // Detect cycles using DFS with white/gray/black coloring
  type Color = "white" | "gray" | "black";
  const color = new Map<string, Color>();
  const cycles: string[][] = [];

  function dfs(nodeId: string, path: string[]): void {
    const c = color.get(nodeId) ?? "white";
    if (c === "black") return;
    if (c === "gray") {
      // Found a cycle
      const cycleStart = path.indexOf(nodeId);
      if (cycleStart >= 0) {
        cycles.push(path.slice(cycleStart).concat(nodeId));
      }
      return;
    }
    color.set(nodeId, "gray");
    const wo = woMap.get(nodeId);
    if (wo) {
      for (const depId of wo.depends_on) {
        dfs(depId, [...path, nodeId]);
      }
    }
    color.set(nodeId, "black");
  }

  for (const wo of workOrders) {
    if ((color.get(wo.id) ?? "white") === "white") {
      dfs(wo.id, []);
    }
  }

  // Build nodes with dependents included
  type DependencyNode = {
    id: string;
    title: string;
    status: string;
    priority: number;
    era: string | null;
    dependsOn: string[];
    dependents: string[];
  };

  const nodes: DependencyNode[] = workOrders.map((wo) => ({
    id: wo.id,
    title: wo.title,
    status: wo.status,
    priority: wo.priority,
    era: wo.era,
    dependsOn: wo.depends_on,
    dependents: dependentsMap.get(wo.id) ?? [],
  }));

  // Collect unique eras
  const erasSet = new Set<string>();
  for (const wo of workOrders) {
    if (wo.era) erasSet.add(wo.era);
  }
  const eras = Array.from(erasSet).sort();

  return res.json({ nodes, cycles, eras });
});

app.get("/repos/:id/runs", (req, res) => {
  const { id } = req.params;
  const project = findProjectById(id);
  if (!project) return res.status(404).json({ error: "project not found" });
  const limitRaw = typeof req.query.limit === "string" ? Number(req.query.limit) : 50;
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(200, Math.trunc(limitRaw)) : 50;
  return res.json({ runs: getRunsForProject(project.id, limit) });
});

app.post("/repos/:id/runs/cleanup-merged", (req, res) => {
  const { id } = req.params;
  const project = findProjectById(id);
  if (!project) return res.status(404).json({ error: "project not found" });

  const workOrders = listWorkOrders(project.path);
  const doneWorkOrders = workOrders.filter((wo) => wo.status === "done");
  let updatedRuns = 0;
  for (const workOrder of doneWorkOrders) {
    updatedRuns += markWorkOrderRunsMerged(project.id, workOrder.id);
  }

  return res.json({
    ok: true,
    work_orders: doneWorkOrders.length,
    updated_runs: updatedRuns,
  });
});

app.post("/repos/:id/work-orders/:workOrderId/runs", (req, res) => {
  const { id, workOrderId } = req.params;
  const project = findProjectById(id);
  if (!project) return res.status(404).json({ error: "project not found" });

  try {
    const run = enqueueCodexRun(project.id, workOrderId);
    return res.status(201).json(run);
  } catch (err) {
    return res.status(400).json({ error: String(err instanceof Error ? err.message : err) });
  }
});

app.get("/runs/:runId", (req, res) => {
  const run = getRun(req.params.runId);
  if (!run) return res.status(404).json({ error: "run not found" });
  return res.json(run);
});

app.post("/runs/:runId/resolve", (req, res) => {
  const result = finalizeManualRunResolution(req.params.runId);
  if (!result.ok) return res.status(400).json({ error: result.error });
  return res.json({ ok: true });
});

app.post("/repos/scan", (_req, res) => {
  const repos = getDiscoveredRepoPaths({ forceRescan: true });
  return res.json({ ok: true, scanned_at: new Date().toISOString(), repos });
});

app.get("/chat/global", (_req, res) => {
  const details = getChatThreadDetails({ scope: "global" });
  const thread = markChatThreadRead(details.thread.id) ?? details.thread;
  const attention =
    listChatAttentionSummaries({ threadIds: [details.thread.id] }).get(details.thread.id) ??
    { needs_you: false, reason_codes: [], reasons: [], last_event_at: null };
  const ledger = listChatActionLedger({ threadId: details.thread.id, limit: 200 });
  return res.json({
    ...details,
    thread: { ...thread, attention },
    action_ledger: ledger,
  });
});

app.get("/chat/attention", (_req, res) => {
  return res.json(listChatAttention());
});

app.get("/chat/stream", (req, res) => {
  const threadId = typeof req.query.thread_id === "string" ? req.query.thread_id : null;
  res.status(200);
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();
  res.write(`:connected ${new Date().toISOString()}\n\n`);

  const sendEvent = (event: ChatStreamEvent) => {
    if (threadId && event.thread_id !== threadId) return;
    res.write(`event: ${event.type}\n`);
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  const unsubscribe = onChatStreamEvent(sendEvent);
  const heartbeat = setInterval(() => {
    res.write(":keepalive\n\n");
  }, 25000);

  req.on("close", () => {
    clearInterval(heartbeat);
    unsubscribe();
    res.end();
  });
});

app.get("/chat/threads", (req, res) => {
  const includeArchived = req.query.include_archived === "1";
  const limitRaw = req.query.limit ? Number(req.query.limit) : NaN;
  const limit = Number.isFinite(limitRaw) ? Math.trunc(limitRaw) : undefined;
  try {
    const threads = listChatThreads({ includeArchived, limit });
    const attentionByThread = listChatAttentionSummaries({
      threadIds: threads.map((thread) => thread.id),
    });
    const enriched = threads.map((thread) => {
      const attention = attentionByThread.get(thread.id) ?? {
        needs_you: false,
        reason_codes: [],
        reasons: [],
        last_event_at: null,
      };
      return { ...thread, attention };
    });
    return res.json({ threads: enriched });
  } catch (err) {
    return res.status(400).json({ error: String(err instanceof Error ? err.message : err) });
  }
});

app.post("/chat/threads", (req, res) => {
  try {
    const payload = ChatThreadCreateRequestSchema.parse(req.body ?? {});

    const scope = payload.scope;
    if (scope === "global") {
      if (payload.projectId || payload.workOrderId) {
        return res.status(400).json({ error: "global threads cannot include projectId/workOrderId" });
      }
    } else if (scope === "project") {
      if (!payload.projectId) {
        return res.status(400).json({ error: "projectId required for project threads" });
      }
      if (payload.workOrderId) {
        return res.status(400).json({ error: "workOrderId must be omitted for project threads" });
      }
      const project = findProjectById(payload.projectId);
      if (!project) return res.status(404).json({ error: "project not found" });
    } else if (scope === "work_order") {
      if (!payload.projectId || !payload.workOrderId) {
        return res.status(400).json({ error: "projectId + workOrderId required for work_order threads" });
      }
      const project = findProjectById(payload.projectId);
      if (!project) return res.status(404).json({ error: "project not found" });
      try {
        getWorkOrder(project.path, payload.workOrderId);
      } catch {
        return res.status(404).json({ error: "work order not found" });
      }
    }

    const thread = createChatThread({
      scope,
      projectId: payload.projectId,
      workOrderId: payload.workOrderId,
      name: payload.name,
      defaultContextDepth: payload.defaults?.context?.depth,
      defaultAccess: payload.defaults?.access,
    });
    return res.status(201).json(thread);
  } catch (err) {
    return res.status(400).json({ error: String(err instanceof Error ? err.message : err) });
  }
});

app.get("/chat/threads/:threadId", (req, res) => {
  const details = getChatThreadDetailsById(req.params.threadId);
  if (!details) return res.status(404).json({ error: "thread not found" });
  const thread = markChatThreadRead(details.thread.id) ?? details.thread;
  const attention =
    listChatAttentionSummaries({ threadIds: [details.thread.id] }).get(details.thread.id) ??
    {
      needs_you: false,
      reason_codes: [],
      reasons: [],
      last_event_at: null,
    };
  const threadWithAttention = { ...thread, attention };
  const ledger = listChatActionLedger({ threadId: details.thread.id, limit: 200 });
  return res.json({ ...details, thread: threadWithAttention, action_ledger: ledger });
});

app.get("/chat/threads/:threadId/worktree/diff", (req, res) => {
  try {
    const thread = getChatThreadById(req.params.threadId);
    if (!thread) return res.status(404).json({ error: "thread not found" });
    if (thread.scope === "global") {
      return res.status(400).json({ error: "global threads do not support worktree diffs" });
    }
    const projectId = thread.project_id;
    if (!projectId) return res.status(400).json({ error: "thread missing project_id" });
    const project = findProjectById(projectId);
    if (!project) return res.status(404).json({ error: "project not found" });
    const { worktreePath } = resolveChatWorktreeConfig(thread.id, thread.worktree_path);
    if (!fs.existsSync(worktreePath)) {
      return res.status(404).json({ error: "worktree not found" });
    }
    const diff = buildWorktreeDiff({ worktreePath, repoPath: project.path });
    updateChatThread({
      threadId: thread.id,
      worktreePath: thread.worktree_path ?? worktreePath,
      hasPendingChanges: diff.hasPendingChanges,
    });
    return res.json({ diff: diff.diff, has_pending_changes: diff.hasPendingChanges });
  } catch (err) {
    return res.status(400).json({ error: String(err instanceof Error ? err.message : err) });
  }
});

app.patch("/chat/threads/:threadId", (req, res) => {
  const threadId = req.params.threadId;
  const existing = getChatThreadById(threadId);
  if (!existing) return res.status(404).json({ error: "thread not found" });
  try {
    const payload = ChatThreadUpdateRequestSchema.parse(req.body ?? {});

    if ((payload.projectId !== undefined || payload.workOrderId !== undefined) && !payload.scope) {
      return res.status(400).json({ error: "scope must be provided when changing projectId/workOrderId" });
    }

    const nextScope = payload.scope ?? existing.scope;
    const nextName = payload.name ?? undefined;
    const archivedAt =
      payload.archived === undefined
        ? undefined
        : payload.archived
          ? new Date().toISOString()
          : null;
    const willArchive = payload.archived === true && !existing.archived_at;

    const nextProjectId = (() => {
      if (!payload.scope) return undefined;
      if (nextScope === "global") return null;
      if (!payload.projectId) return undefined;
      return payload.projectId;
    })();

    const nextWorkOrderId = (() => {
      if (!payload.scope) return undefined;
      if (nextScope !== "work_order") return null;
      if (!payload.workOrderId) return undefined;
      return payload.workOrderId;
    })();

    if (payload.scope === "global") {
      if (payload.projectId || payload.workOrderId) {
        return res.status(400).json({ error: "global threads cannot include projectId/workOrderId" });
      }
    } else if (payload.scope === "project") {
      if (!payload.projectId) return res.status(400).json({ error: "projectId required for project threads" });
      if (payload.workOrderId) return res.status(400).json({ error: "workOrderId must be omitted for project threads" });
      const project = findProjectById(payload.projectId);
      if (!project) return res.status(404).json({ error: "project not found" });
    } else if (payload.scope === "work_order") {
      if (!payload.projectId || !payload.workOrderId) {
        return res.status(400).json({ error: "projectId + workOrderId required for work_order threads" });
      }
      const project = findProjectById(payload.projectId);
      if (!project) return res.status(404).json({ error: "project not found" });
      try {
        getWorkOrder(project.path, payload.workOrderId);
      } catch {
        return res.status(404).json({ error: "work order not found" });
      }
    }

    const updated = updateChatThread({
      threadId,
      name: nextName,
      scope: payload.scope ?? undefined,
      projectId: nextProjectId,
      workOrderId: nextWorkOrderId,
      defaultContextDepth: payload.defaults?.context?.depth,
      defaultAccess: payload.defaults?.access,
      archivedAt,
      worktreePath: willArchive ? null : undefined,
      hasPendingChanges: willArchive ? false : undefined,
    });
    if (!updated) return res.status(404).json({ error: "thread not found" });
    if (willArchive) {
      try {
        cleanupThreadWorktree(existing);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn(`Failed to clean up worktree for thread ${existing.id}: ${String(err)}`);
      }
    }
    return res.json(updated);
  } catch (err) {
    return res.status(400).json({ error: String(err instanceof Error ? err.message : err) });
  }
});

app.post("/chat/threads/:threadId/ack", (req, res) => {
  const threadId = req.params.threadId;
  const existing = getChatThreadById(threadId);
  if (!existing) return res.status(404).json({ error: "thread not found" });
  const updated =
    updateChatThread({ threadId, lastAckAt: new Date().toISOString() }) ?? existing;
  const attention =
    listChatAttentionSummaries({ threadIds: [threadId] }).get(threadId) ??
    { needs_you: false, reason_codes: [], reasons: [], last_event_at: null };
  return res.json({ thread: { ...updated, attention } });
});

app.post("/chat/threads/:threadId/pending-sends/:pendingSendId/cancel", (req, res) => {
  const { threadId, pendingSendId } = req.params;
  const pending = getChatPendingSendById(pendingSendId);
  if (!pending) return res.status(404).json({ error: "pending send not found" });
  if (pending.thread_id !== threadId) {
    return res.status(400).json({ error: "pending send does not belong to thread" });
  }
  const ok = markChatPendingSendCanceled(pendingSendId);
  if (!ok) return res.status(400).json({ error: "pending send already resolved" });
  return res.json({ ok: true });
});

app.post("/chat/threads/:threadId/messages", (req, res) => {
  const threadId = req.params.threadId;
  try {
    const payload = ChatMessageRequestSchema.parse(req.body ?? {});
    const run = enqueueChatTurnForThread({
      threadId,
      content: payload.content,
      context: payload.context,
      access: payload.access,
      suggestion: payload.suggestion,
      confirmations: payload.confirmations,
    });
    return res.status(201).json(run);
  } catch (err) {
    if (err instanceof PendingSendError) {
      return res.status(409).json({
        error: err.message,
        pending_send_id: err.pendingSendId,
        requires: err.requires,
      });
    }
    return res.status(400).json({ error: String(err instanceof Error ? err.message : err) });
  }
});

app.post("/chat/threads/:threadId/suggestions", async (req, res) => {
  const threadId = req.params.threadId;
  try {
    const payload = ChatSuggestRequestSchema.parse(req.body ?? {});
    const suggestion = await suggestChatSettingsForThread({
      threadId,
      content: payload.content,
      context: payload.context,
      access: payload.access,
    });
    return res.json({ suggestion });
  } catch (err) {
    return res.status(400).json({ error: String(err instanceof Error ? err.message : err) });
  }
});

app.post("/chat/global/messages", (req, res) => {
  try {
    const payload = ChatMessageRequestSchema.parse(req.body ?? {});
    const run = enqueueChatTurn({
      scope: "global",
      content: payload.content,
      context: payload.context,
      access: payload.access,
      suggestion: payload.suggestion,
      confirmations: payload.confirmations,
    });
    return res.status(201).json(run);
  } catch (err) {
    if (err instanceof PendingSendError) {
      return res.status(409).json({
        error: err.message,
        pending_send_id: err.pendingSendId,
        requires: err.requires,
      });
    }
    return res.status(400).json({ error: String(err instanceof Error ? err.message : err) });
  }
});

app.post("/chat/global/suggestions", async (req, res) => {
  try {
    const payload = ChatSuggestRequestSchema.parse(req.body ?? {});
    const suggestion = await suggestChatSettings({
      scope: "global",
      content: payload.content,
      context: payload.context,
      access: payload.access,
    });
    return res.json({ suggestion });
  } catch (err) {
    return res.status(400).json({ error: String(err instanceof Error ? err.message : err) });
  }
});

app.get("/chat/projects/:id", (req, res) => {
  const { id } = req.params;
  const details = getChatThreadDetails({ scope: "project", projectId: id });
  const thread = markChatThreadRead(details.thread.id) ?? details.thread;
  const attention =
    listChatAttentionSummaries({ threadIds: [details.thread.id] }).get(details.thread.id) ??
    { needs_you: false, reason_codes: [], reasons: [], last_event_at: null };
  const ledger = listChatActionLedger({ threadId: details.thread.id, limit: 200 });
  return res.json({
    ...details,
    thread: { ...thread, attention },
    action_ledger: ledger,
  });
});

app.post("/chat/projects/:id/messages", (req, res) => {
  const { id } = req.params;
  try {
    const payload = ChatMessageRequestSchema.parse(req.body ?? {});
    const run = enqueueChatTurn({
      scope: "project",
      projectId: id,
      content: payload.content,
      context: payload.context,
      access: payload.access,
      suggestion: payload.suggestion,
      confirmations: payload.confirmations,
    });
    return res.status(201).json(run);
  } catch (err) {
    if (err instanceof PendingSendError) {
      return res.status(409).json({
        error: err.message,
        pending_send_id: err.pendingSendId,
        requires: err.requires,
      });
    }
    return res.status(400).json({ error: String(err instanceof Error ? err.message : err) });
  }
});

app.post("/chat/projects/:id/suggestions", async (req, res) => {
  const { id } = req.params;
  try {
    const payload = ChatSuggestRequestSchema.parse(req.body ?? {});
    const suggestion = await suggestChatSettings({
      scope: "project",
      projectId: id,
      content: payload.content,
      context: payload.context,
      access: payload.access,
    });
    return res.json({ suggestion });
  } catch (err) {
    return res.status(400).json({ error: String(err instanceof Error ? err.message : err) });
  }
});

app.get("/chat/projects/:id/work-orders/:workOrderId", (req, res) => {
  const { id, workOrderId } = req.params;
  const details = getChatThreadDetails({ scope: "work_order", projectId: id, workOrderId });
  const thread = markChatThreadRead(details.thread.id) ?? details.thread;
  const attention =
    listChatAttentionSummaries({ threadIds: [details.thread.id] }).get(details.thread.id) ??
    { needs_you: false, reason_codes: [], reasons: [], last_event_at: null };
  const ledger = listChatActionLedger({ threadId: details.thread.id, limit: 200 });
  return res.json({
    ...details,
    thread: { ...thread, attention },
    action_ledger: ledger,
  });
});

app.post("/chat/projects/:id/work-orders/:workOrderId/messages", (req, res) => {
  const { id, workOrderId } = req.params;
  try {
    const payload = ChatMessageRequestSchema.parse(req.body ?? {});
    const run = enqueueChatTurn({
      scope: "work_order",
      projectId: id,
      workOrderId,
      content: payload.content,
      context: payload.context,
      access: payload.access,
      suggestion: payload.suggestion,
      confirmations: payload.confirmations,
    });
    return res.status(201).json(run);
  } catch (err) {
    if (err instanceof PendingSendError) {
      return res.status(409).json({
        error: err.message,
        pending_send_id: err.pendingSendId,
        requires: err.requires,
      });
    }
    return res.status(400).json({ error: String(err instanceof Error ? err.message : err) });
  }
});

app.post("/chat/projects/:id/work-orders/:workOrderId/suggestions", async (req, res) => {
  const { id, workOrderId } = req.params;
  try {
    const payload = ChatSuggestRequestSchema.parse(req.body ?? {});
    const suggestion = await suggestChatSettings({
      scope: "work_order",
      projectId: id,
      workOrderId,
      content: payload.content,
      context: payload.context,
      access: payload.access,
    });
    return res.json({ suggestion });
  } catch (err) {
    return res.status(400).json({ error: String(err instanceof Error ? err.message : err) });
  }
});

app.get("/chat/runs/:runId", (req, res) => {
  const run = getChatRunDetails(req.params.runId);
  if (!run) return res.status(404).json({ error: "run not found" });
  return res.json(run);
});

app.post("/chat/actions/apply", (req, res) => {
  try {
    const applied = applyChatAction(req.body ?? {});
    return res.status(201).json(applied);
  } catch (err) {
    return res.status(400).json({ error: String(err instanceof Error ? err.message : err) });
  }
});

app.post("/chat/actions/:ledgerId/undo", (req, res) => {
  try {
    const result = undoChatAction(req.params.ledgerId);
    return res.json(result);
  } catch (err) {
    return res.status(400).json({ error: String(err instanceof Error ? err.message : err) });
  }
});

const failRunsOnRestart =
  process.env.CONTROL_CENTER_FAIL_IN_PROGRESS_ON_RESTART === "1";
const recovered = failRunsOnRestart
  ? markInProgressRunsFailed("Server restarted; run aborted.")
  : 0;
app.listen(port, host, () => {
  // eslint-disable-next-line no-console
  console.log(`Control Center server listening on http://${host}:${port}`);
  if (recovered) {
    // eslint-disable-next-line no-console
    console.log(`Marked ${recovered} in-progress runs as failed (restart recovery).`);
  }
});
