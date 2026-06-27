import type Database from 'better-sqlite3'

export function ensureCoreUserSchema(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      nickname TEXT NOT NULL,
      avatar TEXT,
      role TEXT DEFAULT 'user',
      identity_type TEXT DEFAULT 'human',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `)
  const userCols = db.prepare('PRAGMA table_info(users)').all() as any[]
  if (!userCols.some((col) => col.name === 'identity_type')) db.exec("ALTER TABLE users ADD COLUMN identity_type TEXT DEFAULT 'human'")
}
