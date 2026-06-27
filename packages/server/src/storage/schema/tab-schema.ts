import type Database from 'better-sqlite3'

export function ensureTabSchema(db: Database.Database) {
  // Tabs table
  db.exec(`
    CREATE TABLE IF NOT EXISTS tabs (
      id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT DEFAULT '',
      icon TEXT,
      sort_order INTEGER DEFAULT 0,
      created_by TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
      FOREIGN KEY (created_by) REFERENCES users(id)
    )
  `)

  db.exec(`
    CREATE TABLE IF NOT EXISTS room_tab_preferences (
      room_id TEXT PRIMARY KEY,
      default_tab_id TEXT,
      updated_by TEXT,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
      FOREIGN KEY (default_tab_id) REFERENCES tabs(id) ON DELETE SET NULL,
      FOREIGN KEY (updated_by) REFERENCES users(id)
    )
  `)
}
