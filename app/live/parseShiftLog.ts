/**
 * Parses Claude CLI stream-json log lines into human-readable activity entries.
 */

export type ActivityEntry = {
  id: string;
  timestamp: Date;
  type: "init" | "tool" | "text" | "result" | "error" | "unknown";
  content: string;
  details?: string;
  fullText?: string;
  toolName?: string;
  toolInput?: unknown;
  toolOutput?: unknown;
  toolUseId?: string;
  isError?: boolean;
  raw?: unknown;
};

function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 3) + "...";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function extractToolDescription(input: unknown): string {
  if (typeof input === "string") return truncate(input, 60);
  if (!isRecord(input)) return "";
  if (typeof input.description === "string") return input.description;
  if (typeof input.command === "string") return truncate(input.command, 60);
  if (typeof input.file_path === "string") return input.file_path;
  if (typeof input.pattern === "string") return `pattern: ${input.pattern}`;
  if (typeof input.query === "string") return truncate(input.query, 60);
  if (typeof input.url === "string") return truncate(input.url, 60);
  return "";
}

let entryCounter = 0;

type ParsedLine = {
  entries: ActivityEntry[];
  toolResults: ToolResult[];
};

type ToolResult = {
  toolUseId?: string;
  toolName?: string;
  output?: unknown;
  isError?: boolean;
  raw?: unknown;
};

function nextEntryId(): string {
  entryCounter += 1;
  return `entry-${entryCounter}`;
}

function extractToolName(record: Record<string, unknown>): string | null {
  if (typeof record.name === "string") return record.name;
  if (typeof record.tool_name === "string") return record.tool_name;
  if (typeof record.toolName === "string") return record.toolName;
  if (typeof record.tool === "string") return record.tool;
  return null;
}

function extractToolInput(record: Record<string, unknown>): unknown {
  return (
    record.input ??
    record.arguments ??
    record.args ??
    record.parameters ??
    record.params ??
    record.tool_input ??
    record.tool_arguments ??
    null
  );
}

function parseToolUse(record: Record<string, unknown>): {
  toolName: string;
  toolInput: unknown;
  toolUseId?: string;
  raw?: unknown;
} | null {
  const type = record.type;
  if (typeof type !== "string") return null;
  if (type !== "tool_use" && type !== "tool") return null;
  const toolName = extractToolName(record);
  if (!toolName) return null;
  const toolUseId = typeof record.id === "string" ? record.id : undefined;
  const toolInput = extractToolInput(record);
  return { toolName, toolInput, toolUseId, raw: record };
}

function parseToolResult(record: Record<string, unknown>): ToolResult | null {
  const type = record.type;
  if (typeof type !== "string") return null;
  if (type !== "tool_result" && type !== "tool_use_result") return null;
  const toolUseId =
    typeof record.tool_use_id === "string"
      ? record.tool_use_id
      : typeof record.toolUseId === "string"
        ? record.toolUseId
        : typeof record.id === "string"
          ? record.id
          : undefined;
  const toolName = extractToolName(record) ?? undefined;
  const stdout = typeof record.stdout === "string" ? record.stdout : undefined;
  const stderr = typeof record.stderr === "string" ? record.stderr : undefined;
  const output =
    record.content ??
    record.output ??
    record.result ??
    record.data ??
    (stdout || stderr ? { stdout, stderr } : undefined);
  const isError =
    typeof record.is_error === "boolean"
      ? record.is_error
      : typeof record.isError === "boolean"
        ? record.isError
        : typeof record.error === "string"
          ? true
          : undefined;
  return { toolUseId, toolName, output, isError, raw: record };
}

function parseMessageContent(
  blocks: unknown[]
): { entries: ActivityEntry[]; toolResults: ToolResult[] } {
  const entries: ActivityEntry[] = [];
  const toolResults: ToolResult[] = [];

  for (const block of blocks) {
    if (!isRecord(block)) continue;
    const blockType = block.type;
    if (blockType === "tool_use") {
      const toolName = extractToolName(block);
      if (!toolName) continue;
      const toolInput = extractToolInput(block);
      const toolUseId = typeof block.id === "string" ? block.id : undefined;
      entries.push({
        id: nextEntryId(),
        timestamp: new Date(),
        type: "tool",
        content: `→ ${toolName}`,
        details: extractToolDescription(toolInput) || undefined,
        toolName,
        toolInput,
        toolUseId,
        raw: block,
      });
    } else if (blockType === "tool_result" || blockType === "tool_use_result") {
      toolResults.push(parseToolResult(block) ?? { output: block, raw: block });
    } else if (blockType === "text" && typeof block.text === "string") {
      const text = block.text.trim();
      if (!text) continue;
      entries.push({
        id: nextEntryId(),
        timestamp: new Date(),
        type: "text",
        content: truncate(text, 200),
        fullText: text,
        raw: block,
      });
    }
  }

  return { entries, toolResults };
}

function parseJsonLine(line: string): ParsedLine | null {
  if (!line.trim()) return null;

  const timestamp = new Date();

  try {
    const parsed = JSON.parse(line) as unknown;

    const entries: ActivityEntry[] = [];
    const toolResults: ToolResult[] = [];

    if (isRecord(parsed)) {
      const topLevelToolUse = parseToolUse(parsed);
      if (topLevelToolUse) {
        entries.push({
          id: nextEntryId(),
          timestamp,
          type: "tool",
          content: `→ ${topLevelToolUse.toolName}`,
          details: extractToolDescription(topLevelToolUse.toolInput) || undefined,
          toolName: topLevelToolUse.toolName,
          toolInput: topLevelToolUse.toolInput,
          toolUseId: topLevelToolUse.toolUseId,
          raw: topLevelToolUse.raw,
        });
      }

      const topLevelToolResult = parseToolResult(parsed);
      if (topLevelToolResult) toolResults.push(topLevelToolResult);
    }

    // System init
    if (isRecord(parsed) && parsed.type === "system" && parsed.subtype === "init") {
      const model = typeof parsed.model === "string" ? parsed.model : "unknown";
      entries.push({
        id: nextEntryId(),
        timestamp,
        type: "init",
        content: "Session started",
        details: `Model: ${model}`,
        raw: parsed,
      });
    }

    // Assistant message
    if (
      isRecord(parsed) &&
      parsed.type === "assistant" &&
      isRecord(parsed.message) &&
      Array.isArray(parsed.message.content)
    ) {
      const parsedBlocks = parseMessageContent(parsed.message.content);
      entries.push(...parsedBlocks.entries);
      toolResults.push(...parsedBlocks.toolResults);
    }

    // Result
    if (isRecord(parsed) && parsed.type === "result") {
      const isError = typeof parsed.is_error === "boolean" ? parsed.is_error : false;
      const durationMs = typeof parsed.duration_ms === "number" ? parsed.duration_ms : null;
      const status = isError ? "Error" : "Complete";
      const duration = durationMs ? `${(durationMs / 1000).toFixed(1)}s` : "";
      entries.push({
        id: nextEntryId(),
        timestamp,
        type: isError ? "error" : "result",
        content: `Session ${status.toLowerCase()}`,
        details: duration ? `Duration: ${duration}` : undefined,
        isError,
        raw: parsed,
      });
    }

    if (entries.length || toolResults.length) {
      return { entries, toolResults };
    }
    return null;
  } catch {
    if (line.trim()) {
      return {
        entries: [
          {
            id: nextEntryId(),
            timestamp,
            type: "unknown",
            content: truncate(line.trim(), 100),
            fullText: line.trim(),
            raw: line,
          },
        ],
        toolResults: [],
      };
    }
    return null;
  }
}

export function parseShiftLogLines(lines: string[]): ActivityEntry[] {
  const entries: ActivityEntry[] = [];
  const toolEntriesById = new Map<string, ActivityEntry>();
  const toolEntriesInOrder: ActivityEntry[] = [];
  for (const line of lines) {
    const parsed = parseJsonLine(line);
    if (!parsed) continue;
    for (const entry of parsed.entries) {
      entries.push(entry);
      if (entry.type === "tool") {
        if (entry.toolUseId) toolEntriesById.set(entry.toolUseId, entry);
        toolEntriesInOrder.push(entry);
      }
    }
    for (const result of parsed.toolResults) {
      const target =
        (result.toolUseId && toolEntriesById.get(result.toolUseId)) ??
        toolEntriesInOrder[toolEntriesInOrder.length - 1];
      if (target) {
        const nextOutput =
          target.toolOutput === undefined
            ? result.output
            : Array.isArray(target.toolOutput)
              ? [...target.toolOutput, result.output]
              : [target.toolOutput, result.output];
        target.toolOutput = nextOutput;
        if (result.toolName && !target.toolName) target.toolName = result.toolName;
        if (typeof result.isError === "boolean") target.isError = result.isError;
      } else {
        entries.push({
          id: nextEntryId(),
          timestamp: new Date(),
          type: result.isError ? "error" : "result",
          content: result.toolName ? `← ${result.toolName}` : "Tool result",
          details: "Tool output",
          toolName: result.toolName,
          toolOutput: result.output,
          isError: result.isError,
          raw: result.raw,
        });
      }
    }
  }
  return entries;
}

export function extractCurrentState(entries: ActivityEntry[]): {
  currentTool: string | null;
  recentText: string | null;
  isComplete: boolean;
  hasError: boolean;
} {
  let currentTool: string | null = null;
  let recentText: string | null = null;
  let isComplete = false;
  let hasError = false;

  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (entry.type === "result") {
      isComplete = true;
      hasError = entry.content.includes("error");
    }
    if (entry.type === "tool" && !currentTool) {
      currentTool = entry.content;
    }
    if (entry.type === "text" && !recentText) {
      recentText = entry.content;
    }
    if (currentTool && recentText) break;
  }

  return { currentTool, recentText, isComplete, hasError };
}
