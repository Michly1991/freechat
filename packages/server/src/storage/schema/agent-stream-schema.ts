import type Database from 'better-sqlite3'

export function ensureAgentStreamSchema(db: Database.Database) {
  // Agent stream activity records for restoring in-progress and completed Agent work traces
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_streams (
      id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      actor_name TEXT NOT NULL,
      status TEXT NOT NULL,
      final_message_id TEXT,
      error TEXT,
      started_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      finished_at INTEGER,
      FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
      FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE,
      FOREIGN KEY (final_message_id) REFERENCES messages(id) ON DELETE SET NULL
    )
  `)

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_agent_streams_room_status_started
    ON agent_streams(room_id, status, started_at)
  `)

  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_stream_events (
      id TEXT PRIMARY KEY,
      stream_id TEXT NOT NULL,
      kind TEXT,
      text TEXT NOT NULL,
      tool TEXT,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (stream_id) REFERENCES agent_streams(id) ON DELETE CASCADE
    )
  `)

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_agent_stream_events_stream_created
    ON agent_stream_events(stream_id, created_at)
  `)
}
