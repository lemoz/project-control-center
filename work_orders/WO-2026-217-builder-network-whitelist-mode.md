---
id: WO-2026-217
title: Builder network whitelist mode
status: you_review
priority: 1
tags:
  - sandbox
  - network
  - security
  - builder
estimate_hours: 4
depends_on:
  - WO-2026-215
  - WO-2026-216
era: v2
updated_at: 2026-01-30
goal: Implement a new sandbox mode that allows builders network access only to whitelisted domains.
context:
  - Current sandbox modes are workspace-write and read-only (fully sandboxed)
  - Builders sometimes need to fetch documentation mid-run
  - Whitelist managed in settings (WO-2026-216)
  - Stream monitor (WO-2026-215) provides security oversight
  - Claude Code supports --sandbox flag with custom modes
  - May need HTTP proxy or iptables rules for enforcement
acceptance_criteria:
  - New sandbox mode workspace-write-whitelist that allows network to whitelisted domains only
  - Runner checks agent monitoring settings to determine sandbox mode
  - If builder.networkAccess is whitelist, use workspace-write-whitelist mode
  - Network restriction enforced via HTTP proxy or firewall rules
  - All network requests logged (domain, path, status)
  - Non-whitelisted requests blocked and logged as violation
  - Violations reported to stream monitor for potential action
  - Works with both local execution and container execution
  - Proxy/firewall starts before builder process, stops after
  - DNS resolution restricted to whitelisted domains
non_goals:
  - HTTPS inspection (trust TLS, just check domain)
  - Per-request approval (whitelist is pre-approved)
  - Websocket proxying (HTTP/HTTPS only for now)
stop_conditions:
  - If proxy approach is too complex, use iptables/pf firewall rules instead
  - If container networking is problematic, implement for local execution first
---
## Implementation Options

### Option A: HTTP Proxy (Preferred)
- Start local proxy (e.g., mitmproxy, tinyproxy) configured with whitelist
- Set HTTP_PROXY and HTTPS_PROXY env vars for builder process
- Proxy logs all requests, blocks non-whitelisted
- Pros: Works everywhere, detailed logging
- Cons: Need proxy process management

### Option B: Firewall Rules
- Use iptables (Linux) or pf (macOS) to restrict outbound
- Allow only resolved IPs of whitelisted domains
- Pros: OS-level enforcement
- Cons: IP-based (domains can change IPs), harder to log

### Option C: DNS-based
- Run local DNS server that only resolves whitelisted domains
- Set DNS for builder process to local server
- Pros: Simple concept
- Cons: Builder could use IP directly to bypass

## Recommendation: Option A with proxy

```typescript
// In runner_agent.ts

async function startNetworkProxy(whitelist: string[]): Promise<ProxyHandle> {
  // Start proxy on random available port
  // Configure with whitelist
  // Return handle with { port, stop() }
}

// When spawning builder with whitelist mode:
const proxy = await startNetworkProxy(getWhitelist());
const env = {
  ...process.env,
  HTTP_PROXY: `http://127.0.0.1:${proxy.port}`,
  HTTPS_PROXY: `http://127.0.0.1:${proxy.port}`,
  NO_PROXY: 'localhost,127.0.0.1',
};

const child = spawn(cmd, args, { env });

// On exit:
proxy.stop();
```

## Network Request Log Schema

```typescript
interface NetworkRequestLog {
  timestamp: string;
  run_id: string;
  domain: string;
  path: string;
  method: string;
  allowed: boolean;
  whitelist_matched?: string;  // which whitelist entry matched
}
```
