import { spawn } from "node:child_process";

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

const env = { ...process.env };
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

