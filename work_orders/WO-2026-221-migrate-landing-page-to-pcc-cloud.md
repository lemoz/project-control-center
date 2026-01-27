---
id: WO-2026-221
title: Migrate landing page to pcc-cloud
status: ready
priority: 1
tags:
  - migration
  - pcc-cloud
  - cross-project
estimate_hours: 2
depends_on:
  - WO-2026-177
era: v2
created_at: 2026-01-27
updated_at: 2026-01-27
goal: Move the public landing page from project-control-center to pcc-cloud repo.
context:
  - MIGRATION.md documents this as a MOVE item
  - Landing page lives at app/(public)/landing/ in this repo
  - pcc-cloud is a sibling PCC project at /Users/cdossman/pcc-cloud
  - This is the first file migration - test of cross-project coordination
  - You have access to cross-project communication via POST /projects/:id/communications
  - pcc-cloud project ID is "pcc-cloud"
acceptance_criteria:
  - Remove app/(public)/landing/ directory from this repo
  - Send a communication to pcc-cloud with the files/code that should be added there
  - Communication should include the full file contents or a clear manifest
  - Update any imports in this repo that referenced landing page components
  - Add a note in MIGRATION.md that landing page migration is complete
non_goals:
  - Actually writing to pcc-cloud repo (you can't - use communication instead)
  - Migrating VM code (separate WO)
  - Setting up pcc-cloud build/deploy
stop_conditions:
  - If you can't send a communication to pcc-cloud, escalate
  - If landing page has dependencies on core components, document them
---

## Notes

This WO tests cross-project communication. The builder should:
1. Read the landing page files
2. Remove them from this repo
3. Send a communication to pcc-cloud with the file contents
4. The pcc-cloud project can then pick up that communication and add the files

Use the communication API:
```bash
curl -s -X POST "http://localhost:4010/projects/project-control-center/communications" \
  -H "Content-Type: application/json" \
  -d '{
    "intent": "request",
    "to_scope": "project",
    "to_project_id": "pcc-cloud",
    "summary": "Landing page files to add",
    "body": "... file contents ..."
  }'
```
