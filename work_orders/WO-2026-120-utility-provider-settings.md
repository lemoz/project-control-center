---
id: WO-2026-120
title: Utility Provider Settings
goal: Make WO generation and handoff generation use configurable provider (codex/claude_cli) via settings, matching the pattern used by builder/reviewer.
context:
  - WO-2026-081 (WO Generation) uses hardcoded Claude CLI
  - WO-2026-076 (Auto Handoff) uses hardcoded Claude CLI
  - Builder/reviewer use configurable provider via settings (codex by default)
  - Inconsistent - utility tasks should follow same pattern as builder/reviewer
  - Should default to codex to match system preferences
acceptance_criteria:
  - Add `utility` section to settings with provider, model, and cliPath fields
  - Settings UI shows utility provider selector (codex/claude_cli) in settings panel
  - Update wo_generation.ts to use provider from settings (support both codex and claude_cli)
  - Update handoff_generator.ts to use provider from settings
  - Support env override CONTROL_CENTER_UTILITY_PROVIDER
  - Default provider is codex (matching builder/reviewer defaults)
  - Existing API endpoints continue working with configurable provider
non_goals:
  - Changing the prompt structure
  - Adding new providers beyond codex/claude_cli
stop_conditions:
  - If codex doesn't support the prompt format needed, document limitations
priority: 2
tags:
  - settings
  - configuration
  - providers
estimate_hours: 3
status: you_review
created_at: 2026-01-20
updated_at: 2026-01-21
depends_on: []
era: v2
---
## Problem

WO generation and handoff generation use hardcoded Claude CLI while the rest of the system (builder, reviewer, chat) uses configurable providers with codex as default. This is inconsistent and causes issues when Claude CLI isn't available in the server environment.

## Current State

```typescript
// server/wo_generation.ts:16
const CLAUDE_WO_MODEL = "claude-3-5-sonnet-20241022";
// Uses: execFile("claude", ["-p", prompt, "--model", ...])

// server/handoff_generator.ts:18
const CLAUDE_HANDOFF_MODEL = "claude-3-5-sonnet-20241022";
// Uses: execFile("claude", ["-p", prompt, "--model", ...])
```

Meanwhile builder/reviewer:
```typescript
// Uses settings.builder.provider (default: "codex")
// Calls: codex exec -p prompt --model ...
```

## Proposed Settings Structure

Follow the existing builder/reviewer pattern:

```typescript
// server/settings.ts
export type UtilitySettings = {
  provider: "codex" | "claude_cli";
  model: string;
  cliPath: string;
};

function utilityDefaults(): UtilitySettings {
  return {
    provider: "codex",  // Match system default
    model: "",          // Use provider default
    cliPath: "",        // Use PATH
  };
}
```

## Environment Override

```bash
CONTROL_CENTER_UTILITY_PROVIDER=codex
CONTROL_CENTER_UTILITY_MODEL=o3
```

## Implementation

1. **server/settings.ts** - Add UtilitySettings type and functions
2. **server/wo_generation.ts** - Refactor to use provider abstraction
   - If codex: use `codex exec -p prompt`
   - If claude_cli: use `claude -p prompt`
3. **server/handoff_generator.ts** - Same refactor
4. **server/index.ts** - Add GET/PATCH /settings/utility endpoints
5. **app/components/SettingsPanel.tsx** - Add utility provider selector

## API Endpoints

```
GET  /settings/utility
PATCH /settings/utility
```

Response:
```json
{
  "saved": { "provider": "codex", "model": "", "cliPath": "" },
  "effective": { "provider": "codex", "model": "", "cliPath": "codex" },
  "env_overrides": {}
}
```

## UI

Add section to Settings panel:

```
Utility Tasks (WO Generation, Handoffs)
├── Provider: [codex ▼] / [claude_cli]
├── Model: [________] (optional, uses provider default)
└── CLI Path: [________] (optional, uses PATH)
```
