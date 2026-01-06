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

const LOCAL_FILE = ".constitution.md";
const LOCAL_VERSIONS_DIR = ".constitution.versions";
const LOCAL_IGNORE_ENTRIES = [`/${LOCAL_FILE}`, `/${LOCAL_VERSIONS_DIR}/`];

const MAX_VERSIONS = 5;
const VERSION_RE = /^constitution\.(.+)\.md$/;

type ParsedSection = { title: string; content: string };
type ParsedConstitution = {
  titleLine: string;
  preamble: string;
  sections: ParsedSection[];
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
