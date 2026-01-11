---
id: WO-2026-056
title: Comprehensive e2e test isolation
goal: Ensure e2e tests are fully isolated and cannot pollute each other's state.
context:
  - e2e/smoke.spec.ts (current test suite)
  - "Incident: Repo move test left beta-moved directory, breaking subsequent tests"
  - Quick fix added beforeEach/afterEach for repo state, but broader cleanup needed
acceptance_criteria:
  - Each test starts with guaranteed clean state (repos, database, control files)
  - Tests cannot pollute each other even on failure/retry
  - Shared test fixtures for common setup/teardown patterns
  - Document test isolation patterns for future test authors
non_goals:
  - Parallel test execution (keep serial for now)
  - Test performance optimization
  - Adding new tests
stop_conditions:
  - If isolation adds significant test runtime (>50% increase), reconsider approach
priority: 2
tags:
  - testing
  - infrastructure
  - stability
estimate_hours: 2
status: ready
created_at: 2026-01-10
updated_at: 2026-01-10
depends_on: []
era: v1
---

## Problem

E2e tests modify shared state (filesystem, database) and can pollute each other:

1. **Filesystem pollution**: Tests rename/create/delete files in `e2e/.tmp/repos/`
2. **Database pollution**: Tests insert/update rows in test database
3. **Control file pollution**: Tests write `.control.yml` files that persist

When a test fails mid-execution, cleanup may not run, leaving dirty state for the next test.

### Recent Incident

"Repo move preserves stable sidecar id" test:
1. Renames `beta` → `beta-moved`
2. Fails at assertion (timeout)
3. `finally` block runs but next test still sees `beta-moved`
4. "Server health" test fails: `Expected ["alpha", "beta"], Received ["alpha", "beta-moved"]`

## Current State

Quick fix added:
```typescript
test.beforeEach(() => ensureCleanRepoState());
test.afterEach(() => ensureCleanRepoState());
```

But this only covers the repo rename case. Other pollution vectors exist.

## Solution

### 1. Comprehensive Reset Function

```typescript
function resetTestEnvironment() {
  const tmpDir = path.join(e2eDir, ".tmp");

  // Reset repos to known state
  ensureCleanRepoState();

  // Reset control files to defaults
  resetControlFiles(tmpDir);

  // Reset database to clean snapshot
  resetTestDatabase(tmpDir);
}
```

### 2. Database Snapshot/Restore

```typescript
function resetTestDatabase(tmpDir: string) {
  const dbPath = path.join(tmpDir, "control-center-test.db");
  const snapshotPath = path.join(tmpDir, "control-center-test.db.snapshot");

  // If snapshot exists, restore it
  if (fs.existsSync(snapshotPath)) {
    fs.copyFileSync(snapshotPath, dbPath);
  }
}

// In global setup: create snapshot after initial DB setup
function createDatabaseSnapshot(tmpDir: string) {
  const dbPath = path.join(tmpDir, "control-center-test.db");
  const snapshotPath = path.join(tmpDir, "control-center-test.db.snapshot");
  fs.copyFileSync(dbPath, snapshotPath);
}
```

### 3. Control File Reset

```typescript
function resetControlFiles(tmpDir: string) {
  const reposDir = path.join(tmpDir, "repos");

  // Remove any .control.yml files (tests should create their own)
  for (const repo of fs.readdirSync(reposDir)) {
    const controlPath = path.join(reposDir, repo, ".control.yml");
    if (fs.existsSync(controlPath)) {
      fs.unlinkSync(controlPath);
    }
  }
}
```

### 4. Test Fixture Pattern

Create reusable fixtures for common patterns:

```typescript
// fixtures.ts
export const testRepo = test.extend<{ repoPath: string }>({
  repoPath: async ({}, use) => {
    const tmpDir = path.join(e2eDir, ".tmp");
    const repoPath = path.join(tmpDir, "repos", "test-repo");

    // Setup
    fs.mkdirSync(repoPath, { recursive: true });

    await use(repoPath);

    // Teardown
    fs.rmSync(repoPath, { recursive: true, force: true });
  },
});
```

## Files to Modify

- `e2e/smoke.spec.ts` - Add comprehensive reset, refactor existing cleanup
- `e2e/fixtures.ts` (new) - Reusable test fixtures
- `e2e/setup.ts` (new or modify) - Global setup/teardown with DB snapshot

## Tests That Modify State

Audit these tests for proper isolation:

| Test | Modifies | Current Cleanup |
|------|----------|-----------------|
| Star/unstar reorder | DB (starred flag) | Unstars at end |
| Star persists across repo ID migration | DB + .control.yml | Unstars at end |
| Star preserved when merging duplicate rows | DB (multiple tables) | Unstars at end |
| Repo move preserves stable sidecar id | Filesystem + .control.yml | finally block |
| Invalid tags JSON never crashes | DB (tags column) | None explicit |
| Chat overlay deep link + rename/archive | DB (threads) | None explicit |
