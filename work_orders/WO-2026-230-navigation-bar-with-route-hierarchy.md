---
id: WO-2026-230
title: Navigation Bar with Route Hierarchy
status: done
priority: 1
tags:
  - ui
  - navigation
  - layout
estimate_hours: 3
created_at: 2026-01-28
updated_at: 2026-01-28
era: v2
---
## Goal

Persistent navigation bar across all pages with global links and contextual breadcrumbs for project-level pages. Replaces the plain `<a>` links currently in `layout.tsx`.

## Context

- Current nav is four plain links in `app/layout.tsx:41-46` (Portfolio, Observability, Chat, Settings)
- No active state highlighting, no project-level context
- Routes: `/` (home), `/observability`, `/chat`, `/settings`, `/projects/{id}/*`, `/live`
- App is a PWA — nav should work on mobile (bottom bar or collapsible)

## Acceptance Criteria

- [ ] Global nav links: Home, Observability, Chat, Settings — always visible
- [ ] Active state highlighting for current route
- [ ] When inside `/projects/{id}/*`, breadcrumb shows project name with sub-links (Dashboard, Live, Chat, Tracks)
- [ ] Mobile-friendly layout (bottom bar or hamburger)
- [ ] ChatAttentionBell remains accessible in nav area
- [ ] Nav does not obscure canvas content on `/` or `/live` routes
