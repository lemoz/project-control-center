# WO-2026-128 PCC VM Service Migration Research

**Status: Research Complete**

## Current Architecture (Local + VM Hybrid)

- UI + API run locally on the laptop.
- Runs execute on a GCP VM via SSH + rsync.
- State lives in `control-center.db` (local), `work_orders/`, and `.system/` folders.
- Remote sync failures and timeouts account for ~21% of run failures.

## Pain Points

- Network sync issues (remote_sync_failed, timeouts) degrade run reliability.
- PCC availability depends on the local machine being online.
- Local network and power outages interrupt long-running automation.
- Hybrid topology complicates ops (local DB + remote runner state).

## Target Outcomes

- PCC UI/API/runner live on a single always-on VM.
- Local machine is optional (remote access only).
- Eliminate local-to-VM sync failures by running everything co-located.

## Deployment Options (Top 3)

### Option A: Single VM, systemd services (no containers)
**Description:** Install Node.js and run API/UI as systemd services behind Nginx/Caddy.

**Pros**
- Lowest overhead, simple debugging.
- No Docker dependency.

**Cons**
- Manual process management.
- Harder to replicate or move.

### Option B: Single VM, Docker Compose (recommended)
**Description:** Run API/UI/runner in containers, fronted by Caddy/Nginx for HTTPS.

**Pros**
- Reproducible environment.
- Easy to update or migrate VM image.
- Runner containers can be managed alongside services.

**Cons**
- Adds Docker complexity.
- Requires disk/headroom for images.

### Option C: Managed Kubernetes / multi-service
**Description:** Split API/UI/runner into managed services (GKE or similar).

**Pros**
- Scales well and supports HA later.

**Cons**
- High complexity and cost.
- Overkill for single-user PCC.

## VM Sizing Guidance

Current VM sizes map to GCP E2 types (from `server/vm_manager.ts`):

- **medium:** `e2-medium` (2 vCPU / 4 GB) - UI/API only, no runner.
- **large:** `e2-standard-4` (4 vCPU / 16 GB) - UI/API + runner (baseline).
- **xlarge:** `e2-standard-8` (8 vCPU / 32 GB) - multiple concurrent runs.

Disk: minimum 50 GB (already enforced in VM provisioning).

## Networking & Access

### Simple (single-user)
- HTTPS via Caddy/Nginx + basic auth.
- Optional IP allowlist if access is from a fixed location.

### Stronger Auth (future-ready)
- Cloudflare Tunnel + Access (OAuth providers).
- Tailscale or WireGuard VPN for private access.

### Debug Access
- SSH with dedicated user + keypair.
- Optional SSH port forwarding for local-only admin tools.

## Data Persistence & Backups

**Must persist**
- `control-center.db` (+ WAL/SHM).
- `work_orders/` (source of truth).
- `.control.yml` sidecars in repos.
- `.system/` run logs and artifacts (optional retention).

**Backup strategy**
- Nightly SQLite hot backup (`sqlite3 .backup`) stored off-host.
- Weekly disk snapshots (GCP persistent disk snapshot).
- Git remote for `work_orders/` (already versioned).

## Cost Estimate (Always-On VM)

Estimates assume 730 hours/month, list prices, no sustained-use discounts.

| Size | Machine Type | Est Monthly Compute | Notes |
| --- | --- | --- | --- |
| medium | e2-medium | ~$25-35 | UI/API only, no runner |
| large | e2-standard-4 | ~$90-120 | Baseline for PCC + runner |
| xlarge | e2-standard-8 | ~$180-240 | Multi-run capacity |

Add-ons:
- 50 GB persistent disk: ~$2-4/month.
- Egress: low for admin/UI, higher if large artifacts are downloaded often.

**Current model comparison:** if the runner VM only runs ~4 hours/day, usage is ~120 hours/month.
Always-on is roughly 6x that usage. Use `project_vms.total_hours_used` to calculate real numbers.

## Risks & Mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Single VM outage | PCC down | Backups + snapshots, documented restore |
| DB corruption | Data loss | Scheduled SQLite backups, snapshot before upgrades |
| Security exposure | Unauthorized access | HTTPS + auth + firewall rules |
| Resource contention | Slower runs | Size to `large` or `xlarge`, monitor CPU/RAM |
| Cost creep | Higher monthly spend | Review usage quarterly, consider schedules |

## Migration Path (Phased)

1. **Deploy baseline VM** (Option B recommended).
2. **Stage data migration**: copy DB + work orders to VM, verify integrity.
3. **Run PCC from VM** with temporary access URL for testing.
4. **Cut over**: update DNS/auth, switch daily use to VM.
5. **Keep local fallback** for 1-2 weeks with snapshot rollback plan.

## Recommendation

**Choose Option B: Single VM + Docker Compose + Caddy/Nginx.**

Why:
- Simplest path to always-on without microservices complexity.
- Containers keep environment reproducible.
- Easy to scale from `large` to `xlarge`.

**Stop conditions**
- If monthly costs exceed a comfortable budget threshold, pause and keep hybrid.
- If operational complexity feels too high, defer and revisit after shift agent VM work.

## Follow-up Work Orders (Created)

1. **WO-2026-129** - VM-hosted PCC baseline deployment (Docker Compose).
2. **WO-2026-130** - Remote access + auth for VM-hosted PCC.
3. **WO-2026-131** - Data migration, backups, and cutover plan.

## Proposed Architecture Diagram (Recommended)

```mermaid
flowchart TB
  User[User Browser] -->|HTTPS| Proxy[Caddy or Nginx]
  Proxy --> UI[Next.js UI]
  Proxy --> API[PCC API + Runner]
  API --> DB[(SQLite: control-center.db)]
  API --> Repo[Repos + work_orders]
  API --> Runs[.system/runs + artifacts]
  API --> Docker[Runner containers]
  Backup[Snapshots / Off-host backup] <-- DB
  Backup <-- Repo
```
