---
id: WO-2026-172
title: Landing page email collection system
status: backlog
priority: 2
tags:
  - landing-page
  - api
  - database
estimate_hours: 2
depends_on:
  - WO-2026-171
era: v2
updated_at: 2026-01-26
goal: Set up email collection for early access signups on the landing page with SQLite storage and spam protection.
context:
  - Landing page foundation at app/(public)/landing/page.tsx (WO-2026-171)
  - Database at server/db.ts (SQLite via better-sqlite3)
  - API routes proxy to Express server (server/index.ts)
  - Next.js API routes at app/api/
acceptance_criteria:
  - New "subscribers" table in server/db.ts (id, email, source, created_at, confirmed_at, unsubscribed_at)
  - createSubscriber() and listSubscribers() functions in db.ts
  - POST /subscribe endpoint in server/index.ts (accepts email, returns success/already_exists)
  - GET /subscribers endpoint for admin export
  - Next.js API route at app/api/subscribe/route.ts (proxies to Express)
  - EmailSignup React component with form, loading state, success state, error handling
  - Honeypot field for basic spam protection
  - Email validation (must contain @)
  - Handles re-subscription if previously unsubscribed
non_goals:
  - Email verification/confirmation flow
  - Integration with external services (Mailchimp, Resend, etc.)
  - Admin UI for managing subscribers
  - CAPTCHA (honeypot is sufficient for now)
stop_conditions:
  - If database migration is complex, stop and propose migration strategy
---
