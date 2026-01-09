# VM lifecycle manual checklist (GCP)

Use this checklist to validate VM provisioning/lifecycle endpoints when automated tests are not available.

## Preconditions
- `gcloud` installed and authenticated (`gcloud auth login`).
- `CONTROL_CENTER_GCP_PROJECT` and `CONTROL_CENTER_GCP_ZONE` set (or configured in `gcloud`).
- `CONTROL_CENTER_GCP_SSH_USER` and `CONTROL_CENTER_GCP_SSH_KEY_PATH` set (required; no `gcloud` fallback).
- Server running (`npm run server:dev`).

## Checklist
1. `GET /repos/:id/vm` returns `status=not_provisioned` for a new project.
2. `POST /repos/:id/vm/provision` returns `status=running` and sets:
   - `gcp_instance_id`, `gcp_instance_name`, `gcp_project`, `gcp_zone`
   - `external_ip`, `internal_ip`, `last_started_at`, `last_activity_at`
3. `POST /repos/:id/vm/stop` returns `status=stopped` with `last_error=null`.
4. `POST /repos/:id/vm/start` returns `status=running` and refreshes `external_ip` if it changed.
5. `PUT /repos/:id/vm/resize` (with a new `vm_size`) returns updated `size` and a valid `status`.
6. `DELETE /repos/:id/vm` returns `status=deleted` and clears `external_ip`/`internal_ip`.
7. For any failing lifecycle command, confirm `status=error` (or `deleted` on not found) and `last_error` is populated.
