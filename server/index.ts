import "./env.js";
import fs from "fs";
import crypto from "crypto";
import express, { type Response, type NextFunction } from "express";
import cors from "cors";
import {
  createUserInteraction,
  createEscalation,
  createGlobalPattern,
  createGlobalShiftHandoff,
  createShiftHandoff,
  expireStaleGlobalShifts,
  expireStaleShifts,
  findProjectById,
  findGlobalPatternById,
  getActiveShift,
  getActiveGlobalShift,
  getEscalationById,
  getOpenEscalationForProject,
  getProjectVm,
  getRunById,
  getRunPhaseMetricsSummary,
  getGlobalShiftById,
  getShiftByProjectId,
  listGlobalPatterns,
  listEscalations,
  listGlobalShifts,
  searchGlobalPatternsByTags,
  listTracks,
  listRunPhaseMetrics,
  listShifts,
  listProjects,
  markInProgressRunsFailed,
  markWorkOrderRunsMerged,
  setProjectStar,
  startShift,
  startGlobalShift,
  updateProjectIsolationSettings,
  updateEscalation,
  updateShift,
  updateGlobalShift,
  updateTrack,
  syncWorkOrderDeps,
  listAllWorkOrderDeps,
  getWorkOrderDependents,
  createTrack,
  deleteTrack,
  getTrackById,
  listBudgetEnforcementLog,
  type CreateGlobalShiftHandoffInput,
  type CreateShiftHandoffInput,
  type EscalationStatus,
  type EscalationType,
  type ProjectIsolationMode,
  type ProjectRow,
  type ProjectVmRow,
  type ProjectVmSize,
  type Track,
  type ShiftHandoffDecision,
  type CreateGlobalPatternInput,
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
  type WorkOrder,
} from "./work_orders.js";
import { generateWorkOrderDraft } from "./wo_generation.js";
import {
  getChatSettingsResponse,
  getRunnerSettingsResponse,
  getUtilitySettingsResponse,
  patchChatSettings,
  patchRunnerSettings,
  patchUtilitySettings,
} from "./settings.js";
import {
  getEscalationDeferral,
  getExplicitPreferences,
  getLastEscalationAt,
  getPreferencePatterns,
  getUserPreferences,
  parsePreferencesPatch,
  updateExplicitPreferences,
} from "./user_preferences.js";
import {
  type ConstitutionInsightCategory,
  type ConstitutionInsightInput,
  listGlobalConstitutionVersions,
  listProjectConstitutionVersions,
  mergeConstitutions,
  readGlobalConstitution,
  readProjectConstitution,
  writeGlobalConstitution,
  writeProjectConstitution,
} from "./constitution.js";
import {
  analyzeConstitutionSources,
  generateConstitutionDraft,
  listConstitutionGenerationSources,
  markConstitutionGenerationComplete,
} from "./constitution_generation.js";
import {
  cancelRun,
  enqueueCodexRun,
  finalizeManualRunResolution,
  getRun,
  getRunsForProject,
  provideRunInput,
  remoteDownloadForProject,
  remoteExecForProject,
  remoteUploadForProject,
} from "./runner_agent.js";
import {
  getBudgetSummary,
  getVmHealthResponse,
  listActiveRuns,
  listObservabilityAlerts,
  listRunFailureBreakdown,
  listRunTimeline,
  tailRunLog,
} from "./observability.js";
import { RemoteExecError } from "./remote_exec.js";
import { readControlMetadata } from "./sidecar.js";
import { buildShiftContext } from "./shift_context.js";
import { buildGlobalContextResponse } from "./global_context.js";
import { createProjectFromSpec, type CreateProjectInput } from "./global_agent.js";
import {
  completeGlobalAgentOnboarding,
  createGlobalAgentSession,
  endGlobalAgentSession,
  getActiveGlobalAgentSession,
  listGlobalAgentSessionEvents,
  pauseAutonomousSessionForUserMessage,
  pauseGlobalAgentSession,
  startGlobalAgentSessionAutonomous,
  stopGlobalAgentSession,
  updateGlobalAgentSessionDetails,
} from "./global_agent_sessions.js";
import {
  getGlobalBudget,
  getProjectBudget,
  setGlobalMonthlyBudget,
  setProjectBudget,
  transferProjectBudget,
} from "./budgeting.js";
import { BudgetEnforcementError, syncProjectBudgetAlerts } from "./budget_enforcement.js";
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
import { getProjectCostHistory, getProjectCostSummary } from "./cost_tracking.js";
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
const ESCALATION_TYPES: EscalationType[] = [
  "need_input",
  "blocked",
  "decision_required",
  "error",
  "budget_warning",
  "budget_critical",
  "budget_exhausted",
  "run_blocked",
];
const ESCALATION_STATUSES: EscalationStatus[] = [
  "pending",
  "claimed",
  "resolved",
  "escalated_to_user",
];
const ESCALATION_TYPE_SET = new Set<EscalationType>(ESCALATION_TYPES);
const ESCALATION_STATUS_SET = new Set<EscalationStatus>(ESCALATION_STATUSES);
const ESCALATION_CLAIMANT = "global_agent";
const NON_URGENT_ESCALATION_TYPES = new Set<EscalationType>([
  "budget_warning",
  "decision_required",
  "need_input",
  "blocked",
  "run_blocked",
]);
const COST_PERIODS = ["day", "week", "month", "all_time"] as const;
const COST_CATEGORIES = ["builder", "reviewer", "chat", "handoff", "other", "all"] as const;
const COST_PERIOD_SET = new Set<string>(COST_PERIODS);
const COST_CATEGORY_SET = new Set<string>(COST_CATEGORIES);
const VOICE_SIGNATURE_HEADERS = [
  "x-elevenlabs-signature",
  "x-elevenlabs-hmac",
  "x-webhook-signature",
  "x-signature",
];

type RawBodyRequest = express.Request & { rawBody?: Buffer };

function captureRawBody(req: express.Request, _res: Response, buf: Buffer): void {
  (req as RawBodyRequest).rawBody = buf;
}

function getSignatureHeader(req: express.Request): string | null {
  for (const header of VOICE_SIGNATURE_HEADERS) {
    const value = req.header(header);
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

const SIGNATURE_PREFIXES = new Set(["v1", "sha256"]);

function parseSignatureHeader(value: string): string[] {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const eqIndex = entry.indexOf("=");
      if (eqIndex === -1) {
        return entry;
      }
      const key = entry.slice(0, eqIndex).trim().toLowerCase();
      const rest = entry.slice(eqIndex + 1).trim();
      if (SIGNATURE_PREFIXES.has(key)) {
        return rest;
      }
      return entry;
    })
    .filter(Boolean);
}

function normalizeSignature(value: string): string {
  const trimmed = value.trim();
  if (/^[0-9a-fA-F]+$/.test(trimmed) && trimmed.length % 2 === 0) {
    return trimmed.toLowerCase();
  }
  return trimmed;
}

function timingSafeEqualString(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

function verifyElevenLabsWebhook(
  req: RawBodyRequest,
  res: Response,
  next: NextFunction
): void {
  const secret = process.env.CONTROL_CENTER_ELEVENLABS_WEBHOOK_SECRET;
  if (!secret) {
    res.status(500).json({ error: "voice webhook secret not configured" });
    return;
  }

  const signatureHeader = getSignatureHeader(req);
  if (!signatureHeader) {
    res.status(401).json({ error: "missing webhook signature" });
    return;
  }

  const rawBody = req.rawBody ?? Buffer.from("");
  const computedHex = normalizeSignature(
    crypto.createHmac("sha256", secret).update(rawBody).digest("hex")
  );
  const computedBase64 = normalizeSignature(
    crypto.createHmac("sha256", secret).update(rawBody).digest("base64")
  );
  const computed = [computedHex, computedBase64];
  const candidates = parseSignatureHeader(signatureHeader).map(normalizeSignature);

  const ok = candidates.some((candidate) =>
    computed.some((expected) => timingSafeEqualString(candidate, expected))
  );
  if (!ok) {
    res.status(401).json({ error: "invalid webhook signature" });
    return;
  }

  next();
}

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
app.use(express.json({ verify: captureRawBody }));

app.get("/health", (_req, res) => {
  res.json({ ok: true, ts: new Date().toISOString() });
});

app.post("/api/voice/global-context", verifyElevenLabsWebhook, (_req, res) => {
  const response = buildGlobalContextResponse();
  return res.json(response);
});

app.post("/api/voice/shift-context", verifyElevenLabsWebhook, (req, res) => {
  const projectId =
    typeof req.body?.projectId === "string" ? req.body.projectId.trim() : "";
  if (!projectId) {
    return res.status(400).json({ error: "`projectId` is required" });
  }
  const context = buildShiftContext(projectId);
  if (!context) return res.status(404).json({ error: "project not found" });
  syncProjectBudgetAlerts({
    projectId: context.project.id,
    projectName: context.project.name,
    projectPath: context.project.path,
    readyWorkOrderIds: context.work_orders.ready.map((wo) => wo.id),
  });
  return res.json(context);
});

app.post("/api/voice/work-order", verifyElevenLabsWebhook, (req, res) => {
  const workOrderId =
    typeof req.body?.workOrderId === "string" ? req.body.workOrderId.trim() : "";
  if (!workOrderId) {
    return res.status(400).json({ error: "`workOrderId` is required" });
  }

  const projectId =
    typeof req.body?.projectId === "string" ? req.body.projectId.trim() : "";
  if (projectId) {
    const project = findProjectById(projectId);
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
  }

  const matches: Array<{
    project: ProjectRow;
    workOrder: WorkOrder;
    markdown: string;
  }> = [];
  for (const project of listProjects()) {
    try {
      const workOrder = getWorkOrder(project.path, workOrderId);
      const markdown = readWorkOrderMarkdown(project.path, workOrderId);
      matches.push({ project, workOrder, markdown });
    } catch (err) {
      if (err instanceof WorkOrderError && err.code === "not_found") {
        continue;
      }
      return sendWorkOrderError(res, err);
    }
  }

  if (!matches.length) {
    return res.status(404).json({ error: "work order not found" });
  }
  if (matches.length > 1) {
    return res.status(409).json({
      error: "multiple work orders match; provide projectId",
      matches: matches.map((match) => ({
        id: match.project.id,
        name: match.project.name,
        path: match.project.path,
      })),
    });
  }

  const match = matches[0];
  return res.json({
    project: {
      id: match.project.id,
      name: match.project.name,
      path: match.project.path,
    },
    work_order: match.workOrder,
    markdown: match.markdown,
  });
});

app.post("/api/voice/run-status", verifyElevenLabsWebhook, (req, res) => {
  const runId = typeof req.body?.runId === "string" ? req.body.runId.trim() : "";
  if (!runId) {
    return res.status(400).json({ error: "`runId` is required" });
  }
  const run = getRun(runId);
  if (!run) return res.status(404).json({ error: "run not found" });
  return res.json(run);
});

app.get("/observability/vm-health", async (req, res) => {
  const projectId = typeof req.query.projectId === "string" ? req.query.projectId : null;
  if (projectId && !findProjectById(projectId)) {
    return res.status(404).json({ error: "project not found" });
  }
  try {
    const data = await getVmHealthResponse(projectId);
    return res.json(data);
  } catch (err) {
    return res.status(500).json({
      error: err instanceof Error ? err.message : "failed to fetch VM health",
    });
  }
});

app.get("/observability/runs/active", (req, res) => {
  const limitRaw = typeof req.query.limit === "string" ? Number(req.query.limit) : NaN;
  const limit = Number.isFinite(limitRaw)
    ? Math.max(1, Math.min(100, Math.trunc(limitRaw)))
    : 20;
  return res.json(listActiveRuns(limit));
});

app.get("/observability/runs/timeline", (req, res) => {
  const hoursRaw = typeof req.query.hours === "string" ? Number(req.query.hours) : NaN;
  const hours = Number.isFinite(hoursRaw) ? Math.trunc(hoursRaw) : 24;
  return res.json(listRunTimeline(hours));
});

app.get("/observability/runs/failure-breakdown", (req, res) => {
  const limitRaw = typeof req.query.limit === "string" ? Number(req.query.limit) : NaN;
  const limit = Number.isFinite(limitRaw)
    ? Math.max(10, Math.min(1000, Math.trunc(limitRaw)))
    : 200;
  const projectId = typeof req.query.projectId === "string" ? req.query.projectId : null;
  if (projectId && !findProjectById(projectId)) {
    return res.status(404).json({ error: "project not found" });
  }
  return res.json(listRunFailureBreakdown(limit, projectId));
});

app.get("/observability/budget/summary", (_req, res) => {
  return res.json(getBudgetSummary());
});

app.get("/observability/alerts", async (req, res) => {
  const projectId = typeof req.query.projectId === "string" ? req.query.projectId : null;
  if (projectId && !findProjectById(projectId)) {
    return res.status(404).json({ error: "project not found" });
  }
  try {
    const alerts = await listObservabilityAlerts(projectId);
    return res.json(alerts);
  } catch (err) {
    return res.status(500).json({
      error: err instanceof Error ? err.message : "failed to fetch alerts",
    });
  }
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

app.get("/settings/utility", (_req, res) => {
  return res.json(getUtilitySettingsResponse());
});

app.patch("/settings/utility", (req, res) => {
  try {
    const updated = patchUtilitySettings(req.body ?? {});
    return res.json(updated);
  } catch (err) {
    return res.status(400).json({
      error: err instanceof Error ? err.message : "invalid utility settings",
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

const INSIGHT_CATEGORY_SET = new Set([
  "decision",
  "style",
  "anti",
  "success",
  "communication",
]);

function isInsightCategory(value: string): value is ConstitutionInsightCategory {
  return INSIGHT_CATEGORY_SET.has(value);
}

app.post("/constitution/generation/sources", (req, res) => {
  try {
    const projectId = typeof req.body?.projectId === "string" ? req.body.projectId : null;
    const range =
      req.body?.range && typeof req.body.range === "object" ? req.body.range : null;
    const result = listConstitutionGenerationSources({ projectId, range });
    return res.json(result);
  } catch (err) {
    return res.status(400).json({
      error: err instanceof Error ? err.message : "failed to load sources",
    });
  }
});

app.post("/constitution/generation/analyze", async (req, res) => {
  try {
    const projectId = typeof req.body?.projectId === "string" ? req.body.projectId : null;
    const range =
      req.body?.range && typeof req.body.range === "object" ? req.body.range : null;
    const maxConversations =
      typeof req.body?.maxConversations === "number" ? req.body.maxConversations : undefined;
    const result = await analyzeConstitutionSources({
      projectId,
      range,
      maxConversations,
      sources: req.body?.sources ?? {},
    });
    return res.json(result);
  } catch (err) {
    return res.status(400).json({
      error: err instanceof Error ? err.message : "analysis failed",
    });
  }
});

app.post("/constitution/generation/draft", async (req, res) => {
  try {
    const projectId = typeof req.body?.projectId === "string" ? req.body.projectId : null;
    const base = typeof req.body?.base === "string" ? req.body.base : null;
    const insightsRaw: unknown[] = Array.isArray(req.body?.insights) ? req.body.insights : [];
    const insights: ConstitutionInsightInput[] = insightsRaw
      .map((entry): ConstitutionInsightInput | null => {
        if (!entry || typeof entry !== "object") return null;
        const record = entry as Record<string, unknown>;
        const category = typeof record.category === "string" ? record.category : "";
        const text = typeof record.text === "string" ? record.text : "";
        if (!isInsightCategory(category) || !text.trim()) return null;
        return { category, text: text.trim() };
      })
      .filter((entry): entry is ConstitutionInsightInput => Boolean(entry));
    const result = await generateConstitutionDraft({ projectId, insights, base });
    return res.json(result);
  } catch (err) {
    return res.status(400).json({
      error: err instanceof Error ? err.message : "draft generation failed",
    });
  }
});

app.post("/constitution/generation/complete", (req, res) => {
  try {
    const projectId = typeof req.body?.projectId === "string" ? req.body.projectId : null;
    const lastGeneratedAt =
      typeof req.body?.lastGeneratedAt === "string" ? req.body.lastGeneratedAt : null;
    const result = markConstitutionGenerationComplete({ projectId, lastGeneratedAt });
    return res.json({ ok: true, meta: result });
  } catch (err) {
    return res.status(400).json({
      error: err instanceof Error ? err.message : "failed to update generation metadata",
    });
  }
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

app.get("/projects/:id/costs", (req, res) => {
  const { id } = req.params;
  const project = findProjectById(id);
  if (!project) return res.status(404).json({ error: "project not found" });

  const periodParam = typeof req.query.period === "string" ? req.query.period : null;
  const categoryParam = typeof req.query.category === "string" ? req.query.category : null;
  const period = periodParam ?? "month";
  const category = categoryParam ?? "all";

  if (!COST_PERIOD_SET.has(period)) {
    return res.status(400).json({ error: "`period` must be day, week, month, or all_time" });
  }
  if (!COST_CATEGORY_SET.has(category)) {
    return res.status(400).json({
      error: "`category` must be builder, reviewer, chat, handoff, other, or all",
    });
  }

  const summary = getProjectCostSummary({
    projectId: project.id,
    period: period as "day" | "week" | "month" | "all_time",
    category: category as "all" | "builder" | "reviewer" | "chat" | "handoff" | "other",
  });
  return res.json(summary);
});

app.get("/projects/:id/costs/history", (req, res) => {
  const { id } = req.params;
  const project = findProjectById(id);
  if (!project) return res.status(404).json({ error: "project not found" });

  const daysRaw = typeof req.query.days === "string" ? Number(req.query.days) : NaN;
  const days = Number.isFinite(daysRaw) ? Math.trunc(daysRaw) : 30;
  if (days <= 0) {
    return res.status(400).json({ error: "`days` must be a positive number" });
  }

  return res.json(getProjectCostHistory(project.id, days));
});

app.get("/budget", (_req, res) => {
  return res.json(getGlobalBudget());
});

app.put("/budget", (req, res) => {
  const value = req.body?.monthly_budget_usd;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return res.status(400).json({ error: "`monthly_budget_usd` must be a non-negative number" });
  }
  return res.json(setGlobalMonthlyBudget(value));
});

app.get("/projects/:id/budget", (req, res) => {
  const { id } = req.params;
  const project = findProjectById(id);
  if (!project) return res.status(404).json({ error: "project not found" });
  const budget = getProjectBudget(project.id);
  syncProjectBudgetAlerts({
    projectId: project.id,
    projectName: project.name,
    projectPath: project.path,
    projectBudget: budget,
  });
  return res.json(budget);
});

app.put("/projects/:id/budget", (req, res) => {
  const { id } = req.params;
  const project = findProjectById(id);
  if (!project) return res.status(404).json({ error: "project not found" });
  const value = req.body?.monthly_allocation_usd;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return res.status(400).json({ error: "`monthly_allocation_usd` must be a non-negative number" });
  }
  return res.json(setProjectBudget(project.id, value));
});

app.post("/projects/:id/budget/transfer", (req, res) => {
  const { id } = req.params;
  const project = findProjectById(id);
  if (!project) return res.status(404).json({ error: "project not found" });
  const toProjectId =
    typeof req.body?.to_project_id === "string" ? req.body.to_project_id.trim() : "";
  const amount = req.body?.amount_usd;

  if (!toProjectId) {
    return res.status(400).json({ error: "`to_project_id` must be provided" });
  }
  if (toProjectId === project.id) {
    return res.status(400).json({ error: "cannot transfer to the same project" });
  }
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) {
    return res.status(400).json({ error: "`amount_usd` must be a positive number" });
  }
  const targetProject = findProjectById(toProjectId);
  if (!targetProject) return res.status(404).json({ error: "target project not found" });

  try {
    const result = transferProjectBudget({
      fromProjectId: project.id,
      toProjectId: targetProject.id,
      amountUsd: amount,
    });
    return res.json(result);
  } catch (err) {
    return res.status(400).json({
      error: err instanceof Error ? err.message : "failed to transfer budget",
    });
  }
});

app.get("/projects/:id/budget/enforcement", (req, res) => {
  const { id } = req.params;
  const project = findProjectById(id);
  if (!project) return res.status(404).json({ error: "project not found" });
  const limitRaw = typeof req.query.limit === "string" ? Number(req.query.limit) : NaN;
  const limit =
    Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(200, Math.trunc(limitRaw)) : 50;
  const events = listBudgetEnforcementLog(project.id, limit);
  return res.json({ events });
});

function normalizeStringArrayField(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  const entries = Array.isArray(value) ? value : [value];
  return entries
    .map((entry) => {
      if (typeof entry === "string") return entry.trim();
      if (typeof entry === "number" || typeof entry === "boolean") return String(entry);
      return "";
    })
    .filter(Boolean);
}

function normalizePatternTags(tags: string[]): string[] {
  const normalized = tags
    .map((tag) => tag.trim().toLowerCase())
    .filter(Boolean);
  return Array.from(new Set(normalized));
}

function normalizeDecisionArrayField(value: unknown): ShiftHandoffDecision[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) return [];
  const decisions: ShiftHandoffDecision[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    const decision = typeof record.decision === "string" ? record.decision.trim() : "";
    const rationale = typeof record.rationale === "string" ? record.rationale.trim() : "";
    if (!decision || !rationale) continue;
    decisions.push({ decision, rationale });
  }
  return decisions;
}

function parsePatternTagsQuery(
  value: unknown
): { ok: true; tags: string[] } | { ok: false; error: string } {
  if (value === undefined) {
    return { ok: false, error: "`tags` query param is required" };
  }
  const entries = Array.isArray(value) ? value : [value];
  const tags: string[] = [];
  for (const entry of entries) {
    if (typeof entry !== "string") {
      return { ok: false, error: "`tags` must be a comma-separated string" };
    }
    for (const part of entry.split(",")) {
      const trimmed = part.trim();
      if (trimmed) tags.push(trimmed);
    }
  }
  const normalized = normalizePatternTags(tags);
  if (!normalized.length) {
    return { ok: false, error: "`tags` must include at least one value" };
  }
  return { ok: true, tags: normalized };
}

function parseCreatePatternInput(
  payload: unknown
): { ok: true; input: CreateGlobalPatternInput } | { ok: false; error: string } {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { ok: false, error: "request body must be an object" };
  }
  const record = payload as Record<string, unknown>;
  const nameRaw = typeof record.name === "string" ? record.name.trim() : "";
  if (!nameRaw) return { ok: false, error: "`name` must be a non-empty string" };
  const descriptionRaw =
    typeof record.description === "string" ? record.description.trim() : "";
  if (!descriptionRaw) {
    return { ok: false, error: "`description` must be a non-empty string" };
  }
  const tagsRaw = normalizeStringArrayField(record.tags) ?? [];
  const tags = normalizePatternTags(tagsRaw);
  if (!tags.length) {
    return { ok: false, error: "`tags` must include at least one value" };
  }
  const sourceProjectRaw =
    typeof record.source_project === "string" ? record.source_project.trim() : "";
  if (!sourceProjectRaw) {
    return { ok: false, error: "`source_project` must be a non-empty string" };
  }
  const sourceWoRaw =
    typeof record.source_wo === "string" ? record.source_wo.trim() : "";
  if (!sourceWoRaw) {
    return { ok: false, error: "`source_wo` must be a non-empty string" };
  }

  const implementationNotes =
    typeof record.implementation_notes === "string"
      ? record.implementation_notes.trim()
      : null;
  const successMetrics =
    typeof record.success_metrics === "string" ? record.success_metrics.trim() : null;
  const createdAt =
    typeof record.created_at === "string" && record.created_at.trim()
      ? record.created_at.trim()
      : undefined;

  return {
    ok: true,
    input: {
      name: nameRaw,
      description: descriptionRaw,
      tags,
      source_project: sourceProjectRaw,
      source_wo: sourceWoRaw,
      implementation_notes: implementationNotes,
      success_metrics: successMetrics,
      created_at: createdAt,
    },
  };
}

type WorkOrderFromPatternInput = {
  pattern_id: string;
  title?: string;
};

function parseWorkOrderFromPatternInput(
  payload: unknown
): { ok: true; input: WorkOrderFromPatternInput } | { ok: false; error: string } {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { ok: false, error: "request body must be an object" };
  }
  const record = payload as Record<string, unknown>;
  const patternId = typeof record.pattern_id === "string" ? record.pattern_id.trim() : "";
  if (!patternId) {
    return { ok: false, error: "`pattern_id` must be a non-empty string" };
  }
  const title =
    typeof record.title === "string" && record.title.trim()
      ? record.title.trim()
      : undefined;

  return { ok: true, input: { pattern_id: patternId, title } };
}

function parseStartShiftInput(
  payload: unknown
):
  | { ok: true; input: { agentType?: string; agentId?: string; timeoutMinutes?: number } }
  | { ok: false; error: string } {
  if (payload === undefined || payload === null) {
    return { ok: true, input: {} };
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { ok: false, error: "request body must be an object" };
  }

  const record = payload as Record<string, unknown>;
  const input: { agentType?: string; agentId?: string; timeoutMinutes?: number } = {};

  if ("agent_type" in record) {
    if (typeof record.agent_type !== "string" || !record.agent_type.trim()) {
      return { ok: false, error: "`agent_type` must be a non-empty string" };
    }
    input.agentType = record.agent_type.trim();
  }

  if ("agent_id" in record) {
    if (typeof record.agent_id !== "string" || !record.agent_id.trim()) {
      return { ok: false, error: "`agent_id` must be a non-empty string" };
    }
    input.agentId = record.agent_id.trim();
  }

  if ("timeout_minutes" in record) {
    if (
      typeof record.timeout_minutes !== "number" ||
      !Number.isFinite(record.timeout_minutes) ||
      record.timeout_minutes <= 0
    ) {
      return { ok: false, error: "`timeout_minutes` must be a positive number" };
    }
    input.timeoutMinutes = record.timeout_minutes;
  }

  return { ok: true, input };
}

function parseCreateShiftHandoffInput(
  payload: unknown
):
  | { ok: true; input: CreateShiftHandoffInput }
  | { ok: false; error: string } {
  if (!payload || typeof payload !== "object") {
    return { ok: false, error: "request body required" };
  }
  const record = payload as Record<string, unknown>;
  const summaryRaw = record.summary;
  if (typeof summaryRaw !== "string" || !summaryRaw.trim()) {
    return { ok: false, error: "`summary` must be a non-empty string" };
  }

  const input: CreateShiftHandoffInput = {
    summary: summaryRaw.trim(),
  };
  const work_completed = normalizeStringArrayField(record.work_completed);
  const recommendations = normalizeStringArrayField(record.recommendations);
  const blockers = normalizeStringArrayField(record.blockers);
  const next_priorities = normalizeStringArrayField(record.next_priorities);
  const decisions_made = normalizeDecisionArrayField(record.decisions_made);

  if (work_completed !== undefined) input.work_completed = work_completed;
  if (recommendations !== undefined) input.recommendations = recommendations;
  if (blockers !== undefined) input.blockers = blockers;
  if (next_priorities !== undefined) input.next_priorities = next_priorities;
  if (decisions_made !== undefined) input.decisions_made = decisions_made;
  if (typeof record.agent_id === "string" && record.agent_id.trim()) {
    input.agent_id = record.agent_id.trim();
  }
  if (typeof record.duration_minutes === "number" && Number.isFinite(record.duration_minutes)) {
    input.duration_minutes = record.duration_minutes;
  }

  return { ok: true, input };
}

function parseProjectStateField(
  value: unknown
):
  | { ok: true; state: CreateGlobalShiftHandoffInput["project_state"] | undefined }
  | { ok: false; error: string } {
  if (value === undefined) return { ok: true, state: undefined };
  if (value === null) return { ok: true, state: null };
  if (typeof value === "string") {
    try {
      return {
        ok: true,
        state: JSON.parse(value) as CreateGlobalShiftHandoffInput["project_state"],
      };
    } catch {
      return { ok: false, error: "`project_state` must be valid JSON" };
    }
  }
  if (typeof value === "object") {
    return {
      ok: true,
      state: value as CreateGlobalShiftHandoffInput["project_state"],
    };
  }
  return { ok: false, error: "`project_state` must be an object or JSON string" };
}

function parseCreateGlobalShiftHandoffInput(
  payload: unknown
):
  | { ok: true; input: CreateGlobalShiftHandoffInput }
  | { ok: false; error: string } {
  if (!payload || typeof payload !== "object") {
    return { ok: false, error: "request body required" };
  }
  const record = payload as Record<string, unknown>;
  const summaryRaw = record.summary;
  if (typeof summaryRaw !== "string" || !summaryRaw.trim()) {
    return { ok: false, error: "`summary` must be a non-empty string" };
  }

  const input: CreateGlobalShiftHandoffInput = {
    summary: summaryRaw.trim(),
  };
  const actions_taken = normalizeStringArrayField(record.actions_taken);
  const pending_items = normalizeStringArrayField(record.pending_items);
  const decisions_made = normalizeDecisionArrayField(record.decisions_made);
  const project_state = parseProjectStateField(record.project_state);
  if (!project_state.ok) return { ok: false, error: project_state.error };

  if (actions_taken !== undefined) input.actions_taken = actions_taken;
  if (pending_items !== undefined) input.pending_items = pending_items;
  if (decisions_made !== undefined) input.decisions_made = decisions_made;
  if (project_state.state !== undefined) input.project_state = project_state.state;
  if (typeof record.agent_id === "string" && record.agent_id.trim()) {
    input.agent_id = record.agent_id.trim();
  }
  if (typeof record.duration_minutes === "number" && Number.isFinite(record.duration_minutes)) {
    input.duration_minutes = record.duration_minutes;
  }

  return { ok: true, input };
}

function parseAbandonShiftInput(
  payload: unknown
):
  | { ok: true; reason: string | null }
  | { ok: false; error: string } {
  if (payload === undefined || payload === null) {
    return { ok: true, reason: null };
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { ok: false, error: "request body must be an object" };
  }
  const record = payload as Record<string, unknown>;
  if (!("reason" in record)) {
    return { ok: true, reason: null };
  }
  if (typeof record.reason !== "string") {
    return { ok: false, error: "`reason` must be a string" };
  }
  const trimmed = record.reason.trim();
  return { ok: true, reason: trimmed ? trimmed : null };
}

const PROJECT_STATUS_SET = new Set<ProjectRow["status"]>(["active", "blocked", "parked"]);

function parseCreateProjectInput(
  payload: unknown
): { ok: true; input: CreateProjectInput } | { ok: false; error: string } {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { ok: false, error: "request body must be an object" };
  }
  const record = payload as Record<string, unknown>;
  const pathRaw = typeof record.path === "string" ? record.path.trim() : "";
  if (!pathRaw) return { ok: false, error: "`path` must be a non-empty string" };
  const name = typeof record.name === "string" ? record.name.trim() : "";
  const id = typeof record.id === "string" ? record.id.trim() : "";
  const statusRaw = typeof record.status === "string" ? record.status.trim() : "";
  if (statusRaw && !PROJECT_STATUS_SET.has(statusRaw as ProjectRow["status"])) {
    return { ok: false, error: "`status` must be active, blocked, or parked" };
  }
  const priorityRaw = typeof record.priority === "number" ? record.priority : NaN;
  if (Number.isFinite(priorityRaw) && priorityRaw <= 0) {
    return { ok: false, error: "`priority` must be a positive number" };
  }
  const initGit =
    typeof record.init_git === "boolean" ? record.init_git : undefined;

  return {
    ok: true,
    input: {
      path: pathRaw,
      name: name || undefined,
      id: id || undefined,
      status: statusRaw ? (statusRaw as ProjectRow["status"]) : undefined,
      priority: Number.isFinite(priorityRaw) ? Math.trunc(priorityRaw) : undefined,
      init_git: initGit,
    },
  };
}

type EscalationCreateInput = {
  type: EscalationType;
  summary: string;
  payload: string | null;
  run_id: string | null;
  shift_id: string | null;
};

function serializeOptionalJson(
  value: unknown,
  fieldName: string
): { ok: true; value: string | null } | { ok: false; error: string } {
  if (value === undefined || value === null) return { ok: true, value: null };
  if (typeof value === "string") {
    const trimmed = value.trim();
    return { ok: true, value: trimmed ? trimmed : null };
  }
  try {
    return { ok: true, value: JSON.stringify(value) };
  } catch {
    return { ok: false, error: `\`${fieldName}\` must be JSON-serializable` };
  }
}

function serializeRequiredJson(
  value: unknown,
  fieldName: string
): { ok: true; value: string } | { ok: false; error: string } {
  if (value === undefined) {
    return { ok: false, error: `\`${fieldName}\` is required` };
  }
  if (value === null) {
    return { ok: false, error: `\`${fieldName}\` must not be null` };
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return { ok: false, error: `\`${fieldName}\` must be a non-empty string` };
    }
    return { ok: true, value: trimmed };
  }
  try {
    return { ok: true, value: JSON.stringify(value) };
  } catch {
    return { ok: false, error: `\`${fieldName}\` must be JSON-serializable` };
  }
}

function parseEscalationCreateInput(
  payload: unknown
): { ok: true; input: EscalationCreateInput } | { ok: false; error: string } {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { ok: false, error: "request body must be an object" };
  }
  const record = payload as Record<string, unknown>;
  const rawType = typeof record.type === "string" ? record.type.trim() : "";
  if (!rawType || !ESCALATION_TYPE_SET.has(rawType as EscalationType)) {
    return {
      ok: false,
      error:
        "`type` must be one of need_input, blocked, decision_required, error, budget_warning, budget_critical, budget_exhausted, run_blocked",
    };
  }
  const summary = typeof record.summary === "string" ? record.summary.trim() : "";
  if (!summary) {
    return { ok: false, error: "`summary` must be a non-empty string" };
  }

  if ("run_id" in record) {
    if (typeof record.run_id !== "string" || !record.run_id.trim()) {
      return { ok: false, error: "`run_id` must be a non-empty string" };
    }
  }
  if ("shift_id" in record) {
    if (typeof record.shift_id !== "string" || !record.shift_id.trim()) {
      return { ok: false, error: "`shift_id` must be a non-empty string" };
    }
  }

  const payloadValue = serializeOptionalJson(record.payload, "payload");
  if (!payloadValue.ok) return { ok: false, error: payloadValue.error };

  return {
    ok: true,
    input: {
      type: rawType as EscalationType,
      summary,
      payload: payloadValue.value,
      run_id: typeof record.run_id === "string" ? record.run_id.trim() : null,
      shift_id: typeof record.shift_id === "string" ? record.shift_id.trim() : null,
    },
  };
}

function parseEscalationResolutionInput(
  payload: unknown
): { ok: true; resolution: string } | { ok: false; error: string } {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { ok: false, error: "request body must be an object" };
  }
  const record = payload as Record<string, unknown>;
  if (!("resolution" in record)) {
    return { ok: false, error: "`resolution` is required" };
  }
  const resolved = serializeRequiredJson(record.resolution, "resolution");
  if (!resolved.ok) return { ok: false, error: resolved.error };
  return { ok: true, resolution: resolved.value };
}

function parseEscalationStatusQuery(
  value: unknown
): { ok: true; statuses: EscalationStatus[] } | { ok: false; error: string } {
  if (value === undefined) {
    return { ok: true, statuses: ["pending"] };
  }
  const entries = Array.isArray(value) ? value : [value];
  const statuses: EscalationStatus[] = [];
  for (const entry of entries) {
    if (typeof entry !== "string") {
      return { ok: false, error: "`status` must be a comma-separated string" };
    }
    for (const part of entry.split(",")) {
      const trimmed = part.trim();
      if (!trimmed) continue;
      if (!ESCALATION_STATUS_SET.has(trimmed as EscalationStatus)) {
        return {
          ok: false,
          error:
            "`status` must be one of pending, claimed, resolved, escalated_to_user",
        };
      }
      statuses.push(trimmed as EscalationStatus);
    }
  }
  if (!statuses.length) return { ok: true, statuses: ["pending"] };
  return { ok: true, statuses: Array.from(new Set(statuses)) };
}

app.get("/global/context", (_req, res) => {
  const response = buildGlobalContextResponse();
  return res.json(response);
});

app.get("/global/preferences", (_req, res) => {
  return res.json(getUserPreferences());
});

app.patch("/global/preferences", (req, res) => {
  const parsed = parsePreferencesPatch(req.body);
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });
  const updated = updateExplicitPreferences(parsed.patch);
  try {
    createUserInteraction({
      action_type: "preferences_updated",
      context: { scope: "global" },
    });
  } catch {
    // Ignore interaction logging failures.
  }
  return res.json(updated);
});

app.get("/global/preferences/patterns", (_req, res) => {
  return res.json(getPreferencePatterns());
});

app.get("/global/escalations", (req, res) => {
  const parsedStatus = parseEscalationStatusQuery(req.query.status);
  if (!parsedStatus.ok) return res.status(400).json({ error: parsedStatus.error });
  const limitRaw = typeof req.query.limit === "string" ? Number(req.query.limit) : NaN;
  const limit =
    Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(200, Math.trunc(limitRaw)) : 100;
  const escalations = listEscalations({
    statuses: parsedStatus.statuses,
    order: "asc",
    limit,
  });
  return res.json({ escalations });
});

app.get("/global/patterns", (req, res) => {
  const limitRaw = typeof req.query.limit === "string" ? Number(req.query.limit) : NaN;
  const limit =
    Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(200, Math.trunc(limitRaw)) : 100;
  const patterns = listGlobalPatterns(limit);
  return res.json({ patterns });
});

app.get("/global/patterns/search", (req, res) => {
  const parsedTags = parsePatternTagsQuery(req.query.tags);
  if (!parsedTags.ok) return res.status(400).json({ error: parsedTags.error });
  const limitRaw = typeof req.query.limit === "string" ? Number(req.query.limit) : NaN;
  const limit =
    Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(200, Math.trunc(limitRaw)) : 50;
  const patterns = searchGlobalPatternsByTags(parsedTags.tags, limit);
  return res.json({ tags: parsedTags.tags, patterns });
});

app.post("/global/patterns", (req, res) => {
  const parsed = parseCreatePatternInput(req.body);
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });
  try {
    const created = createGlobalPattern(parsed.input);
    return res.status(201).json(created);
  } catch (err) {
    return res.status(500).json({
      error: err instanceof Error ? err.message : "failed to create pattern",
    });
  }
});

app.post("/projects", (req, res) => {
  const parsed = parseCreateProjectInput(req.body);
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });
  const created = createProjectFromSpec(parsed.input);
  if (!created.ok) return res.status(400).json({ error: created.error });
  const project = findProjectById(created.projectId);
  return res.status(201).json({
    project: project ?? { id: created.projectId, path: created.path },
  });
});

app.post("/global/shifts", (req, res) => {
  const parsed = parseStartShiftInput(req.body);
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });
  const result = startGlobalShift({
    agentType: parsed.input.agentType,
    agentId: parsed.input.agentId,
    timeoutMinutes: parsed.input.timeoutMinutes,
  });
  if (!result.ok) {
    return res.status(409).json({
      error: "shift already active",
      active_shift: result.activeShift,
    });
  }
  return res.status(201).json(result.shift);
});

app.get("/global/shifts/active", (_req, res) => {
  const shift = getActiveGlobalShift();
  return res.json(shift ?? null);
});

app.get("/global/shifts", (req, res) => {
  const limitRaw = typeof req.query.limit === "string" ? Number(req.query.limit) : NaN;
  const limit = Number.isFinite(limitRaw) ? Math.trunc(limitRaw) : 10;
  const shifts = listGlobalShifts(limit);
  return res.json(shifts);
});

app.post("/global/shifts/:shiftId/complete", (req, res) => {
  const { shiftId } = req.params;
  if (!shiftId || !shiftId.trim()) {
    return res.status(400).json({ error: "`shiftId` must be provided" });
  }

  const parsed = parseCreateGlobalShiftHandoffInput(req.body);
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });

  expireStaleGlobalShifts();
  const shift = getGlobalShiftById(shiftId);
  if (!shift) return res.status(404).json({ error: "shift not found" });
  if (shift.status !== "active") {
    return res.status(409).json({ error: "shift not active", status: shift.status });
  }

  try {
    const input = { ...parsed.input };
    if (input.project_state === undefined) {
      input.project_state = buildGlobalContextResponse();
    }
    const handoff = createGlobalShiftHandoff({
      shiftId,
      input,
    });
    const completedAt = new Date().toISOString();
    const updatedOk = updateGlobalShift(shift.id, {
      status: "completed",
      completed_at: completedAt,
      handoff_id: handoff.id,
      error: null,
    });
    if (!updatedOk) {
      return res.status(500).json({ error: "failed to update shift" });
    }
    const updatedShift =
      getGlobalShiftById(shiftId) ??
      ({
        ...shift,
        status: "completed",
        completed_at: completedAt,
        handoff_id: handoff.id,
        error: null,
      } as const);
    return res.json({ shift: updatedShift, handoff });
  } catch (err) {
    return res.status(500).json({
      error: err instanceof Error ? err.message : "failed to complete shift",
    });
  }
});

app.post("/global/shifts/:shiftId/handoff", (req, res) => {
  const { shiftId } = req.params;
  if (!shiftId || !shiftId.trim()) {
    return res.status(400).json({ error: "`shiftId` must be provided" });
  }
  const parsed = parseCreateGlobalShiftHandoffInput(req.body);
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });
  expireStaleGlobalShifts();
  const shift = getGlobalShiftById(shiftId);
  if (!shift) return res.status(404).json({ error: "shift not found" });
  if (shift.status !== "active") {
    return res.status(409).json({ error: "shift not active", status: shift.status });
  }
  try {
    const input = { ...parsed.input };
    if (input.project_state === undefined) {
      input.project_state = buildGlobalContextResponse();
    }
    const handoff = createGlobalShiftHandoff({
      shiftId,
      input,
    });
    return res.status(201).json(handoff);
  } catch (err) {
    return res.status(500).json({
      error: err instanceof Error ? err.message : "failed to create handoff",
    });
  }
});

app.get("/global/sessions/active", (req, res) => {
  const limitRaw = typeof req.query.limit === "string" ? Number(req.query.limit) : NaN;
  const limit = Number.isFinite(limitRaw) ? Math.trunc(limitRaw) : 50;
  const session = getActiveGlobalAgentSession();
  if (!session) {
    return res.json({ session: null, events: [] });
  }
  const events = listGlobalAgentSessionEvents({ sessionId: session.id, limit });
  return res.json({ session, events });
});

app.get("/global/sessions/:sessionId/events", (req, res) => {
  const { sessionId } = req.params;
  if (!sessionId || !sessionId.trim()) {
    return res.status(400).json({ error: "`sessionId` must be provided" });
  }
  const limitRaw = typeof req.query.limit === "string" ? Number(req.query.limit) : NaN;
  const limit = Number.isFinite(limitRaw) ? Math.trunc(limitRaw) : 50;
  const events = listGlobalAgentSessionEvents({ sessionId, limit });
  return res.json({ events });
});

app.post("/global/sessions", (_req, res) => {
  const created = createGlobalAgentSession();
  if (!created.ok) {
    return res.status(409).json({
      error: created.error,
      active_session: created.activeSession ?? null,
    });
  }
  return res.status(201).json({ session: created.session });
});

app.patch("/global/sessions/:sessionId", (req, res) => {
  const { sessionId } = req.params;
  if (!sessionId || !sessionId.trim()) {
    return res.status(400).json({ error: "`sessionId` must be provided" });
  }
  const updated = updateGlobalAgentSessionDetails(sessionId, req.body);
  if (!updated.ok) return res.status(400).json({ error: updated.error });
  return res.json({ session: updated.session });
});

app.post("/global/sessions/:sessionId/onboarding/complete", (req, res) => {
  const { sessionId } = req.params;
  if (!sessionId || !sessionId.trim()) {
    return res.status(400).json({ error: "`sessionId` must be provided" });
  }
  const result = completeGlobalAgentOnboarding(sessionId);
  if (!result.ok) return res.status(400).json({ error: result.error });
  return res.json({ session: result.session });
});

app.post("/global/sessions/:sessionId/start", (req, res) => {
  const { sessionId } = req.params;
  if (!sessionId || !sessionId.trim()) {
    return res.status(400).json({ error: "`sessionId` must be provided" });
  }
  const resume = Boolean(req.body && typeof req.body === "object" && "resume" in req.body && req.body.resume);
  const result = startGlobalAgentSessionAutonomous({ sessionId, resume });
  if (!result.ok) return res.status(400).json({ error: result.error });
  return res.json({ session: result.session });
});

app.post("/global/sessions/:sessionId/pause", (req, res) => {
  const { sessionId } = req.params;
  if (!sessionId || !sessionId.trim()) {
    return res.status(400).json({ error: "`sessionId` must be provided" });
  }
  const result = pauseGlobalAgentSession(sessionId, "user_pause");
  if (!result.ok) return res.status(400).json({ error: result.error });
  return res.json({ session: result.session });
});

app.post("/global/sessions/:sessionId/stop", (req, res) => {
  const { sessionId } = req.params;
  if (!sessionId || !sessionId.trim()) {
    return res.status(400).json({ error: "`sessionId` must be provided" });
  }
  const result = stopGlobalAgentSession(sessionId, "Stopped by user");
  if (!result.ok) return res.status(400).json({ error: result.error });
  return res.json({ session: result.session, summary: result.summary });
});

app.post("/global/sessions/:sessionId/end", (req, res) => {
  const { sessionId } = req.params;
  if (!sessionId || !sessionId.trim()) {
    return res.status(400).json({ error: "`sessionId` must be provided" });
  }
  const result = endGlobalAgentSession(sessionId);
  if (!result.ok) return res.status(400).json({ error: result.error });
  return res.json({ session: result.session });
});

app.post("/projects/:id/escalations", (req, res) => {
  const { id } = req.params;
  const project = findProjectById(id);
  if (!project) return res.status(404).json({ error: "project not found" });

  const parsed = parseEscalationCreateInput(req.body);
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });

  const escalation = createEscalation({
    project_id: project.id,
    type: parsed.input.type,
    summary: parsed.input.summary,
    payload: parsed.input.payload,
    run_id: parsed.input.run_id,
    shift_id: parsed.input.shift_id,
  });

  return res.status(201).json(escalation);
});

app.post("/escalations/:id/claim", (req, res) => {
  const escalation = getEscalationById(req.params.id);
  if (!escalation) return res.status(404).json({ error: "escalation not found" });
  if (escalation.status !== "pending") {
    return res.status(409).json({ error: "escalation not pending", status: escalation.status });
  }
  const updated = updateEscalation(escalation.id, {
    status: "claimed",
    claimed_by: ESCALATION_CLAIMANT,
  });
  if (!updated) return res.status(500).json({ error: "failed to claim escalation" });
  const refreshed = getEscalationById(escalation.id);
  return res.json(refreshed ?? escalation);
});

app.post("/escalations/:id/resolve", (req, res) => {
  const parsed = parseEscalationResolutionInput(req.body);
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });
  const escalation = getEscalationById(req.params.id);
  if (!escalation) return res.status(404).json({ error: "escalation not found" });
  if (escalation.status === "resolved") {
    return res.status(409).json({ error: "escalation already resolved" });
  }
  if (
    escalation.status !== "pending" &&
    escalation.status !== "claimed" &&
    escalation.status !== "escalated_to_user"
  ) {
    return res.status(409).json({ error: "escalation not resolvable", status: escalation.status });
  }
  const resolvedAt = new Date().toISOString();
  const updated = updateEscalation(escalation.id, {
    status: "resolved",
    resolution: parsed.resolution,
    resolved_at: resolvedAt,
  });
  if (!updated) return res.status(500).json({ error: "failed to resolve escalation" });
  try {
    createUserInteraction({
      action_type: "escalation_resolved",
      context: {
        escalation_id: escalation.id,
        project_id: escalation.project_id,
        type: escalation.type,
      },
    });
  } catch {
    // Ignore interaction logging failures.
  }
  const refreshed = getEscalationById(escalation.id);
  return res.json(refreshed ?? { ...escalation, status: "resolved", resolved_at: resolvedAt });
});

app.post("/escalations/:id/escalate-to-user", (req, res) => {
  const escalation = getEscalationById(req.params.id);
  if (!escalation) return res.status(404).json({ error: "escalation not found" });
  if (escalation.status === "resolved") {
    return res.status(409).json({ error: "escalation already resolved" });
  }
  if (escalation.status === "escalated_to_user") {
    return res.json(escalation);
  }

  const active = getOpenEscalationForProject(escalation.project_id);
  if (active && active.id !== escalation.id) {
    return res.status(409).json({
      error: "escalation already active for project",
      debounced: true,
      active_escalation_id: active.id,
    });
  }

  if (NON_URGENT_ESCALATION_TYPES.has(escalation.type)) {
    const preferences = getExplicitPreferences();
    const deferral = getEscalationDeferral({
      preferences,
      lastEscalationAt: getLastEscalationAt(),
    });
    if (deferral) {
      return res.json({
        escalation,
        deferred: true,
        reason: deferral.reason,
        retry_after_minutes: deferral.retry_after_minutes,
      });
    }
  }

  const updated = updateEscalation(escalation.id, {
    status: "escalated_to_user",
    claimed_by: escalation.claimed_by ?? ESCALATION_CLAIMANT,
  });
  if (!updated) {
    return res.status(500).json({ error: "failed to escalate to user" });
  }
  const refreshed = getEscalationById(escalation.id);
  return res.json(
    refreshed ??
      ({
        ...escalation,
        status: "escalated_to_user",
        claimed_by: escalation.claimed_by ?? ESCALATION_CLAIMANT,
      } as const)
  );
});

app.get("/projects/:id/shift-context", (req, res) => {
  const context = buildShiftContext(req.params.id);
  if (!context) return res.status(404).json({ error: "project not found" });
  syncProjectBudgetAlerts({
    projectId: context.project.id,
    projectName: context.project.name,
    projectPath: context.project.path,
    readyWorkOrderIds: context.work_orders.ready.map((wo) => wo.id),
  });
  return res.json(context);
});

app.post("/projects/:id/work-orders/generate", async (req, res) => {
  const { id } = req.params;
  const project = findProjectById(id);
  if (!project) return res.status(404).json({ error: "project not found" });

  const payload = req.body ?? {};
  const bodyProjectId =
    typeof payload.project_id === "string" ? payload.project_id.trim() : "";
  if (bodyProjectId && bodyProjectId !== id) {
    return res.status(400).json({ error: "`project_id` does not match path" });
  }

  const descriptionRaw =
    typeof payload.description === "string" ? payload.description.trim() : "";
  if (!descriptionRaw) {
    return res.status(400).json({ error: "`description` is required" });
  }

  const typeRaw = typeof payload.type === "string" ? payload.type.trim().toLowerCase() : "";
  const allowedTypes = new Set(["feature", "bugfix", "refactor", "research"]);
  if (typeRaw && !allowedTypes.has(typeRaw)) {
    return res.status(400).json({
      error: "`type` must be one of feature, bugfix, refactor, research",
    });
  }
  const type = typeRaw ? (typeRaw as "feature" | "bugfix" | "refactor" | "research") : undefined;

  let priority: number | null = null;
  if (payload.priority !== undefined) {
    const rawValue =
      typeof payload.priority === "string" ? Number(payload.priority) : payload.priority;
    if (typeof rawValue !== "number" || !Number.isFinite(rawValue)) {
      return res.status(400).json({ error: "`priority` must be a number" });
    }
    const clamped = Math.min(5, Math.max(1, Math.trunc(rawValue)));
    priority = clamped;
  }

  try {
    const result = await generateWorkOrderDraft({
      project,
      description: descriptionRaw,
      type,
      priority,
    });
    return res.json(result);
  } catch (err) {
    return res.status(500).json({
      error: "failed to generate work order",
      detail: err instanceof Error ? err.message : String(err),
    });
  }
});

app.post("/projects/:id/work-orders/from-pattern", (req, res) => {
  const { id } = req.params;
  const project = findProjectById(id);
  if (!project) return res.status(404).json({ error: "project not found" });

  const parsed = parseWorkOrderFromPatternInput(req.body);
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });

  const pattern = findGlobalPatternById(parsed.input.pattern_id);
  if (!pattern) return res.status(404).json({ error: "pattern not found" });

  let sourceWorkOrder: WorkOrder | null = null;
  const sourceProject = findProjectById(pattern.source_project);
  if (sourceProject) {
    try {
      sourceWorkOrder = getWorkOrder(sourceProject.path, pattern.source_wo);
    } catch {
      sourceWorkOrder = null;
    }
  }

  const baseTitle = parsed.input.title || sourceWorkOrder?.title || pattern.name;
  const baseTags = sourceWorkOrder?.tags?.length ? sourceWorkOrder.tags : pattern.tags;
  const mergedTags = Array.from(new Set([...baseTags, ...pattern.tags]));
  const basePriority = sourceWorkOrder?.priority ?? 3;
  const baseEra = sourceWorkOrder?.era ?? undefined;
  const baseBranch = sourceWorkOrder?.base_branch ?? undefined;

  try {
    const created = createWorkOrder(project.path, {
      title: baseTitle,
      priority: basePriority,
      tags: mergedTags,
      depends_on: [],
      era: baseEra ?? undefined,
      base_branch: baseBranch ?? undefined,
    });

    const context = [...(sourceWorkOrder?.context ?? [])];
    context.push(`Adapted from pattern ${pattern.id} (${pattern.name}).`);
    context.push(`Source project: ${pattern.source_project}.`);
    context.push(`Source work order: ${pattern.source_wo}.`);
    if (pattern.implementation_notes) {
      context.push(`Implementation notes: ${pattern.implementation_notes}`);
    }
    if (pattern.success_metrics) {
      context.push(`Success metrics: ${pattern.success_metrics}`);
    }

    const acceptanceCriteria =
      sourceWorkOrder?.acceptance_criteria.length
        ? sourceWorkOrder.acceptance_criteria
        : pattern.success_metrics
          ? [pattern.success_metrics]
          : [];

    const stopConditions =
      sourceWorkOrder?.stop_conditions.length
        ? sourceWorkOrder.stop_conditions
        : ["Stop and ask for clarification if adaptation needs changes."];

    const updated = patchWorkOrder(project.path, created.id, {
      goal: sourceWorkOrder?.goal ?? pattern.description,
      context,
      acceptance_criteria: acceptanceCriteria,
      non_goals: sourceWorkOrder?.non_goals ?? [],
      stop_conditions: stopConditions,
      estimate_hours: sourceWorkOrder?.estimate_hours ?? null,
      depends_on: [],
      status: "backlog",
      tags: mergedTags,
    });

    const sourceSummary = sourceWorkOrder
      ? {
          project_id: sourceProject?.id ?? pattern.source_project,
          work_order_id: sourceWorkOrder.id,
          title: sourceWorkOrder.title,
        }
      : null;

    return res.status(201).json({
      work_order: updated,
      pattern,
      source_work_order: sourceSummary,
    });
  } catch (err) {
    return sendWorkOrderError(res, err);
  }
});

app.post("/projects/:id/shifts", (req, res) => {
  const { id } = req.params;
  const project = findProjectById(id);
  if (!project) return res.status(404).json({ error: "project not found" });

  const parsed = parseStartShiftInput(req.body);
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });

  const result = startShift({
    projectId: project.id,
    agentType: parsed.input.agentType,
    agentId: parsed.input.agentId,
    timeoutMinutes: parsed.input.timeoutMinutes,
  });

  if (!result.ok) {
    return res.status(409).json({
      error: "shift already active",
      active_shift: result.activeShift,
    });
  }

  const context = buildShiftContext(project.id);
  if (!context) return res.status(500).json({ error: "failed to build shift context" });
  return res.status(201).json({ shift: result.shift, context });
});

app.get("/projects/:id/shifts/active", (req, res) => {
  const { id } = req.params;
  const project = findProjectById(id);
  if (!project) return res.status(404).json({ error: "project not found" });
  const shift = getActiveShift(project.id);
  return res.json(shift ?? null);
});

app.get("/projects/:id/shifts", (req, res) => {
  const { id } = req.params;
  const project = findProjectById(id);
  if (!project) return res.status(404).json({ error: "project not found" });
  const limitRaw = typeof req.query.limit === "string" ? Number(req.query.limit) : NaN;
  const limit = Number.isFinite(limitRaw) ? Math.trunc(limitRaw) : 10;
  const shifts = listShifts(project.id, limit);
  return res.json(shifts);
});

app.post("/projects/:id/shifts/:shiftId/complete", (req, res) => {
  const { id, shiftId } = req.params;
  const project = findProjectById(id);
  if (!project) return res.status(404).json({ error: "project not found" });
  if (!shiftId || !shiftId.trim()) {
    return res.status(400).json({ error: "`shiftId` must be provided" });
  }

  const parsed = parseCreateShiftHandoffInput(req.body);
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });

  expireStaleShifts(project.id);
  const shift = getShiftByProjectId(project.id, shiftId);
  if (!shift) return res.status(404).json({ error: "shift not found" });
  if (shift.status !== "active") {
    return res.status(409).json({ error: "shift not active", status: shift.status });
  }

  try {
    const handoff = createShiftHandoff({
      projectId: project.id,
      shiftId,
      input: parsed.input,
    });
    const completedAt = new Date().toISOString();
    const updatedOk = updateShift(shift.id, {
      status: "completed",
      completed_at: completedAt,
      handoff_id: handoff.id,
      error: null,
    });
    if (!updatedOk) {
      return res.status(500).json({ error: "failed to update shift" });
    }
    const updatedShift =
      getShiftByProjectId(project.id, shiftId) ??
      ({
        ...shift,
        status: "completed",
        completed_at: completedAt,
        handoff_id: handoff.id,
        error: null,
      } as const);
    return res.json({ shift: updatedShift, handoff });
  } catch (err) {
    return res.status(500).json({
      error: err instanceof Error ? err.message : "failed to complete shift",
    });
  }
});

app.post("/projects/:id/shifts/:shiftId/abandon", (req, res) => {
  const { id, shiftId } = req.params;
  const project = findProjectById(id);
  if (!project) return res.status(404).json({ error: "project not found" });
  if (!shiftId || !shiftId.trim()) {
    return res.status(400).json({ error: "`shiftId` must be provided" });
  }

  const parsed = parseAbandonShiftInput(req.body);
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });

  expireStaleShifts(project.id);
  const shift = getShiftByProjectId(project.id, shiftId);
  if (!shift) return res.status(404).json({ error: "shift not found" });
  if (shift.status !== "active") {
    return res.status(409).json({ error: "shift not active", status: shift.status });
  }

  const completedAt = new Date().toISOString();
  const reason = parsed.reason ?? "Shift abandoned";
  const updatedOk = updateShift(shift.id, {
    status: "failed",
    completed_at: completedAt,
    error: reason,
  });
  if (!updatedOk) {
    return res.status(500).json({ error: "failed to update shift" });
  }

  const updatedShift =
    getShiftByProjectId(project.id, shiftId) ??
    ({
      ...shift,
      status: "failed",
      completed_at: completedAt,
      error: reason,
    } as const);
  return res.json(updatedShift);
});

app.post("/projects/:id/shifts/:shiftId/handoff", (req, res) => {
  const { id, shiftId } = req.params;
  const project = findProjectById(id);
  if (!project) return res.status(404).json({ error: "project not found" });
  if (!shiftId || !shiftId.trim()) {
    return res.status(400).json({ error: "`shiftId` must be provided" });
  }
  const parsed = parseCreateShiftHandoffInput(req.body);
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });
  try {
    const handoff = createShiftHandoff({
      projectId: project.id,
      shiftId,
      input: parsed.input,
    });
    return res.status(201).json(handoff);
  } catch (err) {
    return res.status(500).json({
      error: err instanceof Error ? err.message : "failed to create handoff",
    });
  }
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
const VM_SIZES = new Set(["medium", "large", "xlarge"]);

function buildVmResponse(project: ProjectRow, vm: ProjectVmRow | null) {
  const fallbackVm = {
    project_id: project.id,
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
      error: "`vm_size` must be one of medium, large, xlarge",
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
      error: "`vm_size` must be one of medium, large, xlarge",
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

type TrackCounts = {
  workOrderCount: number;
  doneCount: number;
  readyCount: number;
};

function buildTrackCounts(workOrders: WorkOrder[]): Map<string, TrackCounts> {
  const counts = new Map<string, TrackCounts>();
  for (const wo of workOrders) {
    if (!wo.trackId) continue;
    const entry = counts.get(wo.trackId) ?? {
      workOrderCount: 0,
      doneCount: 0,
      readyCount: 0,
    };
    entry.workOrderCount += 1;
    if (wo.status === "done") entry.doneCount += 1;
    if (wo.status === "ready") entry.readyCount += 1;
    counts.set(wo.trackId, entry);
  }
  return counts;
}

function applyTrackCounts(track: Track, counts: Map<string, TrackCounts>): Track {
  const entry = counts.get(track.id);
  if (!entry) return track;
  return { ...track, ...entry };
}

function normalizeOptionalText(value: string): string | null {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
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

app.get("/repos/:id/tracks", (req, res) => {
  const { id } = req.params;
  const project = findProjectById(id);
  if (!project) return res.status(404).json({ error: "project not found" });

  const workOrders = listWorkOrders(project.path);
  const counts = buildTrackCounts(workOrders);
  const tracks = listTracks(project.id).map((track) => applyTrackCounts(track, counts));
  return res.json({ tracks });
});

app.post("/repos/:id/tracks", (req, res) => {
  const { id } = req.params;
  const project = findProjectById(id);
  if (!project) return res.status(404).json({ error: "project not found" });

  const payload = req.body ?? {};
  const nameValue = payload.name;
  if (typeof nameValue !== "string" || !nameValue.trim()) {
    return res.status(400).json({ error: "`name` is required" });
  }

  const descriptionValue = payload.description;
  if (
    descriptionValue !== undefined &&
    descriptionValue !== null &&
    typeof descriptionValue !== "string"
  ) {
    return res.status(400).json({ error: "`description` must be a string" });
  }
  const goalValue = payload.goal;
  if (goalValue !== undefined && goalValue !== null && typeof goalValue !== "string") {
    return res.status(400).json({ error: "`goal` must be a string" });
  }
  const colorValue = payload.color;
  if (colorValue !== undefined && colorValue !== null && typeof colorValue !== "string") {
    return res.status(400).json({ error: "`color` must be a string" });
  }
  const iconValue = payload.icon;
  if (iconValue !== undefined && iconValue !== null && typeof iconValue !== "string") {
    return res.status(400).json({ error: "`icon` must be a string" });
  }
  const sortOrderValue = payload.sortOrder;
  if (
    sortOrderValue !== undefined &&
    (typeof sortOrderValue !== "number" || !Number.isFinite(sortOrderValue))
  ) {
    return res.status(400).json({ error: "`sortOrder` must be a number" });
  }

  const track = createTrack({
    project_id: project.id,
    name: nameValue.trim(),
    description:
      typeof descriptionValue === "string"
        ? normalizeOptionalText(descriptionValue)
        : null,
    goal: typeof goalValue === "string" ? normalizeOptionalText(goalValue) : null,
    color: typeof colorValue === "string" ? normalizeOptionalText(colorValue) : null,
    icon: typeof iconValue === "string" ? normalizeOptionalText(iconValue) : null,
    sort_order:
      typeof sortOrderValue === "number" ? Math.trunc(sortOrderValue) : undefined,
  });

  return res.status(201).json({ track });
});

app.get("/repos/:id/tracks/:trackId", (req, res) => {
  const { id, trackId } = req.params;
  const project = findProjectById(id);
  if (!project) return res.status(404).json({ error: "project not found" });

  const track = getTrackById(project.id, trackId);
  if (!track) return res.status(404).json({ error: "track not found" });

  const workOrders = listWorkOrders(project.path).filter(
    (wo) => wo.trackId === trackId
  );
  const counts: TrackCounts = {
    workOrderCount: workOrders.length,
    doneCount: workOrders.filter((wo) => wo.status === "done").length,
    readyCount: workOrders.filter((wo) => wo.status === "ready").length,
  };

  return res.json({ track: { ...track, ...counts }, workOrders });
});

app.put("/repos/:id/tracks/:trackId", (req, res) => {
  const { id, trackId } = req.params;
  const project = findProjectById(id);
  if (!project) return res.status(404).json({ error: "project not found" });

  const payload = req.body ?? {};
  const patch: {
    name?: string;
    description?: string | null;
    goal?: string | null;
    color?: string | null;
    icon?: string | null;
    sortOrder?: number;
  } = {};

  if ("name" in payload) {
    if (typeof payload.name !== "string" || !payload.name.trim()) {
      return res.status(400).json({ error: "`name` must be a non-empty string" });
    }
    patch.name = payload.name.trim();
  }
  if ("description" in payload) {
    if (payload.description === null) {
      patch.description = null;
    } else if (typeof payload.description === "string") {
      patch.description = normalizeOptionalText(payload.description);
    } else {
      return res.status(400).json({ error: "`description` must be a string or null" });
    }
  }
  if ("goal" in payload) {
    if (payload.goal === null) {
      patch.goal = null;
    } else if (typeof payload.goal === "string") {
      patch.goal = normalizeOptionalText(payload.goal);
    } else {
      return res.status(400).json({ error: "`goal` must be a string or null" });
    }
  }
  if ("color" in payload) {
    if (payload.color === null) {
      patch.color = null;
    } else if (typeof payload.color === "string") {
      patch.color = normalizeOptionalText(payload.color);
    } else {
      return res.status(400).json({ error: "`color` must be a string or null" });
    }
  }
  if ("icon" in payload) {
    if (payload.icon === null) {
      patch.icon = null;
    } else if (typeof payload.icon === "string") {
      patch.icon = normalizeOptionalText(payload.icon);
    } else {
      return res.status(400).json({ error: "`icon` must be a string or null" });
    }
  }
  if ("sortOrder" in payload) {
    if (
      typeof payload.sortOrder !== "number" ||
      !Number.isFinite(payload.sortOrder)
    ) {
      return res.status(400).json({ error: "`sortOrder` must be a number" });
    }
    patch.sortOrder = Math.trunc(payload.sortOrder);
  }

  if (!Object.keys(patch).length) {
    return res.status(400).json({ error: "No valid fields to update" });
  }

  const track = updateTrack(project.id, trackId, patch);
  if (!track) return res.status(404).json({ error: "track not found" });
  return res.json({ track });
});

app.delete("/repos/:id/tracks/:trackId", (req, res) => {
  const { id, trackId } = req.params;
  const project = findProjectById(id);
  if (!project) return res.status(404).json({ error: "project not found" });

  const deleted = deleteTrack(project.id, trackId);
  if (!deleted) return res.status(404).json({ error: "track not found" });
  return res.json({ ok: true });
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
    trackId: string | null;
    track: { id: string; name: string; color: string | null } | null;
  };

  const nodes: DependencyNode[] = workOrders.map((wo) => ({
    id: wo.id,
    title: wo.title,
    status: wo.status,
    priority: wo.priority,
    era: wo.era,
    dependsOn: wo.depends_on,
    dependents: dependentsMap.get(wo.id) ?? [],
    trackId: wo.trackId,
    track: wo.track,
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

app.get("/repos/:id/run-metrics/summary", (req, res) => {
  const { id } = req.params;
  const project = findProjectById(id);
  if (!project) return res.status(404).json({ error: "project not found" });
  return res.json(getRunPhaseMetricsSummary(project.id));
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
    const sourceBranch =
      typeof req.body?.source_branch === "string" ? req.body.source_branch.trim() : "";
    const run = enqueueCodexRun(project.id, workOrderId, sourceBranch || null);
    return res.status(201).json(run);
  } catch (err) {
    if (err instanceof BudgetEnforcementError) {
      return res.status(409).json({
        error: err.message,
        code: err.code,
        details: err.details,
      });
    }
    return res.status(400).json({ error: String(err instanceof Error ? err.message : err) });
  }
});

app.get("/runs/:runId", (req, res) => {
  const run = getRun(req.params.runId);
  if (!run) return res.status(404).json({ error: "run not found" });
  return res.json(run);
});

app.get("/runs/:runId/logs/tail", (req, res) => {
  const linesRaw = typeof req.query.lines === "string" ? Number(req.query.lines) : NaN;
  const lines = Number.isFinite(linesRaw)
    ? Math.max(1, Math.min(500, Math.trunc(linesRaw)))
    : 50;
  const tail = tailRunLog(req.params.runId, lines);
  if (!tail) return res.status(404).json({ error: "run not found" });
  return res.json(tail);
});

app.get("/runs/:runId/metrics", (req, res) => {
  const runId = req.params.runId;
  const run = getRunById(runId);
  if (!run) return res.status(404).json({ error: "run not found" });
  return res.json(listRunPhaseMetrics(runId));
});

app.post("/runs/:runId/cancel", async (req, res) => {
  try {
    const result = await cancelRun(req.params.runId);
    if (!result.ok) {
      const status =
        result.code === "not_found" ? 404 : result.code === "not_cancelable" ? 400 : 500;
      return res.status(status).json({ error: result.error });
    }
    return res.json(result.run);
  } catch (err) {
    return res.status(500).json({
      error: err instanceof Error ? err.message : "cancel failed",
    });
  }
});

app.post("/runs/:runId/provide-input", (req, res) => {
  const inputs =
    req.body && typeof req.body === "object" && "inputs" in req.body
      ? (req.body.inputs as Record<string, unknown>)
      : null;
  if (!inputs || typeof inputs !== "object" || Array.isArray(inputs)) {
    return res.status(400).json({ error: "inputs object required" });
  }
  const result = provideRunInput(req.params.runId, inputs);
  if (!result.ok) return res.status(400).json({ error: result.error });
  try {
    createUserInteraction({
      action_type: "run_input_provided",
      context: { run_id: req.params.runId },
    });
  } catch {
    // Ignore interaction logging failures.
  }
  return res.json({ ok: true });
});

app.post("/runs/:runId/resolve", (req, res) => {
  const result = finalizeManualRunResolution(req.params.runId);
  if (!result.ok) return res.status(400).json({ error: result.error });
  try {
    createUserInteraction({
      action_type: "run_resolved",
      context: { run_id: req.params.runId },
    });
  } catch {
    // Ignore interaction logging failures.
  }
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
    const thread = getChatThreadById(threadId);
    if (thread?.scope === "global") {
      pauseAutonomousSessionForUserMessage();
    }
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
    pauseAutonomousSessionForUserMessage();
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
