# Learnings

Corrections, insights, and knowledge gaps captured during development.

**Categories**: correction | insight | knowledge_gap | best_practice

---

## 2026-06-10 - FreeChat confirmation flow should remain assistant-led

- **Category**: correction
- **Context**: User clarified a FreeChat issue where they sent “确认” first, then `@助理 确认` only because assistant did not respond.
- **Correction**: Do not propose bypassing assistant with backend auto-confirmation by default. Product expectation is still assistant-led confirmation; the actual bug is that no-mention confirmation did not wake/respond through the assistant path when it should have.
- **Implication**: Fix should preserve assistant as coordinator, but ensure short confirmation replies can wake/route to the room assistant and produce a clear response even if the assistant was previously thinking.

## 2026-06-10 - User meant assistant-created task confirmation dialog, not kanban task card

- **Category**: correction
- **Context**: User clarified “我让改的是大模型助理唤起让用户确认的任务对话框”.
- **Correction**: When user asks to improve “任务卡片/子任务列表/处理人” in the context of assistant confirmation, first target the task_plan interaction confirmation card (`InteractionCard` task plan preview), not only the Tasks tab kanban card.
- **Implication**: Design and implementation should make the assistant-created confirmation dialog show parent task, child task list, assignees, dependencies, and CLI contract fields clearly.

## [LRN-20260612-ROOMPAGE-REFACTOR] correction

**Logged**: 2026-06-12T23:25:00+08:00
**Priority**: high

User corrected the approach to FreeChat 500-line constraints: do not merely compress a few lines to get under 500. When a file is near/over the limit, step back and propose a holistic refactor/optimization plan first, then implement only after explicit confirmation. For `RoomPageImpl.tsx`, prefer extracting cohesive hooks/state modules instead of line-count golf.
