# Contributing to Project Control Center

Thanks for contributing. This project is split into two repos with different scopes.

## Which repo should I use?
- `project-control-center` (this repo): open-source core UI, local API/runner, Work Orders, and docs for the self-hosted experience.
- `pcc-cloud`: proprietary cloud services, auth/billing, VM hosting/monitoring, and the marketing site.

If your change touches hosted services, auth, billing, VM provisioning, or the public site, it belongs in `pcc-cloud`.
If you are unsure, open an issue here and we will triage.

## Work Orders
Most changes should map to a Work Order in `work_orders/`.
Follow the YAML contract in `docs/work_orders.md` and keep changes scoped to the active WO.

## Local development (core)
```bash
npm install
npm run server:dev
npm run dev
```

## Tests
```bash
npm test
```

## Notes
- Do not commit secrets. Use `.env` and keep it gitignored.
- Keep changes minimal and focused.
