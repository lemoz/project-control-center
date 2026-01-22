---
id: WO-2026-115
title: Track Assignment for PCC Work Orders
goal: Analyze all PCC work orders and assign them to appropriate tracks based on their goals, tags, and dependencies.
context:
  - WO-2026-114 must be complete (track schema exists)
  - 11 tracks identified from analysis: Foundation, Runner Reliability, VM Isolation, Chat, Constitution, Autonomous, Economy, Visualization, Run Estimation, Multi-Repo, Testing
  - ~113 existing WOs need track assignment
acceptance_criteria:
  - Create the 11 predefined tracks in the database with proper names, descriptions, goals, and colors
  - Assign each existing WO to its appropriate track based on tags, dependencies, and title analysis
  - WOs can belong to exactly one track (or none if truly miscellaneous)
  - Generate summary report showing track distribution
  - All assignments reviewable before merge
non_goals:
  - Building a reusable assignment tool (this is a one-time backfill)
  - Changing WO content or metadata beyond track_id
  - Creating new tracks beyond the 11 identified
stop_conditions:
  - If a WO genuinely doesn't fit any track, leave track_id null
priority: 2
tags:
  - tracks
  - backfill
  - data-migration
estimate_hours: 2
status: done
created_at: 2026-01-15
updated_at: 2026-01-22
depends_on:
  - WO-2026-114
era: v2
---
## Overview

This is a one-time backfill WO to assign all existing PCC work orders to the track system. The 11 tracks were identified through analysis of WO clusters, dependencies, and goals.

## Track Definitions to Create

| Track | Name | Goal | Color | Icon |
|-------|------|------|-------|------|
| 1 | Foundation | Bootstrap the system from zero to functional | #6B7280 | foundation |
| 2 | Runner Reliability | Parallel runs that don't break each other | #10B981 | shield-check |
| 3 | VM Isolation | Secure, isolated execution environments | #8B5CF6 | server |
| 4 | Chat Experience | Rich conversational interface with the system | #3B82F6 | chat |
| 5 | Constitution | Define and enforce agent behavior governance | #F59E0B | scroll |
| 6 | Autonomous Orchestration | Self-directing agent shifts and global coordination | #EC4899 | robot |
| 7 | Economy | Cost awareness and self-sustaining agent budgets | #14B8A6 | dollar |
| 8 | Visualization | Rich visual dashboards for system state | #F97316 | chart |
| 9 | Run Estimation | Predict how long runs will take | #6366F1 | clock |
| 10 | Multi-Repo | Coordinate work across multiple projects | #84CC16 | git-branch |
| 11 | Testing & Quality | Reliable, non-flaky tests | #EF4444 | beaker |

## Assignment Mapping

### Foundation (WO-2025-001 through WO-2025-008, excluding some)
- WO-2025-001: Project charter + v0 scaffold
- WO-2025-002: Repo discovery + sidecar
- WO-2025-003: Kanban Work Orders CRUD
- WO-2025-004: Codex runner + builder→reviewer loop
- WO-2025-005: Settings UI
- WO-2025-006: ngrok exposure
- WO-2025-008: Starred projects

### Runner Reliability
- WO-2026-020: Git Worktree Isolation
- WO-2026-022: Builder Iteration on Test Failures
- WO-2026-032: Autonomous run policy + scheduler
- WO-2026-033: Max builder iterations
- WO-2026-046: Builder iteration history context
- WO-2026-050: Resourceful agent posture
- WO-2026-051: Mid-run escalation
- WO-2026-054: Baseline health gate
- WO-2026-055: Blocking-fix classification
- WO-2026-057: Dynamic test port allocation
- WO-2026-100: Configurable base branch
- WO-2026-106: pnpm workspace research
- WO-2026-107: pnpm workspace symlinks
- WO-2026-113: Merge lock mechanism

### VM Isolation
- WO-2026-027: Persistent Project VM Isolation
- WO-2026-028: Per-Run Containers
- WO-2026-036: Secrets vault refs
- WO-2026-038: VM scaffolding
- WO-2026-039: VM provisioning
- WO-2026-040: Remote exec + repo sync
- WO-2026-041: Runner integration + artifact egress
- WO-2026-049: VM sync + install prereqs
- WO-2026-058: VM test results in reviewer
- WO-2026-059: Fix container execution
- WO-2026-067: Retry VM sync
- WO-2026-068: VM workspace cleanup cron
- WO-2026-089: Shift Agent VM Deployment

### Chat Experience
- WO-2025-011: Scoped threads + approval actions
- WO-2026-001: Chat Attention System
- WO-2026-016: Realtime updates (SSE)
- WO-2026-042: Chat Worktree Isolation

### Constitution
- WO-2026-024: Constitution Schema + Storage
- WO-2026-025: Constitution Generation Flow
- WO-2026-026: Constitution Injection into Prompts
- WO-2026-029: User constitution registry + editor
- WO-2026-030: Outcome + decision signal capture
- WO-2026-031: Constitution synthesis + review
- WO-2026-047: Constitution v2 Redesign
- WO-2026-048: Draft fallback UX

### Autonomous Orchestration
- WO-2026-060: Shift Protocol Definition
- WO-2026-061: Shift Context Assembly
- WO-2026-062: Shift Handoff Storage
- WO-2026-063: Shift Lifecycle & Trigger
- WO-2026-064: Decision Framework Prompt
- WO-2026-074: Shift Agent (Local)
- WO-2026-075: Claude Code SDK Research
- WO-2026-076: Auto-Generate Handoffs
- WO-2026-077: Global Context Aggregation
- WO-2026-078: Escalation Routing System
- WO-2026-079: Global Agent Shift Loop
- WO-2026-080: Project Health Monitoring
- WO-2026-081: WO Generation Assistant
- WO-2026-082: Cross-Project Pollination
- WO-2026-083: Resource Management
- WO-2026-084: User Preference Learning
- WO-2026-085: Strategic Planning & Roadmaps
- WO-2026-086: Self-Improvement & Meta Ops
- WO-2026-087: External Integrations
- WO-2026-088: Project Lifecycle Management
- WO-2026-090: Shift Agent Prompt & Script

### Economy
- WO-2026-037: Cost metering
- WO-2026-101: Cost Tracking Foundation
- WO-2026-102: Budget Allocation System
- WO-2026-103: Economy in Shift Context
- WO-2026-104: Budget Enforcement + Escalation
- WO-2026-105: Agent Earning Research
- WO-2026-110: Cost Backfill from Logs
- WO-2026-111: Real-time Cost Capture

### Visualization
- WO-2026-021: Tech Tree Visualization
- WO-2026-066: Canvas City Concept Research
- WO-2026-091: Canvas Visualization Foundation
- WO-2026-092: Activity Pulse Canvas
- WO-2026-093: Force-Directed Graph
- WO-2026-094: Timeline River
- WO-2026-095: Heatmap Grid
- WO-2026-096: Orbital/Gravity View
- WO-2026-097: Canvas Visualization Evaluation
- WO-2026-112: Unified Observability Dashboard

### Run Estimation
- WO-2026-069: Run Phase Metrics Collection
- WO-2026-070: Historical Averages API
- WO-2026-071: LLM Estimation Service
- WO-2026-072: Progressive ETA Updates
- WO-2026-073: UI Run Estimation Display

### Multi-Repo
- WO-2026-098: Cross-Project WO Dependencies
- WO-2026-099: Initiative Decomposition

### Testing & Quality
- WO-2025-009: Tester gate (E2E)
- WO-2025-010: Runner smoke test
- WO-2026-053: Fix flaky Kanban test
- WO-2026-056: E2E test isolation
- WO-2026-109: Fix flaky repo move test

### Tracks Meta (self-referential)
- WO-2026-043: Normalize WO metadata + tech tree era lanes
- WO-2026-108: Track Organization Agent
- WO-2026-114: Track Schema & Storage
- WO-2026-115: Track Assignment for PCC (this WO)
- WO-2026-116: Track Management UI
- WO-2026-117: Track Visualization in WO List
- WO-2026-118: Track Filter/Grouping in Tech Tree
- WO-2026-119: Track Context in Shifts

### Uncategorized
- WO-2025-007: iMessage notifier (notifications, could be its own small track or uncategorized)
- WO-2026-034: Environment primitive (infrastructure, could be VM or new "Agent OS" track)
- WO-2026-035: Environment event ledger
- WO-2026-044: Sync run status when WO marked done
- WO-2026-045: Run cancel endpoint
- WO-2026-052: Convert scope creep into backlog WOs

## Implementation

1. Read all track definitions from this WO
2. Create each track via POST /repos/project-control-center/tracks
3. For each WO in the assignment mapping, call PUT /repos/project-control-center/work-orders/:woId/track
4. Generate summary report of assignments

## Verification

After completion:
- Each track should have correct WO count
- No WO should be orphaned unless intentionally uncategorized
- Track distribution should match the analysis (~7-15 WOs per track)
