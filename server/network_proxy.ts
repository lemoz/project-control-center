import dns from "dns";
import fs from "fs";
import http from "http";
import https from "https";
import net from "net";
import path from "path";

export type NetworkRequestLog = {
  timestamp: string;
  run_id: string;
  domain: string;
  path: string;
  method: string;
  allowed: boolean;
  status: number;
  whitelist_matched?: string;
};

export type NetworkProxyHandle = {
  host: string;
  port: number;
  url: string;
  stop: () => Promise<void>;
};

type WhitelistEntry = {
  raw: string;
  normalized: string;
};

type ProxyOptions = {
  whitelist: string[];
  logPath: string;
  runId: string;
  bindHost?: string;
  proxyHost?: string;
  resolveHost?: (hostname: string) => Promise<dns.LookupAddress[]>;
  onViolation?: (entry: NetworkRequestLog) => void;
};

const DEFAULT_NO_PROXY: string[] = [];

function ensureDir(dir: string) {
  if (fs.existsSync(dir)) return;
  fs.mkdirSync(dir, { recursive: true });
}

function normalizeHost(value: string): string {
  let host = value.trim().toLowerCase();
  if (!host) return "";
  if (host.startsWith("[") && host.includes("]")) {
    host = host.slice(1, host.indexOf("]"));
  }
  const lastColon = host.lastIndexOf(":");
  if (lastColon > -1 && host.indexOf(":") === lastColon) {
    const port = host.slice(lastColon + 1);
    if (/^\d+$/.test(port)) host = host.slice(0, lastColon);
  }
  if (host.endsWith(".")) host = host.slice(0, -1);
  return host;
}

function compileWhitelist(entries: string[]): WhitelistEntry[] {
  const seen = new Set<string>();
  const compiled: WhitelistEntry[] = [];
  for (const raw of entries) {
    const normalized = normalizeHost(String(raw));
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    compiled.push({ raw: String(raw).trim(), normalized });
  }
  return compiled;
}

function matchWhitelist(host: string, whitelist: WhitelistEntry[]): string | null {
  const normalized = normalizeHost(host);
  if (!normalized) return null;
  for (const entry of whitelist) {
    if (normalized === entry.normalized) return entry.raw;
  }
  return null;
}

function parseProxyTarget(req: http.IncomingMessage): URL | null {
  const rawUrl = req.url ?? "";
  const hasScheme = rawUrl.startsWith("http://") || rawUrl.startsWith("https://");
  if (hasScheme) {
    try {
      const parsed = new URL(rawUrl);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
      return parsed;
    } catch {
      return null;
    }
  }
  const host = typeof req.headers.host === "string" ? req.headers.host : "";
  if (!host) return null;
  try {
    return new URL(rawUrl || "/", `http://${host}`);
  } catch {
    return null;
  }
}

function buildProxyEnv(handle: NetworkProxyHandle, extraNoProxy?: string[]): Record<string, string> {
  const noProxy = [...DEFAULT_NO_PROXY, ...(extraNoProxy ?? [])].filter(Boolean);
  const noProxyValue = Array.from(new Set(noProxy)).join(",");
  return {
    HTTP_PROXY: handle.url,
    HTTPS_PROXY: handle.url,
    ALL_PROXY: handle.url,
    NO_PROXY: noProxyValue,
    http_proxy: handle.url,
    https_proxy: handle.url,
    all_proxy: handle.url,
    no_proxy: noProxyValue,
  };
}

function parseConnectTarget(raw: string): { host: string; port: number } | null {
  if (!raw) return null;
  try {
    const parsed = new URL(`http://${raw}`);
    const port = parsed.port ? Number(parsed.port) : 443;
    if (!parsed.hostname || !Number.isFinite(port)) return null;
    return { host: parsed.hostname, port };
  } catch {
    return null;
  }
}

export async function startNetworkWhitelistProxy(options: ProxyOptions): Promise<{
  handle: NetworkProxyHandle;
  env: Record<string, string>;
}> {
  const whitelist = compileWhitelist(options.whitelist);
  const bindHost = options.bindHost?.trim() || "127.0.0.1";
  const proxyHost = options.proxyHost?.trim() || bindHost;
  const resolveHost =
    options.resolveHost ??
    (async (hostname: string) => dns.promises.lookup(hostname, { all: true }));
  const lookup: dns.LookupFunction | undefined =
    options.resolveHost === undefined
      ? undefined
      : (hostname, _options, callback) => {
          const wantsAll =
            typeof _options === "object" &&
            _options !== null &&
            "all" in _options &&
            Boolean((_options as dns.LookupOptions).all);
          resolveHost(hostname)
            .then((addresses) => {
              if (!addresses.length) {
                if (wantsAll) {
                  callback(new Error("DNS lookup failed"), []);
                  return;
                }
                callback(new Error("DNS lookup failed"), "", 4);
                return;
              }
              if (wantsAll) {
                callback(null, addresses);
                return;
              }
              callback(null, addresses[0].address, addresses[0].family);
            })
            .catch((err) => {
              if (wantsAll) {
                callback(err as NodeJS.ErrnoException, []);
                return;
              }
              callback(err as NodeJS.ErrnoException, "", 4);
            });
        };

  ensureDir(path.dirname(options.logPath));
  const logStream = fs.createWriteStream(options.logPath, { flags: "a" });
  let logClosed = false;
  logStream.on("close", () => {
    logClosed = true;
  });

  const logRequest = (entry: NetworkRequestLog) => {
    if (logClosed) return;
    try {
      logStream.write(`${JSON.stringify(entry)}\n`);
    } catch {
      // ignore log failures
    }
  };

  const logBlocked = (entry: NetworkRequestLog) => {
    logRequest(entry);
    options.onViolation?.(entry);
  };

  const server = http.createServer(async (req, res) => {
    const targetUrl = parseProxyTarget(req);
    const method = req.method ?? "GET";
    if (!targetUrl) {
      const entry: NetworkRequestLog = {
        timestamp: new Date().toISOString(),
        run_id: options.runId,
        domain: "",
        path: req.url ?? "",
        method,
        allowed: false,
        status: 400,
      };
      logBlocked(entry);
      res.writeHead(400, { "Content-Type": "text/plain" });
      res.end("Invalid proxy request.");
      return;
    }

    const hostname = targetUrl.hostname;
    const match = matchWhitelist(hostname, whitelist);
    if (!match) {
      const entry: NetworkRequestLog = {
        timestamp: new Date().toISOString(),
        run_id: options.runId,
        domain: hostname,
        path: `${targetUrl.pathname}${targetUrl.search}`,
        method,
        allowed: false,
        status: 403,
      };
      logBlocked(entry);
      res.writeHead(403, { "Content-Type": "text/plain" });
      res.end("Blocked by network whitelist.");
      return;
    }

    const protocol = targetUrl.protocol === "https:" ? "https:" : "http:";
    const port = targetUrl.port
      ? Number(targetUrl.port)
      : protocol === "https:"
        ? 443
        : 80;
    const pathValue = `${targetUrl.pathname}${targetUrl.search}`;
    const headers = { ...req.headers };
    delete headers["proxy-connection"];
    delete headers["proxy-authorization"];
    headers.host = targetUrl.host;

    const entryBase = {
      timestamp: new Date().toISOString(),
      run_id: options.runId,
      domain: hostname,
      path: pathValue,
      method,
      allowed: true,
      whitelist_matched: match,
    };

    let logged = false;
    const finalizeLog = (status: number) => {
      if (logged) return;
      logged = true;
      logRequest({ ...entryBase, status });
    };

    const client = protocol === "https:" ? https : http;
    const proxyReq = client.request(
      {
        hostname,
        port,
        method,
        path: pathValue,
        headers,
        lookup,
      },
      (proxyRes) => {
        res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers);
        proxyRes.pipe(res);
        proxyRes.on("end", () => finalizeLog(proxyRes.statusCode ?? 502));
        proxyRes.on("close", () => finalizeLog(proxyRes.statusCode ?? 502));
      }
    );
    proxyReq.on("error", () => {
      finalizeLog(502);
      res.writeHead(502, { "Content-Type": "text/plain" });
      res.end("Proxy request failed.");
    });
    req.pipe(proxyReq);
  });

  server.on("connect", (req, clientSocket, head) => {
    const target = parseConnectTarget(req.url ?? "");
    const method = req.method ?? "CONNECT";
    if (!target) {
      const entry: NetworkRequestLog = {
        timestamp: new Date().toISOString(),
        run_id: options.runId,
        domain: "",
        path: req.url ?? "",
        method,
        allowed: false,
        status: 400,
      };
      logBlocked(entry);
      clientSocket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
      clientSocket.destroy();
      return;
    }

    const match = matchWhitelist(target.host, whitelist);
    if (!match) {
      const entry: NetworkRequestLog = {
        timestamp: new Date().toISOString(),
        run_id: options.runId,
        domain: target.host,
        path: "(tunnel)",
        method,
        allowed: false,
        status: 403,
      };
      logBlocked(entry);
      clientSocket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
      clientSocket.destroy();
      return;
    }

    const entryBase = {
      timestamp: new Date().toISOString(),
      run_id: options.runId,
      domain: target.host,
      path: "(tunnel)",
      method,
      allowed: true,
      whitelist_matched: match,
    };
    let logged = false;
    const finalizeLog = (status: number) => {
      if (logged) return;
      logged = true;
      logRequest({ ...entryBase, status });
    };

    const connectToTarget = async () => {
      try {
        const addresses = await resolveHost(target.host);
        if (!addresses.length) {
          throw new Error("DNS lookup failed");
        }
        const address = addresses[0].address;
        const serverSocket = net.connect(target.port, address, () => {
          clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
          if (head && head.length) serverSocket.write(head);
          serverSocket.pipe(clientSocket);
          clientSocket.pipe(serverSocket);
          finalizeLog(200);
        });
        serverSocket.on("error", () => {
          finalizeLog(502);
          clientSocket.write("HTTP/1.1 502 Bad Gateway\r\n\r\n");
          clientSocket.destroy();
        });
      } catch {
        finalizeLog(502);
        clientSocket.write("HTTP/1.1 502 Bad Gateway\r\n\r\n");
        clientSocket.destroy();
      }
    };
    void connectToTarget();
  });

  server.on("clientError", (err, socket) => {
    if (err) {
      socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
    }
  });

  await new Promise<void>((resolve) => {
    server.listen(0, bindHost, () => resolve());
  });

  const address = server.address() as net.AddressInfo;
  const handle: NetworkProxyHandle = {
    host: proxyHost,
    port: address.port,
    url: `http://${proxyHost}:${address.port}`,
    stop: async () => {
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
      await new Promise<void>((resolve) => {
        logStream.end(() => resolve());
      });
    },
  };

  return { handle, env: buildProxyEnv(handle) };
}
