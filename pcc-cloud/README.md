# pcc-cloud

pcc-cloud hosts the proprietary cloud services for Project Control Center. It
powers hosted features that the open-source core cannot provide locally.

## What lives in pcc-cloud
- Auth and billing
- VM provisioning and monitoring
- Hosted observability and alerts
- Marketing site and onboarding

## Development (planned)
This repo is still being finalized as part of the split. The expected workflow is:
1. Install dependencies (`npm install`).
2. Configure environment for database, auth, billing, and VM provider access.
3. Run the API service (command TBD).
4. Run background workers for monitoring/alerts (command TBD).

## Relationship to core
`project-control-center` remains local-first and proxies to pcc-cloud for hosted
features when `PCC_MODE=cloud`.

## Status
See `MIGRATION.md` in `project-control-center` for the split plan and sequencing.
