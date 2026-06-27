import type Database from 'better-sqlite3'

export function ensureTaskSchema(db: Database.Database) {
  // Tasks table
  db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL,
      priority TEXT DEFAULT 'medium',
      assignee_id TEXT,
      assignee_name TEXT,
      assignee_type TEXT,
      blocked_reason TEXT,
      review_note TEXT,
      progress_note TEXT,
      created_by TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      completed_at INTEGER,
      retry_count INTEGER DEFAULT 0,
      last_retry_at INTEGER,
      last_retry_by TEXT,
      FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
      FOREIGN KEY (created_by) REFERENCES users(id)
    )
  `)

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_tasks_room_status 
    ON tasks(room_id, status)
  `)

  const taskCols = db.prepare('PRAGMA table_info(tasks)').all() as any[]
  if (!taskCols.some((col) => col.name === 'progress_note')) db.exec('ALTER TABLE tasks ADD COLUMN progress_note TEXT')
  if (!taskCols.some((col) => col.name === 'retry_count')) db.exec('ALTER TABLE tasks ADD COLUMN retry_count INTEGER DEFAULT 0')
  if (!taskCols.some((col) => col.name === 'last_retry_at')) db.exec('ALTER TABLE tasks ADD COLUMN last_retry_at INTEGER')
  if (!taskCols.some((col) => col.name === 'last_retry_by')) db.exec('ALTER TABLE tasks ADD COLUMN last_retry_by TEXT')

  // Task subtasks/checklist table
  db.exec(`
    CREATE TABLE IF NOT EXISTS task_items (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL DEFAULT 'todo',
      assignee_id TEXT,
      assignee_name TEXT,
      assignee_type TEXT,
      sort_order INTEGER DEFAULT 0,
      created_by TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      completed_at INTEGER,
      blocked_reason TEXT,
      retry_count INTEGER DEFAULT 0,
      last_retry_at INTEGER,
      last_retry_by TEXT,
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
    )
  `)

  const taskItemCols = db.prepare('PRAGMA table_info(task_items)').all() as any[]
  if (!taskItemCols.some((col) => col.name === 'blocked_reason')) db.exec('ALTER TABLE task_items ADD COLUMN blocked_reason TEXT')
  if (!taskItemCols.some((col) => col.name === 'retry_count')) db.exec('ALTER TABLE task_items ADD COLUMN retry_count INTEGER DEFAULT 0')
  if (!taskItemCols.some((col) => col.name === 'last_retry_at')) db.exec('ALTER TABLE task_items ADD COLUMN last_retry_at INTEGER')
  if (!taskItemCols.some((col) => col.name === 'last_retry_by')) db.exec('ALTER TABLE task_items ADD COLUMN last_retry_by TEXT')

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_task_items_task_status
    ON task_items(task_id, status, sort_order)
  `)

  db.exec(`
    CREATE TABLE IF NOT EXISTS task_item_dependencies (
      item_id TEXT NOT NULL,
      depends_on_item_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (item_id, depends_on_item_id),
      FOREIGN KEY (item_id) REFERENCES task_items(id) ON DELETE CASCADE,
      FOREIGN KEY (depends_on_item_id) REFERENCES task_items(id) ON DELETE CASCADE
    )
  `)

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_task_item_dependencies_depends_on
    ON task_item_dependencies(depends_on_item_id)
  `)
}
