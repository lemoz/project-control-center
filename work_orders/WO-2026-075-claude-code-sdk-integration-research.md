---
id: WO-2026-075
title: Claude Code SDK Integration Research
goal: Document how to invoke Claude Code programmatically for the shift orchestrator.
context:
  - WO-2026-074 (Shift Orchestrator)
  - Need to spawn Claude Code agents from Node.js server
  - Agent needs MCP Chrome extension for full network access
acceptance_criteria:
  - Document SDK installation and setup
  - Document key API options for our use case
  - Document MCP server configuration for Chrome extension
  - Prototype basic invocation
non_goals:
  - Full implementation (that's WO-2026-074)
priority: 2
tags:
  - research
  - sdk
  - claude-code
estimate_hours: 1
status: done
created_at: 2026-01-12
updated_at: 2026-01-12
depends_on: []
era: v2
---
## Research Findings

### SDK Installation

```bash
npm install @anthropic-ai/claude-agent-sdk
```

### Basic Invocation

```typescript
import { query } from "@anthropic-ai/claude-agent-sdk";

for await (const message of query({
  prompt: "Your task here",
  options: {
    cwd: "/path/to/project",
    allowedTools: ["Read", "Edit", "Bash", "Glob", "Grep"],
    permissionMode: "bypassPermissions",
    mcpServers: {
      "chrome-extension": {
        // MCP server config for Chrome extension
      }
    }
  }
})) {
  if (message.type === "system" && message.subtype === "init") {
    console.log("Session started:", message.session_id);
  }
  if (message.type === "result") {
    console.log("Result:", message.result);
    console.log("Cost:", message.total_cost_usd);
  }
}
```

### Key Options

| Option | Purpose |
|--------|---------|
| `prompt` | The task/prompt to execute |
| `cwd` | Working directory for the agent |
| `allowedTools` | Tools to auto-approve |
| `permissionMode` | `'default'` \| `'acceptEdits'` \| `'bypassPermissions'` |
| `mcpServers` | Configure MCP servers (Chrome extension) |
| `maxTurns` | Limit agent iterations |
| `maxBudgetUsd` | Set spending limit |
| `hooks` | Add callbacks for lifecycle events |

### Permission Modes

- `default`: Ask for permission on each action
- `acceptEdits`: Auto-accept file edits
- `bypassPermissions`: Auto-accept everything (for autonomous shifts)

### MCP Server Configuration

For Chrome extension integration, need to configure MCP server:

```typescript
mcpServers: {
  "claude-in-chrome": {
    command: "path/to/mcp-server",
    args: ["--some-args"],
    env: { /* env vars */ }
  }
}
```

**Note:** Need to verify exact configuration for Chrome extension MCP server.

### Output Capture

```typescript
let result = "";
let metadata = {};

for await (const message of query({ prompt, options })) {
  if (message.type === "result") {
    result = message.result;
    metadata = {
      cost: message.total_cost_usd,
      duration: message.duration_ms,
      tokens: message.usage
    };
  }
}
```

### Shift Orchestrator Integration

```typescript
// server/shift_invoker.ts
import { query } from "@anthropic-ai/claude-agent-sdk";
import { buildShiftDecisionPrompt } from "./prompts/shift_decision.js";
import { getShiftContext } from "./shift_context.js";

export async function runShift(projectId: string, shiftId: string) {
  const context = await getShiftContext(projectId);
  const prompt = buildShiftDecisionPrompt(context);

  const results = {
    messages: [],
    finalResult: null,
    cost: 0,
  };

  for await (const message of query({
    prompt,
    options: {
      cwd: context.project.path,
      allowedTools: ["Read", "Edit", "Bash", "Glob", "Grep", "WebFetch", "WebSearch"],
      permissionMode: "bypassPermissions",
      mcpServers: {
        "claude-in-chrome": { /* config */ }
      },
      maxBudgetUsd: 10.00,  // Safety limit
    }
  })) {
    results.messages.push(message);

    if (message.type === "result") {
      results.finalResult = message.result;
      results.cost = message.total_cost_usd;
    }
  }

  return results;
}
```

## Open Questions

1. **Chrome extension MCP config**: Need to determine exact MCP server configuration
2. **Session resumption**: Should shifts be able to resume?
3. **Cost limits**: What's a reasonable per-shift budget?

## Sources

- [Agent SDK Overview](https://platform.claude.com/docs/en/agent-sdk/overview)
- [TypeScript SDK Reference](https://platform.claude.com/docs/en/agent-sdk/typescript)
- [Headless/CLI Documentation](https://code.claude.com/docs/en/headless.md)
