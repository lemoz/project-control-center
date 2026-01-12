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
status: backlog
created_at: 2026-01-11
updated_at: 2026-01-11
depends_on: []
era: v2
---

## Core Concept

A spatial canvas where PCC projects come to life and interact with users.

### The Metaphor

- **Global canvas** = shared space where all agents/projects exist
- **Your square** = your monthly token budget, visualized as real estate
- **Projects** = buildings/zones that occupy space proportional to token usage
- **Growth** = successful projects (make money) can buy adjacent squares and expand
- **City** = organic growth pattern, like a city builder

### How It Works

```
User buys subscription → Gets a square on the global canvas
                                    ↓
              PCC projects deploy to your square
                                    ↓
         Projects consume tokens → expand spatially
                                    ↓
         Project makes money → can buy adjacent square
                                    ↓
              Organic city-like growth over time
```

### What Projects Get

Each project's space is where it can:
- Present UI/interface to users
- Accept uploads, input, feedback
- Iterate based on real user interaction
- Grow as it succeeds

### Visual Language Ideas

- Active projects pulse/glow
- Blocked/stuck projects look distressed (red, dimmed)
- Token burn rate = visual size/activity
- Zoom in = project's internal UI
- Zoom out = portfolio view → global view

### Inspiration to Research

1. **IsoCity by amilich** (https://github.com/amilich/isometric-city)
   - Full-featured: Next.js + TypeScript + Canvas API
   - Has vehicles, pedestrians, trains, economy simulation
   - Good reference for rendering architecture (depth sorting, layers)
   - Live demo: iso-city.com

2. **IsoCity by victorqribeiro** (https://github.com/victorqribeiro/isocity)
   - Simpler pure JavaScript implementation
   - No simulation, just placement
   - Good for understanding isometric basics

3. **Pogicity Demo** (https://github.com/twofactor/pogicity-demo)
   - MIT licensed foundation for isometric games
   - Could be a starting point

4. Reddit Place - shared canvas, user-owned pixels
5. SimCity/city builders - organic growth, zoning

### Technical Questions

- Rendering approach: WebGL? Canvas 2D? CSS? Three.js?
- Isometric vs top-down vs 3D?
- How do projects actually render into their space? iframe? Web components? Custom SDK?
- Real-time updates (WebSocket) for activity visualization?
- Performance at scale (thousands of projects on canvas)?

### Business Model Mapping

- Subscription tier = canvas size (square footage)
- Token usage = how much of your space is "active"
- Revenue from projects = ability to expand (buy adjacent plots)
- Could have "prime real estate" near high-traffic areas?

### Open Questions

1. What's the minimum viable "building"? A card? A full app frame?
2. How do neighboring projects interact (if at all)?
3. Is the global canvas one shared world, or sharded?
4. How does discovery work? Search? Wandering? Recommendations?
5. What does a "dead" or abandoned project look like?

## Research Tasks

- [ ] Find and explore iso city source code
- [ ] Survey isometric web rendering libraries
- [ ] Look at how other "spatial web" concepts have been implemented
- [ ] Sketch rough interaction model
- [ ] Write up concept doc with recommendations
