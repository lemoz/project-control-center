import { test as base, expect } from "@playwright/test";
import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { e2ePaths, resetTestEnvironment } from "./setup";

type Fixtures = {
  resetTestEnv: void;
  testRepoPath: string;
};

export const test = base.extend<Fixtures>({
  resetTestEnv: [
    async ({ request }, use) => {
      await resetTestEnvironment({ request });
      await use();
      await resetTestEnvironment();
    },
    { auto: true },
  ],
  testRepoPath: async ({}, use, testInfo) => {
    const repoName = `test-repo-${testInfo.workerIndex}-${Date.now()}`;
    const repoPath = path.join(e2ePaths.reposRoot, repoName);
    fs.mkdirSync(repoPath, { recursive: true });
    execSync("git init", { cwd: repoPath, stdio: "ignore" });
    fs.writeFileSync(path.join(repoPath, "README.md"), "# test\n", "utf8");

    await use(repoPath);

    fs.rmSync(repoPath, { recursive: true, force: true });
  },
});

export { expect };
