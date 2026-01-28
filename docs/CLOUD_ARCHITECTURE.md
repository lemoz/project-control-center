# PCC Cloud Architecture

This document explains how the cloud deployment is expected to work when the
`pcc-cloud` repo is active. The open-source core remains in
`project-control-center` and integrates with hosted services as needed.

## Repo responsibilities
| Area | Core (`project-control-center`) | Cloud (`pcc-cloud`) |
| --- | --- | --- |
| UI and PWA | Runs locally | Hosted marketing and onboarding |
| Work Orders and Kanban | Local-first, file-backed | Not hosted |
| Runner and providers | Local runner orchestration | Managed runners and VM fleet |
| Auth and billing | Local-only | Auth, billing, and subscriptions |
| VM provisioning | Local or proxied | VM provisioning and monitoring |
| Observability/alerts | Local UI | Hosted alerting and aggregation |

## Cloud mode flow (expected)
1. User runs the core UI and API locally or on a managed instance.
2. Core handles local-first workflows (WOs, chat, runner orchestration).
3. For hosted features (auth, billing, VM hosting, alerts), core calls into
   `pcc-cloud` APIs, typically via proxy routes in the core server.

## Deployment components (planned)
- `pcc-cloud` API service (Node/TS)
- Persistent database for cloud state (accounts, billing, VM metadata)
- VM provider integration (GCP or equivalent)
- Background workers for monitoring and alerts
- Public marketing site

## Assumptions and open questions
- Exact hosting platform, auth provider, and billing workflow are TBD.
- Whether core runs locally in cloud mode or is hosted as a managed instance
  is still evolving.
- Data sync strategy between local SQLite state and cloud accounts is TBD.

See `MIGRATION.md` for the split plan and `docs/SELF_HOSTED.md` for the
self-hosted setup.
