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

## Data Source of Truth

**IMPORTANT:** The SQLite database (`control-center.db`) is the source of truth for runtime state, not the markdown files.

### WO Status Management
- **Database**: Source of truth for WO status. Always query the API, not files.
- **Files**: WO markdown files contain status but can be stale or overwritten by git operations.
- **Git sync issue**: When runs merge to main, the WO files in git have `you_review` status. Any git pull/sync will overwrite local file changes.

### Updating WO Status
- Use the API: `PATCH /repos/{project_id}/work-orders/{wo_id}` with `{"status": "done"}`
- The API updates both the file AND the database
- **Caveat**: File changes are NOT committed to git automatically. Subsequent git operations may revert them.

### For Permanent Status Changes
When transitioning WOs to `done` after human review:
1. Update via API (updates file + DB)
2. Commit the file change to git: `git add work_orders/{wo_file}.md && git commit -m "Mark {WO-ID} as done"`
3. This ensures the status persists across git operations

## Security
- Never commit secrets. Use `.env` and keep it gitignored.
- Avoid adding network calls unless required by a Work Order.

## Commands
- UI dev server: `npm run dev`
- Server dev: `npm run server:dev`
- Tests: `npm test`

## Escalation Handling

When a builder agent cannot complete a task (missing dependencies, needs manual verification, requires user decision), it can request escalation.

### How Escalation Works

1. **Builder requests help** - Emits `<<<NEED_HELP>>>...<<<END_HELP>>>` block with:
   - `what_i_tried`: What the builder attempted
   - `what_i_need`: What it needs from the user
   - `inputs`: Array of `{key, label}` for required user inputs

2. **Run pauses** - Status changes to `waiting_for_input`, escalation record stored in `run.escalation` DB column

3. **User provides input** - Call the API endpoint:
   ```
   POST /runs/:runId/provide-input
   Content-Type: application/json

   {
     "input_key_1": "value",
     "input_key_2": "value"
   }
   ```

4. **Run resumes** - Status changes to `building`, builder continues with provided inputs

### Finding Escalation Details

- **Run logs**: Check `{run_dir}/run.log` for "Escalation requested" message
- **Database**: Query `SELECT escalation FROM runs WHERE id = ?` and parse JSON
- **API**: `GET /runs/:runId` returns escalation details in response

### Common Escalation Scenarios

- Missing API keys or environment variables
- Manual test verification required
- Ambiguous requirements needing user clarification
- External service unavailable

### Important

- Do NOT manually edit the database status to bypass escalation
- Do NOT create resolution files manually - use the API
- The builder subprocess is paused and waiting for the API to signal resume
