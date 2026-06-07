import dotenv from 'dotenv'
dotenv.config()

export const config = {
  port: parseInt(process.env.PORT || '3000'),
  host: process.env.HOST || '0.0.0.0',
  jwtSecret: process.env.JWT_SECRET || 'freechat-dev-secret-key-change-in-production',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  database: {
    path: process.env.DB_PATH || './data/freechat.db'
  },
  upload: {
    maxFileSize: parseInt(process.env.MAX_FILE_SIZE || '5242880'), // 5MB
    dir: process.env.UPLOAD_DIR || './data/uploads'
  },
  workspace: {
    root: process.env.WORKSPACE_ROOT || './workspace-data'
  },
  agent: {
    runtime: process.env.AGENT_RUNTIME || 'claude-code'
  },
  cors: {
    origin: process.env.CORS_ORIGIN || '*'
  }
}
