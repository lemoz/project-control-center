import "./env.js";
import express, { type Response } from "express";
import cors from "cors";
import {
  findProjectById,
  markInProgressRunsFailed,
  setProjectStar,
} from "./db.js";
import { getDiscoveredRepoPaths, syncAndListRepoSummaries } from "./projects_catalog.js";
import {
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
  enqueueCodexRun,
  getRun,
  getRunsForProject,
} from "./runner_agent.js";
import { enqueueChatTurn, getChatRunDetails, getChatThreadDetails } from "./chat_agent.js";
import { applyChatAction, undoChatAction } from "./chat_actions.js";
import { listChatActionLedger } from "./chat_db.js";

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
    methods: ["GET", "POST", "PATCH", "OPTIONS"],
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

app.get("/repos", (_req, res) => {
  return res.json(syncAndListRepoSummaries());
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
    const updated = patchWorkOrder(project.path, workOrderId, req.body ?? {});
    return res.json(updated);
  } catch (err) {
    return sendWorkOrderError(res, err);
  }
});

app.get("/repos/:id/runs", (req, res) => {
  const { id } = req.params;
  const project = findProjectById(id);
  if (!project) return res.status(404).json({ error: "project not found" });
  const limitRaw = typeof req.query.limit === "string" ? Number(req.query.limit) : 50;
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(200, Math.trunc(limitRaw)) : 50;
  return res.json({ runs: getRunsForProject(project.id, limit) });
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

app.post("/repos/scan", (_req, res) => {
  const repos = getDiscoveredRepoPaths({ forceRescan: true });
  return res.json({ ok: true, scanned_at: new Date().toISOString(), repos });
});

app.get("/chat/global", (_req, res) => {
  const details = getChatThreadDetails({ scope: "global" });
  const ledger = listChatActionLedger({ threadId: details.thread.id, limit: 200 });
  return res.json({ ...details, action_ledger: ledger });
});

app.post("/chat/global/messages", (req, res) => {
  try {
    const content = String(req.body?.content ?? "");
    const run = enqueueChatTurn({ scope: "global", content });
    return res.status(201).json(run);
  } catch (err) {
    return res.status(400).json({ error: String(err instanceof Error ? err.message : err) });
  }
});

app.get("/chat/projects/:id", (req, res) => {
  const { id } = req.params;
  const details = getChatThreadDetails({ scope: "project", projectId: id });
  const ledger = listChatActionLedger({ threadId: details.thread.id, limit: 200 });
  return res.json({ ...details, action_ledger: ledger });
});

app.post("/chat/projects/:id/messages", (req, res) => {
  const { id } = req.params;
  try {
    const content = String(req.body?.content ?? "");
    const run = enqueueChatTurn({ scope: "project", projectId: id, content });
    return res.status(201).json(run);
  } catch (err) {
    return res.status(400).json({ error: String(err instanceof Error ? err.message : err) });
  }
});

app.get("/chat/projects/:id/work-orders/:workOrderId", (req, res) => {
  const { id, workOrderId } = req.params;
  const details = getChatThreadDetails({ scope: "work_order", projectId: id, workOrderId });
  const ledger = listChatActionLedger({ threadId: details.thread.id, limit: 200 });
  return res.json({ ...details, action_ledger: ledger });
});

app.post("/chat/projects/:id/work-orders/:workOrderId/messages", (req, res) => {
  const { id, workOrderId } = req.params;
  try {
    const content = String(req.body?.content ?? "");
    const run = enqueueChatTurn({ scope: "work_order", projectId: id, workOrderId, content });
    return res.status(201).json(run);
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
