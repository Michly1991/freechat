import db from './db.js'

export function ensureVoiceSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_voice_provider_configs (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      name TEXT NOT NULL,
      asr_enabled INTEGER NOT NULL DEFAULT 1,
      tts_enabled INTEGER NOT NULL DEFAULT 1,
      is_default_asr INTEGER NOT NULL DEFAULT 0,
      is_default_tts INTEGER NOT NULL DEFAULT 0,
      credential_json_cipher TEXT NOT NULL,
      config_json TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `)
  db.exec('CREATE INDEX IF NOT EXISTS idx_voice_configs_user_provider ON user_voice_provider_configs(user_id, provider, status)')
  db.exec(`
    CREATE TABLE IF NOT EXISTS voice_interactions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      room_id TEXT,
      task_id TEXT,
      message_id TEXT,
      provider TEXT NOT NULL,
      direction TEXT NOT NULL,
      audio_path TEXT,
      text TEXT,
      status TEXT NOT NULL,
      error TEXT,
      duration_ms INTEGER,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `)
  db.exec('CREATE INDEX IF NOT EXISTS idx_voice_interactions_user_created ON voice_interactions(user_id, created_at)')
}
