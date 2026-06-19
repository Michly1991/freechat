# Agent Package Publishing

FreeChat supports uploading npm-packed Agent packages to the server. The server treats npm `.tgz` as a portable archive format only: it extracts, validates, imports, and lists the Agent in the marketplace. It never runs `npm install` or package lifecycle scripts.

## Package Layout

Use `npm pack` to create a `.tgz` containing:

```text
package/
├── package.json
├── AGENT.md
├── res/
├── scripts/
└── skills/
    └── skill-name/
        ├── SKILL.md
        ├── res/
        └── scripts/
```

`package.json` must include:

```json
{
  "name": "@freechat-agent/example",
  "version": "1.0.0",
  "description": "Example Agent",
  "freechat": {
    "kind": "agent",
    "schemaVersion": 1,
    "agent": {
      "name": "Example Agent",
      "roleType": "specialist",
      "description": "What this Agent does",
      "specialties": ["example"]
    },
    "entry": "AGENT.md",
    "skillsDir": "skills",
    "resDir": "res",
    "scriptsDir": "scripts"
  },
  "files": ["AGENT.md", "res/", "scripts/", "skills/", "package.json"]
}
```

## Upload Flow

```text
user npm pack
→ upload .tgz in Contacts / Agent
→ server validates archive paths and manifest
→ server creates or updates the user's Agent
→ server copies AGENT.md, res/, scripts/, skills/
→ server creates Skill records from skills/*/SKILL.md
→ server marks the Agent as market_listed = 1
```

The package identity is `(imported_by, package_name)`. Uploading the same package name again updates the existing Agent and keeps the same Agent ID.

## Validation and Safety

- Only `.tgz` / `.tar.gz` is accepted.
- Archive entries must stay under the npm `package/` prefix.
- Absolute paths, `..`, and backslash paths are rejected.
- `freechat.kind` must be `agent`.
- `AGENT.md` is required.
- Every Skill directory must contain `SKILL.md`.
- Package size limit is 50MB.
- `node_modules`, `.git`, lock files, and `.npmrc` are ignored during import.
- No package lifecycle scripts are executed.

## API

```text
POST /api/agents/package/upload
Content-Type: multipart/form-data
field: package
```

Response:

```json
{
  "mode": "create|update|overwrite|downgrade",
  "listed": true,
  "agent": {},
  "package": {
    "name": "@freechat-agent/example",
    "version": "1.0.0",
    "checksum": "sha256...",
    "skills": ["skill-name"]
  }
}
```
