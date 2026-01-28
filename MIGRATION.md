# PCC <-> pcc-cloud Migration Plan

## Goal
Split PCC into two repos: open-source core (`project-control-center`) and proprietary cloud services/marketing (`pcc-cloud`). This doc is the plan only; no files are moved in this Work Order.

## Repo responsibilities
- `project-control-center`: local-first UI + local runner, Work Orders, chat, constitution, tech tree, and project management.
- `pcc-cloud`: hosted services (auth, billing, VM hosting/monitoring, GitHub integrations) plus the public marketing site.

## Migration Status

| Area | Status | Notes |
| --- | --- | --- |
| Landing page | ✅ Done | Migrated in WO-2026-221 |
| VM provisioning | ✅ New impl in pcc-cloud | Fly.io-based (`src/vm/`) |
| Legacy VM code in core | ⏳ Pending removal | See WO-2026-229 |
| Auth & billing | ✅ In pcc-cloud | `src/auth/`, `src/billing/` |
| GitHub integration | ✅ In pcc-cloud | `src/github/` |
| API gateway | ✅ In pcc-cloud | `src/gateway/` |

## File/Directory Disposition (STAY vs REMOVE)
| Area | Path(s) | Disposition | Notes |
| --- | --- | --- | --- |
| Landing page (marketing) | `app/(public)/landing/` | ✅ DONE | Moved to pcc-cloud |
| VM hosting/provisioning | `server/vm_manager.ts` | REMOVE | Legacy GCP code - pcc-cloud has new Fly.io impl |
| VM remote exec | `server/remote_exec.ts` | REMOVE | Legacy - not needed in local-first core |
| VM API routes | `app/api/repos/[id]/vm/*` | REMOVE | Cloud-only feature |
| VM health routes | `app/api/observability/vm-health/*` | REMOVE | Cloud-only feature |
| VM health UI hooks | `app/observability/hooks/useVMHealth.ts` | REMOVE | Cloud-only feature |
| VM shift script | `scripts/start-shift-vm.ts` | REMOVE | Cloud-only feature |
| Core runner | `server/runner_agent.ts`, `server/runner_worker.ts`, `server/providers/*` | STAY | Local runner orchestration |
| Work Orders + Kanban | `work_orders/`, `server/work_orders.ts`, `app/projects/[id]/KanbanBoard.tsx` | STAY | Local-first WO management |
| Chat system | `server/chat_*`, `app/chat/*`, `app/components/Chat*`, `app/api/chat/*` | STAY | Local-first chat |
| Constitution system | `server/constitution*`, `app/components/ConstitutionGenerationWizard.tsx`, `app/api/constitution/*` | STAY | Constitution generation + storage |
| Tech tree | `app/projects/[id]/TechTreeView.tsx`, `app/projects/[id]/tracks/*`, `server/work_order_dependencies.ts` | STAY | Tech tree visualization |
| Kanban/WO detail UI | `app/projects/[id]/work-orders/*` | STAY | Work Order UX |

## Split process (sequencing)

### Completed
1. ✅ Created `pcc-cloud` repo with new architecture
2. ✅ Implemented Fly.io-based VM provisioning in pcc-cloud
3. ✅ Set up auth, billing, GitHub integration in pcc-cloud
4. ✅ Migrated landing page to pcc-cloud (WO-2026-221)

### Remaining
1. ⏳ Remove legacy VM code from PCC core (WO-2026-229)
2. ⏳ Update files that reference removed VM code
3. ⏳ Add CloudFeatureCTA components where VM features were
4. ⏳ Deploy pcc-cloud to production

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
- pcc-cloud uses Postgres for cloud state (accounts, workspaces, billing).
- Landing page migration completed in WO-2026-221.
- VM code removal tracked in WO-2026-229.
- pcc-cloud VM implementation uses Fly.io (not GCP like the legacy code).
