---
id: WO-2026-042
title: Chat Worktree Isolation
goal: Isolate chat thread file operations in per-thread git worktrees so changes don't affect main until explicitly merged via a one-click UI action.
context:
  - server/chat_agent.ts (chat execution)
  - server/chat_actions.ts (action handlers)
  - app/components/ChatThread.tsx (chat UI)
  - .system/notes/chat-worktree-isolation-idea.md (detailed notes)
files_created:
  - server/chat_worktree.ts (worktree manager)
  - app/api/chat/threads/[threadId]/worktree/diff/route.ts (Next.js proxy)
  - app/api/chat/threads/[threadId]/worktree/merge/route.ts (Next.js proxy)
acceptance_criteria:
  - When a chat thread first needs write access, auto-create a git worktree at `.system/chat-worktrees/thread-{id}/` on branch `chat/thread-{id}`.
  - Route agent file write operations to the worktree path instead of the main repo.
  - Changes accumulate across multiple messages in the same thread.
  - Chat UI shows "View diff" link on messages with pending changes (opens inline diff or modal).
  - Chat UI shows "Merge" button that merges worktree branch to main and cleans up.
  - New action type `worktree_merge` handles the merge operation.
  - Worktree and branch are auto-cleaned on merge success or thread archive.
  - User never needs to leave the chat interface to review or merge changes.
non_goals:
  - Conflict resolution UI (fail merge with clear error, user resolves manually).
  - Cross-thread change awareness (threads are independent).
  - Automatic merge on thread close (explicit user action required).
stop_conditions:
  - If worktree creation overhead exceeds 3 seconds, investigate alternatives.
  - If git operations cause repo issues, stop and reassess.
priority: 2
tags:
  - chat
  - git
  - isolation
  - ux
estimate_hours: 6
status: done
created_at: 2026-01-08
updated_at: 2026-01-08
depends_on:
  - WO-2025-011
  - WO-2026-020
era: v1
---
# Chat Worktree Isolation

## Summary

Enable chat threads to make file changes in isolation using git worktrees. Changes only affect main when the user explicitly clicks "Merge" in the chat UI.

## Flow

1. **Auto-create** - Worktree created silently when agent first needs to write
2. **Work there** - Agent makes changes, can do multiple rounds in same thread
3. **Show in chat** - "View diff" link shows changes inline or in modal
4. **Merge button** - Single click: merges to main, cleans up worktree
5. **Auto-cleanup** - Worktree deleted after merge or on discard

## UI

```
Assistant: Done - added loading spinner to dashboard.

[View diff]  [Merge]
```

- User never leaves chat
- No git commands needed
- No context switching

## Implementation

1. **Worktree manager** - Create/list/cleanup worktrees
   ```bash
   git worktree add .system/chat-worktrees/thread-{id} -b chat/thread-{id}
   ```

2. **Route writes** - Detect write operations in chat_agent, redirect to worktree cwd

3. **Track state** - Add `worktree_path` and `has_pending_changes` to thread or separate table

4. **Action type** - New `worktree_merge` action that:
   - Runs `git merge chat/thread-{id}` on main
   - Removes worktree: `git worktree remove ...`
   - Deletes branch: `git branch -d chat/thread-{id}`

5. **UI components** - "View diff" and "Merge" buttons on messages with pending changes
