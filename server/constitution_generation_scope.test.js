import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";

const originalEnv = {
  HOME: process.env.HOME,
  CONTROL_CENTER_DB_PATH: process.env.CONTROL_CENTER_DB_PATH,
  PCC_DATABASE_PATH: process.env.PCC_DATABASE_PATH,
};

const sandboxRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pcc-constitution-scope-"));
process.env.HOME = sandboxRoot;
process.env.CONTROL_CENTER_DB_PATH = path.join(sandboxRoot, "control-center.db");
process.env.PCC_DATABASE_PATH = path.join(sandboxRoot, "control-center.db");

const { upsertProject } = await import("./db.ts");
const { listConstitutionGenerationSources } = await import("./constitution_generation.ts");

const projectId = "proj-1";
const repoPath = path.join(sandboxRoot, "repo-alpha");
const otherRepoPath = path.join(sandboxRoot, "repo-beta");

fs.mkdirSync(repoPath, { recursive: true });
fs.mkdirSync(otherRepoPath, { recursive: true });

upsertProject({
  id: projectId,
  path: repoPath,
  name: "repo-alpha",
  description: null,
  success_criteria: null,
  success_metrics: "[]",
  type: "long_term",
  stage: "build",
  status: "active",
  priority: 1,
  starred: 0,
  hidden: 0,
  auto_shift_enabled: 0,
  tags: "[]",
  isolation_mode: "local",
  vm_size: "medium",
  last_run_at: null,
});

function writeJsonl(filePath, entries) {
  const lines = entries.map((entry) => JSON.stringify(entry));
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${lines.join("\n")}\n`, "utf8");
}

writeJsonl(path.join(sandboxRoot, ".claude", "history.jsonl"), [
  {
    display: "git status",
    pastedContents: "",
    timestamp: "2026-01-09T10:00:00Z",
    project: repoPath,
  },
  {
    display: "git log",
    pastedContents: "",
    timestamp: "2026-01-09T11:00:00Z",
    project: otherRepoPath,
  },
]);

writeJsonl(path.join(sandboxRoot, ".codex", "sessions", "2026", "01", "09", "repo.jsonl"), [
  {
    type: "session_meta",
    cwd: repoPath,
    git: { root: repoPath },
  },
  {
    role: "user",
    content: "Hello",
  },
]);

writeJsonl(path.join(sandboxRoot, ".codex", "sessions", "2026", "01", "09", "other.jsonl"), [
  {
    type: "session_meta",
    cwd: otherRepoPath,
  },
  {
    role: "user",
    content: "Other",
  },
]);

after(() => {
  if (originalEnv.HOME === undefined) {
    delete process.env.HOME;
  } else {
    process.env.HOME = originalEnv.HOME;
  }
  if (originalEnv.CONTROL_CENTER_DB_PATH === undefined) {
    delete process.env.CONTROL_CENTER_DB_PATH;
  } else {
    process.env.CONTROL_CENTER_DB_PATH = originalEnv.CONTROL_CENTER_DB_PATH;
  }
  if (originalEnv.PCC_DATABASE_PATH === undefined) {
    delete process.env.PCC_DATABASE_PATH;
  } else {
    process.env.PCC_DATABASE_PATH = originalEnv.PCC_DATABASE_PATH;
  }
});

test("project-scoped Claude sources only include matching project records", () => {
  const result = listConstitutionGenerationSources({ projectId, range: null });
  const claude = result.sources.find((entry) => entry.source === "claude");
  assert.ok(claude);
  assert.equal(claude.available, 1);
  assert.equal(claude.error, undefined);
});

test("project-scoped Codex sources use session metadata to filter by repo", () => {
  const result = listConstitutionGenerationSources({ projectId, range: null });
  const codex = result.sources.find((entry) => entry.source === "codex");
  assert.ok(codex);
  assert.equal(codex.available, 1);
  assert.equal(codex.error, undefined);
});
