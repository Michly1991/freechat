import type Database from 'better-sqlite3'

function ensureColumn(db: Database.Database, table: string, cols: any[], name: string, ddl: string) {
  if (!cols.some((col) => col.name === name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`)
}

export function ensureAgentAnalyticsSchema(db: Database.Database) {
  const cols = db.prepare('PRAGMA table_info(agent_runs)').all() as any[]
  ensureColumn(db, 'agent_runs', cols, 'runtime', 'runtime TEXT')
  ensureColumn(db, 'agent_runs', cols, 'model', 'model TEXT')
  ensureColumn(db, 'agent_runs', cols, 'duration_ms', 'duration_ms INTEGER')
  ensureColumn(db, 'agent_runs', cols, 'input_tokens', 'input_tokens INTEGER DEFAULT 0')
  ensureColumn(db, 'agent_runs', cols, 'output_tokens', 'output_tokens INTEGER DEFAULT 0')
  ensureColumn(db, 'agent_runs', cols, 'cache_creation_input_tokens', 'cache_creation_input_tokens INTEGER DEFAULT 0')
  ensureColumn(db, 'agent_runs', cols, 'cache_read_input_tokens', 'cache_read_input_tokens INTEGER DEFAULT 0')
  ensureColumn(db, 'agent_runs', cols, 'total_tokens', 'total_tokens INTEGER DEFAULT 0')
  ensureColumn(db, 'agent_runs', cols, 'tool_call_count', 'tool_call_count INTEGER DEFAULT 0')
  ensureColumn(db, 'agent_runs', cols, 'tool_duration_ms', 'tool_duration_ms INTEGER DEFAULT 0')
  ensureColumn(db, 'agent_runs', cols, 'actor_user_id', 'actor_user_id TEXT')
  ensureColumn(db, 'agent_runs', cols, 'payer_user_id', 'payer_user_id TEXT')
  ensureColumn(db, 'agent_runs', cols, 'run_source', 'run_source TEXT')
  ensureColumn(db, 'agent_runs', cols, 'task_id', 'task_id TEXT')
  ensureColumn(db, 'agent_runs', cols, 'subtask_id', 'subtask_id TEXT')
  ensureColumn(db, 'agent_runs', cols, 'parent_run_id', 'parent_run_id TEXT')
  ensureColumn(db, 'agent_runs', cols, 'resume_attempt', 'resume_attempt INTEGER DEFAULT 0')
  ensureColumn(db, 'agent_runs', cols, 'usage_source', 'usage_source TEXT')
  ensureColumn(db, 'agent_runs', cols, 'usage_trust_level', 'usage_trust_level TEXT')
  ensureColumn(db, 'agent_runs', cols, 'usage_reported_by_connector_id', 'usage_reported_by_connector_id TEXT')
  ensureColumn(db, 'agent_runs', cols, 'usage_reported_at', 'usage_reported_at INTEGER')
  ensureColumn(db, 'agent_runs', cols, 'raw_usage_json', 'raw_usage_json TEXT')
  db.exec(`CREATE INDEX IF NOT EXISTS idx_agent_runs_room_agent_started ON agent_runs(room_id, agent_id, started_at)`)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_agent_runs_status_source ON agent_runs(status, run_source, started_at)`)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_agent_runs_payer_started ON agent_runs(payer_user_id, started_at)`)
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_tool_calls (
      id TEXT PRIMARY KEY, room_id TEXT NOT NULL, agent_id TEXT NOT NULL, run_id TEXT, stream_id TEXT,
      tool_name TEXT NOT NULL, action TEXT, status TEXT NOT NULL, error_code TEXT, error_message TEXT,
      input_summary TEXT, output_summary TEXT, started_at INTEGER NOT NULL, finished_at INTEGER, duration_ms INTEGER,
      FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
      FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE,
      FOREIGN KEY (run_id) REFERENCES agent_runs(id) ON DELETE SET NULL,
      FOREIGN KEY (stream_id) REFERENCES agent_streams(id) ON DELETE SET NULL
    )
  `)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_agent_tool_calls_room_started ON agent_tool_calls(room_id, started_at)`)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_agent_tool_calls_run ON agent_tool_calls(run_id)`)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_agent_tool_calls_agent_started ON agent_tool_calls(agent_id, started_at)`)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_agent_tool_calls_room_status_started ON agent_tool_calls(room_id, status, started_at)`)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_agent_tool_calls_room_tool_status ON agent_tool_calls(room_id, tool_name, status)`)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_agent_tool_calls_error_code ON agent_tool_calls(room_id, error_code, started_at)`)
}
