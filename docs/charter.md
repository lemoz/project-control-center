# Project Charter — Project Control Center

## Mission / Why now
You’re running many parallel repos (prototypes + long‑term products) and using AI agents to do long stretches of work. The bottleneck has shifted from “writing code” to “remembering what’s active, what’s next, and where we left off.”  
Project Control Center exists to reduce context loss, make agent runs safe and review‑gated, and give you a single mobile‑friendly place to direct work across your portfolio.

## Primary user
**You (director/reviewer)** working across many local git repos, often switching between projects and delegating implementation to AI agents.

## Secondary / future users (v1+)
- A small team of collaborators (optional).
- Additional “reviewer” or “maintenance” agents operating under the same workflow.

## Core workflows
1. **Portfolio overview**
   - Auto‑discover local git repos.
   - Tag as prototype vs long‑term.
   - Track stage, status, priority, and top work orders.

2. **Work Orders + Kanban**
   - Work Orders are spec‑backed cards stored per repo (`work_orders/*.md`).
   - Kanban columns show lifecycle from idea → ready → build → review → accepted.
   - “Ready” contract enforces clear agent instructions.

3. **Builder → Reviewer gate**
   - Builder agent executes one Ready Work Order.
   - Fresh Reviewer agent PR‑reviews the diff against the Work Order.
   - Builder loops until Reviewer approves.
   - Only then do you see a summary + reviewer verdict.

4. **Summary‑first human review**
   - You review outcomes via short summaries, files touched, tests status, and risks.
   - Diffs are optional/on‑demand through local tools.

5. **Anywhere access**
   - UI runs locally and is exposed via ngrok with basic auth.
   - Responsive PWA for full edit/run on mobile.

## Success metrics (v0)
- You can switch projects without losing state: portfolio + last handoff visible in <10 seconds.
- Work Orders are consistently spec‑first (goal/acceptance/stop conditions present before runs).
- Builder+Reviewer gate removes unreviewed diffs from your loop.
- v0 dogfoods itself: at least 5 Work Orders completed using the UI.

## Constraints
- Local-first; no cloud hosting or sync in core v0 (cloud features live in `pcc-cloud`).
- Access via ngrok; treat as internet‑exposed.
- Private‑by‑default for new projects.
- Summary‑first UX; avoid heavy diff review in UI.
- Provider support target: Codex, Claude Code, Gemini CLI (Codex only in v0).

## Scope
### v0 (this milestone)
- Next.js PWA dashboard + per‑repo Kanban UI.
- Local Node/TS server with SQLite state.
- Repo scanning + portfolio indexing (lightweight).
- Work Order CRUD + Ready contract enforcement.
- Codex builder + reviewer loop (stubs → working).
- Settings page for provider/model selection (Codex active).
- Self‑managed ngrok exposure and basic auth.

### v1 (next)
- Add Claude Code + Gemini providers.
- Notifier plugins (iMessage/Shortcuts, email, etc.).
- Per‑repo settings overrides.
- Better repo discovery (ignore rules, archived detection).
- Optional cloud sync or remote runners, owned by `pcc-cloud`.
