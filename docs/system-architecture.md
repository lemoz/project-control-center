# PCC System Architecture

```mermaid
flowchart TB
    subgraph USER["User Layer"]
        UI[Web UI<br/>localhost:5173]
        CLI[Claude Code CLI]
        API_CLIENT[API Client]
    end

    subgraph API["API Layer (Express :4010)"]
        WO_API["/repos/:id/work-orders/*"]
        RUN_API["/runs/*"]
        SHIFT_API["/projects/:id/shifts/*"]
        VM_API["/repos/:id/vm/*"]
        CHAT_API["/chat/*"]
    end

    subgraph ORCHESTRATION["Orchestration Layer"]
        subgraph SHIFT_SYSTEM["Shift System"]
            SHIFT_START[Start Shift]
            SHIFT_CONTEXT[Gather Context]
            SHIFT_DECIDE[Assess & Decide]
            SHIFT_EXECUTE[Execute]
            SHIFT_HANDOFF[Handoff]

            SHIFT_START --> SHIFT_CONTEXT
            SHIFT_CONTEXT --> SHIFT_DECIDE
            SHIFT_DECIDE --> SHIFT_EXECUTE
            SHIFT_EXECUTE --> SHIFT_HANDOFF
        end

        subgraph WO_LIFECYCLE["Work Order Lifecycle"]
            WO_BACKLOG[backlog]
            WO_READY[ready]
            WO_BUILDING[building]
            WO_AI_REVIEW[ai_review]
            WO_YOU_REVIEW[you_review]
            WO_DONE[done]
            WO_BLOCKED[blocked]
            WO_PARKED[parked]

            WO_BACKLOG --> WO_READY
            WO_READY --> WO_BUILDING
            WO_BUILDING --> WO_AI_REVIEW
            WO_AI_REVIEW --> WO_YOU_REVIEW
            WO_YOU_REVIEW --> WO_DONE
            WO_YOU_REVIEW --> WO_PARKED
            WO_BACKLOG --> WO_BLOCKED
            WO_BLOCKED --> WO_READY
            WO_DONE -.->|cascadeAutoReady| WO_READY
        end

        ORCHESTRATOR_AGENT["Orchestrator Agent<br/>(PLANNED: WO-2026-074)"]:::planned

        SHIFT_DECIDE --> ORCHESTRATOR_AGENT
        ORCHESTRATOR_AGENT --> WO_READY
    end

    subgraph RUN_SYSTEM["Run Execution System"]
        RUN_QUEUE[Enqueue Run]

        subgraph RUN_PHASES["Run Phases"]
            PHASE_SETUP[Setup Phase<br/>~6 min]
            PHASE_BUILDER[Builder Phase<br/>~15 min/iter]
            PHASE_TEST[Test Phase<br/>~5 min]
            PHASE_REVIEWER[Reviewer Phase<br/>~6 min]
            PHASE_MERGE[Merge Phase]

            PHASE_SETUP --> PHASE_BUILDER
            PHASE_BUILDER --> PHASE_TEST
            PHASE_TEST --> PHASE_REVIEWER
            PHASE_REVIEWER -->|approved| PHASE_MERGE
            PHASE_REVIEWER -->|changes_requested| PHASE_BUILDER
        end

        subgraph BUILDER_LOOP["Builder Loop (max 10 iter)"]
            SPAWN_WORKER[Spawn Worker]
            CODEX_EXEC[Codex Execution]
            GEN_CODE[Generate Code]
            CHECK_ESCALATION{Escalation?}
            WAIT_INPUT[Wait for Input]

            SPAWN_WORKER --> CODEX_EXEC
            CODEX_EXEC --> GEN_CODE
            GEN_CODE --> CHECK_ESCALATION
            CHECK_ESCALATION -->|yes| WAIT_INPUT
            WAIT_INPUT --> CODEX_EXEC
            CHECK_ESCALATION -->|no| PHASE_TEST
        end

        RUN_QUEUE --> PHASE_SETUP
        PHASE_BUILDER --> SPAWN_WORKER
    end

    subgraph EXECUTION_ENV["Execution Environment"]
        subgraph VM_LAYER["VM Layer (GCP)"]
            VM_PROVISION[Provision VM]
            VM_RUNNING[VM Running]
            VM_SYNC[Sync Worktree]
        end

        subgraph CONTAINER["Container (pcc-runner:latest)"]
            DOCKER_RUN[Docker Container]
            CODEX_PROCESS[Codex Process]
        end

        VM_PROVISION --> VM_RUNNING
        VM_RUNNING --> VM_SYNC
        VM_SYNC --> DOCKER_RUN
        DOCKER_RUN --> CODEX_PROCESS
    end

    subgraph STORAGE["Storage Layer"]
        subgraph SQLITE["SQLite (control-center.db)"]
            DB_PROJECTS[(projects)]
            DB_RUNS[(runs)]
            DB_SHIFTS[(shifts)]
            DB_HANDOFFS[(shift_handoffs)]
            DB_METRICS[(run_phase_metrics)]
            DB_VMS[(project_vms)]
        end

        subgraph FILES["File System"]
            WO_FILES[work_orders/*.md]
            RUN_DIRS[.system/runs/]
            ARTIFACTS[.system/run-artifacts/]
            LOGS[*.log files]
        end

        subgraph GIT["Git Repository"]
            GIT_WORKTREE[Worktree per Run]
            GIT_BRANCH[Feature Branch]
            GIT_MAIN[main branch]
        end
    end

    subgraph CONTEXT["Context Layer"]
        SHIFT_CTX_BUILDER[Shift Context Builder]
        HANDOFF_GEN["Handoff Generator<br/>(PLANNED: WO-2026-076)"]:::planned
        CONSTITUTION[Constitution Manager]

        SHIFT_CTX_BUILDER --> SHIFT_CONTEXT
        HANDOFF_GEN --> SHIFT_HANDOFF
    end

    subgraph PLANNED_FEATURES["Planned Features"]
        REALTIME_LOGS["Real-time Log Streaming<br/>(PLANNED)"]:::planned
        AUTO_HANDOFF["Auto-Handoff on Run Complete<br/>(PLANNED: WO-2026-076)"]:::planned
        RUN_ESTIMATION["Run Time Estimation<br/>(PLANNED: WO-2026-069-073)"]:::planned
    end

    %% Connections
    UI --> API
    CLI --> API
    API_CLIENT --> API

    WO_API --> WO_LIFECYCLE
    RUN_API --> RUN_SYSTEM
    SHIFT_API --> SHIFT_SYSTEM
    VM_API --> VM_LAYER

    SHIFT_EXECUTE --> RUN_QUEUE

    PHASE_SETUP --> VM_LAYER
    CODEX_PROCESS --> GEN_CODE

    %% Storage connections
    RUN_SYSTEM --> DB_RUNS
    RUN_SYSTEM --> DB_METRICS
    SHIFT_SYSTEM --> DB_SHIFTS
    SHIFT_HANDOFF --> DB_HANDOFFS
    VM_LAYER --> DB_VMS

    WO_LIFECYCLE --> WO_FILES
    RUN_SYSTEM --> RUN_DIRS
    RUN_SYSTEM --> ARTIFACTS
    RUN_SYSTEM --> LOGS

    PHASE_SETUP --> GIT_WORKTREE
    PHASE_MERGE --> GIT_BRANCH
    GIT_BRANCH --> GIT_MAIN

    %% Context connections
    DB_RUNS --> SHIFT_CTX_BUILDER
    DB_SHIFTS --> SHIFT_CTX_BUILDER
    WO_FILES --> SHIFT_CTX_BUILDER
    CONSTITUTION --> SHIFT_CTX_BUILDER

    LOGS --> HANDOFF_GEN
    ARTIFACTS --> HANDOFF_GEN
    PHASE_MERGE --> AUTO_HANDOFF

    %% Planned connections
    CODEX_PROCESS -.-> REALTIME_LOGS
    DB_METRICS -.-> RUN_ESTIMATION

    classDef planned fill:#fff3cd,stroke:#ffc107,stroke-width:2px,stroke-dasharray: 5 5
```

## Component Details

### Work Order Lifecycle
| Status | Description |
|--------|-------------|
| `backlog` | Not ready for work |
| `ready` | Ready to be picked up |
| `building` | Run in progress |
| `ai_review` | AI reviewing changes |
| `you_review` | Awaiting human review |
| `done` | Completed |
| `blocked` | Dependencies not met |
| `parked` | Paused/deferred |

### Run Phases
| Phase | Avg Duration | Description |
|-------|--------------|-------------|
| Setup | ~6 min | VM provision, worktree sync, deps install |
| Builder | ~15 min/iter | Code generation via Codex |
| Test | ~5 min | Run test suite |
| Reviewer | ~6 min | AI review of changes |
| Merge | ~1 min | Create PR, merge to main |

### Shift Lifecycle
1. **Start** - Create shift with timeout (default 120 min)
2. **Context** - Gather project state, WOs, runs, git status
3. **Assess & Decide** - Choose which WO to work on
4. **Execute** - Kick off runs, monitor progress
5. **Handoff** - Document work done, blockers, recommendations

### Planned Components (Yellow/Dashed)
- **WO-2026-074**: Orchestrator agent for autonomous shift management
- **WO-2026-076**: Auto-generate handoffs from run logs using Claude
- **WO-2026-069-073**: Run time estimation system
- **Real-time Logs**: Stream VM container logs live

## Data Flow

```
User Request
    ↓
API Endpoint
    ↓
Orchestration (Shift/WO selection)
    ↓
Run Enqueue
    ↓
VM Provision → Container Spawn → Codex Execute
    ↓
Builder → Test → Reviewer (loop if needed)
    ↓
Merge → Auto-Handoff (planned)
    ↓
Shift Complete → Next Shift
```
