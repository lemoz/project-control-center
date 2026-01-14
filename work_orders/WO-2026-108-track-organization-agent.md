---
id: WO-2026-108
title: Track Organization Agent
goal: Agent-driven emergent organization of WOs into tracks for tech tree visualization
context:
  - Tracks are coherent streams of related work (Runner, Economy, Canvas, etc.)
  - Currently tracks are inferred manually from tags/deps - should be first-class
  - Agent analyzes WOs and proposes track organization
  - Human reviews and approves
acceptance_criteria:
  - tracks table (id, project_id, name, goal, status, parent_track_id)
  - wo_tracks junction table (wo_id, track_id) - many-to-many
  - Context builder that summarizes all WOs for agent consumption
  - Open-ended prompt that lets agent determine natural groupings
  - Hard limit of 8 top-level tracks (sub-tracks for finer granularity)
  - Incremental mode: assign new WOs to existing tracks or propose new
  - Reorg mode: full review, suggest merges/splits/new tracks
  - Review UI for track suggestions before persisting
  - Track filter/view in WO list and tech tree
non_goals:
  - Cross-project global tracks (per-project only for v1)
  - ML embeddings (LLM does the clustering)
  - Specifying track completion behavior (builder figures it out)
triggers:
  - Auto-run after N new WOs created (threshold TBD, maybe 10-15)
  - Manual trigger available
notes:
  - "FRONTEND CONSTRAINT: 8 track limit is based on tech tree lane display capacity. If tech tree visualization changes to support more lanes or uses filter mode instead of lanes, this limit can be increased. See tech tree viz code when updating."
  - "ARCHITECTURE: Global agent reasons about tracks, not WOs. Project agent reasons about WOs. Global says 'prioritize Runner track', project agent decides which WO that means."
priority: 3
tags:
  - meta
  - organization
  - agent
  - tech-tree
estimate_hours: 4
status: backlog
created_at: 2026-01-14
updated_at: 2026-01-14
depends_on: []
era: v2
---
## Design Notes

### Track Model

```typescript
interface Track {
  id: string;
  project_id: string;
  name: string;           // "Runner Infrastructure"
  goal: string;           // "Safe, isolated code execution"
  status: 'active' | 'paused' | 'completed';
  parent_track_id?: string;  // For sub-tracks
  created_at: string;
}

interface WOTrack {
  wo_id: string;
  track_id: string;
}
```

### Agent Prompt Approach

```markdown
Organize these work orders into tracks.

A track is a coherent stream of related work. Constraints:
- Maximum 8 top-level tracks (use sub-tracks for finer granularity)
- WOs can belong to multiple tracks
- Use your judgment on what groupings are natural

Existing tracks (if any): {{existing_tracks}}
Work orders: {{wos}}

Output JSON with track definitions and WO assignments.
```

### Modes

1. **Initial organization**: No tracks exist, agent proposes full structure
2. **Incremental**: New WOs added, agent assigns to existing tracks or proposes new
3. **Reorg**: Periodic review, agent suggests merges/splits/promotions

### UI Flow

1. User triggers "Organize tracks" (manual for v1)
2. Agent runs, produces suggestions
3. Review screen shows proposed tracks + assignments
4. User approves/edits
5. Persisted to DB
6. Tech tree updates to show track lanes

### Agent Hierarchy

```
Global Agent (track-level reasoning)
├── Sees: track progress across all projects
├── Thinks: "Economy track 80% done, Runner track blocked"
├── Decides: budget allocation, cross-project priorities
└── Does NOT touch individual WOs

Project Agent (WO-level reasoning)
├── Sees: WOs within this project, track context
├── Thinks: "WO-107 unblocks other work, run next"
├── Decides: WO ordering, spawns new WOs
├── Reports: track progress up to global agent
└── Owns: WO generation and execution
```

Global agent directive: "Prioritize Runner track"
Project agent interprets: "WO-107 is the next Runner WO, run it"
