import { spawn, spawnSync } from "child_process";
import dns from "dns";
import fs from "fs";
import net from "net";
import os from "os";
import path from "path";

export type NetworkFirewallHandle = {
  resolveHost: (hostname: string) => Promise<dns.LookupAddress[]>;
  allowLoopbackTcpPorts?: (ports: number[]) => void;
  stop: () => Promise<void>;
};

export type FirewallViolation = {
  timestamp: string;
  address: string;
  port?: number;
  protocol?: string;
  reason?: string;
};

type ViolationCallback = (violation: FirewallViolation) => void;

type FirewallOptions = {
  whitelist: string[];
  runId: string;
  log?: (line: string) => void;
  onViolation?: ViolationCallback;
  containerMode?: boolean;
  extraAllowHosts?: string[];
  restrictUid?: number;
  proxyOnly?: boolean;
};

type FirewallBackend = {
  allowAddresses: (addresses: dns.LookupAddress[]) => void;
  allowLoopbackTcpPorts?: (ports: number[]) => void;
  stop: () => Promise<void>;
  enableContainerRules?: () => boolean;
};

type FirewallLogMonitor = {
  stop: () => void;
};

type ResolvedWhitelist = {
  addresses: dns.LookupAddress[];
  byHost: Map<string, dns.LookupAddress[]>;
};

type ActiveFirewall = {
  backend: FirewallBackend;
  resolveHost: (hostname: string) => Promise<dns.LookupAddress[]>;
  refCount: number;
  callbacks: Set<ViolationCallback>;
  hostAddresses: Map<string, dns.LookupAddress[]>;
  containerEnabled: boolean;
  proxyOnly: boolean;
  restrictUid?: number;
};

let activeFirewall: ActiveFirewall | null = null;
let stubFirewallState: {
  guardId: string;
  allowed: dns.LookupAddress[];
  loopbackTcpPorts: number[];
  containerEnabled: boolean;
  stopped: boolean;
} | null = null;

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

function buildGuardId(runId: string): string {
  const cleaned = runId.replace(/[^a-z0-9]/gi, "").toLowerCase();
  return cleaned.slice(0, 8) || "default";
}

function mergeWhitelistMap(
  target: Map<string, dns.LookupAddress[]>,
  incoming: Map<string, dns.LookupAddress[]>
): void {
  for (const [host, addresses] of incoming.entries()) {
    if (target.has(host)) continue;
    target.set(host, addresses);
  }
}

function hasRootPrivileges(): boolean {
  if (typeof process.geteuid !== "function") return false;
  return process.geteuid() === 0;
}

function readFirewallMode(): "auto" | "enabled" | "disabled" {
  const raw = (
    process.env.PCC_NETWORK_FIREWALL ||
    process.env.CONTROL_CENTER_NETWORK_FIREWALL ||
    "auto"
  )
    .trim()
    .toLowerCase();
  if (!raw || raw === "auto") return "auto";
  if (["1", "true", "enabled", "on"].includes(raw)) return "enabled";
  if (["0", "false", "disabled", "off"].includes(raw)) return "disabled";
  return "auto";
}

function readFirewallBackendOverride(): "stub" | null {
  const raw = (process.env.PCC_NETWORK_FIREWALL_BACKEND || "").trim().toLowerCase();
  if (!raw) return null;
  if (["stub", "test", "mock"].includes(raw)) return "stub";
  return null;
}

function shouldEnableFirewall(log?: (line: string) => void): boolean {
  const mode = readFirewallMode();
  if (mode === "disabled") {
    log?.("[network-firewall] firewall disabled by PCC_NETWORK_FIREWALL.");
    return false;
  }
  if (!hasRootPrivileges()) {
    log?.("[network-firewall] root privileges required; firewall guard disabled.");
    return false;
  }
  return true;
}

function canRunCommand(
  command: string,
  args: string[],
  log?: (line: string) => void
): boolean {
  const result = spawnSync(command, args, {
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
  });
  if (result.error) {
    const code = (result.error as NodeJS.ErrnoException).code;
    log?.(
      `[network-firewall] ${command} unavailable${code ? ` (${code})` : ""}.`
    );
    return false;
  }
  if ((result.status ?? 1) !== 0) {
    const message = result.stderr.trim() || result.stdout.trim() || "command failed";
    log?.(`[network-firewall] ${command} check failed: ${message}`);
    return false;
  }
  return true;
}

function chainExists(command: string, chain: string): boolean {
  const result = spawnSync(command, ["-S", chain], {
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
  });
  if (result.error) return false;
  return (result.status ?? 1) === 0;
}

async function resolveWhitelistEntries(
  entries: string[],
  log?: (line: string) => void,
  cache?: Map<string, dns.LookupAddress[]>,
  allowDns = true
): Promise<ResolvedWhitelist> {
  const hosts = entries
    .map((entry) => normalizeHost(String(entry)))
    .filter(Boolean);
  const seen = new Set<string>();
  const addresses: dns.LookupAddress[] = [];
  const byHost = new Map<string, dns.LookupAddress[]>();
  for (const host of hosts) {
    if (seen.has(host)) continue;
    seen.add(host);
    const cached = cache?.get(host);
    if (cached && cached.length) {
      byHost.set(host, cached);
      addresses.push(...cached);
      continue;
    }
    const ipFamily = net.isIP(host);
    if (ipFamily) {
      const entryAddresses = [{ address: host, family: ipFamily }];
      byHost.set(host, entryAddresses);
      addresses.push(...entryAddresses);
      continue;
    }
    if (!allowDns) {
      log?.(
        `[network-firewall] skipping DNS lookup for ${host} while firewall is active.`
      );
      continue;
    }
    try {
      const resolved = await dns.promises.lookup(host, { all: true });
      if (!resolved.length) {
        log?.(`[network-firewall] whitelist host ${host} resolved to no addresses.`);
        continue;
      }
      byHost.set(host, resolved);
      addresses.push(...resolved);
    } catch (err) {
      log?.(`[network-firewall] failed to resolve whitelist host ${host}: ${String(err)}`);
    }
  }
  return { addresses, byHost };
}

async function resolveExtraAllowHosts(
  entries: string[],
  log?: (line: string) => void,
  allowDns = true
): Promise<dns.LookupAddress[]> {
  if (!entries.length) return [];
  const resolved = await resolveWhitelistEntries(entries, log, undefined, allowDns);
  return resolved.addresses;
}

function execCommand(
  command: string,
  args: string[],
  opts: { allowFailure?: boolean; log?: (line: string) => void }
): void {
  const result = spawnSync(command, args, {
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
  });
  if ((result.status ?? 1) !== 0) {
    const message = result.stderr.trim() || result.stdout.trim() || "command failed";
    if (opts.allowFailure) {
      opts.log?.(`[network-firewall] ${command} ${args.join(" ")} failed: ${message}`);
      return;
    }
    throw new Error(`${command} ${args.join(" ")} failed: ${message}`);
  }
}

function parseIptablesLogLine(line: string): {
  address: string;
  port?: number;
  protocol?: string;
} | null {
  const dstMatch = /\bDST=([0-9a-fA-F:.]+)\b/.exec(line);
  if (!dstMatch) return null;
  const portMatch = /\bDPT=(\d+)\b/.exec(line);
  const protoMatch = /\bPROTO=([A-Z]+)\b/.exec(line);
  const port = portMatch ? Number(portMatch[1]) : undefined;
  const protocol = protoMatch ? protoMatch[1] : undefined;
  return { address: dstMatch[1], port, protocol };
}

function startIptablesLogMonitor(
  prefix: string,
  onViolation: ViolationCallback,
  log?: (line: string) => void
): FirewallLogMonitor | null {
  const monitor = spawn("dmesg", ["-w"], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (!monitor.stdout) {
    monitor.kill();
    return null;
  }
  let buffer = "";
  const handleLine = (line: string) => {
    if (!line.includes(prefix)) return;
    const parsed = parseIptablesLogLine(line);
    if (!parsed) return;
    onViolation({
      timestamp: new Date().toISOString(),
      address: parsed.address,
      port: parsed.port,
      protocol: parsed.protocol,
      reason: "firewall blocked outbound traffic",
    });
  };
  const onData = (chunk: Buffer) => {
    buffer += chunk.toString("utf8");
    let index = buffer.indexOf("\n");
    while (index >= 0) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (line) handleLine(line);
      index = buffer.indexOf("\n");
    }
  };
  const onError = (err: Error) => {
    log?.(`[network-firewall] dmesg monitor error: ${err.message}`);
  };
  const onExit = (code: number | null) => {
    if (code !== null) {
      log?.(`[network-firewall] dmesg monitor exited (${code}).`);
    }
  };
  monitor.stdout.on("data", onData);
  monitor.stderr?.on("data", (chunk) => {
    const text = chunk.toString("utf8").trim();
    if (text) log?.(`[network-firewall] dmesg: ${text}`);
  });
  monitor.on("error", onError);
  monitor.on("exit", onExit);
  return {
    stop: () => {
      monitor.stdout?.off("data", onData);
      monitor.off("error", onError);
      monitor.off("exit", onExit);
      if (!monitor.killed) monitor.kill();
    },
  };
}

function parsePfLogLine(line: string): {
  address: string;
  port?: number;
  protocol?: string;
} | null {
  if (!line.includes("block")) return null;
  const match = / > ([0-9a-fA-F:.]+)\.(\d+):/.exec(line);
  if (!match) return null;
  const port = Number(match[2]);
  const protocol = line.includes("UDP,")
    ? "UDP"
    : line.includes("Flags")
      ? "TCP"
      : undefined;
  return { address: match[1], port, protocol };
}

function startPfLogMonitor(
  onViolation: ViolationCallback,
  log?: (line: string) => void
): FirewallLogMonitor | null {
  const monitor = spawn("tcpdump", ["-n", "-tt", "-l", "-i", "pflog0"], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (!monitor.stdout) {
    monitor.kill();
    return null;
  }
  let buffer = "";
  const handleLine = (line: string) => {
    const parsed = parsePfLogLine(line);
    if (!parsed) return;
    onViolation({
      timestamp: new Date().toISOString(),
      address: parsed.address,
      port: parsed.port,
      protocol: parsed.protocol,
      reason: "firewall blocked outbound traffic",
    });
  };
  const onData = (chunk: Buffer) => {
    buffer += chunk.toString("utf8");
    let index = buffer.indexOf("\n");
    while (index >= 0) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (line) handleLine(line);
      index = buffer.indexOf("\n");
    }
  };
  const onError = (err: Error) => {
    log?.(`[network-firewall] pflog monitor error: ${err.message}`);
  };
  const onExit = (code: number | null) => {
    if (code !== null) {
      log?.(`[network-firewall] pflog monitor exited (${code}).`);
    }
  };
  monitor.stdout.on("data", onData);
  monitor.stderr?.on("data", (chunk) => {
    const text = chunk.toString("utf8").trim();
    if (text) log?.(`[network-firewall] tcpdump: ${text}`);
  });
  monitor.on("error", onError);
  monitor.on("exit", onExit);
  return {
    stop: () => {
      monitor.stdout?.off("data", onData);
      monitor.off("error", onError);
      monitor.off("exit", onExit);
      if (!monitor.killed) monitor.kill();
    },
  };
}

function readPfEnabled(log?: (line: string) => void): boolean | null {
  const result = spawnSync("pfctl", ["-s", "info"], {
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
  });
  if ((result.status ?? 1) !== 0) {
    const message = result.stderr.trim() || result.stdout.trim() || "command failed";
    log?.(`[network-firewall] pfctl -s info failed: ${message}`);
    return null;
  }
  const output = `${result.stdout}\n${result.stderr}`;
  const match = /Status:\s*(Enabled|Disabled)/i.exec(output);
  if (!match) return null;
  return match[1].toLowerCase() === "enabled";
}

function startIptablesGuard(
  guardId: string,
  options?: {
    log?: (line: string) => void;
    onViolation?: ViolationCallback;
    restrictUid?: number;
    skipOutput?: boolean;
    allowLoopback?: boolean;
  }
): FirewallBackend {
  const log = options?.log;
  const onViolation = options?.onViolation;
  const restrictUid = options?.restrictUid;
  const skipOutput = options?.skipOutput ?? false;
  const allowLoopback = options?.allowLoopback ?? true;
  const allowInsertIndex = allowLoopback ? 3 : 2;
  const chain = `PCCWL${guardId.toUpperCase()}`;
  const logPrefix = `PCCWL${guardId.toUpperCase()} `;
  const allowedV4 = new Set<string>();
  const allowedV6 = new Set<string>();
  const allowedLoopbackPorts = new Set<number>();
  let logMonitor: FirewallLogMonitor | null = null;
  let dockerUserHooked = false;
  let dockerUser6Hooked = false;

  const hasIp6 = (() => {
    const res = spawnSync("ip6tables", ["-L"], {
      stdio: ["ignore", "pipe", "pipe"],
      encoding: "utf8",
    });
    return (res.status ?? 1) === 0;
  })();

  const outputJumpArgs = restrictUid
    ? ["-m", "owner", "--uid-owner", String(restrictUid), "-j", chain]
    : ["-j", chain];
  const outputInsertArgs = ["-I", "OUTPUT", "1", ...outputJumpArgs];
  const outputDeleteArgs = ["-D", "OUTPUT", ...outputJumpArgs];

  const cleanup = () => {
    execCommand("iptables", outputDeleteArgs, { log, allowFailure: true });
    if (dockerUserHooked) {
      execCommand("iptables", ["-D", "DOCKER-USER", "-j", chain], {
        log,
        allowFailure: true,
      });
    }
    execCommand("iptables", ["-F", chain], { log, allowFailure: true });
    execCommand("iptables", ["-X", chain], { log, allowFailure: true });
    if (hasIp6) {
      execCommand("ip6tables", outputDeleteArgs, { log, allowFailure: true });
      if (dockerUser6Hooked) {
        execCommand("ip6tables", ["-D", "DOCKER-USER", "-j", chain], {
          log,
          allowFailure: true,
        });
      }
      execCommand("ip6tables", ["-F", chain], { log, allowFailure: true });
      execCommand("ip6tables", ["-X", chain], { log, allowFailure: true });
    }
  };

  const enableContainerRules = (): boolean => {
    if (dockerUserHooked || dockerUser6Hooked) return true;
    if (!chainExists("iptables", "DOCKER-USER")) {
      log?.(
        "[network-firewall] DOCKER-USER chain unavailable; container egress not restricted."
      );
      return false;
    }
    execCommand("iptables", ["-D", "DOCKER-USER", "-j", chain], {
      log,
      allowFailure: true,
    });
    execCommand("iptables", ["-I", "DOCKER-USER", "1", "-j", chain], { log });
    dockerUserHooked = true;
    if (hasIp6) {
      if (chainExists("ip6tables", "DOCKER-USER")) {
        execCommand("ip6tables", ["-D", "DOCKER-USER", "-j", chain], {
          log,
          allowFailure: true,
        });
        execCommand("ip6tables", ["-I", "DOCKER-USER", "1", "-j", chain], { log });
        dockerUser6Hooked = true;
      } else {
        log?.(
          "[network-firewall] ip6tables DOCKER-USER chain unavailable; IPv6 container egress not restricted."
        );
      }
    }
    return true;
  };

  try {
    execCommand("iptables", outputDeleteArgs, { log, allowFailure: true });
    execCommand("iptables", ["-F", chain], { log, allowFailure: true });
    execCommand("iptables", ["-X", chain], { log, allowFailure: true });
    execCommand("iptables", ["-N", chain], { log });
    if (!skipOutput) {
      execCommand("iptables", outputInsertArgs, { log });
    }
    if (allowLoopback) {
      execCommand("iptables", ["-A", chain, "-o", "lo", "-j", "RETURN"], { log });
    }
    execCommand(
      "iptables",
      ["-A", chain, "-m", "conntrack", "--ctstate", "ESTABLISHED,RELATED", "-j", "RETURN"],
      { log }
    );
    if (onViolation) {
      execCommand(
        "iptables",
        [
          "-A",
          chain,
          "-m",
          "limit",
          "--limit",
          "5/second",
          "--limit-burst",
          "10",
          "-j",
          "LOG",
          "--log-prefix",
          logPrefix,
          "--log-level",
          "4",
        ],
        { log }
      );
    }
    execCommand("iptables", ["-A", chain, "-j", "REJECT"], { log });

    if (hasIp6) {
      execCommand("ip6tables", outputDeleteArgs, { log, allowFailure: true });
      execCommand("ip6tables", ["-F", chain], { log, allowFailure: true });
      execCommand("ip6tables", ["-X", chain], { log, allowFailure: true });
      execCommand("ip6tables", ["-N", chain], { log });
      if (!skipOutput) {
        execCommand("ip6tables", outputInsertArgs, { log });
      }
      if (allowLoopback) {
        execCommand("ip6tables", ["-A", chain, "-o", "lo", "-j", "RETURN"], { log });
      }
      execCommand(
        "ip6tables",
        ["-A", chain, "-m", "conntrack", "--ctstate", "ESTABLISHED,RELATED", "-j", "RETURN"],
        { log }
      );
      if (onViolation) {
        execCommand(
          "ip6tables",
          [
            "-A",
            chain,
            "-m",
            "limit",
            "--limit",
            "5/second",
            "--limit-burst",
            "10",
            "-j",
            "LOG",
            "--log-prefix",
            logPrefix,
            "--log-level",
            "4",
          ],
          { log }
        );
      }
      execCommand("ip6tables", ["-A", chain, "-j", "REJECT"], { log });
    } else {
      log?.("[network-firewall] ip6tables not available; IPv6 egress not restricted.");
    }
  } catch (err) {
    cleanup();
    throw err;
  }

  if (onViolation) {
    logMonitor = startIptablesLogMonitor(logPrefix, onViolation, log);
    if (!logMonitor) {
      log?.("[network-firewall] dmesg monitor unavailable; firewall violations will not be reported.");
    }
  }

  const allowAddresses = (addresses: dns.LookupAddress[]) => {
    for (const address of addresses) {
      if (address.family === 4) {
        if (allowedV4.has(address.address)) continue;
        allowedV4.add(address.address);
        execCommand(
          "iptables",
          ["-I", chain, String(allowInsertIndex), "-d", address.address, "-j", "RETURN"],
          { log }
        );
      } else if (address.family === 6) {
        if (!hasIp6 || allowedV6.has(address.address)) continue;
        allowedV6.add(address.address);
        execCommand(
          "ip6tables",
          ["-I", chain, String(allowInsertIndex), "-d", address.address, "-j", "RETURN"],
          { log }
        );
      }
    }
  };

  const allowLoopbackTcpPorts = (ports: number[]) => {
    if (allowLoopback) return;
    for (const port of ports) {
      if (!Number.isFinite(port) || port <= 0 || port > 65535) continue;
      if (allowedLoopbackPorts.has(port)) continue;
      allowedLoopbackPorts.add(port);
      execCommand(
        "iptables",
        ["-I", chain, "1", "-o", "lo", "-p", "tcp", "--dport", String(port), "-j", "RETURN"],
        { log }
      );
      if (hasIp6) {
        execCommand(
          "ip6tables",
          ["-I", chain, "1", "-o", "lo", "-p", "tcp", "--dport", String(port), "-j", "RETURN"],
          { log }
        );
      }
    }
  };

  const stop = async () => {
    logMonitor?.stop();
    cleanup();
  };

  return { allowAddresses, allowLoopbackTcpPorts, stop, enableContainerRules };
}

function startPfGuard(
  guardId: string,
  options?: {
    log?: (line: string) => void;
    onViolation?: ViolationCallback;
    restrictUid?: number;
    allowLoopback?: boolean;
  }
): FirewallBackend {
  const log = options?.log;
  const onViolation = options?.onViolation;
  const restrictUid = options?.restrictUid;
  const allowLoopback = options?.allowLoopback ?? true;
  const anchor = `pcc/whitelist/${guardId}`;
  const table = `pccwl_${guardId}`;
  const rulesPath = path.join(os.tmpdir(), `pcc-whitelist-${guardId}.pf`);
  const allowed = new Set<string>();
  const loopbackPorts = new Set<number>();
  let logMonitor: FirewallLogMonitor | null = null;

  const userRule = typeof restrictUid === "number" ? ` user ${restrictUid}` : "";
  const buildRules = () => {
    const loopbackRules: string[] = [];
    if (allowLoopback) {
      loopbackRules.push(`pass out on lo0${userRule}`);
    } else if (loopbackPorts.size) {
      const ports = Array.from(loopbackPorts).sort((a, b) => a - b);
      loopbackRules.push(
        `pass out on lo0 proto tcp to any port { ${ports.join(", ")} }${userRule}`
      );
    }
    return [
      `table <${table}> persist`,
      `block out log${userRule}`,
      ...loopbackRules,
      `pass out to <${table}>${userRule}`,
    ].join("\n");
  };

  const applyRules = () => {
    fs.writeFileSync(rulesPath, buildRules(), "utf8");
    execCommand("pfctl", ["-a", anchor, "-f", rulesPath], { log });
  };

  const pfEnabled = readPfEnabled(log);
  const enablePf = pfEnabled !== true;
  const disablePfOnStop = pfEnabled === false;
  if (pfEnabled === null) {
    log?.("[network-firewall] pf status unknown; will not restore on stop.");
  }
  if (enablePf) {
    execCommand("pfctl", ["-E"], { log, allowFailure: true });
  }
  execCommand("pfctl", ["-a", anchor, "-F", "all"], { log, allowFailure: true });
  execCommand("pfctl", ["-t", table, "-T", "flush"], { log, allowFailure: true });
  applyRules();

  if (onViolation) {
    logMonitor = startPfLogMonitor(onViolation, log);
    if (!logMonitor) {
      log?.("[network-firewall] pflog monitor unavailable; firewall violations will not be reported.");
    }
  }

  const allowAddresses = (addresses: dns.LookupAddress[]) => {
    for (const address of addresses) {
      if (allowed.has(address.address)) continue;
      allowed.add(address.address);
      execCommand("pfctl", ["-t", table, "-T", "add", address.address], { log });
    }
  };

  const allowLoopbackTcpPorts = (ports: number[]) => {
    if (allowLoopback) return;
    let updated = false;
    for (const port of ports) {
      if (!Number.isFinite(port) || port <= 0 || port > 65535) continue;
      if (loopbackPorts.has(port)) continue;
      loopbackPorts.add(port);
      updated = true;
    }
    if (updated) applyRules();
  };

  const stop = async () => {
    logMonitor?.stop();
    execCommand("pfctl", ["-a", anchor, "-F", "all"], { log, allowFailure: true });
    execCommand("pfctl", ["-t", table, "-T", "flush"], { log, allowFailure: true });
    if (disablePfOnStop) {
      execCommand("pfctl", ["-d"], { log, allowFailure: true });
    }
    try {
      fs.unlinkSync(rulesPath);
    } catch {
      // ignore
    }
  };

  return { allowAddresses, allowLoopbackTcpPorts, stop };
}

function startStubGuard(
  guardId: string,
  options?: {
    log?: (line: string) => void;
    onViolation?: ViolationCallback;
    restrictUid?: number;
    allowLoopback?: boolean;
  }
): FirewallBackend {
  stubFirewallState = {
    guardId,
    allowed: [],
    loopbackTcpPorts: [],
    containerEnabled: false,
    stopped: false,
  };
  options?.log?.("[network-firewall] stub backend active; enforcement disabled.");

  const allowAddresses = (addresses: dns.LookupAddress[]) => {
    if (!stubFirewallState) return;
    stubFirewallState.allowed.push(...addresses);
  };

  const stop = async () => {
    if (stubFirewallState) stubFirewallState.stopped = true;
  };

  const allowLoopbackTcpPorts = (ports: number[]) => {
    if (!stubFirewallState) return;
    for (const port of ports) {
      if (!Number.isFinite(port) || port <= 0 || port > 65535) continue;
      if (stubFirewallState.loopbackTcpPorts.includes(port)) continue;
      stubFirewallState.loopbackTcpPorts.push(port);
    }
  };

  const enableContainerRules = () => {
    if (stubFirewallState) stubFirewallState.containerEnabled = true;
    return true;
  };

  return { allowAddresses, allowLoopbackTcpPorts, stop, enableContainerRules };
}

async function releaseFirewall(
  callback: ViolationCallback | undefined,
  log?: (line: string) => void
): Promise<void> {
  if (!activeFirewall) return;
  if (callback) activeFirewall.callbacks.delete(callback);
  activeFirewall.refCount -= 1;
  if (activeFirewall.refCount > 0) {
    log?.(`[network-firewall] whitelist guard retained (refs=${activeFirewall.refCount}).`);
    return;
  }
  const backend = activeFirewall.backend;
  activeFirewall = null;
  await backend.stop();
  log?.("[network-firewall] whitelist guard stopped.");
}

export async function startNetworkWhitelistFirewall(
  options: FirewallOptions
): Promise<NetworkFirewallHandle | null> {
  const log = options.log;
  const wantsContainerRules = Boolean(options.containerMode);
  const proxyOnly = Boolean(options.proxyOnly);
  const restrictUid =
    typeof options.restrictUid === "number" ? options.restrictUid : undefined;
  const backendOverride = readFirewallBackendOverride();
  const useStubBackend = backendOverride === "stub";
  const skipOutput =
    proxyOnly && restrictUid === undefined && wantsContainerRules && !useStubBackend;
  if (activeFirewall) {
    if (proxyOnly && !activeFirewall.proxyOnly) {
      log?.("[network-firewall] proxy-only guard requested but existing guard allows direct egress.");
      return null;
    }
    if (
      restrictUid !== undefined &&
      activeFirewall.restrictUid !== undefined &&
      restrictUid !== activeFirewall.restrictUid
    ) {
      log?.("[network-firewall] whitelist guard active with different UID restriction.");
      return null;
    }
    if (restrictUid !== undefined && activeFirewall.restrictUid === undefined) {
      log?.("[network-firewall] whitelist guard active without UID restriction.");
      return null;
    }
    if (wantsContainerRules && !activeFirewall.containerEnabled) {
      const enabled = activeFirewall.backend.enableContainerRules?.() ?? false;
      if (enabled) {
        activeFirewall.containerEnabled = true;
      } else {
        log?.(
          "[network-firewall] container whitelist enforcement unavailable; refusing to reuse guard."
        );
        return null;
      }
    }
    activeFirewall.refCount += 1;
    if (options.onViolation) activeFirewall.callbacks.add(options.onViolation);
    const resolved = await resolveWhitelistEntries(
      options.whitelist,
      log,
      activeFirewall.hostAddresses,
      false
    );
    const extraAllowed = await resolveExtraAllowHosts(
      options.extraAllowHosts ?? [],
      log,
      false
    );
    mergeWhitelistMap(activeFirewall.hostAddresses, resolved.byHost);
    if (!activeFirewall.proxyOnly) {
      activeFirewall.backend.allowAddresses(resolved.addresses);
    }
    if (extraAllowed.length) {
      activeFirewall.backend.allowAddresses(extraAllowed);
    }
    log?.(
      `[network-firewall] whitelist guard already active; reusing (refs=${activeFirewall.refCount}).`
    );
    return {
      resolveHost: activeFirewall.resolveHost,
      allowLoopbackTcpPorts: activeFirewall.backend.allowLoopbackTcpPorts
        ? (ports: number[]) => {
            activeFirewall?.backend.allowLoopbackTcpPorts?.(ports);
          }
        : undefined,
      stop: async () => {
        await releaseFirewall(options.onViolation, log);
      },
    };
  }

  if (!useStubBackend && !shouldEnableFirewall(log)) return null;
  if (proxyOnly && !useStubBackend && restrictUid === undefined && !skipOutput) {
    log?.("[network-firewall] proxy-only enforcement requires a UID restriction.");
    return null;
  }

  const guardId = buildGuardId(options.runId);
  const platform = process.platform;
  if (!useStubBackend) {
    if (platform === "linux") {
      if (!canRunCommand("iptables", ["-L"], log)) return null;
    } else if (platform === "darwin") {
      if (!canRunCommand("pfctl", ["-s", "info"], log)) return null;
    } else {
      log?.(`[network-firewall] whitelist guard not supported on ${platform}.`);
      return null;
    }

    if (wantsContainerRules && platform !== "linux") {
      log?.(
        `[network-firewall] container whitelist enforcement unsupported on ${platform}.`
      );
      return null;
    }
  }

  const resolved = await resolveWhitelistEntries(options.whitelist, log);
  const extraAllowed = await resolveExtraAllowHosts(options.extraAllowHosts ?? [], log);

  const callbacks = new Set<ViolationCallback>();
  if (options.onViolation) callbacks.add(options.onViolation);
  const reportViolation: ViolationCallback = (violation) => {
    for (const callback of callbacks) {
      try {
        callback(violation);
      } catch (err) {
        log?.(`[network-firewall] violation callback failed: ${String(err)}`);
      }
    }
  };

  let backend: FirewallBackend;
  try {
    if (useStubBackend) {
      backend = startStubGuard(guardId, {
        log,
        onViolation: reportViolation,
        restrictUid,
        allowLoopback: !proxyOnly,
      });
    } else if (platform === "linux") {
      backend = startIptablesGuard(guardId, {
        log,
        onViolation: reportViolation,
        restrictUid,
        skipOutput,
        allowLoopback: !proxyOnly,
      });
    } else {
      backend = startPfGuard(guardId, {
        log,
        onViolation: reportViolation,
        restrictUid,
        allowLoopback: !proxyOnly,
      });
    }
  } catch (err) {
    log?.(`[network-firewall] failed to start guard: ${String(err)}`);
    return null;
  }

  if (!proxyOnly) {
    backend.allowAddresses(resolved.addresses);
  }
  if (extraAllowed.length) {
    backend.allowAddresses(extraAllowed);
  }

  const containerEnabled = wantsContainerRules
    ? backend.enableContainerRules?.() ?? false
    : false;

  if (wantsContainerRules && !containerEnabled) {
    log?.(
      "[network-firewall] container whitelist enforcement unavailable; guard aborted."
    );
    await backend.stop();
    return null;
  }

  if (skipOutput) {
    log?.("[network-firewall] host OUTPUT filtering disabled; container-only enforcement active.");
  }

  const platformLabel = useStubBackend ? "stub" : platform;
  log?.(
    `[network-firewall] whitelist guard enabled (${platformLabel}) id=${guardId} addresses=${resolved.addresses.length} dns=blocked`
  );

  const resolveHost = async (hostname: string) => {
    const normalized = normalizeHost(hostname);
    if (!normalized) return [];
    return resolved.byHost.get(normalized) ?? [];
  };

  activeFirewall = {
    backend,
    resolveHost,
    refCount: 1,
    callbacks,
    hostAddresses: resolved.byHost,
    containerEnabled,
    proxyOnly,
    restrictUid,
  };

  return {
    resolveHost,
    allowLoopbackTcpPorts: backend.allowLoopbackTcpPorts
      ? (ports: number[]) => {
          backend.allowLoopbackTcpPorts?.(ports);
        }
      : undefined,
    stop: async () => {
      await releaseFirewall(options.onViolation, log);
    },
  };
}

export const __test__ = {
  buildGuardId,
  normalizeHost,
  getStubFirewallState: () => stubFirewallState,
  resetStubFirewallState: () => {
    stubFirewallState = null;
  },
};
