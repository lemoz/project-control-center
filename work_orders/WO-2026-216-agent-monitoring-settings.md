---
id: WO-2026-216
title: Agent monitoring settings and whitelist
status: backlog
priority: 1
tags:
  - monitoring
  - settings
  - security
  - whitelist
estimate_hours: 3
depends_on:
  - WO-2026-215
era: v2
updated_at: 2026-01-27
goal: Add configurable settings for per-agent-type monitoring and manage the network whitelist for builders.
context:
  - Settings pattern exists in server/settings.ts and app/settings/
  - Stream monitor service (WO-2026-215) needs configuration
  - Different agent types need different settings (builder, reviewer, shift, global)
  - Network whitelist derived from historical session analysis
  - Whitelist includes docs sites, npm registry, GitHub, reference sites
acceptance_criteria:
  - New agent_monitoring_settings table with columns for each agent type
  - Per-agent settings include networkAccess (sandboxed|whitelist|full), monitorEnabled, autoKillOnThreat
  - Builder default networkAccess is sandboxed, can be set to whitelist
  - Reviewer default is sandboxed (no network option)
  - Shift agent and global agent default to full network access
  - New network_whitelist table with domain entries and enabled flag
  - Pre-populated whitelist includes nextjs.org, react.dev, developer.mozilla.org, docs.anthropic.com, registry.npmjs.org, github.com, stackoverflow.com, etc.
  - API endpoints GET/PATCH /settings/agent-monitoring
  - API endpoints GET/POST/DELETE /settings/network-whitelist
  - Settings UI section for Agent Monitoring with per-agent toggles
  - Settings UI section for Network Whitelist with add/remove/toggle per domain
  - getMonitoringSettings(agentType) helper for runner to check config
non_goals:
  - Implementing the actual network restriction (separate WO)
  - Pattern configuration UI (patterns are code-defined for now)
stop_conditions:
  - If settings schema becomes too complex, simplify to just builder whitelist mode toggle
---
## Initial Whitelist Domains

Based on historical session analysis:

### Documentation (high priority)
- nextjs.org
- react.dev
- nodejs.org
- developer.mozilla.org
- typescriptlang.org
- eslint.org
- jestjs.io
- playwright.dev
- tailwindcss.com
- code.claude.com

### API Documentation
- docs.anthropic.com
- platform.openai.com
- ai.google.dev
- elevenlabs.io
- docs.stripe.com
- fly.io

### Package Registries
- registry.npmjs.org
- www.npmjs.com
- pypi.org

### Code Reference
- github.com
- raw.githubusercontent.com
- stackoverflow.com
- en.wikipedia.org

## Settings Schema

```typescript
interface AgentMonitoringSettings {
  builder: {
    networkAccess: 'sandboxed' | 'whitelist';
    monitorEnabled: boolean;
    autoKillOnThreat: boolean;
  };
  reviewer: {
    networkAccess: 'sandboxed';
    monitorEnabled: boolean;
    autoKillOnThreat: boolean;
  };
  shift_agent: {
    networkAccess: 'full';
    monitorEnabled: boolean;
    autoKillOnThreat: boolean;
  };
  global_agent: {
    networkAccess: 'full';
    monitorEnabled: boolean;
    autoKillOnThreat: boolean;
  };
}
```
