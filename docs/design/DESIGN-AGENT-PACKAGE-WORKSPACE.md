# Agent Package and Room Workspace


Agent is modeled as a runnable package, not only database prompt fields.

### Agent package directory

Each global Agent template has a package under:

```text
.freechat/workspace-data/agents/{agentId}/
├── AGENT.md
├── res/
├── scripts/
└── skills/
    └── {skillName}/
        ├── SKILL.md
        ├── res/
        └── scripts/
```

Rules:

- `AGENT.md` is the Agent introduction and operating guide: description, details, behavior, resources, and skill index.
- Agent-level `res/` stores reusable references/templates/examples for the Agent.
- Agent-level `scripts/` stores shared scripts.
- Every Skill follows Claude-style structure: `SKILL.md`, `res/`, `scripts/`.
- Runtime should treat the Agent package as read-only; editing the Agent template is the way to modify it.
- Public system Skills live under `.freechat/workspace-data/system-skills/` and are mounted into each room Agent workspace.

### Room workspace directory

Each room has an independent workspace under:

```text
.freechat/workspace-data/rooms/{roomId}/
├── ROOM.md
├── FILES.md
├── .freechat/
├── files/
├── meta/
├── shared/
├── artifacts/
│   ├── docs/
│   ├── images/
│   ├── data/
│   └── exports/
└── agents/
    └── {agentId}/
        ├── AGENT.md
        ├── CLAUDE.md
        ├── res/
        ├── scripts/
        ├── skills/
        │   └── {skillName}/
        │       ├── SKILL.md
        │       ├── res/
        │       └── scripts/
        ├── workspace/
        └── .freechat/
```

A compatibility symlink may exist at `.freechat/workspace-data/{roomId}` for old file APIs.

### Runtime context

Before an Agent starts, FreeChat prepares its room Agent workspace and injects paths into `AGENT.md` / `CLAUDE.md`:

- Agent package path.
- Agent package `AGENT.md`, `res/`, and `skills/`.
- Current room workspace path.
- Current room `shared/`, `artifacts/`, and current Agent `workspace/`.
- `.freechat/ROOM.md`, `.freechat/MEMBERS.md`, `.freechat/API.md`, and `.freechat/TAB_FILES.md`.

The Agent should first understand its package `AGENT.md`, then choose and read `skills/*/SKILL.md` as needed. Official project files should still go through FreeChat CLI/API so tabs, permissions, and file visibility stay consistent.

### Public document reader Skills

FreeChat ships built-in public Skills under:

```text
.freechat/workspace-data/system-skills/
├── pdf-reader/
├── excel-reader/
└── word-reader/
```

Each public Skill follows the same Claude-style contract:

```text
SKILL.md
res/
scripts/
```

Runtime mounting rule:

- When preparing `rooms/{roomId}/agents/{agentId}/skills/`, FreeChat symlinks each system Skill into the Agent skill directory.
- If symlink creation fails, FreeChat copies the system Skill as a fallback.
- Agents can read `skills/pdf-reader/SKILL.md`, `skills/excel-reader/SKILL.md`, and `skills/word-reader/SKILL.md` and run their extraction scripts as needed.

### Deletion and history

Room deletion is logical. Room workspace directories are retained so billing, run history, and artifacts can continue to link to the original room.
