import type Database from 'better-sqlite3'

export function ensureMessageSchema(db: Database.Database) {
  // Messages table
  db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL,
      actor_id TEXT NOT NULL,
      actor_name TEXT NOT NULL,
      actor_role TEXT NOT NULL,
      content TEXT NOT NULL,
      kind TEXT DEFAULT 'text',
      payload TEXT,
      mentions TEXT,
      reply_to TEXT,
      edited_at INTEGER,
      deleted INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE
    )
  `)

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_messages_room_created 
    ON messages(room_id, created_at)
  `)

  const messageCols = db.prepare('PRAGMA table_info(messages)').all() as any[]
  if (!messageCols.some((col) => col.name === 'kind')) db.exec("ALTER TABLE messages ADD COLUMN kind TEXT DEFAULT 'text'")
  if (!messageCols.some((col) => col.name === 'payload')) db.exec('ALTER TABLE messages ADD COLUMN payload TEXT')
}
