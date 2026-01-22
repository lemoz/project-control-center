# PCC VM Baseline Deployment (Docker Compose)

Baseline VM deployment for PCC UI + API/runner on a single host using Docker Compose.

## Prereqs
- Docker Engine + Docker Compose v2 (`docker compose version`).
- Repo checked out on the VM.
- Codex auth available on the VM (see `PCC_CODEX_HOME` below).

## Layout
- Repo mounted at `/repos/pcc` inside the API container.
- Database lives at `/repos/pcc/control-center.db` (persisted on VM disk).
- Work Orders and run logs live under `/repos/pcc/work_orders` and `/repos/pcc/.system`.

## Environment
Create `.env` in the repo root (copy from `.env.example` for the usual PCC vars).
Docker Compose loads this file for variable substitution and passes it into the API
container, so include `OPENAI_API_KEY` and any `CONTROL_CENTER_*` overrides there.

Set the Codex auth path used by the API container:
```
PCC_CODEX_HOME=/home/runner/.codex
```
If the VM user is different, point this at that user's `~/.codex` path. Run `codex login` on the VM to populate it.

## Build + Start
From the repo root on the VM:
```
docker compose build
docker compose up -d
```

## Verify
```
curl http://localhost:4010/health
curl http://localhost:3010
```
Open `http://localhost:3010` in a browser on the VM.

## Start/Stop/Logs
```
docker compose up -d
docker compose down

docker compose ps

docker compose logs -f api
docker compose logs -f ui
docker compose logs -f runner
```

## Start On Boot (systemd)
1. Copy the unit file and edit the repo path:
   ```
   sudo cp deploy/pcc.service /etc/systemd/system/pcc.service
   sudo sed -i 's|/opt/project-control-center|/path/to/project-control-center|g' /etc/systemd/system/pcc.service
   ```
2. Enable and start:
   ```
   sudo systemctl daemon-reload
   sudo systemctl enable --now pcc.service
   ```
3. Inspect logs:
   ```
   sudo systemctl status pcc.service
   journalctl -u pcc.service -f
   ```

## Notes
- UI/API bind to localhost only. Remote access + auth is tracked in WO-2026-133.
- If you mount additional repos, add extra bind mounts under `/repos` and keep `CONTROL_CENTER_SCAN_ROOTS=/repos`.
- Baseline sizing for UI/API/runner is 4 vCPU / 16 GB (see WO-2026-128 research).
- `docker compose build` produces the `pcc-runner:latest` image via the runner service.
