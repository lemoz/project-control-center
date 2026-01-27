# PCC <-> pcc-cloud Migration Plan

## Goal
Split PCC into two repos: open-source core (`project-control-center`) and proprietary cloud services/marketing (`pcc-cloud`). This doc is the plan only; no files are moved in this Work Order.

## Repo responsibilities
- `project-control-center`: local-first UI + local runner, Work Orders, chat, constitution, tech tree, and project management.
- `pcc-cloud`: hosted services (auth, billing, VM hosting/monitoring, GitHub integrations) plus the public marketing site.

## File/Directory Disposition (STAY vs MOVE)
| Area | Path(s) | Disposition | Notes |
| --- | --- | --- | --- |
| Landing page (marketing) | `app/(public)/landing/` | MOVE -> `pcc-cloud` | Explicitly moving the public landing page. |
| VM hosting/provisioning | `server/vm_manager.ts` | MOVE -> `pcc-cloud` | GCP VM lifecycle and provisioning. |
| VM remote exec | `server/remote_exec.ts` | MOVE -> `pcc-cloud` | VM command execution lives with cloud infra. |
| VM API routes | `server/index.ts` (`/repos/:id/vm/*`, `/observability/vm-health`) | MOVE -> `pcc-cloud` | Hosting/monitoring endpoints. |
| VM health aggregation | `server/observability.ts` (VM health logic) | MOVE -> `pcc-cloud` | Backend health checks/alerts. |
| Core runner | `server/runner_agent.ts`, `server/runner_worker.ts`, `server/providers/*` | STAY in `project-control-center` | Local runner orchestration + provider abstraction. |
| Work Orders + Kanban | `work_orders/`, `server/work_orders.ts`, `app/projects/[id]/KanbanBoard.tsx` | STAY in `project-control-center` | Local-first WO management. |
| Chat system | `server/chat_*`, `app/chat/*`, `app/components/Chat*`, `app/api/chat/*` | STAY in `project-control-center` | Local-first chat + worktree isolation. |
| Constitution system | `server/constitution*`, `app/components/ConstitutionGenerationWizard.tsx`, `app/api/constitution/*` | STAY in `project-control-center` | Constitution generation + storage. |
| Tech tree | `app/projects/[id]/TechTreeView.tsx`, `app/projects/[id]/tracks/*`, `server/work_order_dependencies.ts` | STAY in `project-control-center` | Tech tree visualization + dependencies. |
| Kanban/WO detail UI | `app/projects/[id]/work-orders/*` | STAY in `project-control-center` | Work Order UX. |

## Split process (sequencing)

### Builder/Automatable steps (future WO)
1. Copy/relocate MOVE items into `pcc-cloud` following existing folder structure (`src/auth`, `src/billing`, `src/vm`, `src/api`, `src/db`, `src/github`).
2. Adjust imports and shared types as needed (extract shared types to a minimal package if required).
3. Update local API calls in `project-control-center` to target the new `pcc-cloud` service endpoints.
4. Remove duplicated VM backend code from `project-control-center` after successful cutover.
5. Update docs and run tests for both repos.

### Manual steps (human)
1. Create the `pcc-cloud` GitHub repo (already exists locally at `~/pcc-cloud`).
2. Add `pcc-cloud` as a git remote and push the initial split.
3. Set up secrets/config for cloud services (database, Stripe, auth providers, VM credentials).
4. Configure deployment/CI for `pcc-cloud` (separate WO).

## Open questions / ambiguities (RESOLVED)

| Question | Decision | Rationale |
|----------|----------|-----------|
| `app/landing/*` widgets | MOVE with landing page | Marketing-focused, only used on public landing |
| `app/observability/*` UI | STAY in core, call pcc-cloud APIs | Users want to see VM health from within the app; UI is client to cloud backend |
| `app/api/repos/[id]/vm/*` proxy routes | STAY as thin proxies | Core UI doesn't need to know pcc-cloud URLs; cleaner auth/session handling |
| `app/live/*` (orbital viz) | STAY in core | Useful for showing actual projects; add CTA for cloud features |

## Freemium Model & Cloud CTAs

The open-source core should be genuinely useful standalone, with strategic CTAs pointing users to cloud features where they add value.

### Philosophy
- CTAs should feel helpful, not naggy ("You could do X" not "You're missing out")
- Core features work fully offline/locally
- Cloud features are things that genuinely need infrastructure (hosting, team sync, alerts)

### Natural CTA Touchpoints

| Feature in Core | Cloud CTA | Why it makes sense |
|----------------|-----------|-------------------|
| Orbital visualization | "See team activity across all projects →" | Multi-user views need cloud |
| Local VM runs | "Don't want to manage VMs? Run on PCC Cloud →" | Hosting is a real pain point |
| Single-user mode | "Collaborate with your team →" | Team features need auth/sharing |
| Manual monitoring | "Get alerts when builds fail →" | Alerting needs always-on infra |
| Local-only data | "Backup & sync across machines →" | Sync needs cloud storage |

### Implementation Pattern

```tsx
// Subtle upsell component in core app
<CloudFeatureCTA
  feature="team-dashboard"
  text="See your team's activity"
  show={!isCloudConnected}
/>
```

### Files affected
- `LiveOrbitalCanvas` stays in core with full local functionality + small CTA badge
- New `CloudFeatureCTA` component in core for consistent upsell UI
- Core app checks `isCloudConnected` to show/hide CTAs

## Notes
- The SQLite database remains the source of truth for runtime state in `project-control-center`.
- This plan avoids moving files until a follow-up WO is approved.
