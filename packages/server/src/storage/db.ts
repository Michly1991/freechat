import Database from 'better-sqlite3'
import { config } from '../config.js'
import { mkdirSync } from 'fs'
import { dirname } from 'path'
import { ensureAgentDreamSchema } from './agent-dream-schema.js'
import { ensureAgentGrowthSchema } from './agent-growth-schema.js'
import { ensureNotificationSchema } from './notification-schema.js'
import { ensureBillingSchema } from './billing-schema.js'
import { ensureWorkgroupSchema } from './workgroup-schema.js'
import { ensureAgentAnalyticsSchema } from './agent-analytics-schema.js'
import { ensureRemoteAgentSchema } from './remote-agent-schema.js'
import { ensureVoiceSchema } from './voice-schema.js'; import { ensureRoomFileSchema } from './room-file-schema.js'; import { ensureRoomHandoffSchema } from './room-handoff-schema.js'; import { ensureKnowledgeSchema } from './knowledge-schema.js'

mkdirSync(dirname(config.database.path), { recursive: true })

const db = new Database(config.database.path)
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

type Migration = {
  version: string
  description: string
  up: () => void
}

const migrations: Migration[] = [
  { version: '001_schema_baseline', description: 'Mark current idempotent schema initializer as baseline', up: () => {} }
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

  // Rooms table
  db.exec(`
    CREATE TABLE IF NOT EXISTS rooms (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      created_by TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      last_active_at INTEGER NOT NULL, room_kind TEXT DEFAULT 'project', direct_key TEXT, direct_target_type TEXT, direct_target_id TEXT,
      scene_template_id TEXT,
      scene_template_version INTEGER,
      deleted_at INTEGER,
      deleted_by TEXT,
      FOREIGN KEY (created_by) REFERENCES users(id)
    )
  `)

  const roomCols = db.prepare('PRAGMA table_info(rooms)').all() as any[]
  if (!roomCols.some((col) => col.name === 'room_kind')) db.exec("ALTER TABLE rooms ADD COLUMN room_kind TEXT DEFAULT 'project'"); if (!roomCols.some((col) => col.name === 'direct_key')) db.exec('ALTER TABLE rooms ADD COLUMN direct_key TEXT')
  if (!roomCols.some((col) => col.name === 'direct_target_type')) db.exec('ALTER TABLE rooms ADD COLUMN direct_target_type TEXT'); if (!roomCols.some((col) => col.name === 'direct_target_id')) db.exec('ALTER TABLE rooms ADD COLUMN direct_target_id TEXT')
  if (!roomCols.some((col) => col.name === 'scene_template_id')) db.exec('ALTER TABLE rooms ADD COLUMN scene_template_id TEXT')
  if (!roomCols.some((col) => col.name === 'scene_template_version')) db.exec('ALTER TABLE rooms ADD COLUMN scene_template_version INTEGER')
  if (!roomCols.some((col) => col.name === 'deleted_at')) db.exec('ALTER TABLE rooms ADD COLUMN deleted_at INTEGER')
  if (!roomCols.some((col) => col.name === 'deleted_by')) db.exec('ALTER TABLE rooms ADD COLUMN deleted_by TEXT')
  db.exec('CREATE INDEX IF NOT EXISTS idx_rooms_direct_key ON rooms(direct_key)')

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

  ensureNotificationSchema(); ensureRoomFileSchema()

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
      is_template INTEGER DEFAULT 1,
      template_version INTEGER DEFAULT 1,
      source_template_id TEXT,
      source_template_version INTEGER,
      is_modified INTEGER DEFAULT 0,
      market_listed INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (owner_id) REFERENCES users(id)
    )
  `)

  const agentCols = db.prepare('PRAGMA table_info(agents)').all() as any[]
  if (!agentCols.some((col) => col.name === 'is_template')) db.exec('ALTER TABLE agents ADD COLUMN is_template INTEGER DEFAULT 1')
  if (!agentCols.some((col) => col.name === 'template_version')) db.exec('ALTER TABLE agents ADD COLUMN template_version INTEGER DEFAULT 1')
  if (!agentCols.some((col) => col.name === 'source_template_id')) db.exec('ALTER TABLE agents ADD COLUMN source_template_id TEXT')
  if (!agentCols.some((col) => col.name === 'source_template_version')) db.exec('ALTER TABLE agents ADD COLUMN source_template_version INTEGER')
  if (!agentCols.some((col) => col.name === 'is_modified')) db.exec('ALTER TABLE agents ADD COLUMN is_modified INTEGER DEFAULT 0')
  if (!agentCols.some((col) => col.name === 'market_listed')) db.exec('ALTER TABLE agents ADD COLUMN market_listed INTEGER DEFAULT 0')

  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_packages (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      package_name TEXT NOT NULL,
      package_version TEXT NOT NULL,
      checksum TEXT NOT NULL,
      manifest_json TEXT NOT NULL,
      imported_by TEXT NOT NULL,
      imported_at INTEGER NOT NULL,
      UNIQUE(imported_by, package_name),
      FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE,
      FOREIGN KEY (imported_by) REFERENCES users(id)
    )
  `)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_agent_packages_agent ON agent_packages(agent_id)`)

  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_skills (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      content TEXT NOT NULL DEFAULT '',
      enabled INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
    )
  `)

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_agent_skills_agent
    ON agent_skills(agent_id, sort_order, created_at)
  `)

  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_scripts (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      language TEXT NOT NULL DEFAULT 'bash',
      content TEXT NOT NULL DEFAULT '',
      enabled INTEGER NOT NULL DEFAULT 1,
      run_policy TEXT NOT NULL DEFAULT 'manual_only',
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
    )
  `)

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_agent_scripts_agent
    ON agent_scripts(agent_id, sort_order, created_at)
  `)

  db.exec(`
    CREATE TABLE IF NOT EXISTS scene_templates (
      id TEXT PRIMARY KEY,
      owner_id TEXT,
      built_in_key TEXT,
      name TEXT NOT NULL,
      description TEXT,
      icon TEXT,
      version INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'active',
      market_listed INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `)

  const sceneCols = db.prepare('PRAGMA table_info(scene_templates)').all() as any[]
  if (!sceneCols.some((col) => col.name === 'owner_id')) db.exec('ALTER TABLE scene_templates ADD COLUMN owner_id TEXT')
  if (!sceneCols.some((col) => col.name === 'built_in_key')) db.exec('ALTER TABLE scene_templates ADD COLUMN built_in_key TEXT')
  if (!sceneCols.some((col) => col.name === 'market_listed')) db.exec('ALTER TABLE scene_templates ADD COLUMN market_listed INTEGER NOT NULL DEFAULT 0')
  db.exec(`CREATE INDEX IF NOT EXISTS idx_scene_templates_status_created ON scene_templates(status, created_at)`)

  db.exec(`
    CREATE TABLE IF NOT EXISTS scene_template_agents (
      id TEXT PRIMARY KEY,
      scene_id TEXT NOT NULL,
      agent_template_id TEXT NOT NULL,
      room_role TEXT NOT NULL DEFAULT 'specialist',
      auto_enabled INTEGER NOT NULL DEFAULT 0,
      priority INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (scene_id) REFERENCES scene_templates(id) ON DELETE CASCADE,
      FOREIGN KEY (agent_template_id) REFERENCES agents(id) ON DELETE CASCADE
    )
  `)

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_scene_template_agents_scene
    ON scene_template_agents(scene_id, priority, created_at)
  `)

  db.exec(`
    CREATE TABLE IF NOT EXISTS template_permission_members (
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL,
      granted_by TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (target_type, target_id, user_id)
    )
  `)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_template_permission_members_user ON template_permission_members(user_id, target_type, role)`)

  db.exec(`
    CREATE TABLE IF NOT EXISTS template_permission_requests (
      id TEXT PRIMARY KEY,
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      requester_id TEXT NOT NULL,
      requested_role TEXT NOT NULL,
      message TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      resolved_by TEXT,
      resolved_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_template_permission_requests_target ON template_permission_requests(target_type, target_id, status)`)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_template_permission_requests_requester ON template_permission_requests(requester_id, status)`)

  db.exec(`
    CREATE TABLE IF NOT EXISTS scene_template_pages (
      id TEXT PRIMARY KEY,
      scene_id TEXT NOT NULL,
      title TEXT NOT NULL,
      icon TEXT,
      content TEXT NOT NULL DEFAULT '',
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (scene_id) REFERENCES scene_templates(id) ON DELETE CASCADE
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

  ensureBillingSchema(db)
  ensureWorkgroupSchema(db)

  // Historical Agent conversation cache retained for existing schema compatibility
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
      runtime TEXT,
      model TEXT,
      duration_ms INTEGER,
      input_tokens INTEGER DEFAULT 0,
      output_tokens INTEGER DEFAULT 0,
      cache_creation_input_tokens INTEGER DEFAULT 0,
      cache_read_input_tokens INTEGER DEFAULT 0,
      total_tokens INTEGER DEFAULT 0,
      tool_call_count INTEGER DEFAULT 0,
      tool_duration_ms INTEGER DEFAULT 0,
      actor_user_id TEXT,
      started_at INTEGER NOT NULL,
      finished_at INTEGER,
      FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
      FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
    )
  `)

  ensureAgentAnalyticsSchema(db)
  ensureRemoteAgentSchema(db)
  ensureVoiceSchema(); ensureRoomHandoffSchema(db); ensureKnowledgeSchema()
  ensureAgentDreamSchema(db)
  ensureAgentGrowthSchema(db)

  // Agent stream activity records for restoring in-progress and completed Agent work traces
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_streams (
      id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      actor_name TEXT NOT NULL,
      status TEXT NOT NULL,
      final_message_id TEXT,
      error TEXT,
      started_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      finished_at INTEGER,
      FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
      FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE,
      FOREIGN KEY (final_message_id) REFERENCES messages(id) ON DELETE SET NULL
    )
  `)

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_agent_streams_room_status_started
    ON agent_streams(room_id, status, started_at)
  `)

  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_stream_events (
      id TEXT PRIMARY KEY,
      stream_id TEXT NOT NULL,
      kind TEXT,
      text TEXT NOT NULL,
      tool TEXT,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (stream_id) REFERENCES agent_streams(id) ON DELETE CASCADE
    )
  `)

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_agent_stream_events_stream_created
    ON agent_stream_events(stream_id, created_at)
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

  console.log('Database initialized')
}

export default db
