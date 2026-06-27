import type Database from 'better-sqlite3'

export function ensureInteractionSchema(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS interaction_requests (
      id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL,
      message_id TEXT,
      created_by TEXT NOT NULL,
      target_user_id TEXT,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      options_json TEXT,
      payload_json TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      result_json TEXT,
      priority TEXT DEFAULT 'normal',
      response_policy TEXT,
      consumed_by TEXT,
      consumed_at INTEGER,
      expires_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      resolved_by TEXT,
      resolved_at INTEGER,
      FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
      FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE SET NULL
    )
  `)

  const interactionCols = db.prepare('PRAGMA table_info(interaction_requests)').all() as any[]
  if (!interactionCols.some((col) => col.name === 'priority')) db.exec("ALTER TABLE interaction_requests ADD COLUMN priority TEXT DEFAULT 'normal'")
  if (!interactionCols.some((col) => col.name === 'response_policy')) db.exec('ALTER TABLE interaction_requests ADD COLUMN response_policy TEXT')
  if (!interactionCols.some((col) => col.name === 'consumed_by')) db.exec('ALTER TABLE interaction_requests ADD COLUMN consumed_by TEXT')
  if (!interactionCols.some((col) => col.name === 'consumed_at')) db.exec('ALTER TABLE interaction_requests ADD COLUMN consumed_at INTEGER')
  if (!interactionCols.some((col) => col.name === 'payload_json')) db.exec('ALTER TABLE interaction_requests ADD COLUMN payload_json TEXT')

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_interaction_requests_room_status
    ON interaction_requests(room_id, status, created_at)
  `)
}
