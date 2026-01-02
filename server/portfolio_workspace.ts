import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";
import { listProjects, type ProjectRow } from "./db.js";

function nowIso(): string {
  return new Date().toISOString();
}

function ensureDir(dir: string) {
  if (fs.existsSync(dir)) return;
  fs.mkdirSync(dir, { recursive: true });
}

const DENY_BASENAME_PREFIXES = [".env"];
const DENY_BASENAMES = new Set([
  "id_rsa",
  "id_rsa.pub",
  "id_ed25519",
  "id_ed25519.pub",
  "id_ecdsa",
  "id_ecdsa.pub",
  "id_dsa",
  "id_dsa.pub",
]);
const DENY_EXTS = new Set([".pem", ".key", ".p12", ".pfx"]);

function isDeniedRelPath(relPath: string): boolean {
  const normalized = relPath.replace(/\\/g, "/");
  const base = path.posix.basename(normalized);

  if (DENY_BASENAME_PREFIXES.some((p) => base.startsWith(p))) return true;
  if (DENY_BASENAMES.has(base)) return true;
  const ext = path.posix.extname(base).toLowerCase();
  if (DENY_EXTS.has(ext)) return true;

  return false;
}

function listGitTrackedFiles(repoPath: string): string[] {
  const res = spawnSync("git", ["ls-files", "-z"], {
    cwd: repoPath,
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "buffer",
    maxBuffer: 25 * 1024 * 1024,
  });
  if ((res.status ?? 1) !== 0) return [];
  const stdout = (res.stdout as Buffer | undefined) ?? Buffer.from([]);
  return stdout
    .toString("utf8")
    .split("\u0000")
    .map((s) => s.trim())
    .filter(Boolean);
}

function syncRepoMirror(project: ProjectRow, dstRoot: string) {
  fs.rmSync(dstRoot, { recursive: true, force: true });
  ensureDir(dstRoot);

  const repoPath = project.path;
  const repoResolved = path.resolve(repoPath);

  const files = listGitTrackedFiles(repoPath);
  for (const rel of files) {
    if (!rel || rel.includes("\u0000")) continue;
    if (rel.startsWith("/") || rel.includes("..")) continue;
    if (isDeniedRelPath(rel)) continue;

    const srcPath = path.join(repoPath, rel);
    const srcResolved = path.resolve(srcPath);
    if (!srcResolved.startsWith(repoResolved + path.sep)) continue;

    let stat: fs.Stats;
    try {
      stat = fs.lstatSync(srcPath);
    } catch {
      continue;
    }
    if (stat.isSymbolicLink() || stat.isDirectory() || !stat.isFile()) continue;

    const dstPath = path.join(dstRoot, rel);
    ensureDir(path.dirname(dstPath));
    try {
      fs.copyFileSync(srcPath, dstPath);
    } catch {
      // best-effort
    }
  }

  const meta = {
    project_id: project.id,
    project_name: project.name,
    source_path: project.path,
    synced_at: nowIso(),
  };
  try {
    fs.writeFileSync(
      path.join(dstRoot, ".control-center-mirror.json"),
      `${JSON.stringify(meta, null, 2)}\n`,
      "utf8"
    );
  } catch {
    // ignore
  }
}

export function ensurePortfolioWorkspace(): string {
  const root = path.join(process.cwd(), ".system", "portfolio");
  const reposRoot = path.join(root, "repos");
  ensureDir(reposRoot);

  const visible = listProjects().filter((p) => p.hidden === 0);
  const visibleById = new Map(visible.map((p) => [p.id, p]));

  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(reposRoot, { withFileTypes: true });
  } catch {
    entries = [];
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (!visibleById.has(entry.name)) {
      fs.rmSync(path.join(reposRoot, entry.name), { recursive: true, force: true });
    }
  }

  for (const project of visible) {
    try {
      syncRepoMirror(project, path.join(reposRoot, project.id));
    } catch {
      // ignore; keep workspace best-effort
    }
  }

  const index = visible.map((p) => ({
    id: p.id,
    name: p.name,
    tags: (() => {
      try {
        const parsed = JSON.parse(p.tags);
        return Array.isArray(parsed) ? parsed.filter((t) => typeof t === "string") : [];
      } catch {
        return [];
      }
    })(),
  }));
  try {
    fs.writeFileSync(path.join(root, "projects.json"), `${JSON.stringify(index, null, 2)}\n`, "utf8");
  } catch {
    // ignore
  }

  return root;
}

