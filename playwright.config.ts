import { defineConfig, devices } from "@playwright/test";
import path from "path";
import { fileURLToPath } from "url";

const webPort = Number(process.env.E2E_WEB_PORT || 3012);
const offlineWebPort = Number(process.env.E2E_OFFLINE_WEB_PORT || 3013);
const apiPort = Number(process.env.E2E_API_PORT || process.env.CONTROL_CENTER_PORT || 4011);
const runId = process.env.E2E_RUN_ID;

const repoRoot = path.dirname(fileURLToPath(import.meta.url));
const tmpDir = path.join(repoRoot, "e2e", ".tmp");
const fixtureReposRoot = path.join(tmpDir, "repos");
const dbPath = path.join(tmpDir, "control-center-test.db");
const outputDir = runId ? path.join("test-results", runId) : "test-results";
const reportDir = runId
  ? path.join("playwright-report", runId)
  : "playwright-report";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [
    ["list"],
    ["json", { outputFile: path.join(outputDir, "report.json") }],
    ["html", { open: "never", outputFolder: reportDir }],
  ],
  outputDir,
  globalSetup: "./e2e/global-setup.ts",
  use: {
    baseURL: `http://localhost:${webPort}`,
    trace: "retain-on-failure",
    video: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium-desktop",
      use: { ...devices["Desktop Chrome"], browserName: "chromium" },
    },
    {
      name: "chromium-mobile",
      use: { ...devices["iPhone SE"], browserName: "chromium" },
    },
  ],
  webServer: [
    {
      command: "node server/dist/index.js",
      port: apiPort,
      reuseExistingServer: false,
      env: {
        ...process.env,
        CONTROL_CENTER_PORT: String(apiPort),
        CONTROL_CENTER_HOST: "127.0.0.1",
        CONTROL_CENTER_DB_PATH: dbPath,
        CONTROL_CENTER_SCAN_ROOTS: fixtureReposRoot,
        CONTROL_CENTER_SCAN_MAX_DEPTH: "2",
        CONTROL_CENTER_SCAN_TTL_MS: "0",
      },
    },
    {
      command: `node_modules/.bin/next start -H 127.0.0.1 -p ${webPort}`,
      port: webPort,
      reuseExistingServer: false,
      env: {
        ...process.env,
        NEXT_PUBLIC_API_BASE_URL: `http://localhost:${apiPort}`,
        CONTROL_CENTER_INTERNAL_API_BASE_URL: `http://localhost:${apiPort}`,
      },
    },
    {
      command: `node_modules/.bin/next start -H 127.0.0.1 -p ${offlineWebPort}`,
      port: offlineWebPort,
      reuseExistingServer: false,
      env: {
        ...process.env,
        NEXT_PUBLIC_API_BASE_URL: "http://localhost:59999",
        CONTROL_CENTER_INTERNAL_API_BASE_URL: "http://localhost:59999",
      },
    },
  ],
});
