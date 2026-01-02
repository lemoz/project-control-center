import { expect, test } from "@playwright/test";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import Database from "better-sqlite3";

const e2eDir = path.dirname(fileURLToPath(import.meta.url));

async function repoIdFromCard(card: import("@playwright/test").Locator): Promise<string> {
  const href = await card.locator("a.stretchedLink").getAttribute("href");
  if (!href) throw new Error("repo card missing href");
  const parts = href.split("/").filter(Boolean);
  return parts.at(-1) || href;
}

function waitForStarPatch(page: import("@playwright/test").Page, repoId: string) {
  const expectedPath = `/api/repos/${encodeURIComponent(repoId)}/star`;
  return page.waitForResponse(
    (res) =>
      res.request().method() === "PATCH" &&
      new URL(res.url()).pathname === expectedPath
  );
}

function trackPageErrors(page: import("@playwright/test").Page) {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  return errors;
}

test.describe("Project Control Center smoke", () => {
  test("Server health + repo scan endpoints respond", async ({ request }) => {
    const apiPort = Number(process.env.E2E_API_PORT || process.env.CONTROL_CENTER_PORT || 4011);
    const apiBase = `http://127.0.0.1:${apiPort}`;

    const health = await request.get(`${apiBase}/health`);
    expect(health.ok()).toBe(true);
    const healthJson = (await health.json()) as { ok?: boolean };
    expect(healthJson.ok).toBe(true);

    const scan = await request.post(`${apiBase}/repos/scan`);
    expect(scan.ok()).toBe(true);
    const scanJson = (await scan.json()) as { ok?: boolean; repos?: unknown };
    expect(scanJson.ok).toBe(true);
    expect(Array.isArray(scanJson.repos)).toBe(true);

    const repos = await request.get(`${apiBase}/repos`);
    expect(repos.ok()).toBe(true);
    const reposJson = (await repos.json()) as Array<{ name?: unknown }> | unknown;
    expect(Array.isArray(reposJson)).toBe(true);
    const repoNames = Array.isArray(reposJson)
      ? reposJson
          .map((r) => (typeof r?.name === "string" ? r.name : null))
          .filter((name): name is string => typeof name === "string")
      : [];
    expect(repoNames).toEqual(expect.arrayContaining(["alpha", "beta"]));
  });

  test("Portfolio loads without crashing", async ({ page }) => {
    const errors = trackPageErrors(page);
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Portfolio" })).toBeVisible();
    expect(errors, `Console/page errors: ${errors.join("\n")}`).toEqual([]);
  });

  test("Sidecar metadata renders on repo card", async ({ page }) => {
    await page.goto("/");
    const alphaCard = page.locator(".grid .card.cardLink", { hasText: "alpha" });
    await expect(alphaCard.getByText("long_term")).toBeVisible();
    await expect(alphaCard.getByText("building")).toBeVisible();
    await expect(alphaCard.getByText("active")).toBeVisible();
    await expect(alphaCard.getByText("p2")).toBeVisible();
    await expect(alphaCard.getByText("demo")).toBeVisible();
    await expect(alphaCard.getByText("sidecar")).toBeVisible();
  });

  test("Star/unstar reorder persists after refresh", async ({ page }) => {
    await page.goto("/");
    const cards = page.locator(".grid .card.cardLink");

    await expect(cards.first()).toContainText("alpha");

    const betaCard = page.locator(".grid .card.cardLink", { hasText: "beta" });
    const betaId = await repoIdFromCard(betaCard);
    const starResponse = waitForStarPatch(page, betaId);
    await betaCard.locator('button[aria-label="Star project"]').click();
    expect((await starResponse).ok()).toBe(true);

    await page.reload();
    await expect(cards.first()).toContainText("beta");

    const betaCardAfter = page.locator(".grid .card.cardLink", { hasText: "beta" });
    const betaIdAfter = await repoIdFromCard(betaCardAfter);
    const unstarResponse = waitForStarPatch(page, betaIdAfter);
    await betaCardAfter.locator('button[aria-label="Unstar project"]').click();
    expect((await unstarResponse).ok()).toBe(true);

    await page.reload();
    await expect(cards.first()).toContainText("alpha");
  });

  test("Star persists across repo ID migration", async ({ page }) => {
    await page.goto("/");
    const cards = page.locator(".grid .card.cardLink");

    await expect(cards.first()).toContainText("alpha");

    const betaCard = page.locator(".grid .card.cardLink", { hasText: "beta" });
    const betaId = await repoIdFromCard(betaCard);
    const starResponse = waitForStarPatch(page, betaId);
    await betaCard.locator('button[aria-label="Star project"]').click();
    expect((await starResponse).ok()).toBe(true);

    const betaControlPath = path.join(
      e2eDir,
      ".tmp",
      "repos",
      "beta",
      ".control.yml"
    );
    fs.writeFileSync(betaControlPath, "id: beta-stable\n", "utf8");

    await page.reload();
    await expect(cards.first()).toContainText("beta");

    const betaCardAfter = page.locator(".grid .card.cardLink", { hasText: "beta" });
    await expect(betaCardAfter.locator("a.stretchedLink")).toHaveAttribute(
      "href",
      "/projects/beta-stable"
    );

    const unstarResponse = waitForStarPatch(page, "beta-stable");
    await betaCardAfter.locator('button[aria-label="Unstar project"]').click();
    expect((await unstarResponse).ok()).toBe(true);

    await page.reload();
    await expect(cards.first()).toContainText("alpha");
  });

  test("Star preserved when merging duplicate rows", async ({ page }) => {
    const tmpDir = path.join(e2eDir, ".tmp");
    const dbPath = path.join(tmpDir, "control-center-test.db");
    const betaRepoPath = path.join(tmpDir, "repos", "beta");
    const betaControlPath = path.join(betaRepoPath, ".control.yml");

    fs.writeFileSync(betaControlPath, "id: beta-stable\n", "utf8");
    await page.goto("/");

    const db = new Database(dbPath);
    const now = new Date().toISOString();

    db.prepare("UPDATE projects SET starred = 0, updated_at = ? WHERE id = ?").run(
      now,
      "beta-stable"
    );
    db.prepare("DELETE FROM projects WHERE id = ?").run("beta-dup");
    db.prepare(
      `INSERT INTO projects
        (id, path, name, description, type, stage, status, priority, starred, tags, last_run_at, created_at, updated_at)
       VALUES
        (@id, @path, @name, @description, @type, @stage, @status, @priority, @starred, @tags, @last_run_at, @created_at, @updated_at)`
    ).run({
      id: "beta-dup",
      path: betaRepoPath,
      name: "beta",
      description: null,
      type: "prototype",
      stage: "idea",
      status: "active",
      priority: 3,
      starred: 1,
      tags: "[]",
      last_run_at: null,
      created_at: now,
      updated_at: now,
    });

    db.exec(
      `CREATE TABLE IF NOT EXISTS project_notes (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        note TEXT NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      );`
    );
    db.prepare(
      "INSERT OR REPLACE INTO project_notes (id, project_id, note) VALUES (?, ?, ?)"
    ).run("beta-note", "beta-dup", "hello");
    db.close();

    await page.reload();

    const dbAfter = new Database(dbPath);
    const note = dbAfter
      .prepare("SELECT project_id FROM project_notes WHERE id = ? LIMIT 1")
      .get("beta-note") as { project_id: string } | undefined;
    expect(note?.project_id).toBe("beta-stable");
    const dupProject = dbAfter
      .prepare("SELECT id FROM projects WHERE id = ? LIMIT 1")
      .get("beta-dup") as { id: string } | undefined;
    expect(dupProject).toBeUndefined();
    dbAfter.close();

    const cards = page.locator(".grid .card.cardLink");
    await expect(cards.first()).toContainText("beta");

    const betaCard = page.locator(".grid .card.cardLink", { hasText: "beta" });
    await expect(betaCard.locator('button[aria-label="Unstar project"]')).toBeVisible();

    const unstarResponse = waitForStarPatch(page, "beta-stable");
    await betaCard.locator('button[aria-label="Unstar project"]').click();
    expect((await unstarResponse).ok()).toBe(true);

    await page.reload();
    await expect(cards.first()).toContainText("alpha");
  });

  test("Repo move preserves stable sidecar id and history", async ({ page }) => {
    const tmpDir = path.join(e2eDir, ".tmp");
    const betaRepoPath = path.join(tmpDir, "repos", "beta");
    const movedRepoPath = path.join(tmpDir, "repos", "beta-moved");
    const betaControlPath = path.join(betaRepoPath, ".control.yml");

    fs.writeFileSync(betaControlPath, "id: beta-stable\n", "utf8");
    await page.goto("/");

    const betaCard = page.locator(".grid .card.cardLink", { hasText: "beta" });
    await expect(betaCard.locator("a.stretchedLink")).toHaveAttribute(
      "href",
      "/projects/beta-stable"
    );

    if (await betaCard.locator('button[aria-label="Star project"]').isVisible()) {
      const starResponse = waitForStarPatch(page, "beta-stable");
      await betaCard.locator('button[aria-label="Star project"]').click();
      expect((await starResponse).ok()).toBe(true);
    }

    fs.renameSync(betaRepoPath, movedRepoPath);
    try {
      await page.reload();
      const betaAfter = page.locator(".grid .card.cardLink", { hasText: "beta" });
      await expect(betaAfter.locator("a.stretchedLink")).toHaveAttribute(
        "href",
        "/projects/beta-stable"
      );
      await expect(betaAfter).toContainText("beta-moved");
      await expect(
        betaAfter.locator('button[aria-label="Unstar project"]')
      ).toBeVisible();
    } finally {
      if (fs.existsSync(movedRepoPath)) {
        fs.renameSync(movedRepoPath, betaRepoPath);
      }
    }

    await page.reload();
    const betaRestored = page.locator(".grid .card.cardLink", { hasText: "beta" });
    if (await betaRestored.locator('button[aria-label="Unstar project"]').isVisible()) {
      const unstarResponse = waitForStarPatch(page, "beta-stable");
      await betaRestored.locator('button[aria-label="Unstar project"]').click();
      expect((await unstarResponse).ok()).toBe(true);
    }
  });

  test("Invalid tags JSON never crashes /repos", async ({ page }) => {
    const tmpDir = path.join(e2eDir, ".tmp");
    const dbPath = path.join(tmpDir, "control-center-test.db");
    const betaRepoPath = path.join(tmpDir, "repos", "beta");
    const betaControlPath = path.join(betaRepoPath, ".control.yml");

    fs.writeFileSync(betaControlPath, "id: beta-stable\n", "utf8");
    await page.goto("/");

    const db = new Database(dbPath);
    db.prepare("UPDATE projects SET tags = ? WHERE path = ?").run(
      "{not valid json",
      betaRepoPath
    );
    db.close();

    const errors = trackPageErrors(page);
    await page.reload();
    await expect(page.locator(".grid .card.cardLink", { hasText: "beta" })).toBeVisible();
    expect(errors, `Console/page errors: ${errors.join("\n")}`).toEqual([]);

    const dbAfter = new Database(dbPath);
    const row = dbAfter
      .prepare("SELECT tags FROM projects WHERE path = ? LIMIT 1")
      .get(betaRepoPath) as { tags: string } | undefined;
    expect(row?.tags).toBe("[]");
    dbAfter.close();
  });

  test("Project page renders Kanban columns", async ({ page }) => {
    await page.goto("/");
    const alphaCard = page.locator(".grid .card.cardLink", { hasText: "alpha" });
    await alphaCard.locator("a.stretchedLink").click();

    await expect(page.locator(".board")).toBeVisible();
    await expect(page.getByText("Backlog")).toBeVisible();
    await expect(page.getByText("Ready")).toBeVisible();
    await expect(page.getByText("Building")).toBeVisible();
    await expect(page.getByText("Done")).toBeVisible();
  });

  test("Server offline fallback renders", async ({ page }) => {
    const offlinePort = Number(process.env.E2E_OFFLINE_WEB_PORT || 3013);
    await page.goto(`http://localhost:${offlinePort}/`);
    await expect(page.getByRole("heading", { name: "Portfolio" })).toBeVisible();
    await expect(page.getByText("server offline or empty")).toBeVisible();
    await expect(page.getByText("No repos yet")).toBeVisible();
  });
});
