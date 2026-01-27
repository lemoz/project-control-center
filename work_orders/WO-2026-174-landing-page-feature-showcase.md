---
id: WO-2026-174
title: Landing page feature showcase
status: backlog
priority: 3
tags:
  - landing-page
  - ui
estimate_hours: 1.5
depends_on:
  - WO-2026-171
era: v2
updated_at: 2026-01-26
goal: Add a feature grid section to the landing page highlighting PCC's key capabilities with icons and descriptions.
context:
  - Landing page at app/(public)/landing/page.tsx (WO-2026-171)
  - Section should appear after hero/value proposition
  - Design system uses dark cards with subtle borders (see globals.css)
acceptance_criteria:
  - FeatureGrid component in app/(public)/landing/components/
  - 6 feature cards in responsive grid (3 cols desktop, 2 tablet, 1 mobile)
  - Each card has icon, title, and short description
  - Features to highlight: Work Order Management, Autonomous Build Loops, Live Visualization, Voice Interaction, Tech Tree Dependencies, Multi-Project Portfolio
  - SVG icons for each feature (simple, consistent style)
  - Hover state with subtle border/transform effect
  - Consistent with landing page dark theme
non_goals:
  - Animated/interactive feature demos
  - Links to documentation for each feature
  - Detailed feature comparisons
stop_conditions:
  - If icon design becomes complex, stop and use placeholder icons
---
