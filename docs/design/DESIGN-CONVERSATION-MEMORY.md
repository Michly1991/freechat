# FreeChat Conversation Memory Design

## Goal

FreeChat keeps short chat context for live replies, but each room and each Agent also needs long-lived memory. When conversation context grows beyond a threshold, the server automatically compresses meaningful information into Markdown files. The memory layer is selective: only information useful for future work is persisted.

## Scope

- Room memory: shared long-term memory for all Agents in a room.
- Agent memory: per-room, per-Agent long-term memory.
- First version uses file-backed Markdown plus small SQLite state/chunk indexes.
- This is not a user-visible project file feature; memory files live in the room runtime workspace and are injected into Agent context.

## Storage Layout

```text
rooms/<roomId>/
  memory/
    ROOM_MEMORY.md
    agents/
      <agentId>.md
    chunks/
      room/
        mem_<timestamp>.md
      agents/
        <agentId>/
          mem_<timestamp>.md
```

Runtime workspace sync also writes:

```text
rooms/<roomId>/.freechat/MEMORY.md
rooms/<roomId>/agents/<agentId>/.freechat/MEMORY.md
rooms/<roomId>/agents/<agentId>/.freechat/AGENT_MEMORY.md
```

## Database State

`conversation_memory_state` stores compaction watermarks and counters per scope:

- `scope_type`: `room` or `agent`
- `room_id`
- `agent_id`, null for room scope
- last message/run timestamps
- count/character counters since last compaction

`conversation_memory_chunks` stores generated chunk file paths and source ranges for traceability.

## Trigger Policy

Message creation updates room counters. AI messages also update the matching Agent counters. Agent run completion updates that Agent's counters.

Compaction runs when any condition is met:

- Room message count since compaction >= 40.
- Agent message/run count since compaction >= 20.
- Character count since compaction >= 20,000.
- More than 24 hours since last compaction and there is new material.

## Memory Filtering

The compactor asks the model to preserve only future-useful information:

- confirmed decisions
- project goals and current state
- constraints, preferences, and prohibitions
- TODOs, blockers, commitments
- durable references to files, APIs, data structures, or important resources

It must discard:

- greetings and casual chatter
- transient logs and one-off intermediate work
- repeated raw dialogue
- inconclusive discussion
- sensitive raw content unless explicitly needed as business context

If new material has no durable value, the model returns `NO_MEMORY`; watermarks are still advanced so the same material is not reprocessed.

## Agent Injection

Platform-hosted Agent prompts include:

- room long-term memory
- current Agent long-term memory
- recent messages
- current request

Client/workspace Agents receive `.freechat/MEMORY.md` and `.freechat/AGENT_MEMORY.md` during workspace preparation and context refresh. Agent instructions explicitly tell them to read these files before work.

## Failure Behavior

If the model compaction call fails, the service uses a conservative rule-based fallback that extracts lines containing decision/constraint/TODO-style keywords. If nothing useful is detected, it records `NO_MEMORY` and advances watermarks.
