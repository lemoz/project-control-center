import fs from "fs";
import path from "path";
import {
  getHomeDir,
  getPccMode,
  getReposPath,
  getScanIgnoreDirs,
  getScanIgnoreDirsRemove,
  getScanMaxDepth,
  getScanRoots,
} from "./config.js";

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

export function loadDiscoveryConfig(): DiscoveryConfig {
  const rootsEnv = getScanRoots();
  const reposPath = getReposPath();
  const home = getHomeDir();
  const roots = reposPath
    ? [reposPath]
    : rootsEnv.length
      ? rootsEnv
      : getPccMode() === "cloud"
        ? [process.cwd()]
        : [home];

  const ignoreSet = new Set(DEFAULT_IGNORE_DIRS);
  for (const name of getScanIgnoreDirs()) {
    ignoreSet.add(name);
  }
  for (const name of getScanIgnoreDirsRemove()) {
    ignoreSet.delete(name);
  }

  const maxDepth = getScanMaxDepth();

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
