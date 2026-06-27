import type Database from 'better-sqlite3'

export function ensureConversationSchema(db: Database.Database) {
  // Conversation preferences table (per user per conversation)
  db.exec(`
    CREATE TABLE IF NOT EXISTS conversation_prefs (
      user_id TEXT NOT NULL,
      conversation_type TEXT NOT NULL,
      conversation_id TEXT NOT NULL,
      pinned INTEGER DEFAULT 0,
      muted INTEGER DEFAULT 0,
      hidden INTEGER DEFAULT 0,
      last_read_at INTEGER DEFAULT 0,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, conversation_type, conversation_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `)

  const prefCols = db.prepare('PRAGMA table_info(conversation_prefs)').all() as any[]
  if (!prefCols.some((col) => col.name === 'hidden')) db.exec('ALTER TABLE conversation_prefs ADD COLUMN hidden INTEGER DEFAULT 0')
}
