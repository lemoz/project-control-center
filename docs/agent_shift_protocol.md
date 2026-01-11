# Agent Shift Protocol

## 1. What is an Agent Shift?
An Agent Shift is a goal-directed operating model for autonomous progress on a project. A shift is not a task queue runner; it is a short, focused period where an agent understands the goals, decides the highest-leverage action, executes it, and hands off cleanly.

How it differs from task automation:
- Task automation: execute a predefined sequence.
- Agent shift: interpret goals, choose the right work, and adapt based on current state.

When shifts are appropriate:
- The project has clear success criteria and there is a gap to close.
- There is enough context to make decisions without constant human direction.
- The work can be scoped to a single shift with a clean handoff.

When manual work is better:
- Ambiguous goals or high-stakes architectural choices.
- Missing context that must come from a human.
- Work that cannot be verified in a reasonable timebox.

Each shift is part of a continuous line of agents: inherit from previous shifts, improve the project, and set up the next shift.

## 2. Input Specification
At shift start, the agent should receive:
- Project identity and goal statement.
- Success criteria and success metrics (from `.control.yml`).
- Current state summary (repo status, known gaps, open issues).
- Work Orders pool with statuses and priorities.
- Recent run history and any prior shift handoffs.
- Constitution preferences and learned patterns.
- Execution constraints (timebox, risk tolerance, allowed tools).

If inputs are missing, the agent should first gather or request them.

## 3. Shift Phases
```
Context -> Assess -> Decide -> Execute -> Handoff
```

### Context
Understand what the project is trying to achieve and where it is now.
- Parse success criteria and metrics into concrete targets.
- Note current state vs goal state.
- Identify available tools and constraints.

### Assess
Perform gap analysis to spot the highest-leverage work.
- Where is the largest delta to success criteria?
- What is blocking progress?
- What opportunities exist for fast, safe wins?

### Decide
Select the single best action for this shift.
- Prefer goals over urgency, and urgency over effort.
- Choose between: create a WO, execute a ready WO, research, or unblock.
- Avoid work that does not clearly advance success criteria.

Decision heuristics:
- Does this move the project measurably toward success criteria?
- Is there a blocker that must be removed first?
- Is there a ready WO that matches the highest leverage gap?
- Is there missing work that should be captured as a new WO?
- Do I need brief research before acting?

### Execute
Pick the tool that fits the work:
- WO + Runner: substantial changes, multi-file work, or when isolation helps.
- Direct action: small, safe fixes or config updates.
- VM: heavy computation or when stronger isolation is needed.

Quality bar:
- Make the smallest change that accomplishes the goal.
- Verify with tests or explicit checks.
- Escalate when facing architectural decisions, unclear requirements, or high risk.

### Handoff
Leave the project better than you found it and prepare the next shift.
- Summarize what changed and why.
- Record tests run and results.
- List blockers, risks, and open questions.
- Recommend the next action.

## 4. Output Specification
Each shift leaves behind:
- A brief summary of work performed.
- Changes made (files touched, WOs updated or created).
- Verification results (tests or manual checks).
- Blockers and risks.
- Recommended next steps for the next shift or a human.

## 5. Relationship to Existing Systems
- Work Orders: a pool of candidate work, not a mandatory queue.
- Runs: execution records used to learn from outcomes and failures.
- Constitution: preferences and patterns that guide decisions and style.
- Success criteria: the north star for deciding what to do next.
- Escalation: the safety valve when uncertainty or risk is high.

## 6. Examples
Good shift decision:
> "Success criteria says 'manage 10-100 projects'. Currently at 1. The agent shift system is blocking this. I'll work on WO-2026-060 to define the protocol."

Bad shift decision:
> "WO-2026-007 (iMessage notifier) is in backlog. I'll work on that." (Does not connect to current goals.)

Another good decision:
> "The next shift needs context on recent run failures. I'll review run logs and write a handoff note with the top blockers."

Another bad decision:
> "I'll refactor the UI layout because it looks old." (No tie to success criteria, not requested.)

## 7. Guardrails
- Must pass tests or explicit checks before declaring progress.
- Escalate architectural or high-risk decisions to a human.
- Do not exceed shift scope or timebox; stop and hand off instead.
- Always leave handoff notes, even if no changes were made.
