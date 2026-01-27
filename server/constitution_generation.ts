import { spawn } from "child_process";
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { z } from "zod";
import { getCodexCliPath, getProcessEnv } from "./config.js";
import { findProjectById, getDb } from "./db.js";
import { ensurePortfolioWorkspace } from "./portfolio_workspace.js";
import {
  CONSTITUTION_TEMPLATE,
  mergeConstitutionWithInsights,
  readGlobalConstitution,
  readGlobalConstitutionGenerationMeta,
  readProjectConstitution,
  readProjectConstitutionGenerationMeta,
  writeGlobalConstitutionGenerationMeta,
  writeProjectConstitutionGenerationMeta,
  type ConstitutionGenerationMeta,
  type ConstitutionInsightCategory,
  type ConstitutionInsightInput,
} from "./constitution.js";
import { resolveChatSettings } from "./settings.js";

type ConstitutionSourceId = "claude" | "codex" | "pcc";

export type ConstitutionSourceSelection = {
  claude: boolean;
  codex: boolean;
  pcc: boolean;
};

export type ConstitutionDateRange = {
  start?: string | null;
  end?: string | null;
};

export type ConstitutionSourceStats = {
  source: ConstitutionSourceId;
  available: number;
  analyzed: number;
  sampled: boolean;
  error?: string;
};

export type ConstitutionInsight = ConstitutionInsightInput & {
  id: string;
  confidence: "high" | "medium" | "low";
  evidence_count: number;
};

export type ConstitutionAnalysisStats = {
  conversations_available: number;
  conversations_analyzed: number;
  patterns_found: number;
  preferences_found: number;
  anti_patterns_found: number;
};

export type ConstitutionAnalysisResult = {
  insights: ConstitutionInsight[];
  stats: ConstitutionAnalysisStats;
  sources: ConstitutionSourceStats[];
  warnings: string[];
  fallback: boolean;
};

export type ConstitutionDraftResult = {
  draft: string;
  warnings: string[];
  used_ai: boolean;
};

export type ConstitutionSourcesResult = {
  sources: ConstitutionSourceStats[];
  meta: ConstitutionGenerationMeta;
  warnings: string[];
};

type DateRangeNormalized = {
  startMs: number | null;
  endMs: number | null;
};

type ConversationRecord = {
  source: ConstitutionSourceId;
  id: string;
  timestamp: string | null;
  text: string;
};

type SourceLoadResult = {
  available: number;
  conversations: ConversationRecord[];
  error?: string;
  sampled: boolean;
  warnings: string[];
};

type ProjectMatcher = {
  repoPath: string;
  repoName: string;
};

const CLAUDE_HISTORY_PATH = path.join(os.homedir(), ".claude", "history.jsonl");
const CODEX_SESSIONS_DIR = path.join(os.homedir(), ".codex", "sessions");
const CODEX_HISTORY_PATH = path.join(os.homedir(), ".codex", "history.jsonl");

const DEFAULT_MAX_CONVERSATIONS = 160;
const MAX_CONVERSATION_CHARS = 2000;
const MAX_PROMPT_CHARS = 140_000;

const INSIGHT_CATEGORIES = ["decision", "style", "anti", "success", "communication"] as const;

const AnalysisResponseSchema = z
  .object({
    insights: z.array(
      z
        .object({
          category: z.enum(INSIGHT_CATEGORIES),
          text: z.string().min(1),
          confidence: z.enum(["high", "medium", "low"]),
          evidence_count: z.number().int().min(1),
        })
        .strict()
    ),
  })
  .strict();

const DraftResponseSchema = z
  .object({
    markdown: z.string().min(1),
  })
  .strict();

function analysisJsonSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["insights"],
    properties: {
      insights: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["category", "text", "confidence", "evidence_count"],
          properties: {
            category: { type: "string", enum: INSIGHT_CATEGORIES },
            text: { type: "string" },
            confidence: { type: "string", enum: ["high", "medium", "low"] },
            evidence_count: { type: "integer", minimum: 1 },
          },
        },
      },
    },
  };
}

function draftJsonSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["markdown"],
    properties: {
      markdown: { type: "string" },
    },
  };
}

function nowIso(): string {
  return new Date().toISOString();
}

function ensureDir(dir: string): void {
  if (fs.existsSync(dir)) return;
  fs.mkdirSync(dir, { recursive: true });
}

function normalizeDateRange(range?: ConstitutionDateRange | null): DateRangeNormalized {
  const startRaw = range?.start ?? null;
  const endRaw = range?.end ?? null;
  const startMs =
    typeof startRaw === "string" && startRaw.trim()
      ? Date.parse(startRaw)
      : null;
  const endMs =
    typeof endRaw === "string" && endRaw.trim() ? Date.parse(endRaw) : null;
  return {
    startMs: Number.isFinite(startMs ?? NaN) ? startMs : null,
    endMs: Number.isFinite(endMs ?? NaN) ? endMs : null,
  };
}

function normalizeProjectName(value: string): string {
  const trimmed = value.trim().toLowerCase();
  return trimmed.endsWith(".git") ? trimmed.slice(0, -4) : trimmed;
}

function looksLikePath(value: string): boolean {
  return value.startsWith("~") || value.includes("/") || value.includes("\\");
}

function normalizeFilesystemPath(value: string): string {
  const resolved = path.resolve(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function normalizeCandidatePath(value: string): string | null {
  if (!looksLikePath(value)) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const expanded = trimmed.startsWith("~") ? path.join(os.homedir(), trimmed.slice(1)) : trimmed;
  const absolute = path.isAbsolute(expanded)
    ? expanded
    : path.join(os.homedir(), expanded);
  return normalizeFilesystemPath(absolute);
}

function buildProjectMatcher(repoPath: string): ProjectMatcher {
  const normalized = normalizeFilesystemPath(repoPath);
  return {
    repoPath: normalized,
    repoName: normalizeProjectName(path.basename(normalized)),
  };
}

function isPathWithin(candidate: string, root: string): boolean {
  if (candidate === root) return true;
  const prefix = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
  return candidate.startsWith(prefix);
}

function matchesProjectValue(value: string | null, matcher: ProjectMatcher): boolean {
  if (!value) return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (looksLikePath(trimmed)) {
    const normalized = normalizeCandidatePath(trimmed);
    if (!normalized) return false;
    return isPathWithin(normalized, matcher.repoPath);
  }
  return normalizeProjectName(trimmed) === matcher.repoName;
}

function normalizeNewlines(value: string): string {
  return value.replace(/\r\n?/g, "\n");
}

function normalizeLine(line: string): string {
  return line.trim().replace(/\s+/g, " ");
}

function normalizeHeadingLine(line: string): string {
  return normalizeLine(line.replace(/^#+\s*/, ""));
}

function extractBulletText(line: string): string | null {
  const match = /^[-*]\s+(.*)$/.exec(line.trim());
  if (!match) return null;
  const text = match[1]?.trim();
  return text ? text : null;
}

function collectDraftTokens(content: string): {
  headings: Set<string>;
  bullets: Set<string>;
  lines: Set<string>;
} {
  const headings = new Set<string>();
  const bullets = new Set<string>();
  const lines = new Set<string>();

  for (const line of normalizeNewlines(content).split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith("#")) {
      headings.add(normalizeHeadingLine(trimmed));
      continue;
    }
    const bulletText = extractBulletText(trimmed);
    if (bulletText) {
      bullets.add(normalizeLine(bulletText));
      continue;
    }
    lines.add(normalizeLine(trimmed));
  }

  return { headings, bullets, lines };
}

export function draftPreservesBase(params: { base: string; draft: string }): boolean {
  const tokens = collectDraftTokens(params.draft);
  for (const line of normalizeNewlines(params.base).split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith("#")) {
      if (!tokens.headings.has(normalizeHeadingLine(trimmed))) return false;
      continue;
    }
    const bulletText = extractBulletText(trimmed);
    if (bulletText) {
      if (!tokens.bullets.has(normalizeLine(bulletText))) return false;
      continue;
    }
    if (!tokens.lines.has(normalizeLine(trimmed))) return false;
  }
  return true;
}

function inRange(timestamp: string | null, range: DateRangeNormalized): boolean {
  if (!range.startMs && !range.endMs) return true;
  if (!timestamp) return false;
  const parsed = Date.parse(timestamp);
  if (!Number.isFinite(parsed)) return false;
  if (range.startMs && parsed < range.startMs) return false;
  if (range.endMs && parsed > range.endMs) return false;
  return true;
}

function truncateText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 3))}...`;
}

function compareByTimestampDesc(a: ConversationRecord, b: ConversationRecord): number {
  const aMs = a.timestamp ? Date.parse(a.timestamp) : 0;
  const bMs = b.timestamp ? Date.parse(b.timestamp) : 0;
  if (Number.isFinite(aMs) && Number.isFinite(bMs)) return bMs - aMs;
  if (Number.isFinite(aMs)) return -1;
  if (Number.isFinite(bMs)) return 1;
  return 0;
}

function sampleConversations(
  conversations: ConversationRecord[],
  maxConversations: number
): { selected: ConversationRecord[]; sampled: boolean } {
  if (conversations.length <= maxConversations) {
    return { selected: conversations, sampled: false };
  }
  const sorted = [...conversations].sort(compareByTimestampDesc);
  return { selected: sorted.slice(0, maxConversations), sampled: true };
}

function sanitizeSelection(selection: unknown): ConstitutionSourceSelection {
  const record =
    selection && typeof selection === "object" ? (selection as Record<string, unknown>) : {};
  return {
    claude: record.claude === true,
    codex: record.codex === true,
    pcc: record.pcc === true,
  };
}

function buildConversationPrompt(conversations: ConversationRecord[]): string {
  const header = [
    "Analyze these chat conversations and extract:",
    "",
    "1. Style Preferences: How does the user prefer code to be written?",
    "2. Decision Patterns: How does the user make technical decisions?",
    "3. Anti-Patterns: What has the user corrected or complained about?",
    "4. Success Patterns: What approaches did the user praise or accept quickly?",
    "5. Communication Style: How does the user prefer to interact?",
    "",
    "For each insight, provide:",
    "- The pattern/preference (one sentence)",
    "- Confidence level (high/medium/low)",
    "- Evidence count (how many conversations support this)",
    "",
    "Format the output as JSON matching the provided schema.",
    "",
    "Conversations:",
  ].join("\n");

  const bodies: string[] = [];
  for (const [index, convo] of conversations.entries()) {
    const source = convo.source.toUpperCase();
    const stamp = convo.timestamp ? ` (${convo.timestamp})` : "";
    const body = truncateText(convo.text.trim(), MAX_CONVERSATION_CHARS);
    if (!body) continue;
    bodies.push(`--- Conversation ${index + 1}: ${source}${stamp} ---\n${body}`);
  }

  const combined = `${header}\n\n${bodies.join("\n\n")}`.trim();
  if (combined.length <= MAX_PROMPT_CHARS) return combined;
  return truncateText(combined, MAX_PROMPT_CHARS);
}

function extractClaudeConversation(
  record: Record<string, unknown>
): { timestamp: string | null; text: string; project: string | null } | null {
  const display = typeof record.display === "string" ? record.display.trim() : "";
  const pasted = typeof record.pastedContents === "string" ? record.pastedContents.trim() : "";
  const timestamp =
    typeof record.timestamp === "string"
      ? record.timestamp
      : typeof record.timestamp === "number"
        ? new Date(record.timestamp).toISOString()
        : null;
  const project =
    typeof record.project === "string" && record.project.trim()
      ? record.project.trim()
      : null;
  const text = [display, pasted].filter(Boolean).join("\n");
  if (!text) return null;
  return { timestamp, text, project };
}

function listClaudeConversations(
  range: DateRangeNormalized,
  maxConversations: number,
  deadlineMs: number,
  projectMatcher?: ProjectMatcher | null
): SourceLoadResult {
  if (!fs.existsSync(CLAUDE_HISTORY_PATH)) {
    return {
      available: 0,
      conversations: [],
      sampled: false,
      error: "Claude history file not found.",
      warnings: [],
    };
  }

  let raw = "";
  try {
    raw = fs.readFileSync(CLAUDE_HISTORY_PATH, "utf8");
  } catch {
    return {
      available: 0,
      conversations: [],
      sampled: false,
      error: "Failed to read Claude history file.",
      warnings: [],
    };
  }

  const lines = raw.split(/\r?\n/).filter(Boolean);
  let available = 0;
  const conversations: ConversationRecord[] = [];
  let sampled = false;
  const warnings: string[] = [];
  let rangeCount = 0;
  let projectTagged = 0;

  for (const [index, line] of lines.entries()) {
    if (Date.now() > deadlineMs) {
      warnings.push("Claude history parsing timed out; sample may be incomplete.");
      sampled = true;
      break;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (!parsed || typeof parsed !== "object") continue;
    const convo = extractClaudeConversation(parsed as Record<string, unknown>);
    if (!convo || !inRange(convo.timestamp, range)) continue;
    rangeCount += 1;
    if (projectMatcher) {
      if (convo.project) {
        projectTagged += 1;
        if (!matchesProjectValue(convo.project, projectMatcher)) {
          continue;
        }
      } else {
        continue;
      }
    }
    available += 1;
    if (conversations.length < maxConversations) {
      conversations.push({
        source: "claude",
        id: `claude-${index}`,
        timestamp: convo.timestamp,
        text: convo.text,
      });
    } else {
      sampled = true;
    }
  }

  if (projectMatcher && rangeCount > 0 && projectTagged === 0) {
    return {
      available: 0,
      conversations: [],
      sampled: false,
      error: "Claude project metadata not found.",
      warnings: [
        ...warnings,
        "Claude history lacks project metadata; project-scoped Claude analysis is unavailable.",
      ],
    };
  }

  return { available, conversations, sampled, warnings };
}

function listDirSafe(dir: string): fs.Dirent[] {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

type SessionFile = {
  path: string;
  timestamp: string | null;
  timestampMs: number | null;
};

function parseSessionDate(year: string, month: string, day: string): Date | null {
  if (!/^\d{4}$/.test(year) || !/^\d{2}$/.test(month) || !/^\d{2}$/.test(day)) return null;
  const y = Number(year);
  const m = Number(month);
  const d = Number(day);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;
  return new Date(Date.UTC(y, m - 1, d, 0, 0, 0));
}

function dayOverlapsRange(date: Date, range: DateRangeNormalized): boolean {
  if (!range.startMs && !range.endMs) return true;
  const dayStart = date.getTime();
  const dayEnd = dayStart + 24 * 60 * 60 * 1000 - 1;
  if (range.startMs && dayEnd < range.startMs) return false;
  if (range.endMs && dayStart > range.endMs) return false;
  return true;
}

function resolveSessionTimestamp(
  filePath: string,
  fallbackDate: Date
): { timestamp: string | null; timestampMs: number | null } {
  let timestampMs = fallbackDate.getTime();
  try {
    const stat = fs.statSync(filePath);
    if (Number.isFinite(stat.mtimeMs)) {
      timestampMs = stat.mtimeMs;
    }
  } catch {
    // best-effort fallback to date-only timestamp
  }
  if (!Number.isFinite(timestampMs)) {
    return { timestamp: null, timestampMs: null };
  }
  return { timestamp: new Date(timestampMs).toISOString(), timestampMs };
}

function listCodexSessionFiles(
  range: DateRangeNormalized,
  deadlineMs: number
): { files: SessionFile[]; error?: string; warnings: string[] } {
  if (!fs.existsSync(CODEX_SESSIONS_DIR)) {
    return { files: [], error: "Codex sessions folder not found.", warnings: [] };
  }

  const files: SessionFile[] = [];
  const warnings: string[] = [];
  const yearEntries = listDirSafe(CODEX_SESSIONS_DIR).filter((entry) => entry.isDirectory());

  for (const year of yearEntries) {
    if (Date.now() > deadlineMs) {
      warnings.push("Codex session scan timed out; sample may be incomplete.");
      break;
    }
    if (!/^\d{4}$/.test(year.name)) continue;
    const yearDir = path.join(CODEX_SESSIONS_DIR, year.name);
    const monthEntries = listDirSafe(yearDir).filter((entry) => entry.isDirectory());
    for (const month of monthEntries) {
      if (Date.now() > deadlineMs) {
        warnings.push("Codex session scan timed out; sample may be incomplete.");
        break;
      }
      if (!/^\d{2}$/.test(month.name)) continue;
      const monthDir = path.join(yearDir, month.name);
      const dayEntries = listDirSafe(monthDir).filter((entry) => entry.isDirectory());
      for (const day of dayEntries) {
        if (Date.now() > deadlineMs) {
          warnings.push("Codex session scan timed out; sample may be incomplete.");
          break;
        }
        if (!/^\d{2}$/.test(day.name)) continue;
        const date = parseSessionDate(year.name, month.name, day.name);
        if (!date) continue;
        if (!dayOverlapsRange(date, range)) continue;
        const dayDir = path.join(monthDir, day.name);
        const sessionFiles = listDirSafe(dayDir).filter((entry) => entry.isFile());
        for (const file of sessionFiles) {
          if (!file.name.endsWith(".jsonl")) continue;
          const filePath = path.join(dayDir, file.name);
          const { timestamp, timestampMs } = resolveSessionTimestamp(filePath, date);
          if (!inRange(timestamp, range)) continue;
          files.push({
            path: filePath,
            timestamp,
            timestampMs,
          });
        }
      }
    }
  }

  files.sort((a, b) => (b.timestampMs ?? 0) - (a.timestampMs ?? 0));
  return { files, warnings };
}

function readStringField(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function normalizeSessionPath(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const expanded = trimmed.startsWith("~") ? path.join(os.homedir(), trimmed.slice(1)) : trimmed;
  const absolute = path.isAbsolute(expanded) ? expanded : path.join(CODEX_SESSIONS_DIR, expanded);
  return normalizeFilesystemPath(absolute);
}

function extractCodexSessionPathFromRecord(record: Record<string, unknown>): string | null {
  const keys = [
    "path",
    "session_path",
    "sessionPath",
    "file_path",
    "filePath",
    "session_file",
    "sessionFile",
    "log_path",
    "logPath",
  ];
  for (const key of keys) {
    const raw = readStringField(record, key);
    if (raw && raw.endsWith(".jsonl")) {
      return normalizeSessionPath(raw);
    }
  }
  if (record.session && typeof record.session === "object") {
    return extractCodexSessionPathFromRecord(record.session as Record<string, unknown>);
  }
  return null;
}

function extractRepoHintFromContainer(record: Record<string, unknown>): string | null {
  if (record.git && typeof record.git === "object") {
    const git = record.git as Record<string, unknown>;
    const gitKeys = ["root", "path", "repo", "repo_path", "repoPath", "workdir", "cwd"];
    for (const key of gitKeys) {
      const value = readStringField(git, key);
      if (value) return value;
    }
  }
  if (record.repo && typeof record.repo === "object") {
    const repo = record.repo as Record<string, unknown>;
    const repoKeys = ["path", "root", "repo", "repo_path", "repoPath", "cwd"];
    for (const key of repoKeys) {
      const value = readStringField(repo, key);
      if (value) return value;
    }
  }
  const keys = [
    "repo",
    "repo_path",
    "repoPath",
    "project",
    "project_path",
    "projectPath",
    "root",
    "cwd",
    "workdir",
    "workspace",
  ];
  for (const key of keys) {
    const value = readStringField(record, key);
    if (value) return value;
  }
  return null;
}

function extractCodexRepoHintFromRecord(record: Record<string, unknown>, depth = 0): string | null {
  if (depth > 2) return null;
  const direct = extractRepoHintFromContainer(record);
  if (direct) return direct;
  const nestedKeys = ["session_meta", "session", "meta", "metadata", "context", "info", "item"];
  for (const key of nestedKeys) {
    const nested = record[key];
    if (nested && typeof nested === "object") {
      const match = extractCodexRepoHintFromRecord(nested as Record<string, unknown>, depth + 1);
      if (match) return match;
    }
  }
  return null;
}

function loadCodexHistoryIndex(
  sessionPaths: Set<string>,
  deadlineMs: number
): { byPath: Map<string, string>; warnings: string[] } {
  const warnings: string[] = [];
  const byPath = new Map<string, string>();
  if (!fs.existsSync(CODEX_HISTORY_PATH)) {
    return { byPath, warnings };
  }
  let raw = "";
  try {
    raw = fs.readFileSync(CODEX_HISTORY_PATH, "utf8");
  } catch {
    warnings.push("Failed to read Codex history file.");
    return { byPath, warnings };
  }
  const lines = raw.split(/\r?\n/).filter(Boolean);
  for (const line of lines) {
    if (Date.now() > deadlineMs) {
      warnings.push("Codex history parsing timed out; session map may be incomplete.");
      break;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (!parsed || typeof parsed !== "object") continue;
    const record = parsed as Record<string, unknown>;
    const sessionPath = extractCodexSessionPathFromRecord(record);
    if (!sessionPath || (sessionPaths.size > 0 && !sessionPaths.has(sessionPath))) continue;
    const repoHint = extractCodexRepoHintFromRecord(record);
    if (!repoHint) continue;
    byPath.set(sessionPath, repoHint);
  }
  return { byPath, warnings };
}

function extractCodexRepoHintFromSessionFile(
  filePath: string,
  deadlineMs: number
): { hint: string | null; timedOut: boolean } {
  let raw = "";
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch {
    return { hint: null, timedOut: false };
  }

  const lines = raw.split(/\r?\n/).filter(Boolean);
  const limit = Math.min(lines.length, 200);
  for (let index = 0; index < limit; index += 1) {
    if (Date.now() > deadlineMs) return { hint: null, timedOut: true };
    let parsed: unknown;
    try {
      parsed = JSON.parse(lines[index] ?? "");
    } catch {
      continue;
    }
    if (!parsed || typeof parsed !== "object") continue;
    const hint = extractCodexRepoHintFromRecord(parsed as Record<string, unknown>);
    if (hint) return { hint, timedOut: false };
  }
  return { hint: null, timedOut: false };
}

function extractTextFromValue(value: unknown, depth = 0): string[] {
  if (!value || depth > 3) return [];
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) {
    return value.flatMap((entry) => extractTextFromValue(entry, depth + 1));
  }
  if (typeof value !== "object") return [];

  const record = value as Record<string, unknown>;
  const parts: string[] = [];
  const directFields = ["text", "input_text", "output_text", "value"];
  for (const field of directFields) {
    const entry = record[field];
    if (typeof entry === "string" && entry.trim()) parts.push(entry.trim());
  }

  if ("content" in record) {
    parts.push(...extractTextFromValue(record.content, depth + 1));
  }
  if ("message" in record) {
    parts.push(...extractTextFromValue(record.message, depth + 1));
  }
  if ("data" in record) {
    parts.push(...extractTextFromValue(record.data, depth + 1));
  }

  return parts;
}

function extractRole(record: Record<string, unknown>): string | null {
  if (typeof record.role === "string") return record.role;
  if (record.message && typeof record.message === "object") {
    const msg = record.message as Record<string, unknown>;
    if (typeof msg.role === "string") return msg.role;
  }
  if (record.item && typeof record.item === "object") {
    const item = record.item as Record<string, unknown>;
    if (typeof item.role === "string") return item.role;
  }
  return null;
}

function parseCodexSessionFile(filePath: string): string {
  let raw = "";
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch {
    return "";
  }

  const lines = raw.split(/\r?\n/).filter(Boolean);
  const messages: string[] = [];
  let totalLength = 0;
  for (const line of lines) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (!parsed || typeof parsed !== "object") continue;
    const record = parsed as Record<string, unknown>;
    const role = extractRole(record);
    const textPieces = extractTextFromValue(record);
    const combined = textPieces.join("\n").trim();
    if (!combined) continue;
    const label = role ? `${role}:\n${combined}` : combined;
    messages.push(label);
    totalLength += label.length;
    if (totalLength >= MAX_CONVERSATION_CHARS) break;
  }

  return messages.join("\n\n").trim();
}

function listCodexConversations(
  range: DateRangeNormalized,
  maxConversations: number,
  deadlineMs: number,
  projectMatcher?: ProjectMatcher | null
): SourceLoadResult {
  const sessionFilesResult = listCodexSessionFiles(range, deadlineMs);
  if (sessionFilesResult.error) {
    return {
      available: 0,
      conversations: [],
      sampled: false,
      error: sessionFilesResult.error,
      warnings: sessionFilesResult.warnings,
    };
  }

  const warnings = [...sessionFilesResult.warnings];
  const timeoutWarning = "Codex session parsing timed out; sample may be incomplete.";
  const projectScoped = Boolean(projectMatcher);
  const sessionPaths = new Set<string>();
  for (const session of sessionFilesResult.files) {
    const normalized = normalizeSessionPath(session.path);
    if (normalized) sessionPaths.add(normalized);
  }
  const historyIndex = projectScoped
    ? loadCodexHistoryIndex(sessionPaths, deadlineMs)
    : { byPath: new Map<string, string>(), warnings: [] };
  warnings.push(...historyIndex.warnings);

  let available = projectScoped ? 0 : sessionFilesResult.files.length;
  const conversations: ConversationRecord[] = [];
  const matchedSessions: SessionFile[] = [];
  let mappedSessions = 0;
  let unmappedSessions = 0;
  let sampled = false;
  let timedOut = false;

  for (const session of sessionFilesResult.files) {
    if (Date.now() > deadlineMs) {
      sampled = true;
      timedOut = true;
      if (!warnings.includes(timeoutWarning)) warnings.push(timeoutWarning);
      break;
    }
    if (!projectScoped) {
      matchedSessions.push(session);
      continue;
    }
    const sessionPath = normalizeSessionPath(session.path);
    let repoHint = sessionPath ? historyIndex.byPath.get(sessionPath) ?? null : null;
    if (!repoHint) {
      const extracted = extractCodexRepoHintFromSessionFile(session.path, deadlineMs);
      if (extracted.timedOut) {
        sampled = true;
        timedOut = true;
        if (!warnings.includes(timeoutWarning)) warnings.push(timeoutWarning);
        break;
      }
      repoHint = extracted.hint;
    }
    if (!repoHint) {
      unmappedSessions += 1;
      continue;
    }
    mappedSessions += 1;
    if (!matchesProjectValue(repoHint, projectMatcher as ProjectMatcher)) continue;
    available += 1;
    matchedSessions.push(session);
  }

  if (projectScoped) {
    if (!timedOut && sessionFilesResult.files.length > 0 && mappedSessions === 0) {
      warnings.push(
        "Codex history lacks repo metadata; project-scoped Codex analysis is unavailable."
      );
      return {
        available: 0,
        conversations: [],
        sampled: false,
        error: "Codex repo metadata not found for project scope.",
        warnings,
      };
    }
    if (unmappedSessions > 0) {
      warnings.push(
        `Skipped ${unmappedSessions} Codex sessions without repo metadata for project scope.`
      );
    }
  }

  for (const session of matchedSessions) {
    if (Date.now() > deadlineMs) {
      sampled = true;
      if (!warnings.includes(timeoutWarning)) warnings.push(timeoutWarning);
      break;
    }
    if (conversations.length >= maxConversations) {
      sampled = true;
      break;
    }
    const text = parseCodexSessionFile(session.path);
    if (!text) continue;
    conversations.push({
      source: "codex",
      id: session.path,
      timestamp: session.timestamp,
      text,
    });
  }

  return {
    available,
    conversations,
    sampled,
    warnings,
  };
}

type PccThreadRow = {
  thread_id: string;
  last_message_at: string | null;
};

type PccMessageRow = {
  role: string;
  content: string;
};

function buildRangeClause(range: DateRangeNormalized, field: string): { clause: string; params: string[] } {
  const clauses: string[] = [];
  const params: string[] = [];
  if (range.startMs) {
    clauses.push(`${field} >= ?`);
    params.push(new Date(range.startMs).toISOString());
  }
  if (range.endMs) {
    clauses.push(`${field} <= ?`);
    params.push(new Date(range.endMs).toISOString());
  }
  if (!clauses.length) return { clause: "", params: [] };
  return { clause: `AND ${clauses.join(" AND ")}`, params };
}

function listPccConversations(
  range: DateRangeNormalized,
  maxConversations: number,
  deadlineMs: number,
  projectId?: string | null
): SourceLoadResult {
  const db = getDb();
  const threadRange = buildRangeClause(range, "m.created_at");
  const messageRange = buildRangeClause(range, "created_at");
  const projectClause = projectId ? "AND t.project_id = ?" : "";
  const projectParams = projectId ? [...threadRange.params, projectId] : threadRange.params;
  const threads = db
    .prepare(
      `SELECT m.thread_id as thread_id, MAX(m.created_at) as last_message_at
       FROM chat_messages m
       JOIN chat_threads t ON t.id = m.thread_id
       WHERE 1=1 ${threadRange.clause} ${projectClause}
       GROUP BY thread_id
       ORDER BY last_message_at DESC`
    )
    .all(...projectParams) as PccThreadRow[];

  const available = threads.length;
  const conversations: ConversationRecord[] = [];
  let sampled = false;
  const warnings: string[] = [];

  const messageLimit = 60;
  for (const thread of threads) {
    if (Date.now() > deadlineMs) {
      sampled = true;
      warnings.push("PCC chat parsing timed out; sample may be incomplete.");
      break;
    }
    if (conversations.length >= maxConversations) {
      sampled = true;
      break;
    }
    const threadRow = db
      .prepare("SELECT summary FROM chat_threads WHERE id = ? LIMIT 1")
      .get(thread.thread_id) as { summary: string } | undefined;
    const messageRows = db
      .prepare(
        `SELECT role, content
         FROM chat_messages
         WHERE thread_id = ? ${messageRange.clause}
         ORDER BY seq ASC
         LIMIT ?`
      )
      .all(thread.thread_id, ...messageRange.params, messageLimit) as PccMessageRow[];
    const parts: string[] = [];
    if (threadRow?.summary) {
      parts.push(`summary:\n${threadRow.summary.trim()}`);
    }
    for (const msg of messageRows) {
      if (!msg.content) continue;
      const role =
        msg.role === "assistant" || msg.role === "user" || msg.role === "system"
          ? msg.role
          : "message";
      parts.push(`${role}:\n${msg.content.trim()}`);
    }
    const text = parts.join("\n\n").trim();
    if (!text) continue;
    conversations.push({
      source: "pcc",
      id: thread.thread_id,
      timestamp: thread.last_message_at,
      text,
    });
  }

  return { available, conversations, sampled, warnings };
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
};

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

function truncateError(text: string, maxChars = 900): string {
  const trimmed = text.trim();
  if (trimmed.length <= maxChars) return trimmed;
  return `${trimmed.slice(0, Math.max(0, maxChars - 3))}...`;
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
        return truncateError(record.message);
      }
      if (type === "turn.failed") {
        const err = record.error;
        if (err && typeof err === "object") {
          const errRecord = err as Record<string, unknown>;
          if (typeof errRecord.message === "string") return truncateError(errRecord.message);
        }
      }
    } catch {
      if (raw.includes(" ERROR ") || raw.startsWith("ERROR ")) return truncateError(raw);
    }
  }
  return null;
}

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
  args.push("-");

  ensureDir(path.dirname(params.logPath));
  const logStream = fs.createWriteStream(params.logPath, { flags: "a" });
  logStream.write(`[${nowIso()}] codex exec start (${params.sandbox})\n`);

  const child = spawn(codexCommand(params.cliPath), args, {
    cwd: params.cwd,
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...getProcessEnv() },
  });

  child.stdout?.on("data", (buf) => logStream.write(buf));
  child.stderr?.on("data", (buf) => logStream.write(buf));
  child.stdin?.write(params.prompt);
  child.stdin?.end();

  const exitCode: number = await new Promise((resolve) => {
    child.on("close", (code) => resolve(code ?? 1));
    child.on("error", () => resolve(1));
  });

  logStream.write(`[${nowIso()}] codex exec end exit=${exitCode}\n`);
  await new Promise<void>((resolve, reject) => {
    logStream.once("error", reject);
    logStream.once("finish", resolve);
    logStream.end();
  });

  if (exitCode !== 0) {
    const detail = extractCodexErrorMessage(params.logPath);
    throw new Error(
      detail ? `codex exec failed (exit ${exitCode}): ${detail}` : `codex exec failed (exit ${exitCode})`
    );
  }
}

function ensureConstitutionSchemas(): { analysisSchemaPath: string; draftSchemaPath: string } {
  const baseDir = path.join(process.cwd(), ".system", "constitution");
  ensureDir(baseDir);
  const analysisSchemaPath = path.join(baseDir, "constitution_analysis.schema.json");
  const draftSchemaPath = path.join(baseDir, "constitution_draft.schema.json");
  fs.writeFileSync(
    analysisSchemaPath,
    `${JSON.stringify(analysisJsonSchema(), null, 2)}\n`,
    "utf8"
  );
  fs.writeFileSync(
    draftSchemaPath,
    `${JSON.stringify(draftJsonSchema(), null, 2)}\n`,
    "utf8"
  );
  return { analysisSchemaPath, draftSchemaPath };
}

function conversationStats(insights: ConstitutionInsight[]): ConstitutionAnalysisStats {
  const patterns_found = insights.length;
  const preferences_found = insights.filter(
    (insight) => insight.category === "style" || insight.category === "communication"
  ).length;
  const anti_patterns_found = insights.filter((insight) => insight.category === "anti").length;
  return {
    conversations_available: 0,
    conversations_analyzed: 0,
    patterns_found,
    preferences_found,
    anti_patterns_found,
  };
}

function resolveConstitutionScope(params: { projectId?: string | null }): {
  repoPath: string | null;
  meta: ConstitutionGenerationMeta;
} {
  if (params.projectId) {
    const project = findProjectById(params.projectId);
    if (!project) throw new Error("project not found");
    return {
      repoPath: project.path,
      meta: readProjectConstitutionGenerationMeta(project.path),
    };
  }
  return { repoPath: null, meta: readGlobalConstitutionGenerationMeta() };
}

function buildSourcesResult(
  sources: ConstitutionSourceStats[],
  meta: ConstitutionGenerationMeta,
  warnings: string[]
): ConstitutionSourcesResult {
  return { sources, meta, warnings };
}

export function listConstitutionGenerationSources(params: {
  projectId?: string | null;
  range?: ConstitutionDateRange | null;
}): ConstitutionSourcesResult {
  const { meta, repoPath } = resolveConstitutionScope(params);
  const projectMatcher = repoPath ? buildProjectMatcher(repoPath) : null;
  const range = normalizeDateRange(params.range ?? null);
  const deadlineMs = Date.now() + 60_000;

  const warnings: string[] = [];
  const sources: ConstitutionSourceStats[] = [];

  const claude = listClaudeConversations(
    range,
    DEFAULT_MAX_CONVERSATIONS,
    deadlineMs,
    projectMatcher
  );
  warnings.push(...claude.warnings);
  sources.push({
    source: "claude",
    available: claude.available,
    analyzed: 0,
    sampled: claude.sampled,
    error: claude.error,
  });

  const codex = listCodexConversations(
    range,
    DEFAULT_MAX_CONVERSATIONS,
    deadlineMs,
    projectMatcher
  );
  warnings.push(...codex.warnings);
  sources.push({
    source: "codex",
    available: codex.available,
    analyzed: 0,
    sampled: codex.sampled,
    error: codex.error,
  });

  const pcc = listPccConversations(
    range,
    DEFAULT_MAX_CONVERSATIONS,
    deadlineMs,
    params.projectId
  );
  warnings.push(...pcc.warnings);
  sources.push({
    source: "pcc",
    available: pcc.available,
    analyzed: 0,
    sampled: pcc.sampled,
    error: pcc.error,
  });

  return buildSourcesResult(sources, meta, warnings);
}

export async function analyzeConstitutionSources(params: {
  projectId?: string | null;
  sources: ConstitutionSourceSelection;
  range?: ConstitutionDateRange | null;
  maxConversations?: number;
}): Promise<ConstitutionAnalysisResult> {
  const selection = sanitizeSelection(params.sources);
  if (!selection.claude && !selection.codex && !selection.pcc) {
    return {
      insights: [],
      stats: {
        conversations_available: 0,
        conversations_analyzed: 0,
        patterns_found: 0,
        preferences_found: 0,
        anti_patterns_found: 0,
      },
      sources: [
        { source: "claude", available: 0, analyzed: 0, sampled: false },
        { source: "codex", available: 0, analyzed: 0, sampled: false },
        { source: "pcc", available: 0, analyzed: 0, sampled: false },
      ],
      warnings: ["Select at least one chat source to analyze."],
      fallback: true,
    };
  }

  const { repoPath } = resolveConstitutionScope({ projectId: params.projectId });
  const projectMatcher = repoPath ? buildProjectMatcher(repoPath) : null;
  const range = normalizeDateRange(params.range ?? null);
  const maxConversations = Math.max(10, Math.min(400, Math.trunc(params.maxConversations ?? DEFAULT_MAX_CONVERSATIONS)));
  const deadlineMs = Date.now() + 60_000;
  const warnings: string[] = [];

  const sourceStats: ConstitutionSourceStats[] = [];
  const allConversations: ConversationRecord[] = [];

  if (selection.claude) {
    const claude = listClaudeConversations(range, maxConversations, deadlineMs, projectMatcher);
    warnings.push(...claude.warnings);
    allConversations.push(...claude.conversations);
    sourceStats.push({
      source: "claude",
      available: claude.available,
      analyzed: claude.conversations.length,
      sampled: claude.sampled,
      error: claude.error,
    });
  } else {
    sourceStats.push({ source: "claude", available: 0, analyzed: 0, sampled: false });
  }

  if (selection.codex) {
    const codex = listCodexConversations(range, maxConversations, deadlineMs, projectMatcher);
    warnings.push(...codex.warnings);
    allConversations.push(...codex.conversations);
    sourceStats.push({
      source: "codex",
      available: codex.available,
      analyzed: codex.conversations.length,
      sampled: codex.sampled,
      error: codex.error,
    });
  } else {
    sourceStats.push({ source: "codex", available: 0, analyzed: 0, sampled: false });
  }

  if (selection.pcc) {
    const pcc = listPccConversations(range, maxConversations, deadlineMs, params.projectId);
    warnings.push(...pcc.warnings);
    allConversations.push(...pcc.conversations);
    sourceStats.push({
      source: "pcc",
      available: pcc.available,
      analyzed: pcc.conversations.length,
      sampled: pcc.sampled,
      error: pcc.error,
    });
  } else {
    sourceStats.push({ source: "pcc", available: 0, analyzed: 0, sampled: false });
  }

  const { selected, sampled } = sampleConversations(allConversations, maxConversations);
  if (sampled) warnings.push("Conversation sample truncated to keep analysis fast.");

  const selectedBySource = new Map<ConstitutionSourceId, number>();
  for (const convo of selected) {
    selectedBySource.set(convo.source, (selectedBySource.get(convo.source) ?? 0) + 1);
  }
  const nextSourceStats = sourceStats.map((stat) => ({
    ...stat,
    analyzed: selectedBySource.get(stat.source) ?? 0,
  }));

  const conversationsAvailable = sourceStats.reduce((sum, stat) => sum + stat.available, 0);
  const conversationsAnalyzed = selected.length;
  const statsBase = conversationStats([]);
  statsBase.conversations_available = conversationsAvailable;
  statsBase.conversations_analyzed = conversationsAnalyzed;

  if (selected.length === 0) {
    warnings.push("No conversations found in the selected range.");
    return {
      insights: [],
      stats: statsBase,
      sources: nextSourceStats,
      warnings,
      fallback: true,
    };
  }

  const settings = resolveChatSettings().effective;
  if (settings.provider !== "codex") {
    warnings.push(
      "Only Codex CLI is supported for analysis right now. Update Chat Settings to use Codex."
    );
    return {
      insights: [],
      stats: statsBase,
      sources: nextSourceStats,
      warnings,
      fallback: true,
    };
  }

  const cwd = repoPath ?? ensurePortfolioWorkspace();
  const { analysisSchemaPath } = ensureConstitutionSchemas();
  const runId = crypto.randomUUID();
  const runDir = path.join(process.cwd(), ".system", "constitution", "analysis", runId);
  ensureDir(runDir);
  const outputPath = path.join(runDir, "analysis.json");
  const logPath = path.join(runDir, "codex.jsonl");

  const prompt = buildConversationPrompt(selected);
  let parsedInsights: ConstitutionInsight[] = [];
  let fallback = false;

  try {
    await runCodexExecJson({
      cwd,
      prompt,
      schemaPath: analysisSchemaPath,
      outputPath,
      logPath,
      sandbox: "read-only",
      model: settings.model,
      cliPath: settings.cliPath,
      skipGitRepoCheck: true,
    });

    const raw = JSON.parse(fs.readFileSync(outputPath, "utf8")) as unknown;
    const parsed = AnalysisResponseSchema.safeParse(raw);
    if (!parsed.success) {
      throw new Error("analysis response did not match schema");
    }
    parsedInsights = parsed.data.insights.map((insight) => ({
      id: crypto.randomUUID(),
      category: insight.category,
      text: insight.text.trim(),
      confidence: insight.confidence,
      evidence_count: insight.evidence_count,
    }));
  } catch (err) {
    const message = err instanceof Error ? err.message : "AI analysis failed.";
    warnings.push(message);
    fallback = true;
  }

  if (parsedInsights.length < 3) {
    warnings.push("AI extraction returned limited insights; add manual entries if needed.");
    fallback = true;
  }

  const stats = conversationStats(parsedInsights);
  stats.conversations_available = conversationsAvailable;
  stats.conversations_analyzed = conversationsAnalyzed;

  return {
    insights: parsedInsights,
    stats,
    sources: nextSourceStats,
    warnings,
    fallback,
  };
}

function buildDraftPrompt(params: {
  base: string;
  insights: ConstitutionInsightInput[];
}): string {
  const grouped = INSIGHT_CATEGORIES.map((category) => ({
    category,
    items: params.insights.filter((insight) => insight.category === category),
  })).filter((entry) => entry.items.length > 0);

  const insightsBlock = grouped
    .map((entry) => {
      const items = entry.items.map((item) => `- ${item.text.trim()}`).join("\n");
      return `${entry.category.toUpperCase()}:\n${items}`;
    })
    .join("\n\n");

  return [
    "Update the constitution markdown using the accepted insights below.",
    "Preserve existing wording and manual edits. Only add new bullets where appropriate.",
    "Use standard sections: Decision Heuristics, Style & Taste, Anti-Patterns (Learned Failures), Success Patterns, Communication.",
    "If a section is missing, create it. Do not remove existing content.",
    "Return JSON matching the provided schema.",
    "",
    "Current constitution:",
    params.base.trim() || CONSTITUTION_TEMPLATE.trim(),
    "",
    "Accepted insights:",
    insightsBlock || "(none)",
  ].join("\n");
}

export async function generateConstitutionDraft(params: {
  projectId?: string | null;
  insights: ConstitutionInsightInput[];
  base?: string | null;
}): Promise<ConstitutionDraftResult> {
  const warnings: string[] = [];
  const { repoPath } = resolveConstitutionScope({ projectId: params.projectId });
  const providedBase =
    typeof params.base === "string" && params.base.trim().length > 0 ? params.base : null;
  const base =
    providedBase ??
    (repoPath ? readProjectConstitution(repoPath) ?? "" : readGlobalConstitution());
  const fallbackTemplate = CONSTITUTION_TEMPLATE;
  const baseSnapshot = base.trim();
  const baseHasContent = baseSnapshot.length > 0;
  const baseForDraft = baseHasContent ? baseSnapshot : fallbackTemplate.trim();

  if (params.insights.length === 0) {
    return {
      draft: baseForDraft,
      warnings: ["No insights selected; draft uses existing constitution."],
      used_ai: false,
    };
  }

  const settings = resolveChatSettings().effective;
  if (settings.provider !== "codex") {
    const merged = mergeConstitutionWithInsights({
      base: baseForDraft,
      insights: params.insights,
    });
    warnings.push("Codex CLI not configured; draft assembled locally.");
    return { draft: merged, warnings, used_ai: false };
  }

  const cwd = repoPath ?? ensurePortfolioWorkspace();
  const { draftSchemaPath } = ensureConstitutionSchemas();
  const runId = crypto.randomUUID();
  const runDir = path.join(process.cwd(), ".system", "constitution", "drafts", runId);
  ensureDir(runDir);
  const outputPath = path.join(runDir, "draft.json");
  const logPath = path.join(runDir, "codex.jsonl");

  const prompt = buildDraftPrompt({
    base: baseForDraft,
    insights: params.insights,
  });

  try {
    await runCodexExecJson({
      cwd,
      prompt,
      schemaPath: draftSchemaPath,
      outputPath,
      logPath,
      sandbox: "read-only",
      model: settings.model,
      cliPath: settings.cliPath,
      skipGitRepoCheck: true,
    });
    const raw = JSON.parse(fs.readFileSync(outputPath, "utf8")) as unknown;
    const parsed = DraftResponseSchema.safeParse(raw);
    if (!parsed.success) throw new Error("draft response did not match schema");
    const baseLength = baseForDraft.length;
    const draftLength = parsed.data.markdown.trim().length;
    if (baseLength > 0 && draftLength < Math.max(200, Math.floor(baseLength * 0.6))) {
      throw new Error("AI draft looked incomplete; falling back to local merge.");
    }
    if (baseHasContent && !draftPreservesBase({ base: baseSnapshot, draft: parsed.data.markdown })) {
      throw new Error("AI draft omitted existing content; falling back to local merge.");
    }
    return { draft: parsed.data.markdown, warnings, used_ai: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : "AI draft failed.";
    warnings.push(message);
    const merged = mergeConstitutionWithInsights({
      base: baseForDraft,
      insights: params.insights,
    });
    warnings.push("Falling back to local draft merge.");
    return { draft: merged, warnings, used_ai: false };
  }
}

export function markConstitutionGenerationComplete(params: {
  projectId?: string | null;
  lastGeneratedAt?: string | null;
}): ConstitutionGenerationMeta {
  const stamp = params.lastGeneratedAt ?? nowIso();
  if (params.projectId) {
    const project = findProjectById(params.projectId);
    if (!project) throw new Error("project not found");
    return writeProjectConstitutionGenerationMeta(project.path, {
      last_generated_at: stamp,
    });
  }
  return writeGlobalConstitutionGenerationMeta({ last_generated_at: stamp });
}
