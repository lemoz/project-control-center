# Agent Guidelines

These rules apply to any agent working in this repo.

## Purpose
Build a local-first Project Control Center: a Next.js PWA + local runner to manage repos, Work Orders, and AI agent runs.

## Conventions
- Language: TypeScript for UI/server unless a Work Order specifies otherwise.
- Formatting: follow repo linters/formatters once added (likely ESLint + Prettier).
- Keep changes minimal and scoped to the active Work Order.

## Required reading order
1. `README.md`
2. `DECISIONS.md`
3. `docs/work_orders.md`
4. The active Work Order file.

## Work Orders
- Work Orders live in `work_orders/` and must conform to the YAML contract.
- Do not change the contract without updating `docs/work_orders.md` and `DECISIONS.md`.

## Security
- Never commit secrets. Use `.env` and keep it gitignored.
- Avoid adding network calls unless required by a Work Order.

## Commands
- UI dev server: `npm run dev`
- Server dev: `npm run server:dev`
- Tests: `npm test`
