import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { startNetworkWhitelistProxy } from "./network_proxy.ts";

function readJsonLines(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function requestViaProxy(proxy, targetUrl) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: proxy.handle.host,
        port: proxy.handle.port,
        method: "GET",
        path: targetUrl,
      },
      (res) => {
        res.resume();
        res.on("end", () => resolve(res.statusCode));
      }
    );
    req.on("error", reject);
    req.end();
  });
}

test("network proxy allows whitelisted host and logs request", async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pcc-proxy-"));
  t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  const app = http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("ok");
  });
  await new Promise((resolve) => app.listen(0, "127.0.0.1", resolve));
  const serverPort = app.address().port;
  t.after(() => app.close());

  const logPath = path.join(tmpDir, "network.log.jsonl");
  const proxy = await startNetworkWhitelistProxy({
    whitelist: ["localhost"],
    logPath,
    runId: "run-allow",
    resolveHost: async () => [{ address: "127.0.0.1", family: 4 }],
  });

  let stopped = false;
  const stopProxy = async () => {
    if (stopped) return;
    stopped = true;
    await proxy.handle.stop();
  };
  t.after(stopProxy);

  const status = await requestViaProxy(
    proxy,
    `http://localhost:${serverPort}/health`
  );
  assert.equal(status, 200);

  await stopProxy();
  const entries = readJsonLines(logPath);
  assert.ok(entries.some((entry) => entry.allowed && entry.domain === "localhost"));
});

test("network proxy blocks non-whitelisted host and reports violation", async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pcc-proxy-"));
  t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  const logPath = path.join(tmpDir, "network.log.jsonl");
  let violation = null;
  const proxy = await startNetworkWhitelistProxy({
    whitelist: ["localhost"],
    logPath,
    runId: "run-block",
    onViolation: (entry) => {
      violation = entry;
    },
  });

  let stopped = false;
  const stopProxy = async () => {
    if (stopped) return;
    stopped = true;
    await proxy.handle.stop();
  };
  t.after(stopProxy);

  const status = await requestViaProxy(proxy, "http://example.com/blocked");
  assert.equal(status, 403);

  await stopProxy();
  const entries = readJsonLines(logPath);
  assert.ok(entries.some((entry) => entry.allowed === false));
  assert.ok(violation && violation.domain === "example.com");
});
