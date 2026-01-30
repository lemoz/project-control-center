# Network whitelist manual checklist

Use this when validating iptables/pf behavior in a local run.

## Linux (iptables)
- Start a whitelist run and note the guard ID from the log line: `whitelist guard enabled` (look for `id=...`).
- Confirm rules are present: `sudo iptables -S | rg PCCWL` (and `ip6tables` if IPv6).
- Verify allowed traffic succeeds through the proxy (HTTP/HTTPS to a whitelisted host).
- Verify a blocked request is rejected and logged:
  - make a request to a non-whitelisted host
  - check `dmesg` for the `PCCWL{ID}` prefix
- Stop the run and confirm rules are removed.

## macOS (pf)
- Start a whitelist run and note the guard ID from the log line: `whitelist guard enabled` (look for `id=...`).
- Confirm rules are present: `sudo pfctl -a pcc/whitelist/{id} -s rules`.
- Verify allowed traffic succeeds through the proxy (HTTP/HTTPS to a whitelisted host).
- Verify a blocked request is logged via `tcpdump -n -tt -l -i pflog0`.
- Stop the run and confirm the anchor is cleared.
