import Database from 'better-sqlite3'
import { config } from '../config.js'
import { mkdirSync } from 'fs'
import { dirname } from 'path'
import { ensureAgentDreamSchema } from './agent-dream-schema.js'
import { ensureAgentGrowthSchema } from './agent-growth-schema.js'
import { ensureNotificationSchema } from './notification-schema.js'
import { ensureBillingSchema } from './billing-schema.js'
import { ensureAuditSchema } from '../services/audit-log.service.js'
import { ensureWorkgroupSchema } from './workgroup-schema.js'
import { ensureAgentAnalyticsSchema } from './agent-analytics-schema.js'
import { ensureRemoteAgentSchema } from './remote-agent-schema.js'
import { ensureVoiceSchema } from './voice-schema.js'
import { ensureRoomFileSchema } from './room-file-schema.js'
import { ensureRoomHandoffSchema } from './room-handoff-schema.js'
import { ensureKnowledgeSchema } from './knowledge-schema.js'
import { ensureCoreUserSchema } from './schema/core-user-schema.js'
import { ensureRoomSchema } from './schema/room-schema.js'
import { ensureMessageSchema } from './schema/message-schema.js'
import { ensureInteractionSchema } from './schema/interaction-schema.js'
import { ensureTaskSchema } from './schema/task-schema.js'
import { ensureTabSchema } from './schema/tab-schema.js'
import { ensureAgentSchema } from './schema/agent-schema.js'
import { ensureAgentRunSchema } from './schema/agent-run-schema.js'
import { ensureAgentStreamSchema } from './schema/agent-stream-schema.js'
import { ensureFriendDmSchema } from './schema/friend-dm-schema.js'
import { ensureConversationSchema } from './schema/conversation-schema.js'
import { ensureInviteSchema } from './schema/invite-schema.js'

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
  ensureCoreUserSchema(db)
  ensureRoomSchema(db)
  ensureMessageSchema(db)
  ensureNotificationSchema()
  ensureRoomFileSchema()
  ensureInteractionSchema(db)
  ensureTaskSchema(db)
  ensureTabSchema(db)
  ensureAgentSchema(db)
  ensureBillingSchema(db)
  ensureAuditSchema(db)
  ensureWorkgroupSchema(db)
  ensureAgentRunSchema(db)
  ensureAgentAnalyticsSchema(db)
  ensureRemoteAgentSchema(db)
  ensureVoiceSchema()
  ensureRoomHandoffSchema(db)
  ensureKnowledgeSchema()
  ensureAgentDreamSchema(db)
  ensureAgentGrowthSchema(db)
  ensureAgentStreamSchema(db)
  ensureFriendDmSchema(db)
  ensureConversationSchema(db)
  ensureInviteSchema(db)
  console.log('Database initialized')
}

export default db
