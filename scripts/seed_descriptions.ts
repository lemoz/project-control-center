import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

type SeedEntry = { repoPath: string; description: string };

function usage(): string {
  return [
    "Seed repo descriptions into the Project Control Center SQLite DB.",
    "",
    "Usage:",
    "  node --import tsx/esm scripts/seed_descriptions.ts --input scripts/seed_descriptions.local.json",
    "",
    "Options:",
    "  --input <file>   JSON file containing [{ repoPath, description }, ...]",
    "  --db <file>      DB file path (default: $CONTROL_CENTER_DB_PATH or ./control-center.db)",
    "  --help           Show this message",
    "",
    "Notes:",
    "  - Run a repo scan first so the projects exist in the DB.",
    "  - Paths may use ~ or $HOME and will be resolved to absolute paths.",
  ].join(\"\\n\");
}

function parseArgs(argv: string[]): { input?: string; db?: string; help: boolean } {
  const args = {
    input: undefined as string | undefined,
    db: undefined as string | undefined,
    help: false,
  };
  const rest = [...argv];
  while (rest.length) {
    const token = rest.shift();
    if (!token) break;
    if (token === \"--help\" || token === \"-h\") {
      args.help = true;
      continue;
    }
    if (token === \"--input\") {
      args.input = rest.shift();
      continue;
    }
    if (token === \"--db\") {
      args.db = rest.shift();
      continue;
    }
    // Unknown arg
    args.help = true;
  }
  return args;
}

function expandUserPath(value: string): string {
  if (value === \"~\") return os.homedir();
  if (value.startsWith(\"~/\") || value.startsWith(\"~\\\\\")) {
    return path.join(os.homedir(), value.slice(2));
  }
  if (value.startsWith(\"$HOME/\")) {
    return path.join(os.homedir(), value.slice(\"$HOME/\".length));
  }
  if (value === \"$HOME\") return os.homedir();
  return value;
}

function readSeedFile(filePath: string): SeedEntry[] {
  const raw = fs.readFileSync(filePath, \"utf8\");
  const json = JSON.parse(raw) as unknown;
  if (!Array.isArray(json)) throw new Error(\"seed file must be a JSON array\");
  return json.map((item) => {
    const row = item as Partial<SeedEntry>;
    if (typeof row.repoPath !== \"string\" || row.repoPath.length === 0) {
      throw new Error(\"seed entries must include repoPath\");
    }
    if (typeof row.description !== \"string\") {
      throw new Error(\"seed entries must include description\");
    }
    return { repoPath: row.repoPath, description: row.description };
  });
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    // eslint-disable-next-line no-console
    console.log(usage());
    process.exit(0);
  }

  const defaultInput = path.join(process.cwd(), \"scripts\", \"seed_descriptions.local.json\");
  const inputPath = args.input || (fs.existsSync(defaultInput) ? defaultInput : undefined);
  if (!inputPath) {
    // eslint-disable-next-line no-console
    console.error(
      \"Missing --input. Create scripts/seed_descriptions.local.json (gitignored) or pass --input.\"
    );
    // eslint-disable-next-line no-console
    console.error(\"\");
    // eslint-disable-next-line no-console
    console.error(usage());
    process.exit(2);
  }

  const dbPath =
    args.db ||
    process.env.CONTROL_CENTER_DB_PATH ||
    path.join(process.cwd(), \"control-center.db\");

  const entries = readSeedFile(inputPath);
  const db = new Database(dbPath);
  const update = db.prepare(\"UPDATE projects SET description = ?, updated_at = ? WHERE path = ?\");
  const now = new Date().toISOString();

  let updated = 0;
  const missing: string[] = [];

  for (const entry of entries) {
    const resolvedPath = path.resolve(expandUserPath(entry.repoPath));
    const res = update.run(entry.description, now, resolvedPath);
    if (res.changes === 0) missing.push(resolvedPath);
    updated += res.changes;
  }

  // eslint-disable-next-line no-console
  console.log(`Seeded descriptions for ${updated} projects.`);
  if (missing.length) {
    // eslint-disable-next-line no-console
    console.warn(\"No matching DB rows for:\", missing);
  }
}

main();
