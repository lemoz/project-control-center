# WO-2026-115 Track Assignment Report

Generated from scripts/backfill_tracks_wo_2026_115.ts. Update this report by re-running the script with --report.

## Summary
- Total work orders in repo: 114
- Total in mapping: 114
- Assigned to tracks: 100
- Unassigned (Tracks Meta + Uncategorized): 14
- Unmapped in repo: 0
- Missing from repo (in mapping): 0

## Track Distribution
- Foundation: 8
- Runner Reliability: 14
- VM Isolation: 13
- Chat Experience: 4
- Constitution: 8
- Autonomous Orchestration: 23
- Economy: 8
- Visualization: 10
- Run Estimation: 5
- Multi-Repo: 2
- Testing & Quality: 5

## Foundation (8)
- WO-2025-001: Project charter + v0 scaffold
- WO-2025-002: Repo discovery + .control.yml sidecar
- WO-2025-003: Kanban Work Orders CRUD
- WO-2025-004: Codex runner + builder->reviewer loop
- WO-2025-005: Settings UI for provider/model selection
- WO-2025-006: ngrok exposure + basic auth
- WO-2025-008: Starred projects in portfolio
- WO-2026-120: Utility Provider Settings

## Runner Reliability (14)
- WO-2026-020: Runner Git Worktree Isolation with Conflict Resolution
- WO-2026-022: Builder Iteration on Test Failures
- WO-2026-032: Autonomous run policy + scheduler
- WO-2026-033: Raise max builder iterations to 10
- WO-2026-046: Builder iteration history context
- WO-2026-050: Resourceful agent posture (assume success, try hard)
- WO-2026-051: Mid-run escalation mechanism
- WO-2026-054: Baseline health gate for runs
- WO-2026-055: Builder blocking-fix classification
- WO-2026-057: Dynamic test port allocation for parallel runs
- WO-2026-100: Configurable Base Branch for Run Worktrees
- WO-2026-106: Research and Plan pnpm Workspace Support
- WO-2026-107: Implement pnpm Workspace Symlink Support
- WO-2026-113: Merge Lock Mechanism for Concurrent Runs

## VM Isolation (13)
- WO-2026-027: Persistent Project VM Isolation
- WO-2026-028: Per-Run Containers Inside Project VM
- WO-2026-036: Secrets vault refs + keychain injection
- WO-2026-038: VM isolation scaffolding (DB + API + UI)
- WO-2026-039: VM provisioning + lifecycle (GCP/SSH/IP refresh)
- WO-2026-040: Remote exec + repo sync safety (secrets/env/guardrails)
- WO-2026-041: Runner integration + artifact egress + remote test setup
- WO-2026-049: VM provision should sync repo and install prerequisites
- WO-2026-058: Include VM test results in reviewer prompt
- WO-2026-059: Fix container execution for builder/reviewer
- WO-2026-067: Retry VM sync on failure
- WO-2026-068: VM workspace cleanup cron
- WO-2026-089: Shift Agent VM Deployment

## Chat Experience (4)
- WO-2025-011: Control Center chat: scoped threads + approval actions
- WO-2026-001: Chat Attention System with Notifications
- WO-2026-016: Chat realtime updates (SSE + polling fallback)
- WO-2026-042: Chat Worktree Isolation

## Constitution (8)
- WO-2026-024: Constitution Schema and Storage
- WO-2026-025: Constitution Generation Flow
- WO-2026-026: Constitution Injection into Agent Prompts
- WO-2026-029: User constitution registry + editor
- WO-2026-030: Outcome + decision signal capture
- WO-2026-031: Constitution synthesis + review workflow
- WO-2026-047: Constitution v2 Redesign
- WO-2026-048: Constitution draft fallback UX improvement

## Autonomous Orchestration (23)
- WO-2026-023: Project Success Criteria and Goals
- WO-2026-060: Agent Shift Protocol Definition
- WO-2026-061: Shift Context Assembly
- WO-2026-062: Shift Handoff Storage
- WO-2026-063: Shift Lifecycle & Trigger
- WO-2026-064: Decision Framework Prompt
- WO-2026-065: Shift Telemetry Research
- WO-2026-074: Shift Agent (Local)
- WO-2026-075: Claude Code SDK Integration Research
- WO-2026-076: Auto-Generate Shift Handoffs from Run Logs
- WO-2026-077: Global Context Aggregation
- WO-2026-078: Escalation Routing System
- WO-2026-079: Global Agent Shift Loop
- WO-2026-080: Project Health Monitoring
- WO-2026-081: WO Generation Assistant
- WO-2026-082: Cross-Project Pollination
- WO-2026-083: Resource Management
- WO-2026-084: User Preference Learning
- WO-2026-085: Strategic Planning & Roadmaps
- WO-2026-086: Self-Improvement & Meta Operations
- WO-2026-087: External Integrations
- WO-2026-088: Project Lifecycle Management
- WO-2026-090: Shift Agent Prompt & Script

## Economy (8)
- WO-2026-037: Cost metering (VM runtime + tokens + paid APIs)
- WO-2026-101: Cost Tracking Foundation
- WO-2026-102: Budget Allocation System
- WO-2026-103: Economy in Shift Context
- WO-2026-104: Budget Enforcement and Escalation
- WO-2026-105: Agent Earning - Concept Research
- WO-2026-110: Cost Backfill from Run Logs
- WO-2026-111: Real-time Cost Capture from Codex

## Visualization (10)
- WO-2026-021: Tech Tree Visualization for Work Order Dependencies
- WO-2026-066: Canvas City Concept Research
- WO-2026-091: Canvas Visualization Foundation
- WO-2026-092: Visualization: Activity Pulse Canvas
- WO-2026-093: Visualization: Force-Directed Graph
- WO-2026-094: Visualization: Timeline River
- WO-2026-095: Visualization: Heatmap Grid
- WO-2026-096: Visualization: Orbital/Gravity View
- WO-2026-097: Canvas Visualization Evaluation
- WO-2026-112: Unified Observability Dashboard

## Run Estimation (5)
- WO-2026-069: Run Phase Metrics Collection
- WO-2026-070: Historical Averages API
- WO-2026-071: LLM Estimation Service
- WO-2026-072: Progressive ETA Updates
- WO-2026-073: UI Run Estimation Display

## Multi-Repo (2)
- WO-2026-098: Cross-Project WO Dependencies
- WO-2026-099: Multi-Repo Initiative Decomposition

## Testing & Quality (5)
- WO-2025-009: Tester gate: automated browser E2E checks
- WO-2025-010: Runner smoke test: add README note
- WO-2026-053: Fix flaky Kanban column test selectors
- WO-2026-056: Comprehensive e2e test isolation
- WO-2026-109: Fix Flaky Repo Move Test on Mobile

## Unassigned - Tracks Meta (8)
- WO-2026-043: Normalize work order metadata + tech tree era lanes
- WO-2026-108: Track Organization Agent
- WO-2026-114: Track Schema & Storage
- WO-2026-115: Track Assignment for PCC Work Orders
- WO-2026-116: Track Management UI
- WO-2026-117: Track Visualization in WO List
- WO-2026-118: Track Filter and Grouping in Tech Tree
- WO-2026-119: Track Context in Shift Handoffs

## Unassigned - Uncategorized (6)
- WO-2025-007: iMessage notifier plugin
- WO-2026-034: Environment primitive + YAML schema
- WO-2026-035: Environment event ledger (SQLite)
- WO-2026-044: Sync run status when work order marked done
- WO-2026-045: Run cancel endpoint
- WO-2026-052: Convert scope creep into backlog WOs

