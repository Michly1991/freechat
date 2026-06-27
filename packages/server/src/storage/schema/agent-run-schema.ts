import type Database from 'better-sqlite3'

export function ensureAgentRunSchema(db: Database.Database) {
  // Historical Agent conversation cache retained for existing schema compatibility
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )
  `)

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_agent_messages_session_created
    ON agent_messages(session_id, created_at)
  `)

  // Agent run records for observability and failure diagnosis
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_runs (
      id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      status TEXT NOT NULL,
      input TEXT NOT NULL,
      output TEXT,
      error TEXT,
      session_id TEXT,
      runtime TEXT,
      model TEXT,
      duration_ms INTEGER,
      input_tokens INTEGER DEFAULT 0,
      output_tokens INTEGER DEFAULT 0,
      cache_creation_input_tokens INTEGER DEFAULT 0,
      cache_read_input_tokens INTEGER DEFAULT 0,
      total_tokens INTEGER DEFAULT 0,
      tool_call_count INTEGER DEFAULT 0,
      tool_duration_ms INTEGER DEFAULT 0,
      actor_user_id TEXT,
      started_at INTEGER NOT NULL,
      finished_at INTEGER,
      FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
      FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
    )
  `)
}
