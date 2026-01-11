# E2E testing

## Isolation patterns
- Use `test` from `e2e/fixtures.ts` to get automatic reset before/after each test.
- `resetTestEnvironment` rebuilds repo fixtures (wipes `alpha`/`beta`, removes extra repos), removes `.control.yml` files, and restores the DB from a snapshot.
- Use the `testRepoPath` fixture for scratch repos; it creates a temp git repo under `e2e/.tmp/repos` and cleans it up.
- Keep per-test state inside `e2e/.tmp` so the reset can cleanly remove it.

## Snapshot behavior
- A DB snapshot is created once per run after the server initializes the test DB.
- The snapshot is restored before and after each test to prevent cross-test pollution.
