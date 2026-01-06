---
id: WO-2026-001
title: Chat Attention System with Notifications
status: done
priority: 2
tags: [chat, notifications, ux]
created: 2026-01-02
updated: 2026-01-06
estimate_hours: 6
depends_on: [WO-2025-011]
era: chat-v2
---

# Chat Attention System with Notifications

## Goal
Create an attention system that surfaces pending chat threads requiring user action, with a notification bell and board view.

## Context
- Chat threads can have pending assistant messages awaiting review
- Runs can complete and need user attention
- Users need a central place to see what needs their attention across all threads

## Acceptance Criteria
- [x] Track attention state per thread (pending, needs_review, etc.)
- [x] Create ChatAttentionBell component showing unread count
- [x] Create ChatAttentionBoard component listing threads needing attention
- [x] Add `/api/chat/attention` endpoint for attention state
- [x] Mark threads as read when user views them
- [x] Show attention indicators in thread list
- [x] Integrate bell into global layout header

## Non-Goals
- Push notifications (browser/mobile)
- Email/SMS alerts
- Customizable attention rules

## Stop Conditions
- Bell shows accurate count of threads needing attention
- Board lists all pending threads with summaries
- Clicking a thread marks it as read and decrements count

## Implementation Notes
- server/chat_attention.ts handles attention state logic
- ChatAttentionBell.tsx renders notification bell with badge
- ChatAttentionBoard.tsx shows full list of pending items
- Attention state stored in chat_threads table (read_at, last_message_at comparison)
