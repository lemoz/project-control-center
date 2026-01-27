import {
  getAppVersion,
  getPccMode,
  getServerStartedAt,
  getServerUptimeSeconds,
} from "./config.js";

export type HealthResponse = {
  ok: true;
  status: "ok";
  version: string;
  uptime_seconds: number;
  started_at: string;
  mode: ReturnType<typeof getPccMode>;
  ts: string;
};

export function getHealthResponse(): HealthResponse {
  return {
    ok: true,
    status: "ok",
    version: getAppVersion(),
    uptime_seconds: getServerUptimeSeconds(),
    started_at: new Date(getServerStartedAt()).toISOString(),
    mode: getPccMode(),
    ts: new Date().toISOString(),
  };
}
