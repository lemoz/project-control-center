#!/usr/bin/env node
import fs from "fs";
import { chromium } from "playwright";

function usage() {
  const lines = [
    "Usage:",
    "  node scripts/headless-browser.mjs --url <url> [--selector <css>] [--screenshot <path>]",
    "  node scripts/headless-browser.mjs --actions-file <path>",
    "  node scripts/headless-browser.mjs --actions-json '<json>'",
    "",
    "Actions JSON is an array of steps like:",
    "[",
    "  {\"type\":\"goto\",\"url\":\"https://example.com\"},",
    "  {\"type\":\"click\",\"selector\":\"text=Sign in\"},",
    "  {\"type\":\"fill\",\"selector\":\"#email\",\"value\":\"user@example.com\"},",
    "  {\"type\":\"press\",\"selector\":\"#email\",\"key\":\"Enter\"},",
    "  {\"type\":\"waitForSelector\",\"selector\":\".results\"},",
    "  {\"type\":\"extractText\",\"selector\":\".results\",\"label\":\"results\"},",
    "  {\"type\":\"screenshot\",\"path\":\"/tmp/page.png\"}",
    "]",
  ];
  console.log(lines.join("\n"));
}

function readArg(flag, args) {
  const idx = args.indexOf(flag);
  if (idx === -1) return null;
  return args[idx + 1] ?? null;
}

function removeArg(flag, args) {
  const idx = args.indexOf(flag);
  if (idx === -1) return;
  args.splice(idx, 2);
}

function parseActions({ actionsFile, actionsJson }) {
  if (actionsFile) {
    const raw = fs.readFileSync(actionsFile, "utf8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      throw new Error("actions-file JSON must be an array");
    }
    return parsed;
  }
  if (actionsJson) {
    const parsed = JSON.parse(actionsJson);
    if (!Array.isArray(parsed)) {
      throw new Error("actions-json must be an array");
    }
    return parsed;
  }
  return [];
}

async function run() {
  const args = process.argv.slice(2);
  const url = readArg("--url", args);
  const selector = readArg("--selector", args);
  const screenshotPath = readArg("--screenshot", args);
  const actionsFile = readArg("--actions-file", args);
  const actionsJson = readArg("--actions-json", args);

  removeArg("--url", args);
  removeArg("--selector", args);
  removeArg("--screenshot", args);
  removeArg("--actions-file", args);
  removeArg("--actions-json", args);

  if (args.length > 0) {
    usage();
    throw new Error(`Unknown arguments: ${args.join(" ")}`);
  }

  let actions = parseActions({ actionsFile, actionsJson });
  if (url) {
    actions = [{ type: "goto", url }, ...actions];
  }
  if (!actions.length) {
    usage();
    throw new Error("Provide --url or --actions-file/--actions-json");
  }
  if (selector) {
    actions.push({ type: "extractText", selector, label: selector });
  }
  if (screenshotPath) {
    actions.push({ type: "screenshot", path: screenshotPath, fullPage: true });
  }

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  const outputs = [];
  const screenshots = [];

  let finalUrl = null;
  let finalTitle = null;
  try {
    for (const step of actions) {
      if (!step || typeof step !== "object") {
        throw new Error("Each action must be an object");
      }
      const action = step;
      const type = String(action.type || "").trim();
      if (!type) throw new Error("Action missing type");

      switch (type) {
        case "goto": {
          const target = String(action.url || "").trim();
          if (!target) throw new Error("goto action missing url");
          const waitUntil = action.waitUntil || "domcontentloaded";
          const timeout = Number.isFinite(action.timeoutMs) ? action.timeoutMs : 30000;
          await page.goto(target, { waitUntil, timeout });
          break;
        }
        case "click": {
          const target = String(action.selector || "").trim();
          if (!target) throw new Error("click action missing selector");
          const timeout = Number.isFinite(action.timeoutMs) ? action.timeoutMs : 15000;
          await page.click(target, { timeout });
          break;
        }
        case "fill": {
          const target = String(action.selector || "").trim();
          if (!target) throw new Error("fill action missing selector");
          const value = String(action.value ?? "");
          const timeout = Number.isFinite(action.timeoutMs) ? action.timeoutMs : 15000;
          await page.fill(target, value, { timeout });
          break;
        }
        case "press": {
          const target = String(action.selector || "").trim();
          const key = String(action.key || "").trim();
          if (!target || !key) throw new Error("press action missing selector or key");
          const timeout = Number.isFinite(action.timeoutMs) ? action.timeoutMs : 15000;
          await page.press(target, key, { timeout });
          break;
        }
        case "waitForSelector": {
          const target = String(action.selector || "").trim();
          if (!target) throw new Error("waitForSelector action missing selector");
          const timeout = Number.isFinite(action.timeoutMs) ? action.timeoutMs : 15000;
          await page.waitForSelector(target, { timeout });
          break;
        }
        case "waitForTimeout": {
          const ms = Number.isFinite(action.ms) ? action.ms : 1000;
          await page.waitForTimeout(ms);
          break;
        }
        case "extractText": {
          const target = String(action.selector || "body").trim();
          const label = String(action.label || target);
          const text = await page.locator(target).innerText();
          outputs.push({ type: "text", label, text });
          break;
        }
        case "extractHtml": {
          const target = String(action.selector || "body").trim();
          const label = String(action.label || target);
          const html = await page.locator(target).innerHTML();
          outputs.push({ type: "html", label, html });
          break;
        }
        case "screenshot": {
          const path = String(action.path || "").trim();
          if (!path) throw new Error("screenshot action missing path");
          const fullPage = action.fullPage !== false;
          await page.screenshot({ path, fullPage });
          screenshots.push({ path });
          break;
        }
        default:
          throw new Error(`Unsupported action type: ${type}`);
      }
    }
    finalUrl = page.url();
    finalTitle = await page.title().catch(() => null);
  } finally {
    await browser.close();
  }

  const result = {
    ok: true,
    url: finalUrl,
    title: finalTitle,
    outputs,
    screenshots,
  };
  console.log(JSON.stringify(result, null, 2));
}

run().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(
    JSON.stringify(
      {
        ok: false,
        error: message,
      },
      null,
      2
    )
  );
  process.exit(1);
});
