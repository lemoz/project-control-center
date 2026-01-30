import assert from "node:assert/strict";
import { test } from "node:test";
import { __test__, startNetworkWhitelistFirewall } from "./network_firewall.ts";

function withEnv(key, value) {
  const prev = process.env[key];
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
  return () => {
    if (prev === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = prev;
    }
  };
}

test("network firewall stub tracks allowlist and container rules", async (t) => {
  const restoreBackend = withEnv("PCC_NETWORK_FIREWALL_BACKEND", "stub");
  const restoreMode = withEnv("PCC_NETWORK_FIREWALL", "enabled");
  __test__.resetStubFirewallState();
  t.after(() => {
    restoreBackend();
    restoreMode();
    __test__.resetStubFirewallState();
  });

  const handle = await startNetworkWhitelistFirewall({
    whitelist: ["127.0.0.1"],
    runId: "run-guard-1234",
    containerMode: true,
    extraAllowHosts: ["10.0.0.1"],
  });

  assert.ok(handle);
  handle.allowLoopbackTcpPorts?.([3128]);
  const state = __test__.getStubFirewallState();
  assert.ok(state);
  assert.equal(state.guardId, __test__.buildGuardId("run-guard-1234"));
  assert.equal(state.containerEnabled, true);
  assert.ok(state.allowed.some((entry) => entry.address === "127.0.0.1"));
  assert.ok(state.allowed.some((entry) => entry.address === "10.0.0.1"));
  assert.ok(state.loopbackTcpPorts.includes(3128));

  const resolved = await handle.resolveHost("127.0.0.1");
  assert.ok(resolved.some((entry) => entry.address === "127.0.0.1"));

  await handle.stop();
  assert.equal(__test__.getStubFirewallState()?.stopped, true);
});
