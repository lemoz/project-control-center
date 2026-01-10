---
id: WO-2026-025
title: Constitution Generation Flow
goal: Create a guided process to generate the initial constitution by analyzing chat history from Claude Code CLI, Codex CLI, and Project Control Center conversations to extract user preferences, patterns, and learnings.
context:
  - ~/.claude/history.jsonl (Claude Code CLI history)
  - ~/.claude/projects/ (Claude Code per-project data)
  - ~/.codex/history.jsonl (Codex CLI session references)
  - ~/.codex/sessions/YYYY/MM/DD/*.jsonl (Codex full conversation history)
  - server/chat_db.ts (Project Control Center chat history)
  - WO-2026-024 (constitution storage)
acceptance_criteria:
  - Generate Constitution button in settings (global) and project page (local)
  - Guided wizard flow with progress indicators
  - Step 1 - Source Selection: choose which chat sources to analyze (Claude Code, Codex, PCC chats)
  - Step 2 - Analysis: parse selected histories and extract patterns using AI
  - Step 3 - Review Insights: show extracted preferences, patterns, anti-patterns with ability to accept/reject/edit each
  - Step 4 - Generate Draft: AI compiles accepted insights into constitution markdown
  - Step 5 - Edit and Save: user can edit final draft before saving
  - Support incremental updates (re-run to add new learnings without losing edits)
  - Show analysis statistics (N conversations analyzed, M patterns found)
non_goals:
  - Real-time continuous constitution updates (manual trigger only for v1)
  - Importing from other AI tools beyond Claude Code and Codex CLI
  - Semantic deduplication of similar patterns
  - Conflict resolution for contradictory patterns (user decides)
stop_conditions:
  - If chat history parsing is too slow (over 60s), add sampling or date range filters
  - If AI extraction produces low quality results, fall back to manual entry with templates
  - If external CLI formats change, gracefully degrade with clear error messages
priority: 2
tags:
  - constitution
  - generation
  - chat-history
  - autonomy
estimate_hours: 10
status: done
created_at: 2026-01-06
updated_at: 2026-01-09
depends_on:
  - WO-2026-024
era: v2
---
# Constitution Generation Flow

## Overview

Users can generate their constitution from existing chat history across multiple AI tools. This provides a rich starting point based on actual usage patterns rather than starting from scratch.

## Chat History Sources

### Claude Code CLI
```
~/.claude/history.jsonl
Format: { display, pastedContents, timestamp, project }
```
- Command history with project context
- Less conversational, more command-focused

### Codex CLI
```
~/.codex/sessions/YYYY/MM/DD/*.jsonl
Format: JSONL with session_meta and response_item entries
```
- Full conversation history with messages
- Includes instructions, context, and git metadata
- **5,782+ sessions** available for analysis

### Project Control Center
```
SQLite: chat_messages table
```
- Chat threads with assistant/user messages
- Includes actions taken and run context

## Generation Wizard Flow

### Step 1: Source Selection
```
┌─────────────────────────────────────────────┐
│ Generate Constitution                        │
├─────────────────────────────────────────────┤
│ Select chat sources to analyze:             │
│                                             │
│ ☑ Claude Code CLI (47 conversations)        │
│ ☑ Codex CLI (5,782 sessions)               │
│ ☑ Project Control Center (23 threads)       │
│                                             │
│ Date range: [Last 30 days ▼]               │
│                                             │
│ [Next →]                                    │
└─────────────────────────────────────────────┘
```

### Step 2: Analysis
```
┌─────────────────────────────────────────────┐
│ Analyzing Chat History...                   │
├─────────────────────────────────────────────┤
│ ████████████░░░░░░░░ 60%                   │
│                                             │
│ Parsed: 2,341 / 5,852 conversations        │
│ Patterns found: 47                          │
│ Preferences detected: 12                    │
│ Anti-patterns identified: 8                 │
│                                             │
│ Analyzing decision patterns...              │
└─────────────────────────────────────────────┘
```

### Step 3: Review Insights
```
┌─────────────────────────────────────────────┐
│ Review Extracted Insights                   │
├─────────────────────────────────────────────┤
│ Style & Taste (5 found)                     │
│ ┌─────────────────────────────────────────┐ │
│ │ ☑ Prefers TypeScript over JavaScript    │ │
│ │   Source: 23 conversations              │ │
│ │   [Edit] [Reject]                       │ │
│ └─────────────────────────────────────────┘ │
│ ┌─────────────────────────────────────────┐ │
│ │ ☑ Uses terse commit messages            │ │
│ │   Source: 15 conversations              │ │
│ │   [Edit] [Reject]                       │ │
│ └─────────────────────────────────────────┘ │
│                                             │
│ Anti-Patterns (3 found)                     │
│ ┌─────────────────────────────────────────┐ │
│ │ ☑ Avoid using 'any' type               │ │
│ │   Source: 8 corrections                 │ │
│ │   [Edit] [Reject]                       │ │
│ └─────────────────────────────────────────┘ │
│                                             │
│ [← Back] [Generate Draft →]                 │
└─────────────────────────────────────────────┘
```

### Step 4: Edit Draft
```
┌─────────────────────────────────────────────┐
│ Edit Constitution Draft                     │
├─────────────────────────────────────────────┤
│ # Constitution                              │
│                                             │
│ ## Style & Taste                            │
│ - Prefers TypeScript over JavaScript        │
│ - Uses terse commit messages                │
│ - Code should be self-documenting           │
│                                             │
│ ## Anti-Patterns                            │
│ - Avoid using 'any' type in TypeScript      │
│ - Don't add abstractions prematurely        │
│ ...                                         │
│                                             │
│ [← Back] [Save Constitution]                │
└─────────────────────────────────────────────┘
```

## AI Analysis Prompt

The extraction uses an AI prompt like:

```
Analyze these chat conversations and extract:

1. **Style Preferences**: How does the user prefer code to be written?
   - Naming conventions, comment style, verbosity, etc.

2. **Decision Patterns**: How does the user make technical decisions?
   - What do they prioritize? Speed vs safety? Simple vs comprehensive?

3. **Anti-Patterns**: What has the user corrected or complained about?
   - Repeated corrections indicate strong preferences

4. **Success Patterns**: What approaches did the user praise or accept quickly?
   - These indicate preferred solutions

5. **Communication Style**: How does the user prefer to interact?
   - Verbose explanations or terse responses? Ask before acting?

For each insight, provide:
- The pattern/preference (one sentence)
- Confidence level (high/medium/low)
- Evidence count (how many conversations support this)

Format as JSON for structured processing.
```

## Incremental Updates

When re-running generation on an existing constitution:
1. Load current constitution
2. Analyze only new conversations (since last generation)
3. Show new insights alongside existing
4. User can merge new insights or keep existing
5. Preserve manual edits in sections not affected by new insights
