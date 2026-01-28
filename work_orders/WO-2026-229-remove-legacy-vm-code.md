---
id: WO-2026-229
title: Remove legacy VM code from PCC core
goal: Remove GCP-based VM hosting code from PCC core now that pcc-cloud has Fly.io implementation.
context:
  - PCC core is now local-first only
  - pcc-cloud has new Fly.io-based VM provisioning (src/vm/)
  - Legacy GCP VM code in core is dead code
  - Part of core/cloud split per MIGRATION.md
acceptance_criteria:
  - Delete server/vm_manager.ts
  - Delete server/remote_exec.ts
  - Delete scripts/start-shift-vm.ts
  - Delete app/api/repos/[id]/vm/ directory
  - Delete app/api/observability/vm-health/ directory
  - Delete app/observability/hooks/useVMHealth.ts
  - Remove ProjectVm types and table references from server/db.ts
  - Remove VM imports/references from server/index.ts
  - Remove VM references from server/observability.ts
  - Remove VM references from server/shift_context.ts
  - Remove VM references from server/global_context.ts
  - Remove VM references from server/autopilot.ts
  - Remove VM references from server/runner_agent.ts
  - Update any UI components that referenced VM features (add CTA to cloud)
  - All tests pass after removal
  - No TypeScript errors
non_goals:
  - Adding new VM functionality to core
  - Modifying pcc-cloud VM code
stop_conditions:
  - If removal breaks critical local-first functionality, stop and reassess
priority: 2
tags:
  - cleanup
  - migration
  - local-first
estimate_hours: 3
status: ready
created_at: 2026-01-28
updated_at: 2026-01-28
depends_on: []
era: v2
---
## Files to Delete
- `server/vm_manager.ts`
- `server/remote_exec.ts`
- `scripts/start-shift-vm.ts`
- `app/api/repos/[id]/vm/` (entire directory)
- `app/api/observability/vm-health/` (entire directory)
- `app/observability/hooks/useVMHealth.ts`

## Files to Update
- `server/db.ts` - Remove ProjectVm types, table creation, queries
- `server/index.ts` - Remove VM route imports and endpoints
- `server/observability.ts` - Remove VM health logic
- `server/shift_context.ts` - Remove VM references
- `server/global_context.ts` - Remove VM references
- `server/autopilot.ts` - Remove VM references
- `server/runner_agent.ts` - Remove VM references
- `server/config.ts` - Remove VM-related config (gcp, ssh keys, etc.)

## UI Components to Update
Any components that showed VM status/controls should either:
1. Be removed entirely, or
2. Show a CTA to pcc-cloud for VM features

## Verification
```bash
# After changes, verify:
npm run build
npm test
# Grep for any remaining VM references
grep -r "vm_manager\|remote_exec\|ProjectVm\|vmHealth" server/ app/ --include="*.ts" --include="*.tsx"
```
