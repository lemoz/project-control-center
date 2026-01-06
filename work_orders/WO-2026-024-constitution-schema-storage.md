---
id: WO-2026-024
title: Constitution Schema and Storage
goal: Define the constitution format, storage locations, and read/write APIs for both global and per-project constitutions that capture user preferences, learned patterns, and decision heuristics.
context:
  - server/db.ts (database schema)
  - server/settings.ts (global settings pattern)
  - server/repos.ts (per-project metadata)
  - ~/.control-center/ (global data location)
  - .control.yml (per-project sidecar)
acceptance_criteria:
  - Define constitution markdown format with standard sections (Decision Heuristics, Style & Taste, Anti-Patterns, Success Patterns, Domain Knowledge, Communication)
  - Global constitution stored at ~/.control-center/constitution.md
  - Per-project constitution stored at {repo}/.constitution.md (gitignored by default)
  - API endpoint GET /constitution returns merged global + local constitution for a project
  - API endpoint PUT /constitution/global updates global constitution
  - API endpoint PUT /repos/:id/constitution updates project-specific constitution
  - Constitution versioning - keep last 5 versions for rollback
  - UI to view and edit constitution (global in settings, local in project page)
  - Per-project constitution extends/overrides global (not replaces)
non_goals:
  - Automatic constitution generation (separate WO)
  - Injecting constitution into prompts (separate WO)
  - Complex merge strategies for global vs local conflicts
  - Constitution validation or linting
stop_conditions:
  - If markdown format proves too unstructured, consider YAML with schema validation
  - If versioning adds too much complexity, start with single file (no history)
priority: 2
tags:
  - constitution
  - settings
  - storage
  - autonomy
estimate_hours: 6
status: ready
created_at: 2026-01-06
updated_at: 2026-01-06
depends_on:
  - WO-2025-002
era: autonomous
---

# Constitution Schema and Storage

## Overview

The constitution is a living document that captures user preferences, learned patterns, decision heuristics, and domain knowledge. It enables agents to make aligned decisions autonomously.

## Constitution Format

```markdown
# Constitution

## Decision Heuristics
General principles for making decisions.
- Prefer simple over clever
- Don't add abstractions until the third use case
- Fix the root cause, not the symptom

## Style & Taste
Preferences for code style, communication, and aesthetics.
- Terse commit messages (50 char subject, body if needed)
- Code speaks for itself - minimal comments unless complex
- Prefer explicit over implicit

## Anti-Patterns (Learned Failures)
Things that have gone wrong and should be avoided.
- Never use `any` type in TypeScript without explicit justification
- Don't modify db.ts schema without migration plan
- Avoid deeply nested callbacks

## Success Patterns
Approaches that have worked well.
- Test-first approach for bug fixes catches regressions
- Breaking large WOs into small ones improves success rate
- Reading existing code before writing new code

## Domain Knowledge
Project-specific or technical knowledge.
- Chat system uses SSE for real-time updates, not WebSockets
- Work orders use YAML frontmatter with specific required fields
- Runner uses git worktrees for isolation

## Communication
How to interact with the user.
- Be direct, skip preamble
- Show code first, explain after
- Don't ask for confirmation on small changes
```

## Storage Locations

### Global Constitution
```
~/.control-center/constitution.md
~/.control-center/constitution.versions/
  - constitution.2026-01-06T10-30-00.md
  - constitution.2026-01-05T15-22-00.md
  ...
```

### Per-Project Constitution
```
{repo}/.constitution.md
{repo}/.constitution.versions/  (optional)
```

## API Design

### Get Merged Constitution
```
GET /constitution?projectId=xxx
Response: { global: string, local: string | null, merged: string }
```

### Update Global Constitution
```
PUT /constitution/global
Body: { content: string }
Response: { ok: true, version: string }
```

### Update Project Constitution
```
PUT /repos/:id/constitution
Body: { content: string }
Response: { ok: true, version: string }
```

### Get Constitution Versions
```
GET /constitution/versions?scope=global|project&projectId=xxx
Response: { versions: [{ timestamp, content }] }
```

## CRITICAL: Code Quality Requirements

**IMPORTANT**: Before submitting any code changes:
1. **Ensure ALL imports are present** - If you use a function like `appendLog`, `writeJson`, `ensureDir`, `readJson`, etc., verify it is imported at the top of the file
2. **Check existing imports** - Look at what's already imported in the file and follow those patterns
3. **Run TypeScript mentally** - Would `tsc` pass? Are all types correct?
4. **Common utility imports**: Functions like `appendLog`, `writeJson`, `readJson`, `ensureDir` typically come from `./utils`
5. **Verify imports before adding code** - If you call a function, grep for where it's imported elsewhere in the codebase

Previous runs failed because `appendLog` was used without being imported. This is unacceptable.

## Merge Strategy

When both global and local exist:
1. Start with global as base
2. Local sections REPLACE global sections of same name
3. Local can ADD new sections
4. Result is the merged document

This allows projects to override specific sections while inheriting others.
