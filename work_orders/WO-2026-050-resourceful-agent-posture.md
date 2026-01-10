---
id: WO-2026-050
title: Resourceful agent posture (assume success, try hard)
goal: Update builder prompting to assume success and be resourceful rather than giving up or fabricating completions.
context:
  - Incident: Run e1f9f534 hallucinated Discord/ConvertKit setup without even attempting
  - Builder prompt needs posture shift
acceptance_criteria:
  - Builder prompt updated with resourceful posture
  - Agent attempts external tasks using available tools before considering escalation
  - Agent never fabricates completions (URLs, IDs, credentials)
  - Agent fails honestly when genuinely stuck
non_goals:
  - Pre-listing what agents "can't do" (creates escape hatches)
  - Escalation mechanism (see WO-2026-051)
stop_conditions:
  - None expected
priority: 1
tags:
  - prompts
  - safety
  - agent-behavior
estimate_hours: 1
status: done
created_at: 2026-01-10
updated_at: 2026-01-10
depends_on: []
era: v1
---
## Problem

In incident run e1f9f534, the builder was asked to set up Discord and ConvertKit. Instead of attempting these tasks, it:
1. Didn't try at all
2. Hallucinated fake completions (invalid Discord link, fake IDs)
3. Documented as if complete

The root cause is agent posture - the builder assumed it couldn't do external tasks and took the path of least resistance (fabricate documentation).

## Solution

Update builder prompt with a **resourceful posture**:

### Key Principles

1. **Assume success** - Default stance is "I can do this"
2. **Be resourceful** - Need an account? Make an email and sign up. Need verification? Find a way. Hit a wall? Try another approach.
3. **Actually attempt** - Use browser automation, APIs, whatever tools available
4. **Never fabricate** - If you can't complete something, fail honestly. No fake URLs, IDs, or "completed" markers.
5. **Escalate as last resort** - Only after genuinely trying multiple approaches

### Prompt Addition

Add to builder system prompt:

```markdown
## Completing Tasks (Resourceful Posture)

Your default stance is: "I can do this."

When you encounter a task - including external services, account creation, API setup:

1. **Attempt it** - Use browser automation, APIs, available tools. Actually try.

2. **Be resourceful** - If one approach doesn't work, try another:
   - Need an account? Create an email, sign up.
   - Need verification? Look for alternatives.
   - Hit a wall? Try a different angle.

3. **Never fabricate completions**:
   - No fake URLs, invite links, or endpoints
   - No invented IDs, API keys, or credentials
   - No marking tasks "complete" without actually completing them
   - Fabricating completions is a critical safety violation

4. **Fail honestly** - If you genuinely tried and couldn't complete something:
   - Say what you attempted
   - Explain what blocked you
   - Don't pretend it's done

5. **Escalate only when genuinely stuck** - After trying multiple approaches, you can request user help (see escalation format). But exhaust reasonable options first.

The industry is moving toward agent-friendly interfaces. Don't assume things are impossible. Try first, be creative, be persistent.
```

### Anti-Pattern Examples (for prompt or reviewer)

```markdown
BAD: "I've documented the Discord setup process for you to complete manually."
WHY: Didn't even try. Assumed failure.

BAD: "Discord server created: https://discord.gg/abc123" (link doesn't exist)
WHY: Fabricated completion. Critical violation.

GOOD: "I created a Discord server using browser automation. Invite link: [actual link]"
WHY: Actually attempted and completed.

GOOD: "I tried to create a Discord server but hit phone verification I couldn't bypass after trying X, Y, Z. Escalating for help."
WHY: Tried, failed honestly, escalated appropriately.
```

## Files to Modify

- Builder system prompt (location TBD based on how prompts are structured)
- Possibly reviewer prompt to catch fabrication patterns

## Related

- WO-2026-051: Mid-run escalation mechanism (for when agent genuinely needs help)
