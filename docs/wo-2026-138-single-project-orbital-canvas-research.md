# WO-2026-138 Single-Project Orbital Canvas Research

**Status: Research Complete**

## Current OrbitalGravityViz data model + assumptions

**Input data**
- Uses `VisualizationData.nodes` as `ProjectNode[]` only.
- Ignores `VisualizationData.workOrderNodes`.
- Assumes `node.type === "project"` for click/hover focus.

**ProjectNode fields used**
- `consumptionRate` -> node size (log-scaled radius).
- `activityLevel` (0-1) + `isActive` + `activePhase` -> "heat" target.
- `status` ("active" | "blocked" | "parked") + `needsHuman` -> heat boost + palette.
- `escalationCount` -> badge with count.
- `label` -> text label under node.

**Motion + layout**
- Rings/zones are fixed (focus/active/ready/idle) scaled to canvas size.
- Heat pulls node radius inward; cold/parked drifts outward to archive ring.
- Orbit speed increases as radius shrinks; start angle and radial jitter are deterministic per id.
- Hover/focus only works for project nodes; hover boosts size only, while focus blends radius inward, increases size, and dampens orbit speed.

**Implicit assumptions**
- Nodes are few (projects), so labels are always shown.
- Status space is limited (active/blocked/parked).
- Heat is continuous and meaningful from `activityLevel` even without direct run data.

## Proposed WO-as-node mapping

**Heat / gravity (radial pull)**
- Base heat from WO `status`:
  - building/ai_review/you_review: 0.85-1.0
  - ready: 0.55-0.7
  - blocked: 0.7-0.8 (attention pull)
  - backlog: 0.2-0.35
  - done/parked: 0.05-0.2 (drift outward)
- Boost with `activityLevel` (already computed in `useProjectsVisualization`) and recency.
- If active run exists or waiting_for_input, clamp to high heat (>= 0.8).

**Size (node radius)**
- Prefer `estimate_hours` if available; fall back to `priority`.
- Example: `size = clamp(10 + sqrt(estimate_hours) * 4, 10, 28)`.
- If no estimate, `size = clamp(10 + (6 - priority) * 3, 10, 26)`.

**Color / glow**
- Color by track when track exists; status controls glow or outline.
- If no track, use status palette (building/blocked/ready/backlog/done).
- Glow for active run or escalation; badge count for escalations (reuse project badge).

**Label**
- Use short WO label (`WO-2026-138` -> `138`) or title prefix.
- Default to hidden labels at high density; show on hover/focus.

## Density handling (100+ WOs)

**Level-of-detail rules**
- Hide labels unless node is hovered/focused or heat >= 0.7.
- Reduce node radius and orbit speed for low-heat backlog/done.
- Cap visible nodes for backlog/done (sample by heat + recency).

**Clustering**
- Cluster by track or status when node count > threshold (e.g., 80).
- Render clusters as larger "track hubs" with sub-orbits for top N hot WOs.

**Filtering**
- Default filters for landing page: active + ready + blocked.
- Allow toggles to reveal backlog/done or expand to all.

## Filtering / grouping strategies

**By status**
- Radial zones per status group (inner = in-progress, mid = ready, outer = backlog, archive = done).

**By track**
- Track clusters (hub per track) with WOs orbiting within.
- Track determines color; status determines radius within the track hub.

**By priority or era**
- Priority as radial bias (higher priority pulled inward within status band).
- Era as color or outer band for long-term vs current work.

## Visual hierarchy options

**Status rings + track color (hybrid)**
- Keep current zone rings for status.
- Track only controls hue; status controls radial distance and glow.

**Track hubs + status sub-orbits**
- Each track has a hub orbiting center (heat from aggregate activity).
- WOs orbit their hub; status controls sub-orbit radius.

**Status-only rings (strict)**
- Pure radial mapping by status with no track encoding.
- Clean and obvious but loses track context.

## Data source changes needed

**Current**
- `useProjectsVisualization` builds `VisualizationData.nodes` from `/api/repos`, `/api/global/context`, `/api/repos/:id/runs`, `/api/projects/:id/shift-context`, and `/api/projects/:id/costs?period=day`.
- Shift context supplies active run counts + activity timestamps; costs (token totals) drive `consumptionRate` when present.
- WOs are already loaded via `/api/repos/:id/work-orders`, but only used by other visualizations.

**Needed for WO view**
- Use `VisualizationData.workOrderNodes` or extend OrbitalGravityViz to read WO nodes.
- Add/ensure fields on WO nodes:
  - `estimate_hours` (if available)
  - `track` (if track system present)
  - `active run status` (building/testing/ai_review/waiting_for_input)
  - `escalationCount` (if any WO-level escalations exist)
- For landing page (single project):
  - Use `/api/repos/:id/work-orders` + `/api/repos/:id/runs`
  - Or extend `/api/projects/:id/shift-context` to include detailed WO data

## Alternative approaches with tradeoffs

**A) Direct adaptation**
- Replace project nodes with WO nodes in the existing orbital model.
- Pros: fastest, reuses current physics and zones.
- Cons: label clutter and orbit chaos at 100+ nodes.

**B) Track clusters**
- Render a hub per track; WOs orbit within their track.
- Pros: clearer grouping, manageable density.
- Cons: less visibility into individual WOs unless zoomed or filtered.

**C) Status rings (strict)**
- Place WOs on rings by status only; minimal grouping.
- Pros: clear status at a glance, easy mental model.
- Cons: track context lost; busy when backlog is large.

**D) Filtered view**
- Show only active + ready + blocked by default; toggle to reveal backlog/done.
- Pros: clean landing-page view, highlights urgency.
- Cons: hides total scope and long-term work.
