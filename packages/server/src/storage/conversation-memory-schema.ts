import type Database from 'better-sqlite3'

export function ensureConversationMemorySchema(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS conversation_memory_state (
      scope_type TEXT NOT NULL,
      room_id TEXT NOT NULL,
      agent_id TEXT,
      last_message_created_at INTEGER DEFAULT 0,
      last_run_finished_at INTEGER DEFAULT 0,
      last_compacted_at INTEGER DEFAULT 0,
      message_count_since_compact INTEGER DEFAULT 0,
      char_count_since_compact INTEGER DEFAULT 0,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (scope_type, room_id, agent_id)
    )
  `)
  db.exec(`
    CREATE TABLE IF NOT EXISTS conversation_memory_chunks (
      id TEXT PRIMARY KEY,
      scope_type TEXT NOT NULL,
      room_id TEXT NOT NULL,
      agent_id TEXT,
      file_path TEXT NOT NULL,
      source_from INTEGER,
      source_to INTEGER,
      summary TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )
  `)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_conversation_memory_chunks_scope ON conversation_memory_chunks(scope_type, room_id, agent_id, created_at)`)
}
