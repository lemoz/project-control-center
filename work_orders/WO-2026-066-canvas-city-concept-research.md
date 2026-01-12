---
id: WO-2026-066
title: Canvas City Concept Research
goal: Explore and document the "canvas city" front-end concept where projects exist spatially and grow based on usage/success.
context:
  - This is the user-facing layer where PCC projects deploy and interact with users
  - Spatial metaphor for resource allocation and project growth
  - City-builder inspiration for organic growth
acceptance_criteria:
  - Research iso city (open source city builder) and similar projects
  - Document the core concept and mechanics
  - Sketch out how PCC projects would map to canvas/city elements
  - Identify technical approaches (WebGL, Canvas, isometric engines, etc.)
  - List open questions and design decisions needed
  - Produce a concept doc that can guide future implementation WOs
non_goals:
  - Actual implementation
  - Final design decisions
  - UI mockups (unless they help clarify concepts)
stop_conditions:
  - If concept doesn't hold together, document why and alternatives
priority: 3
tags:
  - research
  - frontend
  - concept
  - canvas
estimate_hours: 3
status: done
created_at: 2026-01-11
updated_at: 2026-01-12
depends_on: []
era: v2
---

## Canvas City - Full Concept

A spatial, visual frontend where AI projects exist as living entities on a shared planet. Users don't build - they watch their AI projects grow cities around themselves based on real activity.

### Zoom Hierarchy

```
SPACE → PLANET → REGION → PLOT → PROJECT
```

| Level | View | Interaction |
|-------|------|-------------|
| **Space** | Planet in bottom-right corner, stars, void | Cinematic entry point, looking out from orbit |
| **Planet** | Globe rotating, hotspots glowing with activity | Click region to dive in |
| **Region** | Top-down view, bordered plots visible | Browse, find interesting activity |
| **Plot** | Your AI nodes + auto-grown cities | Explore, click CTAs to try projects |
| **Project** | Actual project interface | Use the app (iframe/modal) |

### Plot Anatomy

```
┌──────────────────────────────────────┐
│                                      │
│   ⚡ (activity sprite)               │
│   ║                                  │
│ ┌─╨─┐                                │
│ │🔮 │ AI Node (the project)          │
│ └─┬─┘                                │
│ ┌─┴──┬───┬───┐                       │
│ │🏠  │🏠 │🏠 │ City (token burn)     │
│ └────┴───┴───┘                       │
│                                      │
│ [Generate Art] ← CTA (opens project) │
│                                      │
│ ═══════════════ connection to        │
│                 other nodes          │
└──────────────────────────────────────┘
```

| Element | What it represents |
|---------|-------------------|
| **AI Node** | The project itself - custom glyph, always visible, center of the city |
| **City growth** | Grows automatically based on token consumption (IsoCity style buildings) |
| **Activity sprite** | Floating above node when processing/active |
| **CTA bubble** | AI-designed call-to-action that opens project interface |
| **Connections** | Lines between related/dependent projects |

### Key Behaviors

**Passive Growth:**
- User does nothing - no city building gameplay
- As project burns tokens, city tiles auto-spawn around the AI node
- More successful project = denser/larger city

**Activity Visualization:**
- Node glows/pulses when processing
- Sprite emits above node when completing tasks
- Particles could flow along connection lines

**Discovery:**
- Wander the map, see other users' plots
- Click CTAs to try interesting projects
- Big thriving cities = successful AI projects (status symbol)

### Business Model Mapping

| Real Thing | Canvas Representation |
|------------|----------------------|
| Subscription tier | Plot size (square footage) |
| Token budget | Maximum city capacity |
| Token burn rate | City density/growth speed |
| Project revenue | Can buy adjacent plots, expand |
| Project health | Node glow intensity, city vitality |
| Idle/dead project | Dim node, decaying/overgrown city |

### What Makes It Cool

1. **Passive visualization** - You don't play, you watch your AI work manifest spatially
2. **Shared world** - Everyone's on the same planet, can explore others' plots
3. **Organic growth** - Cities emerge from real activity, not manual placement
4. **Discovery** - Wander the map, find interesting projects via CTAs
5. **Status symbol** - Big thriving city = successful AI project

---

## Technical Research

### IsoCity Reference Projects

**1. amilich/isometric-city** (https://github.com/amilich/isometric-city)
- **Tech:** Next.js + TypeScript + HTML5 Canvas API
- **Stars:** ~1.4k
- **Key insight:** Custom `CanvasIsometricGrid` engine with depth sorting, no game engine dependency
- **Features:** Vehicles, pedestrians, trains, economy simulation, zoning
- **Rendering:** Tile-based grid, sprite layering, real-time updates
- **Relevance:** Shows how to build performant isometric rendering in React/Next.js

**2. victorqribeiro/isocity** (https://github.com/victorqribeiro/isocity)
- **Tech:** Vanilla JS, CSS, HTML (no frameworks)
- **Key insight:** Simple placement-only, no simulation ("no budget, no goals, just build")
- **Assets:** Kenney.nl isometric sprites
- **Relevance:** Good for understanding basic isometric rendering

### Recommended Technical Approach

```
Canvas 2D + Custom Depth Sorting + Tile Grid
         (borrow from IsoCity)
                   ↓
        Same building sprites
         (Kenney assets)
                   ↓
      Custom AI Node glyphs
                   ↓
  WebSocket for real-time activity pulses
                   ↓
   Iframe/Modal for project interface
```

**Why not WebGL/Three.js?**
- Canvas 2D is simpler, performant enough for isometric
- IsoCity proves it works at scale
- Easier to iterate on

---

## Open Questions for Implementation

1. **Planet regions** - How are plots assigned? Random? Themed zones? User choice?
2. **Decay mechanics** - What happens to inactive projects? City crumbles? Weeds/overgrowth?
3. **Neighbor interaction** - Any mechanics between adjacent plots? Or purely cosmetic?
4. **Scale limits** - How many plots per region? Performance ceiling?
5. **CTA generation** - Templated by project type? Or actually AI-generated text?
6. **Project interface** - Iframe embed? Modal overlay? New tab?

---

## Research Tasks

- [x] Find and explore IsoCity source code
- [x] Survey isometric web rendering approaches
- [x] Document zoom hierarchy concept
- [x] Define plot anatomy (AI node, city growth, CTAs)
- [x] Map business model to visual elements
- [x] Identify technical approach (Canvas 2D, IsoCity-style)
- [x] List open questions for implementation phase

---

## Next Steps (Future WOs)

1. **Canvas City Prototype** - Basic rendering with zoom levels, placeholder plots
2. **AI Node Design** - Custom glyphs, activity states, CTA system
3. **City Growth Algorithm** - Token burn → tile spawning logic
4. **Real-time Activity** - WebSocket integration for live pulses
5. **Project Interface Embed** - How CTAs open actual project UIs
