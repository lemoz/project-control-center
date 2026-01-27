# VM Health Monitoring & Runbook

Monitor PCC hosting VM health, configure external alerts, and handle common failures.

## Health endpoints
- `/health` for uptime checks.
- `/observability/vm-health` for disk/memory/CPU + container summary.

### Expose health endpoints on the VM
Set these in the VM `.env` and restart the stack:
```
CONTROL_CENTER_HOST=0.0.0.0
CONTROL_CENTER_ALLOW_REMOTE_HEALTH=1
CONTROL_CENTER_HEALTH_TOKEN=your-shared-token
CONTROL_CENTER_VM_HEALTH_LOCAL=1
```

Restart:
```
docker compose up -d
```

Verify remotely:
```
curl "http://<vm-ip>:4010/health?token=your-shared-token"
curl "http://<vm-ip>:4010/observability/vm-health?token=your-shared-token"
```

Notes:
- Only `/health` and `/observability/vm-health` are reachable without `CONTROL_CENTER_ALLOW_LAN=1`.
- Add firewall rules to allow the health port from your monitor IP ranges.

## External uptime monitoring (VM unreachable)
Option A: UptimeRobot (free tier)
1. Create an HTTP(s) monitor to `/health?token=...`.
2. Alert to email/SMS.

Option B: GCP Monitoring uptime check
1. Create an HTTP uptime check to `/health?token=...`.
2. Add an alerting policy on check failures.

## Resource alerts (CPU/memory/disk)
Use GCP Monitoring alert policies:
- CPU utilization > 85% (warning), > 95% (critical) for 5-10 minutes.
- Memory usage > 85% / > 95% (requires Ops Agent).
- Disk usage > 80% / > 95% (requires Ops Agent).

If monitoring adds significant cost, reduce frequency or defer to the free tier.

PCC also surfaces VM alerts in `/observability/alerts` once metrics are available.

## Runbook
### VM unreachable
1. Check instance status in GCP console.
2. Confirm firewall allows port 4010 from uptime check sources.
3. SSH into the VM and verify containers:
   ```
   docker compose ps
   docker compose logs -f api
   ```
4. Restart services if needed:
   ```
   docker compose restart
   ```

### High CPU
1. Inspect load:
   ```
   uptime
   top
   docker stats
   ```
2. Identify the hottest container/process and restart it.
3. Pause active runs or resize the VM if sustained.

### High memory
1. Inspect memory:
   ```
   free -h
   docker stats
   ```
2. Restart the leaking container or reduce concurrent runs.

### Disk full
1. Inspect usage:
   ```
   df -h /
   du -h --max-depth=2 /repos/pcc | sort -hr | head -n 20
   ```
2. Clean old run logs in `/repos/pcc/.system/runs` after verifying they are no longer needed.
3. Prune Docker if needed:
   ```
   docker system prune
   ```
