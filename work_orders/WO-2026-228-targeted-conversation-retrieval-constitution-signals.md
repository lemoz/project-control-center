---
id: WO-2026-228
title: LLM-based conversation filtering for constitution signals
goal: Replace random sampling with LLM-based relevance filtering so the constitution analysis prompt receives the most signal-rich conversations.
context:
  - server/constitution_generation.ts (source loading + sampling)
  - Structured ConversationMessage[] parsing is already in place (role + content per message)
  - Current approach pools all conversations and randomly samples — wastes analysis tokens on irrelevant chatter
  - Previous regex-based approach was reverted as too brittle
acceptance_criteria:
  - Add a fast LLM pre-filter pass that scores each conversation for constitution relevance before the main analysis
  - Use a cheap/fast model (e.g. haiku) with a simple prompt asking "does this conversation contain user preferences, style corrections, decision rationale, or anti-patterns?"
  - Return a relevance score or yes/no per conversation so the top-N most relevant are selected
  - Batch conversations into the filter prompt to minimize API calls (e.g. 10-20 conversation summaries per call)
  - Fall back to recency-based sampling if the LLM filter fails or returns no results
  - Report filter stats in analysis warnings (filtered count, fallback count, filter latency)
non_goals:
  - Changing the extraction schema or UI presentation
  - Embedding-based similarity search (future work)
  - Fine-tuning or training a custom classifier
stop_conditions:
  - If LLM filter adds more than 30 seconds of latency, simplify by reducing batch size or using shorter conversation summaries
  - If filter consistently returns zero results, fall back to sampling and log a warning
priority: 2
tags:
  - constitution
  - generation
  - retrieval
  - v2
estimate_hours: 4
status: ready
created_at: 2026-01-27
updated_at: 2026-01-29
depends_on:
  - WO-2026-047
  - WO-2026-025
era: v2
---
## Notes

The structured `ConversationMessage[]` parsing (role/content per message) is already in place from the previous iteration. The filter should leverage this structure — send the first and last few messages of each conversation as a summary to the filter LLM, not the full text.

Key insight: the filter doesn't need to be perfect. Even a rough LLM-based relevance score will dramatically outperform random sampling since most conversations (debugging sessions, routine builds) contain zero constitution signals.
