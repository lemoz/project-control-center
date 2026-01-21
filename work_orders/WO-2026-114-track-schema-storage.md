---
id: WO-2026-114
title: Track Schema & Storage
goal: Add Track as a first-class entity in PCC to group work orders by strategic goal.
context:
  - server/db.ts - database tables and functions
  - server/work_orders.ts - WO parsing and types
  - server/index.ts - API endpoints
  - Tracks group WOs by strategic direction (e.g., "Economy", "Runner Reliability", "Visualization")
  - Unlike tags (attributes) or era (temporal), tracks represent goal-oriented streams
acceptance_criteria:
  - Create `tracks` table with id, project_id, name, description, goal, color, icon, sort_order, created_at, updated_at
  - Add `track_id TEXT` column to `work_orders` table (nullable, FK to tracks)
  - CRUD functions in db.ts: createTrack, updateTrack, deleteTrack, listTracks, getTrackById
  - API endpoints: GET/POST /repos/:id/tracks, GET/PUT/DELETE /repos/:id/tracks/:trackId
  - Track type definition exported from db.ts
  - Include track info in getWorkOrder and listWorkOrders responses
  - Migration handles existing DBs gracefully
non_goals:
  - UI for managing tracks (WO-2026-116)
  - Assigning existing WOs to tracks (WO-2026-115)
  - Track visualization (WO-2026-117, 118)
stop_conditions:
  - If track_id FK causes issues with WO file-based storage, make it DB-only metadata
priority: 2
tags:
  - infrastructure
  - data-model
  - tracks
estimate_hours: 3
status: done
created_at: 2026-01-15
updated_at: 2026-01-16
depends_on: []
era: v2
---
## Overview

Tracks are goal-oriented groupings of work orders. While `era` represents temporal phases (v0, v1, v2) and `tags` are loose attributes, tracks represent strategic streams that lead toward specific outcomes.

Example tracks:
- **Economy**: Cost tracking → Budget allocation → Enforcement → Agent earning
- **Runner Reliability**: Worktree isolation → Base branch → Merge lock
- **Visualization**: Canvas foundation → Multiple viz types → Evaluation

## Database Schema

```sql
CREATE TABLE IF NOT EXISTS tracks (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  goal TEXT,  -- The end-state this track is building toward
  color TEXT,  -- Hex color for UI (e.g., "#3B82F6")
  icon TEXT,   -- Icon identifier (e.g., "dollar", "chart", "shield")
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_tracks_project_id ON tracks(project_id);

-- Add to work_orders table
ALTER TABLE work_orders ADD COLUMN track_id TEXT REFERENCES tracks(id) ON DELETE SET NULL;
```

## Type Definitions

```typescript
export type TrackRow = {
  id: string;
  project_id: string;
  name: string;
  description: string | null;
  goal: string | null;
  color: string | null;
  icon: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

export type Track = {
  id: string;
  projectId: string;
  name: string;
  description: string | null;
  goal: string | null;
  color: string | null;
  icon: string | null;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
  // Computed in list queries
  workOrderCount?: number;
  doneCount?: number;
  readyCount?: number;
};
```

## API Endpoints

```typescript
// List all tracks for a project
GET /repos/:id/tracks
Response: { tracks: Track[] }

// Create a new track
POST /repos/:id/tracks
Body: { name, description?, goal?, color?, icon? }
Response: { track: Track }

// Get single track with WO counts
GET /repos/:id/tracks/:trackId
Response: { track: Track, workOrders: WorkOrder[] }

// Update track
PUT /repos/:id/tracks/:trackId
Body: { name?, description?, goal?, color?, icon?, sortOrder? }
Response: { track: Track }

// Delete track (sets WO track_id to null)
DELETE /repos/:id/tracks/:trackId
Response: { ok: true }

// Assign WO to track
PUT /repos/:id/work-orders/:woId/track
Body: { trackId: string | null }
Response: { ok: true }
```

## Work Order Integration

Update `listWorkOrders` and `getWorkOrderById` to include track info:

```typescript
type WorkOrder = {
  // ... existing fields ...
  trackId: string | null;
  track: {
    id: string;
    name: string;
    color: string | null;
  } | null;
};
```

## Migration

```typescript
// In ensureSchema()
const trackTableExists = database
  .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='tracks'")
  .get();

if (!trackTableExists) {
  database.exec(`
    CREATE TABLE tracks (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      goal TEXT,
      color TEXT,
      icon TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );
    CREATE INDEX idx_tracks_project_id ON tracks(project_id);
  `);
}

const woColumns = database.prepare("PRAGMA table_info(work_orders)").all();
const hasTrackId = woColumns.some((c) => c.name === "track_id");
if (!hasTrackId) {
  database.exec("ALTER TABLE work_orders ADD COLUMN track_id TEXT REFERENCES tracks(id) ON DELETE SET NULL");
}
```

## Testing

1. Create track via API, verify in DB
2. Assign WO to track, verify track info in WO response
3. Delete track, verify WO track_id becomes null
4. List tracks with WO counts
