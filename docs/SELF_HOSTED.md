# Self-hosted PCC

This guide covers running the open-source core (`project-control-center`) locally.

## Requirements
- Node.js 18+
- npm
- Optional: GCP credentials and CLI tools if you want VM execution

## Setup
```bash
# from the repo root
cp .env.example .env
# edit .env and set OPENAI_API_KEY
npm install
npm run server:dev
npm run dev
```

The API runs at `http://localhost:4010` and the UI at `http://localhost:3010`.

## Configuration
- `PCC_MODE=local` (default)
- `PCC_DATABASE_PATH=./control-center.db`
- `PCC_REPOS_PATH=/path/to/repos`

## Data locations
- SQLite: `control-center.db`
- Work Orders: `work_orders/`
- Run artifacts: `.system/`

## Optional: VM execution
Self-hosted PCC can provision and run jobs on a GCP VM. If you want that flow,
configure the VM-related variables described in `README.md` and ensure `gcloud`,
`ssh`, and `rsync` are available locally.

## Related docs
- `docs/work_orders.md`
- `docs/system-architecture.md`
- `docs/CLOUD_ARCHITECTURE.md`
