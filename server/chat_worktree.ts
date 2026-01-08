import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";

type GitResult = {
  status: number;
  stdout: string;
  stderr: string;
};

function ensureDir(dir: string) {
  if (fs.existsSync(dir)) return;
  fs.mkdirSync(dir, { recursive: true });
}

function runGit(
  args: string[],
  options: { cwd: string; allowFailure?: boolean }
): GitResult {
  const result = spawnSync("git", args, {
    cwd: options.cwd,
    encoding: "utf8",
  });
  const status = result.status ?? 1;
  const stdout = result.stdout ? String(result.stdout) : "";
  const stderr = result.stderr ? String(result.stderr) : "";
  if (!options.allowFailure && status !== 0) {
    const message = stderr.trim() || stdout.trim() || "git failed";
    throw new Error(message);
  }
  return { status, stdout, stderr };
}

function gitBranchExists(repoPath: string, branchName: string): boolean {
  const result = runGit(["show-ref", "--verify", `refs/heads/${branchName}`], {
    cwd: repoPath,
    allowFailure: true,
  });
  return result.status === 0;
}

function resolveBaseBranch(repoPath: string): string {
  for (const candidate of ["main", "master"]) {
    if (gitBranchExists(repoPath, candidate)) return candidate;
  }
  const current = runGit(["rev-parse", "--abbrev-ref", "HEAD"], {
    cwd: repoPath,
    allowFailure: true,
  }).stdout.trim();
  if (current && current !== "HEAD") return current;
  throw new Error("Unable to resolve base branch");
}

function listWorktrees(repoPath: string): Array<{ path: string; branch: string | null }> {
  const result = runGit(["worktree", "list", "--porcelain"], {
    cwd: repoPath,
    allowFailure: true,
  });
  const lines = result.stdout.split(/\r?\n/);
  const worktrees: Array<{ path: string; branch: string | null }> = [];
  let current: { path?: string; branch?: string | null } = {};

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("worktree ")) {
      if (current.path) {
        worktrees.push({
          path: current.path,
          branch: current.branch ?? null,
        });
      }
      current = { path: line.slice("worktree ".length).trim(), branch: null };
      continue;
    }
    if (line.startsWith("branch ")) {
      current.branch = line.slice("branch ".length).trim();
      continue;
    }
    if (line === "detached") {
      current.branch = null;
    }
  }
  if (current.path) {
    worktrees.push({
      path: current.path,
      branch: current.branch ?? null,
    });
  }
  return worktrees;
}

function safeThreadSlug(threadId: string): string {
  const trimmed = threadId.trim();
  let slug = (trimmed || "thread").replace(/[^A-Za-z0-9._-]+/g, "-");
  slug = slug.replace(/\.\.+/g, "-");
  slug = slug.replace(/^-+/, "").replace(/-+$/, "");
  if (!slug) slug = "thread";
  if (slug.endsWith(".lock")) slug = slug.replace(/\.lock$/, "-lock");
  return slug;
}

export function resolveChatWorktreeConfig(
  threadId: string,
  overridePath?: string | null
): { worktreePath: string; branchName: string } {
  const slug = safeThreadSlug(threadId);
  const worktreePath =
    overridePath && overridePath.trim()
      ? overridePath
      : path.join(process.cwd(), ".system", "chat-worktrees", `thread-${slug}`);
  const branchName = `chat/thread-${slug}`;
  return { worktreePath, branchName };
}

export function ensureChatWorktree(params: {
  repoPath: string;
  threadId: string;
  worktreePath?: string | null;
}): { worktreePath: string; branchName: string; baseBranch: string; created: boolean } {
  const { worktreePath, branchName } = resolveChatWorktreeConfig(
    params.threadId,
    params.worktreePath
  );
  const baseBranch = resolveBaseBranch(params.repoPath);
  const existing = listWorktrees(params.repoPath).some(
    (tree) => path.resolve(tree.path) === path.resolve(worktreePath)
  );

  if (!existing) {
    if (fs.existsSync(worktreePath)) {
      fs.rmSync(worktreePath, { recursive: true, force: true });
    }
    ensureDir(path.dirname(worktreePath));
    if (gitBranchExists(params.repoPath, branchName)) {
      runGit(["worktree", "add", worktreePath, branchName], { cwd: params.repoPath });
    } else {
      runGit(
        ["worktree", "add", "-b", branchName, worktreePath, baseBranch],
        { cwd: params.repoPath }
      );
    }
  }

  return { worktreePath, branchName, baseBranch, created: !existing };
}

export function readWorktreeStatus(worktreePath: string): {
  hasPendingChanges: boolean;
  untracked: string[];
} {
  const status = runGit(["status", "--porcelain"], {
    cwd: worktreePath,
    allowFailure: true,
  });
  const lines = status.stdout
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean);
  const untracked = lines
    .filter((line) => line.startsWith("?? "))
    .map((line) => line.slice(3));
  return { hasPendingChanges: lines.length > 0, untracked };
}

export function buildWorktreeDiff(params: {
  worktreePath: string;
  repoPath: string;
  baseBranch?: string;
}): { diff: string; hasPendingChanges: boolean } {
  const status = readWorktreeStatus(params.worktreePath);
  const baseBranch = params.baseBranch ?? resolveBaseBranch(params.repoPath);
  const diffResult = runGit(["diff", "--no-color", baseBranch], {
    cwd: params.worktreePath,
    allowFailure: true,
  });
  let diff = diffResult.stdout.trimEnd();
  if (status.untracked.length) {
    diff += `${diff ? "\n\n" : ""}Untracked files:\n${status.untracked
      .map((name) => `- ${name}`)
      .join("\n")}`;
  }
  if (diff) diff += "\n";
  return { diff, hasPendingChanges: status.hasPendingChanges };
}

function listUnmergedFiles(repoPath: string): string[] {
  const result = runGit(["diff", "--name-only", "--diff-filter=U"], {
    cwd: repoPath,
    allowFailure: true,
  });
  return result.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .sort();
}

export function cleanupChatWorktree(params: {
  repoPath: string;
  worktreePath: string;
  branchName: string;
}): void {
  runGit(["worktree", "remove", "--force", params.worktreePath], {
    cwd: params.repoPath,
    allowFailure: true,
  });
  fs.rmSync(params.worktreePath, { recursive: true, force: true });
  runGit(["branch", "-D", params.branchName], {
    cwd: params.repoPath,
    allowFailure: true,
  });
}

export function mergeChatWorktree(params: {
  repoPath: string;
  threadId: string;
  worktreePath: string;
  branchName: string;
}): { merged: boolean; message?: string } {
  const baseBranch = resolveBaseBranch(params.repoPath);
  const status = readWorktreeStatus(params.worktreePath);
  if (!status.hasPendingChanges) {
    cleanupChatWorktree({
      repoPath: params.repoPath,
      worktreePath: params.worktreePath,
      branchName: params.branchName,
    });
    return { merged: true, message: "No changes to merge." };
  }

  runGit(["add", "-A"], { cwd: params.worktreePath });
  const commitMessage = `Chat thread ${params.threadId}`;
  const commitResult = runGit(
    [
      "-c",
      "user.name=Control Center Chat",
      "-c",
      "user.email=chat@local",
      "commit",
      "-m",
      commitMessage,
    ],
    { cwd: params.worktreePath, allowFailure: true }
  );
  if (commitResult.status !== 0) {
    const detail = commitResult.stderr.trim() || commitResult.stdout.trim() || "git commit failed";
    throw new Error(detail);
  }

  const mainStatus = runGit(["status", "--porcelain"], {
    cwd: params.repoPath,
    allowFailure: true,
  });
  if (mainStatus.stdout.trim()) {
    throw new Error("Main branch has uncommitted changes. Clean it before merging.");
  }

  const currentBranch = runGit(["rev-parse", "--abbrev-ref", "HEAD"], {
    cwd: params.repoPath,
    allowFailure: true,
  }).stdout.trim();
  if (!currentBranch) {
    throw new Error("Unable to determine current branch.");
  }

  if (currentBranch !== baseBranch) {
    runGit(["checkout", baseBranch], { cwd: params.repoPath });
  }

  const mergeResult = runGit(["merge", "--no-ff", params.branchName], {
    cwd: params.repoPath,
    allowFailure: true,
  });

  if (mergeResult.status !== 0) {
    runGit(["merge", "--abort"], { cwd: params.repoPath, allowFailure: true });
    if (currentBranch && currentBranch !== baseBranch) {
      runGit(["checkout", currentBranch], { cwd: params.repoPath, allowFailure: true });
    }
    const conflicts = listUnmergedFiles(params.repoPath);
    const detail = conflicts.length
      ? `Merge conflict in: ${conflicts.join(", ")}`
      : mergeResult.stderr.trim() || mergeResult.stdout.trim() || "merge failed";
    const suffix = conflicts.length
      ? "Resolve conflicts manually in the repo and retry."
      : "";
    throw new Error(`Merge failed. ${detail}${suffix ? ` ${suffix}` : ""}`);
  }

  if (currentBranch && currentBranch !== baseBranch) {
    runGit(["checkout", currentBranch], { cwd: params.repoPath, allowFailure: true });
  }

  cleanupChatWorktree({
    repoPath: params.repoPath,
    worktreePath: params.worktreePath,
    branchName: params.branchName,
  });

  return { merged: true };
}
