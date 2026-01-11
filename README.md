# Project Control Center

Local-first, mobile-friendly control center for managing all your repos, specs, work orders, and long-running AI agent runs.

This repo will become one of the projects it manages (“dogfooding”): we’ll build the UI, then use it to track and complete its own work orders.

## Goals
- Scan and index local git repos; classify as prototype vs long-term; surface stage/status/priority/next work orders.
- Per-repo Kanban of Work Orders with a strict "Ready" contract.
- One-click runs: Builder agent implements a Work Order, then a fresh Reviewer agent approves/requests fixes before anything is shown to you.
- Local runner that shells out to agent CLIs (Codex first, then Claude Code and Gemini CLI).
- PWA-quality responsive UI usable from desktop or mobile, exposed via ngrok with basic auth.
- Chat system with scoped threads (global, per-project, per-work-order) and worktree isolation.
- Tech tree visualization showing work order dependencies and era progression.
- VM-based project isolation for safe, sandboxed agent execution.

## Non-goals (v0)
- Cloud hosting or cross-device sync.
- Multi-user collaboration or complex auth.
- Full diff/merge UI (summary-first; diffs on-demand via local tools).
- Built-in SMS/email notifications (in-app only; notifier plugins later).

## Architecture (v0)
- **UI:** Next.js (TypeScript) app, configured as a PWA and tuned for mobile.
- **Local API/Runner:** Node/TS server for filesystem scanning, git metadata, Work Order CRUD, and executing agent runs.
- **State:** SQLite for global indexed state/history; per-repo sidecar `.control.yml` for human-maintained metadata.
- **Work Orders:** Markdown files in `work_orders/` with YAML frontmatter contract (see `docs/work_orders.md`).
- **Providers:** Pluggable provider interface supporting `codex` / `claude_code` / `gemini_cli`. Only Codex implemented in v0.
  - Repo discovery and sidecar schema: `docs/repo_discovery.md`.

## Security
- Runs on your laptop; access from anywhere through ngrok reserved domain + basic auth.
- No secrets committed. Use a local `.env` (gitignored) for API keys/provider settings.

## Repo layout (planned)
- `app/` or `src/` – Next.js UI.
- `server/` – local API + runner.
- `docs/` – contracts, decisions, architecture notes.
- `work_orders/` – Work Order cards/specs.

## Getting started

### Prereqs
- Node.js 18+ and npm.

### Install
```bash
npm install
```

### Run local server (API + SQLite)
```bash
npm run server:dev
```
Defaults to `http://localhost:4010`.  
API endpoints (v0):
- `GET /health`
- `GET /repos`
- `POST /repos/scan` (forces a rescan; returns discovered repo paths)

Optional env vars:
- `CONTROL_CENTER_PORT=4010`
- `CONTROL_CENTER_HOST=127.0.0.1` (bind host; defaults to loopback for private-by-default)
- `CONTROL_CENTER_ALLOW_LAN=1` (required to accept non-loopback clients; v0 has no auth and can leak local repo paths if exposed on your LAN)
- `CONTROL_CENTER_DB_PATH=/absolute/path/control-center.db`
- `CONTROL_CENTER_SCAN_ROOTS=/path/to/repos,/another/path` (comma-separated; defaults to `$HOME`)
- `CONTROL_CENTER_ALLOWED_ORIGINS=http://localhost:3010` (comma-separated CORS allowlist for browser calls; defaults include `http://localhost:3000` and `http://localhost:3010-3013` plus `127.0.0.1` equivalents)
- `CONTROL_CENTER_CORS_ALLOW_ALL=1` (dev-only + loopback-only: disables the allowlist when `NODE_ENV != "production"` and `CONTROL_CENTER_HOST` is loopback)
- `CONTROL_CENTER_MAX_BUILDER_ITERATIONS=10` (caps builder/test retries before failing a run)
- `CONTROL_CENTER_CHAT_SUGGESTION_CONTEXT_MESSAGES=10` (how many recent thread messages + run metadata to include when generating Access+Context suggestions)
- `CONTROL_CENTER_CHAT_TRUSTED_HOSTS=github.com,raw.githubusercontent.com` (comma- or newline-separated host list for the chat "trusted" network pack; overrides Chat Settings)
- `CONTROL_CENTER_SSH_SKIP_HOST_KEY_CHECKING=1` (disables SSH host key verification; not recommended)

Database notes:
- Schema (including `projects` and `work_orders`) is auto-created on server start (see `server/db.ts`), with lightweight startup migrations for existing DBs.
- To reset local state, stop the server and delete the DB file (default `control-center.db`).

### Run UI (Next.js PWA dev)
```bash
npm run dev
```
UI runs on `http://localhost:3010` by default and expects the server at `NEXT_PUBLIC_API_BASE_URL` (default `http://localhost:4010`).
Dev note: `npm run dev` sets `NEXT_DIST_DIR=.next-dev` via `scripts/with-env.mjs` (cross-platform; see `next.config.js`) so dev artifacts don’t pollute the production build output (`.next/`).

### Recommended: run API + UI in tmux
```bash
tmux new-session -d -s pcc -c /Users/cdossman/project-control-center -n dev
tmux send-keys -t pcc:dev.0 "npm run server:dev" C-m
tmux split-window -h -t pcc:dev -c /Users/cdossman/project-control-center
tmux send-keys -t pcc:dev.1 "npm run dev" C-m
tmux attach -t pcc
```
Detach anytime with `Ctrl+b` then `d`.

### Expose UI via ngrok (reserved domain + basic auth)
1. Install ngrok (for example, `brew install ngrok/ngrok/ngrok` or https://ngrok.com/download), then add your authtoken:
   ```bash
   ngrok config add-authtoken <token>
   ```
2. Reserve a domain in the ngrok dashboard and copy the full domain (for example, `your-name.ngrok.app`).
3. Put credentials in `.env` (gitignored; do not commit secrets):
   ```bash
   NGROK_DOMAIN=your-name.ngrok.app
   NGROK_BASIC_AUTH=youruser:strongpassword
   ```
4. Start the tunnel to the UI on `http://localhost:3010`:
   ```bash
   set -a; source .env; set +a
   bash scripts/ngrok.sh
   ```
   Or inline:
   ```bash
   NGROK_DOMAIN=your-name.ngrok.app NGROK_BASIC_AUTH=youruser:strongpassword bash scripts/ngrok.sh
   ```

### Build
```bash
npm run build
npm run server:build
```

### E2E smoke tests (Playwright)
```bash
npm test
```
By default, tests run the API on `http://127.0.0.1:4011` and the built UI on `http://127.0.0.1:3012` (+ an offline-mode UI on `:3013`).  
Override with `E2E_API_PORT`, `E2E_WEB_PORT`, and `E2E_OFFLINE_WEB_PORT` if those ports are in use.
Isolation patterns and fixtures are documented in `docs/e2e_testing.md`.

## Roadmap

**v0 (Done)**
- ✅ Scaffold Next.js PWA + local server + SQLite.
- ✅ Repo scanner + portfolio dashboard.
- ✅ Work Order Kanban per repo.
- ✅ Codex builder + reviewer loop with handoff summaries.
- ✅ Settings page for provider/model.

**v1 (Current)**
- ✅ Chat system with scoped threads and attention notifications.
- ✅ Starred projects in portfolio.
- ✅ E2E testing with Playwright (desktop + mobile).
- ✅ ngrok exposure with basic auth.
- ✅ Git worktree isolation for runner and chat.
- ✅ Tech tree visualization for WO dependencies.
- ⏳ Claude Code + Gemini CLI providers.
- ⏳ iMessage notifier plugin.

**v2 (In Progress)**
- ✅ VM isolation scaffolding (DB, API, UI).
- ✅ VM provisioning + lifecycle (GCP/SSH/IP).
- ⏳ Remote exec + repo sync with safety guardrails.
- ⏳ Runner integration with VM artifact egress.
- ⏳ Constitution system (schema, generation, injection).
- ⏳ Autonomous run policy + scheduler.
- ⏳ Cost metering (VM runtime, tokens, APIs).

## Runner smoke test
- Codex runner smoke test ran (WO-2025-010, 2025-12-12).
