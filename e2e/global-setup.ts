import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { fileURLToPath } from "url";

export default async function globalSetup() {
  const e2eDir = path.dirname(fileURLToPath(import.meta.url));
  const tmpDir = path.join(e2eDir, ".tmp");
  const reposRoot = path.join(tmpDir, "repos");

  if (fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
  fs.mkdirSync(reposRoot, { recursive: true });

  const dbBase = path.join(tmpDir, "control-center-test.db");
  for (const suffix of ["", "-shm", "-wal"]) {
    const p = `${dbBase}${suffix}`;
    if (fs.existsSync(p)) fs.rmSync(p, { force: true });
  }

  const repos = ["alpha", "beta"];
  for (const name of repos) {
    const dir = path.join(reposRoot, name);
    fs.mkdirSync(dir, { recursive: true });
    const gitDir = path.join(dir, ".git");
    if (!fs.existsSync(gitDir)) {
      execSync("git init", { cwd: dir, stdio: "ignore" });
    }
    const readme = path.join(dir, "README.md");
    if (!fs.existsSync(readme)) {
      fs.writeFileSync(readme, `# ${name}\n`, "utf8");
    }
  }

  const alphaControlPath = path.join(reposRoot, "alpha", ".control.yml");
  fs.writeFileSync(
    alphaControlPath,
    `type: long_term\nstage: building\nstatus: active\npriority: 2\ntags:\n  - demo\n  - sidecar\n`,
    "utf8"
  );
}
