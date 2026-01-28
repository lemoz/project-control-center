# Project Control Center

Local-first, mobile-friendly control center for managing all your repos, specs, work orders, and long-running AI agent runs.

This repo will become one of the projects it manages ("dogfooding"): we'll build the UI, then use it to track and complete its own work orders.

Project Control Center now follows a two-repo architecture: this repo is the open-source core, while hosted cloud services live in `pcc-cloud`.

## Goals
- Scan and index local git repos; classify as prototype vs long-term; surface stage/status/priority/next work orders.
- Per-repo Kanban of Work Orders with a strict "Ready" contract.
- One-click runs: Builder agent implements a Work Order, then a fresh Reviewer agent approves/requests fixes before anything is shown to you.
- Local runner that shells out to agent CLIs (Codex first, then Claude Code and Gemini CLI).
- PWA-quality responsive UI usable from desktop or mobile, exposed via ngrok with basic auth.
- Chat system with scoped threads (global, per-project, per-work-order) and worktree isolation.
- Tech tree visualization showing work order dependencies and era progression.
- VM-based project isolation for safe, sandboxed agent execution.
- **Autonomous shift agents** that run work order loops with minimal human intervention.

## Non-goals (v0)
- Cloud hosting or cross-device sync in the core repo (handled in `pcc-cloud`).
- Multi-user collaboration or complex auth.
- Full diff/merge UI (summary-first; diffs on-demand via local tools).
- Built-in SMS/email notifications (in-app only; notifier plugins later).

## Architecture

### Repo split
- `project-control-center` (this repo): open-source core UI + local runner.
- `pcc-cloud`: proprietary cloud services + marketing site.
- See `MIGRATION.md` for the split plan and sequencing.

### Self-hosted vs PCC Cloud
| Category | Self-hosted (core) | PCC Cloud |
| --- | --- | --- |
| Hosting | Runs on your machine | Managed by `pcc-cloud` |
| Data store | Local SQLite + repo files | Hosted databases + managed state |
| Auth & billing | Local only | Cloud auth + billing |
| VM provisioning | You manage VMs | Managed VM fleet |
| Updates | You pull updates | Managed service updates |
| Intended users | Solo / local-first | Teams, hosted deployments |

See `docs/SELF_HOSTED.md` and `docs/CLOUD_ARCHITECTURE.md` for details.

### Runtime (core)

```
┌─────────────────────────────────────────────────────────────────┐
│  SHIFT AGENT (local, Claude CLI, full permissions)              │
│  - Gathers context, decides what to work on                     │
│  - Kicks off runs, monitors, handles escalations                │
│  - Completes shifts with handoffs                               │
└───────────────────────────────┬─────────────────────────────────┘
                                │ triggers runs via API
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│  PCC SERVER (localhost:4010)                                    │
│  - Work Order CRUD, Run orchestration, Shift lifecycle          │
│  - SQLite state, Git worktree management                        │
└───────────────────────────────┬─────────────────────────────────┘
                                │ executes on
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│  VM (GCP, isolated execution)                                   │
│  - Builder → Test → Reviewer → Merge loop                       │
│  - Sandboxed, no decisions, just executes WOs                   │
└─────────────────────────────────────────────────────────────────┘
```

In cloud mode, VM provisioning/monitoring and hosted services live in `pcc-cloud`,
while the core UI and runner stay in this repo.

### Core components
- **UI:** Next.js (TypeScript) app, configured as a PWA and tuned for mobile.
- **Local API/Runner:** Node/TS server for filesystem scanning, git metadata, Work Order CRUD, and executing agent runs.
- **State:** SQLite for global indexed state/history; per-repo sidecar `.control.yml` for human-maintained metadata.
- **Work Orders:** Markdown files in `work_orders/` with YAML frontmatter contract (see `docs/work_orders.md`).
- **Providers:** Pluggable provider interface supporting `codex` / `claude_code` / `gemini_cli`. Only Codex implemented in v0.
- **Shifts:** Bounded work sessions with context gathering, decision making, and handoffs.

## Security
- Runs on your laptop; access from anywhere through ngrok reserved domain + basic auth.
- No secrets committed. Use a local `.env` (gitignored) for API keys/provider settings.
- VM execution is sandboxed; shift agent runs locally with your permissions.

## Repo layout
- `app/` – Next.js UI.
- `server/` – local API + runner.
- `docs/` – contracts, decisions, architecture notes.
- `work_orders/` – Work Order cards/specs.
- `prompts/` – Agent prompts (shift agent, etc.).
- `scripts/` – Utility scripts (start-shift, ngrok, etc.).

## Getting started

### Prerequisites
- Node.js 18+ and npm
- `OPENAI_API_KEY` for LLM/Codex calls

### Environment Setup
```bash
# Copy example env and fill in your values
cp .env.example .env

# Required: Add your OpenAI API key
# Edit .env and set OPENAI_API_KEY=your-key-here
```

See `.env.example` for all available configuration options.

### Core configuration (local + cloud)
- `PCC_MODE` = `local` or `cloud` (default: `local`)
- `PCC_DATABASE_PATH` = path to SQLite DB (default: `./control-center.db`)
- `PCC_REPOS_PATH` = root directory for repo scanning (overrides `CONTROL_CENTER_SCAN_ROOTS`)

When `PCC_MODE=cloud` and `PCC_REPOS_PATH` is not set, repo discovery defaults to the current working directory.

### Install
```bash
npm install
```

### Run local server (API + SQLite)
```bash
npm run server:dev
```
Defaults to `http://localhost:4010`.

### Run UI (Next.js PWA dev)
```bash
npm run dev
```
UI runs on `http://localhost:3010` by default.

### Recommended: run API + UI in tmux
```bash
tmux new-session -d -s pcc -c /path/to/project-control-center -n dev
tmux send-keys -t pcc:dev.0 "npm run server:dev" C-m
tmux split-window -h -t pcc:dev -c /path/to/project-control-center
tmux send-keys -t pcc:dev.1 "npm run dev" C-m
tmux attach -t pcc
```
Detach anytime with `Ctrl+b` then `d`.

## VM Setup (Remote Execution)

For sandboxed execution, PCC can run builds on a GCP VM.
Self-hosted setups manage this directly; PCC Cloud handles VM hosting in
`pcc-cloud`.

### Prerequisites
- GCP account with a project
- `gcloud` CLI installed and authenticated
- VM image with Node.js, Docker, and dependencies

### Configuration
Add to your `.env`:
```bash
CONTROL_CENTER_GCLOUD_PATH=/usr/local/bin/gcloud
CONTROL_CENTER_SSH_PATH=/usr/bin/ssh
CONTROL_CENTER_RSYNC_PATH=/usr/bin/rsync
CONTROL_CENTER_GCP_IMAGE_PROJECT=your-gcp-project
CONTROL_CENTER_GCP_IMAGE_FAMILY=pcc-runner
CONTROL_CENTER_GCP_SSH_USER=runner
CONTROL_CENTER_VM_REPO_ROOT=/home/runner/repos
CONTROL_CENTER_VM_CODEX_AUTH_PATH=/home/runner/.codex
CONTROL_CENTER_VM_CLEANUP_CRON_PATH=/etc/cron.hourly/pcc-cleanup-workspaces
```

### Provisioning
VMs are provisioned on-demand via the UI or API:
```bash
POST /repos/:id/vm/provision
```

## Autonomous Shift Agent

The shift agent runs autonomous work sessions on a project.

### How it works
1. **Start shift** - Creates a bounded work session
2. **Gather context** - Fetches project state (WOs, runs, git, constitution)
3. **Decide** - LLM picks what to work on based on priorities
4. **Execute** - Kicks off runs, monitors, handles issues
5. **Loop** - Repeats until timeout or nothing left to do
6. **Handoff** - Documents what happened for the next shift

### Running the shift agent
```bash
# Start an autonomous shift on a project
./scripts/start-shift.sh project-control-center
```

This invokes Claude CLI with full permissions to run the shift loop. The agent will:
- Call the PCC API to get context
- Decide which WO to work on
- Kick off runs on the VM
- Monitor until complete
- Generate a handoff when done

### Shift Context API
```bash
# Get full project context for shift decisions
GET /projects/:id/shift-context

# Start a shift
POST /projects/:id/shifts

# Complete with handoff
POST /projects/:id/shifts/:shiftId/complete
```

## Expose UI via ngrok (reserved domain + basic auth)
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

## Build
```bash
npm run build
npm run server:build
```

## E2E smoke tests (Playwright)
```bash
npm test
```
By default, tests run the API on `http://127.0.0.1:4011` and the built UI on `http://127.0.0.1:3012`.
Override with `E2E_API_PORT`, `E2E_WEB_PORT`, and `E2E_OFFLINE_WEB_PORT` if those ports are in use.

## Roadmap

**v0 (Done)**
- ✅ Scaffold Next.js PWA + local server + SQLite.
- ✅ Repo scanner + portfolio dashboard.
- ✅ Work Order Kanban per repo.
- ✅ Codex builder + reviewer loop with handoff summaries.
- ✅ Settings page for provider/model.

**v1 (Done)**
- ✅ Chat system with scoped threads and attention notifications.
- ✅ Starred projects in portfolio.
- ✅ E2E testing with Playwright (desktop + mobile).
- ✅ ngrok exposure with basic auth.
- ✅ Git worktree isolation for runner and chat.
- ✅ Tech tree visualization for WO dependencies.

**v2 (Current)**
- ✅ VM isolation (DB, API, UI, provisioning, lifecycle).
- ✅ Remote exec + repo sync with safety guardrails.
- ✅ Runner integration with VM artifact egress.
- ✅ Constitution system (schema, generation, injection).
- ✅ Shift system (context, lifecycle, handoffs).
- ✅ Auto-handoff generation from run logs.
- ⏳ Shift agent (local Claude CLI).
- ⏳ Run time estimation.

**v3 (Planned)**
- ⏳ Global agent (cross-project orchestration).
- ⏳ Escalation routing system.
- ⏳ Project health monitoring.
- ⏳ Shift agent VM deployment (24/7 autonomous).
- ⏳ External integrations (GitHub, Slack).
- ⏳ Strategic planning & roadmaps.

## Documentation
- `docs/work_orders.md` - Work Order contract and lifecycle
- `docs/repo_discovery.md` - Repo discovery and sidecar schema
- `docs/e2e_testing.md` - E2E testing patterns
- `docs/agent_shift_protocol.md` - Shift agent protocol
- `docs/system-architecture.md` - System architecture diagram
- `docs/architecture_diagram.md` - Two-repo architecture diagram
- `docs/SELF_HOSTED.md` - Self-hosted setup guide
- `docs/CLOUD_ARCHITECTURE.md` - Cloud deployment overview
