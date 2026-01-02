import { spawnSync } from "node:child_process";
import path from "node:path";

function npmCommand() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

function playwrightCommand() {
  const bin = process.platform === "win32" ? "playwright.cmd" : "playwright";
  return path.join(process.cwd(), "node_modules", ".bin", bin);
}

function run(command, args, env) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    env,
    shell: process.platform === "win32",
  });
  const code = result.status ?? 1;
  if (code !== 0) process.exit(code);
}

const env = { ...process.env };

if (!env.NEXT_DIST_DIR) env.NEXT_DIST_DIR = ".system/next-e2e";
if (!env.E2E_API_PORT) env.E2E_API_PORT = env.CONTROL_CENTER_PORT || "4011";
if (!env.E2E_WEB_PORT) env.E2E_WEB_PORT = "3012";
if (!env.E2E_OFFLINE_WEB_PORT) env.E2E_OFFLINE_WEB_PORT = "3013";

run(npmCommand(), ["run", "build"], env);
run(npmCommand(), ["run", "server:build"], env);
run(playwrightCommand(), ["test"], env);

