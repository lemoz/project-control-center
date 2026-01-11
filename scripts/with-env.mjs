import { spawn } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

// Load .env file if it exists
function loadEnvFile() {
  const envPath = resolve(process.cwd(), ".env");
  if (!existsSync(envPath)) return {};
  const content = readFileSync(envPath, "utf8");
  const env = {};
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq);
    const value = trimmed.slice(eq + 1);
    env[key] = value;
  }
  return env;
}

function usage() {
  // eslint-disable-next-line no-console
  console.error(
    "Usage: node scripts/with-env.mjs KEY=VALUE [KEY=VALUE ...] -- <command> [args...]"
  );
  process.exit(2);
}

const args = process.argv.slice(2);
const sep = args.indexOf("--");
if (sep === -1) usage();

const envPairs = args.slice(0, sep);
const command = args[sep + 1];
const commandArgs = args.slice(sep + 2);
if (!command) usage();

const env = { ...process.env, ...loadEnvFile() };
for (const pair of envPairs) {
  const eq = pair.indexOf("=");
  if (eq <= 0) {
    // eslint-disable-next-line no-console
    console.error(`Invalid env assignment: ${pair}`);
    usage();
  }
  const key = pair.slice(0, eq);
  const value = pair.slice(eq + 1);
  env[key] = value;
}

const child = spawn(command, commandArgs, {
  stdio: "inherit",
  env,
  shell: process.platform === "win32",
});

child.on("exit", (code) => {
  process.exit(code ?? 1);
});

child.on("error", (err) => {
  // eslint-disable-next-line no-console
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});

