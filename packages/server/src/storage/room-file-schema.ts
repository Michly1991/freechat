import db from './db.js'

export function ensureRoomFileSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS room_file_folders (
      id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL,
      parent_id TEXT,
      name TEXT NOT NULL,
      relative_path TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'project',
      source_message_id TEXT,
      created_by TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE(room_id, relative_path),
      FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE
    )
  `)
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_room_file_folders_room_path
    ON room_file_folders(room_id, relative_path)
  `)
  db.exec(`
    CREATE TABLE IF NOT EXISTS room_files (
      id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL,
      folder_id TEXT NOT NULL,
      name TEXT NOT NULL,
      relative_path TEXT NOT NULL,
      storage_path TEXT NOT NULL,
      mime_type TEXT,
      size INTEGER DEFAULT 0,
      sha256 TEXT,
      source TEXT NOT NULL DEFAULT 'upload',
      source_file_id TEXT,
      message_id TEXT,
      uploaded_by TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE(room_id, relative_path),
      FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
      FOREIGN KEY (folder_id) REFERENCES room_file_folders(id) ON DELETE CASCADE
    )
  `)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_room_files_room_folder ON room_files(room_id, folder_id)`)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_room_files_room_message ON room_files(room_id, message_id)`)
}
