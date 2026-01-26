"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AgentFocus } from "../playground/canvas/useAgentFocus";
import type { ProjectNode, RunStatus, WorkOrderNode } from "../playground/canvas/types";
import { useActiveShift } from "./useActiveShift";
import { useShiftLogTail } from "./useShiftLogTail";
import { parseShiftLogLines, extractCurrentState, type ActivityEntry } from "./parseShiftLog";
import styles from "./live.module.css";

type AgentActivityPanelProps = {
  project: ProjectNode | null;
  focus: AgentFocus | null;
  workOrderNodes: WorkOrderNode[];
  loading: boolean;
  variant?: "panel" | "overlay";
  maxEntries?: number;
};

const DEFAULT_OVERLAY_ENTRIES = 6;

const STATUS_LABELS: Record<RunStatus, string> = {
  queued: "Queued",
  baseline_failed: "Baseline failed",
  building: "Building",
  waiting_for_input: "Waiting for input",
  ai_review: "Reviewing",
  testing: "Testing",
  you_review: "Awaiting review",
  merged: "Merged",
  merge_conflict: "Merge conflict",
  failed: "Failed",
  canceled: "Canceled",
};

function formatTime(value: string | null | undefined): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function resolveActionLabel(
  focus: AgentFocus | null,
  hasActiveShift: boolean
): string {
  if (focus?.status) {
    return STATUS_LABELS[focus.status] ?? focus.status.replace(/_/g, " ");
  }
  if (hasActiveShift) return "Planning";
  return "Idle";
}

const SHELL_TOOL_HINTS = ["bash", "shell", "shell_command", "sh"];

const CODE_KEYWORDS = new Set([
  "const",
  "let",
  "var",
  "function",
  "return",
  "if",
  "else",
  "for",
  "while",
  "class",
  "interface",
  "type",
  "import",
  "export",
  "from",
  "async",
  "await",
  "switch",
  "case",
  "break",
  "continue",
  "try",
  "catch",
  "finally",
  "throw",
  "new",
]);

const CODE_TOKEN_REGEX =
  /(\/\*[\s\S]*?\*\/|\/\/[^\n]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\b(?:const|let|var|function|return|if|else|for|while|class|interface|type|import|export|from|async|await|switch|case|break|continue|try|catch|finally|throw|new)\b|\b(?:true|false|null|undefined)\b|\b-?\d+(?:\.\d+)?(?:[eE][+\-]?\d+)?\b)/g;

const JSON_TOKEN_REGEX =
  /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+\-]?\d+)?)/g;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function tryParseJson(value: string): unknown | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return null;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return null;
  }
}

/**
 * Unescape common escape sequences that may have been double-escaped in logs.
 * Handles \\n -> newline, \\t -> tab, \\r -> carriage return, \\\\ -> backslash.
 */
function unescapeText(value: string): string {
  return value
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, "\t")
    .replace(/\\r/g, "\r")
    .replace(/\\\\/g, "\\");
}

function flattenText(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (!value) return null;
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (const item of value) {
      if (typeof item === "string") {
        parts.push(item);
      } else if (isRecord(item) && typeof item.text === "string") {
        parts.push(item.text);
      }
    }
    return parts.length ? parts.join("") : null;
  }
  if (isRecord(value) && typeof value.text === "string") return value.text;
  return null;
}

function normalizeValue(value: unknown): unknown {
  const flattened = flattenText(value);
  if (flattened !== null) return flattened;
  if (typeof value === "string") {
    const parsed = tryParseJson(value);
    if (parsed !== null) return parsed;
  }
  return value;
}

function formatValueForHighlight(value: unknown): { text: string; isJson: boolean } {
  if (value === null || value === undefined) return { text: "", isJson: false };
  if (typeof value === "string") {
    const parsed = tryParseJson(value);
    if (parsed !== null) {
      return { text: JSON.stringify(parsed, null, 2), isJson: true };
    }
    // Unescape common escape sequences for plain text display
    return { text: unescapeText(value), isJson: false };
  }
  if (typeof value === "object") {
    return { text: JSON.stringify(value, null, 2), isJson: true };
  }
  return { text: String(value), isJson: true };
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function highlightJson(value: string): string {
  const escaped = escapeHtml(value);
  return escaped.replace(JSON_TOKEN_REGEX, (match) => {
    let className = styles.tokenNumber;
    if (match.startsWith("\"")) {
      className = match.endsWith(":") ? styles.tokenKey : styles.tokenString;
    } else if (match === "true" || match === "false") {
      className = styles.tokenBoolean;
    } else if (match === "null") {
      className = styles.tokenNull;
    }
    return `<span class="${className}">${match}</span>`;
  });
}

function highlightCode(value: string): string {
  const escaped = escapeHtml(value);
  return escaped.replace(CODE_TOKEN_REGEX, (match) => {
    if (match.startsWith("//") || match.startsWith("/*")) {
      return `<span class="${styles.tokenComment}">${match}</span>`;
    }
    if (match.startsWith("\"") || match.startsWith("'") || match.startsWith("`")) {
      return `<span class="${styles.tokenString}">${match}</span>`;
    }
    if (match === "true" || match === "false" || match === "undefined") {
      return `<span class="${styles.tokenBoolean}">${match}</span>`;
    }
    if (match === "null") {
      return `<span class="${styles.tokenNull}">${match}</span>`;
    }
    if (CODE_KEYWORDS.has(match)) {
      return `<span class="${styles.tokenKeyword}">${match}</span>`;
    }
    return `<span class="${styles.tokenNumber}">${match}</span>`;
  });
}

function isShellToolName(toolName: string | null | undefined): boolean {
  if (!toolName) return false;
  const normalized = toolName.toLowerCase();
  return SHELL_TOOL_HINTS.some((hint) => normalized.includes(hint));
}

function extractCommand(value: unknown): string | null {
  const normalized = normalizeValue(value);
  if (typeof normalized === "string") return normalized;
  if (!isRecord(normalized)) return null;
  if (typeof normalized.command === "string") return normalized.command;
  if (typeof normalized.cmd === "string") return normalized.cmd;
  if (typeof normalized.script === "string") return normalized.script;
  return null;
}

function extractWorkdir(value: unknown): string | null {
  const normalized = normalizeValue(value);
  if (!isRecord(normalized)) return null;
  if (typeof normalized.cwd === "string") return normalized.cwd;
  if (typeof normalized.workdir === "string") return normalized.workdir;
  if (typeof normalized.directory === "string") return normalized.directory;
  if (typeof normalized.dir === "string") return normalized.dir;
  return null;
}

function extractShellOutput(value: unknown): {
  stdout?: string;
  stderr?: string;
  exitCode?: number | string | null;
} {
  const normalized = normalizeValue(value);
  if (typeof normalized === "string") {
    return { stdout: normalized };
  }
  if (!isRecord(normalized)) {
    const fallback = flattenText(value);
    return fallback ? { stdout: fallback } : {};
  }
  const stdout = typeof normalized.stdout === "string" ? normalized.stdout : undefined;
  const stderr = typeof normalized.stderr === "string" ? normalized.stderr : undefined;
  const exitCode =
    typeof normalized.exit_code === "number"
      ? normalized.exit_code
      : typeof normalized.exitCode === "number"
        ? normalized.exitCode
        : typeof normalized.status === "number"
          ? normalized.status
          : typeof normalized.exit_code === "string"
            ? normalized.exit_code
            : typeof normalized.exitCode === "string"
              ? normalized.exitCode
              : typeof normalized.status === "string"
                ? normalized.status
                : null;
  if (stdout || stderr || exitCode !== null) {
    return { stdout, stderr, exitCode };
  }
  const fallback = flattenText(normalized.content ?? normalized.output ?? normalized.result);
  return fallback ? { stdout: fallback } : {};
}

const ENTRY_TYPE_STYLES: Record<ActivityEntry["type"], { icon: string; color: string }> = {
  init: { icon: "⚡", color: "#6ee7b7" },
  tool: { icon: "→", color: "#60a5fa" },
  text: { icon: "💬", color: "#a9b0c2" },
  result: { icon: "✓", color: "#6ee7b7" },
  error: { icon: "✗", color: "#f87171" },
  unknown: { icon: "•", color: "#6b7280" },
};

function ActivityLogEntry({
  entry,
  onSelect,
}: {
  entry: ActivityEntry;
  onSelect: (entry: ActivityEntry) => void;
}) {
  const style = ENTRY_TYPE_STYLES[entry.type];
  return (
    <button
      type="button"
      className={styles.logEntryButton}
      onClick={() => onSelect(entry)}
      aria-haspopup="dialog"
      aria-label={`View details for ${entry.content}`}
    >
      <div
        style={{
          display: "flex",
          gap: 8,
          padding: "4px 0",
          borderBottom: "1px solid #1f2433",
          fontSize: 12,
          lineHeight: 1.4,
        }}
      >
        <span style={{ color: style.color, flexShrink: 0, width: 16 }}>{style.icon}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ color: style.color, fontWeight: entry.type === "tool" ? 600 : 400 }}>
            {entry.content}
          </div>
          {entry.details && (
            <div style={{ color: "#6b7280", fontSize: 11, marginTop: 2 }}>{entry.details}</div>
          )}
        </div>
      </div>
    </button>
  );
}

function HighlightedBlock({
  value,
  className,
}: {
  value: unknown;
  className?: string;
}) {
  const normalized = normalizeValue(value);
  const { text, isJson } = formatValueForHighlight(normalized);
  if (!text) {
    return <div className={styles.emptyState}>(empty)</div>;
  }
  const html = isJson ? highlightJson(text) : highlightCode(text);
  const combinedClassName = className
    ? `${styles.codeBlock} ${className}`
    : styles.codeBlock;
  return (
    <pre className={combinedClassName}>
      <code dangerouslySetInnerHTML={{ __html: html }} />
    </pre>
  );
}

export function AgentActivityPanel({
  project,
  focus,
  workOrderNodes,
  loading,
  variant = "panel",
  maxEntries = DEFAULT_OVERLAY_ENTRIES,
}: AgentActivityPanelProps) {
  const isOverlay = variant === "overlay";
  const projectId = project?.id ?? null;
  const { shift, loading: shiftLoading, error: shiftError } = useActiveShift(projectId);
  const shiftId = shift?.id ?? null;
  const {
    data: logTail,
    loading: logLoading,
    error: logError,
    lastUpdated,
  } = useShiftLogTail(projectId, shiftId, { lines: 120, intervalMs: 2000 });
  const logRef = useRef<HTMLDivElement | null>(null);
  const [selectedEntry, setSelectedEntry] = useState<ActivityEntry | null>(null);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const closeModal = useCallback(() => setSelectedEntry(null), []);
  const toggleCollapsed = useCallback(() => setIsCollapsed((prev) => !prev), []);

  const activeWorkOrderId =
    focus?.kind === "work_order" && (focus.source === "active_run" || focus.source === "log")
      ? focus.workOrderId ?? null
      : null;
  const lastFocusWorkOrderId =
    activeWorkOrderId ?? (focus?.kind === "work_order" ? focus.workOrderId ?? null : null);
  const workOrderIdToShow = lastFocusWorkOrderId;
  const workOrderLabel = activeWorkOrderId ? "Work order" : "Last focus";

  const activeWorkOrder = useMemo(() => {
    if (!projectId || !workOrderIdToShow) return null;
    return (
      workOrderNodes.find(
        (node) => node.projectId === projectId && node.workOrderId === workOrderIdToShow
      ) ?? null
    );
  }, [projectId, workOrderIdToShow, workOrderNodes]);

  const hasActiveShift = Boolean(shiftId);
  const focusUpdated = formatTime(focus?.updatedAt);
  const shiftStarted = formatTime(shift?.started_at);
  const logUpdated = lastUpdated ? lastUpdated.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : null;
  const logLines = logTail?.lines ?? [];

  // Parse stream-json log lines into structured activity entries
  const activityEntries = useMemo(() => parseShiftLogLines(logLines), [logLines]);
  const currentState = useMemo(() => extractCurrentState(activityEntries), [activityEntries]);
  const activityEntriesToShow = useMemo(() => {
    if (!isOverlay) return activityEntries;
    if (activityEntries.length <= maxEntries) return activityEntries;
    return activityEntries.slice(-maxEntries);
  }, [activityEntries, isOverlay, maxEntries]);
  const hiddenEntryCount = isOverlay
    ? Math.max(activityEntries.length - activityEntriesToShow.length, 0)
    : 0;

  // Derive action label from parsed logs or fall back to focus/shift status
  const actionLabel = useMemo(() => {
    if (currentState.currentTool) {
      return currentState.currentTool.replace("→ ", "");
    }
    return resolveActionLabel(focus, hasActiveShift);
  }, [currentState.currentTool, focus, hasActiveShift]);

  const showLogError = Boolean(logError) && !logLines.length;

  useEffect(() => {
    const el = logRef.current;
    if (!el) return;
    if (isOverlay) {
      if (isCollapsed) return;
      el.scrollTop = el.scrollHeight;
      return;
    }
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (distanceFromBottom < 40) {
      el.scrollTop = el.scrollHeight;
    }
  }, [activityEntriesToShow, isCollapsed, isOverlay]);

  useEffect(() => {
    if (!selectedEntry) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSelectedEntry(null);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedEntry]);

  const activityModal = selectedEntry ? (
    <div className={styles.activityModalOverlay} onClick={closeModal}>
      <div
        className={styles.activityModalCard}
        role="dialog"
        aria-modal="true"
        onClick={(event) => event.stopPropagation()}
      >
        <div className={styles.activityModalHeader}>
          <div>
            <div className={styles.activityModalTitle}>Activity detail</div>
            <div className={styles.activityModalSubtitle}>{selectedEntry.content}</div>
            {selectedEntry.details && (
              <div className={styles.activityModalMeta}>{selectedEntry.details}</div>
            )}
          </div>
          <button
            type="button"
            className={styles.activityModalClose}
            onClick={closeModal}
            aria-label="Close activity detail"
          >
            X
          </button>
        </div>

        <div className={styles.activityModalBody}>
          <div className={styles.activityModalMetaRow}>
            <span className="badge">{selectedEntry.type}</span>
            {selectedEntry.timestamp && (
              <span className="muted">
                {selectedEntry.timestamp.toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                  second: "2-digit",
                })}
              </span>
            )}
          </div>

          {selectedEntry.type === "tool"
            ? (() => {
                const toolName =
                  (selectedEntry.toolName ??
                  selectedEntry.content.replace("→ ", "").trim()) ||
                  "Tool";
                const isShellTool = isShellToolName(toolName);
                const command = extractCommand(selectedEntry.toolInput);
                const workdir = extractWorkdir(selectedEntry.toolInput);
                const shellOutput = extractShellOutput(selectedEntry.toolOutput);
                const normalizedInput = normalizeValue(selectedEntry.toolInput);
                const inputRecord = isRecord(normalizedInput) ? normalizedInput : null;
                const hasExtraInput = inputRecord
                  ? Object.keys(inputRecord).some(
                      (key) => key !== "command" && key !== "cmd" && key !== "script"
                    )
                  : false;
                const hasShellOutput =
                  Boolean(shellOutput.stdout?.trim()) ||
                  Boolean(shellOutput.stderr?.trim()) ||
                  (shellOutput.exitCode !== null && shellOutput.exitCode !== undefined);

                return (
                  <>
                    <div className={styles.activityDetailSection}>
                      <div className={styles.detailLabel}>Tool</div>
                      <div className={styles.activityDetailValue}>{toolName}</div>
                    </div>

                    <div className={styles.activityDetailSection}>
                      <div className={styles.detailLabel}>Input</div>
                      {isShellTool ? (
                        <div className={styles.activityDetailStack}>
                          <div className={styles.detailSubLabel}>Command</div>
                          <HighlightedBlock value={command ?? ""} />
                          {workdir && (
                            <div className={styles.activityInlineMeta}>
                              Working dir: <span className={styles.monoText}>{workdir}</span>
                            </div>
                          )}
                          {hasExtraInput && <div className={styles.detailSubLabel}>Full input</div>}
                          {hasExtraInput && <HighlightedBlock value={selectedEntry.toolInput} />}
                        </div>
                      ) : (
                        <HighlightedBlock value={selectedEntry.toolInput} />
                      )}
                    </div>

                    <div className={styles.activityDetailSection}>
                      <div className={styles.detailLabel}>Output</div>
                      {isShellTool ? (
                        <div className={styles.activityDetailStack}>
                          {shellOutput.exitCode !== null && shellOutput.exitCode !== undefined && (
                            <div className={styles.activityInlineMeta}>
                              Exit code:{" "}
                              <span className={styles.monoText}>{shellOutput.exitCode}</span>
                            </div>
                          )}
                          <div className={styles.detailSubLabel}>Stdout</div>
                          <HighlightedBlock
                            value={shellOutput.stdout ?? ""}
                            className={styles.stdoutBlock}
                          />
                          <div className={styles.detailSubLabel}>Stderr</div>
                          <HighlightedBlock
                            value={shellOutput.stderr ?? ""}
                            className={styles.stderrBlock}
                          />
                          {!hasShellOutput && <HighlightedBlock value={selectedEntry.toolOutput} />}
                        </div>
                      ) : (
                        <HighlightedBlock value={selectedEntry.toolOutput} />
                      )}
                    </div>
                  </>
                );
              })()
            : (
              <div className={styles.activityDetailSection}>
                <div className={styles.detailLabel}>Details</div>
                <HighlightedBlock
                  value={
                    selectedEntry.fullText ??
                    selectedEntry.details ??
                    selectedEntry.raw ??
                    selectedEntry.content
                  }
                />
              </div>
            )}
        </div>
      </div>
    </div>
  ) : null;

  if (loading) {
    if (isOverlay) {
      return (
        <div className={styles.activityOverlay}>
          <div className={styles.activityOverlayHeader}>
            <div>
              <div className={styles.activityOverlayTitle}>Agent activity</div>
              <div className={styles.activityOverlaySubtitle}>Loading live context...</div>
            </div>
          </div>
        </div>
      );
    }
    return (
      <section className={`card ${styles.activityCard}`}>
        <div className={styles.activityHeader}>
          <div>
            <div className={styles.activityTitle}>Agent activity</div>
            <div className="muted" style={{ fontSize: 12 }}>
              Loading live context...
            </div>
          </div>
        </div>
      </section>
    );
  }

  if (!project) {
    if (isOverlay) {
      return (
        <div className={styles.activityOverlay}>
          <div className={styles.activityOverlayHeader}>
            <div>
              <div className={styles.activityOverlayTitle}>Agent activity</div>
              <div className={styles.activityOverlaySubtitle}>Project data unavailable.</div>
            </div>
          </div>
        </div>
      );
    }
    return (
      <section className={`card ${styles.activityCard}`}>
        <div className={styles.activityHeader}>
          <div>
            <div className={styles.activityTitle}>Agent activity</div>
            <div className="muted" style={{ fontSize: 12 }}>
              Project data unavailable.
            </div>
          </div>
        </div>
      </section>
    );
  }

  if (isOverlay) {
    return (
      <div className={styles.activityOverlay}>
        <div className={styles.activityOverlayHeader}>
          <div>
            <div className={styles.activityOverlayTitle}>Agent activity</div>
            <div className={styles.activityOverlaySubtitle}>
              {hasActiveShift ? `Now ${actionLabel}` : "Idle"}
            </div>
          </div>
          <button
            type="button"
            className={styles.activityOverlayToggle}
            onClick={toggleCollapsed}
            aria-expanded={!isCollapsed}
            aria-label={isCollapsed ? "Expand activity log" : "Collapse activity log"}
          >
            {isCollapsed ? "Expand" : "Collapse"}
          </button>
        </div>

        {!isCollapsed && (
          <>
            <div className={styles.activityOverlayMeta}>
              <span className="badge">{hasActiveShift ? "Active shift" : "Idle"}</span>
              <span className={styles.activityOverlayStatus}>
                {logLoading && !logLines.length ? "Loading..." : "Live"}
                {currentState.isComplete && " • Complete"}
                {currentState.hasError && " • Error"}
              </span>
            </div>

            <div className={styles.activityOverlayLog} ref={logRef}>
              {showLogError ? (
                <div className={styles.activityOverlayEmpty}>{logError}</div>
              ) : activityEntriesToShow.length > 0 ? (
                <div style={{ display: "flex", flexDirection: "column" }}>
                  {activityEntriesToShow.map((entry) => (
                    <ActivityLogEntry key={entry.id} entry={entry} onSelect={setSelectedEntry} />
                  ))}
                </div>
              ) : (
                <div className={styles.activityOverlayEmpty}>
                  {hasActiveShift ? "(waiting for activity...)" : "No active shift."}
                </div>
              )}
            </div>

            <div className={styles.activityOverlayFooter}>
              <div>
                {activityEntriesToShow.length > 0
                  ? hiddenEntryCount > 0
                    ? `Last ${activityEntriesToShow.length} of ${activityEntries.length}`
                    : `${activityEntriesToShow.length} events`
                  : logTail?.has_more
                    ? "Showing latest"
                    : ""}
              </div>
              {logUpdated && <div>Updated {logUpdated}</div>}
            </div>
          </>
        )}

        {activityModal}
      </div>
    );
  }

  return (
    <section className={`card ${styles.activityCard}`}>
      <div className={styles.activityHeader}>
        <div>
          <div className={styles.activityTitle}>Agent activity</div>
          <div className="muted" style={{ fontSize: 12 }}>
            Live shift focus and log stream.
          </div>
        </div>
        <span className="badge">{hasActiveShift ? "Active shift" : "No active shift"}</span>
      </div>

      <div className={styles.activityMeta}>
        <div className={styles.activityItem}>
          <div className={styles.activityLabel}>Current action</div>
          <div className={styles.activityValue}>
            <span className="badge">{actionLabel}</span>
          </div>
          {focusUpdated && (
            <div className="muted" style={{ fontSize: 12 }}>
              Updated {focusUpdated}
            </div>
          )}
        </div>

        <div className={styles.activityItem}>
          <div className={styles.activityLabel}>{workOrderLabel}</div>
          {workOrderIdToShow ? (
            <>
              <Link
                href={`/projects/${encodeURIComponent(project.id)}/work-orders/${encodeURIComponent(
                  workOrderIdToShow
                )}`}
                className={styles.activityValue}
              >
                {workOrderIdToShow}
              </Link>
              {activeWorkOrder?.title && (
                <div className="muted" style={{ fontSize: 12 }}>
                  {activeWorkOrder.title}
                </div>
              )}
            </>
          ) : (
            <div className="muted" style={{ fontSize: 12 }}>
              No active work order.
            </div>
          )}
        </div>

        <div className={styles.activityItem}>
          <div className={styles.activityLabel}>Shift status</div>
          {shiftLoading && !shift && <div className="muted">Loading shift...</div>}
          {!shiftLoading && shiftError && !shift && (
            <div className="muted" style={{ fontSize: 12 }}>
              {shiftError}
            </div>
          )}
          {!shiftLoading && (!shiftError || shift) && (
            <div className={styles.activityValue}>
              {hasActiveShift ? "Active" : "Idle"}
            </div>
          )}
          {shiftStarted && (
            <div className="muted" style={{ fontSize: 12 }}>
              Started {shiftStarted}
            </div>
          )}
        </div>
      </div>

      <div className={styles.logPanel}>
        <div className={styles.logHeader}>
          <div style={{ fontWeight: 600 }}>Agent activity</div>
          <div className="muted" style={{ fontSize: 12 }}>
            {logLoading && !logLines.length ? "Loading..." : "Live"}
            {currentState.isComplete && " • Complete"}
            {currentState.hasError && " • Error"}
          </div>
        </div>

        <div className={styles.logScroller} ref={logRef}>
          {showLogError ? (
            <pre className={styles.logText}>{logError}</pre>
          ) : activityEntries.length > 0 ? (
            <div style={{ display: "flex", flexDirection: "column" }}>
              {activityEntries.map((entry) => (
                <ActivityLogEntry key={entry.id} entry={entry} onSelect={setSelectedEntry} />
              ))}
            </div>
          ) : (
            <pre className={styles.logText}>
              {hasActiveShift ? "(waiting for activity...)" : "No active shift."}
            </pre>
          )}
        </div>

        <div className={styles.logMeta}>
          <div>
            {activityEntries.length > 0
              ? `${activityEntries.length} events`
              : logTail?.has_more
                ? "Showing latest"
                : ""}
          </div>
          {logUpdated && <div>Updated {logUpdated}</div>}
        </div>
      </div>

      {activityModal}
    </section>
  );
}
