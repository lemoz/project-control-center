---
id: WO-2026-116
title: Track Management UI
goal: Provide a UI for creating, editing, reordering, and deleting tracks within a project.
context:
  - WO-2026-114 provides the API endpoints
  - app/projects/[id]/ contains project-level pages
  - Tracks need CRUD operations accessible to users
  - Design should be consistent with existing PCC UI patterns
acceptance_criteria:
  - New page at /projects/[id]/tracks showing all tracks for the project
  - Track list displays name, description, goal, color, and WO count
  - Drag-to-reorder tracks (updates sort_order)
  - '"Create Track" button opens modal with name, description, goal, color picker'
  - Click track row to edit (inline or modal)
  - Delete track with confirmation (warns about orphaning WOs)
  - Track color shown as badge/chip in list
  - Link to tracks page from project detail sidebar/nav
non_goals:
  - Assigning individual WOs to tracks from this page (that's in WO detail)
  - Bulk WO assignment UI
  - Track templates or presets
stop_conditions:
  - If drag-to-reorder is complex, use up/down arrows instead
priority: 2
tags:
  - ui
  - tracks
  - management
estimate_hours: 3
status: done
created_at: 2026-01-15
updated_at: 2026-01-27
depends_on:
  - WO-2026-114
era: v2
---
## Overview

Users need a way to manage tracks for their projects. This page provides full CRUD operations for tracks, similar to how work orders are managed in the Kanban view.

## Page Layout

```
/projects/[id]/tracks

┌─────────────────────────────────────────────────────────────┐
│ Tracks                                        [+ New Track] │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ ⣿ [████] Runner Reliability                    12 WOs  │ │
│ │   Parallel runs that don't break each other            │ │
│ │   Goal: Reliable parallel execution                    │ │
│ └─────────────────────────────────────────────────────────┘ │
│                                                             │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ ⣿ [████] Economy                                8 WOs  │ │
│ │   Cost awareness and budgets                           │ │
│ │   Goal: Self-sustaining agent economy                  │ │
│ └─────────────────────────────────────────────────────────┘ │
│                                                             │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ ⣿ [████] Visualization                         10 WOs  │ │
│ │   Rich visual dashboards                               │ │
│ │   Goal: See system state at a glance                   │ │
│ └─────────────────────────────────────────────────────────┘ │
│                                                             │
└─────────────────────────────────────────────────────────────┘

⣿ = drag handle for reordering
[████] = color indicator
```

## Components

### TrackList
- Fetches tracks from GET /repos/:id/tracks
- Renders TrackCard for each track
- Handles drag-and-drop reordering
- Updates sort_order via PUT on drop

### TrackCard
- Displays track info (name, description, goal, color, WO count)
- Hover shows edit/delete actions
- Click opens edit modal
- Drag handle on left

### TrackModal (Create/Edit)
- Fields: name (required), description, goal, color
- Color picker with preset palette + custom hex
- Icon selector (optional, stretch goal)
- Save calls POST (create) or PUT (update)

### DeleteConfirmation
- Shows WO count that will be orphaned
- "Delete" and "Cancel" buttons
- Calls DELETE endpoint

## Color Palette Presets

```typescript
const TRACK_COLORS = [
  { name: "Gray", hex: "#6B7280" },
  { name: "Red", hex: "#EF4444" },
  { name: "Orange", hex: "#F97316" },
  { name: "Amber", hex: "#F59E0B" },
  { name: "Green", hex: "#10B981" },
  { name: "Teal", hex: "#14B8A6" },
  { name: "Blue", hex: "#3B82F6" },
  { name: "Indigo", hex: "#6366F1" },
  { name: "Purple", hex: "#8B5CF6" },
  { name: "Pink", hex: "#EC4899" },
];
```

## Navigation

Add "Tracks" link to project sidebar:

```tsx
// In ProjectSidebar or similar
<NavLink href={`/projects/${projectId}/tracks`}>
  <LayersIcon /> Tracks
</NavLink>
```

## Files to Create/Modify

1. `app/projects/[id]/tracks/page.tsx` - Main tracks page
2. `app/projects/[id]/tracks/TrackList.tsx` - List component with DnD
3. `app/projects/[id]/tracks/TrackCard.tsx` - Individual track card
4. `app/projects/[id]/tracks/TrackModal.tsx` - Create/edit modal
5. `app/projects/[id]/layout.tsx` - Add tracks to sidebar nav
6. `lib/api.ts` - Add track API functions

## API Integration

```typescript
// lib/api.ts
export async function listTracks(projectId: string): Promise<Track[]> { ... }
export async function createTrack(projectId: string, data: CreateTrackInput): Promise<Track> { ... }
export async function updateTrack(projectId: string, trackId: string, data: UpdateTrackInput): Promise<Track> { ... }
export async function deleteTrack(projectId: string, trackId: string): Promise<void> { ... }
export async function reorderTracks(projectId: string, trackIds: string[]): Promise<void> { ... }
```

## Testing

1. Create a new track, verify it appears in list
2. Edit track name/color, verify changes persist
3. Reorder tracks via drag, verify sort_order updates
4. Delete track with WOs, verify WOs become orphaned (track_id = null)
5. Delete track with no WOs, verify clean deletion
