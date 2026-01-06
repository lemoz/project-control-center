/**
 * Backfill script to populate work_order_run_id in chat_action_ledger
 * for existing work_order_start_run actions.
 *
 * Run with: npx tsx scripts/backfill_work_order_run_ids.ts
 */
import Database from "better-sqlite3";
import path from "path";

const dbPath = process.env.CONTROL_CENTER_DB_PATH || path.join(process.cwd(), "control-center.db");
const db = new Database(dbPath);

interface ActionRow {
  id: string;
  action_payload_json: string;
  applied_at: string;
  work_order_run_id: string | null;
}

interface RunRow {
  id: string;
  project_id: string;
  work_order_id: string;
  created_at: string;
}

// Find all work_order_start_run actions that don't have a work_order_run_id yet
const actions = db.prepare(`
  SELECT id, action_payload_json, applied_at, work_order_run_id
  FROM chat_action_ledger
  WHERE action_type = 'work_order_start_run'
    AND work_order_run_id IS NULL
`).all() as ActionRow[];

console.log(`Found ${actions.length} work_order_start_run actions to backfill`);

let updated = 0;
let skipped = 0;

for (const action of actions) {
  try {
    const payload = JSON.parse(action.action_payload_json) as { projectId: string; workOrderId: string };

    // Find the run that matches this action
    // The run should have been created within 60 seconds of the action being applied
    const actionTime = new Date(action.applied_at).getTime();

    const runs = db.prepare(`
      SELECT id, project_id, work_order_id, created_at
      FROM runs
      WHERE project_id = ? AND work_order_id = ?
      ORDER BY created_at ASC
    `).all(payload.projectId, payload.workOrderId) as RunRow[];

    // Find the run closest to the action time
    let bestMatch: RunRow | null = null;
    let bestDiff = Infinity;

    for (const run of runs) {
      const runTime = new Date(run.created_at).getTime();
      const diff = Math.abs(runTime - actionTime);

      // Only consider runs within 60 seconds of the action
      if (diff < 60000 && diff < bestDiff) {
        bestDiff = diff;
        bestMatch = run;
      }
    }

    if (bestMatch) {
      db.prepare(`
        UPDATE chat_action_ledger
        SET work_order_run_id = ?
        WHERE id = ?
      `).run(bestMatch.id, action.id);

      const actionIdShort = action.id.slice(0, 8);
      const runIdShort = bestMatch.id.slice(0, 8);
      const diffSecs = Math.round(bestDiff / 1000);
      console.log(`✓ Action ${actionIdShort} -> Run ${runIdShort} (${diffSecs}s diff)`);
      updated++;
    } else {
      const actionIdShort = action.id.slice(0, 8);
      console.log(`✗ Action ${actionIdShort} - no matching run found for WO ${payload.workOrderId}`);
      skipped++;
    }
  } catch (err) {
    const actionIdShort = action.id.slice(0, 8);
    console.log(`✗ Action ${actionIdShort} - error: ${err}`);
    skipped++;
  }
}

console.log(`\nBackfill complete: ${updated} updated, ${skipped} skipped`);
db.close();
