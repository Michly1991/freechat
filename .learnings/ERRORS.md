# Errors

---

## 2026-06-08 - better-sqlite3 require from workspace root failed
- Context: while debugging FreeChat DB state, running `node - <<... require('better-sqlite3')` from repo root failed with MODULE_NOT_FOUND.
- Cause: dependency is installed under `packages/server`; use `pnpm --filter @freechat/server exec node ...`, import server db module, or run from `packages/server`.
- Fix pattern: for package-local deps in pnpm workspace, execute within the package context.

## 2026-06-08 - Claude Code CLI does not support --cwd
- Symptom: FreeChat @助理 messages had valid `mentions` in DB but no Agent reply.
- Root cause: AgentService launched `claude -p ... --cwd <workspace>`, but current Claude Code CLI reports `error: unknown option '--cwd'`.
- Fix: launch `claude` with Node `spawn(..., { cwd: workspaceDir })`, not a CLI `--cwd` flag. Also use `--output-format json` and parse `session_id` from JSON.
