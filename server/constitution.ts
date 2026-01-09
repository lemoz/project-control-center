import fs from "fs";
import os from "os";
import path from "path";

export const CONSTITUTION_TEMPLATE = `# Constitution

## Decision Heuristics
General principles for making decisions.
- Prefer simple over clever
- Don't add abstractions until the third use case
- Fix the root cause, not the symptom

## Style & Taste
Preferences for code style, communication, and aesthetics.
- Terse commit messages (50 char subject, body if needed)
- Code speaks for itself - minimal comments unless complex
- Prefer explicit over implicit

## Anti-Patterns (Learned Failures)
Things that have gone wrong and should be avoided.
- Never use \`any\` type in TypeScript without explicit justification
- Don't modify db.ts schema without migration plan
- Avoid deeply nested callbacks

## Success Patterns
Approaches that have worked well.
- Test-first approach for bug fixes catches regressions
- Breaking large WOs into small ones improves success rate
- Reading existing code before writing new code

## Domain Knowledge
Project-specific or technical knowledge.
- Chat system uses SSE for real-time updates, not WebSockets
- Work orders use YAML frontmatter with specific required fields
- Runner uses git worktrees for isolation

## Communication
How to interact with the user.
- Be direct, skip preamble
- Show code first, explain after
- Don't ask for confirmation on small changes
`;

export type ConstitutionVersion = { timestamp: string; content: string };

const GLOBAL_DIR = path.join(os.homedir(), ".control-center");
const GLOBAL_FILE = path.join(GLOBAL_DIR, "constitution.md");
const GLOBAL_VERSIONS_DIR = path.join(GLOBAL_DIR, "constitution.versions");
const GLOBAL_META_FILE = path.join(GLOBAL_DIR, "constitution.meta.json");

const LOCAL_FILE = ".constitution.md";
const LOCAL_VERSIONS_DIR = ".constitution.versions";
const LOCAL_META_FILE = ".constitution.meta.json";
const LOCAL_IGNORE_ENTRIES = [
  `/${LOCAL_FILE}`,
  `/${LOCAL_VERSIONS_DIR}/`,
  `/${LOCAL_META_FILE}`,
];

const MAX_VERSIONS = 5;
const VERSION_RE = /^constitution\.(.+)\.md$/;
const MAX_CONSTITUTION_CHARS = 8000;

type ParsedSection = { title: string; content: string };
type ParsedConstitution = {
  titleLine: string;
  preamble: string;
  sections: ParsedSection[];
};

export type ConstitutionContext = "builder" | "reviewer" | "chat" | "chat_suggestion";

export type ConstitutionSelection = {
  content: string;
  sectionTitles: string[];
  truncated: boolean;
  usedSelection: boolean;
  sourceLength: number;
};

export type ConstitutionInsightCategory =
  | "decision"
  | "style"
  | "anti"
  | "success"
  | "communication";

export type ConstitutionInsightInput = {
  category: ConstitutionInsightCategory;
  text: string;
};

export type ConstitutionGenerationMeta = {
  last_generated_at: string | null;
};

function ensureDir(dir: string): void {
  if (fs.existsSync(dir)) return;
  fs.mkdirSync(dir, { recursive: true });
}

function resolveGitDir(repoPath: string): string | null {
  const gitPath = path.join(repoPath, ".git");
  try {
    const stat = fs.statSync(gitPath);
    if (stat.isDirectory()) return gitPath;
    if (stat.isFile()) {
      const content = fs.readFileSync(gitPath, "utf8");
      const line = content.split(/\r?\n/).find((entry) => entry.startsWith("gitdir:"));
      if (!line) return null;
      const raw = line.slice("gitdir:".length).trim();
      if (!raw) return null;
      return path.resolve(repoPath, raw);
    }
  } catch {
    return null;
  }
  return null;
}

function ensureIgnoreFileEntries(filePath: string, entries: string[]): boolean {
  let content = "";
  let lines: string[] = [];

  if (fs.existsSync(filePath)) {
    try {
      content = fs.readFileSync(filePath, "utf8");
      lines = normalizeNewlines(content).split("\n");
    } catch {
      content = "";
      lines = [];
    }
  }

  const existing = new Set(lines.map((line) => line.trim()).filter(Boolean));
  const additions = entries.filter((entry) => !existing.has(entry));
  if (additions.length === 0) return true;

  const prefix = content && !content.endsWith("\n") ? `${content}\n` : content;
  const next = `${prefix}${additions.join("\n")}\n`;
  try {
    ensureDir(path.dirname(filePath));
    fs.writeFileSync(filePath, next, "utf8");
    return true;
  } catch {
    return false;
  }
}

function ensureProjectConstitutionIgnored(repoPath: string): void {
  const gitPath = path.join(repoPath, ".git");
  const gitDir = resolveGitDir(repoPath);
  if (gitDir) {
    const excludePath = path.join(gitDir, "info", "exclude");
    if (ensureIgnoreFileEntries(excludePath, LOCAL_IGNORE_ENTRIES)) return;
  }
  if (fs.existsSync(gitPath)) {
    ensureIgnoreFileEntries(path.join(repoPath, ".gitignore"), LOCAL_IGNORE_ENTRIES);
  }
}

function normalizeNewlines(value: string): string {
  return value.replace(/\r\n?/g, "\n");
}

function trimEmptyLines(lines: string[]): string[] {
  let start = 0;
  while (start < lines.length && lines[start].trim() === "") start += 1;
  let end = lines.length;
  while (end > start && lines[end - 1].trim() === "") end -= 1;
  return lines.slice(start, end);
}

function parseConstitution(content: string): ParsedConstitution {
  const normalized = normalizeNewlines(content);
  const lines = normalized.split("\n");
  let titleLine = "# Constitution";
  let sawTitle = false;
  const preambleLines: string[] = [];
  const sections: Array<{ title: string; contentLines: string[] }> = [];
  let current: { title: string; contentLines: string[] } | null = null;

  for (const line of lines) {
    if (!sawTitle) {
      const titleMatch = /^#\s+(.*)$/.exec(line);
      if (titleMatch && !line.startsWith("##")) {
        titleLine = `# ${titleMatch[1].trim()}`;
        sawTitle = true;
        continue;
      }
    }

    const sectionMatch = /^##\s+(.*)$/.exec(line);
    if (sectionMatch) {
      if (current) sections.push(current);
      current = { title: sectionMatch[1].trim(), contentLines: [] };
      continue;
    }

    if (current) {
      current.contentLines.push(line);
    } else {
      preambleLines.push(line);
    }
  }

  if (current) sections.push(current);

  return {
    titleLine: titleLine.trim() || "# Constitution",
    preamble: trimEmptyLines(preambleLines).join("\n"),
    sections: sections.map((section) => ({
      title: section.title.trim() || "Untitled",
      content: trimEmptyLines(section.contentLines).join("\n"),
    })),
  };
}

function serializeConstitution(parsed: ParsedConstitution, sections: ParsedSection[]): string {
  const lines: string[] = [];
  lines.push(parsed.titleLine.trim() || "# Constitution");

  if (parsed.preamble) {
    lines.push("");
    lines.push(...parsed.preamble.split("\n"));
  }

  for (const section of sections) {
    lines.push("");
    lines.push(`## ${section.title}`);
    if (section.content) {
      lines.push(...section.content.split("\n"));
    }
  }

  return lines.join("\n").trimEnd();
}

function normalizeTitle(title: string): string {
  return title.trim().toLowerCase();
}

function ensureTrailingNewline(content: string): string {
  const normalized = normalizeNewlines(content);
  return normalized.endsWith("\n") ? normalized : `${normalized}\n`;
}

function versionStamp(now = new Date()): string {
  return now
    .toISOString()
    .replace(/\.\d{3}Z$/, "")
    .replace(/:/g, "-");
}

function listVersionFiles(dir: string): Array<{ timestamp: string; path: string }> {
  if (!fs.existsSync(dir)) return [];
  let entries: string[] = [];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return [];
  }
  return entries
    .map((entry) => {
      const match = VERSION_RE.exec(entry);
      if (!match) return null;
      return { timestamp: match[1], path: path.join(dir, entry) };
    })
    .filter((entry): entry is { timestamp: string; path: string } => Boolean(entry))
    .sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));
}

function pruneVersions(dir: string): void {
  const versions = listVersionFiles(dir);
  const toDelete = versions.slice(MAX_VERSIONS);
  for (const entry of toDelete) {
    try {
      fs.rmSync(entry.path, { force: true });
    } catch {
      // best-effort
    }
  }
}

function writeVersionedFile(
  filePath: string,
  versionsDir: string,
  content: string
): string {
  ensureDir(path.dirname(filePath));
  ensureDir(versionsDir);
  const normalized = ensureTrailingNewline(content);
  const stamp = versionStamp();
  const versionPath = path.join(versionsDir, `constitution.${stamp}.md`);
  fs.writeFileSync(versionPath, normalized, "utf8");
  pruneVersions(versionsDir);
  fs.writeFileSync(filePath, normalized, "utf8");
  return stamp;
}

export function readGlobalConstitution(): string {
  if (!fs.existsSync(GLOBAL_FILE)) return "";
  return fs.readFileSync(GLOBAL_FILE, "utf8");
}

export function readProjectConstitution(repoPath: string): string | null {
  const filePath = path.join(repoPath, LOCAL_FILE);
  if (!fs.existsSync(filePath)) return null;
  return fs.readFileSync(filePath, "utf8");
}

export function writeGlobalConstitution(content: string): { version: string } {
  const version = writeVersionedFile(GLOBAL_FILE, GLOBAL_VERSIONS_DIR, content);
  return { version };
}

export function writeProjectConstitution(
  repoPath: string,
  content: string
): { version: string } {
  ensureProjectConstitutionIgnored(repoPath);
  const filePath = path.join(repoPath, LOCAL_FILE);
  const versionsDir = path.join(repoPath, LOCAL_VERSIONS_DIR);
  const version = writeVersionedFile(filePath, versionsDir, content);
  return { version };
}

export function listGlobalConstitutionVersions(): ConstitutionVersion[] {
  return listConstitutionVersions(GLOBAL_VERSIONS_DIR);
}

export function listProjectConstitutionVersions(
  repoPath: string
): ConstitutionVersion[] {
  const versionsDir = path.join(repoPath, LOCAL_VERSIONS_DIR);
  return listConstitutionVersions(versionsDir);
}

function readGenerationMeta(filePath: string): ConstitutionGenerationMeta {
  if (!fs.existsSync(filePath)) return { last_generated_at: null };
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as unknown;
    if (!parsed || typeof parsed !== "object") return { last_generated_at: null };
    const record = parsed as Record<string, unknown>;
    const lastGenerated =
      typeof record.last_generated_at === "string" ? record.last_generated_at : null;
    return { last_generated_at: lastGenerated };
  } catch {
    return { last_generated_at: null };
  }
}

function writeGenerationMeta(
  filePath: string,
  meta: ConstitutionGenerationMeta
): ConstitutionGenerationMeta {
  ensureDir(path.dirname(filePath));
  const payload: ConstitutionGenerationMeta = {
    last_generated_at: meta.last_generated_at ?? null,
  };
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return payload;
}

export function readGlobalConstitutionGenerationMeta(): ConstitutionGenerationMeta {
  return readGenerationMeta(GLOBAL_META_FILE);
}

export function readProjectConstitutionGenerationMeta(
  repoPath: string
): ConstitutionGenerationMeta {
  const filePath = path.join(repoPath, LOCAL_META_FILE);
  return readGenerationMeta(filePath);
}

export function writeGlobalConstitutionGenerationMeta(
  meta: ConstitutionGenerationMeta
): ConstitutionGenerationMeta {
  return writeGenerationMeta(GLOBAL_META_FILE, meta);
}

export function writeProjectConstitutionGenerationMeta(
  repoPath: string,
  meta: ConstitutionGenerationMeta
): ConstitutionGenerationMeta {
  ensureProjectConstitutionIgnored(repoPath);
  const filePath = path.join(repoPath, LOCAL_META_FILE);
  return writeGenerationMeta(filePath, meta);
}

function listConstitutionVersions(dir: string): ConstitutionVersion[] {
  const versions = listVersionFiles(dir).slice(0, MAX_VERSIONS);
  return versions.map((entry) => ({
    timestamp: entry.timestamp,
    content: fs.readFileSync(entry.path, "utf8"),
  }));
}

export function mergeConstitutions(
  globalContent: string,
  localContent: string | null
): string {
  const localValue = localContent ?? "";
  if (!localValue.trim()) {
    return globalContent.trim() ? globalContent : "";
  }
  if (!globalContent.trim()) {
    return localValue;
  }

  const globalParsed = parseConstitution(globalContent);
  const localParsed = parseConstitution(localValue);

  const localMap = new Map<string, ParsedSection>();
  const localOrder: string[] = [];
  for (const section of localParsed.sections) {
    const key = normalizeTitle(section.title);
    localMap.set(key, section);
    localOrder.push(key);
  }

  const mergedSections: ParsedSection[] = [];
  const usedLocal = new Set<string>();

  for (const section of globalParsed.sections) {
    const key = normalizeTitle(section.title);
    const localSection = localMap.get(key);
    if (localSection) {
      mergedSections.push(localSection);
      usedLocal.add(key);
    } else {
      mergedSections.push(section);
    }
  }

  for (const section of localParsed.sections) {
    const key = normalizeTitle(section.title);
    if (usedLocal.has(key)) continue;
    mergedSections.push(section);
  }

  return serializeConstitution(globalParsed, mergedSections);
}

const INSIGHT_SECTION_TITLES: Record<ConstitutionInsightCategory, string> = {
  decision: "Decision Heuristics",
  style: "Style & Taste",
  anti: "Anti-Patterns (Learned Failures)",
  success: "Success Patterns",
  communication: "Communication",
};

function extractBulletText(line: string): string | null {
  const match = /^[-*]\s+(.*)$/.exec(line.trim());
  if (!match) return null;
  const text = match[1]?.trim();
  return text ? text : null;
}

function normalizeBulletText(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

function mergeSectionContent(content: string, additions: string[]): string {
  const normalized = normalizeNewlines(content ?? "");
  const lines = normalized.split("\n");
  const existing = new Set(
    lines
      .map((line) => extractBulletText(line))
      .filter((entry): entry is string => Boolean(entry))
      .map((entry) => normalizeBulletText(entry))
  );

  const newLines = additions
    .map((entry) => entry.trim())
    .filter(Boolean)
    .filter((entry) => !existing.has(normalizeBulletText(entry)))
    .map((entry) => `- ${entry}`);

  if (newLines.length === 0) return normalized.trimEnd();
  const base = normalized.trimEnd();
  return base ? `${base}\n${newLines.join("\n")}` : newLines.join("\n");
}

export function mergeConstitutionWithInsights(params: {
  base: string;
  insights: ConstitutionInsightInput[];
  fallbackTemplate?: string;
}): string {
  const rawBase = params.base.trim();
  const base = rawBase || params.fallbackTemplate?.trim() || "";
  if (!base && params.insights.length === 0) return "";

  const parsed = parseConstitution(base);
  const sections = parsed.sections.map((section) => ({ ...section }));
  const sectionIndex = new Map(
    sections.map((section, index) => [normalizeSectionKey(section.title), index])
  );

  const grouped = new Map<string, string[]>();
  for (const insight of params.insights) {
    const title = INSIGHT_SECTION_TITLES[insight.category];
    const key = normalizeSectionKey(title);
    const bucket = grouped.get(key) ?? [];
    bucket.push(insight.text);
    grouped.set(key, bucket);
  }

  for (const [key, texts] of grouped.entries()) {
    const existingIndex = sectionIndex.get(key);
    if (existingIndex === undefined) {
      const titleEntry = Object.entries(INSIGHT_SECTION_TITLES).find(
        ([, title]) => normalizeSectionKey(title) === key
      );
      const title = titleEntry ? titleEntry[1] : "Insights";
      const content = mergeSectionContent("", texts);
      sectionIndex.set(key, sections.length);
      sections.push({ title, content });
      continue;
    }

    const section = sections[existingIndex];
    section.content = mergeSectionContent(section.content, texts);
  }

  return serializeConstitution(parsed, sections);
}

export function getConstitutionForProject(repoPath: string | null): string {
  const globalContent = readGlobalConstitution();
  const localContent = repoPath ? readProjectConstitution(repoPath) : null;
  return mergeConstitutions(globalContent, localContent);
}

function normalizeSectionKey(title: string): string {
  const withoutParentheticals = title.replace(/\s*\([^)]*\)\s*/g, " ");
  return withoutParentheticals.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function truncateConstitution(content: string, maxChars: number): string {
  if (content.length <= maxChars) return content;
  const suffix = "\n\n...(truncated)\n";
  const sliceLength = Math.max(0, maxChars - suffix.length);
  const sliced = content.slice(0, sliceLength).trimEnd();
  return `${sliced}${suffix}`;
}

const CONTEXT_SECTION_KEYS: Record<ConstitutionContext, string[]> = {
  builder: ["style taste", "anti patterns", "domain knowledge"],
  reviewer: ["style taste", "anti patterns", "success patterns"],
  chat: ["communication", "decision heuristics"],
  chat_suggestion: ["communication", "decision heuristics"],
};

function collectTargetKeys(
  context: ConstitutionContext,
  workOrderTags?: string[]
): string[] {
  const base = CONTEXT_SECTION_KEYS[context] ?? [];
  const tags = (workOrderTags ?? [])
    .map((tag) => normalizeSectionKey(tag))
    .filter(Boolean);
  return Array.from(new Set([...base, ...tags]));
}

function sectionMatches(title: string, key: string): boolean {
  const normalized = normalizeSectionKey(title);
  if (!normalized || !key) return false;
  if (normalized === key) return true;
  return normalized.includes(key);
}

export function selectRelevantConstitutionSections(params: {
  constitution: string;
  context: ConstitutionContext;
  workOrderTags?: string[];
  maxChars?: number;
}): ConstitutionSelection {
  const raw = params.constitution.trim();
  if (!raw) {
    return {
      content: "",
      sectionTitles: [],
      truncated: false,
      usedSelection: false,
      sourceLength: 0,
    };
  }

  const parsed = parseConstitution(raw);
  const fullSections = parsed.sections;
  const fullContent = serializeConstitution(parsed, fullSections);
  const limit = Math.max(200, Math.trunc(params.maxChars ?? MAX_CONSTITUTION_CHARS));

  const targetKeys = collectTargetKeys(params.context, params.workOrderTags);
  const selectedSections = targetKeys.length
    ? fullSections.filter((section) =>
        targetKeys.some((key) => sectionMatches(section.title, key))
      )
    : [];

  const useSelection = fullContent.length > limit && selectedSections.length > 0;
  const chosenSections = useSelection ? selectedSections : fullSections;
  let content = serializeConstitution(parsed, chosenSections);
  let truncated = false;
  if (content.length > limit) {
    content = truncateConstitution(content, limit);
    truncated = true;
  }

  return {
    content,
    sectionTitles: chosenSections.map((section) => section.title),
    truncated,
    usedSelection: useSelection,
    sourceLength: fullContent.length,
  };
}

export function formatConstitutionBlock(content: string): string {
  const trimmed = content.trim();
  if (!trimmed) return "";
  return `<constitution>\n${trimmed}\n</constitution>\n\n`;
}
