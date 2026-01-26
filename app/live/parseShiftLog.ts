/**
 * Parses Claude CLI stream-json log lines into human-readable activity entries.
 */

export type ActivityEntry = {
  id: string;
  timestamp: Date;
  type: "init" | "tool" | "text" | "result" | "error" | "unknown";
  content: string;
  details?: string;
};

function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 3) + "...";
}

function extractToolDescription(input: Record<string, unknown>): string {
  if (typeof input.description === "string") return input.description;
  if (typeof input.command === "string") return truncate(input.command, 60);
  if (typeof input.file_path === "string") return input.file_path;
  if (typeof input.pattern === "string") return `pattern: ${input.pattern}`;
  if (typeof input.query === "string") return truncate(input.query, 60);
  if (typeof input.url === "string") return truncate(input.url, 60);
  return "";
}

let entryCounter = 0;

function parseJsonLine(line: string): ActivityEntry | null {
  if (!line.trim()) return null;

  const id = `entry-${++entryCounter}`;
  const timestamp = new Date();

  try {
    const parsed = JSON.parse(line);

    // System init
    if (parsed.type === "system" && parsed.subtype === "init") {
      return {
        id,
        timestamp,
        type: "init",
        content: "Session started",
        details: `Model: ${parsed.model ?? "unknown"}`,
      };
    }

    // Assistant message
    if (parsed.type === "assistant" && parsed.message?.content) {
      for (const block of parsed.message.content) {
        if (block.type === "tool_use") {
          const desc = extractToolDescription(block.input);
          return {
            id,
            timestamp,
            type: "tool",
            content: `→ ${block.name}`,
            details: desc || undefined,
          };
        }
        if (block.type === "text" && block.text?.trim()) {
          return {
            id,
            timestamp,
            type: "text",
            content: truncate(block.text.trim(), 200),
          };
        }
      }
    }

    // Result
    if (parsed.type === "result") {
      const status = parsed.is_error ? "Error" : "Complete";
      const duration = parsed.duration_ms
        ? `${(parsed.duration_ms / 1000).toFixed(1)}s`
        : "";
      return {
        id,
        timestamp,
        type: parsed.is_error ? "error" : "result",
        content: `Session ${status.toLowerCase()}`,
        details: duration ? `Duration: ${duration}` : undefined,
      };
    }

    return null;
  } catch {
    if (line.trim()) {
      return {
        id,
        timestamp,
        type: "unknown",
        content: truncate(line.trim(), 100),
      };
    }
    return null;
  }
}

export function parseShiftLogLines(lines: string[]): ActivityEntry[] {
  const entries: ActivityEntry[] = [];
  for (const line of lines) {
    const entry = parseJsonLine(line);
    if (entry) entries.push(entry);
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
