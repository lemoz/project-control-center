---
id: WO-2026-171
title: Public landing page foundation
status: backlog
priority: 2
tags:
  - landing-page
  - ui
  - public
estimate_hours: 3
depends_on: []
era: v2
updated_at: 2026-01-26
goal: Create a public-facing landing page for PCC with hero section, value proposition, and CTA - separate from the internal portfolio dashboard.
context:
  - Current "/" is internal portfolio dashboard (app/page.tsx)
  - No public landing page exists yet
  - Design system in app/globals.css (dark theme, cards, badges)
  - Live visualization exists at /live (LiveOrbitalCanvas)
acceptance_criteria:
  - New route at app/(public)/landing/page.tsx (route group with separate layout)
  - Landing-specific layout without app header/sidebar (app/(public)/layout.tsx)
  - Hero section with tagline and primary CTA ("See it Live" → /live)
  - Secondary CTA for email signup (anchor to #signup section)
  - "How It Works" section with 3 value cards (Define WOs → AI Builds → Ship)
  - Responsive mobile-first design
  - Dark theme consistent with existing design system
  - Meta tags for SEO (title, description, Open Graph, Twitter card)
non_goals:
  - Replacing "/" with landing page (keep portfolio at current location)
  - Email collection functionality (separate WO)
  - Live demo embed (separate WO)
  - Feature grid details (separate WO)
stop_conditions:
  - If route groups conflict with existing routes, stop and clarify structure
---
