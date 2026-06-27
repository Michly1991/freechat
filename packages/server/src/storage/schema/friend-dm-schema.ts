import type Database from 'better-sqlite3'

export function ensureFriendDmSchema(db: Database.Database) {
  // Friend requests table
  db.exec(`
    CREATE TABLE IF NOT EXISTS friend_requests (
      id TEXT PRIMARY KEY,
      from_user_id TEXT NOT NULL,
      to_user_id TEXT NOT NULL,
      message TEXT,
      status TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (from_user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (to_user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `)

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_friend_requests_to_status
    ON friend_requests(to_user_id, status)
  `)

  // Friendships table (bidirectional rows)
  db.exec(`
    CREATE TABLE IF NOT EXISTS friendships (
      user_id TEXT NOT NULL,
      friend_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, friend_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (friend_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `)

  // DM conversations table
  db.exec(`
    CREATE TABLE IF NOT EXISTS dm_conversations (
      id TEXT PRIMARY KEY,
      user_a_id TEXT NOT NULL,
      user_b_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      last_active_at INTEGER NOT NULL,
      UNIQUE(user_a_id, user_b_id),
      FOREIGN KEY (user_a_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (user_b_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `)

  // DM messages table
  db.exec(`
    CREATE TABLE IF NOT EXISTS dm_messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      actor_id TEXT NOT NULL,
      actor_name TEXT NOT NULL,
      content TEXT NOT NULL,
      edited_at INTEGER,
      deleted INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (conversation_id) REFERENCES dm_conversations(id) ON DELETE CASCADE,
      FOREIGN KEY (actor_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `)

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_dm_messages_conversation_created
    ON dm_messages(conversation_id, created_at)
  `)
}
