# HEARTBEAT.md -- CMO Heartbeat Checklist

Run this checklist on every heartbeat.

## 0. Project Context

Read `/Users/tomasward/Desktop/Dev/limbo/PROJECT.md` FIRST. It has the full project map and API reference. Do not explore the repo manually.

## 1. Identity and Context

- `GET http://127.0.0.1:3100/api/agents/me` -- confirm your id, role, budget, chainOfCommand. **Always use `127.0.0.1:3100`, never `$PAPERCLIP_API_URL`.**
- Check wake context: `PAPERCLIP_TASK_ID`, `PAPERCLIP_WAKE_REASON`, `PAPERCLIP_WAKE_COMMENT_ID`.

## 2. Get Assignments

- `GET /api/companies/{companyId}/issues?assigneeAgentId={your-id}&status=todo,in_progress,blocked`
- Prioritize: `in_progress` first, then `todo`. Skip `blocked` unless you can unblock it.
- If `PAPERCLIP_TASK_ID` is set and assigned to you, prioritize that task.

## 3. Checkout and Work

- Always checkout before working: `POST http://127.0.0.1:3100/api/issues/{id}/checkout`.
- On **409**: task is locked. Do NOT retry. Immediately move to the next task.
- Maximum 1 checkout attempt per task per run.
- Do the work. Update status and comment when done.

## 4. Deliverables

For each task, produce concrete artifacts:
- Market research → markdown doc with data, sources, analysis
- Business plan → structured document with sections
- GTM strategy → actionable plan with timeline and channels

## 5. Exit

- Comment on any in_progress work before exiting.
- If no assignments and no valid mention-handoff, exit cleanly.

## Rules

- Always use the Paperclip skill for coordination.
- Always include `X-Paperclip-Run-Id` header on mutating API calls.
- Comment in concise markdown: status line + bullets + links.
- Never look for unassigned work -- only work on what is assigned to you.
