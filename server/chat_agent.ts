import { spawn } from "child_process";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { findProjectById, getDb } from "./db.js";
import {
  countChatMessages,
  createChatMessage,
  createChatRun,
  ensureChatThread,
  getChatRunById,
  getChatThreadById,
  insertChatRunCommand,
  listChatMessages,
  type ChatMessageRow,
  listChatRunCommands,
  listChatRunsForThread,
  replaceChatRunCommands,
  updateChatRun,
  updateChatThreadSummary,
  type ChatMessageRole,
  type ChatRunCommandRow,
  type ChatRunRow,
  type ChatScope,
  type ChatThreadRow,
} from "./chat_db.js";
import {
  ChatActionSchema,
  ChatResponseWireSchema,
  ChatSummaryResponseSchema,
  type ChatAction,
} from "./chat_contract.js";
import { listWorkOrders, type WorkOrder } from "./work_orders.js";
import { resolveChatSettings } from "./settings.js";
import { ensurePortfolioWorkspace } from "./portfolio_workspace.js";

function nowIso(): string {
  return new Date().toISOString();
}

function ensureDir(dir: string) {
  if (fs.existsSync(dir)) return;
  fs.mkdirSync(dir, { recursive: true });
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

function chatResponseJsonSchema(): object {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      reply: { type: "string" },
      actions: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            type: {
              type: "string",
              enum: [
                "project_set_star",
                "project_set_hidden",
                "work_order_create",
                "work_order_update",
                "work_order_set_status",
                "repos_rescan",
                "work_order_start_run",
              ],
            },
            title: { type: "string" },
            payload_json: { type: "string" },
          },
          required: ["type", "title", "payload_json"],
        },
      },
    },
    required: ["reply", "actions"],
  };
}

function summaryJsonSchema(): object {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      summary: { type: "string" },
    },
    required: ["summary"],
  };
}

function codexCommand(cliPath: string | undefined): string {
  return (
    cliPath?.trim() ||
    process.env.CONTROL_CENTER_CODEX_PATH ||
    "codex"
  );
}

type CodexExecParams = {
  cwd: string;
  prompt: string;
  schemaPath: string;
  outputPath: string;
  logPath: string;
  model?: string;
  cliPath?: string;
  skipGitRepoCheck?: boolean;
  onEventJsonLine?: (line: string) => void;
};

async function runCodexExecJson(params: CodexExecParams): Promise<void> {
  const args: string[] = ["--ask-for-approval", "never", "exec", "--json"];
  const model = params.model?.trim();
  if (model) args.push("--model", model);

  args.push(
    "--sandbox",
    "read-only",
    "--output-schema",
    params.schemaPath,
    "--output-last-message",
    params.outputPath,
    "--color",
    "never"
  );

  if (params.skipGitRepoCheck) args.push("--skip-git-repo-check");

  args.push("-");

  ensureDir(path.dirname(params.logPath));
  const logStream = fs.createWriteStream(params.logPath, { flags: "a" });
  logStream.write(`[${nowIso()}] codex exec start (read-only)\n`);

  const child = spawn(codexCommand(params.cliPath), args, {
    cwd: params.cwd,
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env },
  });

  let stdoutBuf = "";
  child.stdout?.on("data", (buf) => {
    const text = buf.toString("utf8");
    logStream.write(text);
    stdoutBuf += text;
    let idx: number;
    while ((idx = stdoutBuf.indexOf("\n")) !== -1) {
      const line = stdoutBuf.slice(0, idx).trimEnd();
      stdoutBuf = stdoutBuf.slice(idx + 1);
      if (line && params.onEventJsonLine) params.onEventJsonLine(line);
    }
  });
  child.stderr?.on("data", (buf) => logStream.write(buf));
  child.stdin?.write(params.prompt);
  child.stdin?.end();

  const exitCode: number = await new Promise((resolve) => {
    child.on("close", (code) => resolve(code ?? 1));
    child.on("error", () => resolve(1));
  });

  const finalLine = stdoutBuf.trimEnd();
  if (finalLine && params.onEventJsonLine) {
    params.onEventJsonLine(finalLine);
  }

  logStream.write(`[${nowIso()}] codex exec end exit=${exitCode}\n`);
  await new Promise<void>((resolve, reject) => {
    logStream.once("error", reject);
    logStream.once("finish", resolve);
    logStream.end();
  });

  if (exitCode !== 0) {
    throw new Error(`codex exec failed (exit ${exitCode})`);
  }
}

function formatMessagesForPrompt(messages: Array<{ role: ChatMessageRole; content: string }>): string {
  return messages
    .map((m) => {
      const role = m.role === "assistant" ? "assistant" : m.role === "user" ? "user" : "system";
      return `${role}:\n${m.content}\n`;
    })
    .join("\n");
}

function buildChatPrompt(params: {
  scope: ChatScope;
  threadId: string;
  projectId?: string;
  workOrderId?: string;
  summary: string;
  messages: Array<{ role: ChatMessageRole; content: string }>;
}): string {
  const scopeLine =
    params.scope === "global"
      ? "Scope: Global"
      : params.scope === "project"
        ? `Scope: Project (${params.projectId})`
        : `Scope: Work Order (${params.projectId} / ${params.workOrderId})`;

  const summaryBlock = params.summary.trim()
    ? `Rolling summary (updated every 50 messages):\n${params.summary.trim()}\n`
    : "Rolling summary: (none yet)\n";

  const actionsDoc = `Allowed action types (propose only; never apply automatically).
For every action, set \`payload_json\` to a JSON string encoding the payload object:
- project_set_star payload_json: {"projectId":"...","starred":true}
- project_set_hidden payload_json: {"projectId":"...","hidden":true}
- work_order_create payload_json: {"projectId":"...","title":"...","priority":3,"tags":["..."]}
- work_order_update payload_json: {"projectId":"...","workOrderId":"...","patch":{"title":"..."}}
- work_order_set_status payload_json: {"projectId":"...","workOrderId":"...","status":"ready"}
- repos_rescan payload_json: {}
- work_order_start_run payload_json: {"projectId":"...","workOrderId":"..."}
`;

  return (
    `You are the in-app Control Center assistant for Project Control Center.\n` +
    `${scopeLine}\n` +
    `\n` +
    `Behavior:\n` +
    `- Act like Codex CLI: discover context by running read-only shell commands.\n` +
    `- Do NOT edit repo files directly. Only propose actions from the allowed set.\n` +
    `- Actions do nothing until the human clicks Apply.\n` +
    `- Prefer small, explicit, reviewable actions.\n` +
    `- Avoid network calls except localhost.\n` +
    `\n` +
    `${actionsDoc}\n` +
    `${summaryBlock}\n` +
    `Recent messages (last 50, verbatim):\n` +
    `${formatMessagesForPrompt(params.messages)}\n` +
    `\n` +
    `Return JSON matching the required schema.\n`
  );
}

function buildSummaryPrompt(params: {
  existingSummary: string;
  messages: Array<{ role: ChatMessageRole; content: string }>;
}): string {
  const prev = params.existingSummary.trim();
  return (
    `You maintain a rolling conversation summary.\n` +
    `\n` +
    `Update the summary using ONLY the new messages below. Keep it concise and factual.\n` +
    `If a previous summary is provided, refine/extend it.\n` +
    `\n` +
    `Previous summary:\n` +
    `${prev ? prev : "(none)"}\n` +
    `\n` +
    `New messages:\n` +
    `${formatMessagesForPrompt(params.messages)}\n` +
    `\n` +
    `Return JSON matching the required schema.\n`
  );
}

function shouldSkipGitRepoCheck(cwd: string): boolean {
  try {
    const stat = fs.statSync(path.join(cwd, ".git"));
    return !(stat.isDirectory() || stat.isFile());
  } catch {
    return true;
  }
}

export function normalizeToolArgs(value: unknown): Record<string, unknown> | null {
  if (!value) return null;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (parsed && typeof parsed === "object") return parsed as Record<string, unknown>;
      if (typeof parsed === "string") return { command: parsed };
    } catch {
      return { command: value };
    }
  }
  if (typeof value === "object") return value as Record<string, unknown>;
  return null;
}

const SHELL_TOOL_NAMES = new Set(["shell_command", "shell", "bash", "sh"]);

function isShellToolName(name: string | null): boolean {
  if (!name) return false;
  const normalized = name.toLowerCase();
  if (SHELL_TOOL_NAMES.has(normalized)) return true;
  return normalized.endsWith(".shell_command");
}

function extractToolName(record: Record<string, unknown>): string | null {
  if (typeof record.tool_name === "string") return record.tool_name;
  if (typeof record.toolName === "string") return record.toolName;
  if (typeof record.name === "string") return record.name;
  if (typeof record.tool === "string") return record.tool;

  const tool = record.tool;
  if (tool && typeof tool === "object") {
    const toolRecord = tool as Record<string, unknown>;
    if (typeof toolRecord.name === "string") return toolRecord.name;
    if (typeof toolRecord.tool_name === "string") return toolRecord.tool_name;
    if (typeof toolRecord.toolName === "string") return toolRecord.toolName;
    if (typeof toolRecord.tool === "string") return toolRecord.tool;
  }

  return null;
}

function extractToolArgs(record: Record<string, unknown>): Record<string, unknown> | null {
  const direct =
    record.arguments ??
    record.args ??
    record.input ??
    record.tool_input ??
    record.tool_arguments ??
    record.parameters ??
    record.params ??
    null;
  const normalized = normalizeToolArgs(direct);
  if (normalized) return normalized;

  const tool = record.tool;
  if (tool && typeof tool === "object") {
    const toolRecord = tool as Record<string, unknown>;
    return normalizeToolArgs(
      toolRecord.arguments ??
        toolRecord.args ??
        toolRecord.input ??
        toolRecord.tool_input ??
        toolRecord.tool_arguments ??
        toolRecord.parameters ??
        toolRecord.params ??
        null
    );
  }

  return null;
}

export function parseShellCommandsFromEvent(event: unknown): Array<{ cwd?: string; command: string }> {
  const results: Array<{ cwd?: string; command: string }> = [];
  const seen = new Set<string>();

  const visit = (value: unknown) => {
    if (!value || typeof value !== "object") return;

    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }

    const record = value as Record<string, unknown>;

    if (
      typeof record.type === "string" &&
      record.type === "command_execution" &&
      typeof record.command === "string" &&
      (record.exit_code === null ||
        record.exit_code === undefined ||
        (typeof record.status === "string" &&
          record.status.toLowerCase() === "in_progress"))
    ) {
      const command = record.command;
      const cwd =
        typeof record.cwd === "string"
          ? record.cwd
          : typeof record.workdir === "string"
            ? record.workdir
            : typeof record.directory === "string"
              ? record.directory
              : typeof record.dir === "string"
                ? record.dir
                : null;
      const id = typeof record.id === "string" ? record.id : "";
      const key = `${id}\0${cwd ?? ""}\0${command}\0command_execution`;
      if (!seen.has(key)) {
        seen.add(key);
        results.push(cwd ? { cwd, command } : { command });
      }
    }

    const toolName = extractToolName(record);
    const args = extractToolArgs(record);

    const command =
      args && typeof args.command === "string"
        ? args.command
        : args && typeof args.cmd === "string"
          ? args.cmd
          : typeof record.command === "string"
            ? record.command
              : typeof record.cmd === "string"
                ? record.cmd
                : null;

    const cwd =
      args && typeof args.workdir === "string"
        ? args.workdir
        : args && typeof args.cwd === "string"
          ? args.cwd
          : args && typeof args.directory === "string"
            ? args.directory
            : args && typeof args.dir === "string"
              ? args.dir
              : typeof record.workdir === "string"
                ? record.workdir
                : typeof record.cwd === "string"
                  ? record.cwd
                  : typeof record.directory === "string"
                    ? record.directory
                    : typeof record.dir === "string"
                      ? record.dir
                      : null;

    const looksLikeShellTool = isShellToolName(toolName);

    if (command && looksLikeShellTool) {
      const key = `${cwd ?? ""}\0${command}`;
      if (!seen.has(key)) {
        seen.add(key);
        results.push(cwd ? { cwd, command } : { command });
      }
    }

    for (const v of Object.values(record)) visit(v);
  };

  visit(event);
  return results;
}

export function parseCommandsFromLog(logPath: string): Array<{ cwd?: string; command: string }> {
  let raw = "";
  try {
    raw = fs.readFileSync(logPath, "utf8");
  } catch {
    return [];
  }

  const results: Array<{ cwd?: string; command: string }> = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || (trimmed[0] !== "{" && trimmed[0] !== "[")) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      continue;
    }
    results.push(...parseShellCommandsFromEvent(parsed));
  }
  return results;
}

type ChatScopeParams =
  | { scope: "global" }
  | { scope: "project"; projectId: string }
  | { scope: "work_order"; projectId: string; workOrderId: string };

function loadWorkOrder(repoPath: string, workOrderId: string): WorkOrder {
  const all = listWorkOrders(repoPath);
  const found = all.find((w) => w.id === workOrderId);
  if (!found) throw new Error("Work Order not found");
  return found;
}

function resolveChatWorkspace(params: ChatScopeParams): { cwd: string; skipGitRepoCheck: boolean } {
  if (params.scope === "global") {
    const cwd = ensurePortfolioWorkspace();
    return { cwd, skipGitRepoCheck: true };
  }

  const project = findProjectById(params.projectId);
  if (!project) throw new Error("project not found");
  const cwd = project.path;
  return { cwd, skipGitRepoCheck: shouldSkipGitRepoCheck(cwd) };
}

export type ChatRunDetails = ChatRunRow & {
  log_tail: string;
  commands: ChatRunCommandRow[];
};

export function getChatRunDetails(runId: string): ChatRunDetails | null {
  const run = getChatRunById(runId);
  if (!run) return null;
  return {
    ...run,
    log_tail: tailFile(run.log_path),
    commands: listChatRunCommands(runId),
  };
}

export type ChatThreadDetails = {
  thread: ChatThreadRow;
  messages: Array<
    ChatMessageRow & {
      run: ChatRunRow | null;
      run_duration_ms: number | null;
      actions: ChatAction[] | null;
    }
  >;
};

export function getChatThreadDetails(params: ChatScopeParams): ChatThreadDetails {
  const thread = ensureChatThread(params);
  const messages = listChatMessages({ threadId: thread.id, limit: 200, order: "asc" });
  const runs = listChatRunsForThread(thread.id, 200);
  const runById = new Map(runs.map((r) => [r.id, r]));
  const runByMessageId = new Map<string, ChatRunRow>();
  for (const run of runs) {
    runByMessageId.set(run.user_message_id, run);
    if (run.assistant_message_id) {
      runByMessageId.set(run.assistant_message_id, run);
    }
  }

  const enriched = messages.map((m) => {
    const run =
      runByMessageId.get(m.id) ??
      (m.run_id ? runById.get(m.run_id) ?? null : null);
    const startedMs = run?.started_at ? Date.parse(run.started_at) : NaN;
    const finishedMs = run?.finished_at ? Date.parse(run.finished_at) : NaN;
    const durationMs =
      Number.isFinite(startedMs) && Number.isFinite(finishedMs)
        ? Math.max(0, finishedMs - startedMs)
        : null;

    const actions = (() => {
      if (!m.actions_json) return null;
      try {
        const parsed = JSON.parse(m.actions_json);
        const arr = Array.isArray(parsed) ? parsed : null;
        if (!arr) return null;
        const out: ChatAction[] = [];
        for (const item of arr) {
          const a = ChatActionSchema.safeParse(item);
          if (!a.success) return null;
          out.push(a.data);
        }
        return out;
      } catch {
        return null;
      }
    })();

    return {
      ...m,
      run,
      run_duration_ms: durationMs,
      actions,
    };
  });

  return { thread, messages: enriched };
}

export function enqueueChatTurn(params: ChatScopeParams & { content: string }): ChatRunRow {
  const thread = ensureChatThread(params);
  const content = params.content.trim();
  if (!content) throw new Error("message is empty");

  if (params.scope !== "global") {
    const project = findProjectById(params.projectId);
    if (!project) throw new Error("project not found");
    if (params.scope === "work_order") {
      loadWorkOrder(project.path, params.workOrderId);
    }
  }

  const userMessage = createChatMessage({
    threadId: thread.id,
    role: "user",
    content,
  });

  const settings = resolveChatSettings().effective;
  if (settings.provider !== "codex") {
    throw new Error("Only the Codex provider is supported for chat in v0; update Chat Settings to use Codex.");
  }

  const runId = crypto.randomUUID();
  const runDir = path.join(process.cwd(), ".system", "chat", "runs", runId);
  const logPath = path.join(runDir, "codex.jsonl");
  ensureDir(runDir);

  const { cwd } = resolveChatWorkspace(params);

  const run = createChatRun({
    id: runId,
    threadId: thread.id,
    userMessageId: userMessage.id,
    model: settings.model,
    cliPath: settings.cliPath,
    cwd,
    logPath,
  });

  spawnChatWorker(run.id);
  return run;
}

function shouldPreferTsWorker(): boolean {
  if (process.env.CONTROL_CENTER_USE_TS_WORKER === "1") return true;
  const entry = process.argv[1] || "";
  if (entry.endsWith(".ts")) return true;
  return process.execArgv.some((arg) => arg.includes("tsx"));
}

function spawnChatWorker(runId: string) {
  const repoRoot = process.cwd();
  const distWorkerPath = path.join(repoRoot, "server", "dist", "chat_worker.js");
  const tsWorkerPath = path.join(repoRoot, "server", "chat_worker.ts");

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

function claimRunOrExit(run: ChatRunRow): boolean {
  const db = getDb();
  const startedAt = nowIso();
  const result = db
    .prepare(
      `UPDATE chat_runs
       SET status = 'running',
           started_at = ?,
           error = NULL
       WHERE id = ?
         AND status = 'queued'
         AND NOT EXISTS (
           SELECT 1 FROM chat_runs WHERE thread_id = ? AND status = 'running'
         )
         AND id = (
           SELECT id FROM chat_runs
           WHERE thread_id = ? AND status = 'queued'
           ORDER BY created_at ASC
           LIMIT 1
         )`
    )
    .run(startedAt, run.id, run.thread_id, run.thread_id);
  return result.changes > 0;
}

function nextQueuedRunId(threadId: string): string | null {
  const db = getDb();
  const row = db
    .prepare(
      "SELECT id FROM chat_runs WHERE thread_id = ? AND status = 'queued' ORDER BY created_at ASC LIMIT 1"
    )
    .get(threadId) as { id: string } | undefined;
  return row?.id ?? null;
}

function ensureSchemas(): { chatSchemaPath: string; summarySchemaPath: string } {
  const baseDir = path.join(process.cwd(), ".system", "chat");
  ensureDir(baseDir);
  const chatSchemaPath = path.join(baseDir, "chat_response.schema.json");
  const summarySchemaPath = path.join(baseDir, "chat_summary.schema.json");
  fs.writeFileSync(chatSchemaPath, `${JSON.stringify(chatResponseJsonSchema(), null, 2)}\n`, "utf8");
  fs.writeFileSync(summarySchemaPath, `${JSON.stringify(summaryJsonSchema(), null, 2)}\n`, "utf8");
  return { chatSchemaPath, summarySchemaPath };
}

async function maybeUpdateRollingSummary(params: {
  thread: ChatThreadRow;
  model: string;
  cliPath: string;
}): Promise<void> {
  const totalMessages = countChatMessages(params.thread.id);
  const target = Math.floor(totalMessages / 50) * 50;
  if (target <= params.thread.summarized_count) return;

  const { summarySchemaPath } = ensureSchemas();

  let summary = params.thread.summary ?? "";
  let summarized = params.thread.summarized_count;

  while (summarized + 50 <= target) {
    const chunk = listChatMessages({
      threadId: params.thread.id,
      order: "asc",
      limit: 50,
      offset: summarized,
    }).map((m) => ({ role: m.role, content: m.content }));

    const runId = crypto.randomUUID();
    const runDir = path.join(process.cwd(), ".system", "chat", "summaries", runId);
    ensureDir(runDir);
    const outputPath = path.join(runDir, "summary.json");
    const logPath = path.join(runDir, "codex.jsonl");

    const prompt = buildSummaryPrompt({ existingSummary: summary, messages: chunk });
    await runCodexExecJson({
      cwd: runDir,
      prompt,
      schemaPath: summarySchemaPath,
      outputPath,
      logPath,
      model: params.model,
      cliPath: params.cliPath,
      skipGitRepoCheck: true,
    });

    const parsed = ChatSummaryResponseSchema.safeParse(
      JSON.parse(fs.readFileSync(outputPath, "utf8"))
    );
    if (!parsed.success) {
      throw new Error("summary did not match schema");
    }

    summary = parsed.data.summary;
    summarized += 50;
    updateChatThreadSummary({
      threadId: params.thread.id,
      summary,
      summarizedCount: summarized,
    });
  }
}

export async function runChatRun(runId: string): Promise<void> {
  const run = getChatRunById(runId);
  if (!run) return;

  if (run.status !== "queued") return;
  if (!claimRunOrExit(run)) return;

  const startedAt = nowIso();
  updateChatRun(runId, { started_at: startedAt });

  const thread = getChatThreadById(run.thread_id);
  if (!thread) {
    updateChatRun(runId, {
      status: "failed",
      error: "thread not found",
      finished_at: nowIso(),
    });
    return;
  }

  const settings = resolveChatSettings().effective;
  try {
    await maybeUpdateRollingSummary({ thread, model: settings.model, cliPath: settings.cliPath });
  } catch {
    // best-effort; keep going
  }

  const refreshedThread = getChatThreadById(run.thread_id) ?? thread;
  const lastMessages = listChatMessages({
    threadId: run.thread_id,
    order: "desc",
    limit: 50,
  })
    .slice()
    .reverse()
    .map((m) => ({ role: m.role, content: m.content }));

  const { chatSchemaPath } = ensureSchemas();
  const outputPath = path.join(path.dirname(run.log_path), "result.json");

  let commandSeq = 0;
  const insertCommand = (cwd: string | undefined, command: string) => {
    const resolvedCwd = cwd ?? run.cwd;
    commandSeq += 1;
    insertChatRunCommand({
      runId,
      seq: commandSeq,
      cwd: resolvedCwd,
      command,
    });
  };

  let commandsRebuilt = false;
  const rebuildCommandsFromLog = () => {
    const parsed = parseCommandsFromLog(run.log_path);
    if (!parsed.length) return false;

    const normalized = parsed.map((cmd) => ({
      cwd: cmd.cwd ?? run.cwd,
      command: cmd.command,
    }));

    if (normalized.length < commandSeq) return false;
    replaceChatRunCommands({ runId, commands: normalized });
    commandSeq = normalized.length;
    commandsRebuilt = true;
    return true;
  };

  const { skipGitRepoCheck } = (() => ({
    skipGitRepoCheck: shouldSkipGitRepoCheck(run.cwd),
  }))();

  const prompt = buildChatPrompt({
    scope: refreshedThread.scope,
    threadId: refreshedThread.id,
    projectId: refreshedThread.project_id ?? undefined,
    workOrderId: refreshedThread.work_order_id ?? undefined,
    summary: refreshedThread.summary ?? "",
    messages: lastMessages,
  });

  try {
    await runCodexExecJson({
      cwd: run.cwd,
      prompt,
      schemaPath: chatSchemaPath,
      outputPath,
      logPath: run.log_path,
      model: run.model,
      cliPath: run.cli_path,
      skipGitRepoCheck: skipGitRepoCheck || shouldSkipGitRepoCheck(run.cwd),
      onEventJsonLine: (line) => {
        let parsed: unknown;
        try {
          parsed = JSON.parse(line);
        } catch {
          return;
        }
        for (const cmd of parseShellCommandsFromEvent(parsed)) {
          insertCommand(cmd.cwd, cmd.command);
        }
      },
    });
    rebuildCommandsFromLog();

    const raw = fs.readFileSync(outputPath, "utf8");
    const json = JSON.parse(raw) as unknown;
    const parsedWire = ChatResponseWireSchema.safeParse(json);
    if (!parsedWire.success) {
      throw new Error("assistant response did not match schema");
    }

    const actions: ChatAction[] = [];
    for (const action of parsedWire.data.actions) {
      let payload: unknown;
      try {
        payload = JSON.parse(action.payload_json);
      } catch {
        throw new Error(`invalid payload_json for action ${action.type}`);
      }
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
        throw new Error(`payload_json for action ${action.type} must encode an object`);
      }

      const validated = ChatActionSchema.safeParse({
        type: action.type,
        title: action.title,
        payload,
      });
      if (!validated.success) {
        throw new Error(`assistant action ${action.type} did not match schema`);
      }
      actions.push(validated.data);
    }

    const assistantMessage = createChatMessage({
      threadId: run.thread_id,
      role: "assistant",
      content: parsedWire.data.reply,
      actions,
      runId,
    });

    updateChatRun(runId, {
      assistant_message_id: assistantMessage.id,
      status: "done",
      finished_at: nowIso(),
      error: null,
    });
  } catch (err) {
    if (!commandsRebuilt) {
      try {
        rebuildCommandsFromLog();
      } catch {
        // keep original error
      }
    }
    const message = err instanceof Error ? err.message : String(err);
    const assistantMessage = createChatMessage({
      threadId: run.thread_id,
      role: "assistant",
      content: `Chat run failed: ${message}`,
      actions: [],
      runId,
    });
    updateChatRun(runId, {
      assistant_message_id: assistantMessage.id,
      status: "failed",
      error: message,
      finished_at: nowIso(),
    });
  } finally {
    const nextId = nextQueuedRunId(run.thread_id);
    if (nextId) {
      try {
        spawnChatWorker(nextId);
      } catch {
        // ignore
      }
    }
  }
}
