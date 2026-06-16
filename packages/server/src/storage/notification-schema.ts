import db from './db.js'

export function ensureNotificationSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, room_id TEXT, message_id TEXT, task_id TEXT,
      type TEXT NOT NULL, title TEXT NOT NULL, body TEXT, actor_id TEXT, actor_name TEXT,
      read_at INTEGER, created_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
      FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE SET NULL,
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE SET NULL
    )
  `)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_notifications_user_created ON notifications(user_id, created_at)`)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON notifications(user_id, read_at)`)
}
