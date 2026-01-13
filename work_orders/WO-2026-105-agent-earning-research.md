---
id: WO-2026-105
title: "Agent Earning - Concept Research"
goal: Explore how agents could autonomously earn money to fund themselves and grow.
context:
  - Economy system foundation (WO-2026-101 through 104)
  - "The agents would earn money themselves - go out and do some stuff"
  - "If you can get paid, you can have that budget to do whatever you want"
  - Vision of self-sustaining agent ecosystem
acceptance_criteria:
  - Research existing agent earning models
  - Document potential revenue streams for AI agents
  - Analyze trust/autonomy requirements for each model
  - Identify legal/practical constraints
  - Evaluate which models fit PCC architecture
  - Produce recommendation on which to pursue first
  - List open questions needing human decisions
non_goals:
  - Implementation (this is research only)
  - Final decisions (recommendations for discussion)
  - Legal advice (flag issues, don't resolve)
stop_conditions:
  - If all models seem impractical, document why and alternatives
priority: 3
tags:
  - economy
  - research
  - concept
  - autonomous
estimate_hours: 3
status: backlog
created_at: 2026-01-13
updated_at: 2026-01-13
depends_on: []
era: v2
---
## Research Areas

### 1. Bounty/Gig Platforms

**Platforms to explore:**
- GitHub Sponsors / Open Source bounties
- Gitcoin (crypto bounties)
- Bountysource
- Algora (dev bounties)
- Bug bounty platforms (HackerOne, etc.)
- Freelance platforms (feasibility)

**Questions:**
- Can agents create accounts?
- Payment methods available?
- Terms of service on AI/automation?
- Reputation/verification requirements?

### 2. Service Models

**Potential services an agent could offer:**
- Code review as a service
- Documentation generation
- Test writing
- PR review for open source
- Content generation (articles, tutorials)
- Data processing/analysis

**Questions:**
- How to price services?
- How to find customers?
- Quality guarantees?
- Support/revision handling?

### 3. Product Models

**Digital products an agent could create/sell:**
- Templates (code, docs, configs)
- Micro-SaaS tools
- APIs (pay per call)
- Datasets
- Training materials

**Questions:**
- Where to sell?
- How to handle payments?
- Maintenance burden?
- Intellectual property?

### 4. Retainer/Sponsorship

**Examples:**
- VideoNest pays $X/month for dedicated agent capacity
- Company sponsors open source agent work
- Consulting retainer for ongoing support

**Questions:**
- How to negotiate?
- Contract requirements?
- Deliverable expectations?
- Relationship management?

### 5. Investment/Spawning

**Concept:**
- Successful agent accumulates surplus
- Uses surplus to spawn/fund experimental projects
- Parent-child economics
- Portfolio management at agent level

**Questions:**
- Decision criteria for spawning?
- How much autonomy?
- Failure handling?
- Success sharing?

## Trust & Autonomy Spectrum

```
Low Autonomy                              High Autonomy
     │                                          │
     ▼                                          ▼
[Manual input]  [Approval required]  [Guidelines]  [Full auto]
     │                │                    │           │
     │                │                    │           │
"Agent earned     "Agent found         "Agent can   "Agent seeks
 $50 from X"      opportunity,          accept       and accepts
                  approve?"             <$100 gigs"  any work"
```

## Legal/Practical Constraints

Research needed:
- [ ] Can AI agents have bank accounts?
- [ ] Payment processor policies on AI
- [ ] Tax implications of agent earnings
- [ ] Liability for agent work/mistakes
- [ ] Contract validity with AI party
- [ ] Platform ToS on automation

## Evaluation Criteria

For each earning model, assess:
1. **Feasibility** - Can we actually do this technically?
2. **Legality** - Are there blockers?
3. **Revenue potential** - Worth the effort?
4. **Autonomy required** - How much human oversight?
5. **Risk** - What could go wrong?
6. **Alignment** - Does it fit PCC's goals?

## Output Format

Produce a recommendation doc:
1. Ranked list of earning models by feasibility
2. Recommended first model to try
3. Implementation sketch for recommended model
4. Open questions needing human decision
5. Risks and mitigations

## Wild Ideas to Consider

- Agent applies for grants
- Agent writes and sells ebooks
- Agent creates and monetizes YouTube content
- Agent trades crypto/stocks (high risk)
- Agent runs arbitrage operations
- Agent offers tutoring/coaching
- Agent manages other people's AI agents
