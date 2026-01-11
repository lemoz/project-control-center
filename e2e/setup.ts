import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { fileURLToPath } from "url";
import Database from "better-sqlite3";
import type { APIRequestContext } from "@playwright/test";

const e2eDir = path.dirname(fileURLToPath(import.meta.url));
const tmpDir = path.join(e2eDir, ".tmp");
const reposRoot = path.join(tmpDir, "repos");
const dbPath = path.join(tmpDir, "control-center-test.db");
const dbSnapshotPath = path.join(tmpDir, "control-center-test.db.snapshot");

const baseRepos = ["alpha", "beta"] as const;
const baseRepoSet = new Set<string>(baseRepos);

const alphaControlContents = [
  "type: long_term",
  "stage: building",
  "status: active",
  "priority: 2",
  "tags:",
  "  - demo",
  "  - sidecar",
  "",
].join("\n");

export const e2ePaths = {
  e2eDir,
  tmpDir,
  reposRoot,
  dbPath,
  dbSnapshotPath,
};

export function resetTmpDir(): void {
  if (fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
  fs.mkdirSync(reposRoot, { recursive: true });
}

export function ensureRepoFixtures(): void {
  fs.mkdirSync(reposRoot, { recursive: true });

  for (const entry of fs.readdirSync(reposRoot, { withFileTypes: true })) {
    const entryPath = path.join(reposRoot, entry.name);
    if (!baseRepoSet.has(entry.name)) {
      fs.rmSync(entryPath, { recursive: true, force: true });
      continue;
    }
    fs.rmSync(entryPath, { recursive: true, force: true });
  }

  for (const name of baseRepos) {
    const dir = path.join(reposRoot, name);
    fs.mkdirSync(dir, { recursive: true });
    execSync("git init", { cwd: dir, stdio: "ignore" });
    fs.writeFileSync(path.join(dir, "README.md"), `# ${name}\n`, "utf8");
  }
}

export function resetControlFiles(): void {
  if (!fs.existsSync(reposRoot)) return;

  for (const entry of fs.readdirSync(reposRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const controlPath = path.join(reposRoot, entry.name, ".control.yml");
    if (fs.existsSync(controlPath)) {
      fs.rmSync(controlPath);
    }
  }

  const alphaControlPath = path.join(reposRoot, "alpha", ".control.yml");
  fs.writeFileSync(alphaControlPath, alphaControlContents, "utf8");
}

function escapeSqlString(value: string): string {
  return value.replace(/'/g, "''");
}

function quoteIdentifier(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function listTables(db: Database.Database): string[] {
  const rows = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
    .all() as Array<{ name: string }>;
  return rows.map((row) => row.name);
}

async function waitForFile(filePath: string, timeoutMs = 5000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (fs.existsSync(filePath)) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for ${filePath}`);
}

function getApiBase(): string {
  const apiPort = Number(
    process.env.E2E_API_PORT || process.env.CONTROL_CENTER_PORT || 4011
  );
  return `http://127.0.0.1:${apiPort}`;
}

export async function ensureDatabaseSnapshot(
  request?: APIRequestContext
): Promise<void> {
  if (fs.existsSync(dbSnapshotPath)) return;

  if (request) {
    const response = await request.get(`${getApiBase()}/repos`);
    if (!response.ok()) {
      throw new Error(`Failed to initialize DB snapshot: ${response.status()}`);
    }
    await response.json();
  } else if (!fs.existsSync(dbPath)) {
    throw new Error("DB snapshot missing and no request context available.");
  }

  await waitForFile(dbPath);

  const db = new Database(dbPath);
  await db.backup(dbSnapshotPath);
  db.close();
}

export function resetTestDatabase(): void {
  if (!fs.existsSync(dbSnapshotPath)) return;

  const db = new Database(dbPath);
  const snapshotDb = new Database(dbSnapshotPath, { readonly: true });

  const snapshotTables = listTables(snapshotDb);
  const mainTables = listTables(db);
  const snapshotUserTables = snapshotTables.filter((table) => !table.startsWith("sqlite_"));
  const mainUserTables = mainTables.filter((table) => !table.startsWith("sqlite_"));

  for (const table of mainUserTables) {
    if (!snapshotUserTables.includes(table)) {
      db.exec(`DROP TABLE IF EXISTS ${quoteIdentifier(table)}`);
    }
  }

  db.exec(`ATTACH DATABASE '${escapeSqlString(dbSnapshotPath)}' AS snapshot`);
  try {
    db.exec("BEGIN");
    try {
      for (const table of snapshotUserTables) {
        if (!mainTables.includes(table)) {
          const createRow = snapshotDb
            .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?")
            .get(table) as { sql?: string } | undefined;
          if (createRow?.sql) {
            db.exec(createRow.sql);
          }
        }
        const quoted = quoteIdentifier(table);
        db.exec(`DELETE FROM ${quoted}`);
        db.exec(`INSERT INTO ${quoted} SELECT * FROM snapshot.${quoted}`);
      }

      if (mainTables.includes("sqlite_sequence")) {
        db.exec("DELETE FROM sqlite_sequence");
        if (snapshotTables.includes("sqlite_sequence")) {
          db.exec("INSERT INTO sqlite_sequence SELECT * FROM snapshot.sqlite_sequence");
        }
      }

      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  } finally {
    db.exec("DETACH DATABASE snapshot");
    snapshotDb.close();
    db.close();
  }
}

export async function resetTestEnvironment(params?: {
  request?: APIRequestContext;
}): Promise<void> {
  ensureRepoFixtures();
  resetControlFiles();

  if (!fs.existsSync(dbSnapshotPath)) {
    if (!params?.request) {
      throw new Error("DB snapshot missing and request context unavailable.");
    }
    await ensureDatabaseSnapshot(params.request);
  }

  resetTestDatabase();
}
