---
id: WO-2026-037
title: Local cost tracking with cloud CTA
goal: Track basic token and API costs locally with CTA to PCC Cloud for detailed analytics and VM cost tracking.
context:
  - Local PCC can track token usage from runs
  - Detailed analytics, VM costs, and billing → pcc-cloud
  - Show basic costs locally, upsell to cloud for full picture
  - Freemium model - local is useful, cloud adds value
acceptance_criteria:
  - Track token usage per run (input/output tokens)
  - Store in local SQLite (cost_records table)
  - Display basic cost summary in project dashboard
  - Show estimated cost per run (using configurable rates)
  - CTA component "Get detailed cost analytics in PCC Cloud"
  - CTA links to cloud signup/pricing page
  - Export cost data as CSV for manual analysis
non_goals:
  - VM runtime tracking (cloud feature)
  - Billing/invoicing (cloud feature)
  - Budget alerts (cloud feature)
  - Historical trends/charts (cloud feature)
stop_conditions:
  - If token data unavailable from provider, show "Cost tracking unavailable" with cloud CTA
priority: 3
tags:
  - cost
  - local
  - cta
  - freemium
estimate_hours: 3
status: backlog
created_at: 2026-01-08
updated_at: 2026-01-28
depends_on:
  - WO-2025-004
era: v2
---
## CTA Design

```tsx
<CloudFeatureCTA
  feature="cost-analytics"
  title="Want detailed cost analytics?"
  description="Track VM costs, set budgets, get alerts, and see trends over time."
  ctaText="Upgrade to PCC Cloud"
/>
```

## Local vs Cloud Features

| Feature | Local | Cloud |
|---------|-------|-------|
| Token usage per run | ✅ | ✅ |
| Estimated costs | ✅ | ✅ |
| VM runtime costs | ❌ | ✅ |
| Budget limits | ❌ | ✅ |
| Alerts | ❌ | ✅ |
| Historical trends | ❌ | ✅ |
| Team cost allocation | ❌ | ✅ |
