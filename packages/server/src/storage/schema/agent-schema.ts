import type Database from 'better-sqlite3'

export function ensureAgentSchema(db: Database.Database) {
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
}
