---
id: WO-2026-158
title: Chief of Staff Narration System
goal: Evolve the ambient narration from podcast commentary to an executive briefing style, with richer context from projects, chats, and system state.
context:
  - WO-2026-154 implemented podcast-style LLM narration (done)
  - Current system only sees active runs and recent events
  - Narration feels repetitive when runs stay in same phase
  - Need broader context to provide relevant, non-repetitive updates
  - Chief of staff mental model - knows everything, reports what matters
acceptance_criteria:
  - Change persona from "podcast host" to "chief of staff"
  - Expand context passed to LLM:
      - All active projects with status summary
      - Recent chat threads and decisions
      - Recently completed WOs (last 24h)
      - Pending escalations awaiting response
      - What changed since last narration
  - Track "what's been reported" to avoid semantic repetition
  - Prioritize updates by relevance (escalations > completions > progress)
  - Connect current activity to recent decisions/conversations
  - Only report what's new or changed
non_goals:
  - Two-way conversation (that's the voice agent)
  - Detailed code-level updates
  - Replacing the voice agent functionality
stop_conditions:
  - Don't overload with context - keep prompt focused
  - If LLM calls get too slow, trim context intelligently
priority: 2
tags:
  - narration
  - landing-page
  - llm
  - ux
estimate_hours: 4
status: done
created_at: 2026-01-25
updated_at: 2026-01-26
depends_on:
  - WO-2026-154
era: v2
---
## Persona Shift

**Before (Podcast Host):**
> "Two runs are in motion: one is mid-build untangling a mobile click-interception bug..."

**After (Chief of Staff):**
> "Quick update: the mobile fix is on iteration 3 - tests keep failing on the same star button issue. Meanwhile, the ElevenLabs integration needs your input on the npm registry access. You discussed deprioritizing auth work yesterday, so I'm holding off on those WOs."

## Expanded Context Structure

```typescript
interface ChiefOfStaffContext {
  // What's actively running
  activeRuns: RunContext[];
  
  // Broader project awareness
  activeProjects: ProjectSummary[];  // All non-parked projects
  
  // Recent history
  recentCompletions: CompletedWO[];  // Last 24h
  recentDecisions: ChatDecision[];   // From chat threads
  
  // Needs attention
  pendingEscalations: Escalation[];
  blockedWOs: BlockedWO[];
  
  // Change tracking
  changesSinceLastNarration: Change[];
  lastNarrationAt: string;
  
  // Anti-repetition
  recentlyReportedTopics: string[];  // Semantic, not text
}
```

## Change Detection

Track what's actually changed:
- Run phase transitions
- New completions
- New escalations
- WO status changes
- Chat decisions made

Only narrate changes, not steady state.

## Topic Tracking

Instead of text-based dedup, track topics:
- "reported WO-2026-152 status" 
- "mentioned escalation for WO-2026-150"
- "discussed auth deprioritization"

Don't re-report same topic within cooldown window.

## Prompt Structure

```
You are the user's chief of staff for their software projects.

CURRENT STATE:
- 3 active projects, 2 runs in progress
- 1 escalation needs response (WO-2026-150: npm registry access)

WHAT CHANGED (since 5 min ago):
- WO-2026-152 moved to iteration 3 (tests failed again)
- No new completions

RECENT CONTEXT:
- Yesterday: User deprioritized auth work
- 2h ago: User started voice widget run

ALREADY REPORTED:
- WO-2026-150 escalation (don't repeat)

Give a brief, relevant update. Connect to recent decisions.
Only mention what's new or needs attention.
```
