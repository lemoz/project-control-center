import { spawn } from "child_process";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import {
  getChatSuggestionContextMessageLimit,
  getCodexCliPath,
  getProcessEnv,
  getUseTsWorker,
} from "./config.js";
import { findProjectById, getDb } from "./db.js";
import { parseCodexTokenUsageFromLog, recordCostEntry } from "./cost_tracking.js";
import {
  countChatMessages,
  createChatMessage,
  createChatPendingSend,
  createChatRun,
  ensureChatThread,
  getChatMessageById,
  getChatRunById,
  getChatThreadById,
  insertChatRunCommand,
  listChatMessages,
  listChatPendingSends,
  type ChatMessageRow,
  listChatRunCommands,
  listChatRunsForThread,
  listWorkOrderRunsForThread,
  markChatPendingSendResolved,
  replaceChatRunCommands,
  updateChatRun,
  updateChatThread,
  updateChatThreadSummary,
  type ChatMessageRole,
  type ChatRunCommandRow,
  type ChatRunRow,
  type ChatScope,
  type ChatThreadRow,
} from "./chat_db.js";
import { emitChatRunStatusEvent } from "./chat_events.js";
import {
  ChatActionSchema,
  ChatAccessSchema,
  ChatContextSelectionSchema,
  ChatResponseWireSchema,
  ChatSuggestionSchema,
  ChatSummaryResponseSchema,
  type ChatAction,
  type ChatAccess,
  type ChatContextSelection,
  type ChatSuggestion,
  type ChatConfirmations,
} from "./chat_contract.js";
import { listWorkOrders, type WorkOrder } from "./work_orders.js";
import { resolveChatSettings } from "./settings.js";
import { ensurePortfolioWorkspace } from "./portfolio_workspace.js";
import { ensureChatWorktree, readWorktreeStatus } from "./chat_worktree.js";
import {
  formatConstitutionBlock,
  getConstitutionForProject,
  selectRelevantConstitutionSections,
  type ConstitutionSelection,
} from "./constitution.js";

function nowIso(): string {
  return new Date().toISOString();
}

function recordChatCost(params: {
  projectId: string;
  runId: string;
  model: string;
  logPath: string;
  description?: string;
}): void {
  const model = params.model.trim() || "gpt-5.2-codex";
  const usage = parseCodexTokenUsageFromLog(params.logPath);
  recordCostEntry({
    projectId: params.projectId,
    runId: null,
    category: "chat",
    model,
    usage,
    description: params.description ?? `chat run ${params.runId}`,
  });
}

export class PendingSendError extends Error {
  pendingSendId: string;
  requires: { write: boolean; network_allowlist: boolean };

  constructor(
    message: string,
    pendingSendId: string,
    requires: { write: boolean; network_allowlist: boolean }
  ) {
    super(message);
    this.pendingSendId = pendingSendId;
    this.requires = requires;
  }
}

const DEFAULT_CONTEXT: ChatContextSelection = { depth: "blended" };
const DEFAULT_ACCESS: ChatAccess = {
  filesystem: "read-only",
  cli: "off",
  network: "none",
};

function suggestionContextMessageLimit(): number {
  return getChatSuggestionContextMessageLimit();
}

function normalizeChatContextSelection(input?: ChatContextSelection | null): ChatContextSelection {
  if (!input) return DEFAULT_CONTEXT;
  return ChatContextSelectionSchema.parse(input);
}

function normalizeChatAccess(input?: ChatAccess | null): ChatAccess {
  const merged = {
    ...DEFAULT_ACCESS,
    ...(input ?? {}),
  };
  const allowlistRaw = Array.isArray(merged.network_allowlist)
    ? merged.network_allowlist
    : [];
  const allowlist = allowlistRaw
    .map((entry) => String(entry).trim())
    .filter(Boolean);
  const network_allowlist =
    merged.network === "allowlist" && allowlist.length ? allowlist : undefined;
  return ChatAccessSchema.parse({
    filesystem: merged.filesystem,
    cli: merged.cli,
    network: merged.network,
    network_allowlist,
  });
}

function allowlistJson(access: ChatAccess): string | null {
  const allowlist = access.network_allowlist ?? [];
  return allowlist.length ? JSON.stringify(allowlist) : null;
}

function resolveMatchingPendingSends(params: {
  threadId: string;
  content: string;
  contextDepth: ChatContextSelection["depth"];
  access: ChatAccess;
}): void {
  const pending = listChatPendingSends({ threadId: params.threadId, limit: null });
  if (!pending.length) return;
  const allowlist = allowlistJson(params.access);
  for (const item of pending) {
    if (item.content !== params.content) continue;
    if (item.context_depth !== params.contextDepth) continue;
    if (item.access_filesystem !== params.access.filesystem) continue;
    if (item.access_cli !== params.access.cli) continue;
    if (item.access_network !== params.access.network) continue;
    if ((item.access_network_allowlist ?? null) !== allowlist) continue;
    markChatPendingSendResolved(item.id);
  }
}

function parseJsonStringArray(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((entry) => String(entry));
  } catch {
    return [];
  }
}

function threadDefaultAccess(thread: ChatThreadRow): ChatAccess {
  return normalizeChatAccess({
    filesystem: thread.default_access_filesystem,
    cli: thread.default_access_cli,
    network: thread.default_access_network,
    network_allowlist: parseJsonStringArray(thread.default_access_network_allowlist),
  });
}

function sanitizeSuggestionAccess(params: {
  base: ChatAccess;
  suggestion: ChatSuggestion;
}): { accessDelta: Partial<ChatAccess> | null; reasonSuffix: string | null } {
  const merged: ChatAccess = normalizeChatAccess({
    ...params.base,
    ...(params.suggestion.access ?? {}),
  });

  let coerced = merged;
  let reasonSuffix: string | null = null;

  if (coerced.filesystem === "none" && coerced.cli !== "off") {
    coerced = { ...coerced, cli: "off" };
    reasonSuffix = (reasonSuffix ?? "") + " Adjusted: filesystem none requires CLI off.";
  }

  if (coerced.cli === "read-write" && coerced.filesystem !== "read-write") {
    coerced = { ...coerced, filesystem: "read-write" };
    reasonSuffix = (reasonSuffix ?? "") + " Adjusted: CLI read-write requires filesystem read-write.";
  }

  if (coerced.filesystem === "read-write" && coerced.cli === "read-only") {
    coerced = { ...coerced, cli: "read-write" };
    reasonSuffix =
      (reasonSuffix ?? "") +
      " Adjusted: filesystem read-write implies a write-capable sandbox, so CLI read-only is not enforceable.";
  }

  const delta: Partial<ChatAccess> = {};
  if (coerced.filesystem !== params.base.filesystem) delta.filesystem = coerced.filesystem;
  if (coerced.cli !== params.base.cli) delta.cli = coerced.cli;
  if (coerced.network !== params.base.network) delta.network = coerced.network;
  if (coerced.network === "allowlist") {
    const nextAllowlist = coerced.network_allowlist ?? [];
    const baseAllowlist = params.base.network_allowlist ?? [];
    const same =
      nextAllowlist.length === baseAllowlist.length &&
      nextAllowlist.every((value, idx) => value === baseAllowlist[idx]);
    if (!same) delta.network_allowlist = nextAllowlist;
  }

  return {
    accessDelta: Object.keys(delta).length ? delta : null,
    reasonSuffix: reasonSuffix ? reasonSuffix.trim() : null,
  };
}

function requiresWriteConfirmation(access: ChatAccess): boolean {
  return access.filesystem === "read-write" || access.cli === "read-write";
}

function requiresNetworkConfirmation(access: ChatAccess): boolean {
  return access.network === "allowlist" || access.network === "trusted";
}

function validateChatAccess(
  access: ChatAccess,
  trustedHosts: string[]
): { sandbox: "read-only" | "workspace-write"; cliOff: boolean } {
  if (access.filesystem === "none" && access.cli !== "off") {
    throw new Error("Filesystem access 'none' requires CLI access to be off.");
  }
  if (access.cli === "read-write" && access.filesystem !== "read-write") {
    throw new Error("CLI read-write requires filesystem read-write.");
  }
  if (access.cli === "read-only" && access.filesystem === "read-write") {
    throw new Error("CLI read-only is incompatible with filesystem read-write.");
  }
  if (access.network === "allowlist" && (!access.network_allowlist || !access.network_allowlist.length)) {
    throw new Error("Network allowlist requires at least one entry.");
  }
  if (access.network === "trusted") {
    const normalized = buildHostSetFromList(trustedHosts);
    if (!normalized.size) {
      throw new Error("Trusted host pack is empty. Update Chat Settings to add hosts.");
    }
  }
  const sandbox =
    access.filesystem === "read-write" || access.cli === "read-write"
      ? "workspace-write"
      : "read-only";
  return { sandbox, cliOff: access.cli === "off" };
}

function ensureDir(dir: string) {
  if (fs.existsSync(dir)) return;
  fs.mkdirSync(dir, { recursive: true });
}

function appendLogLine(filePath: string, line: string) {
  try {
    ensureDir(path.dirname(filePath));
    fs.appendFileSync(filePath, `[${nowIso()}] ${line}\n`, "utf8");
  } catch {
    // ignore log failures
  }
}

function logConstitutionSelection(
  logPath: string,
  context: string,
  selection: ConstitutionSelection
) {
  if (!selection.content.trim()) {
    appendLogLine(logPath, `[constitution] ${context}: none found, proceeding without`);
    return;
  }
  const sections = selection.sectionTitles.length
    ? selection.sectionTitles.join(", ")
    : "(none)";
  const strategy = selection.usedSelection ? "selected" : "full";
  const truncated = selection.truncated ? " truncated" : "";
  appendLogLine(
    logPath,
    `[constitution] ${context}: injecting ${selection.content.length} chars (${strategy}${truncated}); sections: ${sections}`
  );
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

function lastInterestingLogLine(tail: string): string {
  const lines = tail.split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i]?.trim();
    if (!line) continue;
    if (line.includes("codex exec end exit=") || line.includes("codex exec start")) continue;
    return line;
  }
  return "";
}

function truncateForPrompt(text: string, maxChars = 140): string {
  const single = text.replace(/\s+/g, " ").trim();
  if (single.length <= maxChars) return single;
  return `${single.slice(0, Math.max(0, maxChars - 1))}…`;
}

function unwrapShellCommand(command: string): string {
  const trimmed = command.trim();
  const match = trimmed.match(/^(?:\/bin\/)?(?:zsh|bash|sh)\s+-lc\s+([\s\S]+)$/);
  if (!match) return trimmed;

  let inner = match[1]?.trim() ?? "";
  if (!inner) return trimmed;

  const quote = inner[0];
  if ((quote === "'" || quote === '"') && inner.endsWith(quote)) {
    inner = inner.slice(1, -1);
    if (quote === '"') inner = inner.replaceAll('\\"', '"');
    if (quote === "'") inner = inner.replaceAll("\\'", "'");
  }

  return inner.trim() || trimmed;
}

function formatCodexLogTailSummary(tail: string): string {
  const raw = lastInterestingLogLine(tail);
  if (!raw) return "";

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return truncateForPrompt(raw);
    const record = parsed as Record<string, unknown>;
    const type = typeof record.type === "string" ? record.type : null;
    if (!type) return truncateForPrompt(raw);

    if (type === "error") {
      const message = typeof record.message === "string" ? record.message : "";
      return truncateForPrompt(message ? `Error: ${message}` : "Error");
    }

    if (type === "turn.failed") {
      const err = record.error;
      if (err && typeof err === "object") {
        const errRecord = err as Record<string, unknown>;
        const message = typeof errRecord.message === "string" ? errRecord.message : "";
        return truncateForPrompt(message ? `Failed: ${message}` : "Failed");
      }
      return "Failed";
    }

    if (type === "turn.started") return "Starting…";
    if (type === "turn.completed") return "Turn completed";

    if (type.startsWith("item.")) {
      const item = record.item;
      if (!item || typeof item !== "object") return truncateForPrompt(type.replaceAll(".", " "));

      const itemRecord = item as Record<string, unknown>;
      const itemType = typeof itemRecord.type === "string" ? itemRecord.type : null;

      if (itemType === "command_execution") {
        const commandRaw = typeof itemRecord.command === "string" ? itemRecord.command : "";
        const command = commandRaw ? unwrapShellCommand(commandRaw) : "";
        const verb = type === "item.started" ? "Running" : "Ran";
        return truncateForPrompt(command ? `${verb}: ${command}` : `${verb} command`);
      }

      const label = itemType ? `${type.replaceAll(".", " ")} (${itemType})` : type.replaceAll(".", " ");
      return truncateForPrompt(label);
    }

    return truncateForPrompt(type.replaceAll(".", " "));
  } catch {
    return truncateForPrompt(raw);
  }
}

function truncateForError(text: string, maxChars = 900): string {
  const trimmed = text.trim();
  if (trimmed.length <= maxChars) return trimmed;
  return `${trimmed.slice(0, Math.max(0, maxChars - 1))}…`;
}

function extractCodexErrorMessage(logPath: string): string | null {
  const tail = tailFile(logPath);
  if (!tail.trim()) return null;

  const lines = tail.split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const raw = lines[i]?.trim();
    if (!raw) continue;
    if (raw.includes("codex exec end exit=") || raw.includes("codex exec start")) continue;

    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!parsed || typeof parsed !== "object") continue;
      const record = parsed as Record<string, unknown>;
      const type = typeof record.type === "string" ? record.type : null;

      if (type === "error" && typeof record.message === "string") {
        return truncateForError(record.message);
      }
      if (type === "turn.failed") {
        const err = record.error;
        if (err && typeof err === "object") {
          const errRecord = err as Record<string, unknown>;
          if (typeof errRecord.message === "string") return truncateForError(errRecord.message);
        }
      }
    } catch {
      if (raw.includes(" ERROR ") || raw.startsWith("ERROR ")) return truncateForError(raw);
    }
  }

  return null;
}

function chatResponseJsonSchema(): object {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      reply: { type: "string" },
      needs_user_input: { type: "boolean" },
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
              "project_set_success",
              "work_order_create",
              "work_order_update",
              "work_order_set_status",
              "repos_rescan",
                "work_order_start_run",
                "worktree_merge",
              ],
            },
            title: { type: "string" },
            payload_json: { type: "string" },
          },
          required: ["type", "title", "payload_json"],
        },
      },
    },
    required: ["reply", "needs_user_input", "actions"],
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

function suggestionJsonSchema(): object {
  return {
    type: "object",
    additionalProperties: false,
    required: ["context_depth", "access", "reason"],
    properties: {
      context_depth: {
        type: "string",
        enum: ["minimal", "messages", "messages_tools", "messages_tools_outputs"],
      },
      access: {
        type: "object",
        additionalProperties: false,
        required: ["filesystem", "cli", "network", "network_allowlist"],
        properties: {
          filesystem: { type: "string", enum: ["none", "read-only", "read-write"] },
          cli: { type: "string", enum: ["off", "read-only", "read-write"] },
          network: { type: "string", enum: ["none", "localhost", "allowlist", "trusted"] },
          network_allowlist: { type: "array", items: { type: "string" } },
        },
      },
      reason: { type: "string" },
    },
  };
}

function codexCommand(cliPath: string | undefined): string {
  return cliPath?.trim() || getCodexCliPath();
}

type CodexExecParams = {
  cwd: string;
  prompt: string;
  schemaPath: string;
  outputPath: string;
  logPath: string;
  sandbox: "read-only" | "workspace-write";
  model?: string;
  cliPath?: string;
  skipGitRepoCheck?: boolean;
  networkEnabled?: boolean;
  onEventJsonLine?: (line: string, control: { abort: (reason: string) => void }) => void;
};

async function runCodexExecJson(params: CodexExecParams): Promise<void> {
  const args: string[] = ["--ask-for-approval", "never", "exec", "--json"];
  const model = params.model?.trim();
  if (model) args.push("--model", model);

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

  // Enable network access in sandbox when user has granted network permissions
  if (params.networkEnabled) {
    args.push("-c", "sandbox_workspace_write.network_access=true");
  }

  args.push("-");

  ensureDir(path.dirname(params.logPath));
  const logStream = fs.createWriteStream(params.logPath, { flags: "a" });
  logStream.write(`[${nowIso()}] codex exec start (${params.sandbox})\n`);

  const child = spawn(codexCommand(params.cliPath), args, {
    cwd: params.cwd,
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...getProcessEnv() },
  });

  let abortReason: string | null = null;
  const abort = (reason: string) => {
    if (abortReason) return;
    abortReason = reason;
    child.kill();
  };
  const control = { abort };

  let stdoutBuf = "";
  child.stdout?.on("data", (buf) => {
    const text = buf.toString("utf8");
    logStream.write(text);
    stdoutBuf += text;
    let idx: number;
    while ((idx = stdoutBuf.indexOf("\n")) !== -1) {
      const line = stdoutBuf.slice(0, idx).trimEnd();
      stdoutBuf = stdoutBuf.slice(idx + 1);
      if (line && params.onEventJsonLine) params.onEventJsonLine(line, control);
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
    params.onEventJsonLine(finalLine, control);
  }

  logStream.write(`[${nowIso()}] codex exec end exit=${exitCode}\n`);
  await new Promise<void>((resolve, reject) => {
    logStream.once("error", reject);
    logStream.once("finish", resolve);
    logStream.end();
  });

  if (abortReason) {
    throw new Error(abortReason);
  }
  if (exitCode !== 0) {
    const detail = extractCodexErrorMessage(params.logPath);
    throw new Error(
      detail
        ? `codex exec failed (exit ${exitCode}): ${detail}`
        : `codex exec failed (exit ${exitCode})`
    );
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

function formatSuggestionRecentContext(params: {
  threadId: string;
  limit: number;
}): string {
  const limit = Math.max(0, Math.trunc(params.limit));
  if (!limit) return "(disabled)";

  const messages = listChatMessages({
    threadId: params.threadId,
    order: "desc",
    limit,
  })
    .slice()
    .reverse();

  if (!messages.length) return "(none yet)";

  const indent = (text: string, prefix = "  "): string => {
    const lines = text.split(/\r?\n/);
    return lines.map((line) => `${prefix}${line}`).join("\n");
  };

  const runs = listChatRunsForThread(params.threadId, 200);
  const runById = new Map(runs.map((r) => [r.id, r]));
  const runByUserMessageId = new Map(runs.map((r) => [r.user_message_id, r]));
  const runByAssistantMessageId = new Map<string, ChatRunRow>();
  for (const run of runs) {
    if (run.assistant_message_id) {
      runByAssistantMessageId.set(run.assistant_message_id, run);
    }
  }

  const lines: string[] = [];
  messages.forEach((m, idx) => {
    const role = m.role;
    const content = m.content.trim();
    lines.push(`${idx + 1}) ${role}:`);
    lines.push(indent(content || "(empty)"));

    const run =
      (m.run_id ? runById.get(m.run_id) : null) ??
      runByUserMessageId.get(m.id) ??
      runByAssistantMessageId.get(m.id) ??
      null;
    if (!run) return;

    const runMeta = [
      `run=${run.status}`,
      run.error ? `error=${truncateForPrompt(run.error, 220)}` : null,
    ]
      .filter(Boolean)
      .join(" ");
    lines.push(indent(runMeta, "   "));

    const commands = listChatRunCommands(run.id);
    if (commands.length) {
      const tailCommands = commands.slice(Math.max(0, commands.length - 5));
      lines.push(`   commands (${tailCommands.length}/${commands.length}):`);
      for (const cmd of tailCommands) {
        lines.push(`   - ${cmd.cwd}: ${unwrapShellCommand(cmd.command)}`);
      }
    }

    const logTail = tailFile(run.log_path, 8_000);
    const logSummary = logTail ? formatCodexLogTailSummary(logTail) : "";
    if (logSummary) {
      lines.push(`   log: ${logSummary}`);
    }
  });

  return lines.join("\n");
}

function formatNetworkAccess(access: ChatAccess, trustedHosts: string[]): string {
  if (access.network === "allowlist") {
    return access.network_allowlist?.length
      ? `allowlist (${access.network_allowlist.join(", ")})`
      : "allowlist";
  }
  if (access.network === "trusted") {
    return trustedHosts.length ? `trusted (${trustedHosts.join(", ")})` : "trusted";
  }
  return access.network;
}

function buildChatPrompt(params: {
  scope: ChatScope;
  threadId: string;
  projectId?: string;
  workOrderId?: string;
  summary: string;
  messages: Array<{ role: ChatMessageRole; content: string }>;
  contextDepth: ChatContextSelection["depth"];
  access: ChatAccess;
  trustedHosts: string[];
  commandAudit?: string;
  outputTail?: string;
  blendedContext?: string;
  workOrderRunContext?: string;
  constitution?: string;
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
- project_set_success payload_json: {"projectId":"...","success_criteria":"...","success_metrics":[{"name":"...","target":10,"current":2}]}
  success_criteria: markdown text describing the project's north star (optional but recommended)
  success_metrics: list of measurable KPIs with name + target (optional), include current when known
- work_order_create payload_json: {"projectId":"...","title":"...","priority":3,"tags":["..."],"depends_on":["WO-XXXX"],"era":"v1"}
  depends_on: array of work order IDs that must be completed first (optional)
  era: phase/group label like "foundation", "v1", "chat-v2", "autonomous" (optional)
- work_order_update payload_json: {"projectId":"...","workOrderId":"...","patch":{...}}
  patch fields (all optional): title, goal, context[], acceptance_criteria[], non_goals[],
  stop_conditions[], priority (1-5), tags[], estimate_hours, status, depends_on[], era
  DO NOT include updated_at or created_at in patch - these are auto-managed.
- work_order_set_status payload_json: {"projectId":"...","workOrderId":"...","status":"ready"}
  Use this instead of work_order_update when only changing status.
  When status changes to "done", dependents in backlog with satisfied ready contracts auto-transition to "ready".
- repos_rescan payload_json: {}
- work_order_start_run payload_json: {"projectId":"...","workOrderId":"..."}
- worktree_merge payload_json: {}
  Merge pending chat worktree changes into main and clean up the worktree.

Guidelines for dependencies:
- Use depends_on when a work order requires another to be completed first
- Work orders with unmet dependencies show "Blocked by" in the UI
- When all dependencies are done and ready contract is met, backlog items auto-transition to ready
`;
  const attentionDoc =
    `If you need the user to answer or approve something before you can proceed, ` +
    `set "needs_user_input": true in your JSON response.`;

  const accessLine = [
    `Filesystem: ${params.access.filesystem}`,
    `CLI: ${params.access.cli}`,
    `Network: ${formatNetworkAccess(params.access, params.trustedHosts)}`,
  ].join(" · ");
  const trustedLine = params.trustedHosts.length
    ? `Trusted hosts pack: ${params.trustedHosts.join(", ")}`
    : "Trusted hosts pack: (none)";

  const commandAuditBlock = params.commandAudit?.trim()
    ? `Recent command audit:\n${params.commandAudit.trim()}\n`
    : "";

  const outputBlock = params.outputTail?.trim()
    ? `Last run output (tail):\n${params.outputTail.trim()}\n`
    : "";

  const blendedBlock = params.blendedContext?.trim()
    ? `Recent run context (blended - full details for recent, commands for older):\n${params.blendedContext.trim()}\n`
    : "";

  const workOrderRunBlock = params.workOrderRunContext?.trim()
    ? `Work Order Runs (triggered from this chat):\n${params.workOrderRunContext.trim()}\n`
    : "";

  const messageLabel =
    params.contextDepth === "minimal"
      ? "Current message:"
      : params.contextDepth === "blended"
        ? "Recent messages (last 50, with tiered run context above):"
        : "Recent messages (last 50, verbatim):";
  const constitutionBlock = formatConstitutionBlock(params.constitution ?? "");

  return (
    `You are the in-app Control Center assistant for Project Control Center.\n` +
    constitutionBlock +
    `${scopeLine}\n` +
    `Access: ${accessLine}\n` +
    `${trustedLine}\n` +
    `Context depth: ${params.contextDepth}\n` +
    `\n` +
    `Behavior:\n` +
    `- If CLI access is enabled, use shell commands to discover context and perform operations like creating new project directories (mkdir + git init), then propose repos_rescan to register them.\n` +
    `- If filesystem write access is granted, work only inside the isolated chat worktree; changes stay pending until the user merges them.\n` +
    `- Actions do nothing until the human clicks Apply.\n` +
    `- Prefer small, explicit, reviewable actions.\n` +
    `- When defining project success, ask clarifying questions and propose project_set_success to write criteria/metrics to .control.yml.\n` +
    `- Avoid network calls unless network access is enabled.\n` +
    `\n` +
    `Work Order Run Outputs:\n` +
    `When a work order run is triggered (via work_order_start_run), outputs are stored at .system/runs/{runId}/\n` +
    `Key files to examine for debugging:\n` +
    `- run.log: Main execution timeline with timestamps\n` +
    `- builder/iter-{n}/result.json: Builder output {summary, risks, tests, changes}\n` +
    `- reviewer/iter-{n}/verdict.json: Review verdict {status, notes}\n` +
    `- tests/results.json: Test pass/fail results\n` +
    `- tests/npm-test.log: Raw test output\n` +
    `- diff.patch: Code changes made\n` +
    `To find recent runs, list .system/runs/ sorted by modification time. When a run fails, read run.log first for the timeline, then verdict.json or tests/results.json for details.\n` +
    `\n` +
    `${actionsDoc}\n` +
    `${attentionDoc}\n` +
    `${summaryBlock}\n` +
    `${commandAuditBlock}` +
    `${outputBlock}` +
    `${blendedBlock}` +
    `${workOrderRunBlock}` +
    `${messageLabel}\n` +
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

function buildSuggestionPrompt(params: {
  scope: ChatScope;
  projectId?: string;
  workOrderId?: string;
  summary: string;
  recentContext: string;
  message: string;
  context: ChatContextSelection;
  access: ChatAccess;
  trustedHosts: string[];
  constitution?: string;
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

  const recentBlock = params.recentContext.trim()
    ? `Recent thread context (last ${suggestionContextMessageLimit()} messages with runs/tools/logs where available):\n${params.recentContext.trim()}\n`
    : "";

  const accessLine = [
    `Filesystem: ${params.access.filesystem}`,
    `CLI: ${params.access.cli}`,
    `Network: ${formatNetworkAccess(params.access, params.trustedHosts)}`,
  ].join(" · ");
  const trustedLine = params.trustedHosts.length
    ? `Trusted hosts pack: ${params.trustedHosts.join(", ")}`
    : "Trusted hosts pack: (none)";
  const constitutionBlock = formatConstitutionBlock(params.constitution ?? "");

  return (
    `You recommend context depth and access settings for the Control Center chat.\n` +
    constitutionBlock +
    `${scopeLine}\n` +
    `Current settings: ${accessLine} · Context depth: ${params.context.depth}\n` +
    `${trustedLine}\n` +
    `\n` +
    `Guidance:\n` +
    `- Prefer least-privilege access and appropriate context depth.\n` +
    `- If the message contains pronouns (this, that, it), references to previous messages, or is a follow-up/confirmation, suggest at least 'messages' context depth.\n` +
    `- Only suggest 'minimal' if the message is completely self-contained with no references to prior conversation.\n` +
    `- Suggest more context (messages_tools, messages_tools_outputs) if the request needs tool audit or output logs.\n` +
    `- Suggest filesystem access 'none' only when the request needs no repo reads or CLI usage.\n` +
    `- Suggest write access only if the user explicitly asks for changes that require it.\n` +
    `- You may run read-only shell commands to inspect local files.\n` +
    `- Do not write files or use the network.\n` +
    `- Suggest network access only when needed: use localhost for loopback, trusted for the safe host pack, or allowlist with explicit hosts.\n` +
    `- Always include network_allowlist (empty array unless you choose allowlist).\n` +
    `- If you choose allowlist, include the hostnames in network_allowlist.\n` +
    `\n` +
    `${summaryBlock}\n` +
    `${recentBlock}\n` +
    `User message:\n${params.message.trim()}\n` +
    `\n` +
    `Return JSON matching the required schema. If no changes are needed, return the current settings and say so in reason.\n`
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

function formatCommandAudit(commands: ChatRunCommandRow[], limit = 50): string {
  const slice = commands.slice(Math.max(0, commands.length - limit));
  if (!slice.length) return "";
  return slice
    .map((cmd) => `${cmd.cwd} $ ${cmd.command}`)
    .join("\n");
}

/**
 * Build blended context with tiered detail levels:
 * - Tier 1 (5 most recent assistant responses): Full logs + commands
 * - Tier 2 (next 10 assistant responses): Commands only
 * - Tier 3 (remaining): Messages only
 */
function buildBlendedContext(params: {
  threadId: string;
  currentRunId: string;
}): {
  messages: Array<{ role: ChatMessageRole; content: string }>;
  blendedContext: string;
} {
  // Get last 50 messages (most recent first)
  const messagesDesc = listChatMessages({
    threadId: params.threadId,
    order: "desc",
    limit: 50,
  });

  // Get runs for this thread
  const runs = listChatRunsForThread(params.threadId, 50);

  // Build run lookup by assistant_message_id
  const runByMessageId = new Map<string, ChatRunRow>();
  for (const run of runs) {
    if (run.assistant_message_id) {
      runByMessageId.set(run.assistant_message_id, run);
    }
  }

  // Categorize runs by tier based on assistant message recency
  let assistantCount = 0;
  const tier1Runs: Array<{ run: ChatRunRow; messageContent: string }> = [];
  const tier2Runs: Array<{ run: ChatRunRow; messageContent: string }> = [];

  for (const msg of messagesDesc) {
    if (msg.role === "assistant") {
      assistantCount++;
      const run = runByMessageId.get(msg.id);
      if (run && run.id !== params.currentRunId && (run.status === "done" || run.status === "failed")) {
        if (assistantCount <= 5) {
          tier1Runs.push({ run, messageContent: msg.content });
        } else if (assistantCount <= 15) {
          tier2Runs.push({ run, messageContent: msg.content });
        }
      }
    }
  }

  // Build blended context string
  const sections: string[] = [];

  // Tier 1: Full context (logs + commands)
  if (tier1Runs.length > 0) {
    sections.push("=== Full Context (Last 5 responses) ===");
    for (const { run } of tier1Runs) {
      const commands = listChatRunCommands(run.id);
      const commandsStr = commands.length > 0
        ? `Commands: ${commands.slice(-10).map(c => unwrapShellCommand(c.command)).join("; ")}`
        : "Commands: (none)";
      const logTail = tailFile(run.log_path, 8000);
      const logStr = logTail.trim()
        ? `Output tail:\n${logTail.slice(-4000)}`
        : "Output: (empty)";
      sections.push(`[Run ${run.id.slice(0, 8)} - ${run.status}]\n${commandsStr}\n${logStr}`);
    }
  }

  // Tier 2: Commands only
  if (tier2Runs.length > 0) {
    sections.push("\n=== Tools Context (Responses 6-15) ===");
    for (const { run } of tier2Runs) {
      const commands = listChatRunCommands(run.id);
      const commandsStr = commands.length > 0
        ? `Commands: ${commands.slice(-10).map(c => unwrapShellCommand(c.command)).join("; ")}`
        : "Commands: (none)";
      sections.push(`[Run ${run.id.slice(0, 8)} - ${run.status}] ${commandsStr}`);
    }
  }

  // Note about remaining messages
  if (messagesDesc.length > 0) {
    const remaining = messagesDesc.length - (tier1Runs.length + tier2Runs.length) * 2;
    if (remaining > 0) {
      sections.push(`\n=== Messages (${remaining} older messages in conversation history) ===`);
    }
  }

  // Return messages in chronological order
  const messages = messagesDesc.slice().reverse().map((m) => ({
    role: m.role,
    content: m.content,
  }));

  return {
    messages,
    blendedContext: sections.join("\n\n"),
  };
}

/**
 * Build context about work order runs (builder/reviewer) that were triggered
 * from this chat thread. This gives the agent visibility into the status
 * and errors of runs it started.
 */
function buildWorkOrderRunContext(threadId: string): string {
  const runs = listWorkOrderRunsForThread(threadId, 5);
  if (!runs.length) return "";

  const lines: string[] = [];
  for (const run of runs) {
    const statusStr =
      run.status === "failed" && run.error
        ? `failed: ${truncateForPrompt(run.error, 400)}`
        : run.status;
    lines.push(
      `[Run ${run.id.slice(0, 8)} - ${statusStr}] WO: ${run.work_order_id} (iter ${run.iteration})`
    );
  }
  return lines.join("\n");
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "0:0:0:0:0:0:0:1"]);
const NETWORK_COMMANDS = new Set([
  "curl",
  "wget",
  "http",
  "https",
  "ping",
  "traceroute",
  "dig",
  "nslookup",
  "host",
  "ssh",
  "scp",
  "sftp",
  "rsync",
  "ftp",
  "telnet",
  "nc",
  "ncat",
  "netcat",
  "git",
  "npm",
  "npx",
  "pnpm",
  "yarn",
  "pip",
  "pip3",
  "pipx",
  "cargo",
  "go",
  "gem",
  "bundle",
  "composer",
  "apt",
  "apt-get",
  "brew",
  "apk",
  "yum",
  "dnf",
]);
const GIT_NETWORK_SUBCOMMANDS = new Set([
  "clone",
  "fetch",
  "pull",
  "push",
  "ls-remote",
  "remote",
  "submodule",
  "archive",
]);

const PACKAGE_MANAGER_COMMANDS = new Set(["npm", "pnpm", "yarn"]);
const PACKAGE_MANAGER_LOCAL_SUBCOMMANDS = new Set([
  "run",
  "run-script",
  "test",
  "start",
  "stop",
  "restart",
  "build",
  "lint",
  "exec",
]);
const PACKAGE_MANAGER_NETWORK_SUBCOMMANDS = new Set([
  "add",
  "install",
  "i",
  "update",
  "upgrade",
  "remove",
  "rm",
  "uninstall",
  "ci",
  "publish",
  "login",
  "logout",
  "whoami",
  "info",
  "view",
  "search",
  "audit",
  "outdated",
  "fetch",
  "dlx",
]);

function normalizeHost(value: string): string {
  let host = value.trim().toLowerCase();
  if (!host) return "";
  if (host.startsWith("[") && host.includes("]")) {
    host = host.slice(1, host.indexOf("]"));
  }
  const lastColon = host.lastIndexOf(":");
  if (lastColon > -1 && host.indexOf(":") === lastColon) {
    const port = host.slice(lastColon + 1);
    if (/^\d+$/.test(port)) host = host.slice(0, lastColon);
  }
  if (host.endsWith(".")) host = host.slice(0, -1);
  return host;
}

function isLoopbackHost(value: string): boolean {
  const host = normalizeHost(value);
  if (!host) return false;
  if (LOOPBACK_HOSTS.has(host)) return true;
  if (host.startsWith("127.")) return true;
  return false;
}

function cleanToken(raw: string): string {
  return raw.replace(/^['"]|['"]$/g, "").replace(/[;,]+$/g, "");
}

function extractHostsFromToken(token: string): string[] {
  const cleaned = cleanToken(token);
  if (!cleaned) return [];
  if (cleaned.includes("://")) {
    try {
      const parsed = new URL(cleaned);
      return parsed.hostname ? [parsed.hostname] : [];
    } catch {
      return [];
    }
  }
  const scpMatch = cleaned.match(/^[^@]+@([^:]+)(?::.+)?$/);
  if (scpMatch?.[1]) return [scpMatch[1]];
  const hostPortMatch = cleaned.match(
    /^(\[[0-9a-fA-F:]+\]|[a-z0-9][a-z0-9.-]*)(?::\d{1,5})?(?:\/|$)/i
  );
  if (hostPortMatch?.[1]) return [hostPortMatch[1]];
  return [];
}

function findNextNonOption(tokens: string[], start: number): string | null {
  for (let i = start; i < tokens.length; i += 1) {
    const cleaned = cleanToken(tokens[i] ?? "");
    if (!cleaned) continue;
    if (cleaned.startsWith("-")) continue;
    return cleaned;
  }
  return null;
}

function shouldSkipPackageManagerNetwork(base: string, tokens: string[], index: number): boolean {
  if (!PACKAGE_MANAGER_COMMANDS.has(base)) return false;
  const sub = findNextNonOption(tokens, index + 1);
  if (!sub) return false;
  const subLower = sub.toLowerCase();
  if (PACKAGE_MANAGER_LOCAL_SUBCOMMANDS.has(subLower)) return true;
  if ((base === "yarn" || base === "pnpm") && !PACKAGE_MANAGER_NETWORK_SUBCOMMANDS.has(subLower)) {
    return true;
  }
  return false;
}

function extractNetworkTargets(command: string): { hosts: string[]; hasNetworkCommand: boolean } {
  const hosts = new Set<string>();
  let hasNetworkCommand = false;

  const urlRegex = /\b(?:https?|wss?|ftp|ssh):\/\/[^\s"'<>]+/gi;
  for (const match of command.matchAll(urlRegex)) {
    const raw = match[0];
    try {
      const parsed = new URL(raw);
      if (parsed.hostname) hosts.add(parsed.hostname);
      hasNetworkCommand = true;
    } catch {
      // ignore invalid URL
    }
  }

  const scpRegex = /\b[^@\s]+@([^\s:]+):[^\s]+/g;
  for (const match of command.matchAll(scpRegex)) {
    if (match[1]) hosts.add(match[1]);
    hasNetworkCommand = true;
  }

  const hostPortRegex = /\b([a-z0-9.-]+|\[[0-9a-fA-F:]+\]):\d{1,5}\b/g;
  for (const match of command.matchAll(hostPortRegex)) {
    if (match[1]) hosts.add(match[1]);
    hasNetworkCommand = true;
  }

  const tokens = command.split(/\s+/).filter(Boolean).map(cleanToken);
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (!token) continue;
    const base = path.basename(token).toLowerCase();
    if (!NETWORK_COMMANDS.has(base)) continue;
    if (shouldSkipPackageManagerNetwork(base, tokens, i)) continue;

    if (base === "git") {
      const sub = tokens[i + 1]?.toLowerCase() ?? "";
      if (GIT_NETWORK_SUBCOMMANDS.has(sub)) {
        hasNetworkCommand = true;
        for (let j = i + 2; j < tokens.length; j += 1) {
          const candidate = tokens[j];
          if (!candidate || candidate.startsWith("-")) continue;
          for (const host of extractHostsFromToken(candidate)) hosts.add(host);
        }
      }
      continue;
    }

    hasNetworkCommand = true;
    const next = findNextNonOption(tokens, i + 1);
    if (next) {
      for (const host of extractHostsFromToken(next)) hosts.add(host);
    }
  }

  return { hosts: Array.from(hosts), hasNetworkCommand };
}

function buildHostSetFromList(entries: string[]): Set<string> {
  const set = new Set<string>();
  for (const entry of entries) {
    const trimmed = String(entry).trim();
    if (!trimmed) continue;
    const hosts = extractHostsFromToken(trimmed);
    if (hosts.length) {
      for (const host of hosts) {
        const normalized = normalizeHost(host);
        if (normalized) set.add(normalized);
      }
    } else {
      const normalized = normalizeHost(trimmed);
      if (normalized) set.add(normalized);
    }
  }
  return set;
}

function buildAllowlist(access: ChatAccess, trustedHosts: string[]): Set<string> {
  if (access.network === "trusted") return buildHostSetFromList(trustedHosts);
  if (access.network !== "allowlist") return new Set();
  return buildHostSetFromList(access.network_allowlist ?? []);
}

function isHostAllowed(host: string, access: ChatAccess, allowlist: Set<string>): boolean {
  const normalized = normalizeHost(host);
  if (!normalized) return false;
  if (isLoopbackHost(normalized)) return true;
  if (access.network === "localhost") return false;
  if (access.network === "allowlist" || access.network === "trusted") {
    return allowlist.has(normalized);
  }
  return false;
}

function enforceNetworkAccess(command: string, access: ChatAccess, allowlist: Set<string>): string | null {
  const { hosts, hasNetworkCommand } = extractNetworkTargets(command);
  if (!hasNetworkCommand && !hosts.length) return null;
  if (access.network === "none") {
    return "Network access is disabled for this run.";
  }
  if (!hosts.length) {
    return "Network access requires an explicit host or URL to validate.";
  }
  const blocked = hosts.filter((host) => !isHostAllowed(host, access, allowlist));
  if (blocked.length) {
    return `Network access blocked for host(s): ${blocked.join(", ")}.`;
  }
  return null;
}

type ChatScopeParams =
  | { scope: "global" }
  | { scope: "project"; projectId: string }
  | { scope: "work_order"; projectId: string; workOrderId: string };

function scopeParamsForThread(thread: ChatThreadRow): ChatScopeParams {
  if (thread.scope === "global") return { scope: "global" };
  if (thread.scope === "project") {
    if (!thread.project_id) throw new Error("thread missing project_id");
    return { scope: "project", projectId: thread.project_id };
  }
  if (!thread.project_id || !thread.work_order_id) {
    throw new Error("thread missing project_id/work_order_id");
  }
  return { scope: "work_order", projectId: thread.project_id, workOrderId: thread.work_order_id };
}

function loadWorkOrder(repoPath: string, workOrderId: string): WorkOrder {
  const all = listWorkOrders(repoPath);
  const found = all.find((w) => w.id === workOrderId);
  if (!found) throw new Error("Work Order not found");
  return found;
}

function readWorkOrderTags(
  repoPath: string | null,
  workOrderId?: string | null
): string[] | undefined {
  if (!repoPath || !workOrderId) return undefined;
  try {
    return loadWorkOrder(repoPath, workOrderId).tags;
  } catch {
    return undefined;
  }
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

export function getChatThreadDetailsById(threadId: string): ChatThreadDetails | null {
  const thread = getChatThreadById(threadId);
  if (!thread) return null;

  // Skip summarized messages - they've been rolled into thread.summary
  const offset = thread.summarized_count;
  const messages = listChatMessages({ threadId: thread.id, limit: 200, order: "asc", offset });
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

export async function suggestChatSettings(
  params: ChatScopeParams & {
    content: string;
    context?: ChatContextSelection | null;
    access?: ChatAccess | null;
  }
): Promise<ChatSuggestion> {
  const thread = ensureChatThread(params);
  const content = params.content.trim();
  if (!content) throw new Error("message is empty");
  const context = normalizeChatContextSelection(params.context ?? undefined);
  const access = normalizeChatAccess(params.access ?? undefined);

  const settings = resolveChatSettings().effective;
  if (settings.provider !== "codex") {
    throw new Error("Only the Codex provider is supported for chat in v0; update Chat Settings to use Codex.");
  }

  const { cwd, skipGitRepoCheck } = resolveChatWorkspace(params);
  const { suggestionSchemaPath } = ensureSchemas();
  const runId = crypto.randomUUID();
  const runDir = path.join(process.cwd(), ".system", "chat", "suggestions", runId);
  ensureDir(runDir);
  const outputPath = path.join(runDir, "suggestion.json");
  const logPath = path.join(runDir, "codex.jsonl");

  const recentContext = formatSuggestionRecentContext({
    threadId: thread.id,
    limit: suggestionContextMessageLimit(),
  });

  const repoPath = params.scope === "global" ? null : cwd;
  const workOrderTags = readWorkOrderTags(
    repoPath,
    params.scope === "work_order" ? params.workOrderId : null
  );
  const mergedConstitution = getConstitutionForProject(repoPath);
  const suggestionConstitution = selectRelevantConstitutionSections({
    constitution: mergedConstitution,
    context: "chat_suggestion",
    workOrderTags,
  });
  logConstitutionSelection(logPath, "chat_suggestion", suggestionConstitution);

  const prompt = buildSuggestionPrompt({
    scope: params.scope,
    projectId: "projectId" in params ? params.projectId : undefined,
    workOrderId: "workOrderId" in params ? params.workOrderId : undefined,
    summary: thread.summary ?? "",
    recentContext,
    message: content,
    context,
    access,
    trustedHosts: settings.trusted_hosts ?? [],
    constitution: suggestionConstitution.content,
  });

  const suggestionAccess: ChatAccess = {
    filesystem: "read-only",
    cli: "read-only",
    network: "none",
  };
  const suggestionAllowlist = new Set<string>();

  await runCodexExecJson({
    cwd,
    prompt,
    schemaPath: suggestionSchemaPath,
    outputPath,
    logPath,
    sandbox: "read-only",
    model: settings.model,
    cliPath: settings.cliPath,
    skipGitRepoCheck: skipGitRepoCheck || shouldSkipGitRepoCheck(cwd),
    onEventJsonLine: (line, control) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        return;
      }
      const commands = parseShellCommandsFromEvent(parsed);
      for (const cmd of commands) {
        const networkError = enforceNetworkAccess(cmd.command, suggestionAccess, suggestionAllowlist);
        if (networkError) {
          control.abort("Network access is disabled for the suggestion step.");
          return;
        }
      }
    },
  });

  const raw = fs.readFileSync(outputPath, "utf8");
  const json = JSON.parse(raw) as unknown;
  const parsed = ChatSuggestionSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error("suggestion response did not match schema");
  }

  const suggestion = parsed.data;
  const { accessDelta, reasonSuffix } = sanitizeSuggestionAccess({
    base: access,
    suggestion,
  });

  const nextReason = (() => {
    const baseReason = suggestion.reason?.trim() ?? "";
    if (!reasonSuffix) return baseReason || undefined;
    if (!baseReason) return reasonSuffix;
    return `${baseReason} ${reasonSuffix}`;
  })();

  const out: ChatSuggestion = {};
  if (suggestion.context_depth && suggestion.context_depth !== context.depth) {
    out.context_depth = suggestion.context_depth;
  }
  if (accessDelta) out.access = accessDelta;
  if (nextReason) out.reason = nextReason;
  return out;
}

export async function suggestChatSettingsForThread(params: {
  threadId: string;
  content: string;
  context?: ChatContextSelection | null;
  access?: ChatAccess | null;
}): Promise<ChatSuggestion> {
  const thread = getChatThreadById(params.threadId);
  if (!thread) throw new Error("thread not found");
  const scopeParams = scopeParamsForThread(thread);

  const content = params.content.trim();
  if (!content) throw new Error("message is empty");

  const context =
    params.context === undefined
      ? normalizeChatContextSelection({ depth: thread.default_context_depth })
      : normalizeChatContextSelection(params.context);
  const access =
    params.access === undefined ? threadDefaultAccess(thread) : normalizeChatAccess(params.access);

  const settings = resolveChatSettings().effective;
  if (settings.provider !== "codex") {
    throw new Error("Only the Codex provider is supported for chat in v0; update Chat Settings to use Codex.");
  }

  const { cwd, skipGitRepoCheck } = resolveChatWorkspace(scopeParams);
  const { suggestionSchemaPath } = ensureSchemas();
  const runId = crypto.randomUUID();
  const runDir = path.join(process.cwd(), ".system", "chat", "suggestions", runId);
  ensureDir(runDir);
  const outputPath = path.join(runDir, "suggestion.json");
  const logPath = path.join(runDir, "codex.jsonl");

  const recentContext = formatSuggestionRecentContext({
    threadId: thread.id,
    limit: suggestionContextMessageLimit(),
  });

  const repoPath = scopeParams.scope === "global" ? null : cwd;
  const workOrderTags = readWorkOrderTags(
    repoPath,
    scopeParams.scope === "work_order" ? scopeParams.workOrderId : null
  );
  const mergedConstitution = getConstitutionForProject(repoPath);
  const suggestionConstitution = selectRelevantConstitutionSections({
    constitution: mergedConstitution,
    context: "chat_suggestion",
    workOrderTags,
  });
  logConstitutionSelection(logPath, "chat_suggestion", suggestionConstitution);

  const prompt = buildSuggestionPrompt({
    scope: scopeParams.scope,
    projectId: "projectId" in scopeParams ? scopeParams.projectId : undefined,
    workOrderId: "workOrderId" in scopeParams ? scopeParams.workOrderId : undefined,
    summary: thread.summary ?? "",
    recentContext,
    message: content,
    context,
    access,
    trustedHosts: settings.trusted_hosts ?? [],
    constitution: suggestionConstitution.content,
  });

  const suggestionAccess: ChatAccess = {
    filesystem: "read-only",
    cli: "read-only",
    network: "none",
  };
  const suggestionAllowlist = new Set<string>();

  await runCodexExecJson({
    cwd,
    prompt,
    schemaPath: suggestionSchemaPath,
    outputPath,
    logPath,
    sandbox: "read-only",
    model: settings.model,
    cliPath: settings.cliPath,
    skipGitRepoCheck: skipGitRepoCheck || shouldSkipGitRepoCheck(cwd),
    onEventJsonLine: (line, control) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        return;
      }
      const commands = parseShellCommandsFromEvent(parsed);
      for (const cmd of commands) {
        const networkError = enforceNetworkAccess(cmd.command, suggestionAccess, suggestionAllowlist);
        if (networkError) {
          control.abort("Network access is disabled for the suggestion step.");
          return;
        }
      }
    },
  });

  const raw = fs.readFileSync(outputPath, "utf8");
  const json = JSON.parse(raw) as unknown;
  const parsed = ChatSuggestionSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error("suggestion response did not match schema");
  }

  const suggestion = parsed.data;
  const { accessDelta, reasonSuffix } = sanitizeSuggestionAccess({
    base: access,
    suggestion,
  });

  const nextReason = (() => {
    const baseReason = suggestion.reason?.trim() ?? "";
    if (!reasonSuffix) return baseReason || undefined;
    if (!baseReason) return reasonSuffix;
    return `${baseReason} ${reasonSuffix}`;
  })();

  const out: ChatSuggestion = {};
  if (suggestion.context_depth && suggestion.context_depth !== context.depth) {
    out.context_depth = suggestion.context_depth;
  }
  if (accessDelta) out.access = accessDelta;
  if (nextReason) out.reason = nextReason;
  return out;
}

export function getChatThreadDetails(params: ChatScopeParams): ChatThreadDetails {
  const thread = ensureChatThread(params);
  // Skip summarized messages - they've been rolled into thread.summary
  const offset = thread.summarized_count;
  const messages = listChatMessages({ threadId: thread.id, limit: 200, order: "asc", offset });
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

export function enqueueChatTurnForThread(params: {
  threadId: string;
  content: string;
  context?: ChatContextSelection | null;
  access?: ChatAccess | null;
  suggestion?: ChatSuggestion | null;
  confirmations?: ChatConfirmations | null;
  spawnWorker?: boolean;
}): ChatRunRow {
  const thread = getChatThreadById(params.threadId);
  if (!thread) throw new Error("thread not found");
  const scopeParams = scopeParamsForThread(thread);

  const content = params.content.trim();
  if (!content) throw new Error("message is empty");

  if (scopeParams.scope !== "global") {
    const project = findProjectById(scopeParams.projectId);
    if (!project) throw new Error("project not found");
    if (scopeParams.scope === "work_order") {
      loadWorkOrder(project.path, scopeParams.workOrderId);
    }
  }

  const context =
    params.context === undefined
      ? normalizeChatContextSelection({ depth: thread.default_context_depth })
      : normalizeChatContextSelection(params.context);
  const access =
    params.access === undefined ? threadDefaultAccess(thread) : normalizeChatAccess(params.access);
  const confirmations = params.confirmations ?? {};
  const suggestion = params.suggestion ? ChatSuggestionSchema.parse(params.suggestion) : null;
  const settings = resolveChatSettings().effective;
  validateChatAccess(access, settings.trusted_hosts ?? []);

  const needsWriteApproval = requiresWriteConfirmation(access);
  const needsNetworkApproval = requiresNetworkConfirmation(access);
  if (
    (needsWriteApproval && !confirmations.write) ||
    (needsNetworkApproval && !confirmations.network_allowlist)
  ) {
    const pending = createChatPendingSend({
      threadId: thread.id,
      content,
      contextDepth: context.depth,
      access,
      suggestion,
    });
    throw new PendingSendError("Send requires approval.", pending.id, {
      write: needsWriteApproval,
      network_allowlist: needsNetworkApproval,
    });
  }

  const userMessage = createChatMessage({
    threadId: thread.id,
    role: "user",
    content,
  });

  if (settings.provider !== "codex") {
    throw new Error("Only the Codex provider is supported for chat in v0; update Chat Settings to use Codex.");
  }

  const runId = crypto.randomUUID();
  const runDir = path.join(process.cwd(), ".system", "chat", "runs", runId);
  const logPath = path.join(runDir, "codex.jsonl");
  ensureDir(runDir);

  const { cwd } = resolveChatWorkspace(scopeParams);

  const run = createChatRun({
    id: runId,
    threadId: thread.id,
    userMessageId: userMessage.id,
    model: settings.model,
    cliPath: settings.cliPath,
    cwd,
    logPath,
    contextDepth: context.depth,
    access,
    suggestion,
  });
  resolveMatchingPendingSends({
    threadId: thread.id,
    content,
    contextDepth: context.depth,
    access,
  });

  if (params.spawnWorker !== false) {
    spawnChatWorker(run.id);
  }
  return run;
}

export function enqueueChatTurn(
  params: ChatScopeParams & {
    content: string;
    context?: ChatContextSelection | null;
    access?: ChatAccess | null;
    suggestion?: ChatSuggestion | null;
    confirmations?: ChatConfirmations | null;
  }
): ChatRunRow {
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

  const context = normalizeChatContextSelection(params.context ?? undefined);
  const access = normalizeChatAccess(params.access ?? undefined);
  const confirmations = params.confirmations ?? {};
  const suggestion = params.suggestion ? ChatSuggestionSchema.parse(params.suggestion) : null;
  const settings = resolveChatSettings().effective;
  validateChatAccess(access, settings.trusted_hosts ?? []);

  const needsWriteApproval = requiresWriteConfirmation(access);
  const needsNetworkApproval = requiresNetworkConfirmation(access);
  if (
    (needsWriteApproval && !confirmations.write) ||
    (needsNetworkApproval && !confirmations.network_allowlist)
  ) {
    const pending = createChatPendingSend({
      threadId: thread.id,
      content,
      contextDepth: context.depth,
      access,
      suggestion,
    });
    throw new PendingSendError("Send requires approval.", pending.id, {
      write: needsWriteApproval,
      network_allowlist: needsNetworkApproval,
    });
  }

  const userMessage = createChatMessage({
    threadId: thread.id,
    role: "user",
    content,
  });

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
    contextDepth: context.depth,
    access,
    suggestion,
  });
  resolveMatchingPendingSends({
    threadId: thread.id,
    content,
    contextDepth: context.depth,
    access,
  });

  spawnChatWorker(run.id);
  return run;
}

function shouldPreferTsWorker(): boolean {
  if (getUseTsWorker()) return true;
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
    env: getProcessEnv(),
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
  if (result.changes > 0) {
    emitChatRunStatusEvent({ ...run, status: "running", started_at: startedAt, error: null });
    return true;
  }
  return false;
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

function ensureSchemas(): { chatSchemaPath: string; summarySchemaPath: string; suggestionSchemaPath: string } {
  const baseDir = path.join(process.cwd(), ".system", "chat");
  ensureDir(baseDir);
  const chatSchemaPath = path.join(baseDir, "chat_response.schema.json");
  const summarySchemaPath = path.join(baseDir, "chat_summary.schema.json");
  const suggestionSchemaPath = path.join(baseDir, "chat_suggestion.schema.json");
  fs.writeFileSync(chatSchemaPath, `${JSON.stringify(chatResponseJsonSchema(), null, 2)}\n`, "utf8");
  fs.writeFileSync(summarySchemaPath, `${JSON.stringify(summaryJsonSchema(), null, 2)}\n`, "utf8");
  fs.writeFileSync(
    suggestionSchemaPath,
    `${JSON.stringify(suggestionJsonSchema(), null, 2)}\n`,
    "utf8"
  );
  return { chatSchemaPath, summarySchemaPath, suggestionSchemaPath };
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
      sandbox: "read-only",
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

  let refreshedThread = getChatThreadById(run.thread_id) ?? thread;
  const parsedContext = ChatContextSelectionSchema.safeParse({ depth: run.context_depth });
  const contextDepth = parsedContext.success ? parsedContext.data.depth : DEFAULT_CONTEXT.depth;
  const accessAllowlist = (() => {
    if (!run.access_network_allowlist) return undefined;
    try {
      const parsed = JSON.parse(run.access_network_allowlist);
      return Array.isArray(parsed) ? parsed.map((entry) => String(entry)) : undefined;
    } catch {
      return undefined;
    }
  })();
  const access = normalizeChatAccess({
    filesystem: run.access_filesystem,
    cli: run.access_cli,
    network: run.access_network,
    network_allowlist: accessAllowlist,
  });
  let enforcement: { sandbox: "read-only" | "workspace-write"; cliOff: boolean };
  try {
    enforcement = validateChatAccess(access, settings.trusted_hosts ?? []);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    updateChatRun(runId, {
      status: "failed",
      error: message,
      finished_at: nowIso(),
    });
    return;
  }
  const allowlist = buildAllowlist(access, settings.trusted_hosts ?? []);

  let repoPath: string | null = null;
  if (refreshedThread.scope !== "global") {
    const projectId = refreshedThread.project_id;
    const project = projectId ? findProjectById(projectId) : null;
    if (!project) {
      updateChatRun(runId, {
        status: "failed",
        error: "project not found",
        finished_at: nowIso(),
      });
      return;
    }
    repoPath = project.path;
  }

  const workOrderTags = readWorkOrderTags(
    repoPath,
    refreshedThread.scope === "work_order" ? refreshedThread.work_order_id : null
  );
  const mergedConstitution = getConstitutionForProject(repoPath);
  const chatConstitution = selectRelevantConstitutionSections({
    constitution: mergedConstitution,
    context: "chat",
    workOrderTags,
  });
  logConstitutionSelection(run.log_path, "chat", chatConstitution);

  let runCwd = run.cwd;
  let worktreeInfo:
    | { worktreePath: string; branchName: string; baseBranch: string }
    | null = null;
  if (
    repoPath &&
    (access.filesystem === "read-write" ||
      access.cli === "read-write" ||
      refreshedThread.worktree_path)
  ) {
    try {
      const ensured = ensureChatWorktree({
        repoPath,
        threadId: refreshedThread.id,
        worktreePath: refreshedThread.worktree_path,
      });
      worktreeInfo = ensured;
      runCwd = ensured.worktreePath;
      if (runCwd !== run.cwd) {
        updateChatRun(runId, { cwd: runCwd });
      }
      if (refreshedThread.worktree_path !== ensured.worktreePath) {
        const updated = updateChatThread({
          threadId: refreshedThread.id,
          worktreePath: ensured.worktreePath,
        });
        if (updated) refreshedThread = updated;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      updateChatRun(runId, {
        status: "failed",
        error: `worktree creation failed: ${message}`,
        finished_at: nowIso(),
      });
      return;
    }
  }

  const lastMessages = (() => {
    if (contextDepth === "minimal") {
      const current = getChatMessageById(run.user_message_id);
      if (current) return [{ role: current.role, content: current.content }];
      return [];
    }
    return listChatMessages({
      threadId: run.thread_id,
      order: "desc",
      limit: 50,
    })
      .slice()
      .reverse()
      .map((m) => ({ role: m.role, content: m.content }));
  })();
  const messageFallback =
    contextDepth === "minimal" && !lastMessages.length
      ? listChatMessages({
          threadId: run.thread_id,
          order: "desc",
          limit: 50,
        })
          .slice()
          .reverse()
          .map((m) => ({ role: m.role, content: m.content }))
      : null;
  const contextMessages = messageFallback ?? lastMessages;

  let commandAudit: string | undefined;
  let outputTail: string | undefined;
  let blendedContext: string | undefined;
  let blendedMessages: Array<{ role: ChatMessageRole; content: string }> | undefined;

  if (contextDepth === "blended") {
    const blended = buildBlendedContext({
      threadId: run.thread_id,
      currentRunId: run.id,
    });
    blendedMessages = blended.messages;
    blendedContext = blended.blendedContext;
  } else if (contextDepth === "messages_tools" || contextDepth === "messages_tools_outputs") {
    const recentRun = listChatRunsForThread(run.thread_id, 50).find(
      (candidate) =>
        candidate.id !== run.id && (candidate.status === "done" || candidate.status === "failed")
    );
    if (recentRun) {
      const commands = listChatRunCommands(recentRun.id);
      const formatted = formatCommandAudit(commands, 50);
      if (formatted) commandAudit = formatted;
      if (contextDepth === "messages_tools_outputs") {
        const tail = tailFile(recentRun.log_path);
        if (tail.trim()) outputTail = tail;
      }
    }
  }

  const { chatSchemaPath } = ensureSchemas();
  const outputPath = path.join(path.dirname(run.log_path), "result.json");

  let commandSeq = 0;
  const insertCommand = (cwd: string | undefined, command: string) => {
    const resolvedCwd = cwd ?? runCwd;
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
      cwd: cmd.cwd ?? runCwd,
      command: cmd.command,
    }));

    if (normalized.length < commandSeq) return false;
    replaceChatRunCommands({ runId, commands: normalized });
    commandSeq = normalized.length;
    commandsRebuilt = true;
    return true;
  };

  const { skipGitRepoCheck } = (() => ({
    skipGitRepoCheck: shouldSkipGitRepoCheck(runCwd),
  }))();

  const workOrderRunContext = buildWorkOrderRunContext(refreshedThread.id);

  const prompt = buildChatPrompt({
    scope: refreshedThread.scope,
    threadId: refreshedThread.id,
    projectId: refreshedThread.project_id ?? undefined,
    workOrderId: refreshedThread.work_order_id ?? undefined,
    summary: refreshedThread.summary ?? "",
    messages: blendedMessages ?? contextMessages,
    contextDepth,
    access,
    trustedHosts: settings.trusted_hosts ?? [],
    commandAudit,
    outputTail,
    blendedContext,
    workOrderRunContext,
    constitution: chatConstitution.content,
  });

  const updatePendingChanges = (): boolean => {
    if (!worktreeInfo) return false;
    const status = readWorktreeStatus(worktreeInfo.worktreePath);
    const updated = updateChatThread({
      threadId: refreshedThread.id,
      worktreePath: worktreeInfo.worktreePath,
      hasPendingChanges: status.hasPendingChanges,
    });
    if (updated) refreshedThread = updated;
    return status.hasPendingChanges;
  };

  let costRecorded = false;

  try {
    await runCodexExecJson({
      cwd: runCwd,
      prompt,
      schemaPath: chatSchemaPath,
      outputPath,
      logPath: run.log_path,
      sandbox: enforcement.sandbox,
      model: run.model,
      cliPath: run.cli_path,
      skipGitRepoCheck: skipGitRepoCheck || shouldSkipGitRepoCheck(runCwd),
      networkEnabled: access.network !== "none",
      onEventJsonLine: (line, control) => {
        let parsed: unknown;
        try {
          parsed = JSON.parse(line);
        } catch {
          return;
        }
        const commands = parseShellCommandsFromEvent(parsed);
        if (enforcement.cliOff && commands.length) {
          control.abort("CLI access is disabled for this run.");
          return;
        }
        for (const cmd of commands) {
          const networkError = enforceNetworkAccess(cmd.command, access, allowlist);
          if (networkError) {
            insertCommand(cmd.cwd, cmd.command);
            control.abort(networkError);
            return;
          }
          insertCommand(cmd.cwd, cmd.command);
        }
      },
    });
    if (refreshedThread.project_id) {
      recordChatCost({
        projectId: refreshedThread.project_id,
        runId,
        model: run.model,
        logPath: run.log_path,
      });
      costRecorded = true;
    }
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

    const pendingChanges = updatePendingChanges();
    if (pendingChanges && !actions.some((action) => action.type === "worktree_merge")) {
      actions.push({
        type: "worktree_merge",
        title: "Merge pending changes",
        payload: {},
      });
    }

    const assistantMessage = createChatMessage({
      threadId: run.thread_id,
      role: "assistant",
      content: parsedWire.data.reply,
      actions,
      needsUserInput: parsedWire.data.needs_user_input === true,
      runId,
    });

    updateChatRun(runId, {
      assistant_message_id: assistantMessage.id,
      status: "done",
      finished_at: nowIso(),
      error: null,
    });
  } catch (err) {
    if (!costRecorded && refreshedThread.project_id) {
      recordChatCost({
        projectId: refreshedThread.project_id,
        runId,
        model: run.model,
        logPath: run.log_path,
        description: `chat run ${runId} failed`,
      });
      costRecorded = true;
    }
    if (!commandsRebuilt) {
      try {
        rebuildCommandsFromLog();
      } catch {
        // keep original error
      }
    }
    const message = err instanceof Error ? err.message : String(err);
    const actions: ChatAction[] = [];
    const pendingChanges = updatePendingChanges();
    if (pendingChanges) {
      actions.push({
        type: "worktree_merge",
        title: "Merge pending changes",
        payload: {},
      });
    }
    const assistantMessage = createChatMessage({
      threadId: run.thread_id,
      role: "assistant",
      content: `Chat run failed: ${message}`,
      actions,
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
