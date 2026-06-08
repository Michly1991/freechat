import dotenv from 'dotenv'
import { resolve } from 'path'

dotenv.config()

const resolvePath = (path: string) => resolve(process.cwd(), path)

export const config = {
  port: parseInt(process.env.PORT || '3000'),
  host: process.env.HOST || '0.0.0.0',
  jwtSecret: process.env.JWT_SECRET || 'freechat-dev-secret-key-change-in-production',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  database: {
    path: resolvePath(process.env.DB_PATH || './data/freechat.db')
  },
  upload: {
    maxFileSize: parseInt(process.env.MAX_FILE_SIZE || '5242880'), // 5MB
    dir: resolvePath(process.env.UPLOAD_DIR || './data/uploads')
  },
  workspace: {
    root: resolvePath(process.env.WORKSPACE_ROOT || './workspace-data')
  },
  agent: {
    runtime: process.env.AGENT_RUNTIME || 'claude-code',
    timeoutMs: parseInt(process.env.AGENT_TIMEOUT_MS || '120000'),
    killGraceMs: parseInt(process.env.AGENT_KILL_GRACE_MS || '5000'),
    historyLimit: parseInt(process.env.AGENT_HISTORY_LIMIT || '100'),
    sessionRetentionDays: parseInt(process.env.AGENT_SESSION_RETENTION_DAYS || '30')
  },
  cors: {
    origin: process.env.CORS_ORIGIN || '*'
  }
}
