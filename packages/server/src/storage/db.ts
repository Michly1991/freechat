import Database from 'better-sqlite3'
import { config } from '../config.js'
import { mkdirSync } from 'fs'
import { dirname } from 'path'

// Ensure database directory exists
mkdirSync(dirname(config.database.path), { recursive: true })

const db = new Database(config.database.path)

// Enable WAL mode for better concurrency
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

type Migration = {
  version: string
  description: string
  up: () => void
}

const migrations: Migration[] = [
  {
    version: '001_schema_baseline',
    description: 'Mark current idempotent schema initializer as baseline',
    up: () => {}
  }
]

function runMigrations() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      description TEXT,
      applied_at INTEGER NOT NULL
    )
  `)

  const appliedRows = db.prepare('SELECT version FROM schema_migrations').all() as { version: string }[]
  const applied = new Set(appliedRows.map((row) => row.version))
  const insertMigration = db.prepare('INSERT INTO schema_migrations (version, description, applied_at) VALUES (?, ?, ?)')

  for (const migration of migrations) {
    if (applied.has(migration.version)) continue
    const tx = db.transaction(() => {
      migration.up()
      insertMigration.run(migration.version, migration.description, Date.now())
    })
    tx()
  }
}

export function initDatabase() {
  runMigrations()
  // Users table
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      nickname TEXT NOT NULL,
      avatar TEXT,
      role TEXT DEFAULT 'user',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `)

  // Rooms table
  db.exec(`
    CREATE TABLE IF NOT EXISTS rooms (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      created_by TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      last_active_at INTEGER NOT NULL,
      FOREIGN KEY (created_by) REFERENCES users(id)
    )
  `)

  // Room members table
  db.exec(`
    CREATE TABLE IF NOT EXISTS room_members (
      room_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL,
      type TEXT DEFAULT 'human',
      joined_at INTEGER NOT NULL,
      PRIMARY KEY (room_id, user_id),
      FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE
    )
  `)

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
      FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
      FOREIGN KEY (created_by) REFERENCES users(id)
    )
  `)

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_tasks_room_status 
    ON tasks(room_id, status)
  `)

  const taskCols = db.prepare('PRAGMA table_info(tasks)').all() as any[]
  if (!taskCols.some((col) => col.name === 'progress_note')) {
    db.exec('ALTER TABLE tasks ADD COLUMN progress_note TEXT')
  }

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
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
    )
  `)

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_task_items_task_status
    ON task_items(task_id, status, sort_order)
  `)

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

  // Agents table
  db.exec(`
    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      name TEXT NOT NULL,
      role_type TEXT NOT NULL,
      deployment TEXT NOT NULL,
      description TEXT,
      specialties TEXT,
      config TEXT,
      api_key_hash TEXT,
      status TEXT DEFAULT 'active',
      session_id TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (owner_id) REFERENCES users(id)
    )
  `)

  // Room-Agents junction table (which agents are in which rooms)
  db.exec(`
    CREATE TABLE IF NOT EXISTS room_agents (
      room_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      added_by TEXT NOT NULL,
      added_at INTEGER NOT NULL,
      room_role TEXT DEFAULT 'specialist',
      auto_enabled INTEGER DEFAULT 0,
      priority INTEGER DEFAULT 0,
      PRIMARY KEY (room_id, agent_id),
      FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
      FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
    )
  `)

  const roomAgentCols = db.prepare('PRAGMA table_info(room_agents)').all() as any[]
  if (!roomAgentCols.some((col) => col.name === 'room_role')) db.exec("ALTER TABLE room_agents ADD COLUMN room_role TEXT DEFAULT 'specialist'")
  if (!roomAgentCols.some((col) => col.name === 'auto_enabled')) db.exec('ALTER TABLE room_agents ADD COLUMN auto_enabled INTEGER DEFAULT 0')
  if (!roomAgentCols.some((col) => col.name === 'priority')) db.exec('ALTER TABLE room_agents ADD COLUMN priority INTEGER DEFAULT 0')

  db.exec(`
    UPDATE room_agents
    SET room_role = 'assistant', auto_enabled = 1
    WHERE agent_id IN (
      SELECT id FROM agents WHERE role_type = 'assistant' AND config LIKE '%"defaultRoomAssistant":true%'
    )
      AND NOT EXISTS (
        SELECT 1 FROM room_agents ra2
        WHERE ra2.room_id = room_agents.room_id
          AND ra2.auto_enabled = 1
          AND ra2.agent_id != room_agents.agent_id
      )
  `)

  // Room profiles table
  db.exec(`
    CREATE TABLE IF NOT EXISTS room_profiles (
      room_id TEXT NOT NULL,
      member_id TEXT NOT NULL,
      member_type TEXT NOT NULL DEFAULT 'human',
      display_name TEXT,
      role_description TEXT,
      avatar TEXT,
      custom_data TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (room_id, member_id),
      FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE
    )
  `)

  // Agent sessions table
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_sessions (
      id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      message_count INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL,
      last_active_at INTEGER NOT NULL,
      FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
      FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
    )
  `)

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_agent_sessions_room_agent
    ON agent_sessions(room_id, agent_id)
  `)

  // Agent conversation history used by provider-api runtime
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )
  `)

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_agent_messages_session_created
    ON agent_messages(session_id, created_at)
  `)

  // Agent run records for observability and failure diagnosis
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_runs (
      id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      status TEXT NOT NULL,
      input TEXT NOT NULL,
      output TEXT,
      error TEXT,
      session_id TEXT,
      started_at INTEGER NOT NULL,
      finished_at INTEGER,
      FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
      FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
    )
  `)

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_agent_runs_room_agent_started
    ON agent_runs(room_id, agent_id, started_at)
  `)

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
  if (!prefCols.some((col) => col.name === 'hidden')) {
    db.exec('ALTER TABLE conversation_prefs ADD COLUMN hidden INTEGER DEFAULT 0')
  }

  // Room invites table
  db.exec(`
    CREATE TABLE IF NOT EXISTS room_invites (
      code TEXT PRIMARY KEY,
      room_id TEXT NOT NULL,
      created_by TEXT NOT NULL,
      max_uses INTEGER,
      used_count INTEGER DEFAULT 0,
      expires_at INTEGER,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
      FOREIGN KEY (created_by) REFERENCES users(id)
    )
  `)

  console.log('✓ Database initialized')
}

export default db
