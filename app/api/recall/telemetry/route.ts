import { NextResponse } from "next/server";
import { appendFile } from "node:fs/promises";

const DEFAULT_LOG_PATH = "/tmp/recall-output-media.jsonl";
const TELEMETRY_ENABLED = process.env.RECALL_TELEMETRY_ENABLED === "true";
const TELEMETRY_TOKEN = process.env.RECALL_TELEMETRY_TOKEN ?? "";

function isAuthorized(request: Request): boolean {
  if (!TELEMETRY_TOKEN) return false;
  const headerToken = request.headers.get("x-recall-telemetry-token");
  if (headerToken === TELEMETRY_TOKEN) return true;
  const url = new URL(request.url);
  const queryToken = url.searchParams.get("token");
  return queryToken === TELEMETRY_TOKEN;
}

export async function POST(request: Request) {
  if (!TELEMETRY_ENABLED) {
    return NextResponse.json({ error: "telemetry disabled" }, { status: 403 });
  }
  if (!TELEMETRY_TOKEN) {
    return NextResponse.json(
      { error: "telemetry token not configured" },
      { status: 403 }
    );
  }
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 403 });
  }

  const payload = await request.json().catch(() => null);
  if (!payload || typeof payload !== "object") {
    return NextResponse.json({ error: "invalid payload" }, { status: 400 });
  }

  const record = {
    received_at: new Date().toISOString(),
    ...payload,
  };
  const logPath = process.env.RECALL_TELEMETRY_LOG_PATH || DEFAULT_LOG_PATH;
  await appendFile(logPath, `${JSON.stringify(record)}\n`);

  return NextResponse.json({ ok: true });
}
