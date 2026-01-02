import fs from "fs";
import path from "path";

export type DiscoveryConfig = {
  roots: string[];
  ignoreDirNames: Set<string>;
  maxDepth: number;
};

const DEFAULT_IGNORE_DIRS = [
  ".git",
  "node_modules",
  ".next",
  "dist",
  "build",
  "out",
  ".venv",
  "venv",
  "__pycache__",
  ".pytest_cache",
  ".mypy_cache",
  ".ruff_cache",
  ".cache",
  "cache",
  "tmp",
  "temp",
  "logs",
  "output",
  "archive",
  ".idea",
  ".vscode",
  "Library",
  "Applications",
  "Movies",
  "Music",
  "Pictures",
  "Public",
];

function parseEnvList(value?: string): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function loadDiscoveryConfig(): DiscoveryConfig {
  const rootsEnv = parseEnvList(process.env.CONTROL_CENTER_SCAN_ROOTS);
  const home = process.env.HOME || process.cwd();
  const roots = rootsEnv.length ? rootsEnv : [home];

  const ignoreSet = new Set(DEFAULT_IGNORE_DIRS);
  for (const name of parseEnvList(process.env.CONTROL_CENTER_IGNORE_DIRS)) {
    ignoreSet.add(name);
  }
  for (const name of parseEnvList(process.env.CONTROL_CENTER_IGNORE_DIRS_REMOVE)) {
    ignoreSet.delete(name);
  }

  const maxDepthRaw = Number(process.env.CONTROL_CENTER_SCAN_MAX_DEPTH || 4);
  const maxDepth = Number.isFinite(maxDepthRaw) && maxDepthRaw >= 0 ? maxDepthRaw : 4;

  return { roots, ignoreDirNames: ignoreSet, maxDepth };
}

export function discoverGitRepos(config: DiscoveryConfig): string[] {
  const results = new Set<string>();
  for (const root of config.roots) {
    const absRoot = path.resolve(root);
    scan(absRoot, 0, config, results);
  }
  return Array.from(results);
}

function scan(dir: string, depth: number, config: DiscoveryConfig, results: Set<string>) {
  if (depth > config.maxDepth) return;

  const baseName = path.basename(dir);
  if (config.ignoreDirNames.has(baseName)) return;

  if (isGitRepo(dir)) {
    results.add(dir);
    return;
  }

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.isSymbolicLink()) continue;
    if (config.ignoreDirNames.has(entry.name)) continue;

    const child = path.join(dir, entry.name);
    scan(child, depth + 1, config, results);
  }
}

function isGitRepo(dir: string): boolean {
  const gitPath = path.join(dir, ".git");
  try {
    const stat = fs.statSync(gitPath);
    return stat.isDirectory() || stat.isFile();
  } catch {
    return false;
  }
}

