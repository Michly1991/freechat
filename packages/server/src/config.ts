import dotenv from 'dotenv'
import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'

dotenv.config()

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const resolvePath = (path: string) => resolve(repoRoot, path)

export const config = {
  port: parseInt(process.env.PORT || '3000'),
  host: process.env.HOST || '0.0.0.0',
  jwtSecret: process.env.JWT_SECRET || 'freechat-dev-secret-key-change-in-production',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  database: {
    path: resolvePath(process.env.DATABASE_PATH || process.env.DB_PATH || '.freechat/data/freechat.db')
  },
  upload: {
    maxFileSize: parseInt(process.env.MAX_FILE_SIZE || '5242880'), // 5MB
    dir: resolvePath(process.env.UPLOAD_DIR || '.freechat/data/uploads')
  },
  workspace: {
    root: resolvePath(process.env.WORKSPACE_ROOT || '.freechat/workspace-data')
  },
  agentDream: {
    enabled: process.env.AGENT_DREAM_ENABLED !== 'false',
    runHour: parseInt(process.env.AGENT_DREAM_RUN_HOUR || '3'),
    runMinute: parseInt(process.env.AGENT_DREAM_RUN_MINUTE || '30'),
    autoApplySafeFixes: process.env.AGENT_DREAM_AUTO_APPLY_SAFE_FIXES !== 'false'
  },
  agentGrowth: {
    enabled: process.env.AGENT_GROWTH_ENABLED !== 'false',
    runHour: parseInt(process.env.AGENT_GROWTH_RUN_HOUR || '4'),
    runMinute: parseInt(process.env.AGENT_GROWTH_RUN_MINUTE || '10')
  },
  agent: {
    chatTimeoutMs: parseInt(process.env.AGENT_CHAT_TIMEOUT_MS || '180000'),
    deciderTimeoutMs: parseInt(process.env.AGENT_DECIDER_TIMEOUT_MS || '15000'),
    taskTimeoutMs: parseInt(process.env.AGENT_TASK_TIMEOUT_MS || '600000'),
    hardTimeoutMs: parseInt(process.env.AGENT_HARD_TIMEOUT_MS || '900000'),
    killGraceMs: parseInt(process.env.AGENT_KILL_GRACE_MS || '5000'),
    chatRecentDefaultLimit: parseInt(process.env.AGENT_CHAT_RECENT_DEFAULT_LIMIT || '30')
  },
  cors: {
    origin: process.env.CORS_ORIGIN || '*'
  }
}
