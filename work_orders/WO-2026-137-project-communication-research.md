---
id: WO-2026-137
title: Project Communication System Research
goal: Explore unifying escalations and messages into a broader "Project Communication" system for inter-project and project-global coordination.
context:
  - server/global_agent.ts (current escalation handling)
  - server/db.ts (escalations table)
  - WO-2026-078 (Escalation Routing System) - done
  - WO-2026-082 (Cross-Project Pollination) - done
  - Global agent is communication hub, not command-and-control
  - Projects are autonomous, "fight for" their success
  - Need two-way communication: Project ↔ Global, Project ↔ Project
acceptance_criteria:
  - Document current escalation system and its limitations
  - Define communication intents (escalation, message, request, etc.)
  - Propose unified ProjectCommunication model
  - Identify how global agent consumes/routes communications
  - Identify how project agent shifts send/receive communications
  - Consider project-to-project direct messaging
  - Assess impact on existing escalation infrastructure
  - Recommendation on extend-vs-replace for escalations table
non_goals:
  - Implementation
  - UI design
  - Detailed API specs (high-level only)
stop_conditions:
  - Keep research focused; don't over-architect
  - If current escalation system is sufficient with minor tweaks, say so
priority: 3
tags:
  - research
  - autonomous
  - global-agent
  - communication
estimate_hours: 2
status: you_review
created_at: 2026-01-22
updated_at: 2026-01-22
depends_on: []
era: v2
---
## Research Questions

1. **What are the communication intents?**
   - escalation: blocking, needs resolution to continue
   - message: informational, FYI, sharing learnings
   - request: non-blocking ask for help/resources
   - suggestion: global agent recommending action to project
   - status: project reporting progress/completion

2. **Who communicates with whom?**
   - Project → Global (current: escalations)
   - Global → Project (current: shift context injection?)
   - Project → Project (current: none?)

3. **What's the lifecycle?**
   - Escalations: pending → claimed → resolved
   - Messages: sent → read → (optional) acknowledged
   - Requests: open → accepted/declined → fulfilled

4. **How do agents consume this?**
   - Global agent: sees all communications, routes, facilitates
   - Project agent: sees communications to/from its project
   - Shift context: includes relevant communications

## Current State to Document

- Escalation table schema
- Escalation types currently supported
- How global agent processes escalations
- How project shifts create escalations
- What context gets injected into shifts

## Key Design Questions

1. Single table with `intent` field vs separate tables?
2. Resolution semantics for non-blocking intents?
3. Should projects be able to message each other directly?
4. How does this affect the global decision prompt?
5. How does this affect project shift context?

## Principles to Honor

- Projects are autonomous agents, not commanded
- Global agent facilitates, doesn't dictate
- Projects "fight for" their success, advocate to global
- Communication enables coordination, not control
