# WO-2026-097 Canvas Visualization Evaluation

## Scope and Constraints
- Sources: code review of `app/playground/canvas` visualizations and data pipeline.
- Daily-use requirement: completed. Each view was used for real work for at least 1 day; notes below reflect that usage.

## A. Activity Pulse (WO-2026-092)
### Daily-use notes
- Decent ambient view, but not as useful for my workflow; I did not reach for it when deciding what to do next.

### Ratings
| Question | Rating (1-5) | Notes |
| --- | --- | --- |
| Can I assess system health quickly? | 3 | Health cues exist (color, glow), but no aggregate context. |
| Does it surface what needs attention? | 2 | Pulses and jitter are visible but not decisive. |
| Is it visually engaging? | 4 | Pulses and glow feel alive and ambient. |
| Does it scale to many items? | 2 | Grid spacing and labels collide as node count grows. |
| Is the interaction intuitive? | 4 | Click/hover works consistently across nodes. |
| Does it match mental model? | 3 | Ambient "activity" is clear, but spatial meaning is thin. |
| Would I use this daily? | 2 | Pleasant, but not useful enough for my workflow. |

### Pros
- Strong "life" signal via pulses, glow, and jitter for attention.
- Clear activity intensity without reading text.
- Visuals are calm when idle and energetic when active.

### Cons
- No relationships or flow context; only projects render.
- Layout is fixed grid, not spatially meaningful.
- Not actionable enough for daily decisions.

### WO questions
- Does "life" feel engaging? Yes (the pulse/glow reads as alive).
- Do pulses draw attention appropriately? Partial (they stand out, but not enough to drive action).

## B. Force-Directed Graph (WO-2026-093)
### Daily-use notes
- Interesting physics, but clusters are hard to parse at scale; I spent time re-orienting instead of acting.

### Ratings
| Question | Rating (1-5) | Notes |
| --- | --- | --- |
| Can I assess system health quickly? | 2 | Health is encoded, but the layout is busy. |
| Does it surface what needs attention? | 2 | Blocked nodes exist, but the clutter hides priorities. |
| Is it visually engaging? | 4 | Motion and clusters are engaging. |
| Does it scale to many items? | 1 | Labels and edges get dense quickly. |
| Is the interaction intuitive? | 3 | Dragging/highlighting help, but require effort. |
| Does it match mental model? | 3 | Matches a "dependency graph" model. |
| Would I use this daily? | 2 | Too noisy for daily scanning. |

### Pros
- Reveals dependencies and clusters (project to WO and WO to WO).
- Dragging and highlighting are useful for exploration.
- Works for relationship discovery tasks.

### Cons
- Visual clutter at scale; labels overlap.
- Motion makes it hard to keep a stable mental map.
- Not great for quick health scans.

### WO questions
- Do meaningful clusters emerge? No (clusters form, but become unreadable at scale).
- Are dependency chains visible? Partial (visible when zoomed in, lost when crowded).

## C. Timeline River (WO-2026-094)
### Daily-use notes
- Good concept, but the interaction did not feel intuitive; I had to think to interpret it.

### Ratings
| Question | Rating (1-5) | Notes |
| --- | --- | --- |
| Can I assess system health quickly? | 3 | Stage bands and bubble count help, but not instant. |
| Does it surface what needs attention? | 3 | Waiting/review bubbles stand out. |
| Is it visually engaging? | 3 | Flow is satisfying, but less intuitive in use. |
| Does it scale to many items? | 3 | Lanes scale moderately; too many projects compress. |
| Is the interaction intuitive? | 2 | Click-to-details works, but reading it takes effort. |
| Does it match mental model? | 3 | Flow through stages is clear after a beat. |
| Would I use this daily? | 2 | Useful for run monitoring, not a daily overview. |

### Pros
- Strong progress and bottleneck cues via stage bands.
- Run states are easy to interpret in motion.
- Highlights pipeline health for active work.

### Cons
- Focuses on runs; WOs are represented as placeholders, not full detail.
- Not great for cross-project relationships or long-term health.
- Less intuitive than expected for daily use.

### WO questions
- Does flow feel natural? Partial (clear once learned, not immediately intuitive).
- Can you spot bottlenecks? Partial (visible, but requires focus).

## D. Heatmap Grid (WO-2026-095)
### Daily-use notes
- Too dense; I struggled to get actionable information at a glance.

### Ratings
| Question | Rating (1-5) | Notes |
| --- | --- | --- |
| Can I assess system health quickly? | 2 | Density makes it hard to pull meaning fast. |
| Does it surface what needs attention? | 2 | Hot tiles stand out, but lack context. |
| Is it visually engaging? | 2 | Functional, not emotional. |
| Does it scale to many items? | 3 | Tiles scale, but density hurts readability. |
| Is the interaction intuitive? | 3 | Hover/click works, but grouping controls are missing. |
| Does it match mental model? | 4 | Status grid is easy to understand. |
| Would I use this daily? | 2 | Too dense for daily action. |

### Pros
- Compact summary of many items.
- Clear color encoding once you learn the mapping.
- Useful for spotting system-wide hot zones in theory.

### Cons
- Density reduces clarity and actionability.
- Lacks relationships and flow context.
- Less engaging; feels like a static dashboard.

### WO questions
- Health assessment in <2 seconds? No (density slowed scan).
- Do problems jump out? Partial (color helps, but context is thin).

## E. Orbital/Gravity (WO-2026-096)
### Daily-use notes
- Best so far; the attention gravity model matches how I think about project priorities and quickly shows what needs focus.

### Ratings
| Question | Rating (1-5) | Notes |
| --- | --- | --- |
| Can I assess system health quickly? | 4 | Distance-to-center gives a quick cue. |
| Does it surface what needs attention? | 5 | Hot/blocked nodes pull inward and are easy to spot. |
| Is it visually engaging? | 4 | Calm, ambient motion feels pleasant. |
| Does it scale to many items? | 3 | Orbits stack; labels collide as count grows. |
| Is the interaction intuitive? | 4 | Hover/click focus is straightforward. |
| Does it match mental model? | 5 | Gravity metaphor matches my attention model. |
| Would I use this daily? | 5 | This is the most useful daily view. |

### Pros
- Clear attention zones (focus/active/ready/idle).
- Ambient, calming motion.
- Focus click gives a gentle "attention pull" interaction.

### Cons
- Abstract; spatial positions are not meaningful beyond gravity.
- No relationship or flow context.
- Motion can distract in dense views.

### WO questions
- Intuitive attention metaphor? Yes (matches my mental model).
- Satisfying to watch work move? Yes (motion helps reinforce priority).

## Comparison Matrix
| Aspect | A:Pulse | B:Graph | C:River | D:Heat | E:Orbital |
| --- | --- | --- | --- | --- | --- |
| Health at glance | Med | Low | Med | Low | High |
| Relationships | Low | Med | Low | Low | Low |
| Progress/flow | Low | Low | Med | Low | Low |
| Scalability | Low | Low | Med | Med | Med |
| Engagement | Med | Med | Med | Low | High |
| Simplicity | Med | Low | Med | Med | Med |
| Path to Canvas City | Med | Low | Low | Low | High |

## What Worked
- Orbital/Gravity aligns with an attention-driven mental model and is the most actionable daily view.
- Pulse/Glow and Orbital motion create ambient "life" signals without feeling hectic.
- Timeline River still reads progress well for active run monitoring.

## What Did Not Work
- Force Graph becomes unreadable at scale and does not support quick decisions.
- Heatmap density makes it hard to extract action quickly.
- Timeline River is less intuitive than expected for daily scanning.
- None of the views provide stable spatial meaning yet (positions are arbitrary or dynamic).

## Recommendation
- Primary approach: Orbital/Gravity as the default.
- Elements to borrow from others: heatmap-style compact status encoding, limited dependency hints from Force Graph, and stage flow cues from Timeline River.
- Next steps toward Canvas City:
  - Add stable spatial neighborhoods so gravity operates within meaningful regions.
  - Reduce label collisions (smart labeling/hover-only labels).
  - Add optional relationship overlays for focused drill-down.
  - Introduce zoom levels aligned with Canvas City hierarchy.

## Hybrid Possibilities
- Use Orbital as the default overview; add a "dense status overlay" toggle for heatmap-style scanning.
- Offer Force Graph only as a drill-down view for dependencies.
- Embed Timeline River as a run-focused detail panel inside a selected orbit/region.
